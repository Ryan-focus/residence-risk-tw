"""
解壓 raw/flood/ 裡所有 zip 到 {ZipBasename}-SHP/ 資料夾，
處理 zip 內「單一頂層目錄」與「直接放檔案」兩種結構，
確保最終 raw/flood/{某縣市}-SHP/*.shp 可被 import_flood.py 吃。

用法：
    cd data-pipeline
    python scripts\\extract_flood_zips.py --input raw\\flood\\
    python scripts\\extract_flood_zips.py --input raw\\flood\\ --keep-zip  # 保留原 zip
"""

from __future__ import annotations

import argparse
import io
import shutil
import sys
import zipfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


def extract_one(zip_path: Path, target: Path) -> int:
    """解壓 zip 到 target/，自動處理單一頂層子目錄。回傳 SHP 檔數"""
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)

    tmp = target.parent / f"__tmp_{zip_path.stem}__"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir()

    try:
        # 用 cp950 試解中文檔名（政府 zip 常見），退回系統預設
        with zipfile.ZipFile(zip_path) as z:
            for info in z.infolist():
                try:
                    info.filename = info.filename.encode("cp437").decode("cp950")
                except (UnicodeDecodeError, UnicodeEncodeError):
                    pass
                z.extract(info, tmp)

        # 判斷 tmp 裡面的結構：若只有一個子目錄 → 把它內容當作 content
        entries = [p for p in tmp.iterdir() if not p.name.startswith("__MACOSX")]
        if len(entries) == 1 and entries[0].is_dir():
            source_root = entries[0]
        else:
            source_root = tmp

        for child in source_root.iterdir():
            shutil.move(str(child), str(target / child.name))

    finally:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)

    return len(list(target.glob("*.shp")))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", type=Path, required=True, help="放置 zip 檔的目錄（通常 raw/flood/）")
    ap.add_argument("--keep-zip", action="store_true", help="解壓後保留原 zip")
    args = ap.parse_args()

    if not args.input.exists():
        print(f"ERROR: {args.input} 不存在", file=sys.stderr)
        return 2

    zips = sorted(args.input.glob("*.zip"))
    if not zips:
        print(f"ERROR: {args.input} 內找不到 *.zip", file=sys.stderr)
        return 2

    print(f"找到 {len(zips)} 個 zip\n")

    ok = 0
    fail = 0
    for zip_path in zips:
        base = zip_path.stem
        target = args.input / f"{base}-SHP"
        try:
            shp_count = extract_one(zip_path, target)
            print(f"  [ok] {zip_path.name} -> {target.name}/  ({shp_count} SHP)")
            ok += 1
            if not args.keep_zip:
                zip_path.unlink()
        except Exception as e:
            print(f"  [ERROR] {zip_path.name}: {e}", file=sys.stderr)
            fail += 1

    print(f"\n完成：成功 {ok}，失敗 {fail}")
    if ok > 0:
        print(f"\n下一步：")
        print(f"  python scripts\\import_flood.py --input {args.input} --output processed\\flood\\ --mvp-only")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
