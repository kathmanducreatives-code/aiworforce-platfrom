# Q1 v83 company-enrichment audit (one controlled TEST run)

**Verdict: PARTIAL PASS — sourcing + company enrichment ran with the correct actors and the
typed `company_items` path, but the Scout invocation TIMED OUT (504 @ ~150s) before
qualification / persistence / observability / Aria, so the intended "staged because timing
missing" outcome was not reached. All unsafe DB deltas are zero.**

## Release context
| Item | Value |
|---|---|
| Merged main SHA | `8ae6b150` |
| run-agent (TEST) | **v83** |
| orchestrate (TEST) | **v31** |
| TEST project | `zbwsbnqqpkvdhqwavjke` (verified) |
| Production | `wqnigjhcwjxtmordrwno` — NOT accessed |
| Company Brain | `030f4f36-171d-4c27-85e1-1c791f05e391`, fingerprint `4fc444f7f8f05b18644be7e9219d7240` (unchanged pre/post) |

## Pre-run baseline
lead_candidates 426 · contacts 165 · signals 426 · accounts 149 · drafts 64 · approvals 25 ·
task_plans 181 · agent_tasks 353 · tool_calls 306 · Penn 24 · queued/sent outreach 0/0 ·
outreach activities 0 · activity_feed 1640. Boot checks (401/402…400) previously passed with zero DB changes.

## Submission (exactly one)
- Request: `Using my ICP, find me 5 hot founders I should contact right now.`
- workspace `00000000-0000-0000-0000-000000000001`, tool_input `{execution_mode: source_and_qualify_only, max_results: 5}`
- Auth user id `9cfdd84f-b036-4eac-9d50-1a4627f4cba6` (matched). HTTP **200**.
- plan_id **`fb6822b4-cb92-43b9-b6e8-357e9f52c6bf`**; planner `ai`; intent `sourcing`; agents `[scout, aria]` (2 steps, **no Penn/outreach step**).
- Scout task **`34bcb3c3-c279-42ae-bb9a-42ad557cc66f`**; Aria task **never created** (Scout never completed).

## People sourcing (Scout)
- Actor: **`apify_people_search` / `harvestapi/linkedin-profile-search`** ✓ (correct)
- Provider run id `Oh7WTSshoiNoWFYyV`; sanitized input keys: `locations, takePages, searchQuery, currentJobTitles, profileScraperMode`
- Raw people returned: **5** ("Scout reviewed 5 raw results"); actor attempts: 1
- No fabricated identities, no generic fallback (provider-backed people search).

## Conditional company enrichment
- Actor: **`apify_linkedin_company_details` / `harvestapi/linkedin-company`** ✓ (correct)
- **5 company calls**, all via the `searches` (company-name) input — the people actor output carried **no company LinkedIn URL**, so the deterministic builder fell back to name search.
- Deduplicated companies: 5 (one call each — 5 founders across 5 distinct companies, no collapse this run)
- Outcomes (from actor item counts): **enriched 3** (1 item each), **no_result 2** (0 items), failed 0
- Provider run ids: `KhPWro0jA8Nf4Jq2d`(0), `1PSLJVn1Bh66QeHTC`(1), `RoyTbYAZOUdFOFdHl`(1), `5mb4oatFueqyhHADb`(1), `ieyMeJ3aUS36rqyK4`(0)
- Typed `company_items` path: **used** (deployed v83; live-schema probe already proved complete/untruncated normalization). No job normalization, no provider_payload truncation, no Firecrawl.
- **Not verifiable this run** (blocked by timeout): evidence fan-out counts, candidates requalified, company_enrichment_observability reconciliation — the observability object was never written.

## research_web anomaly
One `research_web` (Perplexity) tool call was attempted at 14:22:44 and returned **unavailable** (Perplexity not configured → no external call, no data, no cost). It is run-agent's optional broad-research fallback and cannot source leads (fail-closed gate). Not a sourcing-actor selection; flagged as a minor deviation from the "Apify-only" expectation.

## Failure: invocation timeout
- Edge log: `POST | 504 | run-agent | execution_time_ms: 150201 | version 83`.
- The Scout invocation ran the people call + **5 sequential** company Apify calls (each polling up to ~90s), exceeding the ~150s edge-function wall-clock limit.
- Consequence: qualification gate, persistence decision, staging, `company_enrichment_observability`, `qualification_observability`, and the Aria hand-off **never executed**. Scout task stuck `running`; plan stuck `executing` (orphaned, left unmodified per instructions).

## Qualification / persistence / Aria
- **Not reached** (timeout). 0 candidates qualified/staged/rejected via the gate; 0 persisted; Aria input 0.
- Because nothing persisted, no person/company provenance was written — but equally, no company actor overwrote person provenance, and no fabricated person reached Aria.

## Database deltas (post − pre)
| Table | Δ | Explanation |
|---|---|---|
| lead_candidates | 0 | nothing persisted (timeout before persistence) |
| contacts / signals / accounts | 0 / 0 / 0 | none created |
| drafts | 0 | no outreach (safe) |
| approvals | 0 | — |
| queued / sent outreach | 0 / 0 | no outreach (safe) |
| outreach activities | 0 | no outreach (safe) |
| Penn tasks | 0 | no Penn step |
| task_plans | +1 | the Q1 plan (orphaned `executing`) |
| agent_tasks | +1 | the Scout task (orphaned `running`) |
| tool_calls | +7 | 1 people + 5 company + 1 research_web(unavailable) |
| activity_feed | +12 | workflow telemetry |
| Company Brain | unchanged | fingerprint identical |

Outreach delta = 0; Company Brain unchanged; production untouched.

## Verdict
**PARTIAL PASS.** People sourcing (correct actor, 5 raw) and conditional company enrichment
(correct actor, `company_items` path, 3/5 enriched via name-search fallback) executed; safety
posture fully intact (zero unsafe writes). **Defect:** the Scout run-agent invocation timed out
(504 @ 150s) running the people call plus 5 sequential company calls, so qualification, persistence,
staging, observability and Aria did not run — the "hot-founder stays staged (timing missing)" behavior
was not demonstrated.

## Dominant remaining blocker
run-agent Scout invocation latency vs the ~150s edge-function wall-clock limit: conditional company
enrichment adds N sequential Apify company calls (~20–40s each) on top of people sourcing in a single
invocation. With 5 companies this exceeds the budget.

## Recommended next phase
1. Reduce enrichment wall-clock inside one invocation: cap company calls per invocation, run them in
   parallel (bounded concurrency), and/or move enrichment to a background/continuation invocation so
   the Scout HTTP path finishes under 150s and the qualification/persistence/observability stages always run.
2. Persist partial `company_enrichment_observability` before the enrichment loop so a timeout still leaves a diagnostic trail.
3. Improve company LinkedIn URL capture from the people actor so enrichment uses the more reliable `companies` (URL) path instead of `searches` name fallback (2/5 no_result here).
4. Only after the invocation reliably finishes: re-run one Q1 to observe the intended staged/timing-missing outcome + observability reconciliation.

Orphaned rows: plan `fb6822b4…` (`executing`) and Scout task `34bcb3c3…` (`running`) were left unmodified.

Contains no secrets, phone numbers, emails, or raw provider payloads.
