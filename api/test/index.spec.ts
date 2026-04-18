import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { normalizeAddress } from '../src/geocode';
import { assessEarthquake } from '../src/earthquake';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Residence Risk API', () => {
	describe('GET /', () => {
		it('returns API info', async () => {
			const request = new IncomingRequest('http://example.com/');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			const body = await response.json<{ name: string; version: string }>();
			expect(body.name).toBe('Residence Risk TW API');
			expect(body.version).toBeDefined();
		});
	});

	describe('GET /v1/health', () => {
		it('returns health status with database check', async () => {
			const response = await SELF.fetch('https://example.com/v1/health');
			const body = await response.json<{ status: string; database: string }>();
			expect(response.status).toBe(200);
			expect(body.status).toBe('ok');
			expect(body.database).toBe('connected');
		});
	});

	describe('GET /v1/meta/versions', () => {
		it('returns data source versions (empty initially)', async () => {
			const response = await SELF.fetch('https://example.com/v1/meta/versions');
			const body = await response.json<{ data_sources: unknown[]; total: number }>();
			expect(response.status).toBe(200);
			expect(body.data_sources).toEqual([]);
			expect(body.total).toBe(0);
		});
	});

	describe('normalizeAddress', () => {
		it('converts 臺 to 台', () => {
			expect(normalizeAddress('臺北市')).toBe('台北市');
		});

		it('converts fullwidth digits', () => {
			expect(normalizeAddress('１２３號')).toBe('123號');
		});

		it('trims whitespace', () => {
			expect(normalizeAddress('  台北市  信義區  ')).toBe('台北市信義區');
		});
	});

	describe('POST /v1/assess', () => {
		it('returns 400 for missing address', async () => {
			const response = await SELF.fetch('https://example.com/v1/assess', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			expect(response.status).toBe(400);
		});

		it('returns 400 for invalid JSON', async () => {
			const response = await SELF.fetch('https://example.com/v1/assess', {
				method: 'POST',
				body: 'not json',
			});
			expect(response.status).toBe(400);
		});
	});

	describe('GET /v1/assess/:id', () => {
		it('returns 404 for non-existent report', async () => {
			const response = await SELF.fetch('https://example.com/v1/assess/nonexistent123');
			const body = await response.json<{ code: string }>();
			expect(response.status).toBe(404);
			expect(body.code).toBe('REPORT_NOT_FOUND');
		});
	});

	describe('404 handling', () => {
		it('returns 404 for unknown routes', async () => {
			const response = await SELF.fetch('https://example.com/unknown');
			expect(response.status).toBe(404);
		});
	});

	describe('GET /v1/openapi.json', () => {
		it('returns an OpenAPI 3.1 document', async () => {
			const response = await SELF.fetch('https://example.com/v1/openapi.json');
			expect(response.status).toBe(200);
			const body = await response.json<{ openapi: string; paths: Record<string, unknown> }>();
			expect(body.openapi).toBe('3.1.0');
			expect(body.paths['/v1/assess']).toBeDefined();
			expect(response.headers.get('Cache-Control')).toMatch(/public/);
		});
	});

	describe('GET /.well-known/ai-plugin.json', () => {
		it('returns the plugin manifest', async () => {
			const response = await SELF.fetch('https://example.com/.well-known/ai-plugin.json');
			expect(response.status).toBe(200);
			const body = await response.json<{ name_for_model: string; api: { url: string } }>();
			expect(body.name_for_model).toBe('residence_risk_tw');
			expect(body.api.url).toContain('/v1/openapi.json');
		});
	});

	describe('GET /llms.txt', () => {
		it('returns a plain text index', async () => {
			const response = await SELF.fetch('https://example.com/llms.txt');
			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Type')).toMatch(/text\/plain/);
			const body = await response.text();
			expect(body).toContain('Residence Risk TW');
		});
	});

	describe('POST /mcp', () => {
		it('responds to initialize', async () => {
			const response = await SELF.fetch('https://example.com/mcp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
			});
			expect(response.status).toBe(200);
			const body = await response.json<{ result: { protocolVersion: string; serverInfo: { name: string } } }>();
			expect(body.result.serverInfo.name).toBe('residence-risk-tw');
			expect(body.result.protocolVersion).toBeTruthy();
		});

		it('lists the assess_residence_risk tool', async () => {
			const response = await SELF.fetch('https://example.com/mcp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
			});
			expect(response.status).toBe(200);
			const body = await response.json<{ result: { tools: { name: string }[] } }>();
			expect(body.result.tools[0].name).toBe('assess_residence_risk');
		});

		it('returns -32601 for unknown methods', async () => {
			const response = await SELF.fetch('https://example.com/mcp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'does/not/exist' }),
			});
			expect(response.status).toBe(200);
			const body = await response.json<{ error: { code: number } }>();
			expect(body.error.code).toBe(-32601);
		});
	});
});

describe('assessEarthquake', () => {
	beforeEach(async () => {
		await env.DB.batch([
			env.DB.prepare('DELETE FROM rrw_fault_zones'),
			env.DB.prepare('DELETE FROM rrw_liquefaction_zones'),
		]);
	});

	// 以虎尾鎮附近座標做為測試基準
	const TEST_LAT = 23.7;
	const TEST_LNG = 120.45;

	async function seedFault(
		opts: {
			name: string;
			class_: 1 | 2;
			bboxMinLat: number;
			bboxMinLng: number;
			bboxMaxLat: number;
			bboxMaxLng: number;
			centerLat: number;
			centerLng: number;
		},
	): Promise<void> {
		await env.DB.prepare(
			`INSERT INTO rrw_fault_zones
			 (fault_name, fault_class, county, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng,
			  center_lat, center_lng, data_version)
			 VALUES (?, ?, '全台', ?, ?, ?, ?, ?, ?, '2026-04')`,
		)
			.bind(
				opts.name,
				opts.class_,
				opts.bboxMinLat,
				opts.bboxMinLng,
				opts.bboxMaxLat,
				opts.bboxMaxLng,
				opts.centerLat,
				opts.centerLng,
			)
			.run();
	}

	async function seedLiquefaction(
		opts: {
			level: '高' | '中' | '低';
			bboxMinLat: number;
			bboxMinLng: number;
			bboxMaxLat: number;
			bboxMaxLng: number;
			centerLat: number;
			centerLng: number;
		},
	): Promise<void> {
		await env.DB.prepare(
			`INSERT INTO rrw_liquefaction_zones
			 (level, county, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng,
			  center_lat, center_lng, data_version)
			 VALUES (?, '雲林縣', ?, ?, ?, ?, ?, ?, '2026-04')`,
		)
			.bind(
				opts.level,
				opts.bboxMinLat,
				opts.bboxMinLng,
				opts.bboxMaxLat,
				opts.bboxMaxLng,
				opts.centerLat,
				opts.centerLng,
			)
			.run();
	}

	it('returns minimal risk when no data exists', async () => {
		const result = await assessEarthquake(env.DB, TEST_LAT, TEST_LNG);
		expect(result.score).toBe(5);
		expect(result.level).toBe('極低');
		expect(result.fault.risks).toEqual([]);
		expect(result.liquefaction.risks).toEqual([]);
		expect(result.liquefaction.has_data).toBe(false);
	});

	it('scores 90 when point is inside a class 1 fault zone (no liq data)', async () => {
		await seedFault({
			name: '車籠埤斷層',
			class_: 1,
			bboxMinLat: TEST_LAT - 0.005,
			bboxMinLng: TEST_LNG - 0.005,
			bboxMaxLat: TEST_LAT + 0.005,
			bboxMaxLng: TEST_LNG + 0.005,
			centerLat: TEST_LAT,
			centerLng: TEST_LNG,
		});
		const result = await assessEarthquake(env.DB, TEST_LAT, TEST_LNG);
		expect(result.fault.score).toBe(90);
		expect(result.score).toBe(90); // 無液化資料 → 等同斷層分數
		expect(result.level).toBe('極高');
		expect(result.fault.risks[0].fault_name).toBe('車籠埤斷層');
		expect(result.fault.risks[0].distance_m).toBeNull();
	});

	it('combines fault 60% + liquefaction 40% when both present', async () => {
		// class 1 內部 → fault 90
		await seedFault({
			name: '斷層A',
			class_: 1,
			bboxMinLat: TEST_LAT - 0.002,
			bboxMinLng: TEST_LNG - 0.002,
			bboxMaxLat: TEST_LAT + 0.002,
			bboxMaxLng: TEST_LNG + 0.002,
			centerLat: TEST_LAT,
			centerLng: TEST_LNG,
		});
		// 高液化區內 → liq 80
		await seedLiquefaction({
			level: '高',
			bboxMinLat: TEST_LAT - 0.002,
			bboxMinLng: TEST_LNG - 0.002,
			bboxMaxLat: TEST_LAT + 0.002,
			bboxMaxLng: TEST_LNG + 0.002,
			centerLat: TEST_LAT,
			centerLng: TEST_LNG,
		});

		const result = await assessEarthquake(env.DB, TEST_LAT, TEST_LNG);
		expect(result.fault.score).toBe(90);
		expect(result.liquefaction.score).toBe(80);
		expect(result.liquefaction.has_data).toBe(true);
		// 0.6 * 90 + 0.4 * 80 = 86
		expect(result.score).toBe(86);
		expect(result.level).toBe('極高');
	});

	it('assigns lower score at ~300m distance from class 2 fault', async () => {
		// 0.003 度 ≈ 330m，bbox 放遠一點讓點在外面
		await seedFault({
			name: '遠方斷層',
			class_: 2,
			bboxMinLat: TEST_LAT + 0.002,
			bboxMinLng: TEST_LNG + 0.002,
			bboxMaxLat: TEST_LAT + 0.004,
			bboxMaxLng: TEST_LNG + 0.004,
			centerLat: TEST_LAT + 0.003,
			centerLng: TEST_LNG + 0.003,
		});
		const result = await assessEarthquake(env.DB, TEST_LAT, TEST_LNG);
		// 距離約 450m → 第二類、< 500m → 分數 25
		expect(result.fault.risks[0].distance_m).toBeGreaterThan(0);
		expect(result.fault.risks[0].distance_m).toBeLessThan(600);
		expect(result.fault.score).toBe(25);
	});
});
