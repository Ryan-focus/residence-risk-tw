"""
下載土壤液化潛勢 GeoJSON

讀取 data.gov.tw dataset 28691 發布的 CSV 目錄，
逐一下載 geologycloud.tw 上的 GeoJSON 到 raw/liquefaction/geojson/。

檔名格式：{area}_{level}.geojson  e.g. 臺北_低.geojson

使用方式：
    cd data-pipeline
    python scripts/download_liquefaction.py \\
        --csv raw/liquefaction/1697349470275uVhFVYaG.csv \\
        --output raw/liquefaction/geojson/
"""

from __future__ import annotations

import argparse
import csv
import io
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

USER_AGENT = "ResidenceRiskTW/0.2 (open-source; https://github.com/Ryan-focus/residence-risk-tw)"
REQUEST_DELAY_S = 0.5  # 對公開 API 友善些


def extract_params(url: str) -> tuple[str, str]:
    """從 URL 拆出 area 與 classify（已是解碼後的中文）"""
    qs = urllib.parse.urlparse(url).query
    params = urllib.parse.parse_qs(qs)
    area = params.get("area", [""])[0]
    classify = params.get("classify", [""])[0]
    return area, classify


def classify_to_level(classify: str) -> str:
    """「低潛勢」→「低」"""
    if "低" in classify:
        return "低"
    if "中" in classify:
        return "中"
    if "高" in classify:
        return "高"
    return classify


def download(url: str, out_path: Path) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
    except Exception as e:
        print(f"  [ERROR] {e}", file=sys.stderr)
        return False

    # 快速驗證是 JSON
    if not data.strip().startswith(b"{"):
        print(f"  [ERROR] 非 JSON 回應（首 80 bytes）: {data[:80]!r}", file=sys.stderr)
        return False

    out_path.write_bytes(data)
    print(f"  ✓ {out_path.name} ({len(data):,} bytes)", file=sys.stderr)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="下載土壤液化 GeoJSON")
    parser.add_argument("--csv", required=True, help="目錄 CSV（dataset 28691）")
    parser.add_argument("--output", required=True, help="輸出資料夾")
    parser.add_argument("--skip-existing", action="store_true", help="已存在的檔案不重新下載")
    args = parser.parse_args()

    csv_path = Path(args.csv)
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    # CSV 第一欄可能含 BOM
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"CSV 總共 {len(rows)} 列", file=sys.stderr)
    stats = {"ok": 0, "skipped": 0, "failed": 0}

    for i, row in enumerate(rows, 1):
        url = row.get("資源網址", "").strip()
        if not url:
            stats["failed"] += 1
            continue

        area, classify = extract_params(url)
        if not area or not classify:
            print(f"  [{i}] [SKIP] 無法解析 area/classify：{url}", file=sys.stderr)
            stats["failed"] += 1
            continue

        level = classify_to_level(classify)
        fname = f"{area}_{level}.geojson"
        out_path = out_dir / fname

        if args.skip_existing and out_path.exists():
            print(f"  [{i}] ⏭  {fname}（已存在）", file=sys.stderr)
            stats["skipped"] += 1
            continue

        print(f"  [{i}/{len(rows)}] {area} / {level}", file=sys.stderr)
        if download(url, out_path):
            stats["ok"] += 1
        else:
            stats["failed"] += 1

        time.sleep(REQUEST_DELAY_S)

    print(
        f"\n完成：{stats['ok']} 成功 / {stats['skipped']} 跳過 / {stats['failed']} 失敗",
        file=sys.stderr,
    )
    print(f"輸出：{out_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
