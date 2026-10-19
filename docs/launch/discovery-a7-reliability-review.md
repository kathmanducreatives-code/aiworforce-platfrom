# Independent A7 failure-recovery review

Reviewed base: `a6a56df20321b2982bef587a3fcf7f1f89f986cf` on
`launch/hardening`, independently confirmed with `git ls-remote` at the end of
the review. Candidate changes are local on `codex/discovery-a7-reliability`.
Nothing was pushed, dispatched, deployed or run against a hosted project.

**A7 recommendation: NO-GO on the reviewed base.** Review and integrate the two
transport fixes before considering a controlled test. Apify's account restriction,
account-specific pricing/cap evidence and a separate explicit spending approval
remain external prerequisites. This review supplies none of those approvals.

## Confirmed defects

| Finding | Reproduction and impact | Candidate disposition |
| --- | --- | --- |
| P2: in-flight model requests ignore ownership cancellation and deadlines | Admit a model request, leave its fake transport pending, then revoke ownership/cancel. The outgoing request has no worker signal; without a caller signal it has no timeout either. The worker can remain awaiting it past the slice/authorization deadline. This does not bypass the spending cap. | Compose caller and worker signals with the earlier slice/authorization deadline in `smokeAdmission.ts`. Reservations and attempts remain consumed after dispatch. |
| P2: failed resume GET forgets a known run and refunds its reserved credit | Pause after POST/run-ID persistence but before credit settlement. Resume that run; a 402/403/429/500, connection loss or malformed 200 omits its known ID. `credits_finalize` records `started=false`; the original credit is refunded, and its eventual settlement cannot charge it. The USD commitment stays held. | Preserve the known run ID and pending/unsettled state in those failure returns in `toolRegistry.ts`. No new POST, budget increase or reconciliation. |
| P2, unresolved: crash on the fifth claim strands the mission | Claim and expire the same bound queue row five times using the actual RPC. Claim six returns `no_eligible_mission`; `tasks_sweep_stuck_runs` skips the queue-owned task. Both rows remain `running`. | Explicit known-defect characterization retained. No broad queue/migration change mixed into the transport patch. |

The last defect needs a separate, coordinated recovery change before unattended
beta: terminalize exhausted expired queue rows without granting another execution
attempt, reconcile task/lineage/plan state idempotently, and retain all provider
liabilities. Include concurrent reclaim, stale-worker and partial-write tests.
For any controlled test, inspect queue/task/lineage outcomes explicitly; neither
worker exit nor lease expiry proves the mission finished. An interruption needs
operator inspection and reconciliation before another authorization, never an
automatic fresh purchase.

No P0/P1 spending or admission bypass was reproduced in this review.

## Offline evidence

New file: `tests/db-contract/discoveryReliability.contract.test.ts`, **23 checks**:
HTTP 402/403/429/500 and lost start responses; unreadable final status; eight
concurrent uncertain starts; ownership loss during POST; interrupted resume
failures; model timeout/429/500 retry ceilings; caller/worker/deadline aborts;
credit-reaper isolation; and the explicitly named unresolved queue defect.

- Final focused fresh-database run: **29 passed**, comprising the 23 checks
  above and six existing lineage/queue contracts.
- Existing admission, runtime, ledger and read-availability checks on the
  candidate: **86 passed**. The first combined run additionally found a typo in
  the new POST-abort assertion; that assertion was corrected and passed in the
  final focused run. Existing tests required no changes.
- Existing failure-recovery/model/credit/worker unit tests: **154 passed** using
  the CI lane's `--no-check` setting. Standalone test type-checking exposes an
  existing missing `cancelSweepIntervalMs` fixture field; the new database tests
  type-check normally.
- An initial custom ordering put admission lease-expiry fixtures before queue
  tests; two queue tests claimed those earlier expired rows. Both pass in the
  fresh-database rerun. This is shared-fixture ordering, not a production RPC
  change.
- New test formatting/lint and `git diff --check` pass.

Measured examples: eight concurrent uncertain actor attempts sent **one POST**,
with **$0.005 committed and one internal credit held**; four admitted Luna
attempts committed **$0.04992**, and subsequent retries sent nothing. Failed
resume GETs sent no additional POST and retained the existing commitment.
The receipt guard rejected `NO_RUN` against a recorded run ID.

The existing contracts also exercise generation/lease fencing, global-lock
waits, cancellation/deadline refusal, actor/model allowlists, administrator-only
reconciliation and replay, over-quote holds, five reads and actor allocations,
and the $0.25/$0.20/$0.05 ceilings. Limits/catalog files were not changed.

Internal credits and USD liabilities are different ledgers: the existing
30-minute credit reaper refunds stale uncertain internal credits, intentionally
absorbing that customer-credit cost. The added test proves it does **not** close
or refund the USD liability. No automated billing reconciliation was added.

Tests used real PostgreSQL 17.6, PostgREST 12.2.3, real credit/admission/ledger
RPCs and provider/model transports with fake vendors. Network permission was
restricted to localhost; all vendor destinations were intercepted. Prices and
authorization rows were synthetic fixtures in databases created and dropped by
the contract runner. They are not live authorization or verified account prices.
Success/qualification testing remains Claude's separate scope. Real process
termination, hosted RLS configuration, vendor billing and indefinitely stalled
database transports were not validated by these offline tests.

## Repeat locally only

With a disposable localhost Postgres and the existing pinned tools available:

```bash
export PG_ADMIN_URL=postgres://postgres@127.0.0.1:55490/postgres
export POSTGREST_BIN=/workspace/review-tools/postgrest
export PATH=/workspace/review-tools:$PATH
export DENO_DIR=/workspace/.deno-cache
tests/db-contract/run.sh \
  tests/db-contract/discoveryReliability.contract.test.ts \
  tests/db-contract/lineageQueue.contract.test.ts
```

For the original failure, run the new test file against the reviewed base's
`smokeAdmission.ts` and `toolRegistry.ts` in another disposable checkout. Before
the candidate fix, ownership/deadline cancellation and all six resume-failure
regressions fail. Do not replace implementation files in Claude's checkout.
Raw local logs are in `/workspace/a7-reliability-evidence/`.
