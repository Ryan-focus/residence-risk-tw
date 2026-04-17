import { env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

const TABLES = [
	`CREATE TABLE IF NOT EXISTS rrw_data_sources (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		dataset_name TEXT NOT NULL,
		source_org TEXT NOT NULL,
		source_url TEXT NOT NULL,
		license TEXT NOT NULL,
		license_url TEXT,
		data_version TEXT NOT NULL,
		original_crs TEXT NOT NULL DEFAULT 'EPSG:3826',
		downloaded_at TEXT NOT NULL,
		imported_at TEXT NOT NULL,
		record_count INTEGER,
		attribution_text TEXT NOT NULL,
		notes TEXT
	)`,
	`CREATE TABLE IF NOT EXISTS rrw_flood_zones (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		rainfall_scenario TEXT NOT NULL,
		duration_hours INTEGER NOT NULL,
		rainfall_mm INTEGER NOT NULL,
		depth_class TEXT NOT NULL,
		county TEXT NOT NULL,
		town TEXT,
		bbox_min_lat REAL NOT NULL,
		bbox_min_lng REAL NOT NULL,
		bbox_max_lat REAL NOT NULL,
		bbox_max_lng REAL NOT NULL,
		center_lat REAL NOT NULL,
		center_lng REAL NOT NULL,
		geojson TEXT,
		data_source_id INTEGER REFERENCES rrw_data_sources(id),
		data_version TEXT NOT NULL,
		imported_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	`CREATE TABLE IF NOT EXISTS rrw_geocode_cache (
		address_hash TEXT PRIMARY KEY,
		lat REAL NOT NULL,
		lng REAL NOT NULL,
		source TEXT NOT NULL,
		accuracy_m INTEGER,
		cached_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	`CREATE TABLE IF NOT EXISTS rrw_query_log (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		district_code TEXT,
		county TEXT,
		dimensions TEXT,
		response_ms INTEGER,
		status_code INTEGER NOT NULL,
		geocode_source TEXT,
		queried_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
];

beforeAll(async () => {
	await env.DB.batch(TABLES.map((sql) => env.DB.prepare(sql)));
});
