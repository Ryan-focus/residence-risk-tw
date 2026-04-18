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
	reasoning: string[];
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

/**
 * 依據此地點觸發了哪一個降雨情境與淹水深度，產生自然語言的判定依據。
 *
 * 注意：水利署淹水潛勢圖本身是「地形、現有排水容量、歷史淹水、河川匯流」
 * 做過二維水理模擬後的結果，所以此處將「較小雨量即已淹水」直接詮釋為
 * 「排水容量不足以應付該雨量事件」，在因果上成立；但我們沒有市政府
 * 實際排水管網設計資料，僅以潛勢圖為依據。
 */
function buildReasoning(risks: FloodRisk[], score: number): string[] {
	if (risks.length === 0) {
		return [
			'綜合判定：**極低**風險。',
			'此地點未落入水利署公告之 24h 350 / 500 / 650 mm 三種降雨情境淹水潛勢圖範圍。依現有圖資判定，既有排水系統足以應付上述雨量事件，且地勢非低窪易積水區。',
		];
	}

	const lines: string[] = [];

	// 找最嚴重觸發
	const inside = risks.filter((r) => r.distance_m === null || r.distance_m === 0);
	const nearby = risks.filter((r) => r.distance_m !== null && r.distance_m <= 100);

	const trigger350 = inside.find((r) => r.rainfall_mm <= 350);
	const trigger500 = inside.find((r) => r.rainfall_mm <= 500);
	const trigger650 = inside.find((r) => r.rainfall_mm <= 650);

	if (trigger350) {
		const severe = trigger350.depth_class !== '0-50cm';
		lines.push(
			`此地點在 24 小時累積雨量 350 mm 的情境下即會淹水${severe ? '超過 50 公分' : '至 0–50 公分'}。` +
				`此雨量級距相當於一日中度豪雨（梅雨鋒面或颱風外圍環流），在台灣近十年為常見事件等級，` +
				`代表**此地既有排水容量不足以應付中度豪雨**，或地勢低窪／鄰近易氾流域。${severe ? '若遇颱風或強對流豪雨，淹水深度可能進一步上升至危及車輛與一樓設備。' : ''}`,
		);
	} else if (trigger500) {
		const severe = trigger500.depth_class !== '0-50cm';
		lines.push(
			`此地點需 24 小時累積雨量達 500 mm（約強颱或西南氣流豪雨等級）才會淹水${severe ? '超過 50 公分' : '至 0–50 公分'}。` +
				`350 mm 一般性豪雨下排水尚可負荷，但遇強颱時仍屬可預見之積水情境。`,
		);
	} else if (trigger650) {
		lines.push(
			'此地點僅在 24 小時累積雨量達 650 mm（極端豪雨，近十年全台僅少數事件達到此等級）才被潛勢圖標示為淹水區。日常排水能力足夠，屬相對安全之區位。',
		);
	}

	if (!trigger350 && !trigger500 && !trigger650 && nearby.length > 0) {
		const minDist = Math.min(...nearby.map((r) => r.distance_m ?? Infinity));
		lines.push(
			`此地點雖未落入淹水潛勢區內，但距最近的潛勢淹水區僅約 ${Math.round(minDist)} m。` +
				`劇烈降雨時，鄰近積水可能因地表漫流或排水系統回灌而擴散至此。`,
		);
	}

	// 補充說明
	const scenarios = new Set(risks.map((r) => r.scenario));
	if (scenarios.size > 1) {
		lines.push(
			`本地共觸發 ${scenarios.size} 種降雨情境的淹水紀錄，顯示此地對不同等級降雨皆有相應的積水行為，並非偶發。`,
		);
	}

	lines.push(
		'判定依據：經濟部水利署淹水潛勢圖，以二維水理模式模擬各情境下地表逕流積水深度。本結果反映地形、河川、既有排水容量之綜合效應，不反映即時天氣或現地抽水站運作狀態。',
	);

	// 分數語境
	if (score >= 81) {
		lines.unshift('綜合判定：**極高**風險 — 常態性豪雨即可能淹水，建議評估一樓防水閘門、抬高電器設備、加保淹水險。');
	} else if (score >= 61) {
		lines.unshift('綜合判定：**高**風險 — 中度以上豪雨時需特別警戒。');
	} else if (score >= 41) {
		lines.unshift('綜合判定：**中**風險 — 強颱或大豪雨時有淹水可能。');
	} else if (score >= 21) {
		lines.unshift('綜合判定：**低**風險 — 多數降雨事件下安全，僅極端豪雨時須警戒。');
	} else {
		lines.unshift('綜合判定：**極低**風險。');
	}

	return lines;
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
	const reasoning = buildReasoning(risks, score);

	return {
		score,
		level,
		color,
		risks,
		reasoning,
		disclaimer: '本工具使用經濟部水利署淹水潛勢圖，依《水災潛勢資料公開辦法》，此資料僅供防災業務參考，不構成任何土地使用或交易決策依據。',
	};
}
