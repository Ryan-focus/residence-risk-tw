/**
 * Minimal Model Context Protocol (MCP) JSON-RPC 2.0 endpoint.
 *
 * Exposes the residence risk assessment as a single tool:
 *   assess_residence_risk({ address: string })
 *
 * This is a stateless HTTP transport — clients POST JSON-RPC requests to /mcp
 * (no SSE, no session management). Works with Claude Desktop's `mcp-remote`
 * bridge and any MCP client that supports the streamable-HTTP transport.
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-03-26
 */

import { geocode, normalizeAddress } from './geocode';
import { assessFlood } from './flood';
import { assessEarthquake } from './earthquake';
import { API_VERSION } from './openapi';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'residence-risk-tw';

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null | undefined, result: unknown) {
	return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: string | number | null | undefined, code: number, message: string, data?: unknown) {
	return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

const ASSESS_TOOL = {
	name: 'assess_residence_risk',
	description:
		'Assess flood (24h 350/500/650mm rainfall scenarios) and earthquake (active fault + soil liquefaction) risk for a Taiwanese address. Returns a 0-100 score per hazard with level, color, scenario breakdown, and geocoded location. Input must be a traditional-Chinese Taiwan address. For reference only — not a legal, insurance, or real-estate decision aid.',
	inputSchema: {
		type: 'object',
		properties: {
			address: {
				type: 'string',
				description: '繁體中文台灣地址（含縣市、區、路、號）。',
				maxLength: 200,
			},
		},
		required: ['address'],
	},
};

async function runAssess(env: Env, address: string) {
	const trimmed = address?.trim();
	if (!trimmed) {
		throw new Error('address is required');
	}
	if (trimmed.length > 200) {
		throw new Error('address too long (max 200 chars)');
	}

	const location = await geocode(env.DB, trimmed, env.MAP8_API_KEY ?? '');
	if (!location) {
		throw new Error('ADDRESS_NOT_FOUND: 無法將地址轉換為座標');
	}

	const [flood, earthquake] = await Promise.all([
		assessFlood(env.DB, location.lat, location.lng),
		assessEarthquake(env.DB, location.lat, location.lng),
	]);

	return {
		address: normalizeAddress(trimmed),
		location: {
			lat: location.lat,
			lng: location.lng,
			source: location.source,
			display_name: location.display_name,
		},
		flood,
		earthquake,
		api_version: API_VERSION,
		disclaimer: '本工具使用政府公開資料，僅供防災參考，不構成任何土地使用或交易決策依據。',
	};
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
	if (request.method === 'GET') {
		// A friendly discovery response so curl /mcp doesn't 404.
		return new Response(
			JSON.stringify({
				server: SERVER_NAME,
				protocol: PROTOCOL_VERSION,
				transport: 'streamable-http (POST JSON-RPC)',
				tools: [ASSESS_TOOL.name],
				docs: 'https://modelcontextprotocol.io/',
			}),
			{ headers: { 'Content-Type': 'application/json' } },
		);
	}

	if (request.method !== 'POST') {
		return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });
	}

	let req: JsonRpcRequest;
	try {
		req = (await request.json()) as JsonRpcRequest;
	} catch {
		return json(rpcError(null, -32700, 'Parse error'), 400);
	}

	if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
		return json(rpcError(req.id, -32600, 'Invalid Request'));
	}

	try {
		switch (req.method) {
			case 'initialize':
				return json(
					rpcResult(req.id, {
						protocolVersion: PROTOCOL_VERSION,
						capabilities: { tools: { listChanged: false } },
						serverInfo: { name: SERVER_NAME, version: API_VERSION },
					}),
				);

			case 'notifications/initialized':
			case 'notifications/cancelled':
				// No response for notifications.
				return new Response(null, { status: 204 });

			case 'ping':
				return json(rpcResult(req.id, {}));

			case 'tools/list':
				return json(rpcResult(req.id, { tools: [ASSESS_TOOL] }));

			case 'tools/call': {
				const params = req.params ?? {};
				const name = params.name as string | undefined;
				const args = (params.arguments ?? {}) as Record<string, unknown>;
				if (name !== ASSESS_TOOL.name) {
					return json(rpcError(req.id, -32601, `Unknown tool: ${name}`));
				}
				try {
					const result = await runAssess(env, args.address as string);
					return json(
						rpcResult(req.id, {
							content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
							structuredContent: result,
							isError: false,
						}),
					);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return json(
						rpcResult(req.id, {
							content: [{ type: 'text', text: message }],
							isError: true,
						}),
					);
				}
			}

			default:
				return json(rpcError(req.id, -32601, `Method not found: ${req.method}`));
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Internal error';
		return json(rpcError(req.id, -32603, message));
	}
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
