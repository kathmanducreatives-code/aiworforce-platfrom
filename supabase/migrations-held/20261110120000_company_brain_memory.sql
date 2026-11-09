-- Company Brain V1: versioned, source-backed shared memory.
--
-- HELD. Not applied anywhere but the disposable database-contract lane
-- (tests/db-contract/bootstrap.sh) until it is reviewed and approved for the
-- isolated TEST project (docs/plans/company-brain/V1_TEST_DEPLOYMENT.md). It is
-- additive: no existing table, column, policy or function changes behaviour,
-- except company_brain_authorized_write, which gains two transaction-local
-- settings so the revision trigger can record WHO wrote (its signature, checks,
-- locks and outcomes are byte-for-byte the 20261024120000 definition).
--
-- What it adds
--   company_brain_revisions        append-only snapshot of company_brain.profile
--                                  for every MATERIAL change (trigger), with the
--                                  sections that changed, the actor and the time.
--                                  Existing Brains are back-filled as revision 1.
--   company_brain_memory           one row per memory item — a company FACT, a
--                                  PREFERENCE (incl. exclusions) or a DECISION —
--                                  holding its CURRENT value, version, provenance,
--                                  verification, confidence and lifecycle.
--   company_brain_memory_history   append-only: the full prior state of an item
--                                  before every change, plus proposal reviews and
--                                  redactions. Never updated except by redaction.
--   company_brain_memory_proposals agent-proposed knowledge. PENDING until an
--                                  editor/admin/owner approves, corrects or
--                                  rejects it. Never trusted on its own.
--   company_brain_memory_requests  idempotency ledger: a retried request returns
--                                  the first outcome and writes nothing new.
--
-- Who may write
--   Nobody writes these tables directly: not anon, not authenticated, not even
--   service_role. Every mutation goes through the SECURITY DEFINER functions
--   below (service_role only), which — in ONE transaction — lock the caller's
--   live auth session, then their membership row (FOR SHARE), re-check the
--   CURRENT role with company_brain_write_authorization (the same rule as
--   _shared/brainRole.ts), then lock and change the memory rows. Lock order:
--   session → membership → memory/proposal row (the same order as the Brain
--   writer, so the two cannot deadlock). Members read their own workspace's rows
--   through RLS; nobody reads another workspace's.
--
-- Honesty rules enforced by CHECK constraints (not just by code)
--   * a model inference or agent suggestion is never 'corroborated' or
--     'provider_reported'; after human review it is 'user_confirmed' and its
--     source_type still says what it was;
--   * 'corroborated' needs a source URL or reference;
--   * an item created from an agent proposal must carry an approver;
--   * at most ONE active item per (workspace, kind, key, scope, scope ref).
--
-- Rollback (nothing outside this file depends on these objects):
--   drop trigger company_brain_record_revision on public.company_brain;
--   drop function public.company_brain_record_revision();
--   drop function public.company_brain_memory_write(uuid, uuid, uuid, text, jsonb, text);
--   drop function public.company_brain_proposal_submit(uuid, text, jsonb);
--   drop function public.company_brain_proposal_review(uuid, uuid, uuid, uuid, text, jsonb, text, integer, text);
--   drop function public.company_brain_memory_redact(uuid, uuid, uuid, text, uuid, text);
--   drop function public.company_brain_memory_authorize(uuid, uuid, uuid, text);
--   drop function public.company_brain_memory_value_valid(text, jsonb);
--   drop function public.company_brain_memory_snapshot(public.company_brain_memory);
--   drop function public.company_brain_memory_guard_history();
--   drop table public.company_brain_memory_requests, public.company_brain_memory_history,
--              public.company_brain_memory_proposals, public.company_brain_memory,
--              public.company_brain_revisions;
--   then re-apply 20261024120000_company_brain_authorized_writer.sql (drops the
--   two set_config lines; harmless if left).

-- ─────────────────────────────────────────────────────────── value validation
create or replace function public.company_brain_memory_value_valid(p_type text, p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'text' then jsonb_typeof(p_value) = 'string' and length(btrim(p_value #>> '{}')) between 1 and 2000
    when 'list' then jsonb_typeof(p_value) = 'array'
                 and jsonb_array_length(p_value) between 1 and 100
                 and not exists (select 1 from jsonb_array_elements(p_value) e
                                  where jsonb_typeof(e) <> 'string' or length(btrim(e #>> '{}')) = 0)
    when 'number_range' then jsonb_typeof(p_value) = 'object'
                 and (p_value ? 'min' or p_value ? 'max')
                 and (not p_value ? 'min' or jsonb_typeof(p_value->'min') in ('number', 'null'))
                 and (not p_value ? 'max' or jsonb_typeof(p_value->'max') in ('number', 'null'))
                 and (jsonb_typeof(p_value->'min') is distinct from 'number'
                      or jsonb_typeof(p_value->'max') is distinct from 'number'
                      or (p_value->>'min')::numeric <= (p_value->>'max')::numeric)
    when 'boolean' then jsonb_typeof(p_value) = 'boolean'
    when 'object' then jsonb_typeof(p_value) = 'object' and p_value <> '{}'::jsonb
    when 'redacted' then p_value = 'null'::jsonb
    else false
  end;
$$;

-- ───────────────────────────────────────────────────────── profile revisions
create table if not exists public.company_brain_revisions (
  id               uuid primary key default extensions.gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  revision         bigint not null,
  profile          jsonb not null,
  onboarding_completed boolean not null default false,
  -- Top-level profile keys whose value changed in this revision (all keys for revision 1).
  changed_sections text[] not null default '{}',
  actor_kind       text not null,
  actor_id         uuid,
  permission       text,
  written_at       timestamptz not null default clock_timestamp(),
  redacted_at      timestamptz,
  redacted_by      uuid,
  redaction_reason text,
  constraint company_brain_revisions_unique unique (workspace_id, revision),
  constraint company_brain_revisions_actor_kind_valid check (actor_kind in ('user', 'system', 'backfill')),
  constraint company_brain_revisions_user_has_actor check (actor_kind <> 'user' or actor_id is not null)
);
create index if not exists company_brain_revisions_recent_idx
  on public.company_brain_revisions (workspace_id, written_at desc);

comment on table public.company_brain_revisions is
  'Append-only history of company_brain.profile: one row per MATERIAL change (identical rewrites add nothing). Written only by the company_brain_record_revision trigger; redacted only by company_brain_memory_redact.';

-- Back-fill: every existing Brain becomes revision 1, so history starts from
-- what is there today rather than from the first edit after this migration.
insert into public.company_brain_revisions
  (workspace_id, revision, profile, onboarding_completed, changed_sections, actor_kind, actor_id, written_at)
select b.workspace_id, 1, b.profile, b.onboarding_completed,
       coalesce((select array_agg(k order by k) from jsonb_object_keys(b.profile) k), '{}'),
       'backfill', null, b.updated_at
  from public.company_brain b
 where not exists (select 1 from public.company_brain_revisions r where r.workspace_id = b.workspace_id);

create or replace function public.company_brain_record_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := nullif(current_setting('agentory.brain_actor', true), '');
  v_perm  text := nullif(current_setting('agentory.brain_permission', true), '');
  v_next  bigint;
  v_changed text[];
begin
  if tg_op = 'UPDATE'
     and new.profile is not distinct from old.profile
     and new.onboarding_completed is not distinct from old.onboarding_completed then
    return null;  -- a retry or a no-op save: no new version
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into v_changed
      from (select jsonb_object_keys(new.profile) k
            union select jsonb_object_keys(old.profile)) keys
     where (new.profile -> k) is distinct from (old.profile -> k);
    if new.onboarding_completed is distinct from old.onboarding_completed then
      v_changed := array_append(v_changed, '_onboarding_completed');
    end if;
  else
    select coalesce(array_agg(k order by k), '{}') into v_changed from jsonb_object_keys(new.profile) k;
  end if;
  select coalesce(max(r.revision), 0) + 1 into v_next
    from public.company_brain_revisions r where r.workspace_id = new.workspace_id;
  insert into public.company_brain_revisions
    (workspace_id, revision, profile, onboarding_completed, changed_sections, actor_kind, actor_id, permission, written_at)
  values (new.workspace_id, v_next, new.profile, new.onboarding_completed, v_changed,
          case when v_actor is null then 'system' else 'user' end,
          v_actor::uuid, v_perm, clock_timestamp());
  return null;
end;
$$;
revoke all on function public.company_brain_record_revision() from public, anon, authenticated, service_role;

drop trigger if exists company_brain_record_revision on public.company_brain;
create trigger company_brain_record_revision
  after insert or update of profile, onboarding_completed on public.company_brain
  for each row execute function public.company_brain_record_revision();

-- The authorized writer, unchanged except for the two set_config lines that let
-- the trigger name the actor. Transaction-local (third argument true): they
-- vanish at commit and cannot leak into another request on the same connection.
create or replace function public.company_brain_authorized_write(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_session_id uuid,
  p_permission text,
  p_mode text,
  p_profile jsonb,
  p_expected_updated_at timestamptz default null,
  p_activate boolean default false
)
returns table (outcome text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_auth text;
  v_written timestamptz;
begin
  if p_permission is null or p_permission not in ('edit', 'activate') then
    raise exception 'company_brain_authorized_write: invalid permission %', p_permission using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('cas', 'insert', 'upsert') then
    raise exception 'company_brain_authorized_write: invalid mode %', p_mode using errcode = '22023';
  end if;
  if p_activate and p_permission <> 'activate' then
    raise exception 'company_brain_authorized_write: activation requires the activate permission' using errcode = '22023';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_profile is null then
    raise exception 'company_brain_authorized_write: missing argument' using errcode = '22023';
  end if;

  perform 1 from auth.sessions s
   where s.id = p_session_id and s.user_id = p_actor_id
     and (s.not_after is null or s.not_after > v_now)
   for share;
  perform 1 from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id
   for share;

  v_auth := public.company_brain_write_authorization(p_workspace_id, p_actor_id, p_session_id, p_permission);
  if v_auth <> 'ok' then
    return query select v_auth, null::timestamptz; return;
  end if;

  perform set_config('agentory.brain_actor', p_actor_id::text, true);
  perform set_config('agentory.brain_permission', p_permission, true);

  if p_mode = 'cas' then
    if p_expected_updated_at is null then
      raise exception 'company_brain_authorized_write: cas needs expected_updated_at' using errcode = '22023';
    end if;
    update public.company_brain b
       set profile = p_profile,
           updated_at = v_now,
           onboarding_completed = case when p_activate then true else b.onboarding_completed end,
           onboarding_completed_at = case when p_activate then v_now else b.onboarding_completed_at end
     where b.workspace_id = p_workspace_id and b.updated_at = p_expected_updated_at
    returning b.updated_at into v_written;
  elsif p_mode = 'insert' then
    insert into public.company_brain as b (workspace_id, profile, updated_at, onboarding_completed, onboarding_completed_at)
    values (p_workspace_id, p_profile, v_now, p_activate, case when p_activate then v_now end)
    on conflict (workspace_id) do nothing
    returning b.updated_at into v_written;
  else -- upsert
    insert into public.company_brain as b (workspace_id, profile, updated_at, onboarding_completed, onboarding_completed_at)
    values (p_workspace_id, p_profile, v_now, p_activate, case when p_activate then v_now end)
    on conflict (workspace_id) do update
       set profile = excluded.profile,
           updated_at = excluded.updated_at,
           onboarding_completed = case when p_activate then true else b.onboarding_completed end,
           onboarding_completed_at = case when p_activate then excluded.updated_at else b.onboarding_completed_at end
    returning b.updated_at into v_written;
  end if;

  if v_written is null then
    return query select 'stale'::text, null::timestamptz; return;
  end if;
  return query select 'ok'::text, v_written;
end;
$$;
revoke all on function public.company_brain_authorized_write(uuid, uuid, uuid, text, text, jsonb, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.company_brain_authorized_write(uuid, uuid, uuid, text, text, jsonb, timestamptz, boolean) to service_role;

-- ───────────────────────────────────────────────────────────── memory items
create table if not exists public.company_brain_memory (
  id                  uuid primary key default extensions.gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  kind                text not null,
  category            text not null,
  -- Canonical identity of WHAT this is about: 'icp.company_size',
  -- 'exclusion.industry:gambling', 'competitor:rivalco.com', 'lead_rejected'.
  fact_key            text not null,
  -- WHERE it applies. A decision about one lead is scope 'lead' + its id; only a
  -- 'workspace' item applies everywhere.
  scope               text not null default 'workspace',
  scope_ref           text,
  value_type          text not null,
  value               jsonb not null,
  version             integer not null default 1,
  source_type         text not null,
  source_ref          text,
  source_url          text,
  verification_status text not null,
  confidence          text not null default 'medium',
  lifecycle_status    text not null default 'active',
  persistence         text not null default 'persistent',
  approval_status     text not null default 'not_required',
  created_by_kind     text not null,
  created_by          uuid,
  created_by_agent    text,
  updated_by          uuid,
  approved_by         uuid,
  approved_at         timestamptz,
  proposal_id         uuid,
  supersedes_id       uuid references public.company_brain_memory(id) on delete set null,
  reason              text,
  observed_at         timestamptz not null default clock_timestamp(),
  review_at           timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz not null default clock_timestamp(),
  updated_at          timestamptz not null default clock_timestamp(),
  redacted_at         timestamptz,
  constraint cbm_kind_valid check (kind in ('fact', 'preference', 'decision')),
  constraint cbm_category_shape check (category ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint cbm_key_shape check (length(fact_key) between 1 and 200 and fact_key = lower(fact_key)),
  constraint cbm_scope_valid check (scope in ('workspace', 'agent', 'lead', 'account', 'signal', 'recommendation', 'content', 'mission')),
  constraint cbm_scope_ref_coherent check ((scope = 'workspace') = (scope_ref is null)),
  constraint cbm_value_valid check (public.company_brain_memory_value_valid(value_type, value)),
  constraint cbm_version_positive check (version >= 1),
  constraint cbm_source_type_valid check (source_type in
    ('user_provided', 'corroborated', 'provider_returned', 'model_inference', 'agent_suggestion', 'system_migration')),
  constraint cbm_verification_valid check (verification_status in
    ('user_confirmed', 'corroborated', 'provider_reported', 'unverified')),
  constraint cbm_confidence_valid check (confidence in ('high', 'medium', 'low')),
  constraint cbm_lifecycle_valid check (lifecycle_status in
    ('active', 'stale', 'disputed', 'superseded', 'rejected', 'retracted', 'expired')),
  constraint cbm_persistence_valid check (persistence in ('persistent', 'temporary')),
  constraint cbm_temporary_expires check (persistence <> 'temporary' or expires_at is not null),
  constraint cbm_approval_valid check (approval_status in ('not_required', 'approved')),
  constraint cbm_creator_valid check (created_by_kind in ('user', 'agent', 'system')),
  constraint cbm_user_has_creator check (created_by_kind <> 'user' or created_by is not null),
  -- THE HONESTY RULES.
  constraint cbm_inference_never_verified check (
    source_type not in ('model_inference', 'agent_suggestion')
    or verification_status in ('unverified', 'user_confirmed')),
  constraint cbm_provider_not_corroborated check (
    source_type <> 'provider_returned' or verification_status <> 'corroborated'),
  constraint cbm_corroborated_has_source check (
    verification_status <> 'corroborated' or source_url is not null or source_ref is not null),
  constraint cbm_user_provided_confirmed check (
    source_type <> 'user_provided' or verification_status = 'user_confirmed'),
  constraint cbm_agent_items_approved check (
    created_by_kind <> 'agent' or (approval_status = 'approved' and approved_by is not null and proposal_id is not null)),
  constraint cbm_source_url_shape check (source_url is null or source_url ~* '^https?://')
);

create unique index if not exists company_brain_memory_one_active
  on public.company_brain_memory (workspace_id, kind, fact_key, scope, coalesce(scope_ref, ''))
  where lifecycle_status = 'active';
create index if not exists company_brain_memory_read_idx
  on public.company_brain_memory (workspace_id, lifecycle_status, kind, updated_at desc);

comment on table public.company_brain_memory is
  'Company Brain memory items: facts, preferences (incl. exclusions) and decisions, each with its current value, version and provenance. Prior versions live in company_brain_memory_history. Written only through company_brain_memory_write / company_brain_proposal_review.';

-- ─────────────────────────────────────────────────────────────── proposals
create table if not exists public.company_brain_memory_proposals (
  id                  uuid primary key default extensions.gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  proposed_by_agent   text not null,
  kind                text not null,
  category            text not null,
  fact_key            text not null,
  scope               text not null default 'workspace',
  scope_ref           text,
  value_type          text not null,
  value               jsonb not null,
  rationale           text not null,
  -- [{source_url?, source_ref?, observed_at?, excerpt?}] — what the agent saw.
  evidence            jsonb not null default '[]'::jsonb,
  source_type         text not null,
  confidence          text not null default 'low',
  status              text not null default 'pending',
  dedupe_key          text not null,
  contradicts_memory_id uuid references public.company_brain_memory(id) on delete set null,
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  review_note         text,
  resulting_memory_id uuid references public.company_brain_memory(id) on delete set null,
  created_at          timestamptz not null default clock_timestamp(),
  updated_at          timestamptz not null default clock_timestamp(),
  constraint cbmp_agent_valid check (proposed_by_agent in ('orion', 'atlas', 'lyra', 'lisa')),
  constraint cbmp_kind_valid check (kind in ('fact', 'preference')),
  constraint cbmp_category_shape check (category ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint cbmp_key_shape check (length(fact_key) between 1 and 200 and fact_key = lower(fact_key)),
  constraint cbmp_scope_valid check (scope in ('workspace', 'agent', 'lead', 'account', 'signal', 'recommendation', 'content', 'mission')),
  constraint cbmp_scope_ref_coherent check ((scope = 'workspace') = (scope_ref is null)),
  constraint cbmp_value_valid check (public.company_brain_memory_value_valid(value_type, value)),
  -- An agent can only offer what it inferred, suggested or was told by a provider.
  constraint cbmp_source_type_valid check (source_type in ('model_inference', 'agent_suggestion', 'provider_returned')),
  constraint cbmp_confidence_valid check (confidence in ('high', 'medium', 'low')),
  constraint cbmp_status_valid check (status in ('pending', 'approved', 'corrected', 'rejected', 'withdrawn')),
  constraint cbmp_evidence_array check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 50),
  constraint cbmp_provider_needs_evidence check (source_type <> 'provider_returned' or jsonb_array_length(evidence) >= 1),
  constraint cbmp_rationale_present check (length(btrim(rationale)) between 1 and 2000),
  constraint cbmp_reviewed_coherent check ((status = 'pending') = (reviewed_at is null))
);
create unique index if not exists company_brain_memory_proposals_one_pending
  on public.company_brain_memory_proposals (workspace_id, dedupe_key) where status = 'pending';
create index if not exists company_brain_memory_proposals_read_idx
  on public.company_brain_memory_proposals (workspace_id, status, created_at desc);
create index if not exists company_brain_memory_proposals_dedupe_idx
  on public.company_brain_memory_proposals (workspace_id, dedupe_key, status);

alter table public.company_brain_memory
  add constraint company_brain_memory_proposal_fk foreign key (proposal_id)
  references public.company_brain_memory_proposals(id) on delete set null;

-- ───────────────────────────────────────────────────────────────── history
create table if not exists public.company_brain_memory_history (
  id            uuid primary key default extensions.gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  memory_id     uuid references public.company_brain_memory(id) on delete cascade,
  proposal_id   uuid references public.company_brain_memory_proposals(id) on delete cascade,
  change_kind   text not null,
  -- The item's version BEFORE this change (null when the change created it).
  from_version  integer,
  to_version    integer,
  -- Full item state before / after (value + provenance), as company_brain_memory_snapshot renders it.
  previous      jsonb,
  current       jsonb,
  actor_kind    text not null,
  actor_id      uuid,
  actor_agent   text,
  reason        text,
  idempotency_key text,
  created_at    timestamptz not null default clock_timestamp(),
  redacted_at   timestamptz,
  constraint cbmh_target_present check (memory_id is not null or proposal_id is not null),
  constraint cbmh_change_valid check (change_kind in (
    'created', 'updated', 'corrected', 'retracted', 'disputed', 'marked_stale', 'reactivated',
    'superseded', 'approved_from_proposal', 'corrected_from_proposal', 'proposal_rejected', 'redacted')),
  constraint cbmh_actor_valid check (actor_kind in ('user', 'agent', 'system')),
  constraint cbmh_user_has_actor check (actor_kind <> 'user' or actor_id is not null)
);
create index if not exists company_brain_memory_history_item_idx
  on public.company_brain_memory_history (memory_id, created_at desc);
create index if not exists company_brain_memory_history_ws_idx
  on public.company_brain_memory_history (workspace_id, created_at desc);

-- History is append-only. Only company_brain_memory_redact (which sets the
-- transaction-local flag) may blank a value; nothing may delete a row except
-- the workspace cascade.
create or replace function public.company_brain_memory_guard_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- The workspace (or item) cascade is the one legitimate deletion.
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'company Brain history is append-only' using errcode = '42501';
  end if;
  if coalesce(current_setting('agentory.brain_redaction', true), '') <> 'on' then
    raise exception 'company Brain history is append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists company_brain_memory_history_guard on public.company_brain_memory_history;
create trigger company_brain_memory_history_guard
  before update or delete on public.company_brain_memory_history
  for each row execute function public.company_brain_memory_guard_history();
drop trigger if exists company_brain_revisions_guard on public.company_brain_revisions;
create trigger company_brain_revisions_guard
  before update or delete on public.company_brain_revisions
  for each row execute function public.company_brain_memory_guard_history();

-- ─────────────────────────────────────────────────────────────── idempotency
create table if not exists public.company_brain_memory_requests (
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null,
  request_hash    text not null,
  result          jsonb,
  created_at      timestamptz not null default clock_timestamp(),
  primary key (workspace_id, idempotency_key),
  constraint cbmr_key_shape check (length(idempotency_key) between 8 and 200)
);

-- ─────────────────────────────────────────────────────────────── grants + RLS
alter table public.company_brain_revisions enable row level security;
alter table public.company_brain_memory enable row level security;
alter table public.company_brain_memory_proposals enable row level security;
alter table public.company_brain_memory_history enable row level security;
alter table public.company_brain_memory_requests enable row level security;

revoke all on public.company_brain_revisions, public.company_brain_memory, public.company_brain_memory_proposals,
              public.company_brain_memory_history, public.company_brain_memory_requests
  from public, anon, authenticated, service_role;
grant select on public.company_brain_revisions, public.company_brain_memory, public.company_brain_memory_proposals,
                public.company_brain_memory_history to authenticated, service_role;

create policy company_brain_revisions_member_read on public.company_brain_revisions
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));
create policy company_brain_memory_member_read on public.company_brain_memory
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));
create policy company_brain_memory_proposals_member_read on public.company_brain_memory_proposals
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));
create policy company_brain_memory_history_member_read on public.company_brain_memory_history
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));
-- service_role bypasses RLS for SELECT (the shared loader); it has no write grant.

-- ─────────────────────────────────────────────────────────── shared helpers
create or replace function public.company_brain_memory_snapshot(m public.company_brain_memory)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'version', m.version, 'value_type', m.value_type, 'value', m.value,
    'source_type', m.source_type, 'source_ref', m.source_ref, 'source_url', m.source_url,
    'verification_status', m.verification_status, 'confidence', m.confidence,
    'lifecycle_status', m.lifecycle_status, 'persistence', m.persistence,
    'approval_status', m.approval_status, 'observed_at', m.observed_at,
    'expires_at', m.expires_at, 'review_at', m.review_at, 'reason', m.reason,
    'updated_by', m.updated_by, 'updated_at', m.updated_at);
$$;
revoke all on function public.company_brain_memory_snapshot(public.company_brain_memory) from public, anon, authenticated;

-- Lock session → membership, then apply THE rule on the locked rows.
create or replace function public.company_brain_memory_authorize(
  p_workspace_id uuid, p_actor_id uuid, p_session_id uuid, p_permission text)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if p_workspace_id is null or p_actor_id is null then return 'not_member'; end if;
  perform 1 from auth.sessions s
   where s.id = p_session_id and s.user_id = p_actor_id
     and (s.not_after is null or s.not_after > clock_timestamp())
   for share;
  perform 1 from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id
   for share;
  return public.company_brain_write_authorization(p_workspace_id, p_actor_id, p_session_id, p_permission);
end;
$$;
revoke all on function public.company_brain_memory_authorize(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────── THE memory writer
--
-- p_op: 'set'      create an item, or add a version to the active one (CAS on
--                  payload.expected_version when one exists)
--       'correct'  same as set, recorded as a correction
--       'decide'   record a decision (kind decision; same-subject same-outcome
--                  is already_recorded, a different outcome is a new version)
--       'retract' | 'dispute' | 'mark_stale' | 'reactivate'
--                  lifecycle changes on payload.memory_id (CAS on expected_version)
-- Returns {outcome, memory_id?, version?, reason?, replayed?}. Outcomes:
--   ok | unchanged | already_recorded | stale | not_found | invalid |
--   idempotency_conflict | session_invalid | not_member | forbidden_role
create or replace function public.company_brain_memory_write(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_session_id uuid,
  p_op text,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth text;
  v_hash text;
  v_prior jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
  v_kind text; v_category text; v_key text; v_scope text; v_scope_ref text;
  v_type text; v_value jsonb; v_source_type text; v_verification text;
  v_cur public.company_brain_memory;
  v_new public.company_brain_memory;
  v_expected integer;
  v_change text;
  v_target_status text;
  v_decision_workspace_ok boolean;
begin
  if p_op is null or p_op not in ('set', 'correct', 'decide', 'retract', 'dispute', 'mark_stale', 'reactivate') then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'unknown op');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'payload must be an object');
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'idempotency_key required (8-200 chars)');
  end if;

  v_auth := public.company_brain_memory_authorize(p_workspace_id, p_actor_id, p_session_id, 'edit');
  if v_auth <> 'ok' then return jsonb_build_object('outcome', v_auth); end if;

  -- IDEMPOTENCY. The insert blocks behind a concurrent request with the same
  -- key until it commits; then the stored result is replayed.
  v_hash := md5(p_op || '|' || p_payload::text);
  insert into public.company_brain_memory_requests (workspace_id, idempotency_key, request_hash)
  values (p_workspace_id, p_idempotency_key, v_hash)
  on conflict do nothing;
  if not found then
    select r.request_hash, r.result into v_hash, v_prior
      from public.company_brain_memory_requests r
     where r.workspace_id = p_workspace_id and r.idempotency_key = p_idempotency_key;
    if v_hash <> md5(p_op || '|' || p_payload::text) then
      return jsonb_build_object('outcome', 'idempotency_conflict');
    end if;
    return coalesce(v_prior, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;

  -- ── LIFECYCLE CHANGES ────────────────────────────────────────────────────
  if p_op in ('retract', 'dispute', 'mark_stale', 'reactivate') then
    if coalesce(p_payload->>'memory_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(p_payload->>'expected_version', '') !~ '^[0-9]{1,9}$' then
      v_result := jsonb_build_object('outcome', 'invalid', 'reason', 'memory_id and expected_version required');
      update public.company_brain_memory_requests r set result = v_result
       where r.workspace_id = p_workspace_id and r.idempotency_key = p_idempotency_key;
      return v_result;
    end if;
    select * into v_cur from public.company_brain_memory m
     where m.id = (p_payload->>'memory_id')::uuid and m.workspace_id = p_workspace_id
     for update;
    if not found then
      v_result := jsonb_build_object('outcome', 'not_found');
    else
      v_expected := nullif(p_payload->>'expected_version', '')::integer;
      v_target_status := case p_op when 'retract' then 'retracted' when 'dispute' then 'disputed'
                                   when 'mark_stale' then 'stale' else 'active' end;
      v_change := case p_op when 'retract' then 'retracted' when 'dispute' then 'disputed'
                            when 'mark_stale' then 'marked_stale' else 'reactivated' end;
      if v_expected is null or v_expected <> v_cur.version then
        v_result := jsonb_build_object('outcome', 'stale', 'memory_id', v_cur.id, 'version', v_cur.version);
      elsif v_cur.lifecycle_status = v_target_status then
        v_result := jsonb_build_object('outcome', 'unchanged', 'memory_id', v_cur.id, 'version', v_cur.version);
      elsif p_op = 'reactivate' and v_cur.lifecycle_status not in ('stale', 'disputed') then
        v_result := jsonb_build_object('outcome', 'invalid', 'reason', 'only a stale or disputed item can be reactivated');
      elsif p_op <> 'reactivate' and v_cur.lifecycle_status not in ('active', 'stale', 'disputed') then
        v_result := jsonb_build_object('outcome', 'invalid', 'reason', 'item is ' || v_cur.lifecycle_status);
      else
        update public.company_brain_memory m
           set lifecycle_status = v_target_status, version = m.version + 1,
               updated_by = p_actor_id, updated_at = v_now,
               reason = coalesce(nullif(btrim(p_payload->>'reason'), ''), m.reason)
         where m.id = v_cur.id
        returning * into v_new;
        insert into public.company_brain_memory_history
          (workspace_id, memory_id, change_kind, from_version, to_version, previous, current,
           actor_kind, actor_id, reason, idempotency_key)
        values (p_workspace_id, v_cur.id, v_change, v_cur.version, v_new.version,
                public.company_brain_memory_snapshot(v_cur), public.company_brain_memory_snapshot(v_new),
                'user', p_actor_id, nullif(btrim(p_payload->>'reason'), ''), p_idempotency_key);
        v_result := jsonb_build_object('outcome', 'ok', 'memory_id', v_new.id, 'version', v_new.version);
      end if;
    end if;
    update public.company_brain_memory_requests r set result = v_result
     where r.workspace_id = p_workspace_id and r.idempotency_key = p_idempotency_key;
    return v_result;
  end if;

  -- ── SET / CORRECT / DECIDE ───────────────────────────────────────────────
  v_kind := case when p_op = 'decide' then 'decision' else lower(coalesce(p_payload->>'kind', '')) end;
  v_category := lower(btrim(coalesce(p_payload->>'category', '')));
  v_key := lower(btrim(coalesce(p_payload->>'fact_key', case when p_op = 'decide' then p_payload->>'category' end, '')));
  v_scope := lower(coalesce(nullif(p_payload->>'scope', ''), 'workspace'));
  v_scope_ref := nullif(btrim(coalesce(p_payload->>'scope_ref', '')), '');
  v_type := coalesce(p_payload->>'value_type', case when p_op = 'decide' then 'object' end);
  v_value := p_payload->'value';
  v_source_type := coalesce(p_payload->>'source_type', 'user_provided');
  -- A person writing through the app is the source; anything else they cite is a reference.
  if v_source_type not in ('user_provided', 'corroborated', 'provider_returned') then
    v_result := jsonb_build_object('outcome', 'invalid', 'reason', 'a user write cannot claim source_type ' || v_source_type);
  elsif p_op <> 'decide' and v_kind not in ('fact', 'preference') then
    v_result := jsonb_build_object('outcome', 'invalid', 'reason', 'kind must be fact or preference');
  elsif v_category !~ '^[a-z][a-z0-9_]{1,40}$' or length(v_key) not between 1 and 200 then
    v_result := jsonb_build_object('outcome', 'invalid', 'reason', 'category/fact_key malformed');
  elsif v_scope not in ('workspace', 'agent', 'lead', 'account', 'signal', 'recommendation', 'content', 'mission')
        or ((v_scope = 'workspace') <> (v_scope_ref is null)) then
    v_result := jsonb_build_object('outcome', 'invalid', 'reason', 'scope/scope_ref incoherent');
  elsif v_type is null or v_value is null or not public.company_brain_memory_value_valid(v_type, v_value) then
    v_result := jsonb_build_object('outcome', 'invalid', 'reason', 'value does not match value_type');
  elsif coalesce(p_payload->>'persistence', 'persistent') = 'temporary' and nullif(p_payload->>'expires_at', '') is null then
    v_result := jsonb_build_object('outcome', 'invalid', 'reason', 'a temporary item needs expires_at');
  end if;

  -- DECISIONS CANNOT GENERALISE THEMSELVES. A decision about one lead, signal or
  -- recommendation must name it; only these decision types may be workspace-wide.
  if v_result is null and p_op = 'decide' then
    v_decision_workspace_ok := v_category in ('icp_changed', 'strategy_selected', 'brand_preference', 'exclusion_added', 'correction');
    if v_scope = 'workspace' and not v_decision_workspace_ok then
      v_result := jsonb_build_object('outcome', 'invalid',
        'reason', v_category || ' applies to one record: give scope and scope_ref');
    elsif jsonb_typeof(v_value->'outcome') is distinct from 'string' then
      v_result := jsonb_build_object('outcome', 'invalid', 'reason', 'a decision needs value.outcome');
    end if;
  end if;

  if v_result is not null then
    update public.company_brain_memory_requests r set result = v_result
     where r.workspace_id = p_workspace_id and r.idempotency_key = p_idempotency_key;
    return v_result;
  end if;

  v_verification := case v_source_type when 'user_provided' then 'user_confirmed'
                                       when 'corroborated' then 'corroborated'
                                       else 'provider_reported' end;

  select * into v_cur from public.company_brain_memory m
   where m.workspace_id = p_workspace_id and m.kind = v_kind and m.fact_key = v_key
     and m.scope = v_scope and coalesce(m.scope_ref, '') = coalesce(v_scope_ref, '')
     and m.lifecycle_status = 'active'
   for update;

  if found then
    v_expected := nullif(p_payload->>'expected_version', '')::integer;
    if p_op = 'decide' and v_cur.value->>'outcome' = v_value->>'outcome' then
      v_result := jsonb_build_object('outcome', 'already_recorded', 'memory_id', v_cur.id, 'version', v_cur.version);
    elsif p_op <> 'decide' and (v_expected is null or v_expected <> v_cur.version) then
      v_result := jsonb_build_object('outcome', 'stale', 'memory_id', v_cur.id, 'version', v_cur.version);
    elsif p_op <> 'decide' and v_cur.value = v_value and v_cur.value_type = v_type
          and v_cur.source_type = v_source_type
          and v_cur.source_url is not distinct from nullif(p_payload->>'source_url', '') then
      v_result := jsonb_build_object('outcome', 'unchanged', 'memory_id', v_cur.id, 'version', v_cur.version);
    else
      update public.company_brain_memory m
         set value_type = v_type, value = v_value, version = m.version + 1,
             category = v_category,
             source_type = v_source_type, verification_status = v_verification,
             source_ref = nullif(p_payload->>'source_ref', ''),
             source_url = nullif(p_payload->>'source_url', ''),
             confidence = coalesce(nullif(p_payload->>'confidence', ''), 'high'),
             persistence = coalesce(nullif(p_payload->>'persistence', ''), 'persistent'),
             expires_at = nullif(p_payload->>'expires_at', '')::timestamptz,
             review_at = nullif(p_payload->>'review_at', '')::timestamptz,
             observed_at = coalesce(nullif(p_payload->>'observed_at', '')::timestamptz, v_now),
             reason = nullif(btrim(p_payload->>'reason'), ''),
             -- A person writing this version owns it; it is no longer an agent's.
             created_by_kind = case when m.created_by_kind = 'agent' then 'user' else m.created_by_kind end,
             created_by = case when m.created_by_kind = 'agent' then p_actor_id else m.created_by end,
             approval_status = 'not_required', proposal_id = null,
             updated_by = p_actor_id, updated_at = v_now
       where m.id = v_cur.id
      returning * into v_new;
      insert into public.company_brain_memory_history
        (workspace_id, memory_id, change_kind, from_version, to_version, previous, current,
         actor_kind, actor_id, reason, idempotency_key)
      values (p_workspace_id, v_cur.id, case when p_op = 'correct' then 'corrected' else 'updated' end,
              v_cur.version, v_new.version,
              public.company_brain_memory_snapshot(v_cur), public.company_brain_memory_snapshot(v_new),
              'user', p_actor_id, nullif(btrim(p_payload->>'reason'), ''), p_idempotency_key);
      v_result := jsonb_build_object('outcome', 'ok', 'memory_id', v_new.id, 'version', v_new.version);
    end if;
  else
    insert into public.company_brain_memory
      (workspace_id, kind, category, fact_key, scope, scope_ref, value_type, value,
       source_type, source_ref, source_url, verification_status, confidence, persistence,
       expires_at, review_at, observed_at, reason, created_by_kind, created_by, updated_by,
       supersedes_id)
    values (p_workspace_id, v_kind, v_category, v_key, v_scope, v_scope_ref, v_type, v_value,
            v_source_type, nullif(p_payload->>'source_ref', ''), nullif(p_payload->>'source_url', ''),
            v_verification, coalesce(nullif(p_payload->>'confidence', ''), 'high'),
            coalesce(nullif(p_payload->>'persistence', ''), 'persistent'),
            nullif(p_payload->>'expires_at', '')::timestamptz, nullif(p_payload->>'review_at', '')::timestamptz,
            coalesce(nullif(p_payload->>'observed_at', '')::timestamptz, v_now),
            nullif(btrim(p_payload->>'reason'), ''), 'user', p_actor_id, p_actor_id,
            nullif(p_payload->>'supersedes_id', '')::uuid)
    returning * into v_new;
    insert into public.company_brain_memory_history
      (workspace_id, memory_id, change_kind, from_version, to_version, previous, current,
       actor_kind, actor_id, reason, idempotency_key)
    values (p_workspace_id, v_new.id, case when p_op = 'correct' then 'corrected' else 'created' end,
            null, v_new.version, null, public.company_brain_memory_snapshot(v_new),
            'user', p_actor_id, nullif(btrim(p_payload->>'reason'), ''), p_idempotency_key);
    v_result := jsonb_build_object('outcome', 'ok', 'memory_id', v_new.id, 'version', v_new.version);
  end if;

  update public.company_brain_memory_requests r set result = v_result
   where r.workspace_id = p_workspace_id and r.idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;
revoke all on function public.company_brain_memory_write(uuid, uuid, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.company_brain_memory_write(uuid, uuid, uuid, text, jsonb, text) to service_role;

-- ────────────────────────────────────────────────── agent proposal submission
--
-- Called by trusted server code (an agent's edge function) with the service
-- role. It can only ever create a PENDING proposal. Outcomes:
--   created | contradiction (created, flagged against the active item) |
--   duplicate_pending (evidence merged into the open proposal) |
--   already_known (an active item already holds this value) |
--   previously_rejected (a person rejected this within 180 days) | invalid
create or replace function public.company_brain_proposal_submit(
  p_workspace_id uuid,
  p_agent text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := lower(coalesce(p_payload->>'kind', 'fact'));
  v_category text := lower(btrim(coalesce(p_payload->>'category', '')));
  v_key text := lower(btrim(coalesce(p_payload->>'fact_key', '')));
  v_scope text := lower(coalesce(nullif(p_payload->>'scope', ''), 'workspace'));
  v_scope_ref text := nullif(btrim(coalesce(p_payload->>'scope_ref', '')), '');
  v_type text := p_payload->>'value_type';
  v_value jsonb := p_payload->'value';
  v_evidence jsonb := coalesce(p_payload->'evidence', '[]'::jsonb);
  v_source_type text := coalesce(p_payload->>'source_type', 'agent_suggestion');
  v_dedupe text;
  v_active public.company_brain_memory;
  v_open public.company_brain_memory_proposals;
  v_id uuid;
  v_merged jsonb;
begin
  if p_workspace_id is null or not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'unknown workspace');
  end if;
  if p_agent is null or p_agent not in ('orion', 'atlas', 'lyra', 'lisa') then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'unknown agent');
  end if;
  if v_kind not in ('fact', 'preference')
     or v_category !~ '^[a-z][a-z0-9_]{1,40}$' or length(v_key) not between 1 and 200
     or v_source_type not in ('model_inference', 'agent_suggestion', 'provider_returned')
     or v_type is null or v_value is null or not public.company_brain_memory_value_valid(v_type, v_value)
     or jsonb_typeof(v_evidence) <> 'array'
     or length(btrim(coalesce(p_payload->>'rationale', ''))) not between 1 and 2000
     or (v_scope = 'workspace') <> (v_scope_ref is null) then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'malformed proposal');
  end if;
  if v_source_type = 'provider_returned' and jsonb_array_length(v_evidence) = 0 then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'a provider-returned proposal needs evidence');
  end if;

  v_dedupe := coalesce(nullif(p_payload->>'dedupe_key', ''),
                       md5(v_kind || '|' || v_key || '|' || v_scope || '|' || coalesce(v_scope_ref, '') || '|' || v_value::text));

  -- Serialise proposals for the same identity (two agents, two passes, one fact).
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || '|' || v_dedupe, 0));

  select * into v_active from public.company_brain_memory m
   where m.workspace_id = p_workspace_id and m.kind = v_kind and m.fact_key = v_key
     and m.scope = v_scope and coalesce(m.scope_ref, '') = coalesce(v_scope_ref, '')
     and m.lifecycle_status = 'active';
  if found and v_active.value = v_value then
    return jsonb_build_object('outcome', 'already_known', 'memory_id', v_active.id);
  end if;

  if exists (select 1 from public.company_brain_memory_proposals p
              where p.workspace_id = p_workspace_id and p.dedupe_key = v_dedupe
                and p.status = 'rejected' and p.reviewed_at > clock_timestamp() - interval '180 days') then
    return jsonb_build_object('outcome', 'previously_rejected');
  end if;

  select * into v_open from public.company_brain_memory_proposals p
   where p.workspace_id = p_workspace_id and p.dedupe_key = v_dedupe and p.status = 'pending'
   for update;
  if found then
    -- Same claim again: keep ONE proposal, accumulate distinct evidence.
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_merged from (
      select distinct on (coalesce(e->>'source_url', '') || '|' || coalesce(e->>'source_ref', '')) e
        from jsonb_array_elements(v_open.evidence || v_evidence) e
       order by coalesce(e->>'source_url', '') || '|' || coalesce(e->>'source_ref', '')
       limit 50) s;
    update public.company_brain_memory_proposals p
       set evidence = v_merged, updated_at = clock_timestamp()
     where p.id = v_open.id;
    return jsonb_build_object('outcome', 'duplicate_pending', 'proposal_id', v_open.id);
  end if;

  insert into public.company_brain_memory_proposals
    (workspace_id, proposed_by_agent, kind, category, fact_key, scope, scope_ref, value_type, value,
     rationale, evidence, source_type, confidence, dedupe_key, contradicts_memory_id)
  values (p_workspace_id, p_agent, v_kind, v_category, v_key, v_scope, v_scope_ref, v_type, v_value,
          btrim(p_payload->>'rationale'), v_evidence, v_source_type,
          coalesce(nullif(p_payload->>'confidence', ''), 'low'), v_dedupe,
          case when v_active.id is not null then v_active.id end)
  returning id into v_id;
  return jsonb_build_object('outcome', case when v_active.id is not null then 'contradiction' else 'created' end,
                            'proposal_id', v_id,
                            'contradicts_memory_id', v_active.id);
end;
$$;
revoke all on function public.company_brain_proposal_submit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.company_brain_proposal_submit(uuid, text, jsonb) to service_role;

-- ──────────────────────────────────────────────────────── human review
--
-- p_action: approve | correct (with p_corrected_value) | reject.
-- Approving over an ACTIVE item needs p_expected_memory_version = its version
-- (the person approved against what they saw). Outcomes:
--   ok | not_found | not_pending | stale | invalid | idempotency_conflict |
--   session_invalid | not_member | forbidden_role
create or replace function public.company_brain_proposal_review(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_session_id uuid,
  p_proposal_id uuid,
  p_action text,
  p_corrected_value jsonb,
  p_note text,
  p_expected_memory_version integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth text;
  v_hash text;
  v_prior jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
  v_p public.company_brain_memory_proposals;
  v_cur public.company_brain_memory;
  v_new public.company_brain_memory;
  v_value jsonb;
  v_first jsonb;
  v_correcting boolean := p_action = 'correct';
begin
  if p_action is null or p_action not in ('approve', 'correct', 'reject') then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'unknown action');
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'idempotency_key required (8-200 chars)');
  end if;

  v_auth := public.company_brain_memory_authorize(p_workspace_id, p_actor_id, p_session_id, 'edit');
  if v_auth <> 'ok' then return jsonb_build_object('outcome', v_auth); end if;

  v_hash := md5('review|' || p_proposal_id::text || '|' || p_action || '|' || coalesce(p_corrected_value::text, ''));
  insert into public.company_brain_memory_requests (workspace_id, idempotency_key, request_hash)
  values (p_workspace_id, p_idempotency_key, v_hash)
  on conflict do nothing;
  if not found then
    select r.request_hash, r.result into v_hash, v_prior
      from public.company_brain_memory_requests r
     where r.workspace_id = p_workspace_id and r.idempotency_key = p_idempotency_key;
    if v_hash <> md5('review|' || p_proposal_id::text || '|' || p_action || '|' || coalesce(p_corrected_value::text, '')) then
      return jsonb_build_object('outcome', 'idempotency_conflict');
    end if;
    return coalesce(v_prior, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;

  select * into v_p from public.company_brain_memory_proposals p
   where p.id = p_proposal_id and p.workspace_id = p_workspace_id
   for update;
  if not found then
    v_result := jsonb_build_object('outcome', 'not_found');
  elsif v_p.status <> 'pending' then
    v_result := jsonb_build_object('outcome', 'not_pending', 'status', v_p.status);
  elsif p_action = 'reject' then
    update public.company_brain_memory_proposals p
       set status = 'rejected', reviewed_by = p_actor_id, reviewed_at = v_now,
           review_note = nullif(btrim(p_note), ''), updated_at = v_now
     where p.id = v_p.id;
    insert into public.company_brain_memory_history
      (workspace_id, proposal_id, change_kind, previous, current, actor_kind, actor_id, reason, idempotency_key)
    values (p_workspace_id, v_p.id, 'proposal_rejected',
            jsonb_build_object('value', v_p.value, 'source_type', v_p.source_type, 'agent', v_p.proposed_by_agent),
            null, 'user', p_actor_id, nullif(btrim(p_note), ''), p_idempotency_key);
    v_result := jsonb_build_object('outcome', 'ok', 'proposal_id', v_p.id, 'status', 'rejected');
  else
    v_value := case when v_correcting then p_corrected_value else v_p.value end;
    if v_value is null or not public.company_brain_memory_value_valid(v_p.value_type, v_value) then
      v_result := jsonb_build_object('outcome', 'invalid', 'reason', 'corrected value does not match value_type');
    else
      v_first := v_p.evidence -> 0;
      select * into v_cur from public.company_brain_memory m
       where m.workspace_id = p_workspace_id and m.kind = v_p.kind and m.fact_key = v_p.fact_key
         and m.scope = v_p.scope and coalesce(m.scope_ref, '') = coalesce(v_p.scope_ref, '')
         and m.lifecycle_status = 'active'
       for update;
      if found and (p_expected_memory_version is null or p_expected_memory_version <> v_cur.version) then
        v_result := jsonb_build_object('outcome', 'stale', 'memory_id', v_cur.id, 'version', v_cur.version);
      elsif found then
        update public.company_brain_memory m
           set value = v_value, version = m.version + 1,
               source_type = case when v_correcting then 'user_provided' else v_p.source_type end,
               verification_status = 'user_confirmed',
               source_url = case when (v_first->>'source_url') ~* '^https?://' then v_first->>'source_url' end,
               source_ref = coalesce(v_first->>'source_ref', 'proposal:' || v_p.id::text),
               confidence = case when v_correcting then 'high' else v_p.confidence end,
               approval_status = case when v_correcting then 'not_required' else 'approved' end,
               approved_by = p_actor_id, approved_at = v_now,
               created_by_kind = case when v_correcting then 'user' else 'agent' end,
               created_by = case when v_correcting then p_actor_id else m.created_by end,
               created_by_agent = v_p.proposed_by_agent,
               proposal_id = v_p.id, observed_at = v_now,
               reason = nullif(btrim(p_note), ''), updated_by = p_actor_id, updated_at = v_now
         where m.id = v_cur.id
        returning * into v_new;
        insert into public.company_brain_memory_history
          (workspace_id, memory_id, proposal_id, change_kind, from_version, to_version, previous, current,
           actor_kind, actor_id, actor_agent, reason, idempotency_key)
        values (p_workspace_id, v_new.id, v_p.id,
                case when v_correcting then 'corrected_from_proposal' else 'approved_from_proposal' end,
                v_cur.version, v_new.version,
                public.company_brain_memory_snapshot(v_cur), public.company_brain_memory_snapshot(v_new),
                'user', p_actor_id, v_p.proposed_by_agent, nullif(btrim(p_note), ''), p_idempotency_key);
      else
        insert into public.company_brain_memory
          (workspace_id, kind, category, fact_key, scope, scope_ref, value_type, value,
           source_type, source_ref, source_url, verification_status, confidence,
           approval_status, approved_by, approved_at, created_by_kind, created_by, created_by_agent,
           proposal_id, reason, updated_by)
        values (p_workspace_id, v_p.kind, v_p.category, v_p.fact_key, v_p.scope, v_p.scope_ref, v_p.value_type, v_value,
                case when v_correcting then 'user_provided' else v_p.source_type end,
                coalesce(v_first->>'source_ref', 'proposal:' || v_p.id::text),
                case when (v_first->>'source_url') ~* '^https?://' then v_first->>'source_url' end,
                'user_confirmed',
                case when v_correcting then 'high' else v_p.confidence end,
                case when v_correcting then 'not_required' else 'approved' end,
                p_actor_id, v_now,
                case when v_correcting then 'user' else 'agent' end,
                case when v_correcting then p_actor_id end,
                v_p.proposed_by_agent, v_p.id, nullif(btrim(p_note), ''), p_actor_id)
        returning * into v_new;
        insert into public.company_brain_memory_history
          (workspace_id, memory_id, proposal_id, change_kind, from_version, to_version, previous, current,
           actor_kind, actor_id, actor_agent, reason, idempotency_key)
        values (p_workspace_id, v_new.id, v_p.id,
                case when v_correcting then 'corrected_from_proposal' else 'approved_from_proposal' end,
                null, v_new.version, null, public.company_brain_memory_snapshot(v_new),
                'user', p_actor_id, v_p.proposed_by_agent, nullif(btrim(p_note), ''), p_idempotency_key);
      end if;
      if v_new.id is not null then
        update public.company_brain_memory_proposals p
           set status = case when v_correcting then 'corrected' else 'approved' end,
               reviewed_by = p_actor_id, reviewed_at = v_now, review_note = nullif(btrim(p_note), ''),
               resulting_memory_id = v_new.id, updated_at = v_now
         where p.id = v_p.id;
        v_result := jsonb_build_object('outcome', 'ok', 'proposal_id', v_p.id,
                                       'status', case when v_correcting then 'corrected' else 'approved' end,
                                       'memory_id', v_new.id, 'version', v_new.version);
      end if;
    end if;
  end if;

  update public.company_brain_memory_requests r set result = v_result
   where r.workspace_id = p_workspace_id and r.idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;
revoke all on function public.company_brain_proposal_review(uuid, uuid, uuid, uuid, text, jsonb, text, integer, text) from public, anon, authenticated;
grant execute on function public.company_brain_proposal_review(uuid, uuid, uuid, uuid, text, jsonb, text, integer, text) to service_role;

-- ──────────────────────────────────────────────────────── privacy redaction
--
-- Owner/admin only ('activate'). Blanks the VALUE of a memory item (and every
-- history snapshot of it), or the profile of one Brain revision, keeping who
-- changed what and when. The item becomes retracted so it can never be served.
-- p_target: 'memory' | 'revision'.
create or replace function public.company_brain_memory_redact(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_session_id uuid,
  p_target text,
  p_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth text;
  v_cur public.company_brain_memory;
  v_now timestamptz := clock_timestamp();
begin
  if p_target is null or p_target not in ('memory', 'revision') then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'unknown target');
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'a redaction needs a reason');
  end if;
  v_auth := public.company_brain_memory_authorize(p_workspace_id, p_actor_id, p_session_id, 'activate');
  if v_auth <> 'ok' then return jsonb_build_object('outcome', v_auth); end if;

  perform set_config('agentory.brain_redaction', 'on', true);

  if p_target = 'revision' then
    update public.company_brain_revisions r
       set profile = '{}'::jsonb, redacted_at = v_now, redacted_by = p_actor_id, redaction_reason = btrim(p_reason)
     where r.id = p_id and r.workspace_id = p_workspace_id and r.redacted_at is null;
    if not found then return jsonb_build_object('outcome', 'not_found'); end if;
    return jsonb_build_object('outcome', 'ok');
  end if;

  select * into v_cur from public.company_brain_memory m
   where m.id = p_id and m.workspace_id = p_workspace_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_cur.redacted_at is not null then return jsonb_build_object('outcome', 'unchanged'); end if;

  update public.company_brain_memory_history h
     set previous = case when h.previous is null then null else h.previous || '{"value": null, "redacted": true}'::jsonb end,
         current  = case when h.current  is null then null else h.current  || '{"value": null, "redacted": true}'::jsonb end,
         redacted_at = v_now
   where h.memory_id = v_cur.id;
  update public.company_brain_memory m
     set value_type = 'redacted', value = 'null'::jsonb, lifecycle_status = 'retracted',
         source_url = null, source_ref = null, reason = null,
         version = m.version + 1, redacted_at = v_now, updated_by = p_actor_id, updated_at = v_now
   where m.id = v_cur.id;
  insert into public.company_brain_memory_history
    (workspace_id, memory_id, change_kind, from_version, to_version, actor_kind, actor_id, reason)
  values (p_workspace_id, v_cur.id, 'redacted', v_cur.version, v_cur.version + 1, 'user', p_actor_id, btrim(p_reason));
  return jsonb_build_object('outcome', 'ok', 'memory_id', v_cur.id);
end;
$$;
revoke all on function public.company_brain_memory_redact(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.company_brain_memory_redact(uuid, uuid, uuid, text, uuid, text) to service_role;
