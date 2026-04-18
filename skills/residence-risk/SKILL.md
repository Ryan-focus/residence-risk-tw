---
name: residence-risk
description: Assess flood and earthquake risk for a Taiwanese residential address. Use when the user asks about flood/淹水/淹水風險, earthquake/地震/斷層/液化/土壤液化 risk for a specific Taiwan address (e.g. "台北市信義區XX路" or "幫我看這個地址會不會淹水"). Calls the public Residence Risk TW API and returns a 0-100 score per hazard. Do NOT use for non-Taiwan addresses, legal/real-estate/insurance decisions, or generic weather/earthquake forecasts.
---

# residence-risk skill

## What this skill does

Calls the Residence Risk TW public API (`POST /v1/assess`) to evaluate flood and earthquake risk for any Taiwan address. Returns structured scores (0–100), five-level labels (極低 / 低 / 中 / 高 / 極高), scenario breakdowns, and a geocoded `{lat, lng}`.

Data sources (Taiwan government open data):

- 經濟部水利署 — 淹水潛勢圖（24h 350/500/650 mm 三種降雨情境）
- 中央地質調查所 — 活動斷層地質敏感區
- 經濟部地質調查及礦業管理中心 — 土壤液化潛勢圖

## When to use

Use when the user asks about any of:

- 「這個地址會不會淹水？」/ flood risk for a Taiwan address
- 「這裡地震風險如何？」/「有沒有斷層？」/「會不會液化？」
- Comparing two Taiwan addresses by disaster risk
- 搬家 / 租屋 / 買房前的防災參考（搭配強調僅供參考）

## When NOT to use

- 非台灣地址 → 回傳 `ADDRESS_NOT_FOUND`，請改用其他工具
- 法律、保險核保、金融授信、不動產交易決策 → 本 API 明確不適用
- 即時天氣 / 地震預報 → 本工具只看歷史潛勢圖資

## How to call

### REST (recommended)

```bash
curl -sS https://residence-risk-api.workers.dev/v1/assess \
  -H 'Content-Type: application/json' \
  -d '{"address":"台北市信義區信義路五段7號"}'
```

Full spec: <https://residence-risk-api.workers.dev/v1/openapi.json>

### MCP (for Claude Desktop, Cursor etc.)

The API exposes a streamable-HTTP MCP server at `POST /mcp` with one tool:

- `assess_residence_risk({ address: string })`

Client config example:

```json
{
  "mcpServers": {
    "residence-risk": {
      "url": "https://residence-risk-api.workers.dev/mcp"
    }
  }
}
```

### Response shape (abridged)

```json
{
  "address": "台北市信義區信義路五段7號",
  "location": { "lat": 25.033, "lng": 121.567, "source": "nominatim", "display_name": "..." },
  "flood": {
    "score": 95, "level": "極高", "color": "#ef4444",
    "risks": [...],
    "reasoning": ["綜合判定：**極高**風險...", "此地點在 24h 350mm 即會淹水..."],
    "disclaimer": "..."
  },
  "earthquake": {
    "score": 86, "level": "極高", "color": "#ef4444",
    "fault":        { "score": 90, "risks": [...] },
    "liquefaction": { "score": 80, "has_data": true, "risks": [...] },
    "history": {
      "available": true, "radius_km": 50, "years_back": 10,
      "events": [{
        "earthquake_no": "2022137",
        "origin_time": "2022-09-18T06:44:15Z",
        "magnitude": 6.8, "depth_km": 7.0,
        "epicenter_distance_km": 42.3,
        "location_description": "台東縣政府北方44.7公里",
        "estimated_intensity": {
          "level": "6強", "method": "nearest_station",
          "nearest_station": { "name": "池上", "distance_km": 3.2, "pga_gal": 420.1 }
        }
      }]
    },
    "reasoning": ["綜合判定：**極高**風險...", "**斷層：位於第一類活動斷層...**", "**液化：...**", "**歷史地震佐證：...**"],
    "disclaimer": "..."
  },
  "meta": { "response_ms": 1351, "api_version": "0.2.0" },
  "disclaimer": "..."
}
```

Key fields for agents:
- `flood.reasoning` / `earthquake.reasoning` are arrays of natural-language explanations (contain `**bold**` markdown). **Always present these to the user** — they are the "why" behind the score.
- `earthquake.history.events[].estimated_intensity` uses **Method A: nearest-station measured intensity** (CWB station within 15 km of the address). `null` when no station is close enough — don't extrapolate.
- `earthquake.history.available === false` means the administrator has not yet imported CWB historical data; respond with "此功能暫不可用" or similar.

## Scoring reference

Flood (max across scenarios): 24h 350mm 淹水 > 50cm → 95; 0-50cm → 80; 24h 500mm > 50cm → 65; 0-50cm → 50; only at 650mm → 30; within 100m → 20; none → 5.

Earthquake: `fault = max(inside class1 → 90, inside class2 → 70, <200m class1 → 55, <200m class2 → 45, <500m class1 → 35, <500m class2 → 25, else → 10, no data → 5)`; `liquefaction = 高/中/低 → 80/50/20, no data → 5`; combined = `0.6*fault + 0.4*liq` (fault-only when liquefaction data unavailable for that county).

Levels: 81–100 極高 / 61–80 高 / 41–60 中 / 21–40 低 / 0–20 極低.

## Agent usage guidelines

1. **Always include the disclaimer** from the response in your final answer.
2. **Rate limit**: do not exceed ~1 req/s per address — geocoding upstream (Nominatim) will throttle.
3. **Language**: the API expects 繁體中文 addresses. Translate English addresses to Chinese before calling (縣市 / 區 / 路 / 號).
4. **Errors**: on `ADDRESS_NOT_FOUND`, ask the user to clarify with 縣市 + 區; on `INVALID_ADDRESS`, shorten to ≤ 200 chars.
5. **Presentation**: prefer the `level` label (極低 / 低 / 中 / 高 / 極高) and include the numeric score; show scenario breakdowns on request.
6. **Batching**: no batch endpoint — loop sequentially for multiple addresses.

## Example prompt → call

User: "幫我看台中市西區臺灣大道二段 2 號的淹水和地震風險"

Call: `POST /v1/assess` with `{"address":"台中市西區臺灣大道二段2號"}`, then summarize:

> 此地址（台中市西區臺灣大道二段2號）的淹水風險為「中」(50/100)，在 24h 500mm 降雨情境下會有 0–50cm 淹水；地震風險為「低」(25/100)，距離第二類活動斷層約 430m，尚無土壤液化資料。本結果僅供防災參考，不構成不動產或保險決策依據。

## Resources

- Docs & source: <https://github.com/Ryan-focus/residence-risk-tw>
- OpenAPI: <https://residence-risk-api.workers.dev/v1/openapi.json>
- LLM index: <https://residence-risk-web.pages.dev/llms-full.txt>
- License: AGPL-3.0（core）/ MIT（data pipeline）
