# Signals / Scout Radar — ICP live-workflow audit

Branch: `signals-icp-live-workflow` · base `remix/main` @ `85a30e4a` · workspace-isolated, no deploy.

This document traces the **actual** implementation on `remix/main` (not the intended
design), states what is already correct, and records the specific wiring gaps that
this branch fixes. Providers (Apify / Firecrawl / Anthropic) were **not** run during
this audit — everything below was read from source and proven with deterministic tests.

---

## 1. Current flow (traced, file:line)

```
Signals.tsx  (route /signals, src/App.tsx:142)
  └─ useSignalFeed.runRadarScan()            src/hooks/useSignalFeed.ts:55
       body: { workspace_id, mode, category, confirmed, limit }   ← workspace_id is client-supplied
  └─ supabase.functions.invoke("run-radar-scan")

run-radar-scan/index.ts
  1. Auth        getUser(JWT)                              index.ts:120  → 401 if invalid
  2. Membership  admin.workspace_members(ws, user)         index.ts:142  → 403 if not a member
  3. Brain load  admin.company_brain.select(profile)       index.ts:148  (single JSONB row)
  4. Prefs       readPrefs(profile)                        index.ts:33   ← LEGACY signal_preferences/icp.*
  5. Compile     compileCompanyBrainContext(profile)       index.ts:159  ← v2-normalized (correct)
  6. Plan        buildRadarScanPlan(brain, caps)           index.ts:160  ← Brain-derived queries (built…
                                                                            …but only .reason is used)
  7a. Hiring     buildApifyJobsInput(brain) → fetchApifyJobs index.ts:239 (Apify path uses compiled brain)
  7b. Fan-out    firecrawlSearch(intentQueries(prefs)…)    index.ts:264  ← LEGACY generic query builders
  8. Score       scoreCandidates → scoreAgainstCompanyBrain radarCandidatePipeline.ts / icpSignalScorer.ts
  9. Persist     admin.signals.insert(accepted)            index.ts:299
  10. Response   { inserted, per_category, capabilities, brain_confidence, setup_required, warnings }

fetchSignals(ws) → signalFeedModel → SignalCard / SignalFeed / RadarSummaryCards
```

## 2. Is the ACTIVE Company Brain used?

**Data model.** There is one `company_brain` row per workspace; the Brain lives in
`profile` (JSONB) with a v2 shape (`schema_version: 2`, `target_customer`, `buyer_personas`,
`qualification_rules`, …) plus a legacy `icp.*` compatibility projection. There is **no
separate "active" table** — `is_draft` / `setup_status` inside the profile distinguish an
onboarding draft from an activated Brain (`companyBrainV2Save.ts`).

- **Compiled brain (scoring/plan):** `compileCompanyBrainContext` calls
  `normalizeCompanyBrain` internally (`companyBrainCompiler.ts:173`) and prefers v2 over
  legacy. So the **scorer and scan planner do consume the v2 brain** — good.
- **Firecrawl query generation:** driven by `readPrefs(profile)` (legacy
  `signal_preferences` / `icp.*`) with **hard-coded generic fallbacks**
  (`["AI SDR","lead generation","outbound automation"]`, `["Founder's Associate","SDR","GTM"]`,
  `["Claude Code workflow", …]`). This path does **not** use the compiled brain or the
  scan plan. **Split brain.**
- **`getCompiledCompanyBrainForWorkspace.ts`** (the intended single access layer) reads the
  same `company_brain.profile` and adds normalize→compile→canonical + membership gate, but
  has **zero call sites** in radar. Radar reimplements load+membership+compile inline.

**Verdict:** scoring uses the active compiled v2 brain; **query generation uses a legacy,
partly generic projection** and the Brain-derived scan plan is computed then largely ignored.

## 3. Verification / signal-quality contract (already implemented — `icpSignalScorer.ts`)

Strong and correct; kept as-is:

| Requirement | Enforced at |
| --- | --- |
| Disqualifier → reject | L136 `if (disqHits.length) return rejected(...)` |
| Funding needs a source URL | L137 |
| LinkedIn post/comment needs URL | L138–139 |
| No company identity AND no proof → reject | L140 |
| Generic ops title w/o ICP context → reject | L142 |
| **Buyer title alone never verifies** | L209–219 `hasRealIcpFit = icpHits ∨ inBand` |
| Source URL + evidence required for `verified` | L211 |
| Funding verified needs amount/round/investors | L221 |
| setup_required → never `verified` | L226–229 |
| weak brain → never `verified` | L230 |
| Missing proof/domain caps score, adds `missing_evidence` | L196–202 |

Each row carries the full contract in `signals.raw` (`radarCandidatePipeline.ts:143`):
`signal_score, verification_status, confidence, priority, icp_fit_score, proof_score,
trigger_score, freshness_score, matched_icp/triggers/buyer_personas, disqualifiers_hit,
why_it_matters, why_now, missing_evidence, risk_flags, recommended_action, scan_plan_reason`.

## 4. Source adapters

| Source | File | Input | Brain fields used | Cap | Evidence contract |
| --- | --- | --- | --- | --- | --- |
| Apify LinkedIn Jobs (hiring) | `radarSources/apifyJobsHiringSource.ts` | `buildApifyJobsInput(brain)` | roles, industries, geo, negatives | 10 | job_url + company domain |
| Firecrawl search (hiring fallback, intent, competitor, workflow) | inline in `index.ts` | `readPrefs(profile)` **legacy** | signal_preferences/icp.* + **generic fallbacks** | mix | source_url |

Planner (`radarScanPlanner.ts`) already produces Brain-derived `queries`, `negative_terms`,
`cap`, `required_proof` per source — but execution ignores `queries`/`negative_terms`.

## 5. Gaps found (this branch's target)

- **G1 — Plan not driving execution.** `buildRadarScanPlan` output (queries, negatives,
  caps) is computed but only `.reason` is used; Firecrawl runs legacy `*Queries(prefs)`.
- **G2 — Generic-search leak.** Legacy fallbacks run generic queries even when the Brain is
  unusable, violating "no broad generic search when the brain is unusable."
- **G3 — `setup_required` not enforced at execution.** Even when the plan says
  `setup_required`, the Firecrawl fan-out still fires generic queries (the response reports
  `setup_required`, but provider calls still happen). Should short-circuit honestly.
- **G4 — No staged plan.** Single query tier; no Stage 1 exact → 2 synonym → 3 adjacent while
  always preserving geography / disqualifiers / evidence / identity requirements.
- **G5 — Draft not gated.** `normalizeCompanyBrain` computes `setup_required` from *content
  completeness only* (`normalizeCompanyBrain.ts:187`); it ignores `is_draft`. A complete-looking
  **unactivated** draft therefore drives verified Top Signals before activation.
- **G6 — Negatives not applied to Firecrawl queries.** Legacy builders don't exclude
  disqualifiers/geography from the query text.
- **G7 (note, not changed here).** `EditRadarDrawer.tsx:74` writes `signal_preferences`
  directly to `company_brain` from the client (user JWT, RLS-scoped — not service_role, so
  not a violation, but relies on `company_brain` RLS for isolation).

## 6. Fixes made on this branch

_(updated as implemented — see the final report for the authoritative list.)_

- **F-G5** `companyBrainCompiler.ts`: `meta.setup_required` now also true when the Brain is an
  unactivated draft (`is_draft === true`). Flows into the scan planner (degraded, low-cap) and
  the scorer (never `verified`). Reconciles "draft does not override active brain" with "saved
  edits to an *active* brain affect the next scan" (pref edits keep `is_draft=false`).
- **F-G1/G2/G3/G6** New pure module `radarSourceExecution.ts`: builds Firecrawl queries from the
  compiled **scan plan** (Brain seeds + roles + watchlist + workflow/linkedin terms), appends
  `negative_terms` as `-"term"` exclusions, honors per-source caps, and **short-circuits to
  zero provider calls when `setup_required`**. `run-radar-scan` now calls it instead of the
  legacy generic `*Queries(prefs)` builders. Provider fetch is injected (deterministic tests).
- **F-G4** `radarScanPlanner.ts`: each source exposes `staged_queries` (Stage 1 exact ICP+signal,
  Stage 2 synonym expansion, Stage 3 adjacent) that always carry `negative_terms` and never drop
  explicit geography / evidence / company-identity requirements.

## 7. Workspace isolation

- **Membership gate:** `run-radar-scan` uses the service-role admin client only *after* a
  `workspace_members` check on the JWT user (`index.ts:142`). Frontend-supplied `workspace_id`
  cannot reach another workspace's Brain or signals (403 otherwise). Proven by test.
- **Query/score divergence:** two workspaces with different Brains produce different scan plans
  and different scores; a workspace-A disqualifier (staffing) does not leak into workspace B
  (recruitment agency, which allows staffing). Proven by test — see §9.
- **Reads:** `fetchSignals(workspace_id)` is workspace-scoped; the insert path stamps
  `workspace_id` on every row.

## 8. Frontend field mapping

`signals.raw.*` → `signalFeedModel`/`signalPresenter` → `SignalCard` / `SignalDetailDrawer` /
`RadarSummaryCards`. `evidenceState()` keeps the UI honest (Verified / Needs review / No proof
from `verification_status` + real `source_url`). Summary buckets (new / contact / watch /
needs-review / skipped) derive from `recommended_action` + `verification_status`.

## 9. Tests (deterministic, no provider calls)

`radarSourceExecution.test.ts`, `radarScanPlanner.test.ts`, `companyBrainCompiler.test.ts`,
`icpSignalScorer.test.ts`, plus `signalsWorkspaceIsolation.test.ts` covering the 14 required
scenarios and the A-vs-B recruitment/SaaS divergence.

## 10. Remaining risks / recommended controlled live QA

- `company_brain` **RLS** correctness (G7) is assumed, not proven here (needs DB/PROD access).
- Firecrawl/Apify output shape drift — normalizers are defensive but only fixture-tested.
- **Capped live QA (user-run, provider budget applies):** one scan per test workspace with
  `limit ≤ 5`; verify (a) A vs B return different companies, (b) no staffing result for A,
  (c) an incomplete Brain returns `setup_required` with **zero** provider spend, (d) every
  `verified` row has a real `source_url`. Redeploy `run-radar-scan` to PROD first.
