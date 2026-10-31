# Discovery architecture — intelligent multi-provider selection

Status (2026-10-31): implemented and tested offline. Behind the existing
switches (`LEAD_PIPELINE_ENABLED` + workspace allowlist, per-provider flags) —
all **off**. No live run, no deployment, no migration applied. Apollo is
**disabled** in code (`APOLLO_ACCESS_VALIDATED = false`).

LeadOcean → Apify → Agentory → ATLAS (`LEAD_PIPELINE.md`) is now **one** of the
strategies, not the only one.

```
user request
  └─► GPT mission compiler (leadMissionCompiler — unchanged, the only reader of the words)
        └─► specFromMission          roles · geography · size · industry · signals (+ windows, role terms)
              └─► planStrategy        every strategy judged against the capability registry,
                    │                 the workspace's flags / connections / permissions, and the budget
                    ├─► adviseStrategy (optional GPT) — may PICK among the feasible strategies only
                    └─► StrategyPlan  strategy · steps · worst case · limitations · planHash
                          └─► owner approval (names the hash, covers the worst case)
                                └─► runDiscoveryStrategy
                                      ├─ LeadOcean-led → runLeadPipeline (existing: ledger, checkpoint,
                                      │                  screening, Apify record, shared engine)
                                      └─ Apify-led     → job search → company record → (LeadOcean people
                                                         by domain) → cross-provider merge → shared engine
                                └─► ranking → queue / review / excluded → ATLAS projection (lead_candidates)
```

Code: `supabase/functions/_shared/leadPipeline/strategy.ts` (registry, spec, planner, advisor),
`apifyDiscovery.ts` (job-search discovery), `multiProvider.ts` (executor),
`strategyAdvisorModel.ts` (GPT structured output, enum-only), `service.ts`
(`strategy_plan` / `strategy_run`), edge function `lead-pipeline`.
Tests: `tests/edge-functions/_shared/leadPipeline/multiProvider.test.ts`.

## 1. Gap analysis (state found at `e8ce332`)

| Area | Before | Now |
|---|---|---|
| NL interpretation | GPT mission compiler existed, but the lead pipeline accepted only two fixed ICP ids | Pipeline accepts any request via the compiler (`strategy_plan`/`strategy_run`) |
| Structured spec | `DiscoveryRequirements` + criteria | + `DiscoverySpec`: signals with windows and role terms/families |
| Capability registry | `PROVIDERS` (filters/cost); Apify modelled only as web research | `DISCOVERY_CAPABILITIES`: what each route discovers, filters, **proves**, costs, and its status |
| Provider selection | `planDiscovery` "auto" existed but the pipeline hard-coded `["leadocean"]` | `planStrategy`: 5 strategies, explainable scores, refusals, limitations |
| Apify-only discovery | only in the separate Lead V2 engine | `apify_only` (job-first) in this pipeline |
| LeadOcean-only | yes (only option) | selectable; honest that nothing gets verified |
| Combined | LeadOcean → Apify verification only | + Apify discovers → LeadOcean people by domain → Apify verifies |
| Fallback / failure | per-step in `runDiscovery` | per-step outcomes; a later failure never rewrites earlier verdicts |
| Budget | per-pipeline ceilings | per-step worst case, plan-level ceiling, hash-bound approval; overflow stays pending |
| Authorization | plan hash (ICP walk) | same for strategies; refused before any call |
| Provenance | claims carry provider; signals carry actor | + each evidence source admitted only by its own identity; refused sources reported |
| Shared eligibility | `evaluateEligibility` via `verifyLeads` | unchanged — still the only qualifier |
| Apollo | adapter + flag | registry status `disabled_pending_validation`; planner and executor refuse it |

## 2. Capability registry

| Capability | Role | Status | Proves (to the shared engine) | Cost |
|---|---|---|---|---|
| `leadocean.people_search` | discover people | available | nothing (claims only) | 1 record/row |
| `leadocean.people_by_domain` | people at named companies | available | nothing | 1 record/row |
| `apify.linkedin_job_search` | discover companies **by a dated open role** | available | identity, hiring (dated by the posting) | $0.001/job + $0.001/start |
| `apify.linkedin_company_record` | verify a company | available | identity, HQ, size band | $0.004/company + $0.00005 |
| `apify.linkedin_post_search` | discover by post topic | **not_approved** (no actor on the allowlist) | — | — |
| `apify.funding_corroboration` | dated funding | **not_approved** (not wired; Contract 3 route) | — | — |
| `apollo.people_search` | discover people | **disabled_pending_validation** (403, 2026-10-30) | — | — |

Strategies: `leadocean_only`, `apify_only`, `leadocean_plus_apify`,
`apify_plus_leadocean`, `apollo_plus_apify` (disabled).

## 3. How a strategy is chosen

For every strategy, deterministically:

1. **Availability** — each capability `available`; each provider flagged on,
   connected, authorized for the workspace, with allowance left; not excluded by the user.
2. **Shape** — people requested ⇒ a people step exists; job-search discovery
   only for a hiring signal with a role to search (literal terms, else the
   family the user's own phrase names, via `classifyRoleFamily`).
3. **Proof** — which hard requirements some step can *prove*. A hard requirement
   no step can prove makes every bought lead permanently `pending`: refused
   unless the user sets `allowReviewOnly` (candidates for manual review). A
   defining signal a strategy neither discovers by nor proves is a limitation.
4. **Cost** — worst case per step; over the ceiling ⇒ refused; capped discovery ⇒ `budget_limited`.
5. **Score** — provable facts, discovering *by* the defining signal (+), discovering without it (−), cost (−), unverified claims (−).

Selection: the user's named strategy if feasible (otherwise **blocked with the
reason**, never switched) → else the model's pick if feasible (otherwise
recorded as rejected) → else the best deterministic score. The model sees only
the feasible list and answers with an enum (`STRATEGY_ADVICE_SCHEMA`); it cannot
name a provider, actor, price or budget.

## 4. The five example queries (real planner output; LeadOcean 50 records / Apify $0.50 ceilings)

| Query | Strategy | Steps (worst case) | Why / limitations |
|---|---|---|---|
| A. "Find 100 US SaaS founders with 10–100 employees." | `leadocean_plus_apify` | LeadOcean people ≤50 records; Apify records ≤50 ($0.20005) | Structured people search matches roles/geo/size; Apify proves HQ + size. Limitations: "SaaS" has no provable label (stays needs_verification on industry); capped at 50 of 100. A 51–200 band cannot settle 10–100. |
| B. "Find US companies currently hiring Account Executives." | `apify_only` | job search ≤100 ($0.101); records ≤50 ($0.20005) | Discovers **by** the dated hiring signal; record proves US HQ. LeadOcean refused: cannot prove hiring. |
| C. "Find founders at companies that recently hired salespeople." | `apify_plus_leadocean` | job search ≤100; records ≤50; LeadOcean people by domain ≤50 | Hiring defines the request; "salespeople" → `gtm_sales` family (postings post-filtered to it). LeadOcean-first alternative states it would ignore the signal. |
| D. "Find marketing agencies posting about AI automation." | `leadocean_plus_apify` | LeadOcean ≤50; records ≤50 | **Limitation:** post-topic discovery needs a post-search actor that is not approved; posts can only be read per company afterwards (ranking). |
| E. "Find founders of recently funded companies." | **blocked** | — | Recent funding cannot be proven in this pipeline (LeadOcean funding is an undated claim; corroboration not wired). With `allowReviewOnly`: `leadocean_plus_apify`, every lead pending on funding. Funding-gated missions belong on the Apify engine's verified funding route (Contract 3). |

## 5. Guarantees (tests pin each)

- No provider call or ledger reservation before an approval that names the plan hash and covers its worst case.
- Approval ceilings are the server's estimate; a larger approval never raises spend.
- Every Apify run is reserved in the durable ledger first (`ledgeredInvoker`): replay on re-run, uncertain charges never re-bought, no retries; actor allowlist unchanged.
- Discovery is not qualification: LeadOcean HQ/size/funding and job-row size/HQ are never proof; `evaluateEligibility` decides.
- Evidence is admitted per source by its own identity (`evidenceIdentity`); a record naming another company's website lends no facts and is reported in `evidenceRefused`.
- Budget overflow leaves companies `pending` (`skipped_budget`) in review — never dropped, never eligible.
- A later provider failure leaves earlier verdicts and settled purchases intact (`partial`).
- Cross-provider duplicates merge (`mergeRecords`, domain / LinkedIn); existing Leads keep their ids; holds block outreach.
- No phone enrichment: the executor accepts no lookup dependency; `enrichment: not_requested`, `contactValues: []`.
- Apollo is never planned or executed while `APOLLO_ACCESS_VALIDATED` is false.

## 6. Enabling Apollo later

1. A free, approved access check showing People API Search answers 200 on the plan.
2. Flip `APOLLO_ACCESS_VALIDATED` (reviewed change) — `apollo.people_search` becomes `available`.
3. `apollo_plus_apify` then competes on score; its executor branch (Apollo people search via the existing `apolloAdapter` + Apify records) is the remaining work. Until then `checkStrategyApproval` refuses it.

## 7. Known limitations

- `strategy_run` re-interprets the request; if GPT reads it differently the hash changes and the run is refused (fail closed). Persisting the interpreted mission with the plan would remove that re-read — needs storage (a migration), not done.
- Job-search discovery has no checkpoint/`excludeIds` walk; repeat walks rely on Agentory's history (existing Leads) for dedupe.
- Apify-led leads carry no Apify signal objects for ranking yet (hiring is in qualification evidence); ranking uses role, relevance and industry.
- Post-topic discovery and funding corroboration need actors/routes added to the allowlist after pricing review.

## 8. Smallest live validation (proposed — NOT approved)

`scripts/lead-pipeline-strategy-canary.ts` (dry run by default; recorded interpretation, so the hash is reproducible):

| stage | strategy | calls | worst case |
|---|---|---|---|
| s1 | `apify_only` | job search ≤4 postings, company records ≤2 | **$0.01305 Apify, 0 LeadOcean records** |
| s2 | `apify_plus_leadocean` | s1 + LeadOcean `POST /v1/search` by domain ≤2 | **$0.01305 Apify + 2 LeadOcean records** |

Execution requires `AGENTORY_PROVIDER_LIVE_TESTS=enabled`, the exact approval
string the dry run prints (stage, strategy, plan hash, commit, caps), proxy-injected
keys, free preflights, and writes a one-shot lock. Nothing is written to a
database; no phone lookup is reachable.
