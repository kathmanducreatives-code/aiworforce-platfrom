# RECON_REPORT.md
**Repo:** `remix-of-remix-of-screeningpilot` · **Audit date:** 2026-05-26 · **Method:** read-only static + live Supabase MCP introspection of project `zbwsbnqqpkvdhqwavjke`.

> Skipped (would need creds): real LLM eval runs, n8n execution logs, production traffic data. Anywhere I say "unknown" below, it's because the cheap path didn't reveal it.

---

## 1. Repo shape

### Top-level tree (2-deep, with purpose)

```
/                            Lovable-scaffolded Vite/React app root
├── src/                     The actual app
│   ├── pages/               50 route components
│   ├── components/          278 components incl. shadcn-ui primitives
│   ├── hooks/               18 React hooks
│   ├── contexts/            4 React contexts (Client, Theme, Workspace, ChatWorkspace)
│   ├── lib/                 chatRespond, orchestration, firecrawl client, supabase wrapper
│   ├── data/                static taxonomies (industries.ts is 2.6k lines)
│   ├── integrations/        generated supabase/types.ts (2.6k lines)
│   ├── remotion/            Remotion marketing-video templates
│   ├── services/            candidateService (thin Supabase wrapper)
│   └── types/               TS interfaces
├── supabase/
│   ├── functions/           19 Deno edge functions
│   ├── migrations/          51 SQL files
│   └── config.toml          single line, project_id only
├── workflows/               1 n8n JSON (marketing_video_generator)
├── docs/                    1 file (lead-scraping-setup.md)
├── skills/                  unrelated agent-skill scaffold
├── public/                  static assets
├── linkedin-content-planner/  separate Electron sub-project, also has its own supabase + workflows
├── screening-pilot-pipeline/  separate TS pipeline project (output/scripts/stages/utils/types)
├── agridrone_guardian/      unrelated Flutter project pulled into root
├── AgriDrone-Guardian/      duplicate empty dir of above
├── test_deploy/             dead scratch
├── .lovable/                Lovable's tracker
├── .codex/                  OpenAI Codex CLI env notes
├── .ai/                     unknown AI tool config
├── 8× icp_lookalike_engine_v*.json   n8n workflow exports at root (~110-155 KB each)
├── workflow_deepsearch{,_updated}.json, workflow_result.json, execution_645.json
├── Outreach - Batch Scrape + DM Generator.json   (155 KB n8n export)
├── 9× python scripts at root (deploy/optimize/finalize/fix_n8n)  ~1.3k LOC, no requirements.txt
├── bun.lock + bun.lockb + package-lock.json + deno.lock   four lockfiles
├── .env                     ❗ committed, contains a live Firecrawl key
└── agent-console.html       95 KB single-page artifact, unwired
```

### LOC

| Area | LOC |
|---|---|
| `src/**/*.{ts,tsx}` | **66,537** (incl. 2.6k generated supabase types + 2.6k static industries) |
| `supabase/functions/**/*.ts` | 4,096 |
| `supabase/migrations/**/*.sql` | 4,286 |
| Python (root) | ~1,339 |
| n8n JSON exports (root) | ~983 KB (compressed) — not LOC, but bigger than `src/` |

### Build / run

- Dev: `npm run dev` → `vite` (no `.env.local` template; reads `.env` directly).
- Build: `vite build`. No `start` / no Node server. **No prod runtime config in repo** — deploy is presumably Lovable hosting + Supabase managed runtime.
- Edge fns: no `supabase functions deploy` script in `package.json`. They are pushed to Supabase manually or via the Lovable integration.
- No Dockerfile, no `Procfile`, no SST/CDK, no `vercel.json` (a `.vercelignore` exists at root but no config).

### Versions

| Thing | Pin |
|---|---|
| Node | not pinned (no `engines`, no `.nvmrc`, no `.tool-versions`) |
| Package manager | **ambiguous** — `bun.lock` + `bun.lockb` + `package-lock.json` + `deno.lock` all committed |
| React | `^18.3.1` (floating) |
| Vite | `^5.4.19` |
| TypeScript | `^5.8.3` |
| TanStack Query | `^5.83.0` |
| Supabase JS | `^2.104.1` (frontend); edge fns use `@supabase/supabase-js@2.45.0` pinned |
| Anthropic SDK | none — `chat-respond` hits the REST API directly |
| OpenAI SDK | none — same |

---

## 2. Route inventory (frontend)

Source: `src/App.tsx`. All `MainLayout`-wrapped routes are `ProtectedRoute`-gated.

| Path | Component | Purpose | Backend calls | Flag? | In nav? | Stub/broken |
|---|---|---|---|---|---|---|
| `/` | `Landing.tsx` | Marketing landing | — | — | — | OK |
| `/auth` | `Auth.tsx` | Supabase auth | `supabase.auth` | — | — | OK |
| `/features` | `Features.tsx` | Marketing | — | — | — | OK |
| `/pricing` | `Pricing.tsx` | Marketing pricing | — | — | — | **Display-only — no Stripe** |
| `/get-demo` | `GetDemo.tsx` | Demo form | unknown — needs read | — | — | unknown |
| `/dashboard` | `Dashboard.tsx` | Hero + agent dock | reads `task_plans`, `activity_feed`, `agents` | — | yes | OK |
| `/awaiting-you` | `AwaitingYou.tsx` | Approvals queue | reads `approvals` | — | yes | OK |
| `/candidates` | `Candidates.tsx` | Candidate list | `screening_applications`, `linkedin_leads` | — | yes | OK |
| `/candidates/:id` | `candidates/CandidateDossier.tsx` | Candidate detail (758 LOC) | reads several | — | yes | OK |
| `/analytics` | `DataDashboard.tsx` | Metrics | unknown | — | yes | likely thin |
| `/folder/:folderName` | `FolderView.tsx` | Folder-bound list | unknown | — | partial | unknown |
| `/email-sequence/:folderName` | `EmailSequenceSetup.tsx` | Sequence editor (654 LOC) | `scheduled_emails`, `outreach_*` | — | yes | OK |
| `/email-sequences` | `EmailSequences.tsx` | Sequences list | `scheduled_emails` | — | yes | OK |
| `/client-metrics` | `ClientMetrics.tsx` | Per-client KPI | `clients`, `client_placements` | — | yes | OK |
| `/client/:clientId` | `ClientDetail.tsx` | Client profile | `clients` | — | yes | OK |
| `/lead-scraper` | `LeadScraper.tsx` (798 LOC) | n8n webhook trigger UI | `VITE_N8N_LEAD_SCRAPER_WEBHOOK_URL` | — | yes | **depends on n8n being up** |
| `/deep-search` | `DeepSearch.tsx` (886 LOC) | DeepSearch UI | n8n webhook + `deep_search_results` | — | yes | **n8n-dependent** |
| `/icp-intelligence` | `ICPManager.tsx` | ICP sessions list | `icp_*` | — | yes | OK |
| `/icp/results/:sessionId` | `ICPResultsPage.tsx` (891 LOC) | Lookalike results | `icp_lookalike_*` | — | yes | **n8n-dependent** |
| `/icp/results/:sessionId/candidate/:candidateId` | `ICPCandidateDetail.tsx` (748 LOC) | Per-result detail | `icp_lookalike_results` | — | yes | OK |
| `/interview-scheduler` | `InterviewScheduler.tsx` | Scheduler UI | `interviews`, edge fns | — | yes | OK |
| `/interview-settings` | `InterviewSettings.tsx` | Availability config | `interview_availability`, Google OAuth | — | yes | OK |
| `/screening-jobs` | `ScreeningJobs.tsx` | Job list | `screening_jobs` | — | yes | OK |
| `/screening-jobs/:jobId` | `JobApplicants.tsx` | Applicants pipeline | `screening_applications` | — | yes | OK |
| `/distribution` | `JobDistribution.tsx` | Multi-board distribution | `job_distribution_status` | — | yes | **schema only — no actual posting logic in repo** |
| `/competitors` | `CompetitorMonitor.tsx` | Competitor table | `competitor_*` | — | yes | UI-only — no scrapers running |
| `/talent-intel` | `TalentIntelligence.tsx` | Talent signals | `talent_signals` | — | yes | UI-only |
| `/competitor-intel` | `CompetitorIntelligence.tsx` | Intel signals | `competitor_intel_signals` | — | yes | UI-only |
| `/growth-signals` | `GrowthSignals.tsx` | Buying signals | `growth_signal_companies` | — | yes | UI-only |
| `/expert-marketplace` | `ExpertMarketplace.tsx` | Expert marketplace | imports `mockData.ts` | — | yes | **PURE MOCK** — `src/components/expert-marketplace/mockData.ts` |
| `/post-interceptor` | `PostInterceptor.tsx` | LinkedIn signal watch | unknown | — | yes | unknown |
| `/lead-crm` | `LeadCRM.tsx` | Lead pipeline | `linkedin_leads` | — | yes | OK |
| `/outreach-engine` | `OutreachEngine.tsx` | Sequence engine UI | `outreach_*` (RLS off!) | — | yes | **backed by RLS-disabled tables** |
| `/departments` | `DepartmentsOverview.tsx` | 2x2 dept grid | static | — | yes | mostly static |
| `/rooms/:dept` | `DepartmentRoom.tsx` | Per-dept room | `agents`, `activity_feed` | — | yes | OK |
| `/plans/:planId` | `TaskPlanPage.tsx` | Plan detail | `task_plans`, `tasks`, `activity_feed` | — | yes | OK |
| `/apply/:slug` | `CandidateApply.tsx` | Public apply page | `screening_jobs`, `screening_applications`, `parse-resume`, `screen-candidate` | — | public | OK (see §7) |
| `/book/:token` | `BookInterview.tsx` | Public booking | `interview_slots`, `send-interview-invite` | — | public | OK |
| `/oauth/google/callback` | `GoogleOAuthCallback.tsx` | Google OAuth | `google-calendar-auth` | — | n/a | OK |
| `*` | `NotFound.tsx` | 404 | — | — | — | OK |

**Commented-out / never rendered** (lines 56-67, 200-211 of `src/App.tsx`):
- `/verify`, `/verify/results`
- `/interviews`, `/interviews/marketplace`, `/interviews/scheduled`, `/interviews/completed`, `/interviews/reports`
- `/portal/assignments`, `/portal/submit`, `/portal/earnings`, `/portal/profile`

Those page files exist on disk but are removed from the router. Dead code.

**No feature flags** in the codebase — no LaunchDarkly, no env-driven gates, no role gates beyond `ProtectedRoute`.

---

## 3. Backend surface

### Edge functions (19 deployed, confirmed live via MCP)

| Name | File | One-line | Reads | Writes | External | Auth | Error handling |
|---|---|---|---|---|---|---|---|
| `orchestrate` | `supabase/functions/orchestrate/index.ts` (216 LOC) | Plan a 1-4 step "plan" via Gemini, insert into `task_plans` + `tasks`, kick `run-agent` | `workspace_members`, `agents` | `task_plans`, `tasks`, `activity_feed` | Lovable AI Gateway (Gemini 2.5 flash) | ✅ `verify_jwt:true` + workspace membership check | OK — try/catch + status codes |
| `run-agent` | `supabase/functions/run-agent/index.ts` | **Fakes execution** — 600 ms `setTimeout`, writes `{note:'auto-completed'}`, chains via self-invoke | `tasks`, `task_plans`, `agents` | `tasks`, `agents`, `activity_feed`, `approvals`, `handoffs` | **NONE — no LLM call** | ❌ `verify_jwt:false` (internal-only by convention) | minimal |
| `approve-and-continue` | `supabase/functions/approve-and-continue/index.ts` | Mark approval approved/rejected; resume plan by re-invoking `run-agent` | `approvals`, `workspace_members`, `tasks` | `approvals`, `tasks`, `agents`, `task_plans`, `activity_feed` | — | ✅ JWT + workspace check | OK |
| `chat-respond` | `supabase/functions/chat-respond/index.ts` (196 LOC) | Per-agent chat: routes to OpenAI / Anthropic / Google | `conversations`, `messages` | `conversations`, `messages` | OpenAI, Anthropic, Google Gemini | ✅ `getClaims` JWT check | OK but **see §6 — DB tables don't exist live, so this is broken** |
| `parse-resume` | `supabase/functions/parse-resume/index.ts` (193 LOC) | Base64 PDF → JSON via Lovable AI gateway | — | — | Lovable AI Gateway (Gemini) | ❌ public | OK |
| `screen-candidate` | `supabase/functions/screen-candidate/index.ts` (341 LOC) | Generate Qs / evaluate answer / complete screening | `screening_applications`, `screening_jobs` | `screening_applications` | Lovable AI Gateway | ❌ public | basic |
| `adaptive-screening-chat` | `…/adaptive-screening-chat/index.ts` | Multi-turn conversational screening | `adaptive_screening_sessions`, `screening_scenarios`, `screening_conversation_logs` | same + `screening_conversation_logs` | Lovable AI Gateway | ❌ public | basic |
| `analyze-behavioral-signals` | `…/analyze-behavioral-signals/index.ts` | Score candidate transcript | `adaptive_screening_sessions`, `screening_conversation_logs` | `screening_behavioral_analysis` | Lovable AI Gateway | ❌ public | basic |
| `generate-screening-questions` | `…/generate-screening-questions/index.ts` | One-shot Q generator | — | — | Lovable AI Gateway | ❌ public | basic |
| `generate-screening-invite` | `…/generate-screening-invite/index.ts` | Personalize + send invite | `linkedin_leads`, `resume_analyses`, `screening_templates`, `screening_template_questions` | `adaptive_screening_sessions` | Lovable AI Gateway, **Resend** | ✅ JWT (per MCP) | OK |
| `send-interview-invite` | `…/send-interview-invite/index.ts` | Email an interview invite | — | — | **Resend** | ❌ public | minimal |
| `send-scheduled-emails` | `…/send-scheduled-emails/index.ts` | Cron-style sender | `scheduled_emails` | `scheduled_emails` | **Resend** | ❌ public | OK |
| `email-tracking` | `…/email-tracking/index.ts` | Pixel + click tracker | `email_tracking` | `email_tracking` | — | ❌ public (correctly — pixel) | OK |
| `screening-notifications` | `…/screening-notifications/index.ts` | Notify recruiter on submit | `screening_applications` | — | **Resend** | ❌ public | OK |
| `google-calendar-auth` | `…/google-calendar-auth/index.ts` | OAuth code exchange | — | `google_calendar_tokens` (implicit) | Google OAuth | ❌ public (OAuth callback, expected) | basic |
| `google-calendar-events` | `…/google-calendar-events/index.ts` | List/create events | `google_calendar_tokens` | same | Google Calendar API | ✅ JWT | OK |
| `job-feed` | `…/job-feed/index.ts` | Public job feed | `screening_jobs` | — | — | ❌ public (correctly) | minimal |
| `saveResumeAnalysis` | `…/saveResumeAnalysis/index.ts` | Upsert into `resume_analyses` | — | `resume_analyses` | — | ❌ public | minimal |
| `getResumeAnalysis` | `…/getResumeAnalysis/index.ts` | Fetch + (used to) sync to Google Sheets | `resume_analyses` | — | Google Sheets (legacy) | ❌ public | minimal |

> Live deployment has a duplicate orphan: `getResumeAnalysis-` (trailing dash, v26, verify_jwt=true) — confirmed via MCP `list_edge_functions`. Not in repo. Delete.

### Edge fns with no detectable frontend caller

Grepped `src/` for each function slug:
- **`job-feed`** — no caller in `src/`. (Likely an external RSS/JSON feed; OK.)
- **`screening-notifications`** — only referenced from other edge fns / DB triggers. No frontend invoke. (May fire on DB event.)
- **`getResumeAnalysis-`** (the live orphan) — has no source file in repo.

Everything else has at least one `supabase.functions.invoke('…')` in the frontend.

### Where the agents' "intelligence" actually lives

- **Real LLM work runs only in `chat-respond`** (OpenAI/Anthropic/Google direct API).
- The **screening pipeline** (`parse-resume`, `screen-candidate`, `adaptive-screening-chat`, `analyze-behavioral-signals`, `generate-screening-*`) uses the **Lovable AI Gateway** (`https://ai.gateway.lovable.dev/v1/chat/completions`) — that's a third-party dependency the audit hasn't seen called out. If Lovable's gateway dies or you leave Lovable, every screening function dies.
- `orchestrate` also calls the Lovable gateway (Gemini 2.5 Flash) for planning.
- `run-agent` calls **no LLM at all**.

---

## 4. Database reality check

Live introspection via Supabase MCP against project `zbwsbnqqpkvdhqwavjke`. **Note: the `.env` in this repo points to a different project (`wqnigjhcwjxtmordrwno`)**. The frontend is shipping to a stale project ref.

### Tables grouped by domain (live row counts where non-zero)

**Recruiting / screening**
`screening_jobs`, `screening_applications`, `screening_templates`, `screening_template_questions`, `adaptive_screening_sessions`, `screening_scenarios`, `screening_conversation_logs`, `screening_behavioral_analysis`, `resume_analyses`, `candidate_notes`, `candidate_profiles` *(RLS OFF)*, `job_postings`

**Interviews**
`interviews`, `interview_types`, `interview_availability`, `interview_slots`, `interview_reminders`, `google_calendar_tokens`

**Outreach / growth** *(8 of 9 have RLS OFF)*
`outreach_sequences`, `outreach_leads`, `outreach_activities`, `outreach_settings`, `outreach_daily_queue`, `outreach_error_log`, `closely_events`, `sp_outreach_leads_scored`, `sp_wellfound_leads`, `scheduled_emails`, `email_tracking`, `linkedin_leads`, `linkedin_posts`, `codex_leads` *(RLS OFF)*

**Intelligence / market data**
`competitor_companies`, `competitor_job_postings`, `competitor_intel_signals`, `competitor_profiles`, `pricing_history`, `talent_signals`, `growth_signal_companies`

**ICP** *(2 of 7 RLS OFF)*
`icp_lookalike_sessions` *(OFF)*, `icp_lookalike_results` *(OFF)*, `icp_drafts`, `icp_saved_searches`, `icp_search_results`, `deep_search_results`, `deep_search_analysis`

**Clients (agency model)**
`clients`, `client_placements`, `client_active_positions`

**Collaboration**
`collaboration_rooms`, `collaboration_room_members`, `collaboration_messages`, `collaboration_candidate_attachments`, `collaboration_candidate_comments`, `collaboration_candidate_tags`, `collaboration_contact_history`

**Agent / orchestration** *(actively used — row counts non-zero)*
`workspaces` (1 row), `users` (0), `agents` (**5 rows** ✓), `agent_capabilities` (**24 rows** ✓), `task_plans` (2), `tasks` (2), `activity_feed` (**6 rows**), `handoffs` (1), `approvals` (0), `organizations`, `organization_members`, `departments`, `tools`, `secret_connections`, `jobs`, `job_steps`, `activity_logs`, `job_transition_rules`

**Dialer** *(in production, not in repo migrations)*
`dialer_leads` (**36 rows** ✓), `dialer_status` *(RLS OFF)*

**Misc**
`profiles`, `marketing_videos` *(RLS OFF)*, `scraping_sessions`, `audit_log` *(RLS OFF)*, `error_log` *(RLS OFF)*, `job_distribution_status`

### Tables with no detectable writer or reader in code

Grepped `src/` and `supabase/functions/` for each table name:

| Table | Writer in code? | Reader in code? | Verdict |
|---|---|---|---|
| `codex_leads` | none | none | **dead** |
| `sp_wellfound_leads` | none | none | **dead** |
| `sp_outreach_leads_scored` | none | none | **dead** |
| `closely_events` | none | none | **dead — likely n8n-only sink** |
| `outreach_error_log` | none | none | **dead** |
| `outreach_daily_queue` | none | none | **dead — schema only** |
| `dialer_leads` | none in repo | none in repo | live in DB (36 rows) but **all code lives elsewhere** (n8n? external) |
| `dialer_status` | none | none | same |
| `job_transition_rules` | none | none | **dead** |
| `secret_connections` | none | none | **dead — schema only, despite comment hinting at vault refs** |
| `tools` | none | none | **dead** |
| `jobs` / `job_steps` | none | none | **dead — newer orchestration scaffold not yet wired** |
| `marketing_videos` | Remotion sub-flow | unknown | half-wired |
| `screening_scenarios` | seeded by migration? | `adaptive-screening-chat` | read-only |
| `audit_log` / `error_log` | none | none | **dead** |

### FK graph

I didn't pull the full FK graph cheaply. Spot-check from migrations:
- `agents.workspace_id → workspaces.id`, `tasks.plan_id → task_plans.id`, `tasks.agent_id → agents.id`, `handoffs.plan_id → task_plans.id`, `approvals.plan_id → task_plans.id` — agent stack is well-connected.
- `screening_applications.job_id → screening_jobs.id` — screening stack well-connected.
- Outreach stack: I could not find FK constraints to `workspaces`/`organizations` from a quick grep. Likely **islanded** — which combined with RLS=off means cross-tenant leakage if multiple tenants existed.
- `dialer_leads` has no FK in repo migrations (none exists — table was created out-of-band).
- "unknown — would need pg_dump or `\d+` to be sure on full graph."

### Migrations

- **51 migrations** under `supabase/migrations/`. Total ~4.3k LOC SQL.
- Filenames mix two timestamp formats: full `YYYYMMDDhhmmss_<uuid>.sql` (Lovable-generated) and one-off names like `outreach.sql` (manual). **History has been hand-edited** — the manual files break the deterministic ordering.
- Last timestamped: `20260519104330_…sql` (May 19 2026); plus `outreach.sql` at the end.
- Live DB has tables (`organizations`, `departments`, `secret_connections`, `tools`, `jobs`, `job_steps`, `dialer_leads`, `dialer_status`) that **do not appear in any repo migration**. Schema drift is confirmed.

---

## 5. The n8n dependency

### Workflow files in the repo

| File | Size | Where |
|---|---|---|
| `Outreach - Batch Scrape + DM Generator.json` | 155 KB | root |
| `icp_lookalike_engine_original.json` | 115 KB | root |
| `icp_lookalike_engine_v2.json` | 137 KB | root |
| `icp_lookalike_engine_v3.json` | 140 KB | root |
| `icp_lookalike_engine_v3_final.json` | 126 KB | root |
| `icp_lookalike_engine_v4_final.json` | 132 KB | root — **assume this is live** |
| `workflow_deepsearch.json` | 24 KB | root |
| `workflow_deepsearch_updated.json` | 21 KB | root |
| `workflow_result.json` | 37 KB | root — looks like an export, not a workflow |
| `execution_645.json` | 41 KB | root — a single execution payload |
| `workflows/marketing_video_generator.json` | 30 KB | dir |

**Five versions of the ICP engine** committed side by side. Nobody pruned. v4_final is the safe bet but is **not enforced anywhere** — no manifest, no symlink, no comment in `docs/`.

### Per-workflow

**ICP Lookalike Engine v4_final** (57 nodes)
- 1× webhook trigger
- 26× `code` (Function) nodes — most of the logic
- 11× Supabase nodes — direct DB writes from n8n
- 5× Apify nodes
- 9× respond-to-webhook
- 2× IF + 1× switch (control flow)
- 1× chainLlm + 1× Anthropic chat model

**Trigger:** HTTP webhook. The frontend `src/lib/firecrawl.ts` and `LeadScraper.tsx` use `VITE_N8N_LEAD_SCRAPER_WEBHOOK_URL` / `VITE_N8N_ADVANCED_SEARCH_WEBHOOK_URL` env vars to POST.
**Calls:** Apify (scraping), Anthropic (reasoning), Supabase (reads ICP definition, writes `icp_lookalike_results`).
**Writes back to:** `icp_lookalike_sessions`, `icp_lookalike_results`.
**App features that depend on it:** `/icp-intelligence`, `/icp/results/:sessionId`, `/icp/results/:sessionId/candidate/:candidateId`, `/lead-scraper`, `/deep-search`. If n8n is down, **the entire ICP product is dark**.

**Outreach Batch Scrape + DM Generator**
- Trigger unknown without unpacking
- 6 credentials references inside the JSON (so this workflow depends on n8n-stored credentials — see security note below)
- App feature: `/outreach-engine`, `/lead-crm`. Both tied to the RLS-disabled `outreach_*` tables.

**Marketing video generator**
- Hooked to Remotion templates in `src/remotion/`. Likely standalone — not on the screening critical path.

### Credentials inside workflow JSON?

Quick scan: zero matches for raw `sk-…`, `fc-…`, or JWT-shaped strings inside any of the JSONs.
However, **6 `"credentials"` references in `Outreach - Batch Scrape + DM Generator.json` and 1 in `execution_645.json`**. These are n8n credential **handles** (UUIDs), not raw secrets — so the secrets live in the n8n instance, not in the file. ✅ Good. (The actual leaked secret is in `.env` — see §8.)

### ICP engine call path

```
1. User opens /lead-scraper or /icp-intelligence
2. UI POSTs to VITE_N8N_LEAD_SCRAPER_WEBHOOK_URL (n8n webhook node)
3. n8n: parse payload → write session row to icp_lookalike_sessions
4. n8n: invoke Apify actors (LinkedIn / company search) — async, multi-page
5. n8n: 26 code nodes do filtering, scoring, normalization
6. n8n: chainLlm + Anthropic chat enriches candidates (Stage 3 reasoning)
7. n8n: write icp_lookalike_results rows (one per candidate)
8. n8n: respond to webhook (or fire-and-forget; the 9 respondToWebhook nodes suggest staged responses)
9. UI polls or subscribes to icp_lookalike_results (Supabase realtime) and renders ICPResultsPage
```

**External hops:** Apify (scrape) → Anthropic (reasoning) → Supabase (persistence). Each is a separate failure point.

**Retry / idempotency:** I inspected node types. The 2 IF nodes are branching, not retry. **No retry, no idempotency keys visible**. If Apify rate-limits or Anthropic 529s, the session likely ends up in a half-written state with no automatic resume. The 36 rows in `dialer_leads` (which appears to be the *real* working table) and **0 rows in `icp_lookalike_*`** (both RLS-off, easy to read) suggest the engine has not been exercised at scale, or is exercised against a different DB.

### Estimate: reimplement ICP engine in main codebase

Rebuilding as a Supabase edge function + queue (e.g., `pg_cron` triggering a `process-icp-job` function reading from an `icp_jobs` queue table) with the same Apify + Anthropic calls:

- Queue + worker scaffold: **2 days**
- Port the 26 Function nodes (the real IP — filters, scoring, normalization): **5-8 days** depending on prompt-engineering noise
- Apify integration (token, rate-limit handling, retry-with-backoff): **1-2 days**
- Anthropic chain-of-thought equivalent of the chainLlm node: **1-2 days**
- Realtime UI wiring: **1 day**
- Manual evals to confirm parity with current n8n output on a fixed sample: **2-3 days**

**Total: 12-16 engineer-days** for a single focused dev who can read n8n JSON. Add 30% if you also want backfill + observability (Sentry, structured logs, prometheus-style counters). If you can't read n8n Function nodes fluently, double it.

---

## 6. The "agents" layer — what's real vs aspirational

### Tables and traffic

| Table | Writer | Reader | Live rows | Verdict |
|---|---|---|---|---|
| `workspaces` | bootstrap only | dashboard | 1 | seeded |
| `agents` | bootstrap migration | dashboard, dock, run-agent | **5** | seeded, used |
| `agent_capabilities` | seed | dashboard | **24** | seeded |
| `task_plans` | `orchestrate` | dashboard, `TaskPlanPage` | 2 | **real** |
| `tasks` | `orchestrate`, `run-agent`, `approve-and-continue` | `TaskPlanPage` | 2 | **real** |
| `activity_feed` | `orchestrate`, `run-agent`, `approve-and-continue` | dashboard (subscribed) | **6** | **real** |
| `handoffs` | `run-agent` | dashboard | 1 | **real** |
| `approvals` | `run-agent` | `AwaitingYou`, `approve-and-continue` | 0 | wired, not exercised |
| `workspace_members` | unknown — likely seeded | membership checks | unknown | depended on by every fn |
| `organizations`, `organization_members`, `departments`, `tools`, `secret_connections`, `jobs`, `job_steps`, `job_transition_rules` | **none** | **none** | unknown | **aspirational schema** |
| `conversations`, `messages` | `chat-respond` | `chat-respond` | **TABLES DO NOT EXIST IN LIVE DB** | **every `chat-respond` invocation 500s** |

### What each edge fn actually does

**`orchestrate` — `supabase/functions/orchestrate/index.ts:1-216`**
What it does: JWT-checks user → membership-checks workspace → fetches agents → calls Gemini 2.5 Flash on the Lovable gateway with a system prompt that asks for `{plan_summary, steps:[{agent_slug, description}]}` (lines 30-57) → validates returned slugs against a hardcoded `KNOWN_AGENT_SLUGS = ['aria','scout','penn','hawk','scribe']` (line 22) → inserts a `task_plans` row, then N `tasks` rows → fires `run-agent` for the first task → returns immediately.
**Verdict:** Real planner. The planner *is* an LLM call. The "agents" passed to the LLM are just `{slug, name, department}` triples; **no capabilities, no prompts, no tools wired**.

**`run-agent` — `supabase/functions/run-agent/index.ts:1-180`**
What it does:
- Marks the task `running`, updates the agent row to look busy (line 60-67)
- **`await new Promise(r => setTimeout(r, 600))` — line 70 — fake "work"**
- Decides via regex `/\b(send|email|post|publish|message|dm|invite|schedule|book|launch|deploy|reach out|contact)\b/` whether the step requires approval (line 23-26)
- If approval needed: inserts an `approvals` row and stops
- If not: marks task `complete` with **literal output `{ note: 'auto-completed' }`** (line 105) and self-invokes for the next task

**Verdict: this is theatre. There is no LLM call, no tool call, no real work. The agent "doing its job" is a 600 ms sleep and a status flip.** The orchestration *loop* is real; the *workers* are stubs.

**`approve-and-continue` — `supabase/functions/approve-and-continue/index.ts`**
Real: JWT check, membership check, flips `approvals.status`, marks the gating task complete, resumes via `run-agent`. Solid.

**`chat-respond` — `supabase/functions/chat-respond/index.ts:1-196`**
Real: per-agent system prompts hardcoded (lines 11-32), routes by provider (`scout`→OpenAI gpt-4o, `aria/penn/hawk`→Anthropic Haiku 4.5, `scribe`→Sonnet 4.6).
**Broken in live DB:** it inserts into `conversations` and `messages` tables (lines 117-141) which **do not exist**. Every call returns a 500 with `create conversation: …`. This is exactly what the roadmap's "chat-respond is broken" note refers to.

### Prompts

- **Inline strings only.** All five agent system prompts live in `chat-respond/index.ts:11-32`. The orchestrator's planner prompt is in `orchestrate/index.ts:30-37`. Screening prompts are inline in `screen-candidate/index.ts` and `adaptive-screening-chat/index.ts`.
- **No `prompts` table.** Not versioned. Editing a prompt = redeploying an edge function. There is no A/B, no rollback, no audit.

### Evals / regression / golden datasets

Confirmed: **none**. No `evals/`, `tests/`, `*.test.ts`, `*.spec.ts` anywhere in the repo. No fixture resumes, no scored sample candidates, no regression suite. There is a `src/components/dev/VerificationPanel.tsx` that does ping-style smoke checks (referenced from `App.tsx:14`); that is the entire QA surface.

---

## 7. The end-to-end screening flow

Tracing **recruiter creates job → candidate hired in pipeline** through the code.

### 1. Recruiter creates a screening job
- Route: `/screening-jobs` → `src/pages/ScreeningJobs.tsx`, form component `src/components/screening/CreateJobForm.tsx` (558 LOC).
- Insert: directly into `screening_jobs` from the client. **No edge fn** wraps job creation — anon key + RLS is the only guard.
- **Risk:** if `screening_jobs` RLS is misconfigured (status unknown — list_tables says RLS on, but no policy was inspected), a malicious user could insert jobs.

### 2. Public apply page `/apply/:slug`
- File: `src/pages/CandidateApply.tsx:1-145`.
- On mount: `supabase.from('screening_jobs').select('*').eq('slug', slug).single()` (lines 30-35). No edge fn — public read via anon key. Relies on RLS allowing anon SELECT on published jobs.
- "Start application" → inserts a `screening_applications` row with `job_id` (lines 76-82). **Anon insert**. RLS must allow this.

### 3. Candidate uploads resume
- Component: `src/components/apply/ScreeningChatStep.tsx` is the candidate-side controller (also `src/components/ResumeUpload.tsx`).
- File goes to `parse-resume` edge fn (`supabase/functions/parse-resume/index.ts`) as base64.
- `parse-resume` decodes base64 in-memory (line 35-46), calls Lovable AI Gateway (Gemini) with the resume bytes, returns JSON.
- **Sketchy:** function is **public (`verify_jwt:false`)**, no rate limit, no file-size cap, no virus scan, no per-IP throttle. Anyone can spam it with arbitrary base64 payloads, consuming your Lovable gateway quota.
- Output is stored on `screening_applications.extracted_data` via a follow-up update (caller-side).

### 4. Resume scored
- Edge fn: `screen-candidate` (action `generate_questions` → `evaluate_answer` → `complete_screening`).
- Reads `screening_applications` joined with `screening_jobs`. Writes scoring + status updates back.
- Calls Lovable AI Gateway 3× per applicant.
- **Sketchy:** also `verify_jwt:false`. The `application_id` parameter is the only thing tying a call to context — there's no signed token. Anyone with a valid `application_id` can drive a candidate through the funnel programmatically.

### 5. Screening chat invite sent
- Edge fn: `generate-screening-invite` → composes invite, **sends via Resend** with `from: 'onboarding@resend.dev'` (literal string, lines visible in §3 grep).
- **Sketchy:** sender domain is Resend's shared sandbox (`onboarding@resend.dev`). Production-grade deliverability requires a verified domain. Right now every screening invite looks like spam.

### 6. Candidate completes adaptive screening
- Edge fn: `adaptive-screening-chat`. Writes turn-by-turn to `screening_conversation_logs`.
- After completion: `analyze-behavioral-signals` runs → writes `screening_behavioral_analysis`.
- Both **public, no rate limit**. A bot could drive the whole flow.

### 7. Interview scheduled
- Recruiter sets availability in `/interview-settings`. Token-based public booking via `/book/:token` → `BookInterview.tsx`.
- `send-interview-invite` (Resend) emits the ICS-equivalent email. Google Calendar event is created via `google-calendar-events`.
- Token freshness: unknown — would need to read `interview_slots` table policies and the token-issue path to confirm.

### 8. Recruiter sees candidate
- `/screening-jobs/:jobId` → `JobApplicants.tsx` queries `screening_applications` filtered by `job_id`. `CandidateDossier.tsx` joins multiple tables for the detail page.

### Where this breaks in prod (ordered by severity)

1. **`onboarding@resend.dev` sender** — emails will land in spam. Verify a domain in Resend, or the funnel never gets candidates past step 5.
2. **`parse-resume` + `screen-candidate` are public + unrate-limited** — quota DoS surface. Add Supabase function rate-limits or wrap with a signed-token edge fn.
3. **`screening_jobs` slug enumeration** — `/apply/:slug` is public; slug guessability is unknown. If slugs are short/predictable, scrapers will find unpublished jobs.
4. **No retry anywhere** — every `fetch(LOVABLE_GATEWAY)` is a single attempt. Gateway 5xx ⇒ blank application.
5. **Resend send is blocking** — `await resend.emails.send(...)` is inline in `screening-notifications`, `send-interview-invite`. If Resend slows down, the function timeout fires before the response returns.
6. **No idempotency** — re-running `complete_screening` on an already-completed application *is* checked (`screen-candidate/index.ts:39-44`), but `evaluate_answer` is not protected against double-submit.
7. **Resume decoding is naive** — base64 → utf-8 decode of binary PDF bytes (`parse-resume/index.ts:35-46`) is a string that's mostly garbage; relies on Gemini to OCR. Loses correctness for scanned PDFs. No fallback.
8. **Live DB lacks `conversations`/`messages`** — `chat-respond` 500s. If the dashboard chat is on the demo path, the whole demo is dead.
9. **n8n not on this path** — good. The screening flow is the one feature **independent of the n8n single point of failure**.

---

## 8. Auth, tenancy, security

### Auth

- Supabase Auth. `src/hooks/useAuth.tsx` is the provider. `src/components/ProtectedRoute.tsx` guards routes.
- Session model: standard Supabase JWT in browser local storage. JWT expiry per project default.
- Edge fns: 4 of 19 verify JWT (`orchestrate`, `approve-and-continue`, `google-calendar-events`, `generate-screening-invite` — confirmed via MCP). **15 are public.** Several of those public ones use the **service role key** internally (e.g., `screen-candidate`, `adaptive-screening-chat`, `analyze-behavioral-signals`, `screening-notifications`, `send-scheduled-emails`, `email-tracking`, `parse-resume`, `saveResumeAnalysis`, `getResumeAnalysis`, `job-feed`, `run-agent`). **An unauthenticated POST can drive privileged DB writes through any of those.**

### Tenancy

- Membership check exists in `orchestrate` and `approve-and-continue` (`workspace_members` lookup).
- Most table queries from the frontend are bare `supabase.from('x').select(...)` with no `workspace_id` filter visible — they rely on RLS to filter.
- **17 tables have RLS DISABLED in live DB** (confirmed via `get_advisors`):
  `audit_log, error_log, icp_lookalike_sessions, icp_lookalike_results, candidate_profiles, marketing_videos, outreach_sequences, outreach_leads, outreach_activities, outreach_settings, outreach_daily_queue, closely_events, outreach_error_log, sp_outreach_leads_scored, sp_wellfound_leads, codex_leads, dialer_status`.
  These are readable/writable with the anon key — and the anon key is in `.env`, committed to git.
- For the tables that *do* have RLS, I did not enumerate every policy. Several migrations reference `auth.uid()` checks; many don't. **"workspace isolation by discipline" is more accurate than "real RLS."** A single `select *` without an explicit `eq('workspace_id', …)` will, on the RLS-off tables, return cross-tenant data.

### Secrets

- **`.env` is committed.** Contains `VITE_FIRECRAWL_API_KEY="fc-d5fea417d1b04035b44c11e6c72fd7a9"` (live), the Supabase URL (`wqnigjhcwjxtmordrwno` — note: **wrong project**), the anon JWT (low impact, but identifies the project).
- `.env` is **not in `.gitignore`** (verified).
- The Firecrawl key is in `VITE_*` namespace — therefore bundled into the frontend JS, even if you fix `.env`. The current frontend deploy is shipping this key in browser-readable code.
- n8n JSONs: no raw secrets (only credential UUIDs). Good.
- Python scripts at root (e.g., `deploy.py`, `optimize_v4.py`): not inspected for secrets. **"unknown — would need to grep more carefully."**

### Injection / SSRF surfaces

- `parse-resume`: takes user-supplied base64. Decoded in-memory, passed to LLM. Low SSRF risk.
- `screen-candidate`: takes `{action, application_id, answer, question_index}`. `application_id` is the only DB key — fetched by `.eq('id', application_id)`. UUID-typed, so injection-safe.
- `lead-scraper` / `deep-search` UI: posts the user's query string to an n8n webhook. The webhook URL is **client-supplied via `VITE_*` env**. If a contributor swaps the env var, every user's queries route to an attacker-controlled server. Lock down or document.
- Firecrawl calls (`src/lib/firecrawl.ts`): I did not read it. If it constructs URLs from user input without an allowlist, it's an SSRF vector. **"unknown — would need to read the file."**
- `email-tracking`: typical pixel handler; takes IDs from query string. Looks safe.

### File upload

- Resume upload path: base64 in JSON body → `parse-resume` edge fn. **No file size cap visible** (Supabase edge fns default to 6 MB body, so there's *an* implicit cap). **No MIME validation** — anything decodes-or-doesn't. **No virus scan, no Cloudflare R2/S3 storage path** — resumes never persist as files, only as extracted JSON. Privacy upside (resume content not retained as file); compliance downside (no audit trail of what was uploaded).
- **No rate limiting** on the upload endpoint.

---

## 9. Observability and ops

| Concern | State |
|---|---|
| Sentry / Rollbar / Bugsnag | **None.** Zero references. |
| PostHog / Amplitude / Mixpanel | **None.** Mixpanel/Amplitude appear only as items in `src/types/icp.ts:163-164` (data taxonomy), not integrations. |
| Datadog / New Relic | **None.** |
| Structured logging | **No.** Every edge fn uses `console.log` / `console.error`. ~700+ such calls across `src/`. |
| Health checks | `orchestrate` accepts `{ping:true}` (line 102). `src/components/dev/VerificationPanel.tsx` does smoke pings. No uptime monitor visible. |
| Alerting | **None.** |
| CI/CD | **No `.github/` directory at all.** No GitHub Actions, no GitLab CI, no Vercel config, no fly.toml. Deploys are presumably push-to-Lovable. |
| Tests | **Zero.** No `*.test.*`, `*.spec.*`, `vitest`, `jest`, `playwright`, or `cypress` anywhere. Confirmed. |
| Linting | ESLint config exists (`eslint.config.js`), runs via `npm run lint`. Not enforced in CI (since no CI). |

The realistic test coverage of the critical screening flow is **0%**. Demo reliability rests on manual click-throughs.

---

## 10. Billing and plans

- `src/hooks/usePlans.ts` is **about `task_plans` (orchestration plans), NOT subscription plans**. Misleading name. It subscribes to the `task_plans` Supabase table.
- No `useSubscription`, `useBilling`, `useEntitlement`, `usePaywall`, etc.
- `stripe` in `package.json`: **absent**. Verified.
- `/pricing` page exists but is **a marketing display** — no checkout button wired.
- One file references `Stripe` (`src/pages/candidates/CandidateDossier.tsx`) — almost certainly a logo / icon reference, not an integration.
- No quota / rate limit logic on AI calls, scraping, or email sends anywhere. The Lovable AI Gateway and Resend will bill you for every call regardless of plan. **A free user can drive arbitrary Anthropic/OpenAI/Resend spend.**

---

## 11. The cut list

### DELETE (today, no debate)

| Item | Why |
|---|---|
| `icp_lookalike_engine_original.json`, `_v2`, `_v3`, `_v3_final` | 4 superseded versions of the same workflow. Keep `v4_final` only. |
| `workflow_result.json`, `execution_645.json` | These are execution dumps, not workflows. Pure artifacts. |
| `agent-console.html` (95 KB) | Unwired single-page artifact at repo root. |
| `project_files.txt` (63 KB) | Artifact dump. |
| `AgriDrone-Guardian/`, `agridrone_guardian/`, `linkedin-content-planner/`, `test_deploy/`, `lib/`, `skills/` | Unrelated sibling projects pulled into root. Move to their own repos. |
| Root Python scripts (`deploy.py`, `optimize_v4.py`, `finalize_v3.py`, `fix_n8n.py`, `update_workflow.py`, `optimize_workflow.py`, `optimize_prompt_v3.py`, `debug_sessions.py`) | One-off scripts, no `requirements.txt`, no docs, no callers. |
| `bun.lock` + `bun.lockb` + `deno.lock` (assuming you keep npm) | Pick one package manager. |
| `getResumeAnalysis-` (live edge fn with trailing dash) | Orphan duplicate. Confirmed via MCP. |
| `src/data/industries.ts` (2,607 LOC of static data in `.ts`) | Move to JSON; keeps it out of the type-check graph. |
| `commented-out routes` in `src/App.tsx` lines 56-67 and 200-211, plus their dead page files | Re-introduce when actually built. |
| `audit_log`, `error_log`, `closely_events`, `codex_leads`, `sp_outreach_leads_scored`, `sp_wellfound_leads`, `outreach_error_log`, `outreach_daily_queue`, `job_transition_rules`, `tools`, `secret_connections`, `jobs`, `job_steps` | Tables with zero writers and zero readers in code. |
| `src/components/expert-marketplace/mockData.ts` + `/expert-marketplace` route | 100% mock. Either build it or remove from product. |

### FEATURE-FLAG OFF (hide from prod until built)

| Item | Why |
|---|---|
| `/competitors`, `/competitor-intel`, `/talent-intel`, `/growth-signals` | UI exists; the scrapers that populate `competitor_*`, `talent_signals`, `growth_signal_companies` are not running anywhere in repo. Tables stay empty in demos. |
| `/distribution` | No actual job-distribution logic. Schema only. |
| `/post-interceptor` | Unverified wiring; on roadmap's "Watch" list. |
| `/expert-marketplace` | Pure mock. |
| `/lead-scraper`, `/deep-search`, `/icp-intelligence` *(if doing a screening-only demo)* | Each depends on the n8n SPOF. Off unless you've verified n8n uptime today. |

### KEEP BUT DE-PRIORITIZE

| Item | Why |
|---|---|
| `/departments`, `/rooms/:dept`, `/plans/:planId` | The orchestration UI looks good but `run-agent` is fake. Keep visible for the narrative — but until you wire real LLM work into `run-agent`, this is a demo trap. |
| Outreach engine (`/outreach-engine`, `/lead-crm`, `/email-sequences`) | Backed by RLS-disabled tables. Tighten before pilots. |
| Remotion video sub-flow | Adjacent, not on critical path. |

### KEEP

| Item | Why |
|---|---|
| `/apply/:slug`, `/screening-jobs`, `/candidates`, `/candidates/:id`, `/interview-scheduler`, `/book/:token` | The screening critical path. The only thing that works end-to-end without n8n. |
| `orchestrate`, `approve-and-continue` (the orchestration spine) | Real, correct. |
| `chat-respond` (after creating the `conversations`/`messages` tables) | Real once unblocked. |
| The screening edge fns (`parse-resume`, `screen-candidate`, `adaptive-screening-chat`, `analyze-behavioral-signals`, `generate-screening-*`) | Real, but need rate-limiting and JWT verification. |
| Resume + interview flow | Cohesive. |

---

## 12. "If I had to ship a reliable demo in 2 weeks" list

Goal: `/apply/:slug` → resume parsed → screened → interview scheduled → recruiter sees candidate. Nothing else.

Ranked by severity (highest first):

1. **Point `.env` at the right Supabase project** (`zbwsbnqqpkvdhqwavjke`). Move the URL/key to `.env.local`, add `.env` to `.gitignore`, scrub the Firecrawl key from history. *(15 min + history rewrite)*
2. **Verify a Resend domain.** Replace `onboarding@resend.dev` with `noreply@<yourdomain>` in `screening-notifications`, `send-interview-invite`, `send-scheduled-emails`. Without this, demo emails go to spam. *(1 hour)*
3. **Add JWT verification (or signed-token gating) to `parse-resume` and `screen-candidate`**, since they drive Lovable-gateway spend. Or wrap with a per-IP rate limit. *(½ day)*
4. **Add minimal retry + timeout to every `fetch(LOVABLE_GATEWAY)` and `fetch(api.resend.com)`** in the screening fns. 2 attempts with 1s backoff, 25s timeout. *(½ day)*
5. **Add an idempotency check to `evaluate_answer`** so a double-submit doesn't double-score. *(1 hour)*
6. **Enable RLS + workspace-scoped policies** on `screening_applications`, `screening_jobs`, `interviews`, `interview_slots`, `resume_analyses`. Spot-check current policies before assuming they exist. *(1 day)*
7. **Verify slug entropy on `screening_jobs.slug`.** If slugs are short, regenerate with a hard-to-guess token. *(2 hours)*
8. **Create the `conversations` + `messages` tables** *(only if the demo includes the dashboard chat)*. Otherwise, temporarily strip the chat surface from the demo build. *(½ day)*
9. **Add Sentry to the frontend and edge fns.** Even free tier. Without it, demos fail blindly. *(½ day)*
10. **Write five Playwright happy-path tests** for steps 2-8 of §7, run them locally before every demo. *(1 day)*

Total: roughly 5-6 engineer-days. Everything else waits.

---

## 13. Surprises

**1. `run-agent` is theatre.** This is the single most important finding. The "AI workforce" is a 600-millisecond `setTimeout` that flips a status field and writes the literal string `"auto-completed"` (`supabase/functions/run-agent/index.ts:70, 105`). The orchestration loop, handoff chain, and approval gating are *real*; the workers are not. The roadmap's "Stage 1: synthetic" honestly admits this but the dashboard UX (`agents.status='running'`, progress bars) communicates the opposite. The first customer who watches a 5-step plan complete in 4 seconds will notice.

**2. Two different Supabase projects.** The committed `.env` points at `wqnigjhcwjxtmordrwno`. The live database with all the data lives at `zbwsbnqqpkvdhqwavjke`. The frontend, if anyone deployed it from this repo, talks to the wrong project. This is also exactly the "schema drift" the roadmap calls out — except it's worse: it's two whole projects, and the live one has tables (`organizations`, `departments`, `jobs`, `job_steps`, `dialer_leads`, `secret_connections`, `tools`) **that have no migration in this repo**. The repo is behind production.

**3. Lovable AI Gateway is a single point of failure invisible to the high-level audit.** Every screening function and the orchestrator pass through `https://ai.gateway.lovable.dev/v1/chat/completions`. If Lovable hosting goes dark, you don't just lose the dev environment — your screening product goes dark too, even on customer infrastructure. The dependency is not flagged anywhere in docs.

**4. The dialer is real but lives outside the repo.** 36 rows in `dialer_leads`, a `dialer_status` table, and the roadmap claims "Telnyx dialer wired with disposition tracking." Zero matches for `telnyx`, `dialer`, or `disposition` in this repo. The most active subsystem in production has no source code in the project being audited. Either it's in `linkedin-content-planner/` (sibling project; not verified), in n8n, or on an unlisted server. Discoverability gap.

**5. Commit hygiene hides incidents.** 1,074 commits, of which the most recent ~30 are titled "Changes" or "Update plan." That looks like Lovable's default commit messages, but it also means `git log` is unhelpful for forensic work. Worth noting: 51 migration files, but the manual `outreach.sql` filename breaks Supabase's filename-ordered migration semantics — that's the kind of mistake that creates schema drift in the first place.

---

## Notes on what I did not do

- Did not run any migrations, did not write to DB, did not call any external API.
- Did not read every one of the 51 migrations; spot-checked headers + RLS coverage via MCP advisor.
- Did not unpack the n8n Function nodes — node-type counts only.
- Did not fully read `src/lib/firecrawl.ts`, `src/lib/orchestration.ts`, or the four large context providers. If you want SSRF safety on Firecrawl confirmed, that's the next read.
- Did not enumerate every RLS policy on every table — used the live `get_advisors` summary.
- Did not inspect Python scripts at root for secrets or behavior.
