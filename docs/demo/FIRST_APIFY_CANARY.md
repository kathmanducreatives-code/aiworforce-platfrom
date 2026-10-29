# The first real-Apify canary — prepared, not run

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

**Found and fixed during this rehearsal** (`candidateEligibility.ts`): on the job-first route Atomus runs *after* the
evaluator. The evaluator's earlier "unknown" for funding, which cited nothing, held the funded company pending. The data
was bought and nothing qualified. Now an abstention citing nothing no longer lowers a funding window decided from dated
round records. A `fail`, or an `unknown` with receipts, still does (`fundingAbstentionAfterVerifier.test.ts`).
**This change needs review before the canary runs**: the worker runs the approved commit's code.

## Approvals needed, in order (none given yet)

1. **Review and merge-free approval of commit `<SHA>`** on `demo/lead-discovery-e2e`, after CI is green:
   `gh workflow run ci.yml --ref demo/lead-discovery-e2e -f level=full`.
2. **Apply the held read-cap migration to the isolated project only:**
   `psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations-held/20261029120000_smoke_read_cap_seven.sql`
   (rollback: `supabase/migrations-held/rollback/20261029120000_smoke_read_cap_seven.down.sql`).
3. **Canary Apify account**:
   * a token created on the new account (never the old one), stored only as the GitHub Environment secret
     `discovery-test` → `TEST_APIFY_API_TOKEN`, and in your own shell for the check;
   * an account usage limit of ≤ $5;
   * then, in your own terminal (never paste the token into chat):
     ```
     APIFY_API_TOKEN=… deno run --allow-net=api.apify.com --allow-env=APIFY_API_TOKEN --allow-read=docs/launch/proposals \
       scripts/test-project/apify-account-check.ts --expect-username <canary account username>
     ```
     Every line must be PASS (exit 0). Use its `observed_at` for step 4.
4. **The kickoff compile** (≈ $0.006, ≤ 2 Luna calls) and the paid authorization:
   ```
   OPENAI_API_KEY=<TEST key> deno run --allow-env --allow-read --allow-write=out/canary --allow-net=api.openai.com \
     scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts --scenario canary_funding \
     --project-ref tlvnfrxzjhsjgdofwehb --workspace 40e2512f-09b6-433e-97fe-f9999a1f1897 --user <TEST user uuid> \
     --pricing-version canary-2026-10 --jobs-max 4000 --details-max 4050 --atomus-max 10550 \
     --observed-at <from step 3> --price-source "apify-account-check.ts on <username>, <date>" \
     --approved-by "<name, date>" --authorize-paid "<name, date>" --acknowledge-defaults --out out/canary
   ```
   A dry run first: the same command with `--proposal docs/launch/proposals/canary-funding-reviewed-mission-proposal.json`
   and without `OPENAI_API_KEY` sends nothing. Review `out/canary/kickoff.sql`: its header must say `PAID: APPROVED BY …`,
   `worst-case provider 18600 µ$` and the ASSUMED hiring window.
5. **Run the reviewed kickoff SQL once on the TEST project:** run
   `scripts/test-project/real-gpt/preflight.sql` first (every row PASS), then
   `psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f out/canary/kickoff.sql`.
6. **Dispatch the TEST worker** (a required reviewer approves the Environment):
   ```
   gh workflow run discovery-test-worker.yml --ref demo/lead-discovery-e2e \
     -f confirm_project_ref=tlvnfrxzjhsjgdofwehb -f providers=openai-and-apify -f session_minutes=5 -f expected_sha=<SHA>
   ```

## After the run (read-only, then the administrator's reconciliation)

```
psql "$TEST_DB_URL" -X -v workspace_id='40e2512f-09b6-433e-97fe-f9999a1f1897' -v queue_id='<queue>' \
  -f scripts/test-project/canary-funding-verify.sql            # C01–C10: any FAIL = not a success
psql "$TEST_DB_URL" -X -v queue_id='<queue>' -f scripts/test-project/smoke-reconciliation.sql
APIFY_API_TOKEN=… deno run --allow-net=api.apify.com --allow-env=APIFY_API_TOKEN --allow-read=docs/launch/proposals \
  scripts/test-project/apify-account-check.ts --runs <run ids from the reconciliation list>
# then, per purchase, with Apify's own figure:
select public.stop_discovery_smoke('<queue>', 'canary finished');
select public.reconcile_discovery_smoke_operation('<queue>', '<operation_key>', <vendor µ$>, '<Apify run URL>', '<status>');
```
