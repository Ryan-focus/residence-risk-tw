"""
座標轉換工具 — TWD97 (EPSG:3826) ↔ WGS84 (EPSG:4326)

v0.2 補強 §2.4：政府圖資幾乎全部是 TWD97，前端用 WGS84。
這件事沒處理好，風險分數會全部偏移一個縣市。

使用方式：
    pip install pyproj
    python coord_transform.py --test
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Tuple

try:
    from pyproj import Transformer
except ImportError:
    print("請先安裝 pyproj: pip install pyproj", file=sys.stderr)
    sys.exit(1)

# TWD97 / TM2 zone 121 → WGS84
_to_wgs84 = Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)
_to_twd97 = Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True)


def twd97_to_wgs84(x: float, y: float) -> Tuple[float, float]:
    """TWD97 (EPSG:3826) 座標 → WGS84 (lng, lat)"""
    lng, lat = _to_wgs84.transform(x, y)
    return round(lng, 7), round(lat, 7)


def wgs84_to_twd97(lng: float, lat: float) -> Tuple[float, float]:
    """WGS84 (lng, lat) → TWD97 (EPSG:3826) 座標"""
    x, y = _to_twd97.transform(lng, lat)
    return round(x, 2), round(y, 2)


# 已知地標驗證點
TEST_POINTS = [
    {
        "name": "台北101",
        "twd97": (302573.0, 2770409.0),
        "wgs84_expected": (121.5637, 25.0340),
        "tolerance_m": 50,
    },
    {
        "name": "高雄85大樓",
        "twd97": (176591.0, 2500841.0),
        "wgs84_expected": (120.3012, 22.6108),
        "tolerance_m": 50,
    },
]


def run_tests() -> bool:
    """驗證座標轉換正確性"""
    all_passed = True
    for pt in TEST_POINTS:
        lng, lat = twd97_to_wgs84(*pt["twd97"])
        exp_lng, exp_lat = pt["wgs84_expected"]
        # 粗略檢查（0.001 度 ≈ 111m）
        ok = abs(lng - exp_lng) < 0.005 and abs(lat - exp_lat) < 0.005
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {pt['name']}: ({lng}, {lat}) expected ~({exp_lng}, {exp_lat})")
        if not ok:
            all_passed = False

    # 往返測試
    x, y = 250000.0, 2650000.0
    lng, lat = twd97_to_wgs84(x, y)
    x2, y2 = wgs84_to_twd97(lng, lat)
    roundtrip_ok = abs(x - x2) < 1 and abs(y - y2) < 1
    status = "PASS" if roundtrip_ok else "FAIL"
    print(f"  [{status}] 往返測試: ({x},{y}) → ({lng},{lat}) → ({x2},{y2})")
    if not roundtrip_ok:
        all_passed = False

    return all_passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TWD97 ↔ WGS84 座標轉換")
    parser.add_argument("--test", action="store_true", help="執行驗證測試")
    parser.add_argument("--to-wgs84", nargs=2, type=float, metavar=("X", "Y"), help="TWD97 → WGS84")
    parser.add_argument("--to-twd97", nargs=2, type=float, metavar=("LNG", "LAT"), help="WGS84 → TWD97")
    args = parser.parse_args()

    if args.test:
        print("座標轉換驗證測試：")
        ok = run_tests()
        sys.exit(0 if ok else 1)
    elif args.to_wgs84:
        lng, lat = twd97_to_wgs84(*args.to_wgs84)
        print(json.dumps({"lng": lng, "lat": lat}))
    elif args.to_twd97:
        x, y = wgs84_to_twd97(*args.to_twd97)
        print(json.dumps({"x": x, "y": y}))
    else:
        parser.print_help()
