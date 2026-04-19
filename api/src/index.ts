/**
 * Residence Risk TW — API Worker
 * Cloudflare Workers + D1
 */

import { geocode, normalizeAddress } from './geocode';
import { assessFlood } from './flood';
import { assessEarthquake } from './earthquake';
import { buildOpenApiSpec, API_VERSION } from './openapi';
import { handleMcp } from './mcp';
import { refreshCwbEarthquakeHistory } from './cwb-refresh';

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

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...extraHeaders },
	});
}

// CORS (SA §8.4) — env-aware: ALLOWED_ORIGINS env var is comma-separated
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:8787'];

// Agent/LLM/discovery paths we allow from any origin. These are non-mutating,
// public, cacheable documents meant for tool discovery by agents.
const PUBLIC_DISCOVERY_PATHS = new Set([
	'/',
	'/v1/openapi.json',
	'/v1/health',
	'/v1/meta/versions',
	'/.well-known/ai-plugin.json',
	'/.well-known/mcp.json',
	'/llms.txt',
]);

function getAllowedOrigins(env: Env): string[] {
	const extra = (env as unknown as Record<string, unknown>).ALLOWED_ORIGINS;
	if (typeof extra === 'string' && extra.length > 0) {
		return [...DEV_ORIGINS, ...extra.split(',').map((s) => s.trim())];
	}
	return DEV_ORIGINS;
}

function corsHeaders(request: Request, env: Env, pathname: string): Record<string, string> {
	const origin = request.headers.get('Origin') || '';
	const origins = getAllowedOrigins(env);
	const publicDiscovery = PUBLIC_DISCOVERY_PATHS.has(pathname) || pathname === '/mcp';
	const allowed = origins.includes(origin) ? origin : publicDiscovery ? '*' : '';
	const headers: Record<string, string> = {
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
	};
	if (allowed) {
		headers['Access-Control-Allow-Origin'] = allowed;
		if (allowed !== '*') {
			headers['Vary'] = 'Origin';
		}
	}
	return headers;
}

// Security headers
const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

function withCors(response: Response, request: Request, env: Env, pathname: string): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(corsHeaders(request, env, pathname))) {
		headers.set(key, value);
	}
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
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
		return jsonResponse(
			{
				status: 'ok',
				database: result?.ok === 1 ? 'connected' : 'error',
				timestamp: new Date().toISOString(),
			},
			200,
			{ 'Cache-Control': 'public, max-age=10, s-maxage=30' },
		);
	} catch {
		return jsonResponse(
			{
				status: 'degraded',
				database: 'error',
				timestamp: new Date().toISOString(),
			},
			503,
			{ 'Cache-Control': 'no-store' },
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

		return jsonResponse(
			{
				data_sources: results,
				total: results.length,
			},
			200,
			{ 'Cache-Control': 'public, max-age=300, s-maxage=3600' },
		);
	} catch {
		return errorResponse(500, 'INTERNAL_ERROR', '無法取得資料版本資訊');
	}
}

function handleOpenApi(request: Request): Response {
	return jsonResponse(buildOpenApiSpec(new URL(request.url)), 200, {
		'Cache-Control': 'public, max-age=3600, s-maxage=86400',
	});
}

function handleAiPlugin(request: Request): Response {
	const origin = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
	return jsonResponse(
		{
			schema_version: 'v1',
			name_for_human: 'Residence Risk TW',
			name_for_model: 'residence_risk_tw',
			description_for_human: '輸入台灣地址，免費查詢淹水與地震風險。',
			description_for_model:
				'Assess flood and earthquake risk for Taiwanese addresses using Taiwan government open data. Returns 0-100 score per hazard. Not for legal/insurance/real-estate decisions.',
			auth: { type: 'none' },
			api: { type: 'openapi', url: `${origin}/v1/openapi.json` },
			contact_email: 'noreply@residence-risk-web.pages.dev',
			legal_info_url: 'https://github.com/Ryan-focus/residence-risk-tw/blob/main/LICENSE',
		},
		200,
		{ 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
	);
}

function handleMcpDescriptor(request: Request): Response {
	const origin = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
	return jsonResponse(
		{
			name: 'residence-risk-tw',
			description: 'Flood and earthquake risk assessment for Taiwan addresses.',
			transport: 'streamable-http',
			url: `${origin}/mcp`,
			protocolVersion: '2025-03-26',
		},
		200,
		{ 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
	);
}

function handleLlmsTxt(request: Request): Response {
	const origin = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
	const body = `# Residence Risk TW API

> Taiwan residence flood & earthquake risk assessment API. Free, open-source, powered by Taiwan government open data. For disaster-preparedness reference only.

## Endpoints
- ${origin}/v1/assess (POST, body: {"address":"..."})
- ${origin}/v1/health (GET)
- ${origin}/v1/meta/versions (GET)
- ${origin}/v1/openapi.json (GET, OpenAPI 3.1)
- ${origin}/mcp (POST, JSON-RPC 2.0 MCP)

## Plugin manifests
- ${origin}/.well-known/ai-plugin.json
- ${origin}/.well-known/mcp.json

## Source
- https://github.com/Ryan-focus/residence-risk-tw
`;
	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600, s-maxage=86400',
		},
	});
}

const MAX_BODY_BYTES = 4096;
const MAX_ADDRESS_LENGTH = 200;

async function handleAssess(request: Request, env: Env): Promise<Response> {
	const start = Date.now();

	// Guard: reject oversized bodies
	const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
	if (contentLength > MAX_BODY_BYTES) {
		return errorResponse(413, 'PAYLOAD_TOO_LARGE', '請求內容過大');
	}

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

	if (address.length > MAX_ADDRESS_LENGTH) {
		return errorResponse(400, 'INVALID_ADDRESS', `地址長度不可超過 ${MAX_ADDRESS_LENGTH} 字`);
	}

	// 1. 地理編碼
	const location = await geocode(env.DB, address, env.MAP8_API_KEY ?? '');
	if (!location) {
		await logQuery(env.DB, null, null, 'none', 404, Date.now() - start);
		return errorResponse(404, 'ADDRESS_NOT_FOUND', '無法將地址轉換為座標，請確認地址是否正確');
	}

	// 2. 風險評估（flood + earthquake 並行）
	const [flood, earthquake] = await Promise.all([
		assessFlood(env.DB, location.lat, location.lng),
		assessEarthquake(env.DB, location.lat, location.lng),
	]);

	const elapsed = Date.now() - start;
	await logQuery(env.DB, null, null, location.source, 200, elapsed);

	return jsonResponse(
		{
			address: normalizeAddress(address),
			location: {
				lat: location.lat,
				lng: location.lng,
				source: location.source,
				display_name: location.display_name,
			},
			flood,
			earthquake,
			meta: {
				response_ms: elapsed,
				api_version: API_VERSION,
			},
			disclaimer: '本工具使用政府公開資料，僅供防災參考，不構成任何土地使用或交易決策依據。',
		},
		200,
		{ 'Cache-Control': 'private, no-store' },
	);
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

type RouteHandler = (request: Request, env: Env) => Promise<Response> | Response;

function matchRoute(method: string, path: string): RouteHandler | null {
	if (method === 'GET' && path === '/v1/health') {
		return (_req, env) => handleHealth(env);
	}
	if (method === 'GET' && path === '/v1/meta/versions') {
		return (_req, env) => handleMetaVersions(env);
	}
	if (method === 'GET' && path === '/v1/openapi.json') {
		return (req) => handleOpenApi(req);
	}
	if (method === 'GET' && path === '/.well-known/ai-plugin.json') {
		return (req) => handleAiPlugin(req);
	}
	if (method === 'GET' && path === '/.well-known/mcp.json') {
		return (req) => handleMcpDescriptor(req);
	}
	if (method === 'GET' && path === '/llms.txt') {
		return (req) => handleLlmsTxt(req);
	}
	if ((method === 'GET' || method === 'POST') && path === '/mcp') {
		return (req, env) => handleMcp(req, env);
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
			return withCors(new Response(null, { status: 204 }), request, env, pathname);
		}

		// Root — 簡單導引
		if (pathname === '/' || pathname === '') {
			const origin = `${url.protocol}//${url.host}`;
			return withCors(
				jsonResponse(
					{
						name: 'Residence Risk TW API',
						version: API_VERSION,
						docs: `${origin}/v1/openapi.json`,
						endpoints: {
							health: 'GET /v1/health',
							versions: 'GET /v1/meta/versions',
							assess: 'POST /v1/assess',
							openapi: 'GET /v1/openapi.json',
							mcp: 'POST /mcp (JSON-RPC 2.0)',
							ai_plugin: 'GET /.well-known/ai-plugin.json',
						},
					},
					200,
					{ 'Cache-Control': 'public, max-age=300, s-maxage=3600' },
				),
				request,
				env,
				pathname,
			);
		}

		// Route matching
		const handler = matchRoute(request.method, pathname);
		if (!handler) {
			return withCors(errorResponse(404, 'NOT_FOUND', `${request.method} ${pathname} 不存在`), request, env, pathname);
		}

		try {
			const response = await handler(request, env);
			return withCors(response, request, env, pathname);
		} catch (err) {
			console.error('Unhandled error:', err);
			return withCors(errorResponse(500, 'INTERNAL_ERROR', '伺服器內部錯誤'), request, env, pathname);
		}
	},

	async scheduled(_event, env, _ctx): Promise<void> {
		const apiKey = (env as unknown as Record<string, string>).CWB_API_KEY ?? '';
		if (!apiKey) {
			console.error('[cron] CWB_API_KEY not set — skipping earthquake history refresh');
			return;
		}
		try {
			const result = await refreshCwbEarthquakeHistory(env.DB, apiKey);
			console.log(`[cron] CWB refresh done: upserted=${result.upserted} skipped=${result.skipped}`);
		} catch (err) {
			console.error('[cron] CWB refresh failed:', err);
		}
	},
} satisfies ExportedHandler<Env>;
