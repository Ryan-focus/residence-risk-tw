-- ============================================================
-- 地震風險資料表
-- rrw_fault_zones       — 活動斷層地質敏感區（中央地質調查所）
-- rrw_liquefaction_zones — 土壤液化潛勢圖（經濟部地調所）
-- 空間策略同淹水：bounding box + center point（D1 無 PostGIS）
-- ============================================================

-- 活動斷層地質敏感區
CREATE TABLE IF NOT EXISTS rrw_fault_zones (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fault_name    TEXT    NOT NULL,           -- 斷層名稱，e.g. '車籠埤斷層'
    fault_class   INTEGER NOT NULL,           -- 1 = 第一類，2 = 第二類
    county        TEXT    NOT NULL,           -- 主要縣市（可跨縣市）
    bbox_min_lat  REAL    NOT NULL,
    bbox_min_lng  REAL    NOT NULL,
    bbox_max_lat  REAL    NOT NULL,
    bbox_max_lng  REAL    NOT NULL,
    center_lat    REAL    NOT NULL,
    center_lng    REAL    NOT NULL,
    geojson       TEXT,                       -- GeoJSON Polygon（供前端繪圖）
    data_source_id INTEGER REFERENCES rrw_data_sources(id),
    data_version  TEXT    NOT NULL,
    imported_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fault_bbox
    ON rrw_fault_zones (bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng);
CREATE INDEX IF NOT EXISTS idx_fault_class
    ON rrw_fault_zones (fault_class);

-- 土壤液化潛勢區
CREATE TABLE IF NOT EXISTS rrw_liquefaction_zones (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    level         TEXT    NOT NULL,           -- '高' | '中' | '低'
    county        TEXT    NOT NULL,
    district      TEXT,                       -- 鄉鎮市區（可空）
    bbox_min_lat  REAL    NOT NULL,
    bbox_min_lng  REAL    NOT NULL,
    bbox_max_lat  REAL    NOT NULL,
    bbox_max_lng  REAL    NOT NULL,
    center_lat    REAL    NOT NULL,
    center_lng    REAL    NOT NULL,
    geojson       TEXT,
    data_source_id INTEGER REFERENCES rrw_data_sources(id),
    data_version  TEXT    NOT NULL,
    imported_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_liq_bbox
    ON rrw_liquefaction_zones (bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng);
CREATE INDEX IF NOT EXISTS idx_liq_level
    ON rrw_liquefaction_zones (level);
