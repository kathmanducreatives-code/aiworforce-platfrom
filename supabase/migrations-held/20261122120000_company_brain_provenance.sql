-- Company Brain V2 · B2.2: knowledge provenance on every profile revision.
--
-- HELD. Applied only in the disposable database-contract lane. Depends on the
-- held V1 memory migration 20261110120000_company_brain_memory.sql (it owns
-- company_brain_revisions and the revision trigger). Additive: no column is
-- dropped or renamed, no policy changes, and company_brain_authorized_write is
-- NOT modified. Ownership: Company Brain (docs/plans/company-brain/MIGRATION_OWNERSHIP.md).
--
-- What it adds
--   company_brain_revisions.source_kind   WHERE the change came from:
--       founder       a person typed or chose it in the app
--       research      a person accepted a suggestion taken verbatim from a
--                     stored research run (source_ref = that run's id)
--       memory        promoted from an approved memory item (source_ref = its id)
--       ai_inference  written from a model or rule draft the person has not
--                     edited (e.g. onboarding's analyze step)
--       system        no person behind it (a scheduler, a migration)
--       backfill      the V1 back-filled revision 1
--       unrecorded    written before provenance existed, or by a path that
--                     does not declare it. Never guessed after the fact.
--   company_brain_revisions.source_ref    the research run or memory item id.
--   company_brain_revisions.reason        why, in the actor's or the server's words.
--
--   company_brain_provenanced_write(...)  the authorized writer, plus provenance.
--       Validates the claim against the database (a research run must be a
--       COMPLETED run of THIS workspace; a memory item must be an approved or
--       person-confirmed item of THIS workspace), sets three transaction-local
--       settings, then calls company_brain_authorized_write unchanged, in the
--       same transaction. Service role only.
--
-- Trust: the browser cannot reach any of this. It has no write grant on
-- company_brain or company_brain_revisions, cannot execute either writer, and
-- research runs accept no browser insert (RLS: member SELECT only). The edge
-- function decides the claim (it re-derives a research suggestion from the
-- stored run and only then says 'research'); this function refuses a claim the
-- database contradicts. A transaction-local setting vanishes at commit, so it
-- cannot leak into another request on a pooled connection.
--
-- Rollback: rollback/20261122120000_company_brain_provenance.down.sql

-- ─────────────────────────────────────────────────────────── the columns
alter table public.company_brain_revisions
  add column if not exists source_kind text not null default 'unrecorded',
  add column if not exists source_ref  text,
  add column if not exists reason      text;

alter table public.company_brain_revisions drop constraint if exists company_brain_revisions_source_kind_valid;
alter table public.company_brain_revisions add constraint company_brain_revisions_source_kind_valid
  check (source_kind in ('founder', 'research', 'memory', 'ai_inference', 'system', 'backfill', 'unrecorded'));
alter table public.company_brain_revisions drop constraint if exists company_brain_revisions_source_ref_coherent;
alter table public.company_brain_revisions add constraint company_brain_revisions_source_ref_coherent
  check ((source_kind in ('research', 'memory')) = (source_ref is not null)
         and (source_ref is null or source_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
alter table public.company_brain_revisions drop constraint if exists company_brain_revisions_reason_length;
alter table public.company_brain_revisions add constraint company_brain_revisions_reason_length
  check (reason is null or length(reason) between 1 and 500);

comment on column public.company_brain_revisions.source_kind is
  'Where this revision came from (founder | research | memory | ai_inference | system | backfill | unrecorded). Set only by company_brain_provenanced_write through a transaction-local setting; never inferred later.';

-- ─────────────────────────────────────────────────────────── the trigger
-- The V1 trigger, plus three settings. Without a declared source a revision is
-- 'system' (no actor) or 'unrecorded' (an actor, but a path that did not say):
-- the truth, not a guess.
create or replace function public.company_brain_record_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := nullif(current_setting('agentory.brain_actor', true), '');
  v_perm  text := nullif(current_setting('agentory.brain_permission', true), '');
  v_source text := nullif(current_setting('agentory.brain_source', true), '');
  v_source_ref text := nullif(current_setting('agentory.brain_source_ref', true), '');
  v_reason text := nullif(current_setting('agentory.brain_reason', true), '');
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
  -- A declared source counts only together with the actor the authorized
  -- writer set in this same transaction.
  if v_source is null or v_actor is null then
    v_source := case when v_actor is null then 'system' else 'unrecorded' end;
    v_source_ref := null;
    v_reason := null;
  end if;
  select coalesce(max(r.revision), 0) + 1 into v_next
    from public.company_brain_revisions r where r.workspace_id = new.workspace_id;
  insert into public.company_brain_revisions
    (workspace_id, revision, profile, onboarding_completed, changed_sections, actor_kind, actor_id, permission, written_at,
     source_kind, source_ref, reason)
  values (new.workspace_id, v_next, new.profile, new.onboarding_completed, v_changed,
          case when v_actor is null then 'system' else 'user' end,
          v_actor::uuid, v_perm, clock_timestamp(),
          v_source, v_source_ref, v_reason);
  return null;
end;
$$;
revoke all on function public.company_brain_record_revision() from public, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────── the provenanced writer
create or replace function public.company_brain_provenanced_write(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_session_id uuid,
  p_permission text,
  p_mode text,
  p_profile jsonb,
  p_expected_updated_at timestamptz,
  p_activate boolean,
  p_source_kind text,
  p_source_ref uuid,
  p_reason text
)
returns table (outcome text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_source_kind is null or p_source_kind not in ('founder', 'research', 'memory', 'ai_inference') then
    raise exception 'company_brain_provenanced_write: invalid source %', p_source_kind using errcode = '22023';
  end if;
  if (p_source_kind in ('research', 'memory')) <> (p_source_ref is not null) then
    raise exception 'company_brain_provenanced_write: % needs exactly one source_ref', p_source_kind using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'company_brain_provenanced_write: reason too long' using errcode = '22023';
  end if;
  if p_source_kind = 'research' and not exists (
       select 1 from public.company_brain_research_runs r
        where r.id = p_source_ref and r.workspace_id = p_workspace_id and r.status = 'completed') then
    raise exception 'company_brain_provenanced_write: research run is not a completed run of this workspace' using errcode = '22023';
  end if;
  if p_source_kind = 'memory' and not exists (
       select 1 from public.company_brain_memory m
        where m.id = p_source_ref and m.workspace_id = p_workspace_id and m.lifecycle_status = 'active'
          and m.redacted_at is null and m.verification_status = 'user_confirmed') then
    raise exception 'company_brain_provenanced_write: memory item is not a confirmed item of this workspace' using errcode = '22023';
  end if;

  perform set_config('agentory.brain_source', p_source_kind, true);
  perform set_config('agentory.brain_source_ref', coalesce(p_source_ref::text, ''), true);
  perform set_config('agentory.brain_reason', coalesce(v_reason, ''), true);

  return query select w.outcome, w.updated_at
    from public.company_brain_authorized_write(p_workspace_id, p_actor_id, p_session_id, p_permission, p_mode,
                                               p_profile, p_expected_updated_at, p_activate) w;
end;
$$;
revoke all on function public.company_brain_provenanced_write(uuid, uuid, uuid, text, text, jsonb, timestamptz, boolean, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.company_brain_provenanced_write(uuid, uuid, uuid, text, text, jsonb, timestamptz, boolean, text, uuid, text)
  to service_role;
