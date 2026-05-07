# Competitive Visibility Audit

A real-time competitive intelligence tool built with [Next.js](https://nextjs.org), [Bright Data](https://brightdata.com) APIs, and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI. Enter a brand name and location; it discovers the real website, generates grounded keywords, runs parallel SERP + scraping + AI engine queries, and produces an executive audit report with live progress visualization.

> Built for **Brighton SEO 2026** as a Bright Data demo. The [original notebook version](https://github.com/ScrapeAlchemist/Competitive-Visibility-Audit/tree/notebook) used OpenAI + Colab; this is a full rewrite as an interactive web app.

## How it works

| Stage | What happens | Bright Data product |
|-------|-------------|-------------------|
| **0. Brand discovery** | SERP search + Web Unlocker scrape + Claude extract. Pauses for user to confirm the discovered URL. | SERP API, Web Unlocker |
| **1. Keyword generation** | Claude generates 8 buyer-intent keywords grounded in the actual homepage content. | — |
| **2. SERP rankings** | 8 parallel SERP calls, aggregates domain frequency, picks top 5 competitors. | SERP API |
| **3. Homepage extraction** | 6 parallel Web Unlocker scrapes + 6 parallel Claude extractions for brand profiles. | Web Unlocker |
| **4. AI engine mentions** | Queries ChatGPT, Perplexity, Grok, and Gemini via AI Search datasets (3 redundant snapshots each, first-ready wins). | Web Scraper API |
| **5. Deep page scrape** | ~18 parallel Web Unlocker calls on competitor /pricing, /about, /features pages. | Web Unlocker |
| **6. Executive synthesis** | Claude synthesizes all data into findings, gaps, and recommendations. | — |

End-to-end: ~2-3 minutes (varies with target site and API latency).

## Quick start

```bash
git clone https://github.com/ScrapeAlchemist/Competitive-Visibility-Audit.git
cd Competitive-Visibility-Audit
npm install
cp .env.example .env.local
# Fill in your API keys (see below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Prerequisites

- **Node.js** 18+
- **Bright Data account** with API token and configured zones
- **Claude Code CLI** installed and on PATH ([install guide](https://docs.anthropic.com/en/docs/claude-code/getting-started))

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

### Required

| Variable | Description |
|----------|-------------|
| `BRIGHTDATA_API_TOKEN` | Your Bright Data API token |
| `BRIGHTDATA_SERP_ZONE` | SERP API zone name (default: `serp`) |
| `BRIGHTDATA_WEB_UNLOCKER_ZONE` | Web Unlocker zone name (default: `unlocker`) |

### Optional

| Variable | Description |
|----------|-------------|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | SMTP config for the "Email Report" button. Without these, email is disabled. |
| `CLAUDE_CLI_PATH` | Override path to the `claude` binary (default: `claude`) |

## Pre-flight check

Hit `GET /api/audit/warmup` before a demo. It runs one small call against each Bright Data product and confirms Claude CLI is reachable. Returns:

```json
{ "bd": { "serp": true, "unlocker": true }, "claude": true, "email": false }
```

## Bright Data APIs used

| API | Purpose | Docs |
|-----|---------|------|
| **SERP API** | Google search results with structured JSON output | [brightdata.com/products/serp-api](https://brightdata.com/products/serp-api) |
| **Web Unlocker** | Scrape any page through anti-bot protection | [brightdata.com/products/web-unlocker](https://brightdata.com/products/web-unlocker) |
| **Web Scraper API** | AI Search datasets for ChatGPT, Perplexity, Grok, Gemini | [brightdata.com/products/web-scraper](https://brightdata.com/products/web-scraper) |

## Architecture

- **Framework:** Next.js 16 (App Router) with React 19 and Tailwind CSS 4
- **State:** In-memory `Map<auditId, Audit>` on `globalThis` (survives Next.js dev hot-reload)
- **Live updates:** Server-Sent Events at `/api/audit/[id]/stream` with three event types: `log`, `stage`, `audit`
- **Claude integration:** Claude Code CLI spawned as subprocess with `--output-format json --tools "" --no-session-persistence` for pure text-in/JSON-out extraction
- **AI engine racing:** Each engine fires 3 redundant snapshot triggers via BD datasets API; first-ready snapshot wins and gets downloaded
- **Graceful degradation:** Any sub-task failure marks its stage as `partial` and the pipeline continues. The report renders with whatever data made it through.

## Project structure

```
app/
  page.tsx                    # Landing page (brand + location form)
  audit/[id]/page.tsx         # Live audit dashboard
  api/audit/                  # REST + SSE endpoints
lib/
  brightdata.ts               # Bright Data SERP, Web Unlocker, AI Search wrappers
  claude-cli.ts               # Claude Code CLI subprocess wrapper
  audit/pipeline.ts           # 7-stage orchestrator
  audit/stages/               # Individual stage implementations
  audit/state.ts              # In-memory audit state + SSE broadcast
  types.ts                    # Full TypeScript data model
components/                   # Timeline, log stream, report preview, discovery card
```

## License

MIT
