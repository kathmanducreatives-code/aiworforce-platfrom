# Q1 v86 structured hiring-signal audit (one controlled TEST run)

**Verdict: PASS — STRUCTURED HIRING SIGNAL PATH VERIFIED.** The live path (people →
company enrichment → bounded jobs-signal enrichment → TimingAssessment → existing
final-state reducer) ran end-to-end with the 3 allowed actors, no 504, terminal
state, reconciling observability, and full safety. All 5 candidates reached
`timing_sufficient`, yet timing did NOT force qualify_now — the existing
qualification authority staged all 5, so 0 persisted. The positive persistence /
Aria path was therefore NOT exercised this run.

## Release
| Item | Value |
|---|---|
| PR #52 merge commit | `dbc7404c` |
| Merged main SHA | `dbc7404c` (contains 38a51094) |
| run-agent | v85 → **v86** (ACTIVE) |
| orchestrate | v31 (unchanged); all other functions unchanged |
| TEST project | `zbwsbnqqpkvdhqwavjke` (verified) · PROD `wqnigjhcwjxtmordrwno` NOT accessed |
| Company Brain | `030f4f36-171d-4c27-85e1-1c791f05e391`, fp `4fc444f7f8f05b18644be7e9219d7240` (unchanged) |

## Boot checks (v86)
- unauthenticated → **401** (`UNAUTHORIZED_NO_AUTH_HEADER`)
- authenticated + empty body → **400** (`missing_required_fields`)
- zero DB changes (pre-Q1 baseline identical to pre-deploy)

## Pre-Q1 baseline (locked)
lead_candidates 426 · contacts 165 · signals 426 · accounts 149 · drafts 64 · approvals 25 ·
task_plans 184 · tasks 356 · tool_calls 325 · Penn 24 · outreach 0/0/0 · activity_feed 1679.

## Submission (exactly one)
- Query: `Find B2B SaaS founders currently hiring for RevOps — who should I contact this week?`
- workspace `00000000-0000-0000-0000-000000000001`, `{execution_mode: source_and_qualify_only, max_results: 5}`
- Auth user `9cfdd84f-b036-4eac-9d50-1a4627f4cba6` (matched). HTTP **200**.
- plan **`54e35616-f2b2-4ca7-81a6-6ca08ff796b1`**; Scout task step 0. (AI plan described a jobs-first
  discovery, but run-agent's deterministic routing ran the person path.)

## Providers (only the 3 allowed actors)
| Actor | Calls | Status |
|---|---|---|
| `apify_people_search` / harvestapi/linkedin-profile-search | 1 | succeeded |
| `apify_linkedin_company_details` / harvestapi/linkedin-company | 5 | succeeded (bounded concurrency, ≤3 at once) |
| `apify_jobs` / curious_coder/linkedin-jobs-scraper | 5 | succeeded (bounded, one per company, ≤3 at once) |

No research_web · no Firecrawl · no Perplexity · no generic LLM sourcing. Scout invocation
**HTTP 200, ~90.2s** (edge log) — no 504; ~45s finalization reserve remained under the 135s budget.

## Signal-enrichment observability (reconciles: true)
companies deduplicated 5 · planned 5 · called 5 · cached 0 · skipped 0 · enriched 5 · no_result 0 ·
failed 0 · timed_out 0 · skipped_due_deadline 0 · budget 5/5 (stop: budget_exhausted).
raw_job_records 46 → normalized 46 → verified 46 → deduplicated 46.
signals_fresh 34 · weak_supporting 0 · stale 12 · closed/expired 0.
candidates_timing_sufficient **5** · missing_timing_evidence 0 · timing_contradicted 0 · requalified 5.

## Qualification observability (reconciles: true)
raw 5 · normalized 5 · source_gate_accepted 5 · source_gate_rejected 0 · hard_gate_rejected 0 ·
qualification_accepted 0 · qualification_rejected 0 · **qualification_staged 5** · persisted 0 ·
downstream_aria 0 · aria_screening 0. Total evaluated 5 = qualify_now 0 + staged 5 + reject 0 (mutually exclusive).

## Timing → final qualification (the key safety)
All 5 candidates had verified identity + company fit + a fresh RevOps/sales hiring SignalEvent
(`timing_sufficient`). Per policy, `timing_sufficient` cleared the timing gap but did **not** force
`qualify_now`; the existing persistence authority (Aria decision + tier) staged all 5. Result:
`result_status: no_results`, 0 persisted, Aria step not created (no accepted leads to rank).

## Database deltas (post-Q1 vs locked baseline)
| Table | Δ | Note |
|---|---|---|
| lead_candidates | 0 | nothing qualified ⇒ nothing persisted |
| contacts / accounts | 0 / 0 | none |
| **signals** | **0** | SignalEvents in-memory only; generic table NOT written |
| drafts | 0 | no outreach |
| approvals | 0 | — |
| queued / sent outreach | 0 / 0 | — |
| outreach activities | 0 | — |
| Penn tasks | 0 | — |
| task_plans | +1 | the Q1 plan |
| tasks | +1 | Scout only (no Aria) |
| tool_calls | +11 | 1 people + 5 company + 5 jobs |
| activity_feed | +18 | workflow telemetry |
| Company Brain | unchanged | fp identical |

All safety deltas zero; production untouched.

## Verdict & next
**PASS — structured hiring signal path verified.** Positive timing path exercised (5× timing_sufficient);
positive persistence + Aria path NOT exercised (existing authority staged all — expected, safe). The one
non-blocking open item: with fresh, source-backed hiring proven, the reason no candidate persisted is the
existing Aria/tier qualification threshold, not the signal path — a product-tuning question for whether a
fresh GTM-hiring signal should lift a fit-verified founder to accepted. Dominant remaining blocker: none
for the signal path; live positive-persistence proof still pending a qualification-threshold review.

Contains no tokens/headers/credentials/emails/phones/raw provider payload.
