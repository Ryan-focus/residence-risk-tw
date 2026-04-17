# Residence Risk TW 住址風險評估系統

整合台灣政府公開資料，輸入地址即可查詢該地點的淹水風險。

> **免責聲明**：本工具使用經濟部水利署淹水潛勢圖，依《水災潛勢資料公開辦法》，此資料僅供防災業務參考，不構成任何土地使用、購屋、保險等決策依據。

## 功能

- 台灣地址輸入 → 自動地理編碼（Nominatim，支援模糊比對）
- 淹水風險評估（24 小時 350/500/650mm 三種降雨情境）
- 0-100 分五級評分，附資料來源與免責聲明
- 地理編碼結果快取（30 天，僅存 hash 不存原地址）
- RESTful JSON API

## 技術架構

| 層級 | 技術 |
|------|------|
| API | Cloudflare Workers (TypeScript) |
| 資料庫 | Cloudflare D1 (SQLite) |
| 地理編碼 | Nominatim（漸進降級：完整地址 → 路 → 區 → 市） |
| 淹水資料 | 經濟部水利署淹水潛勢圖 (SHP → D1) |
| 座標轉換 | pyproj (TWD97 EPSG:3826 → WGS84 EPSG:4326) |
| 測試 | Vitest + Cloudflare Workers Pool |

## 快速開始

### 前置需求

- Node.js 18+
- Python 3.10+（資料匯入用）
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 1. 安裝

```bash
git clone https://github.com/Ryan-focus/residence-risk-tw.git
cd residence-risk-tw/api
npm install
```

### 2. D1 資料庫

```bash
# 建立 D1（首次）
wrangler d1 create rrw-db
# 將 database_id 填入 wrangler.jsonc

# 套用 schema
wrangler d1 migrations apply rrw-db --local
```

### 3. 匯入淹水資料

```bash
# 建立 Python 虛擬環境
cd ../data-pipeline
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt  # macOS/Linux

# 下載淹水潛勢圖 SHP 到 raw/flood/（見下方資料來源）
# 解壓各縣市 zip

# 匯入（MVP 只處理 24h 三種情境）
cd scripts
python import_flood.py --input ../raw/flood/ --output ../processed/flood/ --mvp-only

# 寫入 D1
cd ../../api
wrangler d1 execute rrw-db --local --file=../data-pipeline/processed/flood/flood_import.sql
```

### 4. 啟動開發伺服器

```bash
cd api
npm run dev
# http://localhost:8787
```

### 5. 測試

```bash
npm test
```

## API 端點

### `GET /v1/health`

健康檢查（含 DB 連線狀態）。

### `GET /v1/meta/versions`

查詢已匯入的資料源版本。

### `POST /v1/assess`

風險評估。

```json
// Request
{ "address": "台北市信義區信義路五段7號" }

// Response
{
  "address": "台北市信義區信義路五段7號",
  "location": {
    "lat": 25.033,
    "lng": 121.567,
    "source": "nominatim",
    "display_name": "信義區, 臺北市, 臺灣"
  },
  "flood": {
    "score": 95,
    "level": "極高",
    "color": "#ef4444",
    "risks": [
      {
        "scenario": "24h_350mm",
        "depth_class": "0-50cm",
        "distance_m": null
      }
    ],
    "disclaimer": "..."
  },
  "meta": { "response_ms": 1351 }
}
```

### 錯誤碼

| HTTP | Code | 說明 |
|------|------|------|
| 400 | `INVALID_ADDRESS` | 地址格式無法辨識 |
| 404 | `ADDRESS_NOT_FOUND` | 地理編碼找不到對應位置 |
| 404 | `REPORT_NOT_FOUND` | 報告不存在或已過期 |
| 500 | `INTERNAL_ERROR` | 伺服器內部錯誤 |

## 專案結構

```
residence-risk-tw/
├── api/                        # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts            # 路由與主入口
│   │   ├── geocode.ts          # 地理編碼（Nominatim + 快取）
│   │   └── flood.ts            # 淹水風險查詢與評分
│   ├── migrations/
│   │   └── 0001_initial_schema.sql
│   ├── test/
│   └── wrangler.jsonc
├── data-pipeline/              # 資料匯入工具
│   ├── scripts/
│   │   ├── import_flood.py     # 淹水圖資 SHP → D1 SQL
│   │   └── coord_transform.py  # TWD97 ↔ WGS84
│   ├── raw/                    # 原始政府資料（不 commit）
│   └── processed/              # 處理後資料（不 commit）
├── web/                        # 前端（規劃中）
└── docs/                       # 文件（規劃中）
```

## 淹水評分標準

依據 v0.2 系統分析文件，採用定量降雨情境（非重現期）：

| 條件 | 分數 | 等級 |
|------|------|------|
| 24h 350mm 淹水 > 50cm | 95 | 極高 |
| 24h 350mm 淹水 0-50cm | 80 | 高 |
| 24h 500mm 淹水 > 50cm | 65 | 中高 |
| 24h 500mm 淹水 0-50cm | 50 | 中 |
| 24h 650mm 才有淹水 | 30 | 低 |
| 距淹水區 < 100m | 20 | 低 |
| 無淹水潛勢 | 5 | 極低 |

## 資料來源

| 資料集 | 提供機關 | 授權 |
|--------|----------|------|
| [淹水潛勢圖](https://data.gov.tw/dataset/25766) | 經濟部水利署 | 政府資料開放授權 v1 |
| 地理編碼 | [OpenStreetMap](https://www.openstreetmap.org/) via Nominatim | ODbL |

## 開發路線

- [x] API 基礎架構（Workers + D1）
- [x] 淹水潛勢資料匯入（19 縣市）
- [x] 地理編碼（Nominatim + 漸進降級 + 快取）
- [x] 淹水風險評分
- [ ] 前端 MVP（地圖 + 查詢 + 結果呈現）
- [ ] 地震風險（活動斷層 + 土壤液化）
- [ ] 空氣品質風險
- [ ] PDF 報告下載
- [ ] 公開 REST API

## 授權

- 核心引擎：[AGPL-3.0](LICENSE)
- 資料管線：MIT
- 文件：CC BY 4.0
