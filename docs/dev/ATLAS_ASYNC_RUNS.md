# ATLAS V4: asynchronous Apify runs and real charge receipts (V5 phase C)

Status: implemented locally and tested offline. No paid call, no deploy. Stacked on #274 (it needs the plan's bound Actor input).

## What a paid step does now

| Stage | Call (Apify API v2, documented) | Durable effect |
|---|---|---|
| Validate | none | Actor on the allowlist, a **reviewed build**, every input field in that build's schema (`actorBuilds.ts`), `maxItems` 1–100. Otherwise refused, and nothing is reserved |
| Reserve | none | Ledger reservation of the worst case under `ms:{walk}:{planHash}:{step}` (`provider_usage_ledger`) |
| Start | `POST /v2/acts/{id}/runs?build=&maxItems=&maxTotalChargeUsd=&timeout=&waitForFinish=0` | `restartOnError` is never sent |
| Record | none | **The run ID, dataset ID, build and input hash are written to the reserved row (`result`) before the first poll** |
| Poll | `GET /v2/actor-runs/{id}?waitForFinish≤60` | Repeated within the request's deadline (`LEAD_PIPELINE_RUN_WAIT_MS`, default 90 s) |
| Still running | none | `202 {status:"running", running:{runId…}}`. The same `strategy_run` (same token) **adopts** the run |
| Items | `GET /v2/datasets/{id}/items?clean=true&limit=` | none |
| Receipt | `GET /v2/actor-runs/{id}` again, ≥ 10 s after finish | Ledger settled with Apify's figure |
| Abort | `POST /v2/actor-runs/{id}/abort` | `abortRun()`, for a cancelled mission (not wired to an action yet) |

## Charge states (stored on the row, returned per run in `charges[]` and `chargeStates`)

| State | Meaning |
|---|---|
| `estimated` | The plan's worst case; nothing has run |
| `reserved` | The ledger holds the worst case; the run started or is running |
| `provider_reported` | Apify's receipt was read; a later read differed, or there was no time to confirm it |
| `settled` | A read ≥ 10 s after finish repeated the same figure (V2's `apifyRunSettled` rule) |
| `unknown` | The receipt was unreadable, or the start's answer was lost. The worst case stays counted and is labelled |

The outcome's `spend.basis` is `provider_reported` only when every paid run was read. Otherwise it is `estimate`.

## Never twice

| Situation | Result |
|---|---|
| Request repeated after success | The settled key replays its stored items at $0. A figure not yet confirmed (`provider_reported` / `unknown`) is re-read for free and moves to `settled` when a later read repeats it |
| Request repeated while running | The in-flight key's recorded run is adopted, never started again |
| Adopting with a different input or build | Refused |
| Start answered 4xx (bad input, missing build) | Definite: reservation released, $0 |
| Start answer lost or 5xx | May have bought: reservation marked uncertain, worst case counted, never restarted |
| Run ID could not be recorded | This request still follows the run. If it must leave, the run is counted uncertain, never re-bought |
| FAILED / ABORTED / TIMED-OUT | Receipt still read and counted. Final for that step |

## Reused from V2, not rebuilt

- `apifyReceiptFromRun` (providerReceipts.ts): usage total and charged events × the run's own prices.
- `receiptUsd` (budgetPolicy.ts): the larger of the two, never their sum.
- `apifyRunSettled`, `APIFY_MAX_WAIT_S`, `APIFY_SETTLE_MS` (smokeAdmissionRefusal.ts).
- The adopt-never-rebuy rule of `leadAutoContinuation.ts`.

## Build binding

`actorBuilds.ts` records the reviewed build of every pipeline Actor, read from Apify on 2026-11-21:

| Actor | Build |
|---|---|
| job search | 0.0.62 |
| company search | 0.0.21 |
| company record | 0.0.46 |
| profile posts | 0.0.86 |
| company posts | 0.0.54 |
| website crawler | 0.3.107 |

The plan hash includes `actorId@build` for every Apify step. A new reviewed build is a new plan, so an approval never covers an unreviewed version. A build Apify no longer has fails the start with 404, and nothing is bought.

## Rollback and storage

- `LEAD_PIPELINE_SYNC_RUNS=enabled` restores run-sync.
- No migration. The run is written into the existing `result` jsonb of a **reserved** row by the service-role client. **To verify on TEST before the first live run:** the service role can `UPDATE provider_usage_ledger`. If it can't, `recordRun` throws and the invoker falls back safely (follow now, else uncertain), but adoption across requests won't work.
- The LeadOcean-led path (`pipeline.ts`) stays run-sync: LeadOcean is deferred (D4).

## Tests (offline)

| Suite | What it covers |
|---|---|
| `apifyRuns.test.ts` (19) | Recorded receipts from this account's TEST runs ($0.00405 record; empty company search billed $0.001), adoption, lost start, 4xx and 5xx starts, missing build, unknown input field, unreadable receipt and status, late charges, FAILED, concurrency, abort, spend basis, and **1,000 randomized interruptions: never two purchases, never above the worst case** |
| Simulator (`async-*` fixtures, 6) | The whole service on the fake Apify API: same verdicts as run-sync; `202 → 202 → 200` adoption with one purchase per step; lost start re-sent with one purchase; unreadable receipt reported as estimate; failed record run |
| `strategyDiscovery.test.ts` | The Workbench panel re-sends the same approval while `running`, bounded |
