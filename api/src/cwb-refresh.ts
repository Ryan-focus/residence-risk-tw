/**
 * CWB E-A0015 地震歷史資料自動刷新
 *
 * 供 Cloudflare Cron Trigger 呼叫：每月抓最新 200 筆顯著有感地震，
 * upsert 到 rrw_earthquake_history + rrw_earthquake_intensity。
 *
 * 資料來源：中央氣象署 E-A0015-001（顯著有感地震報告）
 * API 文件：https://opendata.cwa.gov.tw/dist/opendata-swagger.html
 */

const CWB_API_URL = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0015-001';
const FETCH_LIMIT = 1000;
const D1_BATCH_SIZE = 40; // 每批 D1 statements 數（每筆地震約 10~30 個 statements）

// ── helpers ─────────────────────────────────────────────────────────────────

export function pick<T>(obj: Record<string, unknown>, ...keys: string[]): T | null {
	for (const k of keys) {
		if (k in obj && obj[k] != null) return obj[k] as T;
	}
	return null;
}

export function parseOriginTime(s: string | null | undefined): string | null {
	if (!s) return null;
	try {
		const normalized = s.replace(/\//g, '-');
		// CWB 回傳台北時間（UTC+8），無 timezone 標記
		const dt = new Date(normalized.includes('+') || normalized.includes('Z') ? normalized : normalized + '+08:00');
		if (isNaN(dt.getTime())) return s;
		return dt.toISOString();
	} catch {
		return s;
	}
}

export function iterEvents(resp: unknown): unknown[] {
	if (!resp || typeof resp !== 'object') return [];
	const r = resp as Record<string, unknown>;
	const records = (r.records ?? r) as Record<string, unknown>;
	const eq = pick<unknown[]>(records, 'Earthquake', 'earthquake') ?? [];
	if (Array.isArray(eq)) return eq;
	if (typeof eq === 'object') return [eq];
	return [];
}

interface StationEntry {
	intensityLevel: string;
	stationCode: string | null;
	stationName: string | null;
	county: string | null;
	lat: number | null;
	lng: number | null;
	pga: number | null;
}

function stationPga(st: Record<string, unknown>): number | null {
	const pga = pick<unknown>(st, 'pga', 'PGA');
	if (pga == null) return null;
	if (typeof pga === 'number') return pga;
	if (typeof pga === 'object') {
		const p = pga as Record<string, unknown>;
		const ew = pick<number>(p, 'EWComponent', 'ewComponent');
		const ns = pick<number>(p, 'NSComponent', 'nsComponent');
		const vals = [ew, ns].filter((v): v is number => typeof v === 'number');
		if (vals.length) return Math.max(...vals);
		const iv = pick<number>(p, 'IntScaleValue');
		if (typeof iv === 'number') return iv;
	}
	return null;
}

export function iterStations(event: Record<string, unknown>): StationEntry[] {
	let intensity = pick<Record<string, unknown>>(event, 'Intensity');
	if (!intensity) {
		const info = (pick<Record<string, unknown>>(event, 'EarthquakeInfo') ?? {}) as Record<string, unknown>;
		intensity = pick<Record<string, unknown>>(info, 'Intensity');
	}
	if (!intensity) return [];

	const areas = pick<unknown[]>(intensity, 'ShakingArea', 'shakingArea') ?? [];
	const stations: StationEntry[] = [];

	for (const area of areas) {
		const a = area as Record<string, unknown>;
		let level = pick<string>(a, 'AreaIntensity', 'areaIntensity') ?? null;
		if (!level) {
			const desc = (pick<string>(a, 'AreaDesc', 'areaDesc') ?? '') as string;
			const m = desc.match(/震度\s*([0-9]+\s*[強弱]?)/);
			if (m) level = m[1];
		}
		if (!level) continue;

		const sts = pick<unknown[]>(a, 'EqStation', 'eqStation') ?? [];
		for (const st of sts) {
			const s = st as Record<string, unknown>;
			const stIntensity = pick<string>(s, 'SeismicIntensity', 'seismicIntensity') ?? level;
			stations.push({
				intensityLevel: stIntensity,
				stationCode: pick<string>(s, 'StationID', 'stationID', 'StationCode'),
				stationName: pick<string>(s, 'StationName', 'stationName'),
				county: pick<string>(s, 'StationCounty', 'stationCounty'),
				lat: pick<number>(s, 'StationLatitude', 'stationLatitude'),
				lng: pick<number>(s, 'StationLongitude', 'stationLongitude'),
				pga: stationPga(s),
			});
		}
	}
	return stations;
}

// ── main export ──────────────────────────────────────────────────────────────

export async function refreshCwbEarthquakeHistory(db: D1Database, apiKey: string): Promise<{ upserted: number; skipped: number }> {
	const url = `${CWB_API_URL}?Authorization=${encodeURIComponent(apiKey)}&limit=${FETCH_LIMIT}&format=JSON`;
	const resp = await fetch(url, { headers: { 'User-Agent': 'ResidenceRiskTW/0.2 cron-refresh' } });
	if (!resp.ok) throw new Error(`CWB API error: ${resp.status} ${resp.statusText}`);

	const data = await resp.json() as unknown;
	const events = iterEvents(data);
	const dataVersion = new Date().toISOString().slice(0, 7); // YYYY-MM

	let upserted = 0;
	let skipped = 0;
	const batch: D1PreparedStatement[] = [];

	const flush = async () => {
		if (batch.length === 0) return;
		await db.batch([...batch]);
		batch.length = 0;
	};

	for (const ev of events) {
		const e = ev as Record<string, unknown>;
		const info = (pick<Record<string, unknown>>(e, 'EarthquakeInfo', 'earthquakeInfo') ?? {}) as Record<string, unknown>;
		const epi = (pick<Record<string, unknown>>(info, 'Epicenter', 'epicenter') ?? {}) as Record<string, unknown>;
		const mag = (pick<Record<string, unknown>>(info, 'EarthquakeMagnitude', 'earthquakeMagnitude') ?? {}) as Record<string, unknown>;

		const eqNo = String(pick<unknown>(e, 'EarthquakeNo', 'earthquakeNo') ?? '');
		if (!eqNo) { skipped++; continue; }

		const originTime = parseOriginTime(pick<string>(info, 'OriginTime', 'originTime'));
		const depth = pick<number>(info, 'FocalDepth', 'focalDepth');
		const magnitude = pick<number>(mag, 'MagnitudeValue', 'magnitudeValue');
		const lat = pick<number>(epi, 'EpicenterLatitude', 'epicenterLatitude');
		const lng = pick<number>(epi, 'EpicenterLongitude', 'epicenterLongitude');
		const location = pick<string>(epi, 'Location', 'location');
		const sourceUrl = pick<string>(e, 'ReportImageURI', 'Web', 'reportImageURI', 'reportURI');

		if (!originTime || lat == null || lng == null || magnitude == null) { skipped++; continue; }

		batch.push(
			db.prepare(
				`INSERT OR REPLACE INTO rrw_earthquake_history
				 (earthquake_no, origin_time, magnitude, depth_km, epicenter_lat, epicenter_lng,
				  location_description, source_url, data_version)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).bind(eqNo, originTime, magnitude, depth ?? null, lat, lng, location ?? null, sourceUrl ?? null, dataVersion),
		);

		batch.push(
			db.prepare('DELETE FROM rrw_earthquake_intensity WHERE earthquake_no = ?').bind(eqNo),
		);

		for (const st of iterStations(e)) {
			if (!st.stationName || st.lat == null || st.lng == null) continue;
			batch.push(
				db.prepare(
					`INSERT INTO rrw_earthquake_intensity
					 (earthquake_no, station_code, station_name, county, station_lat, station_lng, pga_gal, intensity_level)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				).bind(eqNo, st.stationCode ?? null, st.stationName, st.county ?? null, st.lat, st.lng, st.pga ?? null, st.intensityLevel),
			);
		}

		upserted++;
		if (batch.length >= D1_BATCH_SIZE) await flush();
	}

	await flush();
	return { upserted, skipped };
}
