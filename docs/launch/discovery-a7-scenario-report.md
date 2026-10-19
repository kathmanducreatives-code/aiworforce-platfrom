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
| S07 | posted 5 d in the **future** | 0 | **1 qualified** | **FAIL** on base; **PASS with #109** |
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
| S30 | deadline after a lead is persisted | late admission → `stopped`; the lead stands | PASS (new) |
| S31 | partial / duplicate result writes | `fencedWrite` (stale generation fenced, finalized row fenced, end-to-end D1) | COVERED |
| S32 | stale worker on a completed mission | heartbeat refused, release refused, never re-claimed, outcome unchanged | PASS (new) |
| S33 | completed, but dashboard retrieval fails | not reachable offline: hosted RLS and browser rendering | NOT TESTED |
| S34 | open liabilities at the end | both purchases listed by `smoke-reconciliation.sql`; a new authorization refused (`unreconciled`); credits charged once each | PASS (new) |
| S35 | recovery migration absent vs present | `leadMissionExhaustedLease` with `DB_CONTRACT_OMIT_HELD`: 3 fail without it, all pass with it (#108) | COVERED |

**Totals (35 scenarios):** PASS 23 · COVERED 7 · FIXED 1 (S25) ·
FAIL 3 (S07, S10, S13) · NOT TESTED 1 (S33). One further failing **variant**:
S03b (S03 itself passes).

## Defects, ranked by A7 risk

No P0 was found: no uncontrolled spend, production boundary or authorization
breach in any scenario.

| Rank | Severity | Defect | Status |
|---|---|---|---|
| 1 | **P1, blocked execution** | **S25: multi-employer company-details batch refused by our own gate.** Two or more distinct employers → one request naming all of them → `request_limits: array_unbounded:companies` → no company looked up, 0 leads. With `maxItems: 3` this is the normal live case. Safe on money (nothing sent). | **Fixed here** (`leadCapabilityEngine.ts`): in smoke mode only the first-ranked actionable company is looked up |
| 2 | **P1, false qualification** | **S10: any sales-family title proves "open Account Executive posting".** `jobProvesRequestedHiring` and the `hiring` hard check compare role families only. `gtm_sales` includes SDR, so the mission's `role_terms: ["account executive"]` and `disallowed_broadening: ["role"]` are ignored. Qualifies even with an honest model. | **Not fixed here**: #109 edits the same function. Failing tests `S10`/`S10b`; reported on #109 |
| 3 | P1, false qualification | **S13: the posting's company text stands in for a missing company-record description** | Codex provenance work; failing tests `S13`/`S13b` |
| 4 | P1, false qualification | **S03b: a US office with no HQ flag satisfies the US-headquarters requirement** | Codex HQ work; failing test `S03b` |
| 5 | P1, false qualification | **S07: a future-dated posting proves recent hiring** | Fixed by **#109** (verified: S07 passes on a local merge of #109) |
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

## GO / NO-GO

**NO-GO.** Offline blockers:
- the S10 role-term false qualification;
- the S13 provenance and S03b HQ gaps (Codex);
- #109 unmerged (S07);
- this PR's S25 fix unmerged.

External prerequisites:
- Apify account restriction lifted;
- shared-account webhook scope and token confirmed;
- OpenAI project spending protection confirmed;
- catalog prices observed ≤ 24 h before authorization;
- the recovery migration installed on the test project, or explicitly waived;
- the A7 package re-validated against the final SHA.
