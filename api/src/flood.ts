/**
 * 淹水風險查詢模組
 *
 * D1 無 PostGIS，用 bounding box 查詢 + Haversine 距離篩選。
 * v0.2 修正：用定量降雨情境（非重現期）。
 */

export interface FloodRisk {
	scenario: string;
	duration_hours: number;
	rainfall_mm: number;
	depth_class: string;
	distance_m: number | null; // null = 點在區域內
}

export interface FloodAssessment {
	score: number;
	level: string;
	color: string;
	risks: FloodRisk[];
	disclaimer: string;
}

/** Haversine 距離（公尺） */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371000;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLng = ((lng2 - lng1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** v0.2 §6.5 淹水評分表 */
function scoreFlood(risks: FloodRisk[]): { score: number; level: string; color: string } {
	if (risks.length === 0) {
		return { score: 5, level: '極低', color: '#22c55e' };
	}

	// 找最嚴重的情境
	let maxScore = 5;

	for (const r of risks) {
		const inside = r.distance_m === null || r.distance_m === 0;
		const nearby100 = r.distance_m !== null && r.distance_m <= 100;
		let s = 5;

		if (r.rainfall_mm <= 350 && inside) {
			s = r.depth_class === '0-50cm' ? 80 : 95;
		} else if (r.rainfall_mm <= 500 && inside) {
			s = r.depth_class === '0-50cm' ? 50 : 65;
		} else if (r.rainfall_mm <= 650 && inside) {
			s = 30;
		} else if (nearby100) {
			s = 20;
		}

		maxScore = Math.max(maxScore, s);
	}

	let level: string, color: string;
	if (maxScore <= 20) {
		level = '極低';
		color = '#22c55e';
	} else if (maxScore <= 40) {
		level = '低';
		color = '#84cc16';
	} else if (maxScore <= 60) {
		level = '中';
		color = '#eab308';
	} else if (maxScore <= 80) {
		level = '高';
		color = '#f97316';
	} else {
		level = '極高';
		color = '#ef4444';
	}

	return { score: maxScore, level, color };
}

/** 查詢某座標的淹水風險 */
export async function assessFlood(db: D1Database, lat: number, lng: number): Promise<FloodAssessment> {
	// 搜尋半徑 ~500m（約 0.005 度）
	const buffer = 0.005;

	const { results } = await db
		.prepare(
			`SELECT rainfall_scenario, duration_hours, rainfall_mm, depth_class,
					center_lat, center_lng, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng
			 FROM rrw_flood_zones
			 WHERE bbox_min_lat <= ?1 + ?5 AND bbox_max_lat >= ?1 - ?5
			   AND bbox_min_lng <= ?2 + ?5 AND bbox_max_lng >= ?2 - ?5
			 LIMIT 50`,
		)
		.bind(lat, lng, lat, lng, buffer)
		.all<{
			rainfall_scenario: string;
			duration_hours: number;
			rainfall_mm: number;
			depth_class: string;
			center_lat: number;
			center_lng: number;
			bbox_min_lat: number;
			bbox_min_lng: number;
			bbox_max_lat: number;
			bbox_max_lng: number;
		}>();

	const risks: FloodRisk[] = results.map((row) => {
		const inside = lat >= row.bbox_min_lat && lat <= row.bbox_max_lat && lng >= row.bbox_min_lng && lng <= row.bbox_max_lng;

		return {
			scenario: row.rainfall_scenario,
			duration_hours: row.duration_hours,
			rainfall_mm: row.rainfall_mm,
			depth_class: row.depth_class,
			distance_m: inside ? null : Math.round(haversineM(lat, lng, row.center_lat, row.center_lng)),
		};
	});

	const { score, level, color } = scoreFlood(risks);

	return {
		score,
		level,
		color,
		risks,
		disclaimer: '本工具使用經濟部水利署淹水潛勢圖，依《水災潛勢資料公開辦法》，此資料僅供防災業務參考，不構成任何土地使用或交易決策依據。',
	};
}
