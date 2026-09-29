# Beta access — request, review, grant (Phase: beta access)

**Status: IMPLEMENTED, tested locally on a fresh isolation stack. Not deployed; the migration is not
applied to production.** Builds on budget safety (`budget-safety.md`): spend fails closed, and a
workspace spends provider credits only after a grant. Signup stays open.

## The loop

1. A member presses Start on a paid search. With no credits, orchestrate refuses before anything is
   queued, and Pilot replies with the private-beta message (`metadata.credits_required`).
2. Under that reply, **BetaAccessCard** files a `beta_access_requests` row — as that member, for their
   own workspace, `pending`, with an optional note — then shows where it stands (received / approved /
   not approved). One open request per workspace; a second click reads "already requested".
3. The operator reviews:
   ```
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… deno run --allow-net --allow-env scripts/beta/review-requests.ts list
   … review-requests.ts approve <request-id> --credits 50 [--note "…"] [--dry-run]
   … review-requests.ts decline <request-id> [--note "…"]
   ```
   Approve grants first (idempotency key `beta-request:<id>`, so re-running never double-grants), then
   marks the request approved only while it is still pending. A crash between the two is repaired by
   running approve again.
4. The member starts the search again; the card reads "Beta access approved — N credits".

`scripts/beta/grant-credits.ts` remains for grants that did not come through a request (existing
workspaces during rollout).

## Security (20260929140000_beta_access_requests.sql)

- RLS on; `anon` has nothing; `authenticated` cannot UPDATE, DELETE or TRUNCATE.
- A member may read their workspace's requests and insert only `requested_by = auth.uid()`,
  `status = 'pending'`, no credits, no decision — the house `has_workspace_access` predicate.
- Decisions are written by the service role only; a CHECK keeps every decision complete.
- **Proven on a fresh isolation stack:** 48 workspace tables (this one included), 96 cross-workspace
  attacks, 107/107 tests.

## Fixed along the way

- `scripts/security/isolation-stack.sh` silently reused a running stack built from an OLD schema
  (it found the stack by `$TMPDIR`, which differs between sessions) — the first run "passed" without the
  new table existing. `down` now stops by project id, and `up` refuses a stack whose newest applied
  migration is not this repo's newest (exit 3, `STALE ISOLATION STACK`).
- `tests/security/startIdempotencyDb.test.ts` depended on workspaces seeded by a later test file; on a
  fresh stack all five inserts hit the foreign key. It now creates its own fixtures.

## Rollout

Apply the migration with the budget-safety rollout (`budget-safety.md`), before the functions deploy:
the card reads and writes this table the moment Pilot can say `credits_required`.

## Still open

- No notification when a request arrives: the operator runs `review-requests.ts list`.
- No in-app operator view; approval is the CLI.
