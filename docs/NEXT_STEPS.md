# Next Steps — D1 size limit & future work

## Current state (as of this PR)

Branch `claude/audit-performance-seo-agents-ItJaA` delivers:

- **SEO + performance**: SSG home page, JSON-LD × 3, `robots.ts`, `sitemap.ts`, `opengraph-image`, expanded metadata, preconnect headers, `next.config` tuning, self-hosted Leaflet marker icons.
- **AI agent surface**: `llms.txt`, `llms-full.txt`, `/.well-known/ai-plugin.json`, `/.well-known/mcp.json`, OpenAPI 3.1 (static at `web/public/openapi.json` + dynamic at `GET /v1/openapi.json`), MCP server at `POST /mcp` (JSON-RPC 2.0) exposing `assess_residence_risk`, root `AGENTS.md`, Claude Code Skill at `skills/residence-risk/SKILL.md`.
- **Reasoning**: `flood.reasoning` / `earthquake.reasoning` natural-language explanations derived from scoring inputs; `<ReasoningList>` UI component rendering `**bold**` subset.
- **Historical earthquakes (Method A — nearest station)**: new migration `0003_earthquake_history.sql`, D1 tables `rrw_earthquake_history` (16 rows imported) + `rrw_earthquake_intensity` (~4 700 rows), Python importer `import_earthquake_history.py`, API `earthquake.history` field, `<EarthquakeHistoryCard>` UI with CWB intensity colour badges.
- **Point-in-polygon correctness**: new `src/geo.ts` with `pointInGeoJSON` (ray casting) + `insideBboxFallback` (adaptive bbox-size heuristic). Rewired `flood.ts` / `earthquake.ts` to use two-stage query (bbox prefilter → geojson fetch for bbox hits only, capped at 8 for flood / 10 for fault+liq to stay within D1 response size).
- **Data pipeline updates**: import scripts now emit `geojson` column, `explode()` MultiPolygons so bboxes are per-polygon (not per-county), iteratively-tightening simplify (up to 0.02°) with 80 KB per-geojson guard for D1 100 KB statement limit.
- **Score refinements**: severity-aware edge scoring (within 30 m of a 350 mm >50cm polygon → 75) to handle geocoder-lands-on-road-centerline edge case.
- **Tests**: 35/35 passing, covering geo helpers, adaptive fallback, flood reasoning, earthquake history (Method A intensity, >15 km exclusion, 10-year filter), MCP handshake.

## Blocker: Workers Free 500 MB D1 limit

After importing the real WRA flood polygons (`--mvp-only`, 3 scenarios × 4 depth classes, 19 counties, `explode()`-d into 827 647 rows), D1 size went to **513 MB** — just over the Workers Free plan's 500 MB cap. Every request now fails with `D1_ERROR: Exceeded maximum DB size` (reads included).

Verified via `wrangler tail`:

```
(error) Unhandled error: Error: D1_ERROR: Exceeded maximum DB size
```

## Two routes to unblock

### Route A — Upgrade to Workers Paid ($5/month)

Gives 10 GB per D1 database. Zero code or data changes required; works immediately after billing activation.

Pros: future-proof (next features — air quality, historical flood events — will keep growing the DB), also raises CPU-time ceiling (10 ms → 30 s/request) which helps parse big geojsons.

Cons: monthly cost.

Action: https://dash.cloudflare.com → Workers & Pages → Plans → Workers Paid.

### Route B — Shrink the database to fit 500 MB (free)

Re-import with tighter parameters. Target: ≤ ~120 MB for flood.

| Change | Saving | Precision impact |
|---|---|---|
| Drop `24h_650mm` scenario | −30 % rows | Only extreme-rain scenario, rarely drives score |
| Drop `0-50cm` depth class | −40 % rows | Keeps the severe depths that dominate scoring |
| Simplify tolerance 0.00005 → 0.0002 (~22 m) | −60 % geojson size | Address-level assessment still fine; matches WRA 40 m raster resolution |

Estimated final: ~330 K rows × ~500 B each ≈ 165 MB. Fits comfortably.

**Action items if picking B** (not yet implemented — left for later):

1. Add `--severe-only` flag to `data-pipeline/scripts/import_flood.py` (skips `0-50cm` records).
2. Change default `--mvp-only` to also drop 650 mm, or add `--scenarios 350,500` parameter.
3. Raise base simplify tolerance in `_SIMPLIFY_TOLERANCES` to start at `0.0002`.
4. Re-download only the 2 needed scenarios (or reuse existing raw files and let the flag filter at import time).
5. Re-run `wrangler d1 execute --file` and verify DB size < 400 MB.

## Other follow-ups (not blockers)

- **Fault zone re-import**: current 36 records still have `geojson = NULL` (only new 新化斷層 has it). `insideBboxFallback` covers them, but a full re-import with `geojson` would make fault proximity judgements exact. Requires redownloading dataset 100220.
- **CWB historical earthquake refresh**: `import_earthquake_history.py` pulls only last-200 events (≈ last 6 months). Add a scheduled Cloudflare Cron Trigger to refresh monthly so `earthquake.history` stays current.
- **Flood score near-polygon tuning**: user test 前鎮中華五路 now scores 65 (was 30 pre-fix). The 350 mm >50cm polygon at 12 m distance would give 75 under the new edge-scoring rule but isn't appearing in results, likely due to `LIMIT 200` bbox truncation in dense urban areas. Could add `ORDER BY (bbox size)` or raise limit.
- **Web deploy**: Pages has not been re-deployed since the SSG + reasoning UI changes. Needs `wrangler pages deploy out --project-name residence-risk-web` after `npm run build`.
