-- Rollback of 20261122120000_company_brain_provenance.sql (Company Brain V2 · B2.2).
-- Restores the V1 revision trigger byte-for-byte (from 20261110120000), removes the
-- provenanced writer, then the three columns. Revision rows keep everything else;
-- only their provenance columns go. company_brain_authorized_write was never changed.
-- Handlers fall back to company_brain_authorized_write when the provenanced writer is
-- absent (brainWriter.ts), so they keep working after this rollback.
drop function if exists public.company_brain_provenanced_write(uuid, uuid, uuid, text, text, jsonb, timestamptz, boolean, text, uuid, text);

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

alter table public.company_brain_revisions drop constraint if exists company_brain_revisions_source_kind_valid;
alter table public.company_brain_revisions drop constraint if exists company_brain_revisions_source_ref_coherent;
alter table public.company_brain_revisions drop constraint if exists company_brain_revisions_reason_length;
alter table public.company_brain_revisions
  drop column if exists source_kind,
  drop column if exists source_ref,
  drop column if exists reason;
