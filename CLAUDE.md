# Competitive Visibility Audit — Operator Guide

You are operating a Next.js demo app for **Bright Data** at SEO/marketing events. A booth visitor enters a brand + location; the app discovers the real homepage, generates buyer-intent keywords grounded in that homepage, runs a parallelized competitive audit via Bright Data SERP / Web Unlocker / AI Search dataset APIs and the Claude CLI, and produces an executive report — end-to-end in ~90-180s.

This file is the operator's brief. `README.md` is the user-facing pitch; this is what you (Claude) need to know to keep the demo running smoothly during a live event.

**Tone:** practitioner. The app owner is Rafael (DevRel at Bright Data). Direct, no corporate fluff.

## Quick start

```bash
npm install
cp .env.example .env.local       # then fill in real values - see below
npm run dev                      # http://localhost:3001
curl http://localhost:3001/api/audit/warmup    # all four should be true
```

Production mode (less console noise, faster):
```bash
npm run build && npm run start
```

If `npm install` fails on a fresh machine: this is Next.js 16 + React 19, requires **Node 20+**.

**Port note (Rafael's machine):** Port 3000 is permanently occupied by `devrel_engine`. The npm `dev` and `start` scripts both pass `-p 3001` so the app binds to 3001 by default. Don't change the scripts back to bare `next dev`/`next start` — `next start` does not auto-fall-back like `next dev` does, it errors with `EADDRINUSE`. On a machine where 3000 is free, just edit the port number in [package.json](package.json) `scripts` (a `PORT=` env var won't work because Next.js loads `.env.local` after binding the port).

## Required tools on the host

1. **Node 20+** and npm
2. **Claude Code CLI** on PATH (or set `CLAUDE_CLI_PATH` env). The app spawns `claude -p --output-format json --tools "" --no-session-persistence` for every extraction. Install: `npm install -g @anthropic-ai/claude-code`
3. **A Bright Data account** with SERP and Web Unlocker zones provisioned. The AI engine stage uses BD's AI Search dataset APIs — those are accessed via the same API token, no extra zone needed.

## Required env vars (`.env.local`)

```
BRIGHTDATA_API_TOKEN=          # Bright Data dashboard -> API keys
BRIGHTDATA_SERP_ZONE=serp      # name of the SERP zone in the BD account
BRIGHTDATA_WEB_UNLOCKER_ZONE=unlocker
```

Optional:
```
SMTP_HOST=                     # for the "Email report" button. Without, button is disabled but audits still work.
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_SECURE=false
CLAUDE_CLI_PATH=               # only if `claude` isn't on PATH
AUDIT_LOG_DIR=                 # override per-run disk snapshot location (default: ./audit)
```

`.env.local` is gitignored. Never commit secrets.

## Pre-flight: warmup

Before any demo session, hit `/api/audit/warmup` once. It does a tiny call against each Bright Data product and confirms Claude CLI is callable. Returns:

```json
{ "bd": { "serp": true, "unlocker": true }, "claude": true, "email": true }
```

- `bd.serp` / `bd.unlocker` false → check API token and zone names
- `claude` false → CLI not on PATH or not authenticated
- `email` false → SMTP vars missing (non-blocking for audits)

First warmup takes ~7s because Claude CLI cold-starts; subsequent calls are fast.

## Architecture

```
Stage 0: Brand discovery       SERP -> Web Unlocker -> Claude extract
                               (PAUSES for user to confirm URL)
Stage 1: Keyword generation    Claude Opus (8 buyer-intent queries grounded in homepage)
Stage 2: SERP rankings         8 parallel BD SERP -> aggregate competitors -> Claude listicle filter
Stage 3: Homepage extraction   6 parallel BD Unlocker -> 6 parallel Claude profiles + internal-link capture
Stage 4: AI engine mentions    4 parallel BD AI Search dataset queries (Perplexity / ChatGPT / Grok / Gemini)
Stage 5: Deep page scrape      Claude Haiku picks best /pricing /about /features from real link list -> ~18 parallel BD Unlocker
Stage 6: Executive synthesis   Claude Opus over the full aggregated context
```

- **State**: in-memory `Map<auditId, AuditEnvelope>` attached to `globalThis` to survive Next.js dev hot-reload.
- **Live updates**: Server-Sent Events at `/api/audit/[id]/stream`. Three event kinds: `log`, `stage`, `audit`. The client dedupes log entries by id.
- **Disk persistence**: per-audit folder at `audit/<auditId>/` (gitignored) with `audit.json`, `logs.jsonl`, `report.json`, `report.html`. Fire-and-forget — never blocks the pipeline.
- **Graceful degradation**: per-sub-task failure marks its stage as `partial` and the pipeline keeps going. Final audit can be `complete` / `partial` / `failed`.

## File map

```
app/
  page.tsx                          - Landing form (brand + location)
  audit/[id]/page.tsx               - Live audit view (SSE consumer)
  api/audit/route.ts                - POST: start audit
  api/audit/[id]/route.ts           - GET: audit status snapshot
  api/audit/[id]/stream/route.ts    - SSE event stream
  api/audit/[id]/confirm/route.ts   - Confirm or override discovered URL
  api/audit/[id]/email/route.ts     - Send report via SMTP
  api/audit/warmup/route.ts         - Pre-flight check
components/
  DiscoveryCard.tsx                 - Stage 0 / "We found you" UI
  AuditTimeline.tsx                 - Pipeline status with sub-task pills
  LogStream.tsx                     - Live activity rail
  ReportPreview.tsx                 - 5-tab final report (overview / SERP / competitors / AI / recs)
lib/
  brightdata.ts                     - BD SERP + Web Unlocker + AI Search dataset wrappers
  claude.ts                         - Anthropic Messages API wrapper, robust JSON parser
  email.ts                          - SMTP via nodemailer (lazy-config)
  locale.ts                         - Country code helpers
  report-html.ts                    - Inline-styled HTML for email
  types.ts                          - All shared types live here
  audit/
    state.ts                        - In-memory state, event subscription, log+stage tracking
    pipeline.ts                     - Phase A (discovery) + Phase B (stages 1-6) orchestrator
    persistence.ts                  - Per-audit disk snapshots
    stages/                         - one file per stage
```

## Demo flow at a booth

Narrative beats to lean on:
- **Stage 0:** "We didn't ask the LLM what your company does — we read your actual site." (Grounding > guessing)
- **Stage 2:** 8 parallel SERP pills lighting up = best "look at this parallelism" moment
- **Stage 4:** "Here's what 4 AI assistants think your category looks like" — genuinely BD-unique
- **Stage 5:** ~18 parallel deep-page scrapes = highest sub-task density on screen

Tested known-good input: `Linear` / `United States` (~3 min, finds Atlassian / Atono / Shortcut / monday.com).

## Common operations

**Run an audit programmatically (smoke test):**
```bash
curl -s -X POST http://localhost:3000/api/audit \
  -H 'Content-Type: application/json' \
  -d '{"brandName":"Linear","location":"United States"}'
# returns { "auditId": "..." } — then visit /audit/<id> in a browser
# or curl /api/audit/<id> for the JSON snapshot
```

**Inspect a past audit on disk:**
```bash
ls audit/<auditId>/
cat audit/<auditId>/audit.json | jq '.status, .error'
tail audit/<auditId>/logs.jsonl
```

**Why did an audit fail?**
1. Check `audit/<id>/audit.json` for `status` and `error`
2. Check `logs.jsonl` for the last `BD_FAIL` or `CLAUDE_FAIL` event
3. Hit `/api/audit/warmup` to confirm BD + Claude are callable now
4. BD `403` or empty body = the proxy zone refused the target. Some sites are flat-blocked (e.g. brightdata.com itself)

## Known quirks and failure modes

- **EventSource auto-reconnect**: client does NOT close the SSE on transient errors so flaky WiFi survives. Closes cleanly only on terminal status. Do not "fix" this back.
- **Stage 0 has a 90s global timeout** (`lib/audit/pipeline.ts: DISCOVERY_TIMEOUT_MS`). Discovery card won't pulse forever.
- **Per-task failures don't kill the pipeline.** Stages mark themselves `partial` and continue. Final audit status = `partial` if any stage was partial.
- **`unlockUrl` rejects bodies under 200 chars** as policy blocks. Usually correct; a tiny real landing page could trip it.
- **Server restart loses in-flight audits.** State is in-memory; disk snapshots are written but not reloaded on cold boot. Don't restart mid-event.
- **`audits` Map on `globalThis` never GCs.** Restart between events or accept slow memory creep.
- **Claude CLI cold start adds ~7s** to the first call after server boot. Always warmup before doors open.

## Before any task

1. Read this file and check known quirks first — most "bugs" are documented.
2. If touching live audit state: trace through `state.ts` (events) and the SSE `subscribe()` replay before changing anything. The dedupe-by-id behavior is subtle and lives client-side.
3. If a stage fails: read its file under `lib/audit/stages/` end-to-end before patching. Each stage owns its own retry/timeout/fallback decisions.
4. Don't guess — search first. Use `grep`, read the file, then act.

## What NOT to add without strong reason

This is a demo asset. Stability beats features. Do not, unless explicitly asked:
- Add tracing or telemetry (the live activity stream IS the telemetry)
- Add a database (disk snapshots are enough for a 1-day event)
- Add auth (booth = open kiosk)
- Add new stages (timeline visual density is balanced; more pills = harder to read on a presentation screen)
- Refactor the SSE replay logic (subtle — client-side dedupe is load-bearing)
- Bump dependency majors before an event

## Network notes (server deploy)

- BD SERP / Unlocker / AI Search calls go to `api.brightdata.com`. Allow outbound HTTPS.
- Claude CLI talks to Anthropic's API on its own. Allow outbound HTTPS.
- SMTP (if used) talks to whatever `SMTP_HOST` you set.
- The app binds to `0.0.0.0:3000` by default in `next dev` and `next start`. For remote access:
  - Reverse proxy (nginx / caddy) with TLS, OR
  - Tailscale + access localhost over the tailnet, OR
  - SSH tunnel: `ssh -L 3000:localhost:3000 server`
- Process supervision for unattended runs: `pm2 start npm --name cva -- run start` works fine. Add `pm2 save && pm2 startup` to survive reboot.

## When confused

Stop. Say what's unclear. Wait. Never guess.
