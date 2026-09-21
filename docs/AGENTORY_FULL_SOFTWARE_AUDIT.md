# Agentory — Full Software Audit

**Date:** 2026-09-07
**Repo:** `/Users/prasidha/agentory-main-local` @ `5874aa8b`
**Project:** `ohsdatpvfdjdemstoiuj`
**Method:** read-only. No code changes, no migrations, no deploys, no secret writes, no paid provider calls.
**Evidence:** repo source, live schema, live row counts, live RLS/grants, deployed function list. Every claim below is traceable to one of those. Where something was not verified it says so.

---

## EXECUTIVE SUMMARY

Agentory today is **one working product with a large amount of scaffolding around it**.

The working product is the lead-sourcing engine: mission compilation → Apify discovery → identity → enrichment → hiring verification → qualification → web evidence → P4 re-evaluation → counting → delivery. It has real engineering behind it — lineage leases, checkpoint/resume, row-fence cancellation, provider idempotency keyed on `logical_call_key`, a spend ledger with provider-reported cost, and a stalled-run sweeper. That subsystem is genuinely production-grade in design and has run 107 tasks.

Almost everything else is either empty, unreachable, or has never executed once.

The three numbers that describe the product most honestly:

| Measurement | Value |
|---|---|
| Tables holding any data | **30 of 120** (90 empty) |
| Agent slugs that have ever executed a task | **2 of 5** — `scout` (107), `aria` (1). `scribe`, `penn`, `hawk`: **never** |
| `saved_outputs` rows that are content | **0 of 273** — all 273 are `workflow_summary` |

**Content is the weakest area in the product and the gap is not marginal — it is total.** The Content section has no backend of its own, no data model, no persistence, and its generation agent has never run. Details in the deep-audit section.

There is **one P0 security defect**: a table containing full task snapshots — including `workspace_id`, `user_id`, `payload`, `input`, `output` — has RLS disabled and `SELECT` granted to `anon`. The anon key ships in the frontend bundle.

**If you gave Agentory to real users today:** they could run lead searches (once Apify access is restored) and get real, evidence-backed results. Every other navigation item would present a working-looking interface that produces nothing durable. And anyone who opened the app could read other workspaces' archived run data.

---

## CURRENT ARCHITECTURE

```
React SPA (Vite, 801 .ts/.tsx files, 66 routes)
   │
   ├── supabase-js  ──►  PostgREST  ──►  Postgres (120 tables, RLS on 119)
   │
   └── functions.invoke  ──►  33 Edge Functions (Deno)
                                  │
                                  ├── run-agent            lead sourcing engine (the product)
                                  ├── pilot-chat           chat / planning / workflow summaries
                                  ├── orchestrate          legacy instruction router
                                  ├── run-monitoring-scan  signals
                                  ├── resume-stalled-leads sweeper (cron)
                                  └── 28 others (mostly recruiting-era)
                                       │
                                       └── _shared/ (354 modules)
                                             │
                                             └── Providers:
                                                   OpenAI, Anthropic, Perplexity   (models)
                                                   Apify                            (discovery/enrichment)
                                                   Firecrawl                        (web evidence)
                                                   Resend                           (email)
```

**Schema management is healthy.** `20260816120000_baseline_schema.sql` covers 119 tables, with 30 forward migrations and 103 archived. This is not a drifting schema — a real positive, and better than the raw "30 migrations, 120 tables" ratio suggests.

---

## FEATURE INVENTORY

| Area | Classification | Evidence |
|---|---|---|
| **Lead finding / sourcing** | PRODUCTION-WORKING (currently provider-blocked) | 107 `scout` tasks, 60 lineages, 2,188 execution-call rows, 42 lead candidates |
| **Company investigation / enrichment** | PRODUCTION-WORKING | 273 `lead_enrichments`, 492 headcount snapshots |
| **Qualification (Brain / mission evaluation)** | PRODUCTION-WORKING | evaluations persisted in lineage checkpoints; 3 companies historically reached `qualified` |
| **Evidence / P4** | IMPLEMENTED BUT UNPROVEN | 85 `company_web_evidence` rows; four fixes landed 6 Sep, none exercised in production |
| **Chat / Brain (pilot-chat)** | PRODUCTION-WORKING (narrow) | 158 messages, 20 conversations, 96 plans; every message written as `agent_slug: "pilot"` |
| **Monitoring / Signals** | IMPLEMENTED BUT UNPROVEN | 29 `signal_events`, 5 monitoring runs, 6 subjects; last event 4 Sep |
| **Workbench** | PARTIALLY IMPLEMENTED | renders from plan/task tables; not independently verified |
| **Content** | **UI-ONLY** | see deep audit — zero backend, zero rows, agent never ran |
| **Agents / employees** | PARTIALLY IMPLEMENTED | 5 slugs registered; 2 have ever executed |
| **Campaigns / outreach** | UI-ONLY | `outreach_drafts` 0 rows, `penn` never executed |
| **Authentication** | PRODUCTION-WORKING | Supabase auth, `ProtectedRoute` on app routes |
| **Workspace / account mgmt** | PRODUCTION-WORKING | 3 workspaces, 1 profile |
| **Billing / credits** | PRODUCTION-WORKING | 1,300 `credit_transactions`, reserve/settle proven |
| **Settings / integrations** | PARTIALLY IMPLEMENTED | `integration-readiness` live; readiness only, no OAuth for social |
| **Background jobs / cron** | PRODUCTION-WORKING | `resume-stalled-leads` + monitoring cron ticking on schedule |
| **Notifications** | BACKEND-ONLY | `screening-notifications` exists; recruiting-era |
| **Recruiting / screening / interviews** | **LEGACY — DEAD** | ~44 components, ~15 routes, all backing tables empty |
| **Expert marketplace / portal** | **LEGACY — DEAD** | 6 components, 4 routes, no data |
| **Post-interceptor / distribution / dialer** | **LEGACY — DEAD** | 12 components; `dialer_campaigns` empty, no dialer code at all |

---

## WHAT ACTUALLY WORKS

Verified against live data, not inferred:

1. **The lead capability engine.** Mission compiled from the user's sentence, capability plan resolved, providers executed under a containment guard, per-company state checkpointed and resumed across slices.
2. **Provider idempotency.** `logical_call_key = lineage:capability:v2:<sha>`. A timed-out Apify run is *adopted* on the next slice (`timed_out` → `reused`, same `provider_run_id`) rather than re-bought. Verified: zero genuine duplicate purchases across 546 Apify calls.
3. **Spend ledger for Apify.** 546 calls carry `cost_source: provider_reported`, $8.85 total, per-call attribution.
4. **Credit reserve/settle.** 1,300 transactions; balance and reservations return to a clean state after cancellation and after provider failure (verified twice this week: 976 credits / 0 reserved).
5. **Cancellation.** `cancel_lineage` row fence; both the claim gate and the lease gate refuse a cancelled lineage. Proven twice in production.
6. **Terminal truthfulness.** A run with 0 qualified reports `partial` / `frontier_exhausted`, never `completed`. Verified again in today's canary.
7. **The sweeper.** Ticking steadily, reaping abandoned runs, `dispatched: 0`.
8. **Auth and workspace isolation** — with the one exception below.
9. **Schema management.** Baseline + forward migrations, not dashboard drift.

---

## WHAT IS UNPROVEN

- **Evidence/P4 end-to-end in production.** The four fixes of 6 Sep (`17d961e6`, `2666255d`, `5874aa8b`, plus the scheduler fix `17bcab88`) are proven only by offline replay against persisted payloads. No production run has exercised them.
- **Monitoring/Signals** beyond 29 events.
- **Workbench** rendering under real load.
- **Anything involving `scribe`, `penn`, or `hawk`** — never executed.
- **Every recruiting-era function** — 28 of 33 Edge Functions have no observable production traffic in the tables they would write.

---

## P0 FINDINGS

### P0-1 — `ops_stuck_run_archive` is world-readable and contains full customer run data

- **File/object:** table `public.ops_stuck_run_archive`; created by `supabase/migrations/20260826100000_sweep_stuck_runs.sql`
- **Observed:** `relrowsecurity = false`. `has_table_privilege('anon', …, 'SELECT') = true`. 8 rows. Columns `id, kind, archived_at, snapshot`. `snapshot` is a complete `tasks` row — `workspace_id`, `user_id`, `input`, `output`, `result`, `payload`, `error_message`. One row is **160,329 bytes** of a full lead run.
- **Expected:** RLS enabled, workspace-scoped policy, or no `anon` grant at all — it is an ops table with no client reader.
- **Why it matters:** the anon key is published in the frontend bundle. Any visitor can `GET /rest/v1/ops_stuck_run_archive` and read other workspaces' prospect lists, evidence and internal state. This is a cross-tenant data leak, live now.
- **Root cause proven:** yes — verified directly against `pg_class` and `has_table_privilege`.
- **Smallest likely fix:** `ALTER TABLE public.ops_stuck_run_archive ENABLE ROW LEVEL SECURITY;` and `REVOKE SELECT ON public.ops_stuck_run_archive FROM anon, authenticated;` — the sweeper writes with the service role and needs no policy.
- **Regression test:** an infra test asserting every `public` table has `relrowsecurity = true`, with an explicit allow-list, so the next ops table cannot repeat this. `tests/infra/` already has the harness for schema assertions.

### P0-2 — Content produces nothing durable, and never has

- **Files:** `src/pages/Content.tsx`, `src/components/content/*` (12 components), `src/lib/contentBuckets.ts`
- **Observed:** every Content action calls `sendAgentCommand(<English sentence>)`. There is not one `functions.invoke` and not one `supabase.from().insert()` in the entire Content section. `saved_outputs` holds 273 rows, **100% `type: workflow_summary`, zero `content_draft`**. `outreach_drafts`, `linkedin_posts`, `marketing_videos`, `scheduled_emails`: **0 rows each**. `scribe` has **never** executed a task.
- **Expected:** a content action produces a persisted, reopenable, editable artifact.
- **Why it matters:** this is a headline navigation item. A user can spend twenty minutes in it and have nothing to show — no draft saved, no history, nothing to return to. It is the single largest gap between what the UI promises and what exists.
- **Root cause proven:** yes.
- **Smallest likely fix:** not small. Requires a content object (see CONTENT P0-1) and a real generation endpoint. Treat as a build, not a fix.
- **Regression test:** an integration test that drives a content action and asserts a row lands in a content table.

### P0-3 — Model spend has no workspace cap

- **File:** `supabase/functions/_shared/toolRegistry.ts:1692` — `const PAID_TOOLS = new Set(["source_with_apify", "scrape_url"]);`
- **Observed:** only Apify and Firecrawl reserve credits and write a spend ledger row. OpenAI/Anthropic/Perplexity calls are made directly with no credit authorization. Per-run caps exist (`calls_allowed`, `MAX_COMPILATION_ATTEMPTS`) but they are per-slice budgets, not per-workspace spend limits.
- **Expected:** model spend is authorized and ledgered like provider spend, with a workspace ceiling.
- **Why it matters:** chat is unmetered. A user in a loop — or a malicious one — can generate unbounded model cost with no gate and no ledger row to attribute it to. `lead_model_calls` records the calls but does not gate them.
- **Root cause proven:** yes.
- **Smallest likely fix:** add model calls to the credit authorization path used by `PAID_TOOLS`, reserving on a token estimate and settling on actual usage.
- **Regression test:** a workspace at zero credits cannot make a model call.

---

## P1 FINDINGS

### P1-1 — A shipped button calls an Edge Function that does not exist

- **File:** `src/components/signals/ManualSourceInput.tsx:42` — `supabase.functions.invoke("firecrawl-scrape", …)`
- **Observed:** `firecrawl-scrape` is not in `supabase/functions/` and not among the 33 deployed functions. The call 404s.
- **Expected:** the manual source input scrapes a URL.
- **Why it matters:** a visible, clickable feature that fails every time. The correct function name for this capability is the `scrape_url` tool inside `run-agent`/`toolRegistry`.
- **Root cause proven:** yes — verified against the repo and the live deployed list.
- **Smallest likely fix:** route through an existing function, or delete the control.
- **Regression test:** a build-time assertion that every string literal passed to `functions.invoke` matches a directory in `supabase/functions/`. This would have caught it and will catch the next one.

### P1-2 — The Content page addresses agents that do not do content

- **Files:** `src/pages/Content.tsx:178,283,284`; `src/config/agentRegistry.ts:188,216`
- **Observed:** the registry maps **Mira → `penn`** (Message Strategist, outreach) and **Orion → `scribe`** (with a comment that Scribe's content capability is "intentionally NOT migrated to Orion yet"). The Content page dispatches `"Mira, refine this comment draft…"` and `"Lyra, refresh LinkedIn trends…"`, and renders Mira using `scribe.webp`. Only `agent_slug === "scribe"` triggers `writeScribeContent` (`memoryWriter.ts:388`).
- **Expected:** the content surface addresses the content agent.
- **Why it matters:** even if dispatch worked, commands from Content would route to the outreach writer, which writes `outreach_drafts`, not `content_draft`. The avatar/identity mismatch also means the UI shows one agent's face under another's name.
- **Root cause proven:** partially — the registry mapping and the writer gate are proven; the end-to-end routing of a `"Mira, …"` sentence through `pilot-chat` was **NOT traced to completion**. What is proven is that no `penn` or `scribe` task has ever been created.
- **Smallest likely fix:** decide which slug owns content, then make the Content surface address it.
- **Regression test:** assert every agent name used in a dispatched command string resolves to a slug that has a writer branch.

### P1-3 — The content generation path is not reachable from the Content page

- **Files:** `supabase/functions/_shared/contentEngagementLoop.ts`; `supabase/functions/orchestrate/index.ts`; `src/lib/orchestration.ts:439`; `src/lib/pilotChat.ts:54`
- **Observed:** `contentEngagementLoop` — the only module that builds content plans — is imported **only** by `orchestrate`. `orchestrate` is invoked only from `submitInstruction`, whose only callers are `CommandPalette.tsx:135` and `DepartmentRoom.tsx:139`. The Content page and the chat composer both route to `pilot-chat` instead. `/departments` and `/rooms/:dept` are `<Navigate>` redirects in `App.tsx`.
- **Expected:** the Content surface reaches the content pipeline.
- **Why it matters:** the content backend is not missing — it is orphaned behind a different entrypoint.
- **Root cause proven:** import graph proven; whether `DepartmentRoom` is still mountable was **NOT verified**.
- **Smallest likely fix:** call the content loop from the path the Content page actually uses.
- **Regression test:** an integration test dispatching a Content action and asserting `contentEngagementLoop` runs.

### P1-4 — Firecrawl spend is invisible

- **File:** `supabase/functions/_shared/toolRegistry.ts` (`execScrapeUrl`), cost columns in `lead_execution_calls`
- **Observed:** all 267 Firecrawl rows record `actual_cost_usd = 0.0000`, including 39 marked `cost_source: event_priced`. Apify, by contrast, reports real cost on 546 rows.
- **Expected:** Firecrawl cost is captured like Apify's.
- **Why it matters:** one of two paid providers cannot be budgeted, alerted on, or billed back. Any spend cap that includes Firecrawl is currently an estimate. (You have explicitly deferred this; recorded here for completeness.)
- **Root cause proven:** yes, by aggregation.
- **Smallest likely fix:** read Firecrawl's response cost/credit fields in `execScrapeUrl` and populate the ledger.
- **Regression test:** assert a successful scrape writes a non-zero cost.

### P1-5 — `chat-respond` has a dead Gemini branch

- **File:** `supabase/functions/chat-respond/index.ts:72` — `Deno.env.get('GOOGLE_AI_API_KEY')`
- **Observed:** `GOOGLE_AI_API_KEY` is **not** among the 18 configured secrets.
- **Expected:** a configured provider or no branch.
- **Why it matters:** if that path is ever selected the call fails at runtime. Whether it is currently selectable was **NOT verified**.
- **Root cause proven:** the missing secret is proven; reachability is not.

---

## P2 / P3 FINDINGS

**P2**

- **No unique constraint on `agents (workspace_id, slug)`.** Only `agents_pkey` and the workspace FK exist. Nothing prevents duplicate agents in one workspace. Current duplicates are legitimately cross-workspace.
- **`lead_lineages` has RLS enabled with zero policies** — deny-all to clients. Correct for a service-role table, but it means no client can ever read lineage state; worth confirming that is intentional rather than an oversight.
- **90 of 120 tables are empty.** Each is an RLS surface, a migration burden, and a source of confusion about what the product is.
- **28 of 33 Edge Functions have no observable production traffic.**

**P3**

- Repo root holds ~25 loose artifacts unrelated to the app: `optimize_v4.py`, `workflow_deepsearch.json`, `icp_lookalike_engine_v*.json`, `AgriDrone-Guardian/`, `agent-console.html`, `execution_645.json`, `test_deploy/`. These belong in an archive directory or out of the repo.
- `linkedin-content-planner/` and `screening-pilot-pipeline/` are separate trees inside the app repo.

---

## CONTENT SECTION — DEEP AUDIT

### What the Content feature actually is

**A read-only dashboard over the Signals feed, plus twelve buttons that type English sentences into the chat.**

`src/pages/Content.tsx` (834 lines) has four views — For You, Top 10 Trends, Comment Opportunities, Plan & Drafts. Its data comes from three hooks: `useSignalFeed`, `useSignalReviews`, `useIntegrationReadiness`. Its actions come from one function: `sendAgentCommand`.

The file's own header says *"All data is real. Everything is approval-first. Backend unchanged."* The first clause is true — and the third explains the problem.

### Capability-by-capability

| Capability | Exists? | Notes |
|---|---|---|
| Content dashboard | ✅ UI | four views, live counters |
| Idea generation | ⚠️ dispatch only | sends a sentence to chat |
| Drafts | ❌ | `postDraftOutputs()` filters `saved_outputs` for content types; **0 exist** |
| Comment opportunities | ❌ | `commentDraftRows()` reads `outreach_drafts`; **0 rows** |
| Trends | ✅ | derived from `signal_events` (29 rows, last 4 Sep) |
| Content brief | ✅ | `deriveContentBrief()` — pure client-side derivation |
| Approval queue | ⚠️ UI | `DraftApprovalQueue.tsx` renders over an always-empty list |
| Scheduling | ❌ | no table, no code, no cron |
| Publishing | ❌ | no social integration anywhere in the repo |
| Videos / images | ❌ | **no HeyGen, no image or video provider exists**; `marketing_videos` is an empty table with no code |
| Templates | ❌ | none |
| Brand voice | ❌ | not passed into any content prompt |
| Content history | ❌ | nothing persisted to have a history of |
| Analytics | ❌ | none |

### The fifteen questions, for the representative action ("Turn this signal into a post")

| Question | Answer |
|---|---|
| What does the user click? | "Turn into post" on a signal card |
| Frontend component | `SignalToContentCard.tsx:30` → `buildTurnIntoCommand()` |
| API / function called | **None.** `sendAgentCommand()` → `window` event → chat composer → `pilot-chat` |
| Model / provider | whatever `pilot-chat` selects for a free-text message |
| Prompt used | no content-specific prompt; the user's sentence plus chat system context |
| Data persisted | a chat message, and possibly a `workflow_summary` |
| Where persisted | `messages`, `saved_outputs` |
| Reopenable later? | only as chat history |
| Editable? | no |
| Regenerable? | only by retyping |
| Version / history? | no |
| Failure recovery | toast: *"Couldn't reach Pilot"* — honest, but the work is lost |
| Refresh loses state? | **yes** — nothing is persisted as content |
| Costs money? | yes, a model call |
| Cost controlled? | **no** — see P0-3 |

### CONTENT DATA FLOW

```
Signal card click
   → buildTurnIntoCommand()               (string template)
   → sendAgentCommand()                   (toast + window event)
   → chatCommandBus 'chat:send'
   → ChatComposerPro                      (only listener)
   → pilotChat() → pilot-chat
   → model call
   → messages / saved_outputs(workflow_summary)
   ✗ never reaches contentEngagementLoop  (that lives behind `orchestrate`)
   ✗ never creates a scribe task          (0 in history)
   ✗ never writes content_draft           (0 in history)
```

### CONTENT PROVIDER FLOW

There is no content provider pipeline. No media generation of any kind exists — no HeyGen, no image model, no TTS, no video. The only providers configured are OpenAI, Anthropic, Perplexity, Apify, Firecrawl and Resend.

Parts 6 (asset pipeline) and 7 (publishing/scheduling) of the audit brief therefore have a single answer: **these do not exist.** Not partially — not at all. There are no provider job IDs to lose, no polling loops, no expiring asset URLs, and no scheduler, because nothing is generated or scheduled.

### CONTENT PERSISTENCE

**Canonical objects that exist:** none.

| Object from your list | Status |
|---|---|
| `content_project` | ❌ missing |
| `content_idea` | ❌ missing |
| `content_draft` | ⚠️ a `type` string on `saved_outputs`, never written |
| `content_asset` | ❌ missing |
| `content_version` | ❌ missing |
| `campaign` | ❌ missing (`dialer_campaigns` is unrelated and empty) |
| brand context | ⚠️ `company_brain` (2 rows) exists but is not read by any content path |
| channel/platform | ❌ missing |
| `scheduled_publication` | ❌ missing |
| published content | ❌ missing (`linkedin_posts` empty, no writer) |
| performance metrics | ❌ missing |

**Content that exists only in ephemeral state:** all of it. Everything the user does in Content lives in React state (`view`, `openDraftId`, `miraContext`, `createOpen`) or in a chat message. Nothing survives a refresh as content.

### CONTENT INTELLIGENCE AUDIT

There is no content generation prompt in the codebase — no system prompt, no brand-voice injection, no ICP context, no product information, no platform-specific instruction, no previous-content retrieval. The only content-shaped intelligence is `contentEngagementLoop.ts`, which parses a user sentence into `{topic, contentFormat, needsEngagementSearch, needsCommentDrafts}` and builds search queries. It is orphaned behind `orchestrate` (P1-3).

So the honest answer to your question — generic prompt, or persistent company context? — is **neither**. Today it is: *user's raw sentence → general chat model → prose in a chat bubble.* `company_brain` holds workspace context and is never consulted on any content path.

`cleanScribeOutput()` (`memoryWriter.ts:1295`) is a genuine positive: it strips ```` ```json ```` fences, parses structured output, falls back safely on parse failure, and never stores a fence as a title. It is careful code — for a path that has never run.

### CONTENT TEST COVERAGE

Four files, ~290 lines total, against a 2,747-line feature.

| File | Type | Assessment |
|---|---|---|
| `src/lib/contentBuckets.test.ts` | pure unit | **TOOTHLESS** |
| `src/lib/contentDraftModel.test.ts` | pure unit | **TOOTHLESS** |
| `src/lib/contentOps.test.ts` | pure unit | status-derivation only |
| `tests/edge-functions/_shared/contentEngagementLoop.test.ts` | pure unit | tests an orphaned module |

**The toothless pattern, precisely.** `contentBuckets.test.ts:18` builds `out({ id: "a", type: "content_draft", raw: { subtype: "founder_post" } })`. That row shape has **never existed in production** — 273 of 273 `saved_outputs` are `workflow_summary`. The test proves the bucketing function would work if such a row existed; it cannot detect that none ever will. This is the same failure mode found in `webEvidenceReevaluation.test.ts`, where the fixture supplied a registry containing web pages that production never produces.

There are **zero** Content integration tests, persistence tests, provider-mock tests, failure-path tests and RLS tests.

### CONTENT P0 / P1 / P2 / P3

**CONTENT P0-1 — No content data model.** Nothing a user creates can be saved, reopened, edited, versioned or queried. *Fix:* a `content_item` table with workspace scope, status, body, source signal, and a version child. *Test:* an action produces a row; a reload finds it.

**CONTENT P0-2 — Generation never executes.** `writeScribeContent` is gated on `agent_slug === "scribe"`; no scribe task has ever been created. *Fix:* wire the Content surface to a path that creates one. *Test:* a Content action creates a scribe task and a persisted draft.

**CONTENT P1-1 — Every counter is structurally zero.** Posts, drafts, comments and the approval queue all read from tables that are empty and have no writer. The page renders "0" confidently, which reads as "no work yet" rather than "this cannot work".

**CONTENT P1-2 — Agent identity mismatch.** Mira → `penn` (outreach), while content is written by `scribe`; the UI shows `scribe.webp` under the name Mira. See P1-2.

**CONTENT P1-3 — No brand voice or company context in generation.** `company_brain` exists and is never read by any content path.

**CONTENT P2-1 — `DraftApprovalQueue` is an approval UI with nothing to approve** and no approve endpoint.

**CONTENT P2-2 — `ManualContentSource` and `ContentPromptBox` dispatch sentences** with no validation that the target agent can act on them.

**CONTENT P3-1 — `marketing_videos` and `linkedin_posts` are empty tables with no code.** Either build them or drop them.

---

## DATABASE / RLS FINDINGS

- **119 of 120 tables have RLS enabled.** This is good and better than typical.
- **`ops_stuck_run_archive`: RLS disabled, `anon` SELECT granted, customer payloads inside.** P0-1.
- **`lead_lineages`: RLS enabled, zero policies** — deny-all to clients, service-role only. Confirm intent.
- **Missing unique constraint** on `agents (workspace_id, slug)`.
- **90 of 120 tables empty.**
- Schema is migration-managed with a baseline; no significant drift found.
- Cross-workspace leakage risk: **one confirmed path** (P0-1). No others found in the tables sampled. A full 120-table policy review was **NOT performed** — RLS presence was checked, individual policy *correctness* was not.

---

## PROVIDER / SPEND FINDINGS

| Provider | Caller | Trigger | Dedupe | Ledger | Hard limit | Fan-out risk |
|---|---|---|---|---|---|---|
| **Apify** | `toolRegistry.execSourceWithApify` | lead sourcing | ✅ `logical_call_key` | ✅ provider-reported cost | ✅ credit reserve | Low — bounded by investigation budget |
| **Firecrawl** | `toolRegistry.execScrapeUrl` | evidence debt | ✅ URL cache + TTL | ⚠️ **cost always 0.0000** | ✅ credit reserve | Low |
| **OpenAI** | `gptProvider`, `chat-respond` | chat, planning, evaluation | ❌ none | ⚠️ recorded, not gated | ❌ **none** | **High — unmetered chat** |
| **Anthropic** | `chat-respond`, writing agents | chat | ❌ none | ⚠️ | ❌ **none** | **High** |
| **Perplexity** | research | research tools | ❌ | ⚠️ | ❌ | Medium |
| **Resend** | email functions | recruiting-era | ❌ | ❌ | ❌ | Low (unused) |

The Apify/Firecrawl path is genuinely well built — reserve, execute, settle, dedupe, adopt-on-timeout. The model path has none of that.

---

## DEAD / LEGACY CODE

The repo contains a **complete second product** — a recruiting/screening/interview platform — fully routed and fully unused:

- **~44 components:** screening (13), interview (13), expert-marketplace (6), apply (5), post-interceptor (5), candidates (2)
- **~15 routes** in `App.tsx`: `/candidates`, `/screening-jobs`, `/interviews/*`, `/portal/*`, `/apply/:slug`, `/book/:token`, `/expert-marketplace`, `/distribution`, `/post-interceptor`, `/lead-crm`, `/outreach-engine`
- **~10 Edge Functions:** `adaptive-screening-chat`, `screen-candidate`, `generate-screening-questions`, `generate-screening-invite`, `screening-notifications`, `parse-resume`, `getResumeAnalysis`, `saveResumeAnalysis`, `send-interview-invite`, `job-feed`
- **All backing tables empty.**

Also legacy: `/departments` and `/rooms/:dept` redirect away, leaving `DepartmentRoom.tsx` — one of only two callers of `orchestrate` — possibly unreachable (**NOT verified**). Root-level Python/JSON workflow artifacts and two nested project trees.

---

## TEST QUALITY

**555 test files** — 521 edge-function, 27 frontend, 6 infra, 67 colocated. The edge-function suite is strong: 6,873 tests passing, and this week's work added revert-tested regression coverage for the evidence path.

**The systemic weakness is fixture realism.** Three instances are now confirmed:

1. `contentBuckets.test.ts` — fixtures use `type: "content_draft"`, which has never existed in production.
2. `webEvidenceReevaluation.test.ts:275` — supplies a registry containing web pages; the engine's first-pass registry never contains any, so the guard under test never fired in production.
3. `evidenceIsCitable.test.ts` — found and fixed earlier: the registry wrote `String(45)`, making employee count structurally uncitable.

The pattern: **unit tests assert a function's behaviour on an input shape the system does not produce.** The suite is large and green and still permitted a guard that never fired 37 times in one run. Coverage of the *seams between* modules is where the real defects have lived.

Frontend coverage (27 files for 801 source files) is thin, and there are **no RLS tests at all** — which is how P0-1 survived.

---

## LAUNCH READINESS GRADES

| Area | Grade | Justification |
|---|---|---|
| Chat / Brain | **C** | works; every message attributed to `pilot`; breadth unproven |
| Leads | **B** | genuinely well-engineered; provider-blocked; four fixes unproven in production |
| Evidence / P4 | **C** | four defects fixed and revert-tested this week, zero production proof |
| Monitoring | **C** | runs on cron, 29 events, last 4 Sep |
| **Content** | **F** | no backend, no data model, agent never executed once |
| Auth / security | **D** | RLS broadly correct, but one table leaks customer payloads to `anon` |
| Persistence | **C** | excellent on the lead side, absent on the content side |
| Reliability | **B** | leases, checkpoints, idempotency, cancellation, sweeper — all proven |
| Provider spend safety | **C** | Apify/Firecrawl well controlled; model spend uncapped; Firecrawl cost blind |
| **Overall launch readiness** | **D** | one working product surrounded by non-functional surface area, plus a live data leak |

---

## RECOMMENDED FIX ORDER — the 10 most important things, in order

1. **Close the `ops_stuck_run_archive` leak.** Enable RLS, revoke `anon`/`authenticated`. One statement. It is live customer data today. *(P0-1)*
2. **Add an infra test asserting RLS on every public table**, with an explicit allow-list. Prevents the next one. There are no RLS tests at all today.
3. **Cap and ledger model spend.** Bring OpenAI/Anthropic/Perplexity into the credit authorization path that already works for Apify and Firecrawl. Chat is currently unmetered. *(P0-3)*
4. **Restore Apify entitlement and run the full lead acceptance.** The lead engine is the product and four fixes remain unproven in production. Everything else is worth less until this passes.
5. **Fix or remove the `firecrawl-scrape` button**, and add the build-time check that every `functions.invoke` literal matches a deployed function. *(P1-1)*
6. **Decide what Content is.** It needs a content object, a generation endpoint, and a reachable agent — that is a build, not a repair. Until then, consider hiding the nav item rather than shipping a surface that cannot save work. *(CONTENT P0-1, P0-2)*
7. **Resolve the agent identity model.** Mira→`penn` vs Orion→`scribe`, avatar mismatch, and commands addressed to agents that have never executed. Users will be told an employee did work that no employee did. *(P1-2)*
8. **Capture Firecrawl cost.** One of two paid providers is unbillable and unbudgetable. *(P1-4)*
9. **Delete or archive the recruiting product.** 44 components, 15 routes, 10 Edge Functions, all empty. It is the largest source of "what does this app do" confusion and every route is an untested surface.
10. **Attack fixture realism in the test suite.** Add a lint or review rule that a fixture's shape must be observable in production data. Three confirmed toothless clusters so far; a 6,873-test suite that misses a guard which never fires is the real risk to launch confidence.

---

## WHAT WOULD HAPPEN IF YOU SHIPPED TODAY

- **Lead sourcing:** would work, once Apify access is restored. Real companies, real evidence, truthful terminal states, controlled spend. This is a good product.
- **Chat:** would work, and would cost you money with no ceiling.
- **Content:** a user would generate ideas, see them vanish on refresh, find every counter at zero, and have nothing saved. This is the area most likely to lose a customer in the first session.
- **Signals / Monitoring:** would show sparse data and one dead button.
- **Everything else in the nav:** would open, render, and do nothing.
- **Security:** anyone who loaded the marketing site could read archived task snapshots — including other workspaces' prospect data — using the anon key from the bundle.

The engineering quality where the product is real is high. The problem is not that the code is bad. It is that a small, well-built core is presented inside a shell that promises roughly five times more than it delivers.
