# Lead V2 — Backend Dependency Map

**Status:** discovery only. Nothing changed. Source of truth: code at `7ed1c7b3`→`125f0cfa` (branch `feat/lead-mission-v2-worker`), the production OpenAPI schema for project `ohsdatpvfdjdemstoiuj`, `deno info` import graphs for every edge function, and runs `4250f181` / `1e52d43c`.

Companion documents: `LEAD_V2_FINAL_ARCHITECTURE_REVIEW.md` (decisions), `LEAD_V2_CURRENT_VS_TARGET_GAP_MATRIX.md` (module-by-module).

---

## 1. Entry points and the production request path

```
Frontend (Pilot overlay / dashboard goal box)
  → pilot-chat            understands the request, compiles the LeadMission, shows the confirmation card
  → [user presses Start Workflow]
  → orchestrate           builds task_plans row + capability graph; decides V1 vs V2
       ├─ V2  → enqueue-lead-mission → lead_mission_queue
       │         → Railway worker (claim_next_lead_mission) → run-agent handleRunAgent IN-PROCESS
       └─ V1  → run-agent over HTTP (edge)
  → run-agent             one of three lead execution routes (see §3)
  → Workbench             reads tasks.result + lead_candidates / lead_results
```

**V1/V2 decision** — `orchestrate/index.ts:~1685`:
`resolveLeadExecutionEngine(workspace_id) === "v2_worker" && validateV2KickoffBody(body).ok` → enqueue; else direct `run-agent`.
`resolveLeadExecutionEngine` (`_shared/leadExecutionEngine.ts:57`) returns `v2_worker` iff the workspace is in `LEAD_V2_WORKER_WORKSPACES` (currently 1 workspace, `e8af257d`).

---

## 2. Edge functions × lead-core modules

`deno info` over every function. "Lead-core" = 22 modules at the heart of lead retrieval (engine, ledger, toolRegistry, credits, spend ceiling, GPT provider, mission, RequestV1, catalog, cost model, Workbench projection, Brain fit, resume state, multi-round, route executor, both GPT planners, two registries, mission evaluation, web evidence runner, V2 request).

| Function | Shared modules loaded | Lead-core modules | Why it matters |
|---|---|---|---|
| **run-agent** | **303** | **22 / 22** | the lead runtime, V1 and V2 |
| **pilot-chat** | 183 | 13 | loads **the capability engine** and mission evaluation for the preview |
| **run-monitoring-scan** | 173 | 16 | **Signals monitoring runs `runCapabilityPlan` + `makeGptDiscoveryPlanner` through the same seam** |
| orchestrate | 162 | 12 | graph, catalog, ledger, spend ceiling, Brain fit, V2 request |
| unlock-founders | 93 | 10 | person stage; credits reserve/finalize RPCs |
| run-lead-action | 95 | 7 | toolRegistry, ledger, credits |
| daily-brief | 66 | 7 | toolRegistry, ledger, spend ceiling |
| setup-company-brain | 66 | 7 | toolRegistry, ledger, spend ceiling |
| resume-stalled-leads | 31 | 6 | resume state, V2 ownership check |
| enqueue-lead-mission | 21 | 4 | mission, catalog, V2 request |
| generate-company-brain-draft | 20 | 2 | ledger + spend ceiling |
| generate-content-image | 5 | 2 | ledger + spend ceiling (Content) |
| continue-workflow | 6 | 1 | resume state |
| run-radar-scan | 45 | 1 | credit authorization |

**Worker** (`worker/main.ts`, `worker/leadMissionRunner.ts`) imports run-agent's handler directly (`RUN_AGENT_IMPORT_ONLY`), so it carries the full 303-module graph.

---

## 3. run-agent — the three live lead routes

| Route | Owner tag (`leadOwnership.claimExecution`) | Where | When |
|---|---|---|---|
| **Capability engine** (`runCapabilityPlan`) | mission graph | `run-agent/index.ts:~2955` | a `LeadMissionV1` with a capability graph — **the V2 path** |
| ↳ wrapped by **multi-round sourcing** (`runMultiRoundSourcing`) | — | `:~3965` | when `multiRoundBinding.enabled`; round 1 = engine run, later rounds re-run the engine with a round plan |
| **Company-first route executor** (`executeCompanyFirstRoute`) | `company_first_v1` | `:~5028` | "no mission graph owns this task" |
| **Company-first quota loop** (`executeRunAgentCompanyFirstSourcing`) | `company_first_v1` | `:~5451` | legacy job-first sourcing loop |

All three reach providers through `buildInvoker({ runTool })` → `toolRegistry.runTool("source_with_apify", …)` (`:1753`).

**Planner stacks loaded by run-agent (all live):**

| Stack | Files | Role in V2 today |
|---|---|---|
| GPT execution planner + amendment | `gptExecutionPlanner.ts`, `leadExecutionPlan.ts` | the plan; amendment rewrites it after each discovery pass |
| GPT discovery planner | `gptDiscoveryPlanner.ts`, `leadDiscoveryStrategy.ts` | replans only (`discovery_replan_*`) |
| Lead strategy (broadening) | `leadStrategy/*` (`strategist.ts`, adapters `openai.ts`, `lovableAi.ts`), `leadStrategyOwner.ts` | round-to-round title broadening, gated by `GPT_LEAD_STRATEGY` |
| Intelligence/leads planning | `intelligence/leads/leadPlanner.ts`, `leadPlanningBridge.ts`, `leadPlanAuthority.ts`, `leadQueryPacks.ts`, `leadAdaptiveRuntime.ts`, … | "planner-owner" resolution (`persisted_plan_artifact_v1` vs `deterministic_registry_v1`), adaptive strategy binding |
| Deterministic ladders | `commercialSignalPolicy.BROADENING_ROUNDS`, `leadResearchPlaybooks.ts`, `hiringSourcePlan.ts`, `compoundSourcingPipeline.ts`, `sequentialSourceRuntime.ts` | V1 routes and fallbacks |

---

## 4. Database tables, RPCs, queues and schedules

### Tables touched per entry point (direct `.from()` in the entry file; shared helpers add more)

| Entry | Tables | RPCs |
|---|---|---|
| pilot-chat | `company_brain`, `conversations`, `messages`, `tasks`, `workspace_members` | — |
| orchestrate | `activity_feed`, `company_brain`, `task_plans`, `workspace_members` | — |
| enqueue-lead-mission | `lead_mission_queue` | — |
| worker | `lead_lineages`, `task_plans`, `tasks` | `claim_next_lead_mission`, `bind_lead_mission_execution`, `heartbeat_lead_mission`, `release_lead_mission` |
| run-agent | `activity_feed`, `agents`, `approvals`, `company_brain`, `company_headcount_snapshots`, `content_item`, `handoffs`, `lead_candidates`, `messages`, `signals`, `task_plans`, `tasks`, `tool_calls`, `workspace_members` (+ via helpers: `lead_execution_calls`, `lead_lineages`, `company_web_evidence`, `credit_transactions`) | via helpers: `claim_sourcing_continuation`, `credits_reserve`, `credits_finalize` |
| continue-workflow | `conversations`, `messages`, `task_plans`, `tasks`, `tool_calls`, `workspace_members` | — |
| resume-stalled-leads | `messages`, `tasks` | `claim_sourcing_continuation` (via helper) |
| run-lead-action | `agents`, `lead_candidates`, `tasks`, `workspace_members` | — |
| unlock-founders | `task_plans`, `tasks`, `workspace_members` | `credits_reserve`, `credits_finalize` |

### Lead-relevant tables in production

| Table | Cols | Written by | Role |
|---|---|---|---|
| `lead_mission_queue` | 13 | enqueue, worker RPCs | V2 queue (`attempts ≤ 5`, `not_before` +2 min on resumable) |
| `lead_lineages` | 13 | run-agent lease, worker reconcile | lineage lease + `current_state` (accumulated checkpoint) |
| `tasks` | — | run-agent, worker, sweepers | **the mission state blob** (`result.capability_execution_state`, checkpoint, Workbench projections) |
| `task_plans` | — | orchestrate, worker, approve-and-continue | Pilot's plan (not the execution plan) |
| `lead_execution_calls` | 37 | ledger writer | provider/model/stage rows; `lead_model_calls` is a **view** over `record_kind = model_call` |
| `credit_transactions` | — | credits RPCs | credit reserve/charge |
| `lead_candidates` | 17 | run-agent, run-lead-action, `qualifiedLeadPersistence`, `leadActionExecutor`, `memoryWriter`, `mcp` | **6 writers** |
| `lead_results` | 15 | legacy | read by the frontend |
| `lead_evidence` | 22 | **Signals V2 writers only** (`signalsV2Writer`, `signalsV2DualWrite`) | typed evidence items — **not written by the lead path** |
| `signal_events` | 30 | Signals V2 | typed events with freshness/expiry |
| `company_web_evidence` | 14 | `webEvidenceStore` | Firecrawl page cache with TTL per intent |
| `company_headcount_snapshots` | 13 | `headcountSnapshotStore` | headcount time series |
| `company_brain` | — | Brain setup | ICP/policy source |

### Scheduled jobs (pg_cron migrations)

| Job | Schedule | Target | Lead relevance |
|---|---|---|---|
| `tasks_sweep_stuck_runs` | `*/5 * * * *` | SQL function over `tasks` | can mark lead tasks stuck — must respect V2 ownership |
| resume-stalled-leads | `*/3 * * * *` (+ a `*/10` job) | edge function | V1 continuation sweeper; excludes V2-owned tasks (`loadV2OwnedTaskIds`) |
| monitoring tick | `*/15 * * * *` | `run-monitoring-tick` → `run-monitoring-scan` | Signals; **runs the lead engine** |

---

## 5. Providers and models — exact call sites

| Provider | HTTP call sites | Lead path usage |
|---|---|---|
| **Apify** | `_shared/toolRegistry.ts`, `_shared/radarIntel/radarProviderAdapters.ts`, `generate-company-brain-draft/index.ts` | all lead actor calls go through `toolRegistry.runTool` |
| **Firecrawl** | `_shared/toolRegistry.ts`, `run-radar-scan/index.ts`, `generate-company-brain-draft/index.ts` | web evidence (`web_evidence_verification`); **priced by `firecrawlCostModel.ts` only on the toolRegistry path** |
| **OpenAI** | `_shared/gptProvider.ts`, `_shared/imageProvider.ts`, `_shared/leadStrategy/adapters/openai.ts` | every GPT stage (execution plan, amendment, discovery, triage, pool/mission evaluation, evidence planning/extraction) via `gptStructured` |
| **Anthropic** | `_shared/aiProvider.ts` (+ pricing in `modelCostModel.ts`) | not on the V2 lead path in the audited runs |
| **Lovable AI gateway / Gemini** | `pilot-chat`, `daily-brief`, `generate-company-brain-draft`, `aiProvider.ts`, `leadStrategy/provider.ts`, `leadStrategyFeedbackOwner.ts`, `sourceFeedbackRuntime.ts` | Pilot's chat brain (`understandRequest`) and the strategist's `lovableAi` adapter |
| Funding source | `apify_funding_rounds_datahyena` card exists (`power: discovery`) | not scheduled for company-first missions |

### Model roles observed in run `1e52d43c` (43 calls, $0.092 est.)
`mission_evaluation` 17 · `pool_evaluation` 8 · `execution_plan_amendment` 5 · `mission_triage` 4 · `evidence_planning` 3 · `discovery_actor_selection` 2 · `evidence_extraction` 2 · `execution_plan` 1 · `grounded_evidence_evaluation` 1. All `gpt-5.6-luna` except repairs (`gpt-5.6-terra`).

---

## 6. Actor catalog usable by Leads (`hiringActorCatalog.ts`)

| Key | Actor | Purpose | Power | Proves | Cannot prove / known limits |
|---|---|---|---|---|---|
| `apify_yc_companies_memo23` | memo23/y-combinator-scraper | company discovery, hiring verification | discover + prove(open roles) | YC cohort, `isHiring`, `openJobs`, region | **funding stage**, exact size (`teamSize` stale), LinkedIn URL; no pagination cursor |
| `apify_yc_companies_solidcode` | solidcode/ycombinator-scraper | company discovery | discover | YC cohort | multi-band size; not primary |
| `apify_linkedin_company_search` | harvestapi/linkedin-company-search | identity (and discovery by structured filters) | prove identity (full mode, domain match) | LinkedIn URL + website | ICP, concept search, industry, size; short mode has no `website` |
| `apify_linkedin_company_details` | harvestapi/linkedin-company | enrichment | prove | headcount, industry, website, locations | `foundedOn` often null; not discovery |
| `apify_linkedin_job_search` | harvestapi/linkedin-job-search | hiring verification | prove open role | job postings | posting company ≠ employer; inexact role matching |
| `apify_funding_rounds_datahyena` | datahyena/company-funding-rounds | funding discovery | discover | funding rounds by stage/region | **cannot verify a specific company's funding** |
| `apify_linkedin_company_posts` | harvestapi/linkedin-company-posts | social verification | corroborate | company activity | cannot search |
| `apify_linkedin_profile_posts` | harvestapi/linkedin-profile-posts | social verification | corroborate | person activity | cannot search |
| `apify_linkedin_post_search` | harvestapi/linkedin-post-search | social discovery | discover | posts by topic | not company-specific proof |
| `apify_google_news` | data_xplorer/google-news-scraper-fast | news signal | corroborate | articles | returns articles, not structured events |
| `apify_builtwith_technology` | builtwith/…-technology-scraper | technology verification | prove tech stack | technologies | cannot find companies |
| `apify_linkedin_company_employees` | harvestapi/linkedin-company-employees | founder / **team composition** | prove (people stage) | employees + titles | 2/10 off-target titles; unlock-gated |
| `apify_linkedin_profile_enrichment` | harvestapi/linkedin-profile-scraper | contact enrichment | prove | profile detail | cannot search |
| `apify_people_search` | harvestapi/linkedin-profile-search | founder discovery | discover | people | no per-company caps |
| (Firecrawl) `firecrawl_scrape_url` | Firecrawl | web evidence | corroborate/prove from source | page text | TTL-cached in `company_web_evidence` |

---

## 7. Cost and credit systems — every calculation/write site

| Concern | Owner(s) today |
|---|---|
| Apify pricing | `providerCostModel.ts` (`priceProviderCall`, `apifyEventPrices`), plus arithmetic in `toolRegistry.ts` |
| Firecrawl pricing | `firecrawlCostModel.ts` — imported **only** by `toolRegistry.ts` |
| Model pricing | `modelCostModel.ts` (`priceModelCall`, `buildModelTelemetry`) |
| Credit pricing/authorization | `creditPricing.ts`, `creditAuthorization.ts` (RPCs `credits_reserve`/`credits_finalize`) |
| Ledger writes | `executionLedger.ts` (`recordModelCall`, `createLedgerWriter`, `ModelCallCollector`, `PendingModelDrain`) |
| Other cost arithmetic | `sequentialSourceRuntime.ts`, `intelligence/leads/leadMission.ts`, `intelligence/leads/leadPlanner.ts`, `intelligence/mission.ts`, `intelligence/plannerDiagnostics.ts`, `intelligence/strategyValidation.ts`, `radarIntel/radarDiagnostics.ts`, `signalRelevanceJudge.ts`, `unlock-founders/index.ts`, `run-monitoring-scan/index.ts` |
| Spend ceiling | `modelSpendCeiling.ts` (`authorizeModelSpend`, sums the `lead_model_calls` view; `MODEL_SPEND_CEILING_USD` $5 Railway / $10 edge) |
| Failed-run model drain | `PendingModelDrain` in run-agent (`125f0cfa`) |
| Unknown cost | `cost_source: "unknown"` + `actual_cost_usd: null` (Firecrawl evidence path) |

**Observed accuracy:** run `1e52d43c` — Apify billed $0.5902, ledger $0.2463; 12 Firecrawl rows unpriced; 43 model rows estimated only.

---

## 8. Company Brain — influence points

| Stage | Mechanism | File | Effect |
|---|---|---|---|
| Mission compile | `mergeCompanyBrainIntoMission(compiled, brain)` | `leadMission.ts:1229`, called from `pilot-chat/index.ts:354` | merges ICP into the mission (mission words outrank Brain) |
| Policy | `compileEffectiveCompanyPolicy` | `companyBrainEffectivePolicy.ts:93`, `run-agent/index.ts:~2080` | size bounds (1–150 in `e8af257d`), `hard_constraints: [employee_count, industry, business_model]`, `enforced` |
| Context | `compileCompanyBrainContext` | `companyBrainCompiler.ts:173`, `run-agent/index.ts:~2045` | ICP industries, disqualifiers, business models |
| Industry precedence | `[industry-precedence] generic exclusions suppressed` | run-agent | mission vocabulary suppresses conflicting Brain exclusions (e.g. "staffing") |
| Planners | `brain` passed to execution & discovery planners | `run-agent:3016, 3035`; `buildExecutionPlannerPayload(…, { brain })` | ICP shown to GPT as context |
| Discovery | `resolveEmployeeBounds(ctx, opts.brain)` → size clamp; `icpDiscoveryConstraints(mission, brain)` | engine `:2923, 4498, 4636` | **advisory Brain bound became a discovery filter** (`maxEmployeeSize "250"`) |
| Qualification | `companyBrainSemanticFit.ts`, `missionEvaluation.ts`, grounded brain (`mode: shadow`) | engine, run-agent | Brain fit + evaluator context; `brainMayReject` per axis |

Workspace `e8af257d`'s Brain targets **"Recruiting / Talent Acquisition / Staffing Agencies"** — a different business from the audited missions. This is the clearest example of why Brain behaviour must be classified explicitly (hard / preference / signal) rather than applied as hidden filters.

---

## 9. Signals infrastructure (reusable for opportunity signals)

Modules: `signalEvent.ts`, `signalFreshness.ts`, `signalQuality.ts`, `signalQualification.ts`, `signalRelevance*.ts`, `signalCluster.ts`, `signalsToLeads.ts` (not loaded by run-agent), `signalsV2Writer.ts` / `signalsV2DualWrite.ts`, `headcountGrowth.ts`, `headcountSnapshotStore.ts`, `monitoring*.ts`, `radar*.ts`, `radarIntel/*` (competitor, LinkedIn, market intelligence, provider adapters).

Tables: `signals`, `signal_events` (typed, with `freshness`, `expires_at`, `confidence`, `subject_key`), `monitoring_subjects`, `monitoring_runs`, `monitoring_budgets`, `signal_feed`, `signal_cluster_relevance`, `company_headcount_snapshots`.

Reusable as-is for opportunity signals: **headcount growth** (`headcountGrowth.ts` + snapshots), **hiring signals** (Signals V2 dual-write of hiring), **news** (`apify_google_news`), **funding discovery** (datahyena), and the **`signal_events` schema** as the model for time-bounded evidence.

---

## 10. Workbench / frontend contract

Result keys read by `src/` (occurrences): `company_first` 20 · `qualified_lead_run` 7 · `workbench_progress` 4 · `workbench_research` 2 · `workbench_evaluation_rows` 2 · `terminal_status` 2 · `workbench_portfolio` 1 · `qualified_lead_run_context` 1 · `company_first_state` 1 · plus `continuation_owner`, `lead_quota_provenance` (added `4bee6cd1`).
Tables read: `tasks`, `task_plans`, `lead_candidates`, `lead_results`, `company_brain`.
Main components: `LeadResultsView.tsx`, `RunSummaryHero.tsx`, `src/lib/workbench/{leadTabs,evaluationRows,runSummary,portfolioView,workbenchProgress}.ts`, `src/lib/qualifiedLead/{continuation,taskCompanyFirst,diagnostics}.ts`.

---

## 11. Hidden coupling register

| A | B | Shared | Risk if Lead V2 changes | Isolation |
|---|---|---|---|---|
| Lead V2 engine | **Signals monitoring** (`run-monitoring-scan`) | `runCapabilityPlan`, `makeGptDiscoveryPlanner`, `buildCapabilityGraph`, `toolRegistry` | refactoring the engine silently changes monitoring behaviour and spend | give monitoring its own facade; freeze its seam behind a contract test before refactoring |
| Lead V2 | Pilot preview (`pilot-chat`) | capability engine, mission evaluation, RequestV1 | preview drifts from execution or breaks | preview must call the *same* feasibility/plan functions as execution, via one module |
| Lead V2 | orchestrate | graph, catalog, V2 request validation | kickoff body contract changes break routing | versioned kickoff contract |
| Lead paths | daily-brief, setup-company-brain, run-lead-action, unlock-founders | `toolRegistry.runTool` (provider transport + pricing) | changing provider execution breaks four other features | keep `runTool` as the transport; move lead-specific policy out of it |
| All GPT features | Content, Brain draft, daily-brief | `executionLedger` + `modelSpendCeiling` | the $5/day ceiling is **workspace-wide**: lead spend starves content and vice versa | per-feature sub-budgets inside one ceiling |
| Leads | Signals radar | `creditAuthorization` | credit semantics shared | keep API stable |
| V2 worker | `tasks_sweep_stuck_runs` cron | `tasks` rows | the sweeper can fail a task the V2 worker still owns | sweeper must skip V2-owned tasks (as resume-stalled-leads already does) |
| V2 worker | resume-stalled-leads / continue-workflow | `tasks`, `claim_sourcing_continuation` | double execution | already excluded via `loadV2OwnedTaskIds`; keep the test |
| Leads | Signals V2 | `lead_evidence`, `signal_events` schema | adopting `lead_evidence` for lead evidence mixes writers | add `mission_id`/`origin`; never reuse rows across origins |
| Leads | `lead_candidates` 6 writers | table | inconsistent candidate rows | one writer for mission output |
| Worker | run-agent module graph | 303 modules imported in-process | any shared-module change redeploys the worker | shrink the lead runtime's import surface |
