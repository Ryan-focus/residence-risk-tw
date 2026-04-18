/**
 * 點與多邊形幾何工具（GeoJSON）
 *
 * 用於 flood / fault / liquefaction 等以 polygon 儲存的風險圖層。
 * D1 無 PostGIS，我們把 GeoJSON Polygon / MultiPolygon 文字存在欄位中，
 * 在 Worker 端做射線法（ray-casting）點在多邊形內判定。
 */

export type Ring = [number, number][]; // [lng, lat] pairs
export type Polygon = Ring[]; // [outerRing, ...holes]

/** 射線法：點是否落在單一 ring 內（不分外環內環，純多邊形判定） */
export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
	let inside = false;
	const n = ring.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = ring[i][0];
		const yi = ring[i][1];
		const xj = ring[j][0];
		const yj = ring[j][1];
		// 水平射線往右，計數穿越次數
		const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

/** Polygon = [outer, hole1, hole2...]。點需在外環內且不在任一內洞中。 */
export function pointInPolygon(lng: number, lat: number, polygon: Polygon): boolean {
	if (polygon.length === 0) return false;
	if (!pointInRing(lng, lat, polygon[0])) return false;
	for (let i = 1; i < polygon.length; i++) {
		if (pointInRing(lng, lat, polygon[i])) return false; // 在洞內 → 不算 inside
	}
	return true;
}

/**
 * 解析 GeoJSON 字串，判定 (lat, lng) 是否在該幾何內。
 * 支援 Polygon 與 MultiPolygon；其他類型或解析失敗回 false。
 */
export function pointInGeoJSON(lat: number, lng: number, geojsonText: string | null | undefined): boolean {
	if (!geojsonText) return false;
	try {
		const g = JSON.parse(geojsonText);
		if (!g || typeof g !== 'object') return false;
		if (g.type === 'Polygon') {
			return pointInPolygon(lng, lat, g.coordinates as Polygon);
		}
		if (g.type === 'MultiPolygon') {
			const polys = g.coordinates as Polygon[];
			for (const p of polys) {
				if (pointInPolygon(lng, lat, p)) return true;
			}
			return false;
		}
		return false;
	} catch {
		return false;
	}
}
