-- WHAT A WORKSPACE HAS ASKED AGENTORY TO WATCH.
--
-- ── THE GAP THIS FILLS ──────────────────────────────────────────────────────
--
-- Radar scans whatever the Company Brain implies, every time, with no memory of
-- what a workspace actually cares about. There is nowhere to say "watch
-- Outreach" or "tell me when anyone in my ICP raises". Phase 3 needs that to
-- exist before monitoring can be an orchestration rather than a repeated
-- one-shot scan.
--
-- ── NOT `signal_events.subject_type` ────────────────────────────────────────
--
-- These are different things and the distinction is the point:
--
--   monitoring subject  what the workspace asked to watch      (this table)
--   signal event subject what a discovered event turned out
--                        to be about                           (Phase 2)
--
-- A scan can produce evidence about a competitor nobody tracks, and a tracked
-- company can produce no evidence at all. Collapsing them would mean a
-- workspace could only ever see evidence about things it had already named —
-- which is the opposite of monitoring.
--
-- ── IDENTITY, NOT LABELS ────────────────────────────────────────────────────
--
-- A named subject stores an `identifier` the shared capability engine can
-- actually resolve: a domain or a LinkedIn company URL. A display name is not
-- an identity — two companies share one — so `label` exists for the UI and is
-- never used to match.
--
-- `icp` names no single entity: it means "companies like my customers", and the
-- Company Brain supplies the profile at compile time. Its identifier is
-- therefore null, and the partial unique index below is what stops a workspace
-- accumulating five identical ICP subscriptions.

create table if not exists public.monitoring_subjects (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,

    subject_kind text not null,
    -- Domain or LinkedIn company URL. NULL only for `icp`.
    identifier text,
    -- Display only. Never an identity.
    label text,

    -- WHICH SIGNALS TO WATCH FOR.
    --
    -- On the subject rather than global: one tracked company may be watched for
    -- hiring while a competitor is watched for launches. Stored as the canonical
    -- {event, subject} pairs the mission compiler emits, so the vocabulary is the
    -- one `missionSignalDescriptor` owns rather than a second list.
    signals jsonb not null default '[]'::jsonb,

    -- How far back evidence stays interesting for this subject.
    timeframe_days integer,

    -- Paused rather than deleted: a workspace that stops watching a competitor
    -- usually wants the history, and deleting the subject would orphan nothing
    -- but would lose why the evidence was collected.
    enabled boolean not null default true,

    -- Phase 3 runs monitoring on demand. `cadence_minutes` is stored now and
    -- read by Phase 6's scheduler; recording it here avoids a migration later
    -- for a column whose meaning is already decided.
    cadence_minutes integer,
    last_run_at timestamp with time zone,

    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),

    constraint monitoring_subjects_kind_valid
      check (subject_kind in ('icp', 'tracked_company', 'competitor')),

    -- ICP NAMES NOTHING; EVERYTHING ELSE MUST NAME SOMETHING.
    --
    -- The all-or-nothing shape mirrors `signal_events_subject_pair_complete`:
    -- a tracked company with no identifier is a row the engine cannot act on,
    -- and storing it would produce a monitoring subject that silently never
    -- yields anything.
    constraint monitoring_subjects_identifier_coherent
      check (
        (subject_kind = 'icp' and identifier is null)
        or (subject_kind <> 'icp' and identifier is not null and length(trim(identifier)) > 0)
      ),

    -- A subject that watches for nothing is a subscription to silence.
    constraint monitoring_subjects_signals_nonempty
      check (jsonb_typeof(signals) = 'array' and jsonb_array_length(signals) > 0),

    constraint monitoring_subjects_timeframe_positive
      check (timeframe_days is null or timeframe_days > 0),
    constraint monitoring_subjects_cadence_positive
      check (cadence_minutes is null or cadence_minutes > 0)
);

comment on table public.monitoring_subjects is
  'What a workspace has asked Agentory to watch. NOT signal_events.subject_type, which is what a discovered event turned out to be about — a scan can produce evidence about a competitor nobody tracks, and a tracked company can produce no evidence at all.';
comment on column public.monitoring_subjects.identifier is
  'A domain or LinkedIn company URL the shared capability engine can resolve. NULL only for icp. Never a display name: two companies share a name, so a label cannot be matched.';
comment on column public.monitoring_subjects.signals is
  'Canonical {event, subject} pairs, per subject — one tracked company may be watched for hiring while a competitor is watched for launches.';
comment on column public.monitoring_subjects.cadence_minutes is
  'Read by Phase 6 scheduling. Stored now because the meaning is already decided; Phase 3 runs monitoring on demand.';

-- ── ONE SUBSCRIPTION PER THING ──────────────────────────────────────────────
--
-- Two partial indexes rather than one, because `identifier` is null for `icp`
-- and NULLs are distinct in a unique index — so a single index over
-- (workspace, kind, identifier) would happily allow five ICP subscriptions.

create unique index if not exists monitoring_subjects_named_uniq
  on public.monitoring_subjects (workspace_id, subject_kind, lower(trim(identifier)))
  where identifier is not null;

create unique index if not exists monitoring_subjects_icp_uniq
  on public.monitoring_subjects (workspace_id)
  where subject_kind = 'icp';

create index if not exists monitoring_subjects_due_idx
  on public.monitoring_subjects (workspace_id, enabled, last_run_at)
  where enabled;

-- ── WORKSPACE ISOLATION ─────────────────────────────────────────────────────
--
-- Same contract as every other workspace-scoped table. A watchlist states what
-- a business cares about competitively and must not leak across tenants.

alter table public.monitoring_subjects enable row level security;

drop policy if exists "ms members read" on public.monitoring_subjects;
create policy "ms members read"
  on public.monitoring_subjects for select to authenticated
  using (public.has_workspace_access(auth.uid(), workspace_id));

drop policy if exists "ms members insert" on public.monitoring_subjects;
create policy "ms members insert"
  on public.monitoring_subjects for insert to authenticated
  with check (public.has_workspace_access(auth.uid(), workspace_id));

drop policy if exists "ms members update" on public.monitoring_subjects;
create policy "ms members update"
  on public.monitoring_subjects for update to authenticated
  using (public.has_workspace_access(auth.uid(), workspace_id))
  with check (public.has_workspace_access(auth.uid(), workspace_id));

drop policy if exists "ms members delete" on public.monitoring_subjects;
create policy "ms members delete"
  on public.monitoring_subjects for delete to authenticated
  using (public.has_workspace_access(auth.uid(), workspace_id));
