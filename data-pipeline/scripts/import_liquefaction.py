"""
土壤液化潛勢圖匯入腳本

資料來源：經濟部地質調查及礦業管理中心 — 土壤液化潛勢圖
下載位置：https://data.gov.tw/dataset/28691
格式：GeoJSON 或 SHP
座標系：TWD97 TM2 (EPSG:3826) 或 WGS84 (EPSG:4326)，腳本自動偵測

GeoJSON 屬性欄位（dataset 28691 標準）：
    LP        液化潛勢等級，'高'/'中'/'低' 或 'H'/'M'/'L' 或數值 1/2/3
    COUNTY    縣市名稱（或從檔名推斷）
    TOWN      鄉鎮市區（可選）

使用方式：
    cd data-pipeline
    python scripts/import_liquefaction.py \\
        --input raw/liquefaction/ \\
        --output processed/liquefaction/liquefaction_import.sql

匯入 D1：
    cd ../api
    wrangler d1 execute rrw-db --local \\
        --file=../data-pipeline/processed/liquefaction/liquefaction_import.sql
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    import geopandas as gpd
    from shapely.geometry import mapping, shape
except ImportError:
    print("請先安裝依賴: pip install geopandas shapely", file=sys.stderr)
    sys.exit(1)


def normalize_tw(s: str) -> str:
    return str(s).replace("臺", "台").strip()


# 液化等級正規化
LP_MAP: dict[str, str] = {
    "高": "高", "H": "高", "HIGH": "高", "3": "高",
    "中": "中", "M": "中", "MED": "中", "MEDIUM": "中", "2": "中",
    "低": "低", "L": "低", "LOW": "低", "1": "低", "0": "低",
    "高潛勢": "高", "中潛勢": "中", "低潛勢": "低",
}


def normalize_level(raw) -> str | None:
    key = str(raw).strip().upper()
    # 優先原始字（避免 upper 誤傷中文）
    if str(raw).strip() in LP_MAP:
        return LP_MAP[str(raw).strip()]
    return LP_MAP.get(key)


# geologycloud.tw 使用的 area → 台灣縣市 對照（單一縣市時用）
AREA_TO_COUNTY: dict[str, str] = {
    "臺北": "台北市",       # 含新北市，這裡以主要縣市表示
    "基隆": "基隆市",
    "桃園": "桃園市",
    "新竹": "新竹縣",       # 含新竹市
    "苗栗": "苗栗縣",
    "臺中": "台中市",
    "彰化": "彰化縣",
    "南投": "南投縣",
    "雲林": "雲林縣",
    "嘉義": "嘉義縣",       # 含嘉義市
    "臺南": "台南市",
    "高雄": "高雄市",
    "屏東": "屏東縣",
    "恆春半島": "屏東縣",
    "宜蘭": "宜蘭縣",
    "花蓮": "花蓮縣",
    "臺東": "台東縣",
}


def county_from_filename(stem: str) -> str:
    """檔名格式 '臺北_低' → '台北市'"""
    area = stem.split("_")[0]
    return normalize_tw(AREA_TO_COUNTY.get(area, area))


def process_file(path: Path, out_f: io.TextIOWrapper, stats: dict) -> None:
    try:
        gdf = gpd.read_file(str(path))
    except Exception as e:
        print(f"  [ERROR] 無法讀取 {path.name}: {e}", file=sys.stderr)
        return

    # 重投影至 WGS84
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        try:
            gdf = gdf.to_crs("EPSG:4326")
        except Exception as e:
            print(f"  [ERROR] 重投影失敗 {path.name}: {e}", file=sys.stderr)
            return

    # 偵測液化等級欄位（含 geologycloud.tw 的「分級」/「classify」）
    level_col = None
    for col in ["分級", "LP", "lp", "LEVEL", "level", "液化潛勢", "潛勢等級", "LiqLevel", "classify"]:
        if col in gdf.columns:
            level_col = col
            break
    if level_col is None:
        print(f"  [WARN] {path.name} 找不到液化等級欄位，可用欄位：{list(gdf.columns)}", file=sys.stderr)
        return

    # 偵測縣市欄位（可選）
    county_col = next((c for c in ["COUNTY", "county", "縣市", "COUNTYNAME"] if c in gdf.columns), None)
    district_col = next((c for c in ["TOWN", "town", "鄉鎮市區", "TOWNNAME"] if c in gdf.columns), None)

    # 從檔名推斷縣市（fallback）— geologycloud.tw 下載檔名格式：'臺北_低' → '台北市'
    filename_county = county_from_filename(path.stem) if "_" in path.stem else ""

    # MultiPolygon → 逐個 Polygon（避免一個超大 bbox 覆蓋整個縣市）
    exploded = gdf.explode(index_parts=False, ignore_index=True)

    batch: list[str] = []

    for _, row in exploded.iterrows():
        if row.geometry is None or row.geometry.is_empty:
            stats["skipped"] += 1
            continue

        level = normalize_level(row.get(level_col, ""))
        if not level:
            stats["skipped"] += 1
            continue

        county = normalize_tw(row[county_col]) if county_col else filename_county
        district = normalize_tw(row[district_col]) if district_col and row.get(district_col) else ""

        bounds = row.geometry.bounds  # (min_lng, min_lat, max_lng, max_lat)
        centroid = row.geometry.centroid

        # 台灣範圍檢查
        if not (21 < centroid.y < 26 and 119 < centroid.x < 123):
            stats["skipped"] += 1
            continue

        # geojson 欄位 API 未讀取 — 為避免 D1 statement 過長，先不存
        def esc(s: str) -> str:
            return s.replace("'", "''")

        stmt = (
            f"INSERT OR IGNORE INTO rrw_liquefaction_zones "
            f"(level,county,district,bbox_min_lat,bbox_min_lng,bbox_max_lat,bbox_max_lng,"
            f"center_lat,center_lng,data_version) VALUES ("
            f"'{level}','{esc(county)}','{esc(district)}',"
            f"{round(bounds[1],7)},{round(bounds[0],7)},{round(bounds[3],7)},{round(bounds[2],7)},"
            f"{round(centroid.y,7)},{round(centroid.x,7)},"
            f"'{datetime.now().strftime('%Y-%m')}');"
        )
        batch.append(stmt)
        stats["total"] += 1
        stats["by_level"][level] = stats["by_level"].get(level, 0) + 1

    if batch:
        # D1 不允許 SQL 層級 BEGIN/COMMIT — 直接寫 INSERT 即可
        for stmt in batch:
            out_f.write(stmt + "\n")
        out_f.write("\n")

    print(f"  {path.name}: {len(batch)} 筆寫入", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="土壤液化潛勢 GeoJSON/SHP → D1 SQL")
    parser.add_argument("--input",  required=True, help="資料夾（或單一 GeoJSON/SHP 檔案路徑）")
    parser.add_argument("--output", required=True, help="輸出 SQL 檔案路徑")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if input_path.is_file():
        data_files = [input_path]
    else:
        data_files = sorted(
            list(input_path.glob("**/*.geojson")) +
            list(input_path.glob("**/*.json")) +
            list(input_path.glob("**/*.shp"))
        )

    if not data_files:
        print("錯誤：找不到任何 GeoJSON/SHP 檔案", file=sys.stderr)
        sys.exit(1)

    print(f"找到 {len(data_files)} 個檔案", file=sys.stderr)
    stats: dict = {"total": 0, "skipped": 0, "by_level": {}}

    with open(output_path, "w", encoding="utf-8") as out_f:
        out_f.write("-- 土壤液化潛勢圖匯入\n")
        out_f.write(f"-- 產生時間：{datetime.now(timezone.utc).isoformat()}\n\n")

        for f in data_files:
            print(f"處理 {f.name}...", file=sys.stderr)
            process_file(f, out_f, stats)

        out_f.write(
            "INSERT OR REPLACE INTO rrw_data_sources "
            "(dataset_name,source_org,source_url,license,license_url,data_version,"
            "original_crs,downloaded_at,imported_at,record_count,attribution_text) VALUES ("
            "'土壤液化潛勢圖','經濟部地質調查及礦業管理中心',"
            "'https://data.gov.tw/dataset/28691',"
            "'政府資料開放授權條款-第1版',"
            "'https://data.gov.tw/license',"
            f"'{datetime.now().strftime('%Y-%m')}',"
            "'EPSG:4326',"
            f"'{datetime.now(timezone.utc).date().isoformat()}',"
            f"'{datetime.now(timezone.utc).date().isoformat()}',"
            f"{stats['total']},"
            "'資料來源：經濟部地質調查及礦業管理中心土壤液化潛勢圖，政府資料開放授權');\n"
        )

    print(f"\n完成：{stats['total']} 筆寫入，{stats['skipped']} 筆跳過", file=sys.stderr)
    for lvl, cnt in sorted(stats["by_level"].items()):
        print(f"  {lvl}潛勢：{cnt:,} 筆", file=sys.stderr)
    print(f"輸出：{output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
