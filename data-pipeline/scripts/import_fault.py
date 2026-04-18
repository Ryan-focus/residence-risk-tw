"""
活動斷層地質敏感區匯入腳本

資料來源：中央地質調查所 — 地質敏感區範圍（活動斷層）
下載位置：https://data.gov.tw/dataset/100220
格式：SHP（Shapefile）
座標系：TWD97 TM2 (EPSG:3826) → 轉換為 WGS84 (EPSG:4326)

SHP 欄位（dataset 100220 標準）：
    NAME      斷層名稱（含「第一類」或「第二類」）
    公告日     公告日期
    編號       地質敏感區編號（Fxxxx）

斷層等級由 NAME 欄位推斷：
    '第一類' in NAME → fault_class = 1
    '第二類' in NAME → fault_class = 2
    預設 → fault_class = 2

使用方式：
    cd data-pipeline
    python scripts/import_fault.py \\
        --input raw/fault/ \\
        --output processed/fault/fault_import.sql

匯入 D1：
    cd ../api
    wrangler d1 execute rrw-db --local \\
        --file=../data-pipeline/processed/fault/fault_import.sql
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
    from shapely.geometry import mapping
except ImportError:
    print("請先安裝依賴: pip install geopandas shapely", file=sys.stderr)
    sys.exit(1)

try:
    from pyproj import Transformer  # noqa: F401  (geopandas 內部會用)
except ImportError:
    print("請先安裝 pyproj: pip install pyproj", file=sys.stderr)
    sys.exit(1)


# 政府公開 SHP 常見 CRS（依出現頻率排序）
CANDIDATE_CRS = ["EPSG:3826", "EPSG:3857", "EPSG:4326"]


def detect_crs(gdf) -> str:
    """若 SHP 未標記 CRS，試著依 bounds 量級猜測"""
    if gdf.crs is not None:
        return str(gdf.crs)
    minx, miny, maxx, maxy = gdf.total_bounds
    # TWD97 TM2：X ~150k–350k, Y ~2.4M–2.8M
    if 100_000 < minx < 400_000 and 2_000_000 < miny < 3_000_000:
        return "EPSG:3826"
    # Web Mercator：X ~13M, Y ~2.4M–3.3M
    if 10_000_000 < minx < 15_000_000:
        return "EPSG:3857"
    # WGS84：119–123 / 21–26
    if 119 < minx < 123 and 21 < miny < 26:
        return "EPSG:4326"
    # 不確定 — 回傳最常見的
    return "EPSG:3826"


def normalize_tw(s: str) -> str:
    return str(s).replace("臺", "台").strip()


def infer_fault_class(name: str) -> int:
    if "第一類" in name:
        return 1
    return 2


def extract_fault_name(name: str) -> str:
    """從含等級的名稱中取出斷層純名，e.g. '車籠埤斷層第一類活動斷層地質敏感區' → '車籠埤斷層'"""
    # 順序有意義：先長後短，避免短詞先被吃掉
    for kw in [
        "第一類活動斷層地質敏感區範圍",
        "第二類活動斷層地質敏感區範圍",
        "第一類活動斷層地質敏感區",
        "第二類活動斷層地質敏感區",
        "活動斷層地質敏感區範圍",
        "地質敏感區範圍",
        "活動斷層地質敏感區",
        "地質敏感區",
        "第一類活動斷層",
        "第二類活動斷層",
    ]:
        name = name.replace(kw, "")
    return name.strip()


def geom_to_wgs84_bbox_center(geom, src_crs: str):
    """將 src_crs geometry 轉換到 WGS84，回傳 (bbox, center_lng, center_lat, geojson_str)"""
    # 重投影到 WGS84
    geom_wgs84 = gpd.GeoSeries([geom], crs=src_crs).to_crs("EPSG:4326").iloc[0]
    bounds = geom_wgs84.bounds  # (minx, miny, maxx, maxy) = (min_lng, min_lat, max_lng, max_lat)
    centroid = geom_wgs84.centroid

    bbox = {
        "min_lat": round(bounds[1], 7),
        "min_lng": round(bounds[0], 7),
        "max_lat": round(bounds[3], 7),
        "max_lng": round(bounds[2], 7),
    }
    center_lat = round(centroid.y, 7)
    center_lng = round(centroid.x, 7)

    # 簡化幾何以節省 D1 空間（容差 ~10m）
    simplified = geom_wgs84.simplify(0.0001)
    geojson_str = json.dumps(mapping(simplified), ensure_ascii=False)

    return bbox, center_lat, center_lng, geojson_str


def read_shp_with_fallback_encoding(path: Path):
    """政府 SHP 的 DBF 常用 cp950 / Big5 — 先試 cp950，再 utf-8"""
    for enc in ("cp950", "utf-8"):
        try:
            return gpd.read_file(str(path), encoding=enc)
        except Exception:
            continue
    return gpd.read_file(str(path))  # 最後讓原始錯誤拋出


def process_shp(path: Path, out_f: io.TextIOWrapper, stats: dict, default_class: int) -> None:
    try:
        gdf = read_shp_with_fallback_encoding(path)
    except Exception as e:
        print(f"  [ERROR] 無法讀取 {path.name}: {e}", file=sys.stderr)
        return

    src_crs = detect_crs(gdf)
    print(f"  [CRS] 偵測為 {src_crs}（原 crs={gdf.crs}）", file=sys.stderr)

    # 嘗試識別名稱欄位
    name_col = None
    for col in ["NAME", "name", "斷層名稱", "地質敏感區名稱", "FNAME"]:
        if col in gdf.columns:
            name_col = col
            break

    if name_col is None:
        print(f"  [WARN] {path.name} 找不到名稱欄位，可用欄位：{list(gdf.columns)}", file=sys.stderr)
        name_col = gdf.columns[0]

    # MultiPolygon → 逐個 Polygon，避免單一大 bbox 覆蓋整個斷層延伸區
    gdf = gdf.explode(index_parts=False, ignore_index=True)

    batch: list[str] = []

    for _, row in gdf.iterrows():
        if row.geometry is None or row.geometry.is_empty:
            stats["skipped"] += 1
            continue

        raw_name = str(row.get(name_col, "未知斷層"))
        # 優先從名稱推斷；若名稱不含「第一/第二類」字樣則用 --default-class
        if "第一類" in raw_name:
            fault_class = 1
        elif "第二類" in raw_name:
            fault_class = 2
        else:
            fault_class = default_class
        fault_name = normalize_tw(extract_fault_name(raw_name))
        if not fault_name:
            fault_name = normalize_tw(raw_name)

        try:
            bbox, center_lat, center_lng, geojson_str = geom_to_wgs84_bbox_center(row.geometry, src_crs)
        except Exception as e:
            print(f"  [SKIP] 幾何轉換失敗 {fault_name}: {e}", file=sys.stderr)
            stats["skipped"] += 1
            continue

        # 台灣範圍檢查
        if not (21 < center_lat < 26 and 119 < center_lng < 123):
            stats["skipped"] += 1
            continue

        def esc(s: str) -> str:
            return s.replace("'", "''")

        stmt = (
            f"INSERT OR IGNORE INTO rrw_fault_zones "
            f"(fault_name,fault_class,county,bbox_min_lat,bbox_min_lng,bbox_max_lat,bbox_max_lng,"
            f"center_lat,center_lng,data_version) VALUES ("
            f"'{esc(fault_name)}',{fault_class},'全台',"
            f"{bbox['min_lat']},{bbox['min_lng']},{bbox['max_lat']},{bbox['max_lng']},"
            f"{center_lat},{center_lng},"
            f"'{datetime.now().strftime('%Y-%m')}');"
        )
        batch.append(stmt)
        stats["total"] += 1
        stats["by_fault"][fault_name] = fault_class

    if batch:
        # D1 不允許 SQL 層級 BEGIN/COMMIT — 直接寫 INSERT 即可
        for stmt in batch:
            out_f.write(stmt + "\n")
        out_f.write("\n")

    print(f"  {path.name}: {len(batch)} 筆寫入", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="活動斷層 SHP → D1 SQL")
    parser.add_argument("--input",  required=True, help="SHP 資料夾（或單一 .shp 路徑）")
    parser.add_argument("--output", required=True, help="輸出 SQL 檔案路徑")
    parser.add_argument(
        "--default-class", type=int, choices=[1, 2], default=2,
        help="名稱不含『第一/第二類』時的預設類別（dataset 100220 第一類檔案請用 1）",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    shp_files = [input_path] if input_path.suffix == ".shp" else sorted(input_path.glob("**/*.shp"))
    if not shp_files:
        print("錯誤：找不到任何 SHP 檔案", file=sys.stderr)
        sys.exit(1)

    print(f"找到 {len(shp_files)} 個 SHP 檔案", file=sys.stderr)
    stats: dict = {"total": 0, "skipped": 0, "by_fault": {}}

    with open(output_path, "w", encoding="utf-8") as out_f:
        out_f.write("-- 活動斷層地質敏感區匯入\n")
        out_f.write(f"-- 產生時間：{datetime.now(timezone.utc).isoformat()}\n\n")

        for shp in shp_files:
            print(f"處理 {shp.name}...", file=sys.stderr)
            process_shp(shp, out_f, stats, args.default_class)

        out_f.write(
            "INSERT OR REPLACE INTO rrw_data_sources "
            "(dataset_name,source_org,source_url,license,license_url,data_version,"
            "original_crs,downloaded_at,imported_at,record_count,attribution_text) VALUES ("
            "'活動斷層地質敏感區','中央地質調查所',"
            "'https://data.gov.tw/dataset/100220',"
            "'政府資料開放授權條款-第1版',"
            "'https://data.gov.tw/license',"
            f"'{datetime.now().strftime('%Y-%m')}',"
            "'EPSG:3826',"
            f"'{datetime.now(timezone.utc).date().isoformat()}',"
            f"'{datetime.now(timezone.utc).date().isoformat()}',"
            f"{stats['total']},"
            "'資料來源：中央地質調查所活動斷層地質敏感區，政府資料開放授權');\n"
        )

    print(f"\n完成：{stats['total']} 筆寫入，{stats['skipped']} 筆跳過", file=sys.stderr)
    print(f"輸出：{output_path}", file=sys.stderr)
    print("斷層列表：", file=sys.stderr)
    for name, cls in sorted(stats["by_fault"].items()):
        print(f"  第{cls}類 {name}", file=sys.stderr)


if __name__ == "__main__":
    main()
