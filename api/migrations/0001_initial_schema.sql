-- ============================================================
-- Residence Risk TW — D1 初始 Schema
-- 基於 SA v0.1 §7 + v0.2 補強修正
-- D1 = SQLite，無 PostGIS，空間查詢用 bounding box + Haversine
-- ============================================================

-- 資料源清冊（v0.2 補強 §2.5）
-- 每個匯入的政府資料集都要記錄在這裡
CREATE TABLE IF NOT EXISTS rrw_data_sources (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_name    TEXT NOT NULL,                -- e.g. '淹水潛勢圖'
    source_org      TEXT NOT NULL,                -- e.g. '經濟部水利署'
    source_url      TEXT NOT NULL,
    license         TEXT NOT NULL,                -- e.g. '政府資料開放授權 v1'
    license_url     TEXT,
    data_version    TEXT NOT NULL,                -- e.g. '2024-06'
    original_crs    TEXT NOT NULL DEFAULT 'EPSG:3826', -- 原始座標系
    downloaded_at   TEXT NOT NULL,                -- ISO 8601
    imported_at     TEXT NOT NULL,                -- ISO 8601
    record_count    INTEGER,                      -- 匯入筆數
    attribution_text TEXT NOT NULL,               -- 報告用出處文字
    notes           TEXT
);

-- 淹水潛勢區（v0.2 修正：用定量降雨情境，非重現期）
-- D1 無 geometry，改用 bounding box + 中心點 lat/lng
CREATE TABLE IF NOT EXISTS rrw_flood_zones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    rainfall_scenario TEXT NOT NULL,              -- e.g. '24h_350mm', '24h_500mm', '24h_650mm'
    duration_hours  INTEGER NOT NULL,             -- 6, 12, 24
    rainfall_mm     INTEGER NOT NULL,             -- 150, 200, 250, 350, 500, 650
    depth_class     TEXT NOT NULL,                -- '0-50cm', '50-100cm', '100-200cm', '>200cm'
    county          TEXT NOT NULL,                -- 縣市名稱
    town            TEXT,                         -- 鄉鎮市區
    -- 用 bounding box 代替 geometry（WGS84 座標）
    bbox_min_lat    REAL NOT NULL,
    bbox_min_lng    REAL NOT NULL,
    bbox_max_lat    REAL NOT NULL,
    bbox_max_lng    REAL NOT NULL,
    center_lat      REAL NOT NULL,
    center_lng      REAL NOT NULL,
    -- GeoJSON 格式儲存完整多邊形（供前端繪圖用）
    geojson         TEXT,
    data_source_id  INTEGER REFERENCES rrw_data_sources(id),
    data_version    TEXT NOT NULL,
    imported_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 淹水查詢用的空間索引（bbox 查詢加速）
CREATE INDEX IF NOT EXISTS idx_flood_bbox
    ON rrw_flood_zones (bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng);
CREATE INDEX IF NOT EXISTS idx_flood_scenario
    ON rrw_flood_zones (rainfall_scenario);
CREATE INDEX IF NOT EXISTS idx_flood_county
    ON rrw_flood_zones (county);

-- 地理編碼快取（v0.2 補強 §3.3）
-- 只存地址雜湊，不存原地址（隱私設計）
CREATE TABLE IF NOT EXISTS rrw_geocode_cache (
    address_hash    TEXT PRIMARY KEY,             -- SHA-256 前 16 碼
    lat             REAL NOT NULL,
    lng             REAL NOT NULL,
    source          TEXT NOT NULL,                -- 'tgos' | 'nominatim'
    accuracy_m      INTEGER,                      -- 估計誤差（公尺）
    cached_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_geocode_cached_at
    ON rrw_geocode_cache (cached_at);

-- 查詢統計（僅記錄行政區層級，不記錄完整地址）
CREATE TABLE IF NOT EXISTS rrw_query_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    district_code   TEXT,                         -- 行政區代碼
    county          TEXT,                         -- 縣市
    dimensions      TEXT,                         -- 查詢的維度 JSON array
    response_ms     INTEGER,                      -- 回應時間（毫秒）
    status_code     INTEGER NOT NULL,
    geocode_source  TEXT,                         -- 'tgos' | 'nominatim' | 'cache'
    queried_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_query_log_date
    ON rrw_query_log (queried_at);
