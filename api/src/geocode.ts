/**
 * 地理編碼模組 — Nominatim（公開 API）
 *
 * 策略（v0.2 §3.2 簡化版）：
 *   1. 查 D1 快取（rrw_geocode_cache）
 *   2. 快取未命中 → 呼叫 Nominatim
 *   3. 結果寫回快取（30 天 TTL）
 *
 * 未來 TGOS 可用時，在 step 2 前面插入 TGOS 即可。
 */

export interface GeocodingResult {
	lat: number;
	lng: number;
	source: 'cache' | 'nominatim' | 'tgos';
	display_name: string;
	accuracy_m: number | null;
}

/** 地址正規化（v0.2 §3.4 — 簡易版） */
export function normalizeAddress(raw: string): string {
	let addr = raw.trim();
	// 全形 → 半形數字
	addr = addr.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
	// 全形英文 → 半形
	addr = addr.replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
	// 「台」→「臺」統一（Nominatim 偏好「臺」）
	addr = addr.replace(/台/g, '臺');
	// 移除多餘空白
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

/** 查 D1 快取 */
async function lookupCache(db: D1Database, hash: string): Promise<GeocodingResult | null> {
	const row = await db
		.prepare(
			`SELECT lat, lng, source, accuracy_m FROM rrw_geocode_cache
			 WHERE address_hash = ? AND cached_at > datetime('now', '-30 days')`,
		)
		.bind(hash)
		.first<{ lat: number; lng: number; source: string; accuracy_m: number | null }>();

	if (!row) return null;
	return {
		lat: row.lat,
		lng: row.lng,
		source: 'cache',
		display_name: '(cached)',
		accuracy_m: row.accuracy_m,
	};
}

/** 寫入快取 */
async function writeCache(db: D1Database, hash: string, result: GeocodingResult): Promise<void> {
	await db
		.prepare(
			`INSERT OR REPLACE INTO rrw_geocode_cache (address_hash, lat, lng, source, accuracy_m, cached_at)
			 VALUES (?, ?, ?, ?, ?, datetime('now'))`,
		)
		.bind(hash, result.lat, result.lng, result.source, result.accuracy_m)
		.run();
}

interface NominatimResult {
	lat: string;
	lon: string;
	display_name: string;
	class: string;
	importance: number;
}

/** 呼叫 Nominatim 公開 API */
async function queryNominatim(address: string): Promise<GeocodingResult | null> {
	const params = new URLSearchParams({
		q: address,
		format: 'json',
		countrycodes: 'tw',
		limit: '1',
		addressdetails: '0',
	});

	const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
		headers: {
			'User-Agent': 'ResidenceRiskTW/0.1 (open-source; https://github.com/Ryan-focus/residence-risk-tw)',
		},
	});

	if (!response.ok) return null;

	const results: NominatimResult[] = await response.json();
	if (results.length === 0) return null;

	const best = results[0];
	return {
		lat: parseFloat(best.lat),
		lng: parseFloat(best.lon),
		source: 'nominatim',
		display_name: best.display_name,
		accuracy_m: best.class === 'building' ? 10 : best.class === 'place' ? 100 : 500,
	};
}

/** 主要入口：地址 → 座標 */
export async function geocode(db: D1Database, rawAddress: string): Promise<GeocodingResult | null> {
	const normalized = normalizeAddress(rawAddress);
	const hash = await addressHash(normalized);

	// 1. 查快取
	const cached = await lookupCache(db, hash);
	if (cached) return cached;

	// 2. Nominatim
	const result = await queryNominatim(normalized);
	if (!result) return null;

	// 3. 寫快取
	await writeCache(db, hash, result);

	return result;
}
