"""
歷史顯著有感地震報告匯入腳本（中央氣象署 CWB E-A0015）

資料來源：中央氣象署開放資料平台
  https://opendata.cwa.gov.tw/dataset/earthquake/E-A0015-001
  （顯著有感地震報告，JSON／XML／PDF）

需要：免費 CWB API 授權碼（到 opendata.cwa.gov.tw 註冊即可取得）

兩種來源（擇一）：
  1) 網路抓取：設定 CWB_API_KEY 環境變數，腳本會自動呼叫 E-A0015-001 API
  2) 本地檔案：用 --input 指定已下載的 JSON 檔（可放整個資料夾，每個 .json
     代表一次 API 回應）

產出：單一 SQL 檔，`INSERT OR REPLACE` 進 rrw_earthquake_history
      與 `INSERT` 進 rrw_earthquake_intensity。

使用方式：

    cd data-pipeline

    # 路線 A：透過 API 抓最新 200 筆
    export CWB_API_KEY=YOUR_KEY
    python scripts/import_earthquake_history.py \\
        --output processed/earthquake/earthquake_history_import.sql \\
        --limit 200

    # 路線 B：從本地 JSON 檔抓
    python scripts/import_earthquake_history.py \\
        --input raw/earthquake_history/ \\
        --output processed/earthquake/earthquake_history_import.sql

匯入 D1：

    cd ../api
    wrangler d1 execute rrw-db --local \\
        --file=../data-pipeline/processed/earthquake/earthquake_history_import.sql

備註：CWB E-A0015 JSON 的欄位在近幾年曾微幅調整（例如 EpicenterLatitude vs
EpicenterLatitude），本腳本對常見變體做了寬鬆解析；若 CWB 再次調整欄位，
請提 issue 附上原始 JSON 片段。
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

CWB_API_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0015-001"


# ---------- 解析 helpers ----------

def _pick(d: dict, *keys: str, default: Any = None) -> Any:
    """Return the first non-None value among given keys (tolerate CWB schema drift)."""
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return default


def parse_origin_time(s: str | None) -> str | None:
    """CWB 多數回傳 'YYYY-MM-DD HH:MM:SS'（台北時間 UTC+8）。轉成 ISO UTC。"""
    if not s:
        return None
    try:
        # 若 CWB 回 'YYYY/MM/DD HH:MM:SS'，也能處理
        normalized = s.replace("/", "-")
        dt = datetime.fromisoformat(normalized)
        # 視為 UTC+8 台北時間
        if dt.tzinfo is None:
            from datetime import timezone as tz, timedelta
            dt = dt.replace(tzinfo=tz(timedelta(hours=8)))
        return dt.astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError):
        return s  # 存原字串，避免整筆丟失


def iter_events_from_response(resp: dict) -> Iterable[dict]:
    """CWB E-A0015 回應結構兼容 records 下的多種包裝。"""
    records = resp.get("records", resp)
    if isinstance(records, dict):
        eq = _pick(records, "Earthquake", "earthquake", default=[])
        if isinstance(eq, list):
            yield from eq
        elif isinstance(eq, dict):
            yield eq


def iter_shaking_stations(event: dict) -> Iterable[tuple[str, dict]]:
    """
    產生 (intensity_level, station_dict) 序列。

    CWB 結構：Intensity.ShakingArea[].EqStation[]  但不同版本有時在
    EarthquakeInfo.Intensity 底下。
    """
    intensity = _pick(event, "Intensity", default=None)
    if not intensity:
        info = event.get("EarthquakeInfo", {}) or {}
        intensity = info.get("Intensity")
    if not intensity:
        return

    areas = _pick(intensity, "ShakingArea", "shakingArea", default=[]) or []
    for area in areas:
        # AreaDesc 格式如「最大震度 6 強地區」；真正的 level 在 AreaIntensity
        level = _pick(area, "AreaIntensity", "areaIntensity")
        stations = _pick(area, "EqStation", "eqStation", default=[]) or []
        if not level:
            # fallback: 從 AreaDesc 抓
            desc = _pick(area, "AreaDesc", "areaDesc", default="") or ""
            m = re.search(r"震度\s*([0-9]+[強弱]?|[0-9]+)", desc)
            if m:
                level = m.group(1)
        if not level:
            continue
        for st in stations:
            yield level, st


def station_pga(st: dict) -> float | None:
    """從 pga/PGA 複合欄位擷取合成 PGA；找不到回 None。"""
    pga = _pick(st, "pga", "PGA", default=None)
    if pga is None:
        return None
    if isinstance(pga, (int, float)):
        return float(pga)
    if isinstance(pga, dict):
        # CWB 常見結構：{"EWComponent": ..., "NSComponent": ..., "VComponent": ...}
        # 取兩水平分量的最大值
        ew = _pick(pga, "EWComponent", "ewComponent")
        ns = _pick(pga, "NSComponent", "nsComponent")
        vals = [v for v in (ew, ns) if isinstance(v, (int, float))]
        if vals:
            return float(max(vals))
        # 或 {"IntScaleValue": X} 這種
        val = _pick(pga, "IntScaleValue")
        if isinstance(val, (int, float)):
            return float(val)
    return None


# ---------- SQL escaping ----------

def esc_str(s: str | None) -> str:
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def esc_num(n: Any) -> str:
    if n is None:
        return "NULL"
    try:
        return repr(float(n))
    except (TypeError, ValueError):
        return "NULL"


# ---------- main ----------

def fetch_api(api_key: str, limit: int) -> dict:
    import urllib.parse
    import urllib.request

    qs = urllib.parse.urlencode({
        "Authorization": api_key,
        "limit": str(limit),
        "format": "JSON",
    })
    url = f"{CWB_API_URL}?{qs}"
    print(f"[fetch] GET {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_local(path: Path) -> list[dict]:
    """Load one or more CWB JSON response files."""
    if path.is_file():
        files = [path]
    else:
        files = sorted(path.glob("*.json"))
    out: list[dict] = []
    for f in files:
        print(f"[load] {f}", file=sys.stderr)
        with f.open(encoding="utf-8") as fh:
            out.append(json.load(fh))
    return out


def build_sql(events: list[dict], data_version: str) -> list[str]:
    sql: list[str] = [
        "-- Auto-generated by import_earthquake_history.py",
        f"-- Generated at {datetime.now(timezone.utc).isoformat()}",
        f"-- Event count: {len(events)}",
        "BEGIN TRANSACTION;",
    ]
    for ev in events:
        info = _pick(ev, "EarthquakeInfo", "earthquakeInfo", default={}) or {}
        epi = _pick(info, "Epicenter", "epicenter", default={}) or {}
        mag = _pick(info, "EarthquakeMagnitude", "earthquakeMagnitude", default={}) or {}

        eq_no = str(_pick(ev, "EarthquakeNo", "earthquakeNo", default=""))
        if not eq_no:
            continue

        origin_time = parse_origin_time(_pick(info, "OriginTime", "originTime"))
        depth = _pick(info, "FocalDepth", "focalDepth")
        magnitude = _pick(mag, "MagnitudeValue", "magnitudeValue")
        lat = _pick(epi, "EpicenterLatitude", "epicenterLatitude")
        lng = _pick(epi, "EpicenterLongitude", "epicenterLongitude")
        location = _pick(epi, "Location", "location")
        source_url = _pick(ev, "ReportImageURI", "Web", "reportImageURI", "reportURI")

        if origin_time is None or lat is None or lng is None or magnitude is None:
            print(f"[skip] incomplete event {eq_no}", file=sys.stderr)
            continue

        sql.append(
            "INSERT OR REPLACE INTO rrw_earthquake_history "
            "(earthquake_no, origin_time, magnitude, depth_km, epicenter_lat, epicenter_lng, "
            "location_description, source_url, data_version) VALUES ("
            f"{esc_str(eq_no)}, {esc_str(origin_time)}, {esc_num(magnitude)}, {esc_num(depth)}, "
            f"{esc_num(lat)}, {esc_num(lng)}, {esc_str(location)}, {esc_str(source_url)}, {esc_str(data_version)});"
        )

        # 先清掉這筆地震的舊測站資料，避免重覆匯入累積
        sql.append(
            f"DELETE FROM rrw_earthquake_intensity WHERE earthquake_no = {esc_str(eq_no)};"
        )

        for intensity_level, st in iter_shaking_stations(ev):
            station_code = _pick(st, "StationID", "stationID", "StationCode")
            station_name = _pick(st, "StationName", "stationName")
            county = _pick(st, "StationCounty", "stationCounty")
            st_lat = _pick(st, "StationLatitude", "stationLatitude")
            st_lng = _pick(st, "StationLongitude", "stationLongitude")
            pga = station_pga(st)
            st_intensity = _pick(st, "SeismicIntensity", "seismicIntensity", default=intensity_level)

            if not station_name or st_lat is None or st_lng is None:
                continue

            sql.append(
                "INSERT INTO rrw_earthquake_intensity "
                "(earthquake_no, station_code, station_name, county, station_lat, station_lng, pga_gal, intensity_level) "
                "VALUES ("
                f"{esc_str(eq_no)}, {esc_str(station_code)}, {esc_str(station_name)}, {esc_str(county)}, "
                f"{esc_num(st_lat)}, {esc_num(st_lng)}, {esc_num(pga)}, {esc_str(st_intensity)});"
            )

    sql.append("COMMIT;")
    return sql


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", type=Path, help="本地 CWB JSON 檔或目錄（path B）")
    ap.add_argument("--output", type=Path, required=True, help="產出的 D1 SQL 檔路徑")
    ap.add_argument("--limit", type=int, default=200, help="（path A）API 拉取筆數")
    ap.add_argument(
        "--data-version",
        default=datetime.now(timezone.utc).strftime("%Y-%m"),
        help="資料版本標籤（預設今年今月）",
    )
    args = ap.parse_args()

    responses: list[dict]
    if args.input:
        responses = load_local(args.input)
    else:
        api_key = os.environ.get("CWB_API_KEY", "").strip()
        if not api_key:
            print(
                "ERROR: 未提供 --input，且環境變數 CWB_API_KEY 為空。\n"
                "請到 https://opendata.cwa.gov.tw/ 註冊取得免費授權碼。",
                file=sys.stderr,
            )
            return 2
        responses = [fetch_api(api_key, args.limit)]

    events: list[dict] = []
    for resp in responses:
        events.extend(iter_events_from_response(resp))

    print(f"[parse] {len(events)} events loaded", file=sys.stderr)

    sql_lines = build_sql(events, args.data_version)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as fh:
        fh.write("\n".join(sql_lines) + "\n")

    print(f"[write] {args.output} ({len(sql_lines)} lines)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
