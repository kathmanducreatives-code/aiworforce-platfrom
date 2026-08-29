-- THE LINEAGE BECOMES A ROW, AND A ROW CAN BE LOCKED.
--
-- ── THE STATE THIS EXISTS TO MAKE IMPOSSIBLE ───────────────────────────────
--
-- 2026-08-29, conversation 4c4ddb5a, one user request. Three generations of it
-- executed AT THE SAME TIME, each buying from Apify:
--
--   06d3544a  company_search   11:12:17 → 11:12:36   $0.125
--   06d3544a  company_details  11:13:03 → 11:13:14   $0.0001
--   237717dd  company_details  11:13:12 → 11:13:27   $0.0001  ← child starts
--   06d3544a  job_search       11:13:15 → 11:14:04   $0.062   ← parent's BEST call
--   0ed83116  company_details  11:13:21 → 11:13:27   reused   ← grandchild starts
--   06d3544a  stage_result     11:14:23 → 11:14:24            ← parent finally ends
--
-- The parent verified three companies as actively hiring — Blue Signal Search
-- with 13 cited job rows, Storm3 with 2, Storm4 with 1 — at 11:14:07, SIXTY-SIX
-- SECONDS after its own continuation had already started from a checkpoint that
-- predated all of it. Nothing overwrote that evidence. It was simply never read
-- again: each child read its ancestor's `result` once, at dispatch, and the
-- lineage's "current" state became whichever leaf happened to finish last.
--
-- Zero leads have been persisted since 2026-08-21.
--
-- ── WHY A NEW TABLE AND NOT ANOTHER GUARD ──────────────────────────────────
--
-- `continue-workflow` ALREADY refuses to fork a live parent:
--
--     if (!taskIsTerminal(i.task.status)) return { refusal: "task_not_terminal" };
--
-- The guard is correct. The STATUS is the lie — it was written ~80s before the
-- invocation ended. Every guard built on `tasks.status` inherits that lie, and
-- `claim_sourcing_continuation`, which is otherwise exactly the right mechanism,
-- is keyed on ONE TASK — so a continuation that creates a NEW task contends with
-- nothing.
--
-- The missing thing is not another check. It is an entity that owns the right to
-- execute, and a row is the only thing Postgres can lock.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ────────────────────────────────────────
--
-- Nothing here changes behaviour on its own. The table is unread until
-- `lineageLease.ts` is wired in, and that wiring ships behind
-- `LINEAGE_LEASE_ENFORCED`, which defaults to shadow mode: acquire, log what it
-- WOULD have refused, enforce nothing. Applying this migration to a running
-- system is inert.

-- ── 1. THE LINEAGE ─────────────────────────────────────────────────────────
--
-- `lineage_id` IS THE ROOT TASK ID, deliberately. Every existing run already
-- carries `result->>'lead_resume_lineage_root'`, so historical data maps onto
-- this table with no invention and no guessing.

create table if not exists public.lead_lineages (
  lineage_id        uuid primary key,
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,

  -- The approved mission this lineage is executing. A lineage whose mission hash
  -- changes is a different question and must not adopt this one's state.
  mission_hash      text,

  -- ── THE ONE AUTHORITATIVE CHECKPOINT ────────────────────────────────────
  --
  -- Today each task holds its own snapshot and there is no answer to "what does
  -- this lineage currently know". This column is that answer. `state_version` is
  -- what makes a stale writer detectable instead of silently orphaned: a
  -- generation reads a version, and its write is refused unless the version is
  -- still current.
  state_version     integer not null default 0,
  current_state     jsonb,

  -- ── THE RIGHT TO EXECUTE ────────────────────────────────────────────────
  --
  -- Held by exactly one task at a time. The expiry is what stops a killed
  -- isolate from deadlocking a lineage for ever: an expired lease is
  -- reclaimable, and reclaiming bumps `state_version`, which invalidates
  -- anything the dead generation might still try to write.
  lease_holder      uuid,
  lease_expires_at  timestamptz,
  generation        integer not null default 0,

  status            text not null default 'active'
                    check (status in ('active', 'running', 'terminal')),
  terminal_reason   text,

  -- Progress is what distinguishes "come back to this" from "this is going
  -- nowhere". Lineage 9da530ae ran five generations, four of which made zero
  -- provider calls and changed nothing, because nothing compared one generation
  -- to the last.
  last_progress_at  timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A terminal lineage must say why. "It stopped" is not an outcome.
  constraint lead_lineages_terminal_has_reason
    check (status <> 'terminal' or terminal_reason is not null),
  -- A lease without an expiry is a deadlock waiting to happen.
  constraint lead_lineages_lease_is_bounded
    check ((lease_holder is null) = (lease_expires_at is null))
);

create index if not exists lead_lineages_workspace_status_idx
  on public.lead_lineages (workspace_id, status, updated_at desc);

-- The sweeper's scan: lineages whose lease has lapsed and which are not finished.
create index if not exists lead_lineages_reclaimable_idx
  on public.lead_lineages (lease_expires_at)
  where status <> 'terminal';

alter table public.lead_lineages enable row level security;
-- No policy: service-role only, like every other execution table. A deny-by-default
-- table cannot leak one workspace's execution state to another's client.

-- ── 2. TASKS BELONG TO A LINEAGE ───────────────────────────────────────────

alter table public.tasks
  add column if not exists lineage_id uuid references public.lead_lineages(lineage_id);

create index if not exists tasks_lineage_idx
  on public.tasks (lineage_id, created_at)
  where lineage_id is not null;

-- ── THE HARD BACKSTOP ───────────────────────────────────────────────────────
--
-- The lease is the mechanism; this index is the proof. Even if every application
-- guard is wrong, the database refuses a second live generation.
--
-- PARTIAL ON THE LIVE STATUSES ONLY: a lineage accumulates many finished tasks
-- over its life and all of them are legal. What is never legal is two at once.
create unique index if not exists tasks_one_live_generation_per_lineage
  on public.tasks (lineage_id)
  where lineage_id is not null and status in ('pending', 'running');

-- ── 3. ONE CONTINUATION CHILD PER PARENT ───────────────────────────────────
--
-- `continuationKey` is already computed in `workflowContinuation.ts`, with a
-- comment explaining that it deliberately excludes any nonce so that "two clicks
-- a second apart must collide" — and then it is thrown away, because
-- `task_plans` has nowhere to put it. The duplicate check that replaced it is a
-- SELECT followed by an INSERT with no unique index behind it, which is a
-- time-of-check/time-of-use race by construction.
--
-- This is where that key belongs.

alter table public.task_plans
  add column if not exists idempotency_key text;

create unique index if not exists task_plans_idempotency_uniq
  on public.task_plans (workspace_id, idempotency_key)
  where idempotency_key is not null;

-- ── 4. ACQUIRE ─────────────────────────────────────────────────────────────
--
-- SECURITY INVOKER, like `claim_sourcing_continuation`: the caller's own rights
-- decide, and the function adds serialisation rather than privilege.
--
-- `SELECT … FOR UPDATE` before deciding is what makes two simultaneous
-- reclaimers safe. Under READ COMMITTED a conditional UPDATE alone leaves the
-- stale-reclaim gap open — two claimants can both compare a dead lease against
-- itself and both match. Taking the row lock first serialises the decision.

create or replace function public.acquire_lineage_lease(
  p_lineage_id     uuid,
  p_workspace_id   uuid,
  p_holder_task_id uuid,
  p_mission_hash   text default null,
  p_lease_seconds  integer default 180
)
returns table (
  acquired      boolean,
  reason        text,
  state_version integer,
  current_state jsonb,
  generation    integer,
  held_by       uuid,
  held_until    timestamptz
)
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row  public.lead_lineages%rowtype;
  v_secs integer := greatest(coalesce(p_lease_seconds, 180), 30);
begin
  if p_lineage_id is null or p_workspace_id is null or p_holder_task_id is null then
    return query select false, 'invalid_arguments'::text, null::integer, null::jsonb,
                        null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  -- FIRST START CREATES THE LINEAGE. Idempotent: a racing second insert loses
  -- harmlessly and falls through to the locked read below.
  insert into public.lead_lineages (lineage_id, workspace_id, mission_hash, status)
  values (p_lineage_id, p_workspace_id, p_mission_hash, 'active')
  on conflict (lineage_id) do nothing;

  select * into v_row from public.lead_lineages
   where lineage_id = p_lineage_id
     for update;

  if not found then
    return query select false, 'lineage_not_found'::text, null::integer, null::jsonb,
                        null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  if v_row.workspace_id is distinct from p_workspace_id then
    return query select false, 'workspace_mismatch'::text, null::integer, null::jsonb,
                        null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  -- A FINISHED LINEAGE IS FINISHED. Re-running it would re-buy its provider work.
  if v_row.status = 'terminal' then
    return query select false, 'already_terminal'::text, v_row.state_version,
                        null::jsonb, v_row.generation, null::uuid, null::timestamptz;
    return;
  end if;

  -- ── THE REFUSAL THAT MATTERS ────────────────────────────────────────────
  --
  -- A live lease held by somebody else. This is the exact condition that was
  -- missing on 2026-08-29 at 11:13:10 and again at 11:13:19.
  --
  -- Re-entrant for the SAME holder: a task that already owns the lease renews it
  -- rather than deadlocking against itself.
  if v_row.lease_holder is not null
     and v_row.lease_expires_at is not null
     and v_row.lease_expires_at > now()
     and v_row.lease_holder <> p_holder_task_id then
    return query select false, 'already_leased'::text, v_row.state_version,
                        null::jsonb, v_row.generation,
                        v_row.lease_holder, v_row.lease_expires_at;
    return;
  end if;

  -- MISSION HASH IS CHECKED, NOT OVERWRITTEN. A lineage executes one approved
  -- mission; a different one is a different question and must not inherit this
  -- lineage's paid state.
  if p_mission_hash is not null
     and v_row.mission_hash is not null
     and v_row.mission_hash <> p_mission_hash then
    return query select false, 'mission_mismatch'::text, v_row.state_version,
                        null::jsonb, v_row.generation, null::uuid, null::timestamptz;
    return;
  end if;

  update public.lead_lineages
     set lease_holder     = p_holder_task_id,
         lease_expires_at = now() + make_interval(secs => v_secs),
         generation       = public.lead_lineages.generation + 1,
         status           = 'running',
         mission_hash     = coalesce(public.lead_lineages.mission_hash, p_mission_hash),
         updated_at       = now()
   where lineage_id = p_lineage_id;

  return query select true, 'acquired'::text, v_row.state_version, v_row.current_state,
                      v_row.generation + 1, p_holder_task_id,
                      now() + make_interval(secs => v_secs);
end;
$$;

-- ── 5. RELEASE, WITH COMPARE-AND-SWAP ──────────────────────────────────────
--
-- The lease is released HERE and nowhere else — after the invocation has
-- finished, not when a terminal status is composed. That ordering is the
-- completion barrier: while this has not run, the generation is still live and
-- no successor may start.
--
-- The state write is a CAS on `state_version`. A generation that read version 7
-- may only write version 8; if something else already did, this returns
-- `version_conflict` and the caller must re-read and merge rather than
-- blind-write. Merging is the caller's job because only the engine knows that
-- company evidence is MONOTONIC — a merge may add rows or upgrade a verdict, and
-- may never downgrade a company that was verified with citations.

create or replace function public.release_lineage_lease(
  p_lineage_id      uuid,
  p_workspace_id    uuid,
  p_holder_task_id  uuid,
  p_expected_version integer,
  p_next_state      jsonb default null,
  p_terminal_reason text default null,
  p_made_progress   boolean default false
)
returns table (
  released      boolean,
  reason        text,
  state_version integer
)
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.lead_lineages%rowtype;
begin
  select * into v_row from public.lead_lineages
   where lineage_id = p_lineage_id
     for update;

  if not found then
    return query select false, 'lineage_not_found'::text, null::integer;
    return;
  end if;
  if v_row.workspace_id is distinct from p_workspace_id then
    return query select false, 'workspace_mismatch'::text, v_row.state_version;
    return;
  end if;

  -- NOT THE HOLDER, NOT THE WRITER. A generation whose lease expired and was
  -- reclaimed by somebody else must not write its stale state over the live one.
  -- This is the guard that makes lease expiry safe.
  if v_row.lease_holder is distinct from p_holder_task_id then
    return query select false, 'not_lease_holder'::text, v_row.state_version;
    return;
  end if;

  -- THE COMPARE-AND-SWAP. Only checked when there is state to write: a
  -- generation that produced nothing may still release its lease.
  if p_next_state is not null and v_row.state_version is distinct from p_expected_version then
    return query select false, 'version_conflict'::text, v_row.state_version;
    return;
  end if;

  update public.lead_lineages
     set current_state     = coalesce(p_next_state, public.lead_lineages.current_state),
         state_version     = case when p_next_state is not null
                                  then public.lead_lineages.state_version + 1
                                  else public.lead_lineages.state_version end,
         lease_holder      = null,
         lease_expires_at  = null,
         status            = case when p_terminal_reason is not null then 'terminal' else 'active' end,
         terminal_reason   = coalesce(p_terminal_reason, public.lead_lineages.terminal_reason),
         last_progress_at  = case when p_made_progress then now()
                                  else public.lead_lineages.last_progress_at end,
         updated_at        = now()
   where lineage_id = p_lineage_id;

  return query select true, 'released'::text,
                      v_row.state_version + (case when p_next_state is not null then 1 else 0 end);
end;
$$;

grant execute on function public.acquire_lineage_lease(uuid, uuid, uuid, text, integer) to authenticated, service_role;
grant execute on function public.release_lineage_lease(uuid, uuid, uuid, integer, jsonb, text, boolean) to authenticated, service_role;
