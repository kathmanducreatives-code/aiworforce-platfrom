-- Company Brain: authorization at the WRITE, in the same transaction (AUTH-06).
--
-- The Brain handlers (generate-company-brain-draft, setup-company-brain) check
-- the caller's membership and role when a request starts, then write through
-- the service client later, in a separate transaction. A membership removal, a
-- demotion to viewer or a logout committed in between was not seen: the write
-- landed (Codex reproduction, #172: six failing in-flight cases). Content CAS
-- on `updated_at` protects concurrent edits, not permission changes.
--
-- Every Brain write now goes through this one function. In ONE transaction it:
--   1. locks the caller's live Auth session row (FOR SHARE) — a logout or
--      session revocation either commits first (and we refuse) or waits for
--      this write to commit;
--   2. locks the caller's membership row (FOR SHARE) — a removal or demotion
--      either commits first (and we refuse) or waits;
--   3. checks the CURRENT role against the required permission, with the same
--      rule as _shared/brainRole.ts (owner/admin/editor edit; owner/admin
--      activate; anything else is a viewer);
--   4. writes the Brain (CAS on updated_at, insert, or upsert), all-or-nothing.
-- Lock order: session → membership → company_brain row. Revocation writers
-- (GoTrue logout: sessions; membership delete/update: workspace_members) each
-- touch one of these and never the Brain, so the order cannot deadlock.
--
-- Refusals return an outcome and change nothing. Service role only: the
-- browser still cannot write the Brain (20261023120000) and cannot call this.
-- The handlers keep their initial check, so a refused caller never reaches a
-- model or provider call; model work stays outside these locks and this
-- function re-authorizes at the final write.
--
-- Rollback: drop function public.company_brain_authorized_write(uuid, uuid, uuid, text, text, jsonb, timestamptz, boolean);
--           drop function public.company_brain_write_authorization(uuid, uuid, uuid, text);
--           (and redeploy the previous handlers, which wrote directly).

-- THE rule, read-only: may this actor, on this live session, write this
-- workspace's Brain with this permission RIGHT NOW? Returns 'ok' or a refusal.
-- The handlers call it (via GET, before any write request) so an already
-- revoked caller never reaches a write; the writer below calls it again AFTER
-- locking the session and membership rows, which is what closes the race.
create or replace function public.company_brain_write_authorization(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_session_id uuid,
  p_permission text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if p_permission is null or p_permission not in ('edit', 'activate') then
    raise exception 'company_brain_write_authorization: invalid permission %', p_permission using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.sessions s
     where s.id = p_session_id and s.user_id = p_actor_id
       and (s.not_after is null or s.not_after > clock_timestamp())
  ) then
    return 'session_invalid';
  end if;
  select lower(btrim(coalesce(m.role, ''))) into v_role
    from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id;
  if not found then
    return 'not_member';
  end if;
  if not (case p_permission
            when 'edit' then v_role in ('owner', 'admin', 'editor')
            when 'activate' then v_role in ('owner', 'admin')
          end) then
    return 'forbidden_role';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.company_brain_write_authorization(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.company_brain_write_authorization(uuid, uuid, uuid, text) to service_role;

create or replace function public.company_brain_authorized_write(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_session_id uuid,
  p_permission text,               -- 'edit' | 'activate'
  p_mode text,                     -- 'cas' | 'insert' | 'upsert'
  p_profile jsonb,
  p_expected_updated_at timestamptz default null,  -- required for 'cas'
  p_activate boolean default false -- also set onboarding_completed (needs 'activate')
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

  -- 1. Lock the caller's live session row against a concurrent logout, and
  -- 2. their membership row against a concurrent removal or demotion. A
  --    revocation either committed before these locks (and the rule below sees
  --    it) or waits until this transaction commits. Missing rows lock nothing;
  --    the rule then refuses.
  perform 1 from auth.sessions s
   where s.id = p_session_id and s.user_id = p_actor_id
     and (s.not_after is null or s.not_after > v_now)
   for share;
  perform 1 from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id
   for share;

  -- 3. THE rule, on the rows now locked.
  v_auth := public.company_brain_write_authorization(p_workspace_id, p_actor_id, p_session_id, p_permission);
  if v_auth <> 'ok' then
    return query select v_auth, null::timestamptz; return;
  end if;

  -- 4. The write, all-or-nothing.
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
