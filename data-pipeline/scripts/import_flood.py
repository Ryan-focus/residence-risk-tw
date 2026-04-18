"""
淹水潛勢圖資匯入腳本

資料來源：經濟部水利署 — 淹水潛勢圖
下載位置：https://data.gov.tw/dataset/25766
格式：SHP（各縣市分檔，每縣市 10 種降雨情境）
座標系：TWD97 (EPSG:3826) → 匯入時轉換為 WGS84 (EPSG:4326)

實際欄位結構：
  - GRIDCODE: int (1-6) 淹水深度等級
  - type: str 淹水深度範圍 (e.g. '0-0.3', '0.3-0.5', '0.5-1', '1-2', '2-3', '3+')
  - geometry: MultiPolygon

檔名格式：{duration}h{rainfall}r.shp (e.g. 24h350r.shp)
資料夾格式：{CountyName}-SHP/

使用方式：
    cd data-pipeline/scripts
    ../.venv/Scripts/python import_flood.py --input ../raw/flood/ --output ../processed/flood/
    # MVP 只匯入 24h 三種情境：
    ../.venv/Scripts/python import_flood.py --input ../raw/flood/ --output ../processed/flood/ --mvp-only
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import io
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Any, Tuple

# Windows console UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

try:
    import geopandas as gpd
except ImportError:
    print("請先安裝依賴: pip install geopandas pyproj shapely", file=sys.stderr)
    sys.exit(1)

# 縣市英文→中文對照
COUNTY_NAMES = {
    "TaipeiCity": "臺北市",
    "NewTaipeiCity": "新北市",
    "TaoyuanCity": "桃園市",
    "TaichungCity": "臺中市",
    "TainanCity": "臺南市",
    "KaohsiungCity": "高雄市",
    "KaohsiungCityV4": "高雄市",
    "KeelungCity": "基隆市",
    "HsinchuCity": "新竹市",
    "HsinchuCounty": "新竹縣",
    "ChiayiCity": "嘉義市",
    "ChiayiCounty": "嘉義縣",
    "MiaoliCounty": "苗栗縣",
    "ChanghuaCounty": "彰化縣",
    "NantouCounty": "南投縣",
    "YunlinCounty": "雲林縣",
    "PingtungCounty": "屏東縣",
    "YilanCounty": "宜蘭縣",
    "HualienCounty": "花蓮縣",
    "TaitungCounty": "臺東縣",
    "PenghuCounty": "澎湖縣",
    "KinmenCounty": "金門縣",
    "RenjiCounty": "連江縣",
}

# 降雨情境解析 — 支援所有已知檔名格式：
#   6h150r, 06h150r, 06hr150, 06hr150mm, 06hr_150mm,
#   PT06H150mm, tp_06h_r150_polygon_class_1,
#   ty_06h_150mm, yl_06h_r150_polygon_class,
#   12h200, 12Hr200r, 12H200R, N12H300R, rastert_n246502_Dissolve
SCENARIO_PATTERNS = [
    # prefix_DDh_rDDD_suffix or prefix_DDh_DDDmm
    re.compile(r"(\d{1,2})[Hh]r?[_]?[rR]?(\d{3})", re.IGNORECASE),
    # DDhDDDr (e.g. 6h150r, 24h350r)
    re.compile(r"(\d{1,2})h(\d{3})r?$", re.IGNORECASE),
    # DDhrDDD (e.g. 06hr150, 06hr350)
    re.compile(r"(\d{1,2})hr[_]?(\d{3})", re.IGNORECASE),
    # N12H300R
    re.compile(r"N(\d{1,2})H(\d{3})R", re.IGNORECASE),
]

# MVP 聚焦 24 小時三種情境
MVP_SCENARIOS = {(24, 350), (24, 500), (24, 650)}

# Cloudflare D1 remote per-statement 上限 **100 KB**；geojson 留 80 KB 緩衝
_GEOJSON_MAX_CHARS = 80_000
_SIMPLIFY_TOLERANCES = (0.00005, 0.0001, 0.0003, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02)


def _build_safe_flood_geojson(geom) -> str | None:
    for tol in _SIMPLIFY_TOLERANCES:
        try:
            s_geom = geom.simplify(tolerance=tol, preserve_topology=True)
            if s_geom is None or s_geom.is_empty:
                continue
            s = json.dumps(s_geom.__geo_interface__, separators=(",", ":"), ensure_ascii=False)
            if len(s) <= _GEOJSON_MAX_CHARS:
                return s
        except Exception:
            continue
    return None

# type 欄位 → 標準深度分類
def normalize_depth(type_val: str) -> str:
    """將 SHP 的 type 欄位轉為標準深度分類"""
    t = str(type_val).strip()
    if t in ("0-0.3", "0.3-0.5"):
        return "0-50cm"
    elif t in ("0.5-1",):
        return "50-100cm"
    elif t in ("1-2",):
        return "100-200cm"
    elif t in ("2-3", "3+", "3-5", "5+"):
        return ">200cm"
    return t


def process_county_dir(
    county_dir: Path, mvp_only: bool
) -> Tuple[str, List[Dict[str, Any]]]:
    """處理一個縣市資料夾"""
    # 從資料夾名推斷縣市
    dir_name = county_dir.name.replace("-SHP", "")
    county = COUNTY_NAMES.get(dir_name, dir_name)

    shp_files = sorted(county_dir.glob("*.shp"))
    if not shp_files:
        print(f"  跳過 {county_dir.name}（無 .shp 檔案）")
        return county, []

    records = []
    for shp_path in shp_files:
        duration, rainfall = None, None
        for pat in SCENARIO_PATTERNS:
            m = pat.search(shp_path.stem)
            if m:
                duration = int(m.group(1))
                rainfall = int(m.group(2))
                break

        if duration is None:
            # 最後嘗試：檔名中找 DDDmm 或 rDDD
            print(f"  跳過 {shp_path.name}（無法辨識情境）")
            continue

        if mvp_only and (duration, rainfall) not in MVP_SCENARIOS:
            continue

        scenario = f"{duration}h_{rainfall}mm"
        print(f"  {county} / {scenario}...", end=" ")

        try:
            gdf = gpd.read_file(shp_path)
        except Exception as e:
            print(f"讀取失敗: {e}")
            continue

        # 轉座標系
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)

        count = 0
        for _, row in gdf.iterrows():
            geom = row.geometry
            if geom is None or geom.is_empty:
                continue

            bounds = geom.bounds  # (minx, miny, maxx, maxy) = (min_lng, min_lat, max_lng, max_lat)
            centroid = geom.centroid
            depth_class = normalize_depth(row.get("type", "unknown"))

            # 儲存完整 polygon 供 Worker 做真正 point-in-polygon 判定。
            # 有些淹水區（沿海平原或整條河川流域）polygon 非常大，單一 INSERT
            # 可能撞到 D1/SQLite 的 ~1MB 語句上限；漸進加重 simplify，
            # 仍超出就回 None（Worker 走 centroid-fallback 模式）。
            geojson_str = _build_safe_flood_geojson(geom)

            records.append({
                "rainfall_scenario": scenario,
                "duration_hours": duration,
                "rainfall_mm": rainfall,
                "depth_class": depth_class,
                "county": county,
                "bbox_min_lat": round(bounds[1], 7),
                "bbox_min_lng": round(bounds[0], 7),
                "bbox_max_lat": round(bounds[3], 7),
                "bbox_max_lng": round(bounds[2], 7),
                "center_lat": round(centroid.y, 7),
                "center_lng": round(centroid.x, 7),
                "geojson": geojson_str,
            })
            count += 1

        print(f"{count} 筆")

    return county, records


def _sql_escape(s: str) -> str:
    return s.replace("'", "''")


def export_to_sql(records: List[Dict[str, Any]], output_path: Path, data_version: str) -> None:
    """匯出為 D1 可用的 SQL 檔案"""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("-- 淹水潛勢圖資匯入 SQL\n")
        f.write(f"-- 產生時間: {datetime.now(timezone.utc).isoformat()}\n")
        f.write(f"-- 資料版本: {data_version}\n")
        f.write(f"-- 筆數: {len(records)}\n\n")

        # 先清掉舊資料（同一 data_version 重複匯入時保持冪等）
        f.write("DELETE FROM rrw_flood_zones;\n\n")

        # 資料源記錄
        now = datetime.now(timezone.utc).isoformat()
        f.write(
            f"INSERT INTO rrw_data_sources (dataset_name, source_org, source_url, license, license_url, "
            f"data_version, original_crs, downloaded_at, imported_at, record_count, attribution_text) "
            f"VALUES ('淹水潛勢圖', '經濟部水利署', 'https://data.gov.tw/dataset/25766', "
            f"'政府資料開放授權 v1', 'https://data.gov.tw/license', '{data_version}', 'EPSG:3826', "
            f"'{now}', '{now}', {len(records)}, "
            f"'資料來源：經濟部水利署淹水潛勢圖。依《水災潛勢資料公開辦法》，此資料僅供防災業務參考。');\n\n"
        )

        # 淹水區記錄 — 每筆一條 INSERT（geojson 字串可能很長，不適合多值 INSERT）
        for rec in records:
            geojson_val = (
                f"'{_sql_escape(rec['geojson'])}'" if rec.get("geojson") else "NULL"
            )
            f.write(
                "INSERT INTO rrw_flood_zones (rainfall_scenario, duration_hours, rainfall_mm, "
                "depth_class, county, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng, "
                "center_lat, center_lng, geojson, data_version) VALUES ("
                f"'{rec['rainfall_scenario']}', {rec['duration_hours']}, {rec['rainfall_mm']}, "
                f"'{rec['depth_class']}', '{_sql_escape(rec['county'])}', "
                f"{rec['bbox_min_lat']}, {rec['bbox_min_lng']}, {rec['bbox_max_lat']}, {rec['bbox_max_lng']}, "
                f"{rec['center_lat']}, {rec['center_lng']}, {geojson_val}, '{data_version}');\n"
            )
        f.write("\n")

    print(f"\n已匯出: {output_path}")
    print(f"  筆數: {len(records)}")
    size_kb = output_path.stat().st_size / 1024
    print(f"  大小: {size_kb:.0f} KB")


def main():
    parser = argparse.ArgumentParser(description="匯入淹水潛勢圖資（SHP → D1 SQL）")
    parser.add_argument("--input", required=True, help="SHP 資料夾根目錄（含各縣市子目錄）")
    parser.add_argument("--output", required=True, help="SQL 輸出目錄")
    parser.add_argument("--version", default="2024", help="資料版本")
    parser.add_argument("--mvp-only", action="store_true", help="只匯入 24h 三種情境 (350/500/650mm)")
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    county_dirs = sorted([d for d in input_dir.iterdir() if d.is_dir() and d.name.endswith("-SHP")])
    if not county_dirs:
        print(f"錯誤: 在 {input_dir} 找不到 *-SHP 資料夾", file=sys.stderr)
        sys.exit(1)

    mode = "MVP (24h: 350/500/650mm)" if args.mvp_only else "完整 (10 種情境)"
    print(f"匯入模式: {mode}")
    print(f"找到 {len(county_dirs)} 個縣市\n")

    all_records = []
    for county_dir in county_dirs:
        county, records = process_county_dir(county_dir, args.mvp_only)
        all_records.extend(records)

    if all_records:
        sql_file = output_dir / "flood_import.sql"
        export_to_sql(all_records, sql_file, args.version)
        print(f"\n下一步:")
        print(f"  cd api")
        print(f"  npx wrangler d1 execute rrw-db --local --file=../data-pipeline/processed/flood/flood_import.sql")
    else:
        print("\n沒有產生任何記錄")


if __name__ == "__main__":
    main()
