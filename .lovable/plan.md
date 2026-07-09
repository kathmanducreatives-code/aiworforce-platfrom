
# Backend Audit — Scout Radar / Signals (read-only)

> No code, deploys, migrations, secrets, or providers were touched. Findings only.

## 1. Supabase connection

- **Project ref:** `wqnigjhcwjxtmordrwno` (from `supabase/config.toml` `project_id` and `src/integrations/supabase/client.ts` default URL).
- **URL:** `https://wqnigjhcwjxtmordrwno.supabase.co` (public).
- **Environment:** This is the **production** Supabase project this Lovable app is connected to (Lovable Cloud managed). It is **not** your Claude Code TEST project (`zbwsbnqqpkvdhqwavjke`) — those are two different backends.
- **Where configured:**
  - URL + publishable/anon key: `src/integrations/supabase/client.ts` (hardcoded defaults, overridable by `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`).
  - Server ref: `supabase/config.toml` → `project_id = "wqnigjhcwjxtmordrwno"`.
- Anon key value is not shown here (safe: it is a publishable key anyway; RLS is what protects data).

## 2. GitHub / code status

- Current HEAD in the Lovable workspace: **`d3ec2143c595b5293f4482a87c878218a8c3c2c8`** ("Merge Commit 4A: Apify LinkedIn Jobs hiring source for Scout Radar (flag-gated)"). Matches the `d3ec2143` you referenced.
- Branch checked out: `edit/edt-e3f9843c-...` (Lovable's working branch, fast-forwarded from `main`).
- Commit 4A files — all present:
  - ✅ `supabase/functions/_shared/radarSources/apifyJobsHiringSource.ts`
  - ✅ `supabase/functions/_shared/radarSources/apifyJobsHiringSource.test.ts`
  - ✅ `supabase/functions/_shared/radarCandidatePipeline.ts`
  - ✅ `supabase/functions/run-radar-scan/index.ts` (imports the Apify hiring source, `RADAR_ENABLE_APIFY_JOBS` flag, Firecrawl fallback, Company Brain scoring pipeline).
- Lovable **is** previewing latest `main` (Commit 4A code), not an older saved version.

## 3. Edge Functions audit

All functions present under `supabase/functions/`:
`adaptive-screening-chat, analyze-behavioral-signals, approve-and-continue, chat-respond, daily-brief, email-tracking, generate-screening-invite, generate-screening-questions, getResumeAnalysis, google-calendar-auth, google-calendar-events, integration-readiness, job-feed, mcp, orchestrate, parse-resume, pilot-chat, run-agent, run-radar-scan, saveResumeAnalysis, screen-candidate, screening-notifications, send-interview-invite, send-scheduled-emails, setup-company-brain, tool-availability`.

Key ones for this audit:

| Function | Path | Caller (frontend) | Deployed to `wqnig…` | Deploy path | verify_jwt | Required env |
|---|---|---|---|---|---|---|
| `run-radar-scan` | `supabase/functions/run-radar-scan/index.ts` | `src/hooks/useSignalFeed.ts` (`runRadarScan`) → Signals page "Run radar scan" | **Unknown** — code is in repo; a deploy for Commit 4A has not been observed in this thread | Lovable can deploy (auto on merge / via deploy tool) | Validates JWT in code (reads `Authorization`, calls `auth.getUser`); no per-function `verify_jwt` override needed | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FIRECRAWL_API_KEY`, `APIFY_API_TOKEN`, `APIFY_ENABLE_PEOPLE_SEARCH` (opt), `RADAR_ENABLE_APIFY_JOBS` (opt flag) |
| `run-agent` | `supabase/functions/run-agent/index.ts` | Pilot / agent runs | **Yes** — deployed earlier this session | Lovable | in-code | `SUPABASE_*`, LLM keys |
| `send-scheduled-emails` | `supabase/functions/send-scheduled-emails/index.ts` | Cron/edge; outreach dispatch | Assumed deployed (present in repo, not deployed this session) | Lovable | in-code | `RESEND_API_KEY`, `SUPABASE_*` |

Lovable's deploy tool ships **current workspace source** to the connected project (`wqnigjhcwjxtmordrwno`) only. It cannot deploy to arbitrary refs (e.g. your `zbwsbnqqpkvdhqwavjke` TEST project) and cannot pin a git SHA — for that use the Supabase CLI.

## 4. Scout Radar backend flow

Click path: **Signals page → Scout Radar → Run radar scan**.

1. UI calls `useSignalFeed.runRadarScan()` (`src/hooks/useSignalFeed.ts:59`).
2. It invokes edge function `run-radar-scan` via `supabase.functions.invoke("run-radar-scan", { body })`.
3. **Request body:**
   ```json
   { "workspace_id": "<uuid>", "mode": "default"|"load_more"|"category",
     "category": "hiring"|"linkedin_intent"|"competitor"|"workflow_trend"|"people"|undefined,
     "confirmed": false, "limit": <number|undefined> }
   ```
4. Edge function (`run-radar-scan/index.ts`):
   - Requires `Authorization: Bearer <jwt>`, resolves user, checks `workspace_members` row.
   - Loads `company_brain.profile` for the workspace → compiles Brain context → builds a scan plan.
   - Capability gate on `FIRECRAWL_API_KEY`, `APIFY_API_TOKEN`, `APIFY_ENABLE_PEOPLE_SEARCH`, `RADAR_ENABLE_APIFY_JOBS`.
   - Hiring: if `RADAR_ENABLE_APIFY_JOBS=true` **and** `APIFY_API_TOKEN` set → Apify LinkedIn Jobs actor; else Firecrawl search fallback; else `setup_needed`.
   - Other categories: Firecrawl search (`https://api.firecrawl.dev/v2/search`).
   - Candidates scored against Company Brain, disqualifiers/recruiter-proxy/shortener rejection, 7-day dedupe against `signals`, ranked, capped, inserted.
5. **Response shape:**
   ```json
   { "ok": true, "inserted": <n>, "per_category": { "hiring": {"found","accepted","status","reason?"}, ... },
     "capabilities": { "<cat>": {"ready","reason?"} }, "hiring_provider": "...", "brain_confidence": <n>,
     "warnings": [...], "mode": "..." }
   ```
6. UI decisioning (in `SignalFeed` / hook):
   - `data.inserted > 0` → refetches `signals`, shows new items.
   - `inserted === 0` with all categories `ready` → "no signals found".
   - Any category `status: "setup_needed"` with `reason` → "no sources ready" surface.
   - Thrown error / non-200 → error toast.
7. **Storage:** accepted rows inserted into `public.signals` (workspace-scoped). Dedupe reads back last-7-day rows.
8. **`signals.raw` JSON** carries: `account_name`, `competitor_name?`, provider (`apify_linkedin_jobs` or `firecrawl_search`), scan plan reason, brain score breakdown, source-specific normalized fields from `radarCandidatePipeline` / `apifyJobsHiringSource`.

## 5. Environment variables / secrets (project `wqnigjhcwjxtmordrwno`)

From the project's configured secrets list (values not shown):

| Secret | Required for radar? | Configured | Used by | If missing |
|---|---|---|---|---|
| `SUPABASE_URL` | Yes | ✅ | all edge fns | Function 500s on boot |
| `SUPABASE_ANON_KEY` | Yes | ✅ | user-scoped client for JWT verify | 401s |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | ✅ | admin client (membership, brain, insert signals) | Function fails |
| `FIRECRAWL_API_KEY` | Yes for Firecrawl categories + hiring fallback | ✅ | `firecrawlSearch()` in `run-radar-scan` | Those categories reported `setup_needed` |
| `APIFY_API_TOKEN` | Yes for Apify hiring + people | ✅ | Apify jobs actor call, people search | Apify hiring path silently disabled → falls back to Firecrawl |
| `APIFY_ENABLE_PEOPLE_SEARCH` | Optional flag (people cat) | ✅ | capability gate | people cat `setup_needed` |
| `RADAR_ENABLE_APIFY_JOBS` | **Required to enable Commit 4A Apify hiring** | ❓ **Not visible in the project secrets list** | flag check in `run-radar-scan` | Defaults to `false` → hiring uses Firecrawl fallback, not Apify Jobs |
| `APIFY_ACTOR_PEOPLE_SEARCH` | Optional (people actor id) | ✅ | people search | people cat degraded |
| `RESEND_API_KEY` | Not for radar | ✅ | outreach emails only | n/a |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_AI_API_KEY` / `LOVABLE_API_KEY` | Not required by `run-radar-scan` | ✅ | other functions | n/a for radar |

## 6. Database schema audit

`run-radar-scan` touches:

- `public.workspace_members` — membership check (RLS via `has_workspace_access`); row required for the calling user + `workspace_id`.
- `public.company_brain` — reads `profile` jsonb (Brain context + `signal_preferences`).
- `public.signals` — reads recent 7d for dedupe, inserts accepted rows. Columns used: `id, workspace_id, source_url, title, signal_type, raw (jsonb), created_at`, plus scoring fields consumed by UI. RLS: workspace-scoped (existing policies on `signals`).
- Indirect: `workspaces` (implicit via membership).

**Migrations for Commit 4A:** none required. The commit only adds pure TS modules + edits `run-radar-scan/index.ts`; it writes into the existing `signals.raw` jsonb (no schema changes). The current schema supports Commit 4A as-is.

## 7. Production readiness for Commit 4A

- Is `run-radar-scan` deployed with Commit 4A code? **Unknown from this session.** Code is merged locally; no deploy of `run-radar-scan` has been executed in this thread. Only `run-agent` was deployed earlier.
- `RADAR_ENABLE_APIFY_JOBS=true`? **Not visible in project secrets** → treat as `false` until confirmed.
- `APIFY_API_TOKEN` configured? **Yes.**
- `FIRECRAWL_API_KEY` configured? **Yes.**
- Does the Signals page call the same Supabase project where `run-radar-scan` is deployed? **Yes** — frontend client targets `wqnigjhcwjxtmordrwno`, which is the only project this Lovable app is wired to.
- Anything pointing to TEST `zbwsbnqqpkvdhqwavjke`? **No** — no references to that ref anywhere in the app config, `.env`, or client.

## 8. Exact next actions

**A. What Lovable can do (in-app)**
- Deploy `run-radar-scan` to `wqnigjhcwjxtmordrwno` from current workspace source (Commit 4A) via the Lovable deploy tool — one command, no CLI needed. Requires your go-ahead.
- Verify deploy with edge-function logs after the fact.
- Lovable **cannot** set the `RADAR_ENABLE_APIFY_JOBS` secret via a plain agent call without your confirmation flow (secrets tool opens a secure form for you).

**B. What must be done from Supabase CLI (if you prefer CLI over Lovable)**
```bash
supabase secrets set RADAR_ENABLE_APIFY_JOBS=true --project-ref wqnigjhcwjxtmordrwno
supabase functions deploy run-radar-scan --project-ref wqnigjhcwjxtmordrwno
```
(Only run if you want CLI-managed deploys. Skip if you use Lovable's deploy path.)

**C. What you manually test in the app**
1. Open Signals → Scout Radar in the connected app.
2. Click **Run radar scan** once with default mode.
3. Inspect the response toast / list: check `per_category.hiring.status == "ready"`, `hiring_provider == "apify_linkedin_jobs"` (only if flag is on), and non-zero `inserted`.
4. Spot-check 2-3 inserted rows in `signals` to confirm `raw` contains scoring + provider fields.

## 9. Risk check before clicking Run radar scan

- **Production data:** Yes — this is the production Supabase project (`wqnigjhcwjxtmordrwno`). Any inserted rows go into live `public.signals`.
- **Apify spend:** Only if `RADAR_ENABLE_APIFY_JOBS=true` and `APIFY_API_TOKEN` is set. Capped by `HIRING_CAP = 10` results per scan. People search only runs if `APIFY_ENABLE_PEOPLE_SEARCH=true` and default_mix.people > 0 (default 0).
- **Firecrawl spend:** Yes — used for `linkedin_intent`, `competitor`, `workflow_trend`, and hiring fallback. Per-query limits `max(3, ceil(wanted*1.5))`, ~3 queries per category, small `$` order.
- **Bad signals:** Mitigated by Brain scoring, disqualifier rules, shortener/recruiter-proxy rejection, and 7-day dedupe.
- **Emails / posts / comments / DMs / outreach:** **None.** `run-radar-scan` only reads providers and inserts into `signals`. No `send-*` function is called from it. No auto-contact.
- **Caps:** `requestedLimit` clamped to 25; hiring cap 10 (Apify); default_mix small integers.

## 10. Backend audit verdict

- Code merged: **yes** (HEAD `d3ec214`, Commit 4A included).
- Lovable-connected Supabase ref: **`wqnigjhcwjxtmordrwno`** (production).
- `run-radar-scan` deployed with Commit 4A: **unknown** (needs a deploy this session or CLI confirmation).
- `RADAR_ENABLE_APIFY_JOBS` enabled: **unknown / likely no** (not in visible secrets list; default false).
- `APIFY_API_TOKEN` present: **yes**.
- `FIRECRAWL_API_KEY` present: **yes**.
- Ready for one manual Scout Radar scan: **Yes for Firecrawl-only path** (safe, capped, no outreach). **Not yet** for the Apify Jobs path until (a) `run-radar-scan` is deployed with Commit 4A and (b) `RADAR_ENABLE_APIFY_JOBS=true` is set.
- Still to do:
  1. Confirm/execute deploy of `run-radar-scan` to `wqnigjhcwjxtmordrwno`.
  2. Set `RADAR_ENABLE_APIFY_JOBS=true` secret (if you want Apify Jobs, not the Firecrawl fallback).
  3. Run one manual scan and verify `per_category` + `raw` fields.
