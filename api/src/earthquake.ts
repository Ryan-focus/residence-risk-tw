/**
 * 地震風險查詢模組
 *
 * 整合兩個維度：
 *   1. 活動斷層地質敏感區（rrw_fault_zones）— 中央地質調查所
 *   2. 土壤液化潛勢（rrw_liquefaction_zones）— 經濟部地調所
 *
 * 評分權重：斷層 60% + 液化 40%
 * 無液化資料時（縣市尚未涵蓋）僅用斷層分數。
 */

export interface FaultRisk {
	fault_name: string;
	fault_class: 1 | 2;
	distance_m: number | null; // null = 點在敏感區內
}

export interface LiquefactionRisk {
	level: '高' | '中' | '低';
	distance_m: number | null;
}

export interface EarthquakeAssessment {
	score: number;
	level: string;
	color: string;
	fault: {
		score: number;
		risks: FaultRisk[];
	};
	liquefaction: {
		score: number;
		has_data: boolean; // false = 此縣市尚無液化資料
		risks: LiquefactionRisk[];
	};
	disclaimer: string;
}

/** Haversine 距離（公尺） */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371000;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLng = ((lng2 - lng1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 斷層評分 */
function scoreFault(risks: FaultRisk[]): number {
	if (risks.length === 0) return 5;
	let max = 5;
	for (const r of risks) {
		const d = r.distance_m;
		let s: number;
		if (d === null)         s = r.fault_class === 1 ? 90 : 70; // 在敏感區內
		else if (d < 200)       s = r.fault_class === 1 ? 55 : 45;
		else if (d < 500)       s = r.fault_class === 1 ? 35 : 25;
		else                    s = 10;
		max = Math.max(max, s);
	}
	return max;
}

/** 液化評分 */
function scoreLiquefaction(risks: LiquefactionRisk[]): number {
	if (risks.length === 0) return 5;
	let max = 5;
	for (const r of risks) {
		if (r.distance_m !== null) continue; // 只計算點在區域內的
		const s = r.level === '高' ? 80 : r.level === '中' ? 50 : 20;
		max = Math.max(max, s);
	}
	return max;
}

/** 綜合評分與等級 */
function combineScores(faultScore: number, liqScore: number, hasLiqData: boolean): number {
	if (!hasLiqData) return faultScore;
	return Math.round(faultScore * 0.6 + liqScore * 0.4);
}

function toLevel(score: number): { level: string; color: string } {
	if (score >= 81) return { level: '極高', color: '#ef4444' };
	if (score >= 61) return { level: '高',   color: '#f97316' };
	if (score >= 41) return { level: '中',   color: '#eab308' };
	if (score >= 21) return { level: '低',   color: '#84cc16' };
	return             { level: '極低', color: '#22c55e' };
}

/** 查詢某座標的地震風險 */
export async function assessEarthquake(
	db: D1Database,
	lat: number,
	lng: number,
): Promise<EarthquakeAssessment> {
	const buffer = 0.01; // ~1km 搜尋範圍

	// ── 斷層敏感區查詢 ──────────────────────────────────────────
	const { results: faultRows } = await db
		.prepare(
			`SELECT fault_name, fault_class, center_lat, center_lng,
			        bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng
			 FROM rrw_fault_zones
			 WHERE bbox_min_lat <= ?1 + ?3 AND bbox_max_lat >= ?1 - ?3
			   AND bbox_min_lng <= ?2 + ?3 AND bbox_max_lng >= ?2 - ?3
			 LIMIT 20`,
		)
		.bind(lat, lng, buffer)
		.all<{
			fault_name: string;
			fault_class: number;
			center_lat: number;
			center_lng: number;
			bbox_min_lat: number;
			bbox_min_lng: number;
			bbox_max_lat: number;
			bbox_max_lng: number;
		}>();

	const faultRisks: FaultRisk[] = faultRows.map((r) => {
		const inside =
			lat >= r.bbox_min_lat && lat <= r.bbox_max_lat &&
			lng >= r.bbox_min_lng && lng <= r.bbox_max_lng;
		return {
			fault_name: r.fault_name,
			fault_class: r.fault_class as 1 | 2,
			distance_m: inside ? null : Math.round(haversineM(lat, lng, r.center_lat, r.center_lng)),
		};
	});

	// ── 液化潛勢查詢 ─────────────────────────────────────────────
	const { results: liqRows } = await db
		.prepare(
			`SELECT level, center_lat, center_lng,
			        bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng
			 FROM rrw_liquefaction_zones
			 WHERE bbox_min_lat <= ?1 + ?3 AND bbox_max_lat >= ?1 - ?3
			   AND bbox_min_lng <= ?2 + ?3 AND bbox_max_lng >= ?2 - ?3
			 LIMIT 20`,
		)
		.bind(lat, lng, buffer)
		.all<{
			level: string;
			center_lat: number;
			center_lng: number;
			bbox_min_lat: number;
			bbox_min_lng: number;
			bbox_max_lat: number;
			bbox_max_lng: number;
		}>();

	const liqRisks: LiquefactionRisk[] = liqRows.map((r) => {
		const inside =
			lat >= r.bbox_min_lat && lat <= r.bbox_max_lat &&
			lng >= r.bbox_min_lng && lng <= r.bbox_max_lng;
		return {
			level: r.level as '高' | '中' | '低',
			distance_m: inside ? null : Math.round(haversineM(lat, lng, r.center_lat, r.center_lng)),
		};
	});

	// 判斷此縣市是否有液化資料（查表是否完全空）
	const hasLiqData = await checkLiqDataExists(db, lat, lng);

	// ── 評分 ──────────────────────────────────────────────────────
	const faultScore = scoreFault(faultRisks);
	const liqScore   = scoreLiquefaction(liqRisks);
	const finalScore = combineScores(faultScore, liqScore, hasLiqData);
	const { level, color } = toLevel(finalScore);

	return {
		score: finalScore,
		level,
		color,
		fault: { score: faultScore, risks: faultRisks },
		liquefaction: { score: liqScore, has_data: hasLiqData, risks: liqRisks },
		disclaimer:
			'活動斷層資料來源：中央地質調查所地質敏感區；土壤液化資料來源：經濟部地質調查及礦業管理中心。' +
			'本資料依政府資料開放授權條款提供，僅供防災參考，不構成任何土地使用或交易決策依據。',
	};
}

/**
 * 以搜尋半徑較大的範圍（~50km）確認此區域是否有匯入液化資料。
 * 若無，代表該縣市尚未涵蓋，評分時不計液化。
 */
async function checkLiqDataExists(db: D1Database, lat: number, lng: number): Promise<boolean> {
	const bigBuffer = 0.5;
	const row = await db
		.prepare(
			`SELECT 1 FROM rrw_liquefaction_zones
			 WHERE bbox_min_lat <= ?1 + ?3 AND bbox_max_lat >= ?1 - ?3
			   AND bbox_min_lng <= ?2 + ?3 AND bbox_max_lng >= ?2 - ?3
			 LIMIT 1`,
		)
		.bind(lat, lng, bigBuffer)
		.first();
	return row !== null;
}
