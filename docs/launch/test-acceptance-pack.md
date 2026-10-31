# Controlled TEST acceptance pack (Lead Discovery)

> **For the first agency-only run use `agency-test-operator-checklist.md`
> (Candidate B).** It replaces steps 0–3 below for that run: dispatch commit,
> migrations, seed, `providers: none` for step 2, `expected_sha`, and the
> corrected commands. The criteria here are unchanged.

Everything that can be prepared without a paid call, a hosted write or a
running hosted worker. **Each step marked ⛔ needs its own explicit owner
approval.** Phase 1 stays FAIL and A7 stays NO-GO until §6 says otherwise.

The dispatch SHA is the merged `launch/hardening` head that contains:
- the eight integration PRs (#144, #149, #157, #145, #150, #154, #158, #153);
- **#181**, the hiring-verifier clock fix (without it the edge suite is red since 2026-10-24);
- **#179**, the pre-effect guard (steps 5b and 5c test it);
- optionally #175 (S18a), #180 (seller facts) and #177 (OWN-01, held SQL).

## 0. External prerequisites (owner)

| # | What | Verified by |
|---|---|---|
| E1 | **A new production-test Apify account.** The old account is assumed unusable. Read its plan, restriction status and both actors' prices on that account. Nothing is bought until step 3's sequel, the paid A7 | owner, account page |
| E2 | Environment `discovery-test` holds, by name: vars `TEST_PROJECT_REF`, `TEST_WORKSPACE_ID`; secrets `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, `TEST_SUPABASE_ANON_KEY`, `TEST_OPENAI_API_KEY`. `TEST_APIFY_API_TOKEN` exists today (2026-10-26); it reaches the worker step only for `providers` = `openai-and-apify`, so leaving it is safe, removing it is optional | owner, GitHub settings |
| E3 | OpenAI TEST project with an **enforced** cap: Project → Limits → Spend with **"Enforce a hard limit" on**, or prepaid credits with auto-reload off. A budget **alert** is not a cap. `gpt-5.6-luna` available to the key; price read within 24 h | owner, screenshot |
| E4 | Observed `maximum_microusd` for both actor templates, read ≤ 24 h before any authorization. They come from E1's account, never from the old one | owner |
| E5 | A named operator who has read this pack and `real-gpt-zero-apify-test.md` | owner |

## 1. Schema verification (read-only)

```sh
psql "$TEST_DB_URL" -X -v workspace_id='<TEST_WORKSPACE_ID>' -v project_ref='<TEST project ref>' -f scripts/test-project/real-gpt/preflight.sql
psql "$TEST_DB_URL" -X -v workspace_id='<TEST_WORKSPACE_ID>' -v user_id='<TEST_USER_ID>' \
  -f scripts/test-project/acceptance/schema-verify.sql
```

| Expected | |
|---|---|
| P01–P16 | as in `real-gpt-zero-apify-test.md`; P09 needs **exactly 10** credits (the judge's R3 baseline); P15/P16 the three held security migrations. P05/P06 (billing) and P17 (client schema) are INFO |
| S01–S02 | the V2 queue, lineage and credit functions are present |
| S03 | the requesting user is a workspace **member**: the pre-effect guard refuses a non-member's mission |
| S04 | no pilot-marked task in the test workspace |
| S05 | **0** cross-workspace parents. This is required before #177 may ever be applied |
| S06/S07 | INFO: OWN-01 and the client tables, installed or not |

Any FAIL: stop. Fix only with a separately approved hosted change.

## 2. ⛔ Worker dry run with providers disabled

Purpose: the deployed code refuses before execution when it has no providers, and spends nothing.

1. No Environment change: dispatch with `providers` = `none` (step 3). No model or Apify key then reaches the worker step, and Deno denies both `api.openai.com:443` and `api.apify.com:443` (`tests/infra/testWorkerZeroApify.test.ts` executes the step's own shell).
2. Prepare the kickoff with **no model call and no network at all**:
   ```sh
   deno run --allow-env --allow-read --allow-write=./dry-run scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts \
     --approved-by "<name, date>" --out ./dry-run --workspace <TEST_WORKSPACE_ID> --user <TEST_USER_ID> \
     --pricing-version <v> --jobs-max <µ$> --details-max <µ$> --observed-at <ISO> --price-source "<where read>" \
     --proposal docs/launch/proposals/a7-reviewed-mission-proposal.json
   ```
   This compiles the reviewed proposal offline (I1–I8 still judged). No `OPENAI_API_KEY` is needed, `--allow-net` is not granted, and the compile gate allows 0 calls. Review `dry-run/kickoff.sql`: both actors are at **0** starts. Then run it as an administrator (⛔ hosted write).
3. Dispatch `discovery-test-worker.yml` on the dispatch commit (`session_minutes` = 5, `providers` = `none`, `expected_sha` = the commit).
4. Evidence: `real-gpt-evidence.sql`, judged with `judge-real-gpt-run.ts --providers-off`, and both reconciliations with `-v queue_id`.

**PASS** (judge O1–O7):
- the queue ends `failed` with one contained terminal verdict: `unhandled_exception` on Candidate B (without #149); `refused_before_execution` (`execution_planner_unavailable`) only once #149 is in the dispatch commit;
- 0 model rows and 0 provider rows;
- credit balance unchanged, 0 reserved;
- the credit check lists nothing.

Then close the authorization (`stop_discovery_smoke`, or wait 300 s): preflight P12 fails while it is live.

## 3. ⛔ Zero-Apify real-GPT acceptance

Exactly `docs/launch/real-gpt-zero-apify-test.md`: preflight → prepare (Luna only, ≤ 2 calls) → kickoff → judge.
- 25 criteria, of which **R4** (the Apify console shows no run) and **M6** (OpenAI usage equals the ledger) are manual.
- Ceiling ≤ $0.075, of which ≤ $0.05 is worker model spend. Expected ≈ $0.012. $0 Apify.

### Dispatch and evidence commands (steps 2, 3 and 5)
`gh workflow run --ref` takes a branch or tag, not a SHA, and the Environment's deployment branch policy decides which refs may run at all (on 2026-10-26: only `launch/hardening`; a tag is not allowed). Dispatch only from a ref the owner allowed, and pass the approved commit as `expected_sha`: the guard refuses any other checkout.
```sh
gh workflow run discovery-test-worker.yml --ref <allowed branch> \
  -f confirm_project_ref=<TEST_PROJECT_REF> -f session_minutes=10 -f providers=openai-only -f expected_sha=<dispatch-sha>
gh run list --workflow discovery-test-worker.yml -L 1      # approve the Environment reviewer in the UI
gh run watch <run-id> --exit-status
gh run view <run-id> --log | grep -E 'providers: openai-only|worker exited'   # the log carries nothing else
mkdir -p ./real-gpt-run
psql "$TEST_DB_URL" -X -At -v queue_id='<queue_id>' -f scripts/test-project/real-gpt/real-gpt-evidence.sql > ./real-gpt-run/evidence.json
deno run --allow-read scripts/test-project/real-gpt/judge-real-gpt-run.ts ./real-gpt-run/evidence.json
psql "$TEST_DB_URL" -X -v queue_id='<queue_id>' -f scripts/test-project/smoke-credit-reconciliation.sql > ./real-gpt-run/credits.txt
```
Abort at any point: `select public.stop_discovery_smoke('<queue_id>', 'operator stop');`, then `gh run cancel <run-id>`. The stop is proven on a real worker in CI (`tests/realprocess`): nothing is bought or sent after it, and nothing stays held.

`providers=openai-only` is the default. In that mode the worker step unsets any Apify token and Deno denies `api.apify.com:443` (`tests/infra/testWorkerZeroApify.test.ts` executes the step's own shell). Only the separately approved paid A7 uses `openai-and-apify`.

## 4. Credit and ledger reconciliation (read-only)

```sh
# Both are per mission and require its queue id.
psql "$TEST_DB_URL" -X -v queue_id='<queue_id>' -f scripts/test-project/smoke-reconciliation.sql
psql "$TEST_DB_URL" -X -v queue_id='<queue_id>' -f scripts/test-project/smoke-credit-reconciliation.sql
```

**PASS:**
- only expected rows;
- the credit check is empty;
- every `model_call` row is `event_priced` = tokens × the price card;
- 0 `reserved` credits.

## 5. ⛔ Safe retry / resume acceptance (zero-Apify, model only)

Run each scenario as its own queue row, then:

```sh
psql "$TEST_DB_URL" -X -v queue_id='<QUEUE_ID>' -f scripts/test-project/acceptance/retry-resume-evidence.sql
```

| Scenario | How | PASS |
|---|---|---|
| **5a. Worker lost mid-mission** | Dispatch the worker; once the log shows the mission claimed, **cancel the workflow run**. Re-dispatch. | R01–R07 PASS: the second session re-claims the same queue row and task; no logical call bought twice; ≤ 4 model calls in total; one terminal; nothing left reserved |
| **5b. Authorization changed between claims** | During 5a's pause, remove the requester's `workspace_members` row (⛔ hosted write, then restore it) | The re-claim ends `pre_effect_guard:principal_not_member` (R08 = 1); no new ledger, credit or model rows after the removal |
| **5c. Pilot marker on the stored task** | Not run on TEST: proven offline. A real pilot task cannot be created there while P1–P8 are off | covered by `legacyPreEffectGuard.contract` and its mutation proofs |

5a also re-proves crash-recovery credit accounting (the #153/#154 paths) with real processes, at model-only cost.

## 6. Final A7 readiness review

A7 is **GO** only when every row below is PASS **on one dispatch SHA**:

| Gate | Source |
|---|---|
| A1–A8 offline gates on the dispatch SHA, **including a green edge suite** (#181) | `discovery-a7-scenario-report.md` matrix |
| Merges: the eight PRs plus #181 and #179; then re-validation on the merged head | approval package |
| Steps 1–5 above PASS (manual rows R4 and M6 signed) | this pack |
| E1–E5 PASS | §0 |
| Billing migrations: applied to TEST, or waived in writing, for the paid run | `held-billing-fixes-approval.md` |
| Paid A7 (≈ $0.25) authorized separately, with E1's account and E4's prices | owner |

Phase 1 (pilot/client) stays FAIL independently. Client-scoped research is
refused by the guard until the client contract is agreed and integrated
(`client-scoped-lead-research-plan.md`).
