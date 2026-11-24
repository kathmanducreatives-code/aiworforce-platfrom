# A7 adversarial scenario campaign — Discovery Engine V1

Base: `launch/hardening` @ `24b19bd6` (#100–#106, #108 merged), verified remote
head 2026-10-19. Offline only: disposable localhost Postgres 17.11 + PostgREST
16.4, synthetic prices, fake Apify/OpenAI. No hosted database, vendor, workflow
or spending authorization was touched. **A7 remains NO-GO.**

## How it runs

`tests/db-contract/lib/discoveryScenario.ts` drives the **real** path:
- the reviewed mission, compiled offline by the real compiler;
- authorized over the final kickoff by the real `authorize_discovery_smoke`;
- run by the real worker runner and `run-agent` handler;
- through the real admission gate, credits, ledger and persistence.

Only the vendor responses are scripted: job rows, a company record per URL, and
faults.

Negative qualification scenarios use a **credulous** model stand-in. It passes
every requirement while citing real excerpts, which tests whether the
deterministic checks alone stop a false qualification. Positive scenarios use
an **honest** stand-in.

```bash
PG_ADMIN_URL=postgres://postgres@127.0.0.1:<port>/postgres POSTGREST_BIN=<postgrest> \
  tests/db-contract/run.sh tests/db-contract/a7Qualification.contract.test.ts \
    tests/db-contract/a7Reliability.contract.test.ts tests/db-contract/a7Lifecycle.contract.test.ts
# The known false qualifications (skipped by default):
A7_AUDIT_KNOWN_GAPS=1 tests/db-contract/run.sh tests/db-contract/a7Qualification.contract.test.ts
```

## Scenario matrix

**Status:** PASS = expected behaviour observed · FAIL = defect reproduced ·
FIXED = failed, fixed in this PR · COVERED = pinned by a named existing test,
re-run here · NOT TESTED = outside offline reach.

### A. Qualification

Every row also held the A7 bounds: ≤ 4 model attempts, ≤ 5 reads, one start per
actor, a vendor cap on every start, ≤ $0.05 model, ≤ $0.20 provider, ≤ $0.25 total.

| # | Scenario | Expected | Actual on 24b19bd6 | Status |
|---|---|---|---|---|
| S01 | US B2B SaaS, 11–50, AE 10 d | 1 qualified | 1 qualified, all 4 hard checks pass, 1 lookup, `completed` | PASS |
| S02 | Canada HQ + US office | 0 | 0 (geography rejected after lookup) | PASS |
| S03 | no location records | 0 | 0 | PASS |
| S03b | US office, **no HQ flag** | 0 | **1 qualified** (`geography: pass`) | **FAIL**: Codex HQ work |
| S04 | 201–500 band | 0 | 0, rejected before any lookup was bought | PASS |
| S05a/b | band unknown / posting 11–50 vs record 201–500 | 0 | 0 / 0 | PASS |
| S06 | posted 45 d ago | 0 | 0 | PASS |
| S07 | posted 5 d in the **future** | 0 | 1 qualified on 24b19bd6; **0 after #109** (merged) | **PASS** (fixed by #109) |
| S08a/b | 29 d 23 h / 30 d 1 h (UTC) | 1 / 0 | 1 / 0 | PASS |
| S08c | date-only, exactly 30 calendar days | deterministic | 0: a bare date is read as 00:00 UTC, so "30 days" is exclusive after midnight | PASS (P3 note) |
| S08d | same instant as `+05:45` offset | 1 | 1 | PASS |
| S09 | `jobState: CLOSED`, `closedAt` set | 0 | 0, rejected before lookup | PASS |
| S10 | **SDR** posting, no AE | 0 | **1 qualified**, also with the **honest** model (S10b) | **FAIL**: new P1, reported on #109 |
| S11 | B2C company, posting says "B2B" | 0 | 0 | PASS |
| S12 | 3 postings, one employer | 1 lookup, 1 lead | 1 lookup, 1 lead row | PASS |
| S13 | company record has **no description** | 0 | **1 qualified**, both models (S13b) | **FAIL**: Codex provenance work |
| S14 | posting US HQ vs record Canada HQ | 0 | 0 | PASS |
| S15 | 3 candidates, none qualifying | 0, truthful | 0, `search_exhausted`; with the fix below, one real lookup | PASS |

### B. Provider reliability

| # | Scenario | Actual | Status |
|---|---|---|---|
| S16 | job-search start 402 / 403 | 1 admitted purchase, no run id, 0 reads, credit `not_charged`, cause `apify_insufficient_credits` / `apify_unauthorized` recorded, 0 leads | PASS |
| S17 | status never readable | run id kept, 2 reads, no dataset read, never re-bought, credit charged (a run exists) | PASS |
| S18a | malformed dataset JSON | 0 leads, no lookup, recorded as **`empty`** (indistinguishable from a real empty search) | PASS (P2 note) |
| S18b | postings without employer record | dropped (`no_employer_linkedin_url`), no lookup | PASS |
| S18c | empty company record | 0 qualified | PASS |
| S19 | empty dataset | no lookup, `empty` | PASS |
| S20 | run never finishes | ≤ 3 status reads, no dataset read, nothing more bought | PASS |
| S21 | every runtime model call times out | ≤ 4 attempts, each committed at 12,480 µ$, no provider purchase, task ends `unhandled_exception` | PASS (P3 note) |
| S22 | model proposes **Canada** | compiled mission keeps United States | PASS |
| S23 | 8 concurrent starts | one POST, one credit held | COVERED: `discoveryReliability` "concurrent uncertain actor starts share one purchase" (#106) |
| S24 | success after ownership lost | uncertain, held, never re-bought; in-flight model aborted | COVERED: `discoveryReliability` "ownership loss during an Apify POST", "ownership_lost interrupts an already admitted model request" (#106) |
| S25 | 10 postings, 10 employers | **before the fix: gate refused our own company-details request (`array_unbounded:companies`), 0 leads**; after: 1 lookup, 1 qualified | **FIXED** (P1) |
| S25b | 3 postings, 3 in-band employers (the normal A7 case) | before: refused, 0 leads; after: 1 lookup of 1 company, 1 qualified | **FIXED** (regression) |

### C. Lifecycle and consistency

| # | Scenario | Evidence | Status |
|---|---|---|---|
| S26 | crash after admission, before start | `smokeAdmissionRuntime` "apify: an uncertain start keeps its credit HELD and is never bought again", "read lifecycle: a replay of an uncertain start … keeps its credit HELD" | COVERED |
| S27 | crash after a run id | `discoveryReliability` "failed resume read (402/403/429/500/0/200) cannot forget or refund an existing purchase" (#106) | COVERED |
| S28 | 5 expired claims, 6th refused | `leadMissionExhaustedLease` regression (#108); ends `failed`, no sixth attempt | COVERED |
| S29 | two workers recover one exhausted mission | both refused a claim; row ended `failed` once | PASS (new) |
| S30 | deadline after a lead is persisted | the lead stands, still qualified; a late admission → `stopped`. The deadline-only refusal itself is pinned by `smokeAdmission` "deadline: absolute, from the queue row, read after the lock, never renewed" | PASS (new) + COVERED |
| S31 | partial / duplicate result writes | `fencedWrite` (stale generation fenced, finalized row fenced, end-to-end D1) | COVERED |
| S32 | stale worker on a completed mission | heartbeat refused, release refused, never re-claimed, outcome unchanged | PASS (new) |
| S33 | completed, but dashboard retrieval fails | not reachable offline: hosted RLS and browser rendering | NOT TESTED |
| S34 | open liabilities at the end | both purchases listed by `smoke-reconciliation.sql`; a new authorization refused (`unreconciled`); credits charged once each | PASS (new) |
| S36 | worker SIGKILLed between a paid start and its execution-ledger run id | `killResumeAdoption` (11 contracts) and the real-process rehearsal (`tests/realprocess/`): the next generation adopts the run through a verified gate answer, reads it once, `completed`, 1 qualified, credits charged once, nothing refunded or held. Tampered or incomplete evidence (no run or dataset id, malformed or foreign dataset, another task, expired authorization, stale generation, another worker) keeps the unsent 503 | PASS (new, 2026-10-22) |
| S37 | stale reaper after a confirmed purchase whose worker died | `creditReaper` (12 contracts, held fix `20261022120000`): charged what it reserved (the live settle's amount), not refunded; unused and uncertain holds still released | PASS (new, 2026-10-22; held) |
| S35 | recovery migration absent vs present | `leadMissionExhaustedLease` with `DB_CONTRACT_OMIT_HELD`: 3 fail without it, all pass with it (#108) | COVERED |

**Totals (35 scenarios, before S36–S37):** PASS 23 · COVERED 7 · FIXED 1 (S25) ·
FAIL 2 (S10, S13) · FIXED by #109 1 (S07) · NOT TESTED 1 (S33). One further failing **variant**:
S03b (S03 itself passes).

## Defects, ranked by A7 risk

No P0 was found: no uncontrolled spend, production boundary or authorization
breach in any scenario.

| Rank | Severity | Defect | Status |
|---|---|---|---|
| 1 | **P1, blocked execution** | **S25: multi-employer company-details batch refused by our own gate.** Two or more distinct employers → one request naming all of them → `request_limits: array_unbounded:companies` → no company looked up, 0 leads. With `maxItems: 3` this is the normal live case. Safe on money (nothing sent). | **Fixed here** (`leadCapabilityEngine.ts`): in smoke mode only the first-ranked actionable company is looked up |
| 2 | **P1, false qualification** | **S10: any sales-family title proves "open Account Executive posting".** `jobProvesRequestedHiring` and the `hiring` hard check compare role families only. `gtm_sales` includes SDR, so the mission's `role_terms: ["account executive"]` and `disallowed_broadening: ["role"]` are ignored. Qualifies even with an honest model. | **Fixed by #113** (merged); S10/S10b run on every build (2026-10-23: pass) |
| 3 | P1, false qualification | **S13: the posting's company text stands in for a missing company-record description** | **Fixed by #113** (merged); S13/S13b run on every build (2026-10-23: pass) |
| 4 | P1, false qualification | **S03b: a US office with no HQ flag satisfies the US-headquarters requirement** | **Fixed by Q3's frozen headquarters scope (#141, merged)**; S03b runs on every build (2026-10-23: pass) |
| 5 | P1, false qualification | **S07: a future-dated posting proves recent hiring** | **Fixed by #109** (merged); S07 now runs on every build |
| 6 | P2 | S18a: a malformed vendor dataset is recorded as `empty` | Observability; not fixed |
| 7 | P3 | S21: a model timeout ends `unhandled_exception`; S08c: a date-only posting at exactly 30 days is excluded; S25: after the model allowance is used, further model calls are attempted and refused locally (`usd_limit`, nothing sent) | Polish |

**Also found outside the runtime:** draft **#107** (Codex) re-implements the merged
#108 with a **second held migration using the same version `20261019120000`**.
Merging it would leave two held migrations with one version number. It should
be closed as superseded, or renumbered, before anything else touches held
migrations.

## Proposed final offline acceptance suite for A7

Run on the exact SHA to be dispatched. All must pass, with no known-gap skips:
1. `a7Qualification` S01–S15 (all variants) with `A7_AUDIT_KNOWN_GAPS=1`: **0 failures**.
2. `a7Reliability` S16–S25b and `a7Lifecycle` S29–S34.
3. `discoveryReliability` (#106), `leadMissionExhaustedLease` (#108),
   `smokeAdmission`, `smokeAdmissionRuntime`, `smokeReadAvailability`,
   `offlineSmokeProgress`, `fencedWrite`, `lineageQueue`.
4. CI's three jobs green on that SHA (PostgREST v12.2.3).

## What offline testing cannot verify

- **Real vendors:** actor output shapes and edge cases, `maxTotalChargeUsd`
  enforcement, actual prices on the account's tier, Apify account access
  (currently restricted), and console-configured webhooks on the shared account.
- **Real model behaviour:** whether `gpt-5.6-luna` follows the schemas and cites
  honestly; prices; project budget.
- **Hosted environment:** RLS and PostgREST configuration on the test project;
  the recovery migration (not installed); dashboard and browser rendering (S33).
- **Real time and processes:** wall-clock behaviour under real latency, real
  process kills, GitHub runner start-up and the readiness gap before enqueue.

## Crash recovery and credit accounting (2026-10-22)

Two draft fixes close the accounting gaps that remained after #145 and #150. The evidence is offline: Postgres 17.11, PostgREST 12.2.3, scripted OpenAI and Apify, and nothing hosted.

- **P1, the reaper, PR #153 (held SQL).** The 30-minute reaper released a stale reservation even when the execution ledger already named the provider run. It now charges that reservation at the live per-call credit when the run is confirmed: same workspace, task and logical call, with a non-blank run id. Unused and uncertain reservations are released exactly as before (#88). Proven by 12 contracts and 6 mutation proofs. The rollback was exercised on a real database.
- **P2, adoption through the gate, PR #154 (stacked on #150).** A worker killed after the gate recorded a purchase, but before the execution ledger saved its run id, left a run the next slice could not use. The mission ended `budget_exhausted` next to a paid dataset, and the credit stayed held until the reaper refunded it. The gate now answers a fully verified `adopt` for an Apify start with the run itself, in Apify's start shape: operation, actor, payload, task, an earlier generation, and the same run and dataset. Nothing is sent. Anything less keeps the 503. Proven by 11 contracts, unit tests and 6 mutation proofs.
- **Real processes.** Two `worker/main.ts` processes with a real SIGKILL and a real 30 s lease expiry. In the P2 window and in the #150 control, the second process finishes the mission with:
  - one purchase per actor;
  - credits charged once (10 → 8, 0 held);
  - one qualified lead, no duplicates;
  - lineage generation 2;
  - no forbidden host;
  - a no-op delayed reaper;
  - no unresolved liability after the operator's reconciliation.

  Before P2, the same run ended `budget_exhausted` with the credit held (9/1).

What this proves for A7:
- a worker crash at any point from the paid start onward neither buys twice nor strands what was bought, under smoke admission;
- credits match purchases once the held billing fixes (`20261015130000`, `20261022120000`) are applied.

What it does not prove:
- that the held SQL is installed on the test project (it is not, and needs billing sign-off);
- recovery outside smoke admission (no gate, so the purchase-claims proposal still applies);
- real vendor or model behaviour;
- reaper behaviour if no worker resumes within 30 minutes of a crash in the P2 window (the credit is released; the USD liability stays open).

Found while testing (2026-10-22), fixed in follow-up drafts (2026-10-23):
- a resumed slice whose authorization expired was finalized as "the execution planner is not configured"; it is now `execution_admission_refused` naming the gate's decision (`fix/admission-refusal-named`, on #149). run-agent's HTTP 500 is unchanged on purpose;
- a quoted unlock (`find_decision_makers`, 2 credits) was settled at 1 credit by `runTool`; it is now settled at its reserved price (`fix/quoted-unlock-settle`), and the held reaper charges what a call reserved to match.

Results:

| Tree | DB contract | Edge | Infra | Replay Lab | Mutation | Real process |
|---|---|---|---|---|---|---|
| `launch/hardening` 8b0e2b6 | 226 / 0 | 8844 / 0 | 187 / 0 | SAFE | 64 proofs | — |
| P1 (#153) | 238 / 0 | 8844 / 0 | 191 / 0 | SAFE | 70 / 70 | — |
| #150 be625f4 | 229 / 0 | 8848 / 0 | 187 / 0 | SAFE | — | control passes |
| P2 (this branch) | 240 / 0 | 8853 / 0 | 187 / 0 | SAFE | 70 / 70 | 2 / 2 |
| #144 + #145 + #149 + #150 + P1 + P2 | 252 / 0 | 8866 / 0 | 191 / 0 | SAFE | — | 2 / 2 |

UI 657/0, Node UI 5/0, and the type-check, tsc and eslint ratchets pass on every tree. On the pinned PostgREST 12.2.3 the earlier local-only `fencedWrite` failure (PostgREST 16.4) does not occur. The Q1–Q4 qualification and E01 contracts (`a7Qualification`, `qualificationAuthority`, `qualificationHardening`) pass in the combined tree (the known false-qualification gaps stay skipped by default, as on the base).

## A7 readiness matrix (2026-10-23)

Every gate has one PASS criterion, measured on **the exact SHA to be
dispatched**. A gate with no evidence on that SHA is FAIL, never inferred.
"Combined" below is `review/accounting-integration` @ `b4518ea`: #144 + #145 +
#149 + #150 + #153 + #154, plus the three follow-ups (admission-refusal naming,
quoted-unlock settle, credit check). It is evidence for the merge order, not
the dispatch SHA.

### A. Offline code gates

| # | Gate | PASS criterion (on the dispatch SHA) | Combined, 2026-10-23 |
|---|---|---|---|
| A1 | Qualification scenarios | `A7_AUDIT_KNOWN_GAPS=1 tests/db-contract/run.sh a7Qualification.contract.test.ts`: 21 passed, 0 failed, 0 ignored; `KNOWN_GAPS` empty | **PASS** 21/21 (S03b, S10, S10b, S13, S13b included) |
| A2 | Independent qualification audit (Codex) | The audit's tests at `06eaaad` with `AUDIT_ASSERT_GAPS=1`: 0 failed | **PASS** 68/68. The original `da4b9c8` tests: 67/68; the one failure is the pure G09 helper omitting the evaluator hold production now passes; the real-engine G09 cases pass |
| A3 | Reliability, lifecycle, crash recovery | Full `tests/db-contract/run.sh`: 0 failed (PostgREST v12.2.3, Postgres 17) | **PASS** 255/0 |
| A4 | Real-process crash recovery | `tests/realprocess/run.sh`: 2/2 (SIGKILL in the P2 window and at the first status read) | **PASS** 2/2 |
| A5 | Credits match purchases | `creditRearm`, `creditReaper`, `killResumeAdoption`, `smokeCreditReconciliation` all pass; in every recovered scenario each purchase is charged once, none held, none refunded | **PASS** |
| A6 | Mutation proofs | `tests/db-contract/mutation.sh`: `total == ran`, 0 survivors | **PASS** 76/76 |
| A7 | Suites and ratchets | Edge, infra, QA, UI (Deno + Node) 0 failed; Replay Lab `SAFE FOR PRODUCTION SMOKE: YES`; type-check of every function + worker; tsc and eslint ratchets pass | **PASS** (edge 8870, infra 191, UI 657 + 5, QA 30) |
| A8 | GitHub CI | All checks green on the dispatch SHA | **FAIL until merged**: green on each PR head (#153, #154 verified); the dispatch SHA does not exist yet |

### B. Merge gates (owner approval)

| # | Gate | PASS criterion | Status |
|---|---|---|---|
| B1 | Merge order | #144 and #149 (+ admission-refusal naming); #145 → #150 → #154 (+ credit check); quoted-unlock settle; #153 (code and tests only; its SQL stays held) | **FAIL** (not merged) |
| B2 | Re-validation | A1–A8 re-run on the merged `launch/hardening` head; that head is the dispatch SHA | **FAIL** (pending B1) |

### C. Hosted TEST gates (owner approval for each)

| # | Gate | PASS criterion | Status |
|---|---|---|---|
| C1 | Held schema on TEST | The Lead V2 chain and smoke admission installed; billing fixes installed (`docs/launch/held-billing-fixes-approval.md`) or explicitly waived in writing | **UNVERIFIED** (no hosted read from this session) |
| C2 | Worker build | TEST worker `/health` build stamp == dispatch SHA; `DISCOVERY_SMOKE_ADMISSION=enforce`, `LINEAGE_LEASE_ENFORCED=true`, `LEAD_CREDIT_ENFORCEMENT=enforce` | **FAIL** (not deployed) |
| C3 | Provider-disabled dry run | No provider keys: the mission ends `blocked / refused_before_execution` (`execution_planner_unavailable`), 0 vendor requests, credit balance unchanged | **FAIL on this SHA** (passed earlier on the #149 base) |
| C4 | Real-GPT, zero-provider run | Authorization with both actors at **0 starts** (rehearsed in `modelOnlySmoke`): ≤ 4 model calls, committed ≤ $0.05, 0 Apify requests, credit balance unchanged, one honest terminal, planner output valid against the schema | **FAIL** (not run) |
| C5 | Reconciliation | After C3/C4: `smoke-reconciliation.sql` lists only expected rows, `smoke-credit-reconciliation.sql` is empty, the impact query explains every `reserved` row | **FAIL** (pending C3/C4) |

### D. External prerequisites (owner)

| # | Gate | PASS criterion | Status |
|---|---|---|---|
| D1 | Apify account | Restriction lifted, confirmed on the account page (no paid call) | **OPEN** |
| D2 | OpenAI project | Project budget cap set; the key is scoped to the TEST worker | **OPEN** |
| D3 | Catalog prices | Every template's `maximum_microusd` observed ≤ 24 h before authorization | **OPEN** |
| D4 | Shared-account webhooks | Scope and token confirmed | **OPEN** |
| D5 | Operator | Named operator; runbook read; reconciliation queries rehearsed on TEST | **OPEN** |

### GO / NO-GO

**NO-GO for the paid $0.25 A7 today.** Every offline gate passes on the combined
tree (A1–A7); nothing offline blocks. What remains is merges (B), the hosted
TEST gates (C) and the external prerequisites (D). The qualification blockers
this report listed (S10, S13, S03b, S07, S25) are fixed and run on every build.

**GO for paid A7** when B1–B2, C1–C5 and D1–D5 are PASS on one dispatch SHA.

Known, accepted, not blocking:
- an uncertain start is released after 30 minutes (#88; USD liability stays open);
- a proven purchase that no slice adopts before the authorization ends has its credit released; the credit check lists it for a one-time correction;
- run-agent answers HTTP 500 when planning is refused (the V2 runner reads the terminal record; the cause is now named);
- re-entry re-runs the execution-planning model call (#150; capped by `usd_limit`).
