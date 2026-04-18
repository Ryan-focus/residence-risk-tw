-- ============================================================
-- 歷史顯著有感地震報告（中央氣象署 CWB E-A0015）
-- 配合 Method A「最近測站實測震度」判定策略
--
-- rrw_earthquake_history   一次地震一列（震央、規模、時間）
-- rrw_earthquake_intensity 一次地震 × 一個測站 = 一列（實測震度）
-- ============================================================

CREATE TABLE IF NOT EXISTS rrw_earthquake_history (
    earthquake_no        TEXT    PRIMARY KEY,        -- CWB 編號，e.g. '2022137'
    origin_time          TEXT    NOT NULL,           -- ISO 8601, e.g. '2022-09-18T06:44:15Z'
    magnitude            REAL    NOT NULL,           -- 芮氏規模 ML
    depth_km             REAL    NOT NULL,           -- 震源深度
    epicenter_lat        REAL    NOT NULL,
    epicenter_lng        REAL    NOT NULL,
    location_description TEXT,                       -- e.g. '台東縣政府北方44.7公里'
    source_url           TEXT,                       -- CWB 報告 PDF 或圖片
    data_source_id       INTEGER REFERENCES rrw_data_sources(id),
    data_version         TEXT    NOT NULL,
    imported_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 近鄰 bbox 查詢：給定 (lat, lng, buffer) 能快速篩掉多數事件
CREATE INDEX IF NOT EXISTS idx_eq_history_epi
    ON rrw_earthquake_history (epicenter_lat, epicenter_lng);
CREATE INDEX IF NOT EXISTS idx_eq_history_time
    ON rrw_earthquake_history (origin_time DESC);

-- 測站實測震度（一次地震可能有數十至數百筆）
CREATE TABLE IF NOT EXISTS rrw_earthquake_intensity (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    earthquake_no   TEXT    NOT NULL REFERENCES rrw_earthquake_history(earthquake_no),
    station_code    TEXT,                            -- e.g. 'TAP'
    station_name    TEXT    NOT NULL,                -- e.g. '臺北市'
    county          TEXT,
    station_lat     REAL    NOT NULL,
    station_lng     REAL    NOT NULL,
    pga_gal         REAL,                            -- 合成 PGA (gal = cm/s²)；可為 NULL
    intensity_level TEXT    NOT NULL                 -- '0','1','2','3','4','5弱','5強','6弱','6強','7'
);

CREATE INDEX IF NOT EXISTS idx_eq_intensity_eq
    ON rrw_earthquake_intensity (earthquake_no);
CREATE INDEX IF NOT EXISTS idx_eq_intensity_loc
    ON rrw_earthquake_intensity (station_lat, station_lng);
