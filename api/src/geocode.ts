/**
 * 地理編碼模組
 *
 * 查詢策略：
 *   1. D1 快取（rrw_geocode_cache，30 天 TTL）
 *   2. Map8 台灣圖霸 API — 內政部資料，近千萬筆建物門牌，WGS84
 *   3. Nominatim（最終 fallback）
 *   4. 寫回快取
 */

export interface GeocodingResult {
	lat: number;
	lng: number;
	source: 'cache' | 'map8' | 'nominatim';
	display_name: string;
	accuracy_m: number | null;
}

/** 地址正規化 */
export function normalizeAddress(raw: string): string {
	let addr = raw.trim();
	addr = addr.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
	addr = addr.replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
	addr = addr.replace(/臺/g, '台');
	addr = addr.replace(/\s+/g, '');
	return addr;
}

/** SHA-256 前 16 碼（快取 key，隱私設計） */
async function addressHash(normalized: string): Promise<string> {
	const data = new TextEncoder().encode(normalized);
	const hash = await crypto.subtle.digest('SHA-256', data);
	const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return hex.substring(0, 16);
}

// ── D1 快取 ───────────────────────────────────────────────────────────────────

async function lookupCache(db: D1Database, hash: string): Promise<GeocodingResult | null> {
	const row = await db
		.prepare(
			`SELECT lat, lng, source, accuracy_m FROM rrw_geocode_cache
			 WHERE address_hash = ? AND cached_at > datetime('now', '-30 days')`,
		)
		.bind(hash)
		.first<{ lat: number; lng: number; source: string; accuracy_m: number | null }>();

	if (!row) return null;
	return { lat: row.lat, lng: row.lng, source: 'cache', display_name: '(cached)', accuracy_m: row.accuracy_m };
}

async function writeCache(db: D1Database, hash: string, result: GeocodingResult): Promise<void> {
	await db
		.prepare(
			`INSERT OR REPLACE INTO rrw_geocode_cache (address_hash, lat, lng, source, accuracy_m, cached_at)
			 VALUES (?, ?, ?, ?, ?, datetime('now'))`,
		)
		.bind(hash, result.lat, result.lng, result.source, result.accuracy_m)
		.run();
}

// ── Map8 台灣圖霸 ─────────────────────────────────────────────────────────────

interface Map8Response {
	status: string;
	results: {
		formatted_address: string;
		geometry: { location: { lat: number; lng: number } };
		likelihood: number; // 0-100，100 = 完全匹配
	}[];
}

/**
 * Map8 geocoding API
 * 文件：https://www.map8.zone/map8-api-docs/
 * 申請試用金鑰：https://docs.google.com/forms/d/1BMN0cnmROBvtfU1JAxk-2sR9KcZdViHMNFtsyTR12l8
 */
async function queryMap8(address: string, apiKey: string): Promise<GeocodingResult | null> {
	if (!apiKey) return null;

	const params = new URLSearchParams({ key: apiKey, address });
	const url = `https://api.map8.zone/v2/place/geocode/json?${params}`;

	try {
		const res = await fetch(url);
		if (!res.ok) return null;

		const data: Map8Response = await res.json();
		if (data.status !== 'OK' || !data.results?.length) return null;

		const { lat, lng } = data.results[0].geometry.location;
		const likelihood = data.results[0].likelihood ?? 0;

		// likelihood 100 = 完全匹配（建物門牌），越低精度越差
		const accuracy_m =
			likelihood >= 95 ? 5 :
			likelihood >= 80 ? 50 :
			likelihood >= 60 ? 200 :
			500;

		return {
			lat,
			lng,
			source: 'map8',
			display_name: data.results[0].formatted_address,
			accuracy_m,
		};
	} catch {
		return null;
	}
}

// ── Nominatim fallback ────────────────────────────────────────────────────────

interface NominatimResult {
	lat: string;
	lon: string;
	display_name: string;
	class: string;
}

async function queryNominatimOnce(query: string): Promise<NominatimResult | null> {
	const params = new URLSearchParams({ q: query, format: 'json', countrycodes: 'tw', limit: '1', addressdetails: '0' });
	try {
		const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
			headers: { 'User-Agent': 'ResidenceRiskTW/0.2 (open-source; https://github.com/Ryan-focus/residence-risk-tw)' },
		});
		if (!res.ok) return null;
		const results: NominatimResult[] = await res.json();
		return results[0] ?? null;
	} catch {
		return null;
	}
}

function buildFallbacks(address: string): string[] {
	const queries = [address];
	const noNumber = address.replace(/\d+號.*$/, '').replace(/\d+樓.*$/, '');
	if (noNumber !== address && noNumber.length > 2) queries.push(noNumber);
	const noAlley = noNumber.replace(/\d+巷.*$/, '').replace(/\d+弄.*$/, '');
	if (noAlley !== noNumber && noAlley.length > 2) queries.push(noAlley);
	const roadMatch = address.match(/^(.+?[路街道])/);
	if (roadMatch && !queries.includes(roadMatch[1])) queries.push(roadMatch[1]);
	const cityMatch = address.match(/^(.+?[市縣])/);
	if (cityMatch) {
		const distMatch = address.substring(cityMatch[1].length).match(/^(.+?[區鎮鄉市])/);
		if (distMatch && !queries.includes(cityMatch[1] + distMatch[1])) queries.push(cityMatch[1] + distMatch[1]);
		if (!queries.includes(cityMatch[1])) queries.push(cityMatch[1]);
	}
	return queries;
}

async function queryNominatim(address: string): Promise<GeocodingResult | null> {
	for (const query of buildFallbacks(address)) {
		const r = await queryNominatimOnce(query);
		if (r) {
			const isExact = query === address;
			return {
				lat: parseFloat(r.lat),
				lng: parseFloat(r.lon),
				source: 'nominatim',
				display_name: r.display_name,
				accuracy_m: isExact ? (r.class === 'building' ? 10 : 100) : (r.class === 'boundary' ? 2000 : 500),
			};
		}
	}
	return null;
}

// ── 主要入口 ──────────────────────────────────────────────────────────────────

export async function geocode(
	db: D1Database,
	rawAddress: string,
	map8ApiKey: string,
): Promise<GeocodingResult | null> {
	const normalized = normalizeAddress(rawAddress);
	const hash = await addressHash(normalized);

	const cached = await lookupCache(db, hash);
	if (cached) return cached;

	const map8 = await queryMap8(normalized, map8ApiKey);
	if (map8) {
		await writeCache(db, hash, map8);
		return map8;
	}

	const nom = await queryNominatim(normalized);
	if (nom) {
		await writeCache(db, hash, nom);
		return nom;
	}

	return null;
}
