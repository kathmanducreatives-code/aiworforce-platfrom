-- PHASE 6 — WHAT A SCHEDULE NEEDS THAT A MANUAL SCAN DOES NOT.
--
-- ── TWO THINGS, AND ONLY TWO ────────────────────────────────────────────────
--
-- A CLAIM, so two schedulers firing at once produce one scan. `last_run_at`
-- already records when a pass COMPLETED, and that is not the same fact: a run
-- in flight has not completed, and using one column for both would either let a
-- second scheduler start the same work or mark a subject done before it was.
--
-- The claim is a LEASE, not a flag. A flag set by a run that then crashes
-- freezes the subject forever; a lease expires, and the work returns.
--
-- A CEILING, per workspace per period. Every existing guard answers "may THIS
-- call happen" — the credit reserve, the per-scan ceiling, containment. None of
-- them can stop a hundred small calls a day for a month, which is exactly the
-- shape of unattended spend.
--
-- ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
--
-- No table of what has been spent. `credit_transactions` already records every
-- charge with its workspace and time, so a period total is a query rather than
-- a second ledger that could disagree with the first.

alter table public.monitoring_subjects
  -- WHEN A SCHEDULER TOOK THIS WORK. Null means nobody holds it.
  add column if not exists claimed_at timestamptz;

comment on column public.monitoring_subjects.claimed_at is
  'Lease held by a scheduler while a pass runs. Distinct from last_run_at, '
  'which records completion. Expires so a crashed run cannot freeze a subject.';

create index if not exists monitoring_subjects_due_idx
  on public.monitoring_subjects (workspace_id, enabled, last_run_at)
  where enabled;

-- ── THE PER-WORKSPACE MONITORING CEILING ────────────────────────────────────
--
-- One row per workspace. A workspace with no row uses the default, so enabling
-- monitoring never requires remembering to insert a budget — and a workspace
-- that wants scheduled scans OFF sets the ceiling to zero rather than deleting
-- its subjects.
create table if not exists public.monitoring_budgets (
  workspace_id     uuid primary key references public.workspaces(id) on delete cascade,
  -- Credits per period. Zero means scheduled monitoring is off for this
  -- workspace; the subjects stay configured and simply do not fire.
  period_ceiling   integer not null default 200,
  period_days      integer not null default 7,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint monitoring_budgets_ceiling_nonneg check (period_ceiling >= 0),
  constraint monitoring_budgets_period_positive check (period_days between 1 and 90)
);

alter table public.monitoring_budgets enable row level security;

-- READ-ONLY TO MEMBERS. The ceiling is what stands between a workspace and an
-- unattended bill, so it is changed by an operator with the service role, never
-- by the client that spends against it.
create policy monitoring_budgets_select on public.monitoring_budgets
  for select using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = monitoring_budgets.workspace_id
        and m.user_id = auth.uid()
    )
  );

-- ── WHAT THIS WORKSPACE HAS SPENT ON MONITORING THIS PERIOD ─────────────────
--
-- Derived from the credit ledger rather than counted separately. A second
-- counter is a second truth, and the first time they disagree nobody can say
-- which one the workspace was actually charged against.
--
-- `provider_call` is the only kind a monitoring pass creates, and `charged` is
-- the only status that took money — a reservation that was refunded did not.
create or replace function public.monitoring_spend_in_period(
  p_workspace uuid,
  p_period_days integer default 7
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(actual_credits), 0)::integer
  from public.credit_transactions
  where workspace_id = p_workspace
    and status = 'charged'
    and kind = 'provider_call'
    and created_at >= now() - make_interval(days => greatest(1, p_period_days));
$$;

revoke all on function public.monitoring_spend_in_period(uuid, integer) from public;
grant execute on function public.monitoring_spend_in_period(uuid, integer) to service_role;
