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
	// 「臺」→「台」統一（Nominatim 偏好「台」）
	addr = addr.replace(/臺/g, '台');
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
async function queryNominatimOnce(query: string): Promise<NominatimResult | null> {
	const params = new URLSearchParams({
		q: query,
		format: 'json',
		countrycodes: 'tw',
		limit: '1',
		addressdetails: '0',
	});

	const url = `https://nominatim.openstreetmap.org/search?${params}`;

	try {
		const response = await fetch(url, {
			headers: {
				'User-Agent': 'ResidenceRiskTW/0.1 (open-source; https://github.com/Ryan-focus/residence-risk-tw)',
			},
		});

		if (!response.ok) return null;
		const results: NominatimResult[] = await response.json();
		return results.length > 0 ? results[0] : null;
	} catch {
		return null;
	}
}

/**
 * Nominatim 漸進降級查詢
 * 完整地址 → 去門牌 → 只到路 → 只到區 → 只到市
 * Nominatim 台灣門牌覆蓋率低，需要 fallback
 */
async function queryNominatim(address: string): Promise<GeocodingResult | null> {
	// 嘗試順序：完整 → 去號 → 去巷弄號 → 去路段 → 只到區
	const fallbacks = buildFallbacks(address);

	for (const query of fallbacks) {
		const result = await queryNominatimOnce(query);
		if (result) {
			const isExact = query === fallbacks[0];
			return {
				lat: parseFloat(result.lat),
				lng: parseFloat(result.lon),
				source: 'nominatim',
				display_name: result.display_name,
				accuracy_m: isExact
					? result.class === 'building'
						? 10
						: 100
					: result.class === 'boundary'
						? 2000
						: 500,
			};
		}
	}

	return null;
}

/** 從完整地址產生漸進簡化的查詢序列 */
function buildFallbacks(address: string): string[] {
	const queries = [address];

	// 去掉「X號」「X樓」「之X」
	const noNumber = address.replace(/\d+號.*$/, '').replace(/\d+樓.*$/, '');
	if (noNumber !== address && noNumber.length > 2) queries.push(noNumber);

	// 去掉巷弄
	const noAlley = noNumber.replace(/\d+巷.*$/, '').replace(/\d+弄.*$/, '');
	if (noAlley !== noNumber && noAlley.length > 2) queries.push(noAlley);

	// 到路/街層級
	const roadMatch = address.match(/^(.+?[路街道])/);
	if (roadMatch && !queries.includes(roadMatch[1])) {
		queries.push(roadMatch[1]);
	}

	// 到區/鎮層級（台北市信義區）
	const parts: string[] = [];
	const cityMatch = address.match(/^(.+?[市縣])/);
	if (cityMatch) {
		const afterCity = address.substring(cityMatch[1].length);
		const distMatch = afterCity.match(/^(.+?[區鎮鄉市])/);
		if (distMatch) {
			const district = cityMatch[1] + distMatch[1];
			if (!queries.includes(district)) queries.push(district);
		}
		if (!queries.includes(cityMatch[1])) queries.push(cityMatch[1]);
	}

	return queries;
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
