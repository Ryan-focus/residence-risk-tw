import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { normalizeAddress } from '../src/geocode';
import { assessEarthquake } from '../src/earthquake';
import { assessFlood } from '../src/flood';
import { pointInPolygon, pointInGeoJSON } from '../src/geo';

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

	it('returns reasoning array explaining the score', async () => {
		await seedFault({
			name: '車籠埔斷層',
			class_: 1,
			bboxMinLat: TEST_LAT - 0.002,
			bboxMinLng: TEST_LNG - 0.002,
			bboxMaxLat: TEST_LAT + 0.002,
			bboxMaxLng: TEST_LNG + 0.002,
			centerLat: TEST_LAT,
			centerLng: TEST_LNG,
		});
		const result = await assessEarthquake(env.DB, TEST_LAT, TEST_LNG);
		expect(result.reasoning).toBeInstanceOf(Array);
		expect(result.reasoning.length).toBeGreaterThan(0);
		expect(result.reasoning.join('\n')).toContain('車籠埔斷層');
		expect(result.reasoning.join('\n')).toContain('第一類');
	});
});

describe('earthquake history (Method A: nearest station)', () => {
	beforeEach(async () => {
		await env.DB.batch([
			env.DB.prepare('DELETE FROM rrw_earthquake_intensity'),
			env.DB.prepare('DELETE FROM rrw_earthquake_history'),
		]);
	});

	const ADDR_LAT = 23.70;
	const ADDR_LNG = 120.45;

	async function seedHistoryEvent(opts: {
		no: string;
		originTime: string;
		magnitude: number;
		depth: number;
		epiLat: number;
		epiLng: number;
		description?: string;
	}) {
		await env.DB.prepare(
			`INSERT INTO rrw_earthquake_history
			 (earthquake_no, origin_time, magnitude, depth_km, epicenter_lat, epicenter_lng,
			  location_description, source_url, data_version)
			 VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '2026-04')`,
		)
			.bind(opts.no, opts.originTime, opts.magnitude, opts.depth, opts.epiLat, opts.epiLng, opts.description ?? null)
			.run();
	}

	async function seedStation(opts: {
		no: string;
		name: string;
		lat: number;
		lng: number;
		intensity: string;
		pga?: number;
		county?: string;
	}) {
		await env.DB.prepare(
			`INSERT INTO rrw_earthquake_intensity
			 (earthquake_no, station_code, station_name, county, station_lat, station_lng, pga_gal, intensity_level)
			 VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(opts.no, opts.name, opts.county ?? null, opts.lat, opts.lng, opts.pga ?? null, opts.intensity)
			.run();
	}

	it('reports history.available=false when table is empty', async () => {
		const result = await assessEarthquake(env.DB, ADDR_LAT, ADDR_LNG);
		expect(result.history.available).toBe(false);
		expect(result.history.events).toEqual([]);
	});

	it('reports empty events when populated but no nearby earthquake', async () => {
		// 震央 >50km 外（東部外海）
		await seedHistoryEvent({
			no: 'EQ_FAR',
			originTime: new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString(),
			magnitude: 6.5,
			depth: 10,
			epiLat: 24.5,
			epiLng: 122.0, // 距本地 ~160km
		});
		const result = await assessEarthquake(env.DB, ADDR_LAT, ADDR_LNG);
		expect(result.history.available).toBe(true);
		expect(result.history.events).toEqual([]);
	});

	it('picks nearest station and exposes intensity when within 15 km', async () => {
		await seedHistoryEvent({
			no: 'EQ_NEAR',
			originTime: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
			magnitude: 6.0,
			depth: 15,
			epiLat: ADDR_LAT + 0.2,
			epiLng: ADDR_LNG + 0.2,
			description: '測試地震',
		});
		// 兩個站：近的 3 km 震度 5弱，遠的 20 km 震度 4
		await seedStation({
			no: 'EQ_NEAR',
			name: '近站',
			lat: ADDR_LAT + 0.025, // ~2.8 km 北
			lng: ADDR_LNG,
			intensity: '5弱',
			pga: 85.0,
			county: '雲林縣',
		});
		await seedStation({
			no: 'EQ_NEAR',
			name: '遠站',
			lat: ADDR_LAT + 0.18, // ~20 km 北
			lng: ADDR_LNG,
			intensity: '4',
			pga: 40.0,
		});

		const result = await assessEarthquake(env.DB, ADDR_LAT, ADDR_LNG);
		expect(result.history.events.length).toBe(1);
		const ev = result.history.events[0];
		expect(ev.earthquake_no).toBe('EQ_NEAR');
		expect(ev.magnitude).toBe(6.0);
		expect(ev.estimated_intensity).not.toBeNull();
		expect(ev.estimated_intensity!.level).toBe('5弱');
		expect(ev.estimated_intensity!.nearest_station.name).toBe('近站');
		expect(ev.estimated_intensity!.nearest_station.distance_km).toBeLessThan(5);
		expect(ev.estimated_intensity!.nearest_station.pga_gal).toBe(85.0);
	});

	it('returns null estimated_intensity when nearest station > 15 km', async () => {
		await seedHistoryEvent({
			no: 'EQ_NOST',
			originTime: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(),
			magnitude: 5.5,
			depth: 20,
			epiLat: ADDR_LAT + 0.1,
			epiLng: ADDR_LNG + 0.1,
		});
		// 只有一個遠站 (~30 km)
		await seedStation({
			no: 'EQ_NOST',
			name: '遠站',
			lat: ADDR_LAT + 0.27,
			lng: ADDR_LNG,
			intensity: '3',
		});

		const result = await assessEarthquake(env.DB, ADDR_LAT, ADDR_LNG);
		expect(result.history.events.length).toBe(1);
		expect(result.history.events[0].estimated_intensity).toBeNull();
	});

	it('excludes earthquakes older than 10 years', async () => {
		const oldTime = new Date();
		oldTime.setFullYear(oldTime.getFullYear() - 11);
		await seedHistoryEvent({
			no: 'EQ_OLD',
			originTime: oldTime.toISOString(),
			magnitude: 7.0,
			depth: 10,
			epiLat: ADDR_LAT + 0.05,
			epiLng: ADDR_LNG + 0.05,
		});
		const result = await assessEarthquake(env.DB, ADDR_LAT, ADDR_LNG);
		expect(result.history.available).toBe(true); // table has data
		expect(result.history.events).toEqual([]);
	});
});

describe('geo utilities', () => {
	it('pointInPolygon: inside simple square', () => {
		const square: [number, number][][] = [[
			[0, 0], [2, 0], [2, 2], [0, 2], [0, 0],
		]];
		expect(pointInPolygon(1, 1, square)).toBe(true);
		expect(pointInPolygon(3, 1, square)).toBe(false);
	});

	it('pointInPolygon: point inside donut hole is excluded', () => {
		const donut: [number, number][][] = [
			[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],      // outer
			[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],           // hole
		];
		expect(pointInPolygon(1, 1, donut)).toBe(true); // inside outer, not in hole
		expect(pointInPolygon(5, 5, donut)).toBe(false); // inside hole
	});

	it('pointInGeoJSON: elongated valley polygon excludes mountain bbox corner', () => {
		// 細長河谷 polygon (lng/lat)，bbox 是 0..10 × 0..10 的大方形
		// 但 polygon 只佔沿對角線的細帶
		const valley = JSON.stringify({
			type: 'Polygon',
			coordinates: [[
				[0, 0], [10, 10], [10.5, 9.5], [0.5, -0.5], [0, 0],
			]],
		});
		// bbox 左上角（山）— 在 bbox 內但不在 polygon 內
		expect(pointInGeoJSON(9.9, 0.1, valley)).toBe(false);
		// polygon 中心
		expect(pointInGeoJSON(5, 5, valley)).toBe(true);
	});

	it('pointInGeoJSON: MultiPolygon with two disjoint regions', () => {
		const mp = JSON.stringify({
			type: 'MultiPolygon',
			coordinates: [
				[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
				[[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
			],
		});
		expect(pointInGeoJSON(0.5, 0.5, mp)).toBe(true);
		expect(pointInGeoJSON(5.5, 5.5, mp)).toBe(true);
		expect(pointInGeoJSON(3, 3, mp)).toBe(false); // gap between regions
	});

	it('pointInGeoJSON: returns false on invalid / empty input', () => {
		expect(pointInGeoJSON(0, 0, null)).toBe(false);
		expect(pointInGeoJSON(0, 0, '')).toBe(false);
		expect(pointInGeoJSON(0, 0, '{not json')).toBe(false);
		expect(pointInGeoJSON(0, 0, '{"type":"Point","coordinates":[0,0]}')).toBe(false);
	});
});

describe('assessFlood insideness (bbox + geojson)', () => {
	beforeEach(async () => {
		await env.DB.prepare('DELETE FROM rrw_flood_zones').run();
	});

	async function seedFloodZone(opts: {
		bboxMinLat: number; bboxMinLng: number; bboxMaxLat: number; bboxMaxLng: number;
		centerLat: number; centerLng: number;
		geojson?: string | null;
		rainfall?: number; depth?: string;
	}) {
		await env.DB.prepare(
			`INSERT INTO rrw_flood_zones
			 (rainfall_scenario, duration_hours, rainfall_mm, depth_class, county,
			  bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng,
			  center_lat, center_lng, geojson, data_version)
			 VALUES (?, 24, ?, ?, '全台', ?, ?, ?, ?, ?, ?, ?, '2026-04')`,
		)
			.bind(
				`24h_${opts.rainfall ?? 350}mm`,
				opts.rainfall ?? 350,
				opts.depth ?? '0-50cm',
				opts.bboxMinLat, opts.bboxMinLng, opts.bboxMaxLat, opts.bboxMaxLng,
				opts.centerLat, opts.centerLng,
				opts.geojson ?? null,
			)
			.run();
	}

	it('returns "safe" reasoning when no zones', async () => {
		const result = await assessFlood(env.DB, 23.5, 120.5);
		expect(result.score).toBe(5);
		expect(result.reasoning.join('\n')).toContain('極低');
	});

	it('mountain bbox corner is NOT flagged as inside when geojson is set', async () => {
		// 直角三角形淹水區：P1(120.45,23.70) P2(120.50,23.70) P3(120.50,23.75)
		// 斜邊為 lat=23.70+(lng-120.45) — bbox 內 lat 大於此線的為 polygon 外（山上）
		const triGeoJSON = JSON.stringify({
			type: 'Polygon',
			coordinates: [[
				[120.45, 23.70], [120.50, 23.70], [120.50, 23.75], [120.45, 23.70],
			]],
		});
		await seedFloodZone({
			bboxMinLat: 23.70, bboxMinLng: 120.45, bboxMaxLat: 23.75, bboxMaxLng: 120.50,
			centerLat: 23.72, centerLng: 120.48, // 在三角形內
			geojson: triGeoJSON,
			rainfall: 350, depth: '>50cm',
		});

		// 山點：bbox 左上角，在 bbox 內但斜邊之上 → polygon 外
		const mountain = await assessFlood(env.DB, 23.749, 120.451);
		const inside = mountain.risks.find((r) => r.distance_m === null);
		expect(inside).toBeUndefined();
		expect(mountain.score).toBeLessThan(95);

		// 淹水區中心（三角形內）：應被判為 inside
		const flood = await assessFlood(env.DB, 23.72, 120.48);
		const floodInside = flood.risks.find((r) => r.distance_m === null);
		expect(floodInside).toBeDefined();
		expect(flood.score).toBe(95); // 350mm + >50cm inside → 95
	});

	it('fallback (no geojson): small bbox trusts bbox', async () => {
		// 小 polygon bbox 對角 ~150m → 信任 bbox
		await seedFloodZone({
			bboxMinLat: 23.7000, bboxMinLng: 120.4500, bboxMaxLat: 23.7010, bboxMaxLng: 120.4510,
			centerLat: 23.7005, centerLng: 120.4505,
			geojson: null,
			rainfall: 350, depth: '>50cm',
		});
		// bbox 角落也應被判 inside（小 polygon ≈ bbox）
		const corner = await assessFlood(env.DB, 23.7001, 120.4501);
		expect(corner.risks.find((r) => r.distance_m === null)).toBeDefined();
		// bbox 外則否
		const outside = await assessFlood(env.DB, 23.712, 120.462);
		expect(outside.risks.find((r) => r.distance_m === null)).toBeUndefined();
	});

	it('fallback (no geojson): huge bbox requires <500m from centroid', async () => {
		// 大 polygon（對角 >6km）→ 嚴格限制 500m
		await seedFloodZone({
			bboxMinLat: 23.70, bboxMinLng: 120.45, bboxMaxLat: 23.75, bboxMaxLng: 120.50,
			centerLat: 23.725, centerLng: 120.475,
			geojson: null,
			rainfall: 350, depth: '>50cm',
		});
		// bbox 對角 ~6.8km，centroid ~50m → inside
		const near = await assessFlood(env.DB, 23.7254, 120.4754);
		expect(near.risks.find((r) => r.distance_m === null)).toBeDefined();
		// bbox 左上角距 centroid >2km → NOT inside（避免山區誤收）
		const corner = await assessFlood(env.DB, 23.749, 120.451);
		expect(corner.risks.find((r) => r.distance_m === null)).toBeUndefined();
	});
});
