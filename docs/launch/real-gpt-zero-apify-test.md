# Zero-Apify real-GPT test (hosted TEST)

**Purpose.** The first test with a real model. It proves four things before any
paid provider runs:

| | Question |
|---|---|
| **I** | Agentory interprets the A7 mission correctly |
| **P** | It builds an appropriate research plan |
| **R** | It respects the provider restriction: **zero Apify starts** |
| **M** | It records model spending accurately |

> **For the first run use `agency-test-operator-checklist.md` (Candidate B):**
> its source, migrations, seed, providers-off rehearsal and commands replace
> the prerequisites and steps here. The PASS criteria below are unchanged.

**Not approved by this document.** Each step marked ⛔ needs its own explicit
approval. Nothing here merges, deploys, migrates or buys from Apify.

## Bounds

| | Bound | Enforced by |
|---|---|---|
| Apify | **0 starts, 0 reads** | (1) no Apify token on the worker; (2) both actors authorized for **0 starts**, so the gate refuses each start before sending |
| Mission compilation (preparer) | `gpt-5.6-luna` only, ≤ 2 requests, ≤ 30,720 bytes, ≤ 4,000 output tokens: **≤ $0.025 committed**, ≈ $0.006 expected | `lunaOnlyFetch` in `prepareKickoff.ts` (Terra escalation refused) |
| Worker model calls | `gpt-5.6-luna`, ≤ 4 attempts × 12,480 µ$: **≤ $0.0499 committed**, ≈ $0.006 expected (one planner call) | smoke admission (`model_attempt_limit`, template bounds), `MODEL_SPEND_CEILING_USD=0.05` |
| Total worst case | **≤ $0.075**, then the OpenAI project's hard budget | |
| Credits | Reserved and refunded; balance unchanged | gate refusal = definite non-start |
| Time | 300 s from the queue row | authorization deadline, mission wall clock |

## Prerequisites (all must hold)

- The dispatch commit of `agency-test-operator-checklist.md` (Candidate B: #188 + #189 + #190 with TEST-only tooling). #145, #150, #154 and #158 are inside it; #144, #149, #153, #156 and #157 are not needed for this test.
- The worker is **not deployed**: it is one bounded GitHub Actions session, `.github/workflows/discovery-test-worker.yml` (manual dispatch, Environment `discovery-test` behind a required reviewer). It already sets `DISCOVERY_SMOKE_ADMISSION=enforce`, `LEAD_V2_SMOKE_WALL_CLOCK=enforce`, `LEAD_V2_SMOKE_ORCHESTRATION=minimal`, `LEAD_CREDIT_ENFORCEMENT=enforce`, `MODEL_SPEND_ENFORCEMENT=enforce`, `MODEL_SPEND_CEILING_USD=0.05`, `MODEL_SPEND_PERIOD_DAYS=1`, `LEAD_STRATEGIST_PROVIDER=openai`, and `LEAD_V2_WORKER_WORKSPACES=${vars.TEST_WORKSPACE_ID}`.
  - Environment `discovery-test`: vars `TEST_PROJECT_REF` and `TEST_WORKSPACE_ID`; secrets `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, `TEST_SUPABASE_ANON_KEY` and `TEST_OPENAI_API_KEY`.
  - `TEST_APIFY_API_TOKEN`: it exists today (2026-10-26). It reaches the worker step only for `providers` = `openai-and-apify`; with `openai-only` or `none` the step receives an empty value, unsets it, and Deno denies `api.apify.com:443`. An absent token makes every Apify start `apify_not_configured` at the tool layer.
  - The worker's commit is the commit the workflow is dispatched on; the run page shows it. Dispatch it on the merged dispatch SHA.
- OpenAI: a dedicated TEST project with an **enforced** cap — Project → Limits → Spend with **"Enforce a hard limit" on** (requests then fail with 429 `project_spend_limit_exceeded`), or prepaid credits with auto-reload off. A budget alert is **not** a cap, and OpenAI states enforcement is not instantaneous: it is the backstop; the code-enforced bound ($0.07488) is the cap. `gpt-5.6-luna` available to the key, and its price read within 24 h ($0.20 in, $0.02 cached, $1.20 out per 1M; cache writes $0.25 for 30 min, $0.50 for 12 h — the 12-hour write needs `prompt_cache_retention`, which both gates refuse).
- Observed Apify prices for both templates, read within 24 h and written into the authorization. They are never charged here (0 starts), but `authorize_discovery_smoke` refuses a template without an observed maximum, and nothing is invented.
- The billing migrations stay **held**. This test buys nothing; the preflight reports them as INFO.

## Step 1 — Preflight (read-only)

```sh
psql "$TEST_DB_URL" -X -v workspace_id='<TEST_WORKSPACE_ID>' -f scripts/test-project/real-gpt/preflight.sql
```

| Check | Expected |
|---|---|
| P01–P04 | held admission and V2 queue objects present; service-role grants exact |
| P07 | no cron job calls a hosted project |
| P08–P10 | the workspace exists with the Scout agent, **exactly 10** credits (the judge's R3 baseline), 0 reserved, **no Company Brain** |
| P15–P16 | the three held security migrations: four triggers; service_role cannot update/delete/truncate memberships |
| P17 | INFO: client schema installed or not (not needed) |
| P11–P13 | no open liability, no live authorization, nothing claimable in the queue |
| P14 | model-call rows must name their model |
| P05–P06 | INFO: billing migrations installed or not (decision) |

Also confirm a member of the test workspace exists to own the plan row (`--user`):

```sql
select m.user_id from public.workspace_members m where m.workspace_id = '<TEST_WORKSPACE_ID>' limit 1;
```

**Any FAIL: stop.**

## Step 2 — ⛔ Prepare the kickoff (the one model call outside the worker)

```sh
OPENAI_API_KEY=<TEST project key> deno run --allow-env --allow-net=api.openai.com --allow-read --allow-write=./real-gpt-run \
  scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts \
    --approved-by "<name, date>" --out ./real-gpt-run \
    --workspace <TEST_WORKSPACE_ID> --user <TEST_USER_ID> --pricing-version <v> \
    --jobs-max <µ$> --details-max <µ$> --observed-at <ISO> --price-source "<where read>"
```

- It writes `kickoff.sql`, `kickoff.json` and `interpretation.txt`, and connects to no database.
- It prints I1–I9 and the compile's token counts and cost, and exits 1 if any interpretation check fails. **A misread mission is never queued.**
- Review `kickoff.sql`: the plan row, the compile's ledger row, the queue row (`queued`), and `authorize_discovery_smoke(…, {"apify:harvestapi~linkedin-job-search": 0, "apify:harvestapi~linkedin-company": 0}, 300)`.

## Step 3 — ⛔ Start the worker, then run the kickoff transaction (starts the 300 s clock)

Dispatch `discovery-test-worker.yml` from the owner-allowed ref (`confirm_project_ref` = `TEST_PROJECT_REF`, `session_minutes` = 10, `expected_sha` = the dispatch commit, refused otherwise, `providers` = `openai-only`, the default: the worker step then unsets any Apify token and Deno denies `api.apify.com:443`, so Apify is unreachable even if the secret exists). Once the job is running (the worker idles; nothing is queued):

```sh
psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f ./real-gpt-run/kickoff.sql     # as an administrator
```

The worker claims the row. Watch the worker log for `[smoke-admission] sent`
(model) and the job-search refusal. Emergency stop at any time:
`select public.stop_discovery_smoke('<queue_id>', 'operator stop');`.

## Step 4 — Judge (read-only)

Once the queue row is `complete`/`failed` and the authorization is no longer live:

```sh
psql "$TEST_DB_URL" -X -At -v queue_id='<queue_id>' -f scripts/test-project/real-gpt/real-gpt-evidence.sql > ./real-gpt-run/evidence.json
deno run --allow-read scripts/test-project/real-gpt/judge-real-gpt-run.ts ./real-gpt-run/evidence.json
```

## PASS criteria (25; automatic unless marked)

| # | Criterion |
|---|---|
| I1 | `requested_count` = 1 |
| I2 | one hard industry criterion naming "B2B software" |
| I3 | one hard geography criterion: United States, scope **headquarters** |
| I4 | one hard company-size criterion 11–50 |
| I5 | one hard hiring criterion with role term "account executive", window 30 days |
| I6 | no hard criterion the request does not state |
| I7 | broadening disallowed for geography, role, size |
| I8 | contact_enrichment and founder_discovery prohibited |
| I9 | no hard hiring role term or family beyond the requested one, in the criteria **and** in the fields the runtime reads (`required_signals[].role_families`, `qualifier.role_terms`), top-level and qualifier families equal, and no excluded role that rules the requested role out (added after the independent review of PR #194; I1–I8 unchanged) |
| P1 | the plan is `model_validated` with no violations (the real model planned; no deterministic fallback) |
| P2 | every provider step uses an approved actor |
| P3 | the first purchase is job_discovery on the job-search actor: ["Account Executive"], ["United States"], ≤ 3 items, posted "month" |
| P4 | the plan qualifies companies before persisting |
| R1 | no provider purchase or read admitted |
| R2 | no provider call names a run |
| R3 | every credit refunded; balance unchanged; 0 reserved |
| R4 | **MANUAL**: the Apify console shows no run in the window |
| M1 | 1–4 model calls admitted, each committed at 12,480 µ$, total ≤ 50,000 µ$ |
| M2 | one ledger row per admitted model call, plus one for the compilation |
| M3 | every model row names `gpt-5.6-luna` and its token counts |
| M4 | every row `event_priced` = tokens × the price card, exactly |
| M5 | recorded run spend ≤ committed |
| M6 | **MANUAL**: OpenAI's usage for the TEST project and window equals the ledger's token totals; billed cost ≤ ledger + $0.05/1M × input tokens (the price card has no cache-write rate) |
| T1 | exactly one terminal verdict (`budget_exhausted` is the expected, honest one: nothing was bought) |
| T2 | nothing persisted or qualified |
| T3 | the credit check lists nothing |

**PASS** = every automatic row PASS **and** R4 and M6 signed off. Then stop the
authorization (if still active) and run Step 1 again: P11–P13 must hold.

Reconciliation (read-only, per mission):

```sh
psql "$TEST_DB_URL" -X -v queue_id='<queue_id>' -f scripts/test-project/smoke-reconciliation.sql
psql "$TEST_DB_URL" -X -v queue_id='<queue_id>' -f scripts/test-project/smoke-credit-reconciliation.sql
```

## Evidence that this procedure works (offline, model scripted)

- `tests/realprocess/workerKill.rehearsal.ts`, "the zero-Apify real-GPT kickoff": the preparer (with its compile gate) → `psql` runs `kickoff.sql` → a **real worker process** claims and runs it → evidence → judge: 23 PASS, 2 MANUAL, 0 FAIL; no Apify request; no forbidden host.
- `realGptJudge.contract`: the model-only run passes; runs that buy from Apify, mispriced or missing model rows, and a misread mission each fail. The no-token variant passes.
- `realGptPreflight.contract`: a prepared workspace passes; undetached hosted cron jobs, a claimable queue row and a reserved credit each fail.
- `realGptCompileGate.test`: Terra, oversized requests, larger output bounds, other vendors and a third call are refused before sending.

## Known limits

- A scripted model can only rehearse **P1**. The real test is what shows whether Luna's plan validates on the first try.
- The ledger estimates model cost from tokens. OpenAI returns counts, not a charge, so M6 is the only check against the bill.
- With no Apify token, the gate's zero-start refusal is not exercised live; the tool refuses first (`apify_not_configured`). The refusal is proven offline (`modelOnlySmoke`, the real-process rehearsal), and the paid A7 exercises it with real limits.
