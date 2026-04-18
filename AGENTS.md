# Agent & AI Integration Guide

This repo is designed to be both a working Cloudflare web app and a clean, discoverable target for AI agents (Claude, ChatGPT, Perplexity, Cursor, etc.).

## TL;DR for agents

- **Tool purpose**: flood + earthquake risk assessment for Taiwan residential addresses
- **Input**: traditional-Chinese address (e.g. `台北市信義區信義路五段7號`)
- **Output**: `{ flood: {score 0-100, level}, earthquake: {score 0-100, level}, location, disclaimer }`
- **Not for**: legal, real-estate, insurance, or lending decisions — include the disclaimer verbatim

## Discovery surface

| Surface | URL (production) |
|---|---|
| Main site (SSG + JSON-LD) | https://residence-risk-web.pages.dev/ |
| OpenAPI 3.1 | https://residence-risk-web.pages.dev/openapi.json <br/> https://residence-risk-api.workers.dev/v1/openapi.json |
| AI plugin manifest | https://residence-risk-web.pages.dev/.well-known/ai-plugin.json |
| `llms.txt` (short) | https://residence-risk-web.pages.dev/llms.txt |
| `llms-full.txt` (long) | https://residence-risk-web.pages.dev/llms-full.txt |
| Sitemap | https://residence-risk-web.pages.dev/sitemap.xml |
| `robots.txt` | https://residence-risk-web.pages.dev/robots.txt |
| MCP server | https://residence-risk-api.workers.dev/mcp |
| MCP descriptor | https://residence-risk-api.workers.dev/.well-known/mcp.json |

## How to invoke

### Plain REST

```bash
curl -sS https://residence-risk-api.workers.dev/v1/assess \
  -H 'Content-Type: application/json' \
  -d '{"address":"台北市信義區信義路五段7號"}'
```

### Claude Agent SDK / Claude Code Skill

Copy `skills/residence-risk/` into a Claude Code project's `.claude/skills/` directory. The skill's `description` frontmatter steers invocation when users ask flood/earthquake questions about Taiwan addresses.

### MCP clients (Claude Desktop, Cursor, Windsurf…)

```json
{
  "mcpServers": {
    "residence-risk": {
      "url": "https://residence-risk-api.workers.dev/mcp"
    }
  }
}
```

Exposes one tool: `assess_residence_risk({ address })` via streamable-HTTP JSON-RPC 2.0.

### OpenAI GPTs / ChatGPT Actions

Point an Action at `https://residence-risk-web.pages.dev/openapi.json`. Auth: none.

## Repository structure for agents

- `api/` — Cloudflare Workers + D1 API. See `api/AGENTS.md` for Cloudflare-specific rules.
- `web/` — Next.js 14 static export (Cloudflare Pages). SEO, JSON-LD, `llms.txt`, `robots.ts`, `sitemap.ts` all live here.
- `data-pipeline/` — Python scripts converting government SHP / GeoJSON → D1 SQL.
- `skills/` — Reusable Claude Code Skill manifests. Each subdir is a self-contained `SKILL.md`.

## Editing guidance for AI agents working in this repo

- Use `npm run test` inside `api/` (vitest + workers pool) before committing API changes.
- Use `npm run build` inside `web/` to validate the static export.
- Never commit real MAP8 API keys; dev config in `api/wrangler.jsonc` uses an empty string.
- Do not remove the disclaimer strings or bypass the 4 KB / 200 char guards.
- When adding a new risk dimension, update: D1 schema, import script, API module, OpenAPI spec (`api/src/openapi.ts` + `web/public/openapi.json`), `llms-full.txt`, and scoring table in `README.md`.
