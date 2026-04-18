# Residence Risk TW 住址風險評估系統

整合台灣政府公開資料，輸入地址即可查詢該地點的淹水風險。

**線上版**：https://residence-risk-web.pages.dev

> **免責聲明**：本工具使用經濟部水利署淹水潛勢圖，依《水災潛勢資料公開辦法》，此資料僅供防災業務參考，不構成任何土地使用、購屋、保險等決策依據。

## 功能

- 台灣地址輸入 → 自動地理編碼（Map8 圖霸 / Nominatim，支援模糊比對）
- 淹水風險評估（24 小時 350/500/650mm 三種降雨情境）
- 地震風險評估（活動斷層地質敏感區 + 土壤液化潛勢，斷層 60% / 液化 40%）
- 0-100 分五級評分，附資料來源與免責聲明
- 互動式地圖標記（Leaflet + OpenStreetMap）
- 風險情境明細展開檢視
- 地理編碼結果快取（30 天，僅存 hash 不存原地址）
- RESTful JSON API

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | Next.js 14 (Static Export) + Tailwind CSS |
| 地圖 | Leaflet / react-leaflet + OpenStreetMap |
| 託管（前端） | Cloudflare Pages |
| API | Cloudflare Workers (TypeScript) |
| 資料庫 | Cloudflare D1 (SQLite) |
| 地理編碼 | Nominatim（漸進降級：完整地址 → 路 → 區 → 市） |
| 淹水資料 | 經濟部水利署淹水潛勢圖 (SHP → D1) |
| 地震資料 | 中央地質調查所活動斷層 + 經濟部地調所土壤液化 (SHP/GeoJSON → D1) |
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
cd residence-risk-tw

# API
cd api && npm install

# 前端
cd ../web && npm install
```

### 2. D1 資料庫

```bash
cd api

# 建立 D1（首次）
wrangler d1 create rrw-db
# 將 database_id 填入 wrangler.jsonc

# 套用 schema
wrangler d1 migrations apply rrw-db --local
```

### 3. 匯入淹水資料

```bash
# 建立 Python 虛擬環境
cd data-pipeline
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

### 3c. 匯入歷史地震（CWB 顯著有感地震報告）

歷史地震用於「近 10 年震央 50 km 內」的背景資訊顯示與 `earthquake.reasoning` 佐證。震度推定採 **Method A：最近測站實測**（最近 CWB 測站距查詢點 >15 km 時不推定）。

```bash
cd data-pipeline
export CWB_API_KEY=YOUR_KEY   # 免費申請：https://opendata.cwa.gov.tw/

python scripts/import_earthquake_history.py \
    --output processed/earthquake/earthquake_history_import.sql \
    --limit 200

cd ../api
wrangler d1 execute rrw-db --local \
    --file=../data-pipeline/processed/earthquake/earthquake_history_import.sql
```

> 若不匯入此資料，`earthquake.history.available` 會回 `false`，前端自動顯示「尚未匯入歷史地震資料」提示，其他評分不受影響。

### 3b. 匯入地震資料（活動斷層 + 土壤液化）

```bash
cd data-pipeline/scripts

# 活動斷層地質敏感區（data.gov.tw/dataset/100220，SHP，TWD97）
python import_fault.py \
    --input ../raw/fault/ \
    --output ../processed/fault/fault_import.sql

# 土壤液化潛勢圖（data.gov.tw/dataset/28691，GeoJSON/SHP）
python import_liquefaction.py \
    --input ../raw/liquefaction/ \
    --output ../processed/liquefaction/liquefaction_import.sql

# 寫入 D1
cd ../../api
wrangler d1 execute rrw-db --local --file=../data-pipeline/processed/fault/fault_import.sql
wrangler d1 execute rrw-db --local --file=../data-pipeline/processed/liquefaction/liquefaction_import.sql
```

### 4. 啟動開發伺服器

```bash
# 終端 1：API
cd api
npm run dev
# http://localhost:8787

# 終端 2：前端
cd web
NEXT_PUBLIC_API_BASE_URL=http://localhost:8787/v1 npm run dev
# http://localhost:3000
```

### 5. 測試

```bash
cd api
npm test
```

## 部署

### API（Cloudflare Workers）

```bash
cd api

# 套用遠端 schema（首次）
wrangler d1 migrations apply rrw-db --remote

# 匯入資料到遠端（首次）
wrangler d1 export rrw-db --output data.sql --table rrw_flood_zones --no-schema
wrangler d1 execute rrw-db --remote --file data.sql

# 部署 Worker
wrangler deploy

# 設定 CORS（替換為你的 Pages 網域）
echo "https://your-project.pages.dev" | wrangler secret put ALLOWED_ORIGINS
```

### 前端（Cloudflare Pages）

```bash
cd web

# 建置（替換為你的 API 網域）
NEXT_PUBLIC_API_BASE_URL=https://your-api.workers.dev/v1 npm run build

# 建立 Pages 專案（首次）
wrangler pages project create your-project --production-branch main

# 部署
wrangler pages deploy out --project-name your-project
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
  "earthquake": {
    "score": 86,
    "level": "極高",
    "color": "#ef4444",
    "fault": {
      "score": 90,
      "risks": [
        { "fault_name": "車籠埔斷層", "fault_class": 1, "distance_m": null }
      ]
    },
    "liquefaction": {
      "score": 80,
      "has_data": true,
      "risks": [ { "level": "高", "distance_m": null } ]
    },
    "disclaimer": "..."
  },
  "meta": { "response_ms": 1351 }
}
```

### 錯誤碼

| HTTP | Code | 說明 |
|------|------|------|
| 400 | `INVALID_ADDRESS` | 地址格式無法辨識或超過 200 字 |
| 400 | `INVALID_REQUEST` | 請求格式錯誤 |
| 404 | `ADDRESS_NOT_FOUND` | 地理編碼找不到對應位置 |
| 413 | `PAYLOAD_TOO_LARGE` | 請求內容超過 4KB |
| 500 | `INTERNAL_ERROR` | 伺服器內部錯誤 |

### AI / Agent 友善端點

| 路徑 | 內容 |
|------|------|
| `GET /v1/openapi.json` | OpenAPI 3.1 規格（同步鏡像至前端 `/openapi.json`） |
| `GET /.well-known/ai-plugin.json` | ChatGPT Action / Claude plugin 描述 |
| `GET /.well-known/mcp.json` | MCP server descriptor |
| `GET/POST /mcp` | MCP (JSON-RPC 2.0) streamable-HTTP 端點，暴露 `assess_residence_risk` 工具 |
| `GET /llms.txt` | LLM 索引（API 端） |

前端另外提供 `/llms.txt`、`/llms-full.txt`、`/robots.txt`、`/sitemap.xml`、`/opengraph-image`。詳見 [`AGENTS.md`](AGENTS.md) 與 [`skills/residence-risk/SKILL.md`](skills/residence-risk/SKILL.md)。

## 專案結構

```
residence-risk-tw/
├── api/                        # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts            # 路由、CORS、安全標頭
│   │   ├── geocode.ts          # 地理編碼（Map8 + Nominatim + 快取）
│   │   ├── flood.ts            # 淹水風險查詢與評分
│   │   └── earthquake.ts       # 斷層 + 液化查詢與評分
│   ├── migrations/
│   │   ├── 0001_initial_schema.sql
│   │   └── 0002_earthquake_schema.sql
│   ├── test/
│   └── wrangler.jsonc
├── web/                        # Next.js 前端
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx      # 根佈局（zh-Hant-TW）
│   │   │   └── page.tsx        # 主頁面
│   │   ├── components/
│   │   │   ├── AddressSearch    # 地址輸入
│   │   │   ├── ConsentModal     # 使用須知
│   │   │   ├── DisclaimerBanner # 免責警告列
│   │   │   ├── ResultCard       # 風險分數卡
│   │   │   ├── RiskDetails      # 情境明細表
│   │   │   ├── MapView          # Leaflet 地圖
│   │   │   ├── ResponseMeta     # 回應資訊
│   │   │   └── Footer           # 資料來源連結
│   │   ├── hooks/
│   │   │   └── useAssess.ts     # 查詢狀態管理
│   │   └── lib/
│   │       ├── api.ts           # API 呼叫
│   │       └── types.ts         # TypeScript 型別
│   ├── wrangler.toml
│   └── next.config.mjs
├── data-pipeline/              # 資料匯入工具
│   ├── scripts/
│   │   ├── import_flood.py         # 淹水圖資 SHP → D1 SQL
│   │   ├── import_fault.py         # 活動斷層 SHP → D1 SQL
│   │   ├── import_liquefaction.py  # 土壤液化 GeoJSON/SHP → D1 SQL
│   │   └── coord_transform.py      # TWD97 ↔ WGS84
│   ├── raw/                    # 原始政府資料（不 commit）
│   └── processed/              # 處理後資料（不 commit）
└── docs/                       # 文件（規劃中）
```

## 安全措施

- CORS 白名單透過環境變數管理，不寫死於程式碼
- 安全標頭：`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`
- 請求大小限制（4KB）與地址長度限制（200 字）
- SQL 參數化查詢，防止注入攻擊
- 地址僅以 SHA-256 hash 快取，不儲存原始地址
- 所有敏感資料透過 `.gitignore` 排除

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

## 地震評分標準

**斷層子分數**（取最大值）：

| 條件 | 分數 |
|------|------|
| 點在第一類敏感區內 | 90 |
| 點在第二類敏感區內 | 70 |
| 距第一類 < 200m | 55 |
| 距第二類 < 200m | 45 |
| 距第一類 < 500m | 35 |
| 距第二類 < 500m | 25 |
| 更遠 | 10 |
| 查無資料 | 5 |

**液化子分數**：點在高/中/低潛勢區內 → 80 / 50 / 20；無資料 → 5。

**綜合**：有液化資料時 `0.6 × 斷層 + 0.4 × 液化`；無液化資料的縣市僅用斷層分數。

## 資料來源

| 資料集 | 提供機關 | 授權 |
|--------|----------|------|
| [淹水潛勢圖](https://data.gov.tw/dataset/25766) | 經濟部水利署 | 政府資料開放授權 v1 |
| [活動斷層地質敏感區](https://data.gov.tw/dataset/100220) | 中央地質調查所 | 政府資料開放授權 v1 |
| [土壤液化潛勢圖](https://data.gov.tw/dataset/28691) | 經濟部地質調查及礦業管理中心 | 政府資料開放授權 v1 |
| 地理編碼 | [Map8 台灣圖霸](https://www.map8.zone/) + [OpenStreetMap](https://www.openstreetmap.org/) via Nominatim | Map8 商業 / ODbL |
| 底圖 | [OpenStreetMap](https://www.openstreetmap.org/copyright) | ODbL |

## 開發路線

- [x] API 基礎架構（Workers + D1）
- [x] 淹水潛勢資料匯入（19 縣市）
- [x] 地理編碼（Nominatim + 漸進降級 + 快取）
- [x] 淹水風險評分
- [x] 前端 MVP（地圖 + 查詢 + 結果呈現）
- [x] 雲端部署（Cloudflare Workers + Pages）
- [x] 地震風險（活動斷層 + 土壤液化）
- [ ] 空氣品質風險
- [ ] PDF 報告下載
- [ ] 公開 REST API

## 授權

- 核心引擎：[AGPL-3.0](LICENSE)
- 資料管線：MIT
- 文件：CC BY 4.0
