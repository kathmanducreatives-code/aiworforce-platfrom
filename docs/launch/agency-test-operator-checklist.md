# Agency-only TEST — consolidated operator checklist (Candidate B)

The one procedure for the first controlled Agentory mission on the hosted TEST
project: **read-only preflight (A) → TEST-only setup and providers-off
rehearsal (B) → separately authorized real-GPT, zero-Apify run (C).** Each
lettered block needs its own explicit owner approval; nothing here merges,
deploys, touches production, changes a GitHub Environment, enables a flag or
starts an Apify actor.

It supersedes the prerequisites of `real-gpt-zero-apify-test.md` and steps 1–3
of `test-acceptance-pack.md` for this run. Their PASS criteria (I/P/R/M/T) are
unchanged and are applied by the judge.

## Source

| | |
|---|---|
| **Dispatch and tooling commit** | the head of `test/agency-candidate-b-operator` (record the 40-character SHA; it is the `expected_sha` below) |
| Runtime (`supabase/functions`, `worker`) | byte-identical to Candidate B `0cbe2f31` and to `336e7107` (full CI [40284128653](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40284128653): 17/17, 134/134 mutants, real workers 4/4) |
| Candidate B = | #188 `508d438f` + #189 `5c2ff318` (PLAN-PARENT, EXEC-EFFECT, on #179 `08351242`) + #190 `949a2c5e` (MEMBER-SURFACE; #186 held source arrives as a dependency) |
| Added on this branch (TEST-only) | workflow `providers: none` and `expected_sha`; `install-held-security.sh` / `--with-held-security`; `seed-agency-test.sql`; preflight P09 (exactly 10 credits), P15–P17; providers-off judge; stricter preparer compile gate |

Never use `npm run supabase:test`, a generic `supabase db push` or the CLI's
config defaults for this run: `scripts/supabase-target.mjs` maps "test" to the
live project. Every command below names `TEST_DB_URL` explicitly, and the
scripts refuse the live (`ohsdatpvfdjdemstoiuj`) and abandoned
(`wqnigjhcwjxtmordrwno`) refs.

## TEST configuration

| Item | Value / requirement |
|---|---|
| Project | `TEST_PROJECT_REF` = `tlvnfrxzjhsjgdofwehb` (Environment variable; re-read it in A) |
| Workspace | `TEST_WORKSPACE_ID` = `40e2512f-09b6-433e-97fe-f9999a1f1897`; synthetic; **no Company Brain row** |
| User | one Supabase Auth user (`TEST_USER_ID`, a v4 UUID created by Auth, never by SQL), owner of the workspace |
| Credits | **exactly 10**, 0 reserved (the judge's R3 baseline) |
| Flags | none. Client Brains, readiness and pilot flags stay off; client and pilot markers are refused at every entry |
| Worker | `discovery-test-worker.yml`, one bounded session, Environment `discovery-test` behind its required reviewer |
| Model | `gpt-5.6-luna` only (Terra refused by both gates) |
| Apify | 0 starts, 0 reads, $0: no token reaches the worker step unless `providers = openai-and-apify` (never in this checklist), Deno denies `api.apify.com:443`, and the authorization allows 0 starts |

### Migrations (exactly these)

On an **empty** project, the guarded builder applies 56 files:

```
TEST_PROJECT_REF=<ref> TEST_DB_URL=<url> scripts/test-project/build-test-schema.sh \
  --confirm <ref> --with-held-admission --with-test-no-brain-guard --with-held-security
```

1. held baseline `20260816120000`;
2. the 45 shipped `supabase/migrations/*` (cron-scheduling files committed only together with the detach);
3. held Lead V2 chain `20260910140000`, `20260915120000`, `20261003120000`, `20261011120000`, `20261019120000`;
4. held admission `20261015140000_discovery_smoke_admission`;
5. test-only `scripts/test-project/sql/20261017120000_discovery_test_no_company_brain.sql`;
6. **security** (after the commit boundary's read-only preflight): `20261025130000_tasks_commit_boundary`, `20261025150000_task_plans_parent_identity`, `20261025160000_workspace_members_app_surface`.

On a project that **already has 1–5** (preflight P01–P04 PASS), only step 6:

```
TEST_PROJECT_REF=<ref> TEST_DB_URL=<url> scripts/test-project/install-held-security.sh --confirm <ref>
```

It refuses a partial installation and reports "already installed" when all
four triggers exist. **Not applied:** the billing pair (`20261015120000`,
`20261015130000`), `20260912160000`, client Brain `20261024160000`, membership
writers `20261025140000`, OWN-01 `20261025120000`, and every client or pilot
migration. Any other state (a project that is neither empty nor 1–5): stop.

## Spend: what is enforced, and the verified maximum

| Layer | Enforced by | Bound |
|---|---|---|
| Preparer (step C2) | `lunaOnlyFetch`: Luna only, ≤ 2 requests, ≤ 30,720 bytes, ≤ 4,000 completion tokens, text-only field allowlist, `n = 1` | 2 × $0.01248 = **$0.02496** |
| Worker | durable smoke admission (`DISCOVERY_SMOKE_ADMISSION=enforce`): a committed admission per request against the queue row's authorization; Luna template ≤ 30,720 bytes, ≤ 4,000 `max_completion_tokens`, text-only allowlist (no `prompt_cache_retention`, tools, media), `n = 1`; ≤ 4 attempts; Apify 0 starts | 4 × $0.01248 = **$0.04992** |
| **Total, code-enforced** | | **$0.07488** (expected ≈ $0.006–0.012) |
| Vendor backstop | OpenAI project **"Enforce a hard limit"** (429 `project_spend_limit_exceeded`) or prepaid credits with auto-reload off (`credit_balance_exhausted`) | owner evidence required (A6) |

Per call: 30,720 input tokens at most (a token is at least one byte of the
request body), priced at $0.25/1M, the dearest admissible input rate (OpenAI's
30-minute cache write; the $0.50/1M 12-hour write needs `prompt_cache_retention`,
which both gates refuse; long-context prices start above 272K tokens) =
$0.00768, plus 4,000 output tokens (reasoning included) at $1.20/1M = $0.0048.
Prices verified on OpenAI's pricing page on 2026-10-26: input $0.20, cached
$0.02, output $1.20, cache write $0.25 (30 min) / $0.50 (12 h) per 1M.

An OpenAI **budget alert is not a cap**. OpenAI states that hard-limit
enforcement "is not instantaneous, so recorded spend can slightly exceed the
configured amount"; it is the backstop, the code bound is the cap.

---

## A. ⛔ Read-only hosted preflight (Approval A)

Writes nothing. Every database command runs in a read-only session
(`PGOPTIONS='-c default_transaction_read_only=on'`: any write is refused by
Postgres itself).

```sh
export PGOPTIONS='-c default_transaction_read_only=on'
export TEST_DB_URL='postgresql://…tlvnfrxzjhsjgdofwehb…'      # the TEST project only
WS=40e2512f-09b6-433e-97fe-f9999a1f1897
```

| # | Check | Command | Expected |
|---|---|---|---|
| A1 | Inventory | `psql "$TEST_DB_URL" -XAtc "select current_database(), (select count(*) from information_schema.tables where table_schema='public'), (select string_agg(tgname, ',') from pg_trigger where not tgisinternal and tgname in ('tasks_commit_boundary','task_plans_parent_identity','workspace_members_app_surface','workspace_members_app_surface_truncate'))"` | records which path B1 takes: 0 tables (empty) or the existing schema |
| A2 | Preflight | `psql "$TEST_DB_URL" -X -v workspace_id=$WS -v project_ref=$TEST_PROJECT_REF -f scripts/test-project/real-gpt/preflight.sql` | before B: record. After B: P00–P04, P07–P16 PASS; P05/P06/P17 INFO |
| A3 | Schema | `psql "$TEST_DB_URL" -X -v workspace_id=$WS -v user_id=<TEST_USER_ID> -f scripts/test-project/acceptance/schema-verify.sql` | S01–S05, S08 PASS; S06/S07 INFO |
| A4 | Commit boundary | `psql "$TEST_DB_URL" -X -At -F ' ' -f scripts/test-project/tasks-commit-boundary-preflight.sql` | last line `OK`; no `BLOCK` |
| A5 | Environment (GitHub, owner) | Settings → Environments → `discovery-test` | required reviewer; admins cannot bypass; branch policy; secret and variable **names** (Codex snapshot 2026-10-26: only `launch/hardening` allowed; `TEST_APIFY_API_TOKEN` exists) |
| A6 | OpenAI (owner) | Project → Limits → Spend; Billing | "Enforce a hard limit" **ON** at ≤ $5 on a project used only by the TEST key, **or** prepaid with auto-reload **off**; record a screenshot |
| A7 | Model availability (free) | `curl -sS https://api.openai.com/v1/models/gpt-5.6-luna -H "Authorization: Bearer $TEST_OPENAI_API_KEY"` | HTTP 200 naming `gpt-5.6-luna` (a model lookup is not billed) |
| A8 | Prices | OpenAI pricing page, within 24 h of C | Luna $0.20 / $0.02 / $1.20; cache write $0.25 (30 min) |
| A9 | Apify prices (read only) | the new Apify account's actor pages | observed maxima for both templates, read within 24 h of each kickoff (the authorization refuses a template without one; nothing is bought) |

**Stop** on: a production ref anywhere; a `BLOCK`; a schema that is neither
empty nor the standard 1–5; a Company Brain row in the workspace (never delete
it, choose another synthetic workspace); open liability (P11); a claimable
mission (P13).

## B. ⛔ TEST-only setup and providers-off rehearsal (Approval B)

Writes to the TEST database and dispatches the worker with **no model and no
vendor key**. Costs $0.

**B0. Owner: allow the dispatch commit.** The Environment currently allows only
`launch/hardening`. Either add a deployment branch policy for exactly
`test/agency-candidate-b-operator` (owner's change in Environment settings;
the required reviewer stays; protect the branch against pushes and force-pushes
for the test's duration), or integrate the reviewed PRs into `launch/hardening`
and re-run CI on the resulting SHA. Running the worker anywhere else with TEST
secrets would bypass the reviewer: never do it.

**B1. Schema.** Empty project: the builder with `--with-held-security`.
Existing standard schema: `install-held-security.sh`. Then A2 again: P15 = 4,
P16 = ok.

**B2. Seed** (after creating the Auth user in the Supabase dashboard if needed):

```sh
unset PGOPTIONS
psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -v workspace_id=$WS -v user_id=<TEST_USER_ID> -f scripts/test-project/seed-agency-test.sql
```

It prints `member role owner`, `scout agent 1`, `credits balance=10, reserved=0`.
Then A2 with `PGOPTIONS` again: **0 FAIL**.

**B3. Prepare the providers-off kickoff** (no network, 0 model calls):

```sh
deno run --allow-env --allow-read --allow-write=./run-off scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts \
  --approved-by "<name, date>" --out ./run-off --workspace $WS --user <TEST_USER_ID> \
  --pricing-version <v> --jobs-max <µ$ from A9> --details-max <µ$ from A9> --observed-at <ISO> --price-source "<where read>" \
  --proposal docs/launch/proposals/a7-reviewed-mission-proposal.json
```

Exit 0 with I1–I9 PASS. Review `run-off/kickoff.sql`: plan row, queue row
`queued`, and `authorize_discovery_smoke(…, '{"apify:harvestapi~linkedin-job-search":0,"apify:harvestapi~linkedin-company":0}'::jsonb, 300)`.
Note the queue id (`grep -A1 'insert into public.lead_mission_queue' run-off/kickoff.sql`).

**B4. Dispatch, approve, then kick off** (the 300 s clock starts at the kickoff):

```sh
gh workflow run discovery-test-worker.yml --ref test/agency-candidate-b-operator \
  -f confirm_project_ref=tlvnfrxzjhsjgdofwehb -f session_minutes=5 -f providers=none -f expected_sha=<SHA>
```

The reviewer approves only after checking, on the run page: the commit is
`<SHA>`, `providers` is `none`. The guard step refuses any other commit. Once
the worker step is running:

```sh
psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f ./run-off/kickoff.sql
```

**B5. Watch** (read-only, every 15 s, at most 300 s):
`psql "$TEST_DB_URL" -XAtc "select status, last_outcome->>'status' from public.lead_mission_queue where id = '<queue_id>'"`.

**B6. Evidence and judge** (read-only):

```sh
export PGOPTIONS='-c default_transaction_read_only=on'
psql "$TEST_DB_URL" -X -At -v queue_id='<queue_id>' -f scripts/test-project/real-gpt/real-gpt-evidence.sql > ./run-off/evidence.json
deno run --allow-read scripts/test-project/real-gpt/judge-real-gpt-run.ts --providers-off ./run-off/evidence.json
psql "$TEST_DB_URL" -X -v queue_id='<queue_id>' -f scripts/test-project/smoke-reconciliation.sql
psql "$TEST_DB_URL" -X -v queue_id='<queue_id>' -f scripts/test-project/smoke-credit-reconciliation.sql
```

**B PASS** = judge O1–O7 PASS: queue `failed`, terminal `unhandled_exception`
(this candidate lacks #149, so a missing planner key is not yet classified as a
refusal), 0 admitted operations, 0 ledger rows, credits 10 / 0, 0 leads; both
reconciliations 0 rows; the Actions log shows `providers: none` and exit 0/124.

**B7. Close the authorization** (it stays `active` until its deadline, and
preflight P12 fails while it is live): wait 300 s from the kickoff, or
`unset PGOPTIONS; psql "$TEST_DB_URL" -XAtc "select public.stop_discovery_smoke('<queue_id>', 'providers-off rehearsal complete')"`.
Then A2: **0 FAIL**.

**Stop** (any step): a preflight FAIL; the judge FAILs; any model or provider
row; any credit held; the queue not terminal 300 s after the kickoff →
`select public.stop_discovery_smoke('<queue_id>', 'operator stop');` then
`gh run cancel <run-id>`; report, and do not request C.

## C. ⛔ Real-GPT, zero-Apify run (Approval C, separate)

Requires: **B PASS**, **A6 evidence of an enforced vendor cap**, A7 and A8
re-read within 24 h. Without A6 the paid run is **NO-GO**.

**Maximum possible cost: $0.07488** (preparer $0.02496 + worker $0.04992);
Apify $0.00. Expected ≈ $0.006–0.012.

**C1.** A2 with `PGOPTIONS`: 0 FAIL (P09 10/0, P12 0, P13 0).

**C2. Prepare** (the one model call outside the worker; ≤ 2 requests):

```sh
OPENAI_API_KEY=<a key of the capped TEST project> deno run --allow-env --allow-net=api.openai.com --allow-read --allow-write=./run-gpt \
  scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts \
    --approved-by "<name, date>" --out ./run-gpt --workspace $WS --user <TEST_USER_ID> \
    --pricing-version <v> --jobs-max <µ$> --details-max <µ$> --observed-at <ISO> --price-source "<where read>"
```

It prints I1–I9 and the compile's tokens and cost and exits 1 on any
misreading (**a misread mission is never queued**). Review `run-gpt/kickoff.sql`:
the plan row, the compile's ledger row, the queue row, the zero-start
authorization.

**C3. Dispatch** with `providers=openai-only`, `session_minutes=10`,
`expected_sha=<SHA>`; the reviewer checks commit and inputs; once running,
`psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f ./run-gpt/kickoff.sql`.

**C4. Evidence and judge** as B6 without `--providers-off`, into `./run-gpt`.

**C PASS** = 24 automatic rows PASS (I1–I9, P1–P4, R1–R3, M1–M5, T1–T3; the
honest terminal is `budget_exhausted`, 0 leads) **and** the owner signs:
- **R4**: the Apify console shows no run in the window;
- **M6**: OpenAI usage for the project and window equals the ledger's token
  totals; billed ≤ ledger + $0.05/1M × input tokens (cache writes at $0.25 vs
  the ledger's $0.20 input rate).

Both reconciliations 0 rows; credits 10 / 0. Then B7 for this queue id and A2:
0 FAIL. Retain `run-gpt/`, the judge output and the Actions run URL.

**Stop** (any step): the preparer exits 1 or reports a cost above $0.025; any
Apify request; a model call other than Luna; the queue not terminal at 300 s
(stop + cancel as in B); any judge FAIL. **No retry** without a new approval;
the paid A7 with Apify is a separate decision.

## Rollback

1. **Mission:** `stop_discovery_smoke('<queue_id>', 'operator stop')`, `gh run cancel <run-id>`, confirm the queue is terminal, no live authorization (P12), no liability (P11), 0 reserved credits. Never delete ledger, queue, task or evidence rows.
2. **Dispatch policy:** the owner removes the temporary branch policy after the test.
3. **Security SQL:** prefer leaving it installed (backward compatible). Removing it reopens access: the down scripts restore service_role UPDATE/DELETE/TRUNCATE on memberships. Only with a separate approval, in reverse order, each in one transaction:
   ```sh
   for m in 20261025160000_workspace_members_app_surface 20261025150000_task_plans_parent_identity 20261025130000_tasks_commit_boundary; do
     psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations-held/rollback/$m.down.sql || break
   done
   ```
   (Round trip proven locally: down ×3, then `install-held-security.sh` restores the exact triggers and grants.)
4. Never run a blanket rollback, never remove the admission, V2 or baseline schema from a hosted project, never erase TEST data.

## Approvals at a glance

| | Writes | Paid | Needs |
|---|---|---|---|
| **A** read-only preflight | none (read-only sessions) | $0 | TEST DB URL; owner reads Environment, OpenAI limits, prices |
| **B** setup + providers-off | TEST schema (security SQL), seed, kickoff, `stop_discovery_smoke`; one worker session with no keys | $0 | owner's B0 dispatch-policy decision |
| **C** real-GPT zero-Apify | kickoff, compile ledger row, stop | ≤ **$0.07488** | B PASS + A6 vendor-cap evidence |

## Evidence (local, no network, no paid call)

On `test/agency-candidate-b-operator`, against databases built by this
branch's own builder: the full sequence on **one** database — build (56) →
seed → preflight 0 FAIL → providers-off judge PASS (0 vendor requests) →
preflight P12 FAIL until stopped → stop → preflight 0 FAIL → scripted-GPT
zero-Apify judge 23/23 PASS, R4/M6 manual (0 Apify, 0 forbidden) → final
preflight 0 FAIL; credits 10 / 0 throughout. Installer, seed and rollback
paths, and every refusal, exercised on real databases. Fixtures:
`tests/edge-functions/_shared/fixtures/{providers-off,scripted-gpt}-evidence.json`.
