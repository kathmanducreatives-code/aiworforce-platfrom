# Approval package — the two held billing migrations

**Decision requested:** approve installing two held migrations, first on the
TEST project and then, separately, on production. Nothing here has been
applied to any hosted database. Each step below needs its own explicit "go".

| Order | File | What it changes | Code PR |
|---|---|---|---|
| 0 | *(runtime, not SQL)* `fix/quoted-unlock-settle` | A started quoted unlock is charged the price it reserved (`find_decision_makers`: 2 credits, not 1) | separate draft PR |
| 1 | `supabase/migrations-held/20261015130000_credits_rearm_settled_key.sql` | A refunded key (`not_charged`, or `released` by the reaper) that is really bought again is **re-armed**: balance-checked and charged, instead of replayed at 0 | merged as a held file; contract-tested since 2026-10-15 |
| 2 | `supabase/migrations-held/20261022120000_credits_reaper_charges_confirmed_purchase.sql` | The 30-minute reaper **charges** a stale reservation whose provider call names a run id (same workspace, task and logical call), at what it reserved. Uncertain and unused reservations are still released | #153 |

Step 0 is a code deploy, not a migration. It must reach production before
step 2: after step 2 the reaper charges what a call reserved, and until step 0
the live path charges a quoted unlock only 1 credit. Step 1 must precede step
2 because the reaper reads `rearmed_at`, which step 1 adds.

## What each fix corrects (customer-visible)

- **Re-arm (1).** Today a key whose credit was refunded is replayed with
  **no balance check** and settled at 0 when the same logical call later
  runs: a real purchase is uncharged, and a workspace at 0 credits is waved
  through in enforce mode.
- **Reaper (2).** Today a worker that dies after a paid start, before it
  settles, has its credit **refunded** after 30 minutes even though the run
  id is in the execution ledger. A later slice that adopts the run (#150,
  #154) reserves nothing new, so the refund is final.
- **Quoted settle (0).** Today every started decision-maker unlock is charged
  1 credit although the Workbench button showed, and the reserve held, 2.

All three make charges **match purchases**. None charges a call that did not
reach the provider, and none can charge one call twice (`credits_finalize`
locks the row and replays anything not `reserved`).

## Production impact — measure before deciding

The reaper already runs in production every 10 minutes
(`release-stale-credit-reservations`, `*/10 * * * *`). After step 2 is
installed, the next tick applies the new rule, **including to reservations
already older than 30 minutes**.

Run this read-only query on production before approving step 2, and on TEST
before every step. It references no column either migration adds:

```sh
psql "$DB_URL" -v days=30 -f scripts/test-project/held-billing-impact.sql
```

| Row | Meaning |
|---|---|
| `reaper: past releases that would have been charged` | Size of the defect over the window: confirmed purchases refunded |
| `reaper: charged at the first tick after install` | **Immediate effect** of step 2: stale reservations that will be charged within 10 minutes of install |
| `reaper: still released at the first tick (unchanged)` | Uncertain/unused holds the reaper keeps releasing |
| `re-arm: refunded keys later bought (charged going forward)` | Size of the step-1 defect over the window |

If the first-tick row is not zero, decide explicitly whether those workspaces
are charged (install as is) or first settled by hand. Either is safe; the
choice is a customer decision, not a technical one.

## TEST validation (each step, on the TEST project only)

Preconditions: the TEST project ref is not production (`ohsdatpvfdjdemstoiuj`)
and not the abandoned project; `TEST_DB_URL` names it; a fresh database backup
or PITR point exists.

1. **Record the before state.**
   ```sh
   psql "$TEST_DB_URL" -v days=30 -f scripts/test-project/held-billing-impact.sql
   psql "$TEST_DB_URL" -Atc "select status, count(*), sum(reserved_credits) from public.credit_transactions group by 1 order by 1"
   psql "$TEST_DB_URL" -Atc "select pg_get_functiondef('public.credits_release_stale(interval)'::regprocedure)" | md5sum
   ```
2. **Install, one transaction per file, in order.** For a NEW, empty TEST
   project, `scripts/test-project/build-test-schema.sh --with-held-billing-fix`
   applies both in order. For the EXISTING TEST project:
   ```sh
   psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations-held/20261015130000_credits_rearm_settled_key.sql
   psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations-held/20261022120000_credits_reaper_charges_confirmed_purchase.sql
   ```
3. **Verify** (all must hold):
   - `select has_function_privilege('authenticated', 'public.credits_release_stale(interval)', 'execute')` → `f`, and for `service_role` → `t`; the same for `credits_reserve`.
   - `credit_transactions` has `rearmed_at` and `rearm_count`.
   - The next reaper tick (≤ 10 min, or `select public.credits_release_stale('30 minutes')` as service role) charges exactly the rows the impact query listed as "charged at the first tick", and releases the rest.
   - A provider-disabled dry run, then the A7 offline acceptance (below), on the deployed SHA.
4. **Rollback rehearsal** on TEST, before production: apply the two `.down.sql` files in **reverse** order, confirm the function hash from step 1 returns, and re-apply steps 2–3.

## Rollback

```sh
psql "$DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations-held/rollback/20261022120000_credits_reaper_charges_confirmed_purchase.down.sql
psql "$DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations-held/rollback/20261015130000_credits_rearm_settled_key.down.sql
```

- The reaper rollback restores the re-arm migration's reaper byte-identical
  (pinned by `tests/infra/creditsReaperHeld.test.ts`); the re-arm rollback
  restores both baseline functions byte-identical, then drops its two
  columns.
- Rows are **not** rewritten. A row a fix charged stays charged: the run it
  names was bought.
- Exercised on a disposable database: with the fix a confirmed stale row
  becomes `charged`; after the down file the next one is `released`; the
  service-role-only grants survive.

## Evidence

| Check | Result |
|---|---|
| `creditRearm.contract` (re-arm) | 7 / 7 |
| `creditReaper.contract` (reaper + impact query) | 13 / 13 |
| Mutation proofs (re-arm omitted; reaper omitted; each evidence guard removed; flat-credit charge) | all killed (`MUTATION_TALLY total=70 ran=70` on #153 before this package; the six reaper proofs re-run after the alignment) |
| Infra: held, not in any deploy path, rollback byte-identical, TEST build order | `creditsRearmHeld` 3 / 3, `creditsReaperHeld` 5 / 5 |
| GitHub CI on #153 (`c742af5`) | green, all 16 checks |

## What approval does not cover

- Uncertain starts (no run id anywhere) are still released after 30 minutes
  (approved policy #88; the USD liability stays open in the smoke ledger).
- A purchase the smoke admission ledger proves but the execution ledger does
  not (a worker killed between the two writes, never adopted) is still
  released; `scripts/test-project/smoke-credit-reconciliation.sql` lists it
  for a manual correction.
- Neither migration touches admission, grants, budgets, or `credits_grant`.
