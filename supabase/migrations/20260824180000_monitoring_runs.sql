-- WHERE A MONITORING PASS KEEPS WHAT IT ALREADY PAID FOR.
--
-- ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
--
-- A Lead run checkpoints into its `tasks` row: the engine's
-- `CapabilityExecutionState` is written there, and a continuation passes it back
-- so the run picks up where it stopped. Monitoring has no task — it is fired by
-- a cadence, not by a person — so it had nowhere to put that state, and every
-- invocation started from nothing.
--
-- Live run 2026-08-24 is what that cost. `harvestapi/linkedin-job-search`
-- SUCCEEDED in 156s having found 12 openings; the tool's poll gives up at 90s
-- and reports the run PENDING with its id, exactly as designed. With nowhere to
-- keep that id, the next invocation started a SECOND run of the same search and
-- lost the first one's result — a paid run discarded every time.
--
-- ── WHAT IS STORED, AND WHAT IS NOT ─────────────────────────────────────────
--
-- One row per (workspace, mission_hash): the state as the engine produced it.
-- The mission hash is part of the key because a state belongs to a QUESTION —
-- the engine re-checks it and discards a state compiled from different
-- subjects, so a row can never make one monitor continue another's run.
--
-- No company rows, no evidence, no candidate data. `signal_events` is the only
-- place a monitoring finding is published; this table holds execution
-- bookkeeping and nothing a reader would ever want to see.

create table if not exists public.monitoring_runs (
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  -- The engine's own hash of the compiled mission. Not a foreign key: the
  -- mission is derived from the subjects on every run and is never stored.
  mission_hash   text not null,
  -- `CapabilityExecutionState`, verbatim. Read back only after its `version`
  -- and `mission_hash` are checked in code.
  state          jsonb not null,
  -- Denormalised so "is anything still in flight?" is answerable without
  -- parsing the state — the question a scheduler asks most often.
  pending_runs   integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (workspace_id, mission_hash),
  constraint monitoring_runs_pending_nonneg check (pending_runs >= 0)
);

create index if not exists monitoring_runs_workspace_idx
  on public.monitoring_runs (workspace_id, updated_at desc);

alter table public.monitoring_runs enable row level security;

-- READ-ONLY TO MEMBERS. Nothing in the app writes this: the state is produced
-- by the engine inside an edge function and written with the service role, so a
-- member who could write it could make the engine adopt a run id they chose.
create policy monitoring_runs_select on public.monitoring_runs
  for select using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = monitoring_runs.workspace_id
        and m.user_id = auth.uid()
    )
  );
