"""
淹水潛勢圖資匯入腳本

資料來源：經濟部水利署 — 淹水潛勢圖
下載位置：https://data.gov.tw/dataset/25766
格式：SHP（各縣市分檔）
座標系：TWD97 (EPSG:3826) → 匯入時轉換為 WGS84 (EPSG:4326)

v0.2 修正：淹水潛勢圖不是重現期制，是定量降雨情境制
  - 6 小時: 150/250/350mm
  - 12 小時: 200/300/400mm
  - 24 小時: 200/350/500/650mm
  共 10 種情境

使用方式：
    1. 下載 SHP 檔案到 data-pipeline/raw/flood/
    2. pip install -r requirements.txt
    3. python import_flood.py --input ../raw/flood/ --output ../processed/flood/

依賴：
    pip install geopandas pyproj shapely
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Any

try:
    import geopandas as gpd
    from shapely.geometry import mapping
except ImportError:
    print("請先安裝依賴: pip install geopandas pyproj shapely", file=sys.stderr)
    sys.exit(1)

from coord_transform import twd97_to_wgs84


# 降雨情境解析（從檔名或屬性推斷）
SCENARIO_PATTERNS = {
    "6h150": ("6h_150mm", 6, 150),
    "6h250": ("6h_250mm", 6, 250),
    "6h350": ("6h_350mm", 6, 350),
    "12h200": ("12h_200mm", 12, 200),
    "12h300": ("12h_300mm", 12, 300),
    "12h400": ("12h_400mm", 12, 400),
    "24h200": ("24h_200mm", 24, 200),
    "24h350": ("24h_350mm", 24, 350),
    "24h500": ("24h_500mm", 24, 500),
    "24h650": ("24h_650mm", 24, 650),
}

# MVP 只聚焦三種 24 小時情境（v0.2 建議）
MVP_SCENARIOS = {"24h_350mm", "24h_500mm", "24h_650mm"}


def parse_scenario_from_filename(filename: str) -> tuple[str, int, int] | None:
    """從檔名推斷降雨情境"""
    name = filename.lower().replace("_", "").replace("-", "").replace(" ", "")
    for pattern, info in SCENARIO_PATTERNS.items():
        if pattern in name:
            return info
    return None


def classify_depth(depth_value: float) -> str:
    """將淹水深度值分類"""
    if depth_value <= 0:
        return "0cm"
    elif depth_value <= 0.5:
        return "0-50cm"
    elif depth_value <= 1.0:
        return "50-100cm"
    elif depth_value <= 2.0:
        return "100-200cm"
    else:
        return ">200cm"


def process_shapefile(shp_path: Path, scenario_info: tuple[str, int, int]) -> List[Dict[str, Any]]:
    """處理單一 SHP 檔案，轉換座標並產生記錄"""
    scenario_name, duration, rainfall = scenario_info

    print(f"  讀取 {shp_path.name} (情境: {scenario_name})...")
    gdf = gpd.read_file(shp_path)

    # 轉換座標系 TWD97 → WGS84
    if gdf.crs and gdf.crs.to_epsg() == 3826:
        gdf = gdf.to_crs(epsg=4326)
    elif gdf.crs and gdf.crs.to_epsg() != 4326:
        print(f"    警告: 未預期的座標系 {gdf.crs}，嘗試轉為 WGS84")
        gdf = gdf.to_crs(epsg=4326)

    records = []
    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        bounds = geom.bounds  # (minx, miny, maxx, maxy) = (min_lng, min_lat, max_lng, max_lat)
        centroid = geom.centroid

        # 嘗試從屬性取得深度資訊
        depth_class = "unknown"
        for col in ["depth", "DEPTH", "淹水深度", "depth_class"]:
            if col in row.index and row[col] is not None:
                try:
                    depth_class = classify_depth(float(row[col]))
                except (ValueError, TypeError):
                    depth_class = str(row[col])
                break

        # 嘗試取得縣市
        county = ""
        for col in ["COUNTY", "county", "縣市", "COUNTYNAME"]:
            if col in row.index and row[col]:
                county = str(row[col])
                break

        town = ""
        for col in ["TOWN", "town", "鄉鎮", "TOWNNAME"]:
            if col in row.index and row[col]:
                town = str(row[col])
                break

        records.append({
            "rainfall_scenario": scenario_name,
            "duration_hours": duration,
            "rainfall_mm": rainfall,
            "depth_class": depth_class,
            "county": county,
            "town": town,
            "bbox_min_lat": round(bounds[1], 7),
            "bbox_min_lng": round(bounds[0], 7),
            "bbox_max_lat": round(bounds[3], 7),
            "bbox_max_lng": round(bounds[2], 7),
            "center_lat": round(centroid.y, 7),
            "center_lng": round(centroid.x, 7),
            "geojson": json.dumps(mapping(geom)),
        })

    print(f"    產生 {len(records)} 筆記錄")
    return records


def export_to_sql(records: List[Dict[str, Any]], output_path: Path, data_version: str) -> None:
    """匯出為 D1 可用的 SQL 檔案"""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("-- 淹水潛勢圖資匯入 SQL\n")
        f.write(f"-- 產生時間: {datetime.now(timezone.utc).isoformat()}\n")
        f.write(f"-- 資料版本: {data_version}\n")
        f.write(f"-- 筆數: {len(records)}\n\n")

        # 先插入資料源記錄
        f.write("INSERT INTO rrw_data_sources (dataset_name, source_org, source_url, license, license_url, data_version, original_crs, downloaded_at, imported_at, record_count, attribution_text)\n")
        f.write(f"VALUES ('淹水潛勢圖', '經濟部水利署', 'https://data.gov.tw/dataset/25766', '政府資料開放授權 v1', 'https://data.gov.tw/license', '{data_version}', 'EPSG:3826', '{datetime.now(timezone.utc).isoformat()}', '{datetime.now(timezone.utc).isoformat()}', {len(records)}, '資料來源：經濟部水利署淹水潛勢圖。依《水災潛勢資料公開辦法》，此資料僅供防災業務參考。');\n\n")

        for rec in records:
            geojson_escaped = rec["geojson"].replace("'", "''") if rec["geojson"] else "NULL"
            f.write(
                f"INSERT INTO rrw_flood_zones (rainfall_scenario, duration_hours, rainfall_mm, depth_class, county, town, "
                f"bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng, center_lat, center_lng, geojson, data_version) "
                f"VALUES ('{rec['rainfall_scenario']}', {rec['duration_hours']}, {rec['rainfall_mm']}, '{rec['depth_class']}', "
                f"'{rec['county']}', '{rec['town']}', {rec['bbox_min_lat']}, {rec['bbox_min_lng']}, {rec['bbox_max_lat']}, "
                f"{rec['bbox_max_lng']}, {rec['center_lat']}, {rec['center_lng']}, '{geojson_escaped}', '{data_version}');\n"
            )

    print(f"已匯出 SQL: {output_path} ({len(records)} 筆)")


def main():
    parser = argparse.ArgumentParser(description="匯入淹水潛勢圖資")
    parser.add_argument("--input", required=True, help="SHP 檔案目錄")
    parser.add_argument("--output", required=True, help="輸出目錄")
    parser.add_argument("--version", default="2024", help="資料版本")
    parser.add_argument("--mvp-only", action="store_true", help="只匯入 MVP 三種情境 (24h)")
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_dir.exists():
        print(f"錯誤: 輸入目錄不存在: {input_dir}", file=sys.stderr)
        sys.exit(1)

    shp_files = list(input_dir.rglob("*.shp"))
    if not shp_files:
        print(f"錯誤: 在 {input_dir} 找不到 .shp 檔案", file=sys.stderr)
        print("請先從 https://data.gov.tw/dataset/25766 下載淹水潛勢圖", file=sys.stderr)
        sys.exit(1)

    print(f"找到 {len(shp_files)} 個 SHP 檔案")

    all_records = []
    for shp in sorted(shp_files):
        scenario = parse_scenario_from_filename(shp.stem)
        if scenario is None:
            print(f"  跳過 {shp.name}（無法辨識情境）")
            continue
        if args.mvp_only and scenario[0] not in MVP_SCENARIOS:
            print(f"  跳過 {shp.name}（非 MVP 情境）")
            continue
        records = process_shapefile(shp, scenario)
        all_records.extend(records)

    if all_records:
        export_to_sql(all_records, output_dir / "flood_import.sql", args.version)
        print(f"\n完成！共 {len(all_records)} 筆記錄")
        print(f"下一步: wrangler d1 execute rrw-db --local --file={output_dir / 'flood_import.sql'}")
    else:
        print("\n沒有產生任何記錄，請檢查輸入檔案")


if __name__ == "__main__":
    main()
