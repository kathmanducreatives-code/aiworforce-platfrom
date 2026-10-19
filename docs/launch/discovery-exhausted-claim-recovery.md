# Exhausted-claim reliability candidate

Base: `4ccf5c2b4ab19975fbd4fc4eb587220cc7ff839e` (`launch/hardening`).
The earlier transport patch `9fb3182c` was not integrated at this base; it is
carried forward separately as `a0c6c65e`. This candidate adds the remaining
five-claim recovery fix without changing Claude's execution/qualification code.

## Reproduction and root cause

The worker dies on its fifth claim. Its queue lease expires, but
`claim_next_lead_mission` requires `attempts < 5`, so no worker can reclaim it.
`tasks_sweep_stuck_runs` intentionally excludes queue-owned tasks. No release
runs, leaving queue/task `running`, lineage active and plan live indefinitely.

The new black-box regression claimed and expired the same mission five times
using the real RPC. Before implementation, the sixth claim was refused and
queue status was **running**, where the test required **failed**.

## Minimal coordinated change

The held `20261019120000_lead_mission_exhausted_claim_recovery.sql` adds one
service-role-only recovery function and replaces the existing claim function
with its previous behavior plus a bounded recovery call. No worker changes,
new table/column/index, cron, paid call, financial policy or spending-limit change.
The fresh-test builder and localhost contract bootstrap include the held file.

- Select only `running` queues with at least five attempts and an expired lease.
  Lock at most ten per normal claim with `FOR UPDATE SKIP LOCKED` (direct helper
  calls are bounded to 0–100). Attempts and continuation counters never increase.
- Lock queue → task → lineage → plan, matching the existing heartbeat/admission
  order. Never lock authorization after queue: admission takes that lock first.
- Reconcile all linked lifecycle rows in the **same database transaction**.
  Failed writes roll back every change; a later pass retries the expired row.
- Respect a terminal task/lineage result persisted before the crash, using the
  worker's task/lineage/queue-status precedence. Completed work remains complete.
  Otherwise close the mission with `continuation_attempts_exhausted`.
- Preserve evidence/checkpoints, disable auto-continuation, bump task generation
  and lineage state version, clear execution leases, and remove queue ownership.
  Stale release/heartbeat/task writes/lineage writes are refused after commit.
- Scope related writes to the queue workspace. Never mutate another lineage
  holder's state or guess missing task bindings. Malformed plan IDs do not block
  queue closure; the task's persisted plan binding takes precedence.

Credit transactions, balances, authorizations, provider receipts/commitments and
reconciliation rows remain byte-for-byte unchanged. An unknown purchase still
blocks another authorization. The old authorization may remain active until its
deadline or an operator stop; the terminal queue fences admission immediately.

## Offline validation

- **Before:** original real-RPC crash regression failed (`running` vs `failed`);
  the first 12 recovery contracts failed without the held fix/helper.
- **Full database suite:** 164 checks passed, including Claude's existing normal
  and slow missions, account-restriction cases, admission/lease/global-liability
  tests, receipts, credits, five-read allocation and unknown-count refusal.
- **Final focused run:** 19 recovery contracts, 23 transport/failure contracts
  and six queue/lineage contracts. This rerun includes the final stale-label
  regression: an active lineage's old checkpoint label must be replaced by the
  exhaustion verdict, while genuine terminal outcomes remain authoritative.
- **Unit tests:** 184 worker, terminal agreement, cancellation, interrupted-run,
  pending-run, model transport and credit checks passed (CI-style `--no-check`).
- **Deployment safety:** 20 existing held-admission/no-Brain/manual-worker checks
  passed. New test lint/format, shell syntax and whitespace checks passed.

Recovery tests include eight concurrent cleaners; concurrent reclaim of ordinary
work; stale execution fences; unchanged unknown/run-ID financial liability;
transaction rollback after an injected plan-write failure and successful retry;
renewal winning a queue lock; unexpired/fourth leases; persisted terminal outcomes;
foreign workspace and different-holder isolation; missing bindings; bounded
passes; and repeated application/rollback of the held migration.

Reproduce locally with the existing disposable runner:

```bash
tests/db-contract/run.sh \
  tests/db-contract/exhaustedClaimRecovery.contract.test.ts \
  tests/db-contract/discoveryReliability.contract.test.ts \
  tests/db-contract/lineageQueue.contract.test.ts
```

The runner requires a localhost `PG_ADMIN_URL` and the pinned `POSTGREST_BIN`;
it refuses hosted URLs, creates/drops the database, and grants vendor network
access to neither Deno nor any fixture. Local logs:
`/workspace/exhausted-claim-evidence/`. The full mutation suite was not repeated
locally; GitHub's separate advisory database workflow runs it automatically.

## Rollout limits and A7

**A7 remains NO-GO.** This draft is not deployment or spending authorization.
Merging alone does not install a held migration. Applying it to any hosted
database needs separate approval; nothing hosted was read, written or provisioned.
The down migration restores old claim behavior without reopening recovered rows
or releasing liabilities. The existing 30-minute internal-credit refund policy
is unchanged and remains separate from the durable USD liability fence.

Recovery runs only when a worker polls/claims, or an operator explicitly invokes
the helper; stopping every worker does not schedule cleanup. It cannot identify
a task that was never bound to its queue, and deliberately leaves foreign or
different-holder rows alone. Those corrupt/unbound references need operator
inspection. It does not rewrite conversation notices or perform vendor billing
reconciliation. Queue/task/lineage/plan verification and explicit stop/reconcile
procedures remain necessary after interruption.
