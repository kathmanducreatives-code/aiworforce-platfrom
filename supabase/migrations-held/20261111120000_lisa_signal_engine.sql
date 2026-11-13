-- LISA V2: reliable signal engine — persistence, lifecycle, scan orchestration.
--
-- HELD. Applied only by the disposable database-contract lane
-- (tests/db-contract/bootstrap.sh) until reviewed and approved for an isolated
-- TEST project. Purely ADDITIVE: no existing table, column, constraint, policy,
-- grant or function changes. In particular the signal_events vocabulary CHECKs
-- are untouched — LISA projects its counted `corroborated` level onto the
-- existing `provider_verified` column value and keeps the authoritative level in
-- normalized_value.lisa.verification.level.
--
-- KNOWN BLOCKER, NOT FIXED HERE (deferred to the security phase): the live
-- project still grants browser roles write access to signal_events /
-- signal_event_evidence / monitoring_subjects (see
-- docs/audits/lisa-complete-audit-2026-11). Nothing below depends on, widens or
-- uses those grants, but LISA V2 must stay disabled in any hosted environment
-- until they are revoked, because a browser could otherwise forge rows that
-- look like LISA output.
--
-- What it adds
--   lisa_record_signal(...)          service_role only. ONE transaction:
--                                    insert-or-find the event by its dedupe
--                                    identity, add evidence rows (one per source
--                                    URL), then RECOUNT verification over ALL
--                                    stored evidence and update lifecycle. Two
--                                    concurrent passes converge on one event.
--   signal_event_transitions         append-only audit of every human lifecycle
--                                    change (dismiss / dispute / retract / restore).
--   lisa_signal_transition(...)      service_role only, called by the edge
--                                    function with the caller's user + session.
--                                    Locks session → membership (FOR SHARE),
--                                    re-checks the CURRENT role with
--                                    company_brain_write_authorization('edit'),
--                                    then locks and changes the event.
--   lisa_scan_runs                   one row per (workspace, run_key). A run key
--                                    is the subject + the cadence slot, so a
--                                    duplicate scheduled execution finds the row
--                                    and does nothing. Leases recover stalled runs.
--   lisa_watch_state                 per-subject scan state: last success, next
--                                    eligible time, consecutive failures (bounded
--                                    exponential backoff), last error.
--   lisa_claim_scan_run / lisa_finish_scan_run   service_role only.
--
-- Who may write: nobody directly. Members read their workspace's rows via RLS.

-- ──────────────────────────────────────────────────────── transitions (audit)
create table if not exists public.signal_event_transitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  signal_event_id uuid not null,
  action text not null check (action in ('dismiss', 'dispute', 'retract', 'restore')),
  from_status text not null,
  to_status text not null,
  reason text check (reason is null or char_length(reason) <= 500),
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (signal_event_id, workspace_id) references public.signal_events(id, workspace_id) on delete cascade
);
create index if not exists signal_event_transitions_event_idx
  on public.signal_event_transitions (workspace_id, signal_event_id, created_at desc);

-- ──────────────────────────────────────────────────────────────── scan runs
create table if not exists public.lisa_scan_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_key text not null check (char_length(run_key) between 3 and 300),
  subject_key text not null,
  trigger text not null check (trigger in ('scheduled', 'on_demand')),
  status text not null default 'running'
    check (status in ('running', 'ok', 'partial', 'failed', 'budget_exhausted', 'empty', 'abandoned')),
  attempts int not null default 1 check (attempts >= 1),
  lease_until timestamptz not null,
  counts jsonb not null default '{}'::jsonb,
  provider_calls int not null default 0 check (provider_calls >= 0),
  credits int not null default 0 check (credits >= 0),
  model_usd numeric(10, 4) not null default 0 check (model_usd >= 0),
  error text check (error is null or char_length(error) <= 1000),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (workspace_id, run_key)
);
create index if not exists lisa_scan_runs_ws_started_idx on public.lisa_scan_runs (workspace_id, started_at desc);

create table if not exists public.lisa_watch_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subject_key text not null check (subject_key ~ '^[a-z0-9:]+([-.][a-z0-9:]+)*$'),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_eligible_at timestamptz not null default now(),
  consecutive_failures int not null default 0 check (consecutive_failures >= 0),
  last_status text,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, subject_key)
);

alter table public.signal_event_transitions enable row level security;
alter table public.lisa_scan_runs enable row level security;
alter table public.lisa_watch_state enable row level security;
revoke all on public.signal_event_transitions, public.lisa_scan_runs, public.lisa_watch_state
  from public, anon, authenticated, service_role;
grant select on public.signal_event_transitions, public.lisa_scan_runs, public.lisa_watch_state to authenticated, service_role;
create policy signal_event_transitions_member_read on public.signal_event_transitions
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));
create policy lisa_scan_runs_member_read on public.lisa_scan_runs
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));
create policy lisa_watch_state_member_read on public.lisa_watch_state
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));

-- ─────────────────────────────────────────────── verification (server side)
-- Mirrors _shared/lisa/verify.ts verify(). Pinned to it by the contract test.
create or replace function public.lisa_verification_of(p_workspace_id uuid, p_event_id uuid, p_category text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_independent int;
  v_self boolean;
  v_neg text[];
  v_retracted boolean;
  v_lo numeric; v_hi numeric; v_amounts int;
  v_contra text[] := '{}';
  v_sources text[];
begin
  select count(distinct e.normalized_value->>'domain') filter (where e.normalized_value->>'source_type' in ('news', 'other')),
         coalesce(bool_or(e.normalized_value->>'source_type' = 'company_site'), false),
         coalesce(array_agg((e.normalized_value->>'domain') || ' says "' || (e.normalized_value->>'negation') || '"')
                    filter (where coalesce(e.normalized_value->>'negation', '') <> ''), '{}'),
         coalesce(bool_or(coalesce(e.normalized_value->>'negation', '') ~* '\m(retracts?|retracted|cancell?ed|cancels|scrapped|false report|withdrawn|withdraws)\M'), false),
         min((e.normalized_value->'attributes'->>'amount_usd_m')::numeric) filter (where jsonb_typeof(e.normalized_value->'attributes'->'amount_usd_m') = 'number'),
         max((e.normalized_value->'attributes'->>'amount_usd_m')::numeric) filter (where jsonb_typeof(e.normalized_value->'attributes'->'amount_usd_m') = 'number'),
         count(*) filter (where jsonb_typeof(e.normalized_value->'attributes'->'amount_usd_m') = 'number'),
         coalesce(array_agg(distinct e.normalized_value->>'domain') filter (where e.normalized_value ? 'domain'), '{}')
    into v_independent, v_self, v_neg, v_retracted, v_lo, v_hi, v_amounts, v_sources
    from public.signal_event_evidence e
   where e.workspace_id = p_workspace_id and e.signal_event_id = p_event_id;

  v_contra := v_neg;
  if p_category = 'funding' and v_amounts >= 2 and v_lo > 0 and (v_hi - v_lo) / v_lo > 0.25 then
    v_contra := v_contra || format('sources disagree on the amount ($%sM vs $%sM)', v_lo, v_hi);
  end if;

  return jsonb_build_object(
    'level', case when cardinality(v_contra) > 0 then 'contradicted'
                  when v_independent >= 2 then 'corroborated'
                  when v_self then 'self_reported'
                  else 'single_source' end,
    'independent_sources', v_independent,
    'sources', to_jsonb(v_sources),
    'contradictions', to_jsonb(v_contra),
    'retracted', v_retracted,
    'column_status', case when cardinality(v_contra) > 0 then 'unverified'
                          when v_independent >= 2 then 'provider_verified'
                          when v_self then 'self_reported'
                          else 'unverified' end,
    'confidence', case when cardinality(v_contra) > 0 then 'low'
                       when v_independent >= 2 then 'high'
                       when v_self then case when v_independent > 0 then 'high' else 'medium' end
                       else 'low' end
  );
end;
$$;
revoke all on function public.lisa_verification_of(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.lisa_verification_of(uuid, uuid, text) to service_role;

-- ─────────────────────────────────────────────────────────── record signal
-- p_event    the signal_events columns (validated by the table's CHECKs) plus
--            normalized_value (with normalized_value.lisa).
-- p_evidence array of { fingerprint, source_url, observed_at, normalized_value }.
create or replace function public.lisa_record_signal(p_workspace_id uuid, p_event jsonb, p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_life text;
  v_added int := 0;
  v_n int;
  v_ev jsonb;
  v_ver jsonb;
  v_new_life text;
  v_category text := p_event->'normalized_value'->'lisa'->>'category';
begin
  if p_workspace_id is null or p_event is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then
    raise exception 'lisa_record_signal: workspace, event and at least one evidence row are required' using errcode = '22023';
  end if;
  if coalesce(p_event->>'source_url', '') !~ '^https?://' then
    raise exception 'lisa_record_signal: a LISA signal needs a source URL' using errcode = '22023';
  end if;

  insert into public.signal_events as se (
    workspace_id, origin, signal_type, signal_category, evidence_category, subject_type, subject_key,
    occurred_at, occurred_at_basis, observed_at, expires_at, confidence, verification_status,
    normalized_value, dedupe_key, lifecycle_status, sanitized, provider, actor_key, source_url
  ) values (
    p_workspace_id, p_event->>'origin', p_event->>'signal_type', p_event->>'signal_category',
    p_event->>'evidence_category', p_event->>'subject_type', p_event->>'subject_key',
    (p_event->>'occurred_at')::timestamptz, coalesce(p_event->>'occurred_at_basis', 'unknown'),
    coalesce((p_event->>'observed_at')::timestamptz, now()), (p_event->>'expires_at')::timestamptz,
    'low', 'unverified', coalesce(p_event->'normalized_value', '{}'::jsonb), p_event->>'dedupe_key',
    'active', true, p_event->>'provider', 'lisa_v2', p_event->>'source_url'
  )
  on conflict (workspace_id, dedupe_key) do nothing
  returning se.id into v_id;

  if v_id is not null then
    v_status := 'new';
  end if;
  -- Lock the event (new or existing) so concurrent passes serialize the recount.
  select se.id, se.lifecycle_status into v_id, v_life
    from public.signal_events se
   where se.workspace_id = p_workspace_id and se.dedupe_key = p_event->>'dedupe_key'
   for update;
  if v_id is null then
    raise exception 'lisa_record_signal: event vanished' using errcode = '40001';
  end if;

  for v_ev in select * from jsonb_array_elements(p_evidence) loop
    if coalesce(v_ev->>'source_url', '') !~ '^https?://' or coalesce(v_ev->>'fingerprint', '') = '' then
      raise exception 'lisa_record_signal: evidence needs a source URL and a fingerprint' using errcode = '22023';
    end if;
    insert into public.signal_event_evidence (
      workspace_id, signal_event_id, provider, actor_key, source_url, evidence_fingerprint, observed_at,
      verification_status, confidence, normalized_value, sanitized
    ) values (
      p_workspace_id, v_id, p_event->>'provider', 'lisa_v2', v_ev->>'source_url', v_ev->>'fingerprint',
      coalesce((v_ev->>'observed_at')::timestamptz, now()),
      case when v_ev->'normalized_value'->>'source_type' = 'company_site' then 'self_reported' else 'unverified' end,
      null, coalesce(v_ev->'normalized_value', '{}'::jsonb), true
    )
    on conflict (workspace_id, signal_event_id, evidence_fingerprint) do nothing;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;

  if v_status is null then
    v_status := case when v_added > 0 then 'updated' else 'duplicate' end;
  end if;

  v_ver := public.lisa_verification_of(p_workspace_id, v_id, v_category);
  -- Human decisions (dismissed) and retractions are sticky; evidence only ever
  -- moves an event TOWARD contradicted / retracted, never back to active.
  v_new_life := case
    when coalesce(v_life, 'active') in ('dismissed', 'retracted', 'archived') then v_life
    when (v_ver->>'retracted')::boolean then 'retracted'
    when v_ver->>'level' = 'contradicted' then 'contradicted'
    else coalesce(v_life, 'active') end;

  update public.signal_events se
     set verification_status = v_ver->>'column_status',
         confidence = v_ver->>'confidence',
         lifecycle_status = v_new_life,
         normalized_value = jsonb_set(
           case when v_status = 'new' then se.normalized_value
                else jsonb_set(se.normalized_value, '{lisa,relevance}',
                       coalesce(p_event->'normalized_value'->'lisa'->'relevance', se.normalized_value->'lisa'->'relevance', 'null'::jsonb), true) end,
           '{lisa,verification}', v_ver, true)
   where se.id = v_id;

  return jsonb_build_object('status', v_status, 'event_id', v_id, 'evidence_added', v_added,
    'verification_level', v_ver->>'level', 'lifecycle_status', v_new_life);
end;
$$;
revoke all on function public.lisa_record_signal(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.lisa_record_signal(uuid, jsonb, jsonb) to service_role;

-- ─────────────────────────────────────────────────── human lifecycle change
create or replace function public.lisa_signal_transition(
  p_workspace_id uuid, p_actor_id uuid, p_session_id uuid, p_signal_event_id uuid, p_action text, p_reason text default null
)
returns table (outcome text, lifecycle_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth text;
  v_from text;
  v_to text;
begin
  if p_action is null or p_action not in ('dismiss', 'dispute', 'retract', 'restore') then
    raise exception 'lisa_signal_transition: invalid action %', p_action using errcode = '22023';
  end if;
  perform 1 from auth.sessions s
   where s.id = p_session_id and s.user_id = p_actor_id and (s.not_after is null or s.not_after > clock_timestamp())
   for share;
  perform 1 from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id
   for share;
  v_auth := public.company_brain_write_authorization(p_workspace_id, p_actor_id, p_session_id, 'edit');
  if v_auth <> 'ok' then
    return query select v_auth, null::text; return;
  end if;

  select se.lifecycle_status into v_from from public.signal_events se
   where se.id = p_signal_event_id and se.workspace_id = p_workspace_id
   for update;
  if not found then
    return query select 'not_found'::text, null::text; return;
  end if;

  v_to := case p_action
    when 'dismiss' then case when v_from in ('active', 'stale', 'contradicted', 'expired') then 'dismissed' end
    when 'dispute' then case when v_from in ('active', 'stale') then 'contradicted' end
    when 'retract' then case when v_from not in ('retracted', 'archived') then 'retracted' end
    -- Restore only undoes a human dismissal. It can never revive a retraction or
    -- an evidence-detected contradiction (that would elevate a disputed claim).
    when 'restore' then case when v_from = 'dismissed' then 'active' end
  end;
  if v_to is null then
    return query select 'invalid_transition'::text, v_from; return;
  end if;

  update public.signal_events se set lifecycle_status = v_to where se.id = p_signal_event_id;
  insert into public.signal_event_transitions (workspace_id, signal_event_id, action, from_status, to_status, reason, actor_user_id)
  values (p_workspace_id, p_signal_event_id, p_action, v_from, v_to, nullif(btrim(coalesce(p_reason, '')), ''), p_actor_id);
  return query select 'ok'::text, v_to;
end;
$$;
revoke all on function public.lisa_signal_transition(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.lisa_signal_transition(uuid, uuid, uuid, uuid, text, text) to service_role;

-- ──────────────────────────────────────────────────────────── scan claiming
-- outcome: claimed | reclaimed (stalled lease recovered) | already_running |
--          already_done | exhausted (attempt cap reached) | not_eligible
create or replace function public.lisa_claim_scan_run(
  p_workspace_id uuid, p_run_key text, p_subject_key text, p_trigger text,
  p_lease_seconds int default 300, p_max_attempts int default 3, p_ignore_eligibility boolean default false
)
returns table (outcome text, run_id uuid, attempts int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_run public.lisa_scan_runs;
  v_next timestamptz;
begin
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 3600 then
    raise exception 'lisa_claim_scan_run: lease must be 10..3600 seconds' using errcode = '22023';
  end if;
  if not p_ignore_eligibility then
    select ws.next_eligible_at into v_next from public.lisa_watch_state ws
     where ws.workspace_id = p_workspace_id and ws.subject_key = p_subject_key;
    if v_next is not null and v_next > v_now then
      return query select 'not_eligible'::text, null::uuid, 0; return;
    end if;
  end if;

  insert into public.lisa_scan_runs as r (workspace_id, run_key, subject_key, trigger, lease_until)
  values (p_workspace_id, p_run_key, p_subject_key, p_trigger, v_now + make_interval(secs => p_lease_seconds))
  on conflict (workspace_id, run_key) do nothing
  returning r.* into v_run;
  if v_run.id is not null then
    return query select 'claimed'::text, v_run.id, v_run.attempts; return;
  end if;

  select r.* into v_run from public.lisa_scan_runs r
   where r.workspace_id = p_workspace_id and r.run_key = p_run_key for update;
  if v_run.status in ('ok', 'empty', 'partial', 'budget_exhausted') then
    return query select 'already_done'::text, v_run.id, v_run.attempts; return;
  end if;
  if v_run.status = 'running' and v_run.lease_until > v_now then
    return query select 'already_running'::text, v_run.id, v_run.attempts; return;
  end if;
  if v_run.attempts >= p_max_attempts then
    if v_run.status = 'running' then
      update public.lisa_scan_runs set status = 'abandoned', finished_at = v_now,
             error = 'lease expired after the final attempt' where id = v_run.id;
    end if;
    return query select 'exhausted'::text, v_run.id, v_run.attempts; return;
  end if;
  update public.lisa_scan_runs
     set status = 'running', attempts = v_run.attempts + 1, lease_until = v_now + make_interval(secs => p_lease_seconds),
         finished_at = null, error = null
   where id = v_run.id;
  return query select 'reclaimed'::text, v_run.id, v_run.attempts + 1;
end;
$$;
revoke all on function public.lisa_claim_scan_run(uuid, text, text, text, int, int, boolean) from public, anon, authenticated;
grant execute on function public.lisa_claim_scan_run(uuid, text, text, text, int, int, boolean) to service_role;

-- Finish a run and advance the subject's scan state. A failure backs off
-- exponentially (15 min · 2^failures, capped at 24 h); success schedules the
-- next scan one cadence later. Only the CURRENT attempt may finish (a late
-- writer from a superseded attempt is refused).
create or replace function public.lisa_finish_scan_run(
  p_run_id uuid, p_attempt int, p_status text, p_counts jsonb, p_provider_calls int, p_credits int,
  p_model_usd numeric, p_error text, p_cadence_minutes int
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_run public.lisa_scan_runs;
  v_fail int;
  v_success boolean := p_status in ('ok', 'empty');
begin
  if p_status not in ('ok', 'partial', 'failed', 'budget_exhausted', 'empty') then
    raise exception 'lisa_finish_scan_run: invalid status %', p_status using errcode = '22023';
  end if;
  select r.* into v_run from public.lisa_scan_runs r where r.id = p_run_id for update;
  if not found then return 'not_found'; end if;
  if v_run.status <> 'running' or v_run.attempts <> p_attempt then return 'superseded'; end if;

  update public.lisa_scan_runs
     set status = p_status, counts = coalesce(p_counts, '{}'::jsonb), provider_calls = greatest(0, coalesce(p_provider_calls, 0)),
         credits = greatest(0, coalesce(p_credits, 0)), model_usd = greatest(0, coalesce(p_model_usd, 0)),
         error = left(p_error, 1000), finished_at = v_now
   where id = p_run_id;

  insert into public.lisa_watch_state as w (workspace_id, subject_key)
  values (v_run.workspace_id, v_run.subject_key)
  on conflict (workspace_id, subject_key) do nothing;
  select w.consecutive_failures into v_fail from public.lisa_watch_state w
   where w.workspace_id = v_run.workspace_id and w.subject_key = v_run.subject_key for update;
  v_fail := case when v_success or p_status = 'partial' then 0 else v_fail + 1 end;
  update public.lisa_watch_state w
     set last_attempt_at = v_now,
         last_success_at = case when v_success or p_status = 'partial' then v_now else w.last_success_at end,
         next_eligible_at = case
           when p_status = 'budget_exhausted' then v_now + interval '24 hours'
           when v_fail = 0 then v_now + make_interval(mins => greatest(60, coalesce(p_cadence_minutes, 10080)))
           else v_now + least(interval '24 hours', interval '15 minutes' * power(2, v_fail - 1)) end,
         consecutive_failures = v_fail,
         last_status = p_status,
         last_error = left(p_error, 1000),
         updated_at = v_now
   where w.workspace_id = v_run.workspace_id and w.subject_key = v_run.subject_key;
  return 'ok';
end;
$$;
revoke all on function public.lisa_finish_scan_run(uuid, int, text, jsonb, int, int, numeric, text, int) from public, anon, authenticated;
grant execute on function public.lisa_finish_scan_run(uuid, int, text, jsonb, int, int, numeric, text, int) to service_role;
