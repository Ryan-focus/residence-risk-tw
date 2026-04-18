"""
從 data.gov.tw 下載淹水潛勢圖 SHP zip 檔（dataset 25766）。

資料來源：經濟部水利署
授權：政府資料開放授權 v1

用法：
    cd data-pipeline
    python scripts\\download_flood.py --output raw\\flood\\

下載完成後會自動解壓各 zip 到 raw/flood/{縣市}-SHP/，可直接給 import_flood.py
吃：

    python scripts\\import_flood.py --input raw\\flood\\ --output processed\\flood\\ --mvp-only
"""

from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

DATASET_ID = 25766
DATASET_API = f"https://data.gov.tw/api/v2/rest/dataset/{DATASET_ID}"


def fetch_resources() -> list[dict]:
    print(f"[api] GET {DATASET_API}")
    req = urllib.request.Request(
        DATASET_API,
        headers={"User-Agent": "residence-risk-tw/1.0 (+github.com/Ryan-focus/residence-risk-tw)"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if "result" in data and "distribution" in data["result"]:
        return data["result"]["distribution"]
    if "result" in data and "resources" in data["result"]:
        return data["result"]["resources"]
    raise RuntimeError(f"Unexpected API response: {list(data.keys())}")


def download_file(url: str, dest: Path) -> None:
    print(f"[dl]  {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "residence-risk-tw/1.0"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        dest.write_bytes(resp.read())


def extract_zip(zip_path: Path, out_dir: Path) -> Path | None:
    try:
        with zipfile.ZipFile(zip_path) as z:
            names = z.namelist()
            top_level = {n.split("/", 1)[0] for n in names if n.strip("/")}
            if len(top_level) == 1 and any(n.endswith("/") for n in names if n.startswith(next(iter(top_level)) + "/")):
                z.extractall(out_dir.parent)
                return out_dir.parent / next(iter(top_level))
            out_dir.mkdir(parents=True, exist_ok=True)
            z.extractall(out_dir)
            return out_dir
    except zipfile.BadZipFile:
        print(f"  [WARN] {zip_path.name} 不是有效 zip（可能是 HTML 錯誤頁）")
        return None


def guess_county(name: str, url: str) -> str:
    text = f"{name} {url}"
    m = re.search(
        r"(TaipeiCity|NewTaipeiCity|TaoyuanCity|TaichungCity|TainanCity|KaohsiungCity(?:V4)?|"
        r"KeelungCity|HsinchuCity|HsinchuCounty|ChiayiCity|ChiayiCounty|MiaoliCounty|"
        r"ChanghuaCounty|NantouCounty|YunlinCounty|PingtungCounty|YilanCounty|"
        r"HualienCounty|TaitungCounty|PenghuCounty|KinmenCounty|RenjiCounty|LienchiangCounty)",
        text,
        re.IGNORECASE,
    )
    return m.group(1) if m else ""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--output", type=Path, required=True, help="下載目的目錄（建議 raw/flood/）")
    ap.add_argument("--keep-zip", action="store_true", help="保留解壓後的 zip 檔")
    ap.add_argument("--dry-run", action="store_true", help="只列出 resource URLs，不實際下載")
    args = ap.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)

    try:
        resources = fetch_resources()
    except Exception as e:
        print(f"ERROR: 無法取得 dataset metadata: {e}", file=sys.stderr)
        print(
            "解決方法：到 https://data.gov.tw/dataset/25766 手動下載各縣市 zip，"
            "解壓到 raw/flood/{縣市}-SHP/ 後直接跑 import_flood.py",
            file=sys.stderr,
        )
        return 2

    print(f"[api] 找到 {len(resources)} 個 resource")
    zip_resources = [
        r for r in resources
        if (r.get("format", "") or r.get("mediaType", "")).lower() in ("zip", "application/zip", "application/x-zip-compressed")
        or str(r.get("resourceDownloadUrl", r.get("url", ""))).lower().endswith(".zip")
    ]
    print(f"[api] 其中 zip 類型: {len(zip_resources)} 個\n")

    if args.dry_run:
        for r in zip_resources:
            print(f"  {r.get('resourceDescription', r.get('name', '?'))} -> {r.get('resourceDownloadUrl', r.get('url', '?'))}")
        return 0

    ok, fail = 0, 0
    for r in zip_resources:
        url = r.get("resourceDownloadUrl") or r.get("url")
        desc = r.get("resourceDescription") or r.get("name") or "?"
        if not url:
            continue
        county = guess_county(desc, url) or re.sub(r"[^A-Za-z]", "", desc) or "Unknown"
        dest_dir_name = f"{county}-SHP"
        zip_path = args.output / f"{county}.zip"

        try:
            download_file(url, zip_path)
            extracted = extract_zip(zip_path, args.output / dest_dir_name)
            if extracted:
                if extracted.name != dest_dir_name:
                    target = args.output / dest_dir_name
                    if target.exists():
                        shutil.rmtree(target)
                    extracted.rename(target)
                print(f"  [ok]  {dest_dir_name}/")
                ok += 1
            else:
                fail += 1
        except Exception as e:
            print(f"  [ERROR] {desc}: {e}", file=sys.stderr)
            fail += 1
        finally:
            if not args.keep_zip and zip_path.exists():
                zip_path.unlink()

    print(f"\n完成：成功 {ok}，失敗 {fail}")
    print(f"下一步：python scripts\\import_flood.py --input {args.output} --output processed\\flood\\ --mvp-only")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
