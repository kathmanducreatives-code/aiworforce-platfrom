-- HEADCOUNT GROWTH NEEDS A MEMORY, AND THERE WAS NONE.
--
-- ── WHAT THIS UNBLOCKS ──────────────────────────────────────────────────────
--
-- `headcountGrowth.ts` has been complete since Phase 5 and has never been able
-- to return anything but `insufficient_evidence`, because growth is a delta
-- between two dated readings and nothing in this schema kept the first one.
--
-- The reading itself already exists. `company_enrichment` calls
-- `harvestapi/linkedin-company` and gets an authoritative exact `employeeCount`
-- on every enriched company, and that number is used once for a size gate and
-- then discarded. This table is the difference between a system that knows how
-- big a company is and one that knows it is growing.
--
-- ── WHY A SEPARATE TABLE AND NOT A COLUMN ───────────────────────────────────
--
-- A `previous_employee_count` column on the company row is the obvious cheap
-- version and it is wrong twice over. It holds exactly one prior value, so a
-- third reading destroys the first and the series can never be inspected; and
-- it has no observation date of its own, so "grew by 40" cannot be separated
-- from "grew by 40 over three days", which is noise, or "over two years", which
-- is not growth anyone is buying against.
--
-- A row per observation keeps the whole series, and every verdict
-- `evaluateHeadcountGrowth` produces can then cite the two readings it used.
--
-- ── THE OBSERVATION DATE IS NOT THE CREATED DATE ────────────────────────────
--
-- `observed_at` is when the PROVIDER's reading was taken; `created_at` is when
-- this row was written. They are usually minutes apart and must not be
-- conflated: a backfill from an older enrichment run inserts rows today whose
-- observations are months old, and differencing on `created_at` would then
-- report a two-month change as having happened this afternoon.
--
-- ── EXACT COUNTS ONLY ───────────────────────────────────────────────────────
--
-- The catalog marks every provider's size BAND advisory — `teamSize` from the
-- YC scraper was observed stale (ShipBob returned 1), and the LinkedIn company
-- search's own band disagreed with reality in four of eight observed rows.
-- Differencing two bands produces a number that looks precise and is not, so
-- this table takes an exact integer and the CHECK refuses anything else.
--
-- ── SAFE BY CONSTRUCTION ────────────────────────────────────────────────────
--
-- One new table, one view, three indexes. Nothing existing is altered, no data
-- moves, and no code path yet reads it — the growth capability stays
-- UNSUPPORTED until a writer exists and two readings accumulate, which is the
-- honest state and is asserted by test.

-- ── 1. THE SERIES ───────────────────────────────────────────────────────────

create table if not exists public.company_headcount_snapshots (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,

    -- IDENTITY, DENORMALISED ON PURPOSE.
    --
    -- A snapshot is only comparable with another snapshot of the SAME company,
    -- and company identity in this system is resolved to a LinkedIn URL or a
    -- canonical domain rather than a name — two companies share a name, and
    -- differencing across them would invent growth out of a collision.
    --
    -- Both are nullable and at least one is required, because enrichment
    -- resolves whichever it can. `company_key` is the value the series is
    -- actually grouped by, derived by the writer so the grouping rule lives in
    -- one place rather than in every query.
    company_key text not null,
    linkedin_company_url text,
    canonical_domain text,
    company_name text,

    -- THE READING.
    employee_count integer not null,

    -- WHEN THE PROVIDER SAW IT, not when we stored it.
    observed_at timestamp with time zone not null,

    -- THE DAY, AS A REAL COLUMN.
    --
    -- The uniqueness rule is per-day, and a unique index over an EXPRESSION
    -- (`(observed_at::date)`) cannot be named by a client's on-conflict target,
    -- which takes a column list or a constraint name. Writers would then have
    -- to insert-and-swallow instead of upserting, and swallowing is how a
    -- genuine failure becomes indistinguishable from a duplicate.
    --
    -- Generated and stored, so it cannot drift from `observed_at`.
    observed_on date generated always as ((observed_at at time zone 'UTC')::date) stored,

    -- WHERE IT CAME FROM. A repo actor key, so a series can be filtered to one
    -- provider when two disagree — and they will.
    source text not null,
    -- The enrichment call this reading came from, for auditing a suspicious
    -- jump back to the run that produced it.
    task_id uuid,
    provider_run_id text,

    created_at timestamp with time zone default now() not null,

    constraint company_headcount_snapshots_count_positive
      check (employee_count > 0),
    -- An exact count is the only thing worth differencing. A band arrives as
    -- text elsewhere and must never be coerced into this column.
    constraint company_headcount_snapshots_has_identity
      check (linkedin_company_url is not null or canonical_domain is not null),
    constraint company_headcount_snapshots_key_nonempty
      check (length(company_key) > 0),
    -- A reading cannot have been observed after it was recorded. Catches a
    -- clock or timezone error at write time rather than as phantom growth.
    constraint company_headcount_snapshots_observed_not_future
      check (observed_at <= created_at + interval '1 day')
);

comment on table public.company_headcount_snapshots is
  'One dated employee-count reading per company per observation. Headcount growth is a delta between two of these; a single row is size, never change. Written from company_enrichment, which already obtains an authoritative exact count and used to discard it.';

comment on column public.company_headcount_snapshots.company_key is
  'The value the series is grouped by — a normalised LinkedIn company URL, else a canonical domain. Derived by the writer so the grouping rule exists once. Never a company NAME: two companies share a name and differencing across them would invent growth from a collision.';

comment on column public.company_headcount_snapshots.observed_at is
  'When the PROVIDER''s reading was taken. Distinct from created_at, which is when this row was written — a backfill inserts old observations today, and differencing on created_at would date the change wrongly.';

comment on column public.company_headcount_snapshots.employee_count is
  'EXACT headcount only. Provider size BANDS are advisory everywhere in this system — one YC source reported teamSize 1 for a company with hundreds of staff — and differencing two bands produces false precision.';

-- ── 2. ONE READING PER COMPANY PER SOURCE PER DAY ───────────────────────────
--
-- Enrichment may run several times in a day for the same company across
-- different missions. Without this, a growth series fills with same-day
-- duplicates that carry no new information and drag the "earliest" reading
-- forward, silently shortening every window.
--
-- Deliberately keyed on the DAY rather than the timestamp: the underlying
-- figure does not change hourly, so a second reading in the same day is a
-- repeat rather than an observation.

alter table public.company_headcount_snapshots
  drop constraint if exists company_headcount_snapshots_daily_uniq;

alter table public.company_headcount_snapshots
  add constraint company_headcount_snapshots_daily_uniq
  unique (workspace_id, company_key, source, observed_on);

comment on constraint company_headcount_snapshots_daily_uniq
  on public.company_headcount_snapshots is
  'One reading per company per source per day. A named constraint rather than an expression index so a writer can upsert against it and let a genuine error surface, instead of swallowing every insert failure to tolerate duplicates.';

-- ── 3. THE INDEX THE SERIES READ NEEDS ──────────────────────────────────────
--
-- Every growth query is "the readings for this company, oldest first". Ordered
-- so the range scan returns the series without a sort.

create index if not exists company_headcount_snapshots_series_idx
  on public.company_headcount_snapshots
     (workspace_id, company_key, observed_at);

-- Backfill and audit path: what did this run observe?
create index if not exists company_headcount_snapshots_task_idx
  on public.company_headcount_snapshots (task_id)
  where task_id is not null;

-- ── 4. WORKSPACE ISOLATION ──────────────────────────────────────────────────
--
-- Same contract as every other workspace-scoped table here. A headcount series
-- is competitive intelligence about a workspace's own accounts and must not
-- leak across tenants, so the growth verdict for one workspace can only ever be
-- computed from readings that workspace took.

alter table public.company_headcount_snapshots enable row level security;

drop policy if exists "chs members read" on public.company_headcount_snapshots;
create policy "chs members read"
  on public.company_headcount_snapshots
  for select to authenticated
  using (public.has_workspace_access(auth.uid(), workspace_id));

drop policy if exists "chs members insert" on public.company_headcount_snapshots;
create policy "chs members insert"
  on public.company_headcount_snapshots
  for insert to authenticated
  with check (public.has_workspace_access(auth.uid(), workspace_id));

-- NO UPDATE AND NO DELETE POLICY, deliberately.
--
-- A snapshot is an observation: it was either taken or it was not. Allowing an
-- update would let a later run rewrite what an earlier one saw, which is
-- exactly how a growth series stops being evidence. Corrections are a new row
-- with a new observation date.

-- ── 5. THE SERIES, READY TO DIFFERENCE ──────────────────────────────────────
--
-- Projects each reading beside the previous one for the same company, so the
-- delta and the gap are ordinary SQL rather than something every caller
-- re-derives. `evaluateHeadcountGrowth` remains the authority on what counts as
-- growth — this view supplies the arithmetic, never the verdict, and carries no
-- threshold of its own.

create or replace view public.company_headcount_series as
select
  s.workspace_id,
  s.company_key,
  s.company_name,
  s.linkedin_company_url,
  s.canonical_domain,
  s.source,
  s.observed_at,
  s.employee_count,
  lag(s.employee_count) over w  as previous_employee_count,
  lag(s.observed_at)    over w  as previous_observed_at,
  s.employee_count - lag(s.employee_count) over w as absolute_change,
  case
    when lag(s.employee_count) over w > 0
    then round(
      ((s.employee_count - lag(s.employee_count) over w)::numeric
        / lag(s.employee_count) over w) * 100, 2)
  end as percent_change,
  extract(day from (s.observed_at - lag(s.observed_at) over w))::integer
    as days_since_previous
from public.company_headcount_snapshots s
window w as (
  partition by s.workspace_id, s.company_key
  order by s.observed_at
);

comment on view public.company_headcount_series is
  'Each headcount reading beside the previous one for the same company, with the delta and the gap. Supplies arithmetic, never a verdict: what counts as growth — the minimum percentage, the minimum gap, the staleness ceiling — is decided by evaluateHeadcountGrowth so one rule governs, and it is deliberately absent here.';
