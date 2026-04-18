/**
 * 地震風險查詢模組
 *
 * 整合三個維度：
 *   1. 活動斷層地質敏感區（rrw_fault_zones）— 中央地質調查所
 *   2. 土壤液化潛勢（rrw_liquefaction_zones）— 經濟部地調所
 *   3. 歷史顯著有感地震（rrw_earthquake_history + rrw_earthquake_intensity）— CWB
 *
 * 評分權重：斷層 60% + 液化 40%（僅供分數用；歷史地震作為輔助展示，不計入分數）
 * 無液化資料時（縣市尚未涵蓋）僅用斷層分數。
 *
 * 歷史震度判定策略（Method A）：
 *   對每次附近（震央 50km 內）的顯著有感地震，取距查詢座標「最近的 CWB 測站」
 *   的實測震度作為該事件在本地點的推定震度。若最近測站距離 > 15 km，
 *   則不做推定，僅顯示震央距離與規模，避免過度外推。
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

export interface EarthquakeHistoryEvent {
	earthquake_no: string;
	origin_time: string;
	magnitude: number;
	depth_km: number;
	epicenter_lat: number;
	epicenter_lng: number;
	epicenter_distance_km: number;
	location_description: string | null;
	source_url: string | null;
	/** 以最近測站實測震度推定；最近測站 > 15 km 時為 null */
	estimated_intensity: {
		level: string; // '0'..'7'
		method: 'nearest_station';
		nearest_station: {
			name: string;
			county: string | null;
			distance_km: number;
			pga_gal: number | null;
		};
	} | null;
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
	history: {
		available: boolean; // false = rrw_earthquake_history 完全空，尚未匯入
		radius_km: number;
		years_back: number;
		events: EarthquakeHistoryEvent[];
	};
	reasoning: string[];
	disclaimer: string;
}

import { pointInGeoJSON, insideBboxFallback } from './geo';

/**
 * 兩階段查詢的第二階段：對那些 bbox 實際包含查詢點的候選，額外撈 geojson。
 * 這樣能把每次 request 的 D1 回傳大小壓在合理範圍（避免 D1 1 MB limit 爆掉）。
 */
async function fetchGeojsonForBboxHits<
	T extends {
		id: number;
		bbox_min_lat: number;
		bbox_min_lng: number;
		bbox_max_lat: number;
		bbox_max_lng: number;
	},
>(db: D1Database, table: string, lat: number, lng: number, candidates: T[]): Promise<Map<number, string | null>> {
	const bboxHits = candidates.filter(
		(r) => lat >= r.bbox_min_lat && lat <= r.bbox_max_lat && lng >= r.bbox_min_lng && lng <= r.bbox_max_lng,
	);
	const map = new Map<number, string | null>();
	if (bboxHits.length === 0) return map;

	// 限制每次最多撈 10 個 geojson（極保守，防 CPU / response size 爆）
	const ids = bboxHits.slice(0, 10).map((r) => r.id);
	const placeholders = ids.map(() => '?').join(',');
	const { results } = await db
		.prepare(`SELECT id, geojson FROM ${table} WHERE id IN (${placeholders})`)
		.bind(...ids)
		.all<{ id: number; geojson: string | null }>();
	for (const r of results) map.set(r.id, r.geojson);
	return map;
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

	// ── 斷層敏感區查詢（兩階段：先 bbox，再針對 bbox 命中的候選撈 geojson） ─
	const { results: faultCandidates } = await db
		.prepare(
			`SELECT id, fault_name, fault_class, center_lat, center_lng,
			        bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng
			 FROM rrw_fault_zones
			 WHERE bbox_min_lat <= ?1 + ?3 AND bbox_max_lat >= ?1 - ?3
			   AND bbox_min_lng <= ?2 + ?3 AND bbox_max_lng >= ?2 - ?3
			 LIMIT 20`,
		)
		.bind(lat, lng, buffer)
		.all<{
			id: number;
			fault_name: string;
			fault_class: number;
			center_lat: number;
			center_lng: number;
			bbox_min_lat: number;
			bbox_min_lng: number;
			bbox_max_lat: number;
			bbox_max_lng: number;
		}>();

	const faultGeojsonMap = await fetchGeojsonForBboxHits(db, 'rrw_fault_zones', lat, lng, faultCandidates);

	const faultRisks: FaultRisk[] = faultCandidates.map((r) => {
		const centroidDistM = haversineM(lat, lng, r.center_lat, r.center_lng);
		const inBbox = lat >= r.bbox_min_lat && lat <= r.bbox_max_lat && lng >= r.bbox_min_lng && lng <= r.bbox_max_lng;
		const geojson = faultGeojsonMap.get(r.id);
		let inside = false;
		if (inBbox) {
			inside = geojson
				? pointInGeoJSON(lat, lng, geojson)
				: insideBboxFallback(
						lat,
						lng,
						r.bbox_min_lat,
						r.bbox_min_lng,
						r.bbox_max_lat,
						r.bbox_max_lng,
						r.center_lat,
						r.center_lng,
					);
		}
		return {
			fault_name: r.fault_name,
			fault_class: r.fault_class as 1 | 2,
			distance_m: inside ? null : Math.round(centroidDistM),
		};
	});

	// ── 液化潛勢查詢（兩階段） ─────────────────────────────────
	const { results: liqCandidates } = await db
		.prepare(
			`SELECT id, level, center_lat, center_lng,
			        bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng
			 FROM rrw_liquefaction_zones
			 WHERE bbox_min_lat <= ?1 + ?3 AND bbox_max_lat >= ?1 - ?3
			   AND bbox_min_lng <= ?2 + ?3 AND bbox_max_lng >= ?2 - ?3
			 LIMIT 20`,
		)
		.bind(lat, lng, buffer)
		.all<{
			id: number;
			level: string;
			center_lat: number;
			center_lng: number;
			bbox_min_lat: number;
			bbox_min_lng: number;
			bbox_max_lat: number;
			bbox_max_lng: number;
		}>();

	const liqGeojsonMap = await fetchGeojsonForBboxHits(db, 'rrw_liquefaction_zones', lat, lng, liqCandidates);

	const liqRisks: LiquefactionRisk[] = liqCandidates.map((r) => {
		const centroidDistM = haversineM(lat, lng, r.center_lat, r.center_lng);
		const inBbox = lat >= r.bbox_min_lat && lat <= r.bbox_max_lat && lng >= r.bbox_min_lng && lng <= r.bbox_max_lng;
		const geojson = liqGeojsonMap.get(r.id);
		let inside = false;
		if (inBbox) {
			inside = geojson
				? pointInGeoJSON(lat, lng, geojson)
				: insideBboxFallback(
						lat,
						lng,
						r.bbox_min_lat,
						r.bbox_min_lng,
						r.bbox_max_lat,
						r.bbox_max_lng,
						r.center_lat,
						r.center_lng,
					);
		}
		return {
			level: r.level as '高' | '中' | '低',
			distance_m: inside ? null : Math.round(centroidDistM),
		};
	});

	// 判斷此縣市是否有液化資料（查表是否完全空）
	const hasLiqData = await checkLiqDataExists(db, lat, lng);

	// ── 歷史顯著有感地震查詢 ────────────────────────────────────
	const history = await queryEarthquakeHistory(db, lat, lng);

	// ── 評分 ──────────────────────────────────────────────────────
	const faultScore = scoreFault(faultRisks);
	const liqScore   = scoreLiquefaction(liqRisks);
	const finalScore = combineScores(faultScore, liqScore, hasLiqData);
	const { level, color } = toLevel(finalScore);

	const reasoning = buildEarthquakeReasoning({
		finalScore,
		faultRisks,
		liqRisks,
		hasLiqData,
		historyEvents: history.events,
	});

	return {
		score: finalScore,
		level,
		color,
		fault: { score: faultScore, risks: faultRisks },
		liquefaction: { score: liqScore, has_data: hasLiqData, risks: liqRisks },
		history,
		reasoning,
		disclaimer:
			'活動斷層資料來源：中央地質調查所地質敏感區；土壤液化資料來源：經濟部地質調查及礦業管理中心；' +
			'歷史地震資料來源：中央氣象署顯著有感地震報告（E-A0015）。歷史地震震度欄位為「最近測站實測」之推定，' +
			'實際震感依建築結構與微地形條件而異。本資料僅供防災參考，不構成任何土地使用或交易決策依據。',
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

const HISTORY_RADIUS_KM = 50;
const HISTORY_YEARS_BACK = 10;
const NEAREST_STATION_MAX_KM = 15; // 超過此距離不做震度推定

/**
 * 查詢附近的歷史顯著有感地震，並為每筆找出距查詢座標最近的 CWB 測站實測震度。
 */
async function queryEarthquakeHistory(
	db: D1Database,
	lat: number,
	lng: number,
): Promise<EarthquakeAssessment['history']> {
	// 粗略換算：1 度 ≈ 111 km
	const degBuffer = HISTORY_RADIUS_KM / 111;
	const minTime = new Date();
	minTime.setFullYear(minTime.getFullYear() - HISTORY_YEARS_BACK);
	const minTimeIso = minTime.toISOString();

	// 是否匯入過任何一筆？用來分辨「尚未匯入資料」與「匯入了但附近沒事件」
	const anyRow = await db.prepare('SELECT 1 AS has FROM rrw_earthquake_history LIMIT 1').first<{ has: number }>();
	const available = anyRow?.has === 1;

	if (!available) {
		return { available: false, radius_km: HISTORY_RADIUS_KM, years_back: HISTORY_YEARS_BACK, events: [] };
	}

	const { results: eqRows } = await db
		.prepare(
			`SELECT earthquake_no, origin_time, magnitude, depth_km,
			        epicenter_lat, epicenter_lng, location_description, source_url
			 FROM rrw_earthquake_history
			 WHERE epicenter_lat BETWEEN ?1 AND ?2
			   AND epicenter_lng BETWEEN ?3 AND ?4
			   AND origin_time >= ?5
			 ORDER BY origin_time DESC
			 LIMIT 50`,
		)
		.bind(lat - degBuffer, lat + degBuffer, lng - degBuffer, lng + degBuffer, minTimeIso)
		.all<{
			earthquake_no: string;
			origin_time: string;
			magnitude: number;
			depth_km: number;
			epicenter_lat: number;
			epicenter_lng: number;
			location_description: string | null;
			source_url: string | null;
		}>();

	// 以實際大圓距離再次過濾
	const nearby = eqRows
		.map((r) => ({ ...r, distM: haversineM(lat, lng, r.epicenter_lat, r.epicenter_lng) }))
		.filter((r) => r.distM <= HISTORY_RADIUS_KM * 1000)
		.slice(0, 20);

	if (nearby.length === 0) {
		return { available: true, radius_km: HISTORY_RADIUS_KM, years_back: HISTORY_YEARS_BACK, events: [] };
	}

	// 一次撈所有相關 earthquake_no 的測站
	const placeholders = nearby.map(() => '?').join(',');
	const { results: stationRows } = await db
		.prepare(
			`SELECT earthquake_no, station_code, station_name, county,
			        station_lat, station_lng, pga_gal, intensity_level
			 FROM rrw_earthquake_intensity
			 WHERE earthquake_no IN (${placeholders})`,
		)
		.bind(...nearby.map((r) => r.earthquake_no))
		.all<{
			earthquake_no: string;
			station_code: string | null;
			station_name: string;
			county: string | null;
			station_lat: number;
			station_lng: number;
			pga_gal: number | null;
			intensity_level: string;
		}>();

	// 以 earthquake_no 分組找最近測站
	const stationsByEq = new Map<string, typeof stationRows>();
	for (const s of stationRows) {
		const arr = stationsByEq.get(s.earthquake_no) ?? [];
		arr.push(s);
		stationsByEq.set(s.earthquake_no, arr);
	}

	const events: EarthquakeHistoryEvent[] = nearby.map((eq) => {
		const stations = stationsByEq.get(eq.earthquake_no) ?? [];
		let nearest: (typeof stations)[number] | null = null;
		let minDist = Infinity;
		for (const s of stations) {
			const d = haversineM(lat, lng, s.station_lat, s.station_lng);
			if (d < minDist) {
				minDist = d;
				nearest = s;
			}
		}

		const nearestKm = minDist / 1000;
		const estimated =
			nearest && nearestKm <= NEAREST_STATION_MAX_KM
				? {
						level: nearest.intensity_level,
						method: 'nearest_station' as const,
						nearest_station: {
							name: nearest.station_name,
							county: nearest.county,
							distance_km: Math.round(nearestKm * 10) / 10,
							pga_gal: nearest.pga_gal,
						},
					}
				: null;

		return {
			earthquake_no: eq.earthquake_no,
			origin_time: eq.origin_time,
			magnitude: eq.magnitude,
			depth_km: eq.depth_km,
			epicenter_lat: eq.epicenter_lat,
			epicenter_lng: eq.epicenter_lng,
			epicenter_distance_km: Math.round((eq.distM / 1000) * 10) / 10,
			location_description: eq.location_description,
			source_url: eq.source_url,
			estimated_intensity: estimated,
		};
	});

	return { available: true, radius_km: HISTORY_RADIUS_KM, years_back: HISTORY_YEARS_BACK, events };
}

/** 震度等級排序用（越大越強） */
function intensityRank(level: string): number {
	const table: Record<string, number> = {
		'0': 0, '1': 1, '2': 2, '3': 3, '4': 4,
		'5弱': 5, '5-': 5, '5弱 ': 5,
		'5強': 6, '5+': 6,
		'6弱': 7, '6-': 7,
		'6強': 8, '6+': 8,
		'7': 9,
	};
	return table[level] ?? -1;
}

/**
 * 產生地震風險的自然語言判定依據。
 */
function buildEarthquakeReasoning(args: {
	finalScore: number;
	faultRisks: FaultRisk[];
	liqRisks: LiquefactionRisk[];
	hasLiqData: boolean;
	historyEvents: EarthquakeHistoryEvent[];
}): string[] {
	const { finalScore, faultRisks, liqRisks, hasLiqData, historyEvents } = args;
	const lines: string[] = [];

	// ── 分數語境 ───────────────────────────────────
	if (finalScore >= 81)      lines.push('綜合判定：**極高**風險 — 地表錯動與強震感共存情境，應評估建築結構耐震補強。');
	else if (finalScore >= 61) lines.push('綜合判定：**高**風險 — 地質敏感區附近或有明顯液化潛勢。');
	else if (finalScore >= 41) lines.push('綜合判定：**中**風險。');
	else if (finalScore >= 21) lines.push('綜合判定：**低**風險。');
	else                       lines.push('綜合判定：**極低**風險（依現有地質敏感區資料）。');

	// ── 斷層說明 ──────────────────────────────────
	const insideClass1 = faultRisks.find((f) => f.distance_m === null && f.fault_class === 1);
	const insideClass2 = faultRisks.find((f) => f.distance_m === null && f.fault_class === 2);
	const nearestFault = faultRisks
		.filter((f) => f.distance_m !== null)
		.sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity))[0];

	if (insideClass1) {
		lines.push(
			`**斷層：位於第一類活動斷層地質敏感區內**（${insideClass1.fault_name}兩側 500 m 範圍）。` +
				`第一類為經濟部地質調查所認定近 10 萬年內確有錯動證據之斷層，一旦再度活動，` +
				`本地點將直接承受地表錯動（地面實體斷裂位移）與最劇烈之震動。`,
		);
	} else if (insideClass2) {
		lines.push(
			`**斷層：位於第二類活動斷層地質敏感區內**（${insideClass2.fault_name}）。` +
				`第二類為「存疑性活動斷層」，地質證據顯示具活動潛勢但活動時間未完全確認。`,
		);
	} else if (nearestFault && nearestFault.distance_m !== null) {
		const d = nearestFault.distance_m;
		if (d < 200) {
			lines.push(
				`**斷層：距最近之活動斷層（${nearestFault.fault_name}，第${nearestFault.fault_class}類）僅約 ${d} m**。` +
					`雖未直接位於敏感區內，但此距離屬地表破裂可能延伸之範圍，震動強度亦會顯著放大。`,
			);
		} else if (d < 500) {
			lines.push(
				`**斷層：距最近活動斷層約 ${d} m**（${nearestFault.fault_name}，第${nearestFault.fault_class}類）。屬敏感區外圍緩衝帶。`,
			);
		} else {
			lines.push('**斷層：附近 500 m 內無公告之活動斷層地質敏感區**。');
		}
	} else {
		lines.push('**斷層：附近無公告之活動斷層地質敏感區**。');
	}

	// ── 液化說明 ──────────────────────────────────
	if (!hasLiqData) {
		lines.push(
			'**液化：此縣市尚未納入經濟部地質調查所土壤液化潛勢調查**（該調查目前以都會區與沖積平原為主）。地震分數僅採用斷層子分數。',
		);
	} else {
		const inside = liqRisks.find((l) => l.distance_m === null);
		if (inside && inside.level === '高') {
			lines.push(
				'**液化：位於土壤液化高潛勢區**。此代表地質以年輕沖積層或人工填土為主、淺層地下水位高。' +
					'當強震（氣象署震度約 5 弱以上、地表加速度 ~80 gal）發生時，砂質土壤孔隙水壓上升可能使土壤喪失承載力，' +
					'造成建物不均勻沉陷傾斜、管線斷裂、地表砂湧等二次災害。',
			);
		} else if (inside && inside.level === '中') {
			lines.push(
				'**液化：位於土壤液化中潛勢區**。中度強震時有局部液化可能；規模較大地震（震度 6 弱以上）時風險顯著上升。',
			);
		} else if (inside && inside.level === '低') {
			lines.push('**液化：位於土壤液化低潛勢區**。依現行調查解析度評估液化可能性低。');
		} else {
			lines.push('**液化：此地點未落入任一等級液化潛勢區**（此縣市有資料，但本點不在圈繪範圍內）。');
		}
	}

	// ── 歷史地震佐證 ───────────────────────────────
	if (historyEvents.length > 0) {
		// 找過去此地最大推定震度
		const withIntensity = historyEvents.filter((e) => e.estimated_intensity !== null);
		if (withIntensity.length > 0) {
			const strongest = withIntensity.sort(
				(a, b) => intensityRank(b.estimated_intensity!.level) - intensityRank(a.estimated_intensity!.level),
			)[0];
			const dt = strongest.origin_time.slice(0, 10);
			const stn = strongest.estimated_intensity!.nearest_station;
			lines.push(
				`**歷史地震佐證：** 近 ${HISTORY_YEARS_BACK} 年震央 ${HISTORY_RADIUS_KM} km 內有 ${historyEvents.length} 次顯著有感地震。` +
					`其中最強一次（${dt}，M${strongest.magnitude}，震央距本地 ${strongest.epicenter_distance_km} km）於最近測站` +
					`「${stn.name}」（距本地 ${stn.distance_km} km）實測震度 ${strongest.estimated_intensity!.level} 級 — ` +
					`此為本地點過去 ${HISTORY_YEARS_BACK} 年可查證之最強震感參考。`,
			);
		} else {
			lines.push(
				`**歷史地震佐證：** 近 ${HISTORY_YEARS_BACK} 年震央 ${HISTORY_RADIUS_KM} km 內有 ${historyEvents.length} 次有感地震，` +
					'但最近之 CWB 測站距本地均 > 15 km，故未做震度推定；詳見事件清單中各次震央距離與規模。',
			);
		}
	}

	return lines;
}
