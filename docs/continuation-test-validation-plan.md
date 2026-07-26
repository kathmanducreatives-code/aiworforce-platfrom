# Controlled TEST validation — same-task continuation claim

**Status: NOT EXECUTED.** This plan is written for a later session and must not be
run until it has been reviewed and explicitly approved.

- Target: **TEST only** — `zbwsbnqqpkvdhqwavjke`. Production `wqnigjhcwjxtmordrwno`
  is forbidden.
- No providers, no live model, no paid call. Every step is a synthetic fixture or
  a `run-agent` invocation whose checkpoint is already exhausted.
- Prerequisite: migration `20260727090000_continuation_claim_lease.sql` applied to
  TEST. Without it the RPC path is unavailable and step 10–11 exercise only the
  weaker conditional-update fallback (record which path ran — the response logs
  `claim_path`).

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

## 1. Insert the synthetic checkpointed task

One row, clearly labelled, in a scratch workspace. `result.company_first_state`
must carry `version: "company-first-state-1.0.0"`, `terminal_status: null`,
`current_round: 2`, two entries in `completed_calls`, and
`requested_lead_count: 5 / eligible_leads: 1 / remaining_leads: 4`.

Record the returned `id` as `$TASK`.

## 2. Read it back

```sql
SELECT id, status, workspace_id,
       result->'company_first_state'->>'current_round'  AS round,
       result->'company_first_state'->>'eligible_leads' AS eligible,
       jsonb_array_length(result->'company_first_state'->'completed_calls') AS calls
  FROM public.tasks WHERE id = $TASK;
```

Expect `round=2`, `eligible=1`, `calls=2`. Snapshot the whole `result` to a file —
step 8/9 compare against it.

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

## 8–9. Quota and completed-call keys unchanged by the refusal

Re-read the row and diff against the step-2 snapshot. The REFUSED invocation must
have changed nothing: `requested_lead_count`, `eligible_leads`, `remaining_leads`
and every `completed_calls[].idempotency_key` identical.

## 10. Simulate claimant failure

Expire the lease in place, without running anything:

```sql
-- RPC path (migration applied):
UPDATE public.tasks
   SET continuation_claim_expires_at = now() - interval '1 minute'
 WHERE id = $TASK;

-- Fallback path (no migration): age the JSON claim past STALE_CLAIM_MS (5 min).
UPDATE public.tasks
   SET result = jsonb_set(result, '{continuation_claim,claimed_at}',
                          to_jsonb((now() - interval '10 minutes')::text))
 WHERE id = $TASK;
```

## 11. Safe reclaim after expiry

Fire two concurrent continuations again.

- **RPC path:** exactly one succeeds. This is the property the fallback cannot
  provide and the main reason the migration exists.
- **Fallback path:** both may succeed. Record the result honestly — a double
  success here is the documented limitation, not a new bug.

## 12. Clean up

```sql
DELETE FROM public.tasks WHERE id = $TASK;
```

Then re-run step 0 and confirm the schema is unchanged.

## Abort conditions

Stop immediately and report if: any query touches a project ref other than
`zbwsbnqqpkvdhqwavjke`; a provider or model call appears in the logs; more than
one task row exists for the fixture; or the refused invocation mutated `result`.
