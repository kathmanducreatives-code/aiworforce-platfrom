# ATLAS — executive summary (2026-11-20)

Full evidence, tables and diagrams are in [ATLAS_COMPLETE_CAPABILITY_INVENTORY.md](ATLAS_COMPLETE_CAPABILITY_INVENTORY.md). That audit is read-only: no paid calls, deploys, migrations or secret changes. Code: `launch/hardening` @ `3c63e0c2`.

## What ATLAS truly is today

**Three engines, not one.**

| Engine | Runs where | What it can do | Proven live |
|---|---|---|---|
| **V4 ATLAS** (`lead-pipeline`: Mission Contract v4, signed plans, evidence graph) | **TEST only** (v45) | Hiring-signal discovery → company record → website B2B check → dedupe → save → Workbench by `plan_id` | Interpretation and the safety guard only. **No paid run, ever** |
| **Legacy V1** (`orchestrate` → `run-agent`; Gemini picks Actors from `actorRegistry`) | **Production** (`run-agent` v275) | LinkedIn jobs, company details, decision-maker unlock (`unlock-founders`), Firecrawl | Production history (not readable here) |
| **Legacy V2 capability engine** (12.8k-line `leadCapabilityEngine.ts` + worker, leases, receipts) | Production function + worker (health unverified); TEST via a GitHub Action | **Company search with industry, size and location filters**, YC, funding, news, jobs, records; async runs; vendor reconciliation | TEST ledger (Oct 22/30); code-recorded company-search run |

**The paradox:** the newest, safest engine (V4) is the least capable. The older V2 engine already has the features V4 lacks.

## The numbers

| | Count |
|---|---|
| Distinct discovery capabilities built (all engines) | **17** |
| Apify Actor IDs referenced in the repo | **51** (45 still exist; **6 removed from the Store**, 2 still wired in the V1 registry) |
| Places that declare Actors | **11** catalogues and registries |
| Approved for V4 | **5**, of which **3 executable** on TEST today |
| Live-tested (evidence readable here) | **5** Actors |
| Deployed TEST tables / views | 139 (59 discovery-related); core schema exists only in a **held** baseline migration |

## Can ATLAS…?

| Question | Answer |
|---|---|
| Find companies without job postings? | **No (V4).** Yes in V2 (company search, YC, funding) |
| Find founders and decision-makers? | **No (V4).** Yes in production via `unlock-founders`, per company, on credits |
| Combine Apify + LeadOcean? | Designed, **not runnable** (no LeadOcean key; flag off) |
| Research a company website? | **Yes**: ≤3 first-party pages, grounded B2B quote (V4); Firecrawl evidence (V2) |
| Verify recent signals? | Hiring **yes**. Funding, news and headcount only in V2 |
| Support 100-lead missions? | **Not in V4** ($0.25 cap ≈ 25 hiring companies; synchronous calls; no continuation) |
| Show all stored information in the Workbench? | **Partly.** Verdict detail lives in the strategy panel, which has no hosted TEST build |
| Start discovery without chat? | **No** |

## Ten request types (offline)

| Result | Requests |
|---|---|
| **Ready** | 25 US companies hiring AEs |
| **Ready but silently narrowed** | "expanding sales teams" → only "Account Executive", worldwide |
| **Blocked** | B2B manufacturers 20–200; industrial distributors; commercial field services; founders of B2B SaaS; recently raised funding |
| **Clarification** (correct) | channel partners; "promising companies, explain why" |
| **HTTP 500 bug** | "companies using HubSpot" (`freezeCriteria: the mission carries no criteria`) |

## Biggest findings

1. **V2 already solved company-first discovery.** `compileHarvestCompanySearchInput` uses structured filters, and its code records a live run that returned 5/5 real US staffing agencies. V4 can't use it.
2. **V2's lesson corrects the #271 prototype.** This Actor's `searchQuery` matches company *names*; a concept query costs money and returns nothing. The prototype also reports "executable at $0" when a mission has no capability. Both flaws are recorded.
3. **V4 never reads real charges** (synchronous runs, `basis: estimate`). V2 has `providerReceipts.ts` and a TEST-verified vendor reconciliation table.
4. **Each environment has only half the system.** V4 is TEST-only and the legacy engines are production-only, so the same request can't be compared on both.
5. **Two production registry entries** point at Actors deleted from the Apify Store. The account's most-used jobs Actor (`bebity/linkedin-jobs-scraper`) appears in no registry.

## Recommendation: converge, don't rebuild

Keep V4's spine: the contract, coverage guard, signed plan, evidence engine, `persistRows` and Workbench. Port V2's proven parts underneath it.

| Rank | Change | Why |
|---|---|---|
| 1 | Add **company search** to V4, reusing V2's input compiler (owner approval of the Actor needed) | Unblocks 4 of the 5 blocked request types |
| 2 | **Receipts + async runs** from V2 (`providerReceipts.ts`, continuation) | Real costs; larger missions |
| 3 | **Schema-validated inputs** from V2 contracts (job-search `industryIds`/`functionIds`, crawler `proxyConfiguration`) | Ends silent narrowing |
| 4 | Fix the **HTTP 500** for unsupported-only missions, and the industry any-of compile | Honest answers |
| 5 | **Run the approved pilot**, then host the V4 panel on TEST | First real leads in the Workbench |

Activating these needs no substantial new code, only your approval for each: the pilot run, the post-signals flag, and a hosted TEST build with `VITE_STRATEGY_DISCOVERY`.
