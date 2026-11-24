# Live Apify canary: exact request plan (Contract 3), awaiting approval

Status: **NOT RUN.** Nothing in this plan has been executed. It authorizes nothing until the owner approves it with the contract's approval phrase.

- Contract: `docs/launch/proposals/canary-session-contract-3.json`
- Contract sha256: `40c48732035b2f66a5fee1b2b753dfe12802347578ba44213ab4404c2b4f3ffc`
- Catalog: `docs/launch/proposals/smoke-catalog-canary-funding-3.json`
- Target: the isolated TEST project `tlvnfrxzjhsjgdofwehb`. This is never production.

## Mission (cohort: 1 company)

"Find one US company hiring Account Executives that raised funding within the last six months."

| Criterion | Strength | How it is proved |
|---|---|---|
| Headquarters in the US | hard | A company record that flags exactly one HQ (`li_record_flagged_headquarters`). A job location is never treated as HQ. |
| Hiring an Account Executive within the last 30 days | hard | A dated job posting from the job-search actor. |
| Funding within the last 180 days | hard | A dated round from Atomus. |

## Exact paid requests (at most one start of each)

Actor prices were read from the public `api.apify.com/v2/acts/<id>` pricing on 2026-10-31. The FREE/BRONZE tier applies, and no pending price change was listed.

| # | Actor (id) | Input limits (enforced by the gate) | Price | Maximum |
|---|---|---|---|---|
| 1 | `harvestapi~linkedin-job-search` (`zn01OAlzP853oqn4Z`) | `maxItems: 1`, 1 job title ("Account Executive"), 1 location (United States), 0 geoIds, ≤4096 B, timeout 120 s, memory 256 MB | start $0.001 + job $0.001 | **$0.00200** |
| 2 | `harvestapi~linkedin-company` (`UwSdACBp7ymaGUJjS`) | `companies` ≤1, `searches` 0, ≤1024 B | start $0.00005 + item $0.004 | **$0.00405** |
| 3 | `atomus~linkedin-company-scraper` (`gL9KGjP8gHJPO432i`) | 1 company, ≤2048 B; started only if HQ and hiring pass or still route | start $0.00005 + company found $0.0035; not-found is free | **$0.00355** |
| 4 | OpenAI (worker) | ≤4 attempts × $0.01248 | — | **$0.04992** |
| 5 | OpenAI (mission compile) | 2 calls × $0.01248 | — | **$0.02496** |

| Total | Amount |
|---|---|
| Provider (Apify) maximum | **$0.0096** |
| Model maximum | **$0.07488** |
| **Session maximum** | **$0.08448** |

Earlier canaries spent about $0.023 of the $3 software budget (`canary-budget.ts` B1–B6). The $3 budget is not raised.

## Hard limits and replay protection (all enforced in code)

- **Gate refusals.** The smoke admission gate **refuses**, and does not clamp:
  - any actor outside the three above;
  - any field over its limit;
  - a request over its byte limit.

  Each start is pinned with `maxTotalChargeUsd` equal to its maximum, so Apify itself stops charging at the cap.
- **Contract checks.** A01–A12 (contract) and S01–S18 (session) run before kickoff. K01–K20 validate the kickoff against the catalog. Any refusal means no kickoff.
- **Single use.** The queue and plan ids are derived from the contract's sha256, so the queue's primary key refuses a second kickoff.
- **No paid retries.**
  - `admission_refused` is never retried, repaired or escalated.
  - A `charge_uncertain` purchase is held and reconciled from Apify's own receipt. It is never re-bought.
  - `LEAD_REEVALUATE_FAILED_EVALUATION` stays **off**.
- **Isolation.**
  - The kickoff writes only the canary's own `task_plans`, `lead_execution_calls` and `lead_mission_queue` rows, plus the smoke authorization, in the TEST project.
  - It runs no migrations.
  - It does not touch production Lead IDs, history or outreach holds.
  - It sends no outreach and imports nothing into a CRM.
- **Read cap.** The TEST project's `provider_polls` check already allows 7 reads (checked read-only on 2026-10-31). The catalog's read-cap blocker is therefore cleared, and no migration is needed.

## What still has to happen before dispatch (owner actions)

1. **Verify the account (read-only, free).** Run the workflow `canary_stage=verify`. It checks, with the stored token:
   - that the Apify token belongs to the intended account;
   - the plan, remaining credit and `maxTotalChargeUsd` enforcement;
   - prices on that account within 24 h.

   This environment holds no Apify or OpenAI credentials, so it cannot verify these itself.
2. **Activate the contract.** Copy `canary-session-contract-3.json` over `canary-session-contract.json` in a reviewed commit.
3. **Approve.** Send the exact phrase: `run canary session 40c48732035b2f66a5fee1b2b753dfe12802347578ba44213ab4404c2b4f3ffc at <that commit sha>`.

## What it will and will not measure

It will measure:
- discovered, qualified, rejected and needs-verification counts;
- HQ accuracy against the company record;
- real Apify receipts compared with each cap;
- whether evaluator calls failed;
- the decision trace for every hold.

With a cohort of 1:
- duplicate rate and cost per qualified company are indicative only;
- employee-count accuracy and founder/decision-maker coverage are not exercised, because no people-search actor is approved.

**A firmographic canary needs its own review.** None of the three approved actors can discover companies by size or industry alone; discovery is through job postings. Missions such as "US B2B SaaS, 11–200 employees" (repaired offline in `54f37db2`) need a reviewed company-search actor and catalog first.
