# Controlled TEST validation — same-task continuation claim

**Status: NOT EXECUTED.** This plan is written for a later session and must not be
run until it has been reviewed and explicitly approved.

- Target: **TEST only** — `zbwsbnqqpkvdhqwavjke`. Production `wqnigjhcwjxtmordrwno`
  is forbidden.
- No providers, no live model, no paid call. Every step is a synthetic fixture or
  a `run-agent` invocation whose checkpoint is already exhausted.
- Prerequisite: migration `20260727090000_continuation_claim_lease.sql` applied to
  TEST. Without it the RPC path is unavailable and steps 12–15 exercise only the
  weaker compatibility fallback (record which path ran — run-agent logs
  `claim_path: rpc` or `claim_path: compatibility_fallback`).

## 0. Preconditions to record before touching anything

```sql
-- Expect: no CHECK constraint (as of the 2026-07-26 audit).
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'public.tasks'::regclass AND contype = 'c';

-- Expect: the four claim columns present iff the migration was applied.
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='tasks'
   AND column_name LIKE 'continuation_%' OR column_name = 'checkpoint_version';
```

## Expected lifecycle across the run

```
ready → running → ready (another checkpoint)   … or → complete (terminal)
```

`ready` is what a checkpoint writes; `complete` is only ever a genuine terminal
outcome. A task at `complete` must never be reclaimable.

## 1–3. Insert the synthetic checkpointed task, at status `ready`

One row, clearly labelled, in a scratch workspace:

- `status = 'ready'`
- `result.task_status = 'partial'`
- `result.terminal_status = 'continuation_required'`
- `result.company_first_state` carrying `version: "company-first-state-1.0.0"`,
  `terminal_status: null`, `current_round: 2`, two entries in `completed_calls`,
  and `requested_lead_count: 5 / eligible_leads: 1 / remaining_leads: 4`.

Record the returned `id` as `$TASK` and the `checkpoint_version` as `$V0`.

## Read it back

```sql
SELECT id, status, checkpoint_version, workspace_id,
       result->'company_first_state'->>'current_round'  AS round,
       result->'company_first_state'->>'eligible_leads' AS eligible,
       jsonb_array_length(result->'company_first_state'->'completed_calls') AS calls
  FROM public.tasks WHERE id = $TASK;
```

Expect `status='ready'`, `round=2`, `eligible=1`, `calls=2`. Snapshot the whole
`result` to a file — steps 9/10 compare against it.

## 3. Two concurrent continuation claims

Two `run-agent` invocations fired together, same `$TASK`, same workspace:

```
POST /functions/v1/run-agent
{ "resume_task_id": "$TASK", "workspace_id": "$WS",
  "agent_slug": "scout", "instruction": "<the original instruction>",
  "execution_mode": "company_first", "workflow_kind": "qualified_lead_sourcing" }
```

Fire both with a single `curl --parallel` (or two backgrounded calls started in
the same second) — a sequential pair does not test the race.

## 4–5. Exactly one succeeds, the other conflicts

- One response: not `continuation_refused`.
- Other response: HTTP **409**, `error: "continuation_refused"`, `reason` one of
  `already_claimed` (RPC path) or `lost_race` (fallback path).
- Record which `claim_path` each invocation logged.

## 6–7. Same task, no new row

```sql
SELECT count(*) FROM public.tasks WHERE id = $TASK;                      -- 1
SELECT count(*) FROM public.tasks
 WHERE workspace_id = $WS AND created_at > $FIXTURE_CREATED_AT;          -- 0
```

Both responses that carry a `task_id` must return `$TASK`.

## 9–11. Quota, idempotency keys and provider silence

Re-read the row and diff against the snapshot. The REFUSED invocation must have
changed nothing: `requested_lead_count`, `eligible_leads`, `remaining_leads` and
every `completed_calls[].idempotency_key` identical.

`checkpoint_version` must have incremented exactly once (`$V0 + 1`) — one claim,
one increment, monotonic.

**No provider call (11).** Confirm from the run-agent logs that no Apify or
Firecrawl invocation was made by either request, and that `tool_calls` gained no
row for `$TASK` during the window.

## 12–13. Simulate claimant failure, then release or expire the claim

Expire the lease in place, without running anything:

```sql
-- RPC path (migration applied): expire the lease and return the row to `ready`,
-- which is the state a dead claimant would have left behind after recovery.
UPDATE public.tasks
   SET continuation_claim_expires_at = now() - interval '1 minute',
       status = 'ready'
 WHERE id = $TASK;

-- Fallback path (no migration): age the JSON claim past STALE_CLAIM_MS (5 min).
UPDATE public.tasks
   SET result = jsonb_set(result, '{continuation_claim,claimed_at}',
                          to_jsonb((now() - interval '10 minutes')::text))
 WHERE id = $TASK;
```

## 14–15. Two concurrent STALE reclaims — exactly one succeeds

Fire two concurrent continuations again.

- **RPC path:** exactly one succeeds. This is the property the compatibility
  fallback cannot provide and the main reason the migration exists.
- **Compatibility path:** both may succeed. Record the result honestly — a double
  success here is the documented limitation, not a new defect.

`checkpoint_version` must have incremented exactly once more.

## 16–17. Finish the workflow and confirm `complete`

Let a round reach a genuine terminal outcome (or set
`result.company_first_state.terminal_status = 'search_exhausted'` on the fixture
and run one more continuation). Then:

```sql
SELECT status,
       result->>'task_status'     AS task_status,
       result->>'terminal_status' AS terminal_status,
       continuation_claim_id
  FROM public.tasks WHERE id = $TASK;
```

Expect `status='complete'`, `task_status='completed'`,
`terminal_status='search_exhausted'`, and `continuation_claim_id IS NULL` (the
claim was released).

## 18. A terminal task cannot be reclaimed

Fire one more continuation against `$TASK`. Expect HTTP **409** with
`reason: "already_terminal"`, and confirm `status` is still `complete` and
`checkpoint_version` did not change.

## 19. Clean up

```sql
DELETE FROM public.tasks WHERE id = $TASK;
```

Then re-run step 0 and confirm the schema is unchanged.

## Abort conditions

Stop immediately and report if: any query touches a project ref other than
`zbwsbnqqpkvdhqwavjke`; a provider or model call appears in the logs; more than
one task row exists for the fixture; the refused invocation mutated `result`; `checkpoint_version` moved more than
once per successful claim; or a task at `status='complete'` was reclaimed.
