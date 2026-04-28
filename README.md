# Competitive Visibility Audit

Brighton SEO 2026 demo for Bright Data. Enter a **brand name + location**; the app discovers the real website, grounds keyword generation in what the company actually does today, and produces a parallelized competitive audit with a live timeline of every Bright Data call.

## How it works

```
Stage 0: Brand discovery       SERP -> Web Unlocker -> Claude extract
                               (PAUSE for user to confirm URL)
Stage 1: Keyword generation    Claude (8 buyer-intent queries grounded in homepage)
Stage 2: SERP rankings         8 parallel BD SERP calls -> aggregate top 5 competitors
Stage 3: Homepage extraction   6 parallel BD Unlocker -> 6 parallel Claude profiles
Stage 4: AI engine mentions    4 parallel queries (Perplexity + Gemini live; ChatGPT/Grok stubbed)
Stage 5: Deep page scrape      ~18 parallel BD Unlocker on /pricing /about /features
Stage 6: Executive synthesis   Claude over the full aggregated context
```

End-to-end: ~90-180s live (varies with target site weight and Claude latency).

## Setup

```bash
npm install
cp .env.example .env.local
# Fill in BRIGHTDATA_API_TOKEN + zone names + (later) SMTP_*
npm run dev
```

Open http://localhost:3000.

## Required env vars

- `BRIGHTDATA_API_TOKEN` - your BD API token
- `BRIGHTDATA_SERP_ZONE` - SERP zone (default `serp`)
- `BRIGHTDATA_WEB_UNLOCKER_ZONE` - Web Unlocker zone (default `unlocker`)

## Optional env vars

- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` - for `Email Report`. Without these, the Email Report button is disabled.
- `CLAUDE_CLI_PATH` - override path to the `claude` binary (defaults to `claude` on PATH)

## Pre-flight check

Before running a demo, hit `/api/audit/warmup` - it does one tiny call against each Bright Data product and confirms Claude CLI is callable. Returns `{ bd: { serp, unlocker }, claude, email }`.

## Architecture notes

- **State:** in-memory `Map<auditId, AuditEnvelope>` attached to `globalThis` to survive Next.js dev hot-reload.
- **Live updates:** Server-Sent Events via `/api/audit/[id]/stream`. Three event kinds: `log`, `stage`, `audit`. The client dedupes log entries by id.
- **Claude CLI:** spawned with `claude -p --output-format json --tools "" --no-session-persistence --system-prompt <strict-JSON-prompt>` so Claude treats it as pure text-in / text-out, no tool use.
- **AI engines:** Perplexity uses the public search URL via Web Unlocker. Gemini routes through Google's AI Overviews UDM. ChatGPT and Grok require BD's Web Scraper API datasets - not configured here, so they fail cleanly without breaking the parallel visualization.
- **Graceful degradation:** any sub-task failure marks the stage as `partial` and the pipeline keeps going; the report renders with whatever data made it through.

## Demo tips for Brighton SEO

- **Stage 0 narrative:** "We didn't ask the LLM what your company does, we read your actual site." Emphasizes how grounded keywords differ from what the LLM might invent from stale training data.
- **Stage 2 visual:** 8 parallel SERP pills lighting up at once is the cleanest "look at this parallelism" moment.
- **Stage 4 narrative:** "Here's what 4 different AI assistants think your category looks like" - genuinely BD-unique even with two engines partial.
- **Stage 5 visual:** ~18 parallel pages. Highest sub-task density, makes the BD scale point visually.

## Tested verdict

Linear (United States) audit completes in ~3min, finds 5 real competitors (Atlassian, Atono, Shortcut, monday.com, ScraperAPI variants), extracts pricing from competitor `/pricing` pages, and produces specific recommendations like "no visible alternative pages — competitors and review sites dominate buyer research".
