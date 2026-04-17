/**
 * Residence Risk TW — API Worker
 * Cloudflare Workers + D1
 */

import { geocode, normalizeAddress } from './geocode';
import { assessFlood } from './flood';

interface ErrorBody {
	error: string;
	code: string;
	message: string;
}

// SA §8.3 error codes
function errorResponse(status: number, code: string, message: string): Response {
	const body: ErrorBody = { error: code, code, message };
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

// CORS (SA §8.4)
const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:8787'];

function corsHeaders(request: Request): Record<string, string> {
	const origin = request.headers.get('Origin') || '';
	const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
	return {
		'Access-Control-Allow-Origin': allowed,
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
	};
}

function withCors(response: Response, request: Request): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(corsHeaders(request))) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

// --- Route handlers ---

async function handleHealth(env: Env): Promise<Response> {
	try {
		const result = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
		return jsonResponse({
			status: 'ok',
			database: result?.ok === 1 ? 'connected' : 'error',
			timestamp: new Date().toISOString(),
		});
	} catch {
		return jsonResponse(
			{
				status: 'degraded',
				database: 'error',
				timestamp: new Date().toISOString(),
			},
			503,
		);
	}
}

async function handleMetaVersions(env: Env): Promise<Response> {
	try {
		const { results } = await env.DB.prepare(
			`SELECT dataset_name, source_org, data_version, imported_at, record_count, attribution_text
			 FROM rrw_data_sources
			 ORDER BY imported_at DESC`,
		).all();

		return jsonResponse({
			data_sources: results,
			total: results.length,
		});
	} catch {
		return errorResponse(500, 'INTERNAL_ERROR', '無法取得資料版本資訊');
	}
}

async function handleAssess(request: Request, env: Env): Promise<Response> {
	const start = Date.now();

	let body: { address?: string };
	try {
		body = await request.json();
	} catch {
		return errorResponse(400, 'INVALID_REQUEST', '請求格式錯誤，需要 JSON body');
	}

	const address = body?.address?.trim();
	if (!address) {
		return errorResponse(400, 'INVALID_ADDRESS', '請提供 address 欄位');
	}

	// 1. 地理編碼
	const location = await geocode(env.DB, address);
	if (!location) {
		await logQuery(env.DB, null, null, 'none', 404, Date.now() - start);
		return errorResponse(404, 'ADDRESS_NOT_FOUND', '無法將地址轉換為座標，請確認地址是否正確');
	}

	// 2. 淹水風險查詢
	const flood = await assessFlood(env.DB, location.lat, location.lng);

	const elapsed = Date.now() - start;
	await logQuery(env.DB, null, null, location.source, 200, elapsed);

	return jsonResponse({
		address: normalizeAddress(address),
		location: {
			lat: location.lat,
			lng: location.lng,
			source: location.source,
			display_name: location.display_name,
		},
		flood,
		meta: {
			response_ms: elapsed,
			api_version: '0.1.0-dev',
		},
		disclaimer: '本工具使用政府公開資料，僅供防災參考，不構成任何土地使用或交易決策依據。',
	});
}

async function logQuery(
	db: D1Database,
	districtCode: string | null,
	county: string | null,
	geocodeSource: string,
	statusCode: number,
	responseMs: number,
): Promise<void> {
	try {
		await db
			.prepare(
				`INSERT INTO rrw_query_log (district_code, county, dimensions, response_ms, status_code, geocode_source)
				 VALUES (?, ?, '["flood"]', ?, ?, ?)`,
			)
			.bind(districtCode, county, responseMs, statusCode, geocodeSource)
			.run();
	} catch {
		// 日誌寫入失敗不影響主流程
	}
}

async function handleGetReport(id: string, _env: Env): Promise<Response> {
	// TODO: Phase 2 — 報告查詢
	return errorResponse(404, 'REPORT_NOT_FOUND', `報告 ${id} 不存在或已過期`);
}

// --- Router ---

type RouteHandler = (request: Request, env: Env) => Promise<Response>;

function matchRoute(method: string, path: string): RouteHandler | null {
	if (method === 'GET' && path === '/v1/health') {
		return (_req, env) => handleHealth(env);
	}
	if (method === 'GET' && path === '/v1/meta/versions') {
		return (_req, env) => handleMetaVersions(env);
	}
	if (method === 'POST' && path === '/v1/assess') {
		return handleAssess;
	}
	// GET /v1/assess/:id
	const reportMatch = path.match(/^\/v1\/assess\/([a-zA-Z0-9]+)$/);
	if (method === 'GET' && reportMatch) {
		return (_req, env) => handleGetReport(reportMatch[1], env);
	}
	return null;
}

export default {
	async fetch(request, env, _ctx): Promise<Response> {
		const url = new URL(request.url);
		const { pathname } = url;

		// CORS preflight
		if (request.method === 'OPTIONS') {
			return withCors(new Response(null, { status: 204 }), request);
		}

		// Root — 簡單導引
		if (pathname === '/' || pathname === '') {
			return withCors(
				jsonResponse({
					name: 'Residence Risk TW API',
					version: '0.1.0-dev',
					docs: '/v1/health',
					endpoints: {
						health: 'GET /v1/health',
						versions: 'GET /v1/meta/versions',
						assess: 'POST /v1/assess',
					},
				}),
				request,
			);
		}

		// Route matching
		const handler = matchRoute(request.method, pathname);
		if (!handler) {
			return withCors(errorResponse(404, 'NOT_FOUND', `${request.method} ${pathname} 不存在`), request);
		}

		try {
			const response = await handler(request, env);
			return withCors(response, request);
		} catch (err) {
			console.error('Unhandled error:', err);
			return withCors(errorResponse(500, 'INTERNAL_ERROR', '伺服器內部錯誤'), request);
		}
	},
} satisfies ExportedHandler<Env>;
