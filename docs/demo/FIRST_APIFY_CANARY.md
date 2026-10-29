# The first real-Apify canary — automated, gated, not run

> "Find one US company hiring Account Executives that raised funding within the last six months."

Target: the isolated TEST project `tlvnfrxzjhsjgdofwehb` (`agentory-discovery-test`), workspace `discovery-test`
(`40e2512f-09b6-433e-97fe-f9999a1f1897`). **Never** production (`ohsdatpvfdjdemstoiuj`); the kickoff preparer,
`supabase:test` and the worker workflow all refuse it. Nothing below has been executed.

## Interpretation (judged D1–D7 before anything is queued)

| Requirement | Compiled as | Source |
|---|---|---|
| one company | `requested_count = 1`, companies (not people) | user |
| US | hard geography, headquarters | user |
| hiring Account Executives | hard hiring criterion on the AE role, **last 30 days** | **ASSUMED** — Agentory's default; the request states no hiring timeframe. Printed and written into the SQL; the preparer exits 3 until `--acknowledge-defaults`. |
| raised funding within six months | hard funding criterion, 180 days, user's own window | user |

## The plan: three actors, one start each, no fallback

| Step | Actor | Units | Reads | Worst case |
|---|---|---|---|---|
| Job discovery (AE postings, US) | `harvestapi~linkedin-job-search` | 1 start + ≤ 3 jobs | 3 | $0.004000 |
| Company identity/geography | `harvestapi~linkedin-company` | 1 start + 1 company | 2 | $0.004050 |
| Funding verification (dated rounds) | `atomus~linkedin-company-scraper` | 1 start + ≤ 3 companies found | 2 | $0.010550 |
| **Provider total** | | | **7** | **$0.018600** |
| Model (Luna, in the worker) | `gpt-5.6-luna` | ≤ 4 attempts × $0.01248 reserved | — | **$0.049920** |
| Kickoff compile (outside the worker) | `gpt-5.6-luna` | ≤ 2 calls (`lunaOnlyFetch`) | — | $0.02496 reserved, ≈ $0.006 expected |

* Inside the worker: **$0.0685 committed at most** ($0.0186 provider + $0.0499 model), under the combined $0.25 and the
  per-kind $0.20 / $0.05 caps. The kickoff compile is a separate approved spend; worst case it is ≈ $0.093 in total.
* Every Apify start carries the gate-pinned `maxTotalChargeUsd` (0.004 / 0.00405 / 0.01055). Reads are free.
* **No Pvalyou template**: the gate refuses any paid fallback. A company Atomus leaves open stays PENDING.
* **No automatic retries of a paid call**: a start is admitted once per operation key; an uncertain start is held,
  never re-sent (`killResumeAdoption.contract.test.ts`).
* Prices are from the public actor pages read 2026-10-28 (FREE/BRONZE tier). They must be re-observed on the canary
  account within 24 h of authorization (`apify-account-check.ts`), or nothing runs.

**Honest expectation.** Three postings may hold no company funded in the last six months; the run then ends
`search_exhausted` with 0 qualified. That is a correct result, never reported as a find. The canary proves the paid path
end to end; finding a company is likely, not guaranteed.

## Rehearsed offline (local Postgres + PostgREST, vendors scripted)

`tests/db-contract/canaryFundingRehearsal.contract.test.ts`:

1. **Today's schema refuses the catalog** at authorization ("sum to at most 5"): the read cap is the blocker.
2. **With the proposed read cap of 7**: jobs → details → Atomus, one start each. Provider ≤ $0.0186, four model
   attempts (a fifth is refused *before sending*), seven reads. Only the funded company qualifies; its funding
   evidence names Atomus, `corroborated: false`. There is one row, in the canary workspace, and the operator's
   verification SQL passes on it.
3. **The generated paid kickoff SQL** executes on the cap-7 schema with limits 1/1/1, and is refused on today's.

**Found and fixed during this rehearsal** (`candidateEligibility.ts`, `missionEvaluation.ts`): on the job-first route
Atomus runs *after* the evaluator. The evaluator's earlier "unknown" for funding held the funded company pending, so the
data was bought and nothing qualified.

**Review blocker B1 (on `fed35777`)**: that first fix keyed on the *parsed* verdict (unknown, no receipts). The strict
parser produces exactly that shape when it rejects a model's `fail` with stale, conflicting, invalid or foreign receipts,
so a rejected `fail` could be promoted to eligible. Every parsed verdict now records its `origin`:

* `answered`
* `abstained`
* `downgraded`
* `receipts_rejected`
* `missing`
* `unparsed`

It also records `model_result` and `rejected_receipts`. A dated round resolves the earlier unknown only when all of
these hold (`fundingResolvesAbstention`, `fundingAbstentionAfterVerifier.test.ts`):

* the model itself abstained, citing nothing;
* the funding criterion is windowed and was decided pass by `decideRecentlyFunded`;
* the funding evidence is clean: the current item is proven, and there is no conflicting, stale or disproven funding item.

Anything else stays unresolved.

## One execution procedure: the guarded workflow

Every step runs through `.github/workflows/discovery-test-worker.yml` (input `canary_stage`), in the
`discovery-test` Environment and behind its required reviewer. Both jobs start with a refusal step that refuses
production, refuses any project other than `tlvnfrxzjhsjgdofwehb`, any workspace other than `discovery-test`, and any
commit other than `expected_sha`. Stage logic lives in `scripts/test-project/canary/canary-stage.sh`. Each stage stops at
the first failed check and saves a non-secret audit artifact. The Apify username is masked and no secret is printed.

**One-time prerequisite (only you can do it).** Add Environment secret `TEST_DB_URL` to `discovery-test`. It is the
isolated project's administrator connection string: the Supabase pooler URL (`postgres.tlvnfrxzjhsjgdofwehb@…`) or the
direct one (`db.tlvnfrxzjhsjgdofwehb.supabase.co`). The migration and `authorize_discovery_smoke` are not granted to the
service role, so the existing `TEST_SUPABASE_*` keys cannot do either. The stage refuses a URL that does not name
`tlvnfrxzjhsjgdofwehb` or that names production. Preflight check P00 then re-checks the identity from the live connection.

Every dispatch below uses the same base:

```
gh workflow run discovery-test-worker.yml --ref demo/lead-discovery-e2e \
  -f confirm_project_ref=tlvnfrxzjhsjgdofwehb -f expected_sha=<REVIEWED_SHA> -f session_minutes=5 \
  -f providers=<as below> -f canary_stage=<stage> …
```

| # | Stage | What it does | Extra inputs | Writes / spends |
|---|---|---|---|---|
| 1 | `verify` | Apify identity, plan, usage and limit, actor availability, current prices against the approved maxima; project identity; read cap (5/7); migration and rollback checksums; no conflicting work; preflight; an offline kickoff validated K01–K19 | `providers=openai-only`, `apify_username=<name>` | nothing, free |
| 2 | `migrate` | re-checks identity and checksums; refuses if already applied; applies **only** `20261029120000_smoke_read_cap_seven.sql`; post-checks cap 7; preflight | `canary_approval="apply 20261029120000_smoke_read_cap_seven to tlvnfrxzjhsjgdofwehb"` | **DB write** (reversible: rollback file) |
| 3 | `prepare` | re-verifies, then the real kickoff compile and the PAID kickoff SQL (one start each, approver named), validated K01–K19; saved as artifact `canary-prepare`; **not executed**; prints its sha256 | `canary_approval="compile canary kickoff at <REVIEWED_SHA>"`, `canary_approver="<name, date>"`, `apify_username` | **≈ $0.006 GPT** (≤ 2 Luna calls, ≤ $0.025 reserved) |
| 4 | `launch` | downloads that artifact, checks its sha256, re-validates, re-verifies account, prices, identity, cap and conflicts; **executes the kickoff SQL**; verifies the queue row and authorization; then the existing worker step runs at once, within the 300 s window; then post-run checks and the reconciliation to review | `providers=openai-and-apify`, `kickoff_run_id=<prepare run>`, `kickoff_sha256=<sha>`, `canary_approval="launch canary <sha> on tlvnfrxzjhsjgdofwehb with a software-enforced $3 budget"`, `apify_username` | **DB write + Apify ≤ $0.0186 + worker GPT ≤ $0.0499** |
| 5 | `reconcile` | read-only re-run of the post-run checks: C01–C10, the reconciliation list, Apify's own charge per run, and `reconcile-to-review.sql` (not executed) | `providers=openai-only` | nothing |

**The $3 canary budget** (`scripts/test-project/canary/canary-budget.ts`) gates `verify`, `prepare` and `launch`:

* **B1:** every paid start is a pay-per-event Apify run carrying Apify's per-run `maxTotalChargeUsd`, pinned by the gate.
* **B2:** today's prices fit each reserved maximum.
* **B3:** one attempt fits $0.20 provider, $0.05 model and $0.25 combined.
* **B4:** what the canary already spent plus the next stage's worst case fits **$3**. "Spent" means every attempt at
  this request in the canary workspace, at Apify's reconciled figure or the committed worst case, plus recorded
  kickoff compiles. The next stage's worst case is $0.0935 for prepare and $0.0685 for launch.
* **B5:** the Apify account's remaining room covers the next attempt.
* **B6** is reported on every run and is never a PASS. **The $3 is software-enforced.** The account's $19 hard limit is
  not the enforcer. Apify's per-run cap is unproven until the first run's receipts. If every software layer failed at
  once, exposure would be bounded only by the account limit.

The launch approval phrase names that limitation. An uncertain charge is never retried: the gate holds it, and no new
attempt is authorized while any purchase is unreconciled. `verify`, `prepare` and `reconcile` open read-only database
sessions (`default_transaction_read_only`).

One gap is not tracked: a `prepare` whose kickoff is never launched leaves its compile cost (at most $0.025) outside the
database, so B4 does not count it. A kickoff also expires 24 h after its prices were observed.

Why launch is a single step: `authorize_discovery_smoke` sets the deadline to the queue row's `created_at + 300 s`. A
kickoff executed in one run and a worker approved later in another would expire before buying anything. So the kickoff
write, the paid Apify run and the worker run under one approval, with the kickoff SQL fixed in advance by its sha256.

Closing reconciliation, done by the administrator after reviewing the audit: run `reconcile-to-review.sql`. Fill each
Apify figure from `apify-runs.txt`, then run `stop_discovery_smoke` and `reconcile_discovery_smoke_operation` once
per purchase.

Locally, `scripts/test-project/canary/local-rehearsal.sh` drives all five stages and every refusal against a
throwaway database and a stand-in Apify API (`tests/infra/fixtures/fake-apify.ts`). The workflow itself is pinned by
`tests/infra/canaryWorkflow.test.ts`.

## Reviewed commit

* **Approved application code:** `ce67c1fc334715daae36715f54765093119f6f50`. It passed independent review and full CI.
* **`<REVIEWED_SHA>`** is the head of `demo/lead-discovery-e2e` that carries this automation. It is the
  `expected_sha` of every stage, and the kickoff's `planner_runtime`. The automation commit adds no application code:
  `git diff --stat ce67c1fc334715daae36715f54765093119f6f50 <REVIEWED_SHA> -- supabase/functions worker src supabase/migrations supabase/migrations-held`
  is empty. Every stage must use the same `<REVIEWED_SHA>`. Launch refuses a kickoff that `prepare` compiled at another commit (check K08).
