-- Company Brain Phase 3c: canonical clients, explicit grants, one Brain per client.
--
-- HELD. Not approved for production and not in supabase/migrations/: it is the
-- implementation of the contract proposed in #174 (docs/plans/company-brain/
-- CLIENT_BRAIN_CONTRACT.md), applied only to the disposable database-contract
-- lane (tests/db-contract/bootstrap.sh) until that contract is approved. O3
-- (the membership writer, Backend) is still open; see the contract.
--
-- What it adds:
--   public.client_accounts        the one canonical client parent of a workspace
--   public.client_access_grants   append-only grant generations per (client, user)
--   public.client_company_brain   one Brain per client; the agency Brain stays in
--                                 public.company_brain and is never touched here
--   workspace_members.permission_revision
--                                 a value from ONE global sequence, renewed on every
--                                 role change and on every new membership, so it
--                                 never repeats — a remove→rejoin can never present
--                                 an old revision (Codex O2: a durable incarnation)
--
-- Authorization (contract §4): live session ∧ current membership with a
-- sufficient role ∧ client active ∧ an active grant for (client, actor). Every
-- role needs the grant, owner and admin included (P3-D3); managing clients and
-- grants is separate and never implies data access. No fallback: a client
-- request without a client is refused, never answered from the agency Brain or
-- another client.
--
-- Writes: only through the SECURITY DEFINER functions below (service_role
-- only). No browser role and not even service_role may write these tables
-- directly. Each writer re-authorizes in its own transaction under the global
-- lock order (contract §5):
--   1 auth.sessions row → 2 workspace_members row(s) → 3 client_accounts row
--   → 4 client_access_grants row → 5 client_company_brain row.
-- No chain locks a lower level after a higher one; writers that lock several
-- membership rows lock them in user_id order, in one statement. Membership
-- removal (any writer: the AFTER DELETE trigger) holds 2 then revokes at 4;
-- archive holds 3 then revokes at 4; grant/revoke hold 2 (the target's row,
-- which also serializes generation allocation) then 3 then 4.
--
-- Rollback (nothing else depends on these objects):
--   drop function public.client_brain_authorized_write(uuid, uuid, uuid, uuid, text, text, text, jsonb, bigint, boolean, uuid, integer, bigint);
--   drop function public.client_brain_read(uuid, uuid, uuid, uuid, text, uuid, integer, bigint);
--   drop function public.client_brain_pin(uuid, uuid, uuid, uuid, text);
--   drop function public.client_brain_authorization(uuid, uuid, uuid, uuid, text, text, uuid, integer, bigint);
--   drop function public.client_accounts_for_actor(uuid, uuid, uuid);
--   drop function public.client_account_manage_list(uuid, uuid, uuid);
--   drop function public.client_access_revoke(uuid, uuid, uuid, uuid, uuid);
--   drop function public.client_access_grant(uuid, uuid, uuid, uuid, uuid);
--   drop function public.client_account_archive(uuid, uuid, uuid, uuid);
--   drop function public.client_account_create(uuid, uuid, uuid, text);
--   drop function public.client_admin_authorization(uuid, uuid, uuid);
--   drop table public.client_company_brain, public.client_access_grants, public.client_accounts;
--   drop function public.client_access_is_active(uuid, uuid);
--   drop trigger workspace_members_revoke_client_grants on public.workspace_members;
--   drop trigger workspace_members_permission_revision on public.workspace_members;
--   drop function public.workspace_members_revoke_client_grants(), public.workspace_members_permission_revision();
--   alter table public.workspace_members drop column permission_revision;
--   drop sequence public.workspace_member_permission_revision_seq;
-- Hosted note: adding the column rewrites workspace_members under a brief
-- ACCESS EXCLUSIVE lock (a small table).

-- ── Permission revision on the membership ────────────────────────────────────
create sequence public.workspace_member_permission_revision_seq;
revoke all on sequence public.workspace_member_permission_revision_seq from public, anon, authenticated, service_role;

alter table public.workspace_members add column permission_revision bigint;
update public.workspace_members set permission_revision = nextval('public.workspace_member_permission_revision_seq');
alter table public.workspace_members alter column permission_revision set not null;

-- Every new membership gets a fresh revision; a role change renews it; nothing
-- else may set it. A membership's identity (id, workspace, user) is immutable:
-- grants are keyed by (workspace, user), so re-pointing a row would move them.
create function public.workspace_members_permission_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.permission_revision := nextval('public.workspace_member_permission_revision_seq');
    return new;
  end if;
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
     or new.user_id is distinct from old.user_id then
    raise exception 'workspace_members: membership identity is immutable (remove and re-add instead)' using errcode = '55000';
  end if;
  if new.role is distinct from old.role then
    new.permission_revision := nextval('public.workspace_member_permission_revision_seq');
  else
    new.permission_revision := old.permission_revision;
  end if;
  return new;
end $$;
revoke all on function public.workspace_members_permission_revision() from public, anon, authenticated, service_role;
create trigger workspace_members_permission_revision
  before insert or update on public.workspace_members
  for each row execute function public.workspace_members_permission_revision();

-- ── Tables ───────────────────────────────────────────────────────────────────
create table public.client_accounts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete restrict,
  name          text not null check (length(btrim(name)) between 1 and 200),
  status        text not null default 'active' check (status in ('active', 'archived')),
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz,
  archived_by   uuid references auth.users(id),
  unique (workspace_id, id),
  check ((status = 'archived') = (archived_at is not null))
);

create table public.client_access_grants (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  client_id     uuid not null,
  user_id       uuid not null references auth.users(id),
  generation    integer not null check (generation >= 1),
  granted_by    uuid not null references auth.users(id),
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id),
  revoke_reason text check (revoke_reason in ('revoked', 'membership_removed', 'client_archived')),
  foreign key (workspace_id, client_id) references public.client_accounts (workspace_id, id) on delete restrict,
  unique (workspace_id, client_id, user_id, generation),
  -- A revocation always has a reason; an actor is recorded when one exists
  -- (a membership removal by a service path has none).
  check ((revoked_at is null) = (revoke_reason is null)),
  check (revoked_by is null or revoked_at is not null),
  check (revoke_reason is distinct from 'revoked' or revoked_by is not null)
);
create unique index client_access_grants_one_active
  on public.client_access_grants (workspace_id, client_id, user_id) where revoked_at is null;
create index client_access_grants_user on public.client_access_grants (workspace_id, user_id) where revoked_at is null;

create table public.client_company_brain (
  workspace_id            uuid not null,
  client_id               uuid not null,
  profile                 jsonb not null default '{}'::jsonb,
  version                 bigint not null default 1 check (version >= 1),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references auth.users(id),
  onboarding_completed    boolean not null default false,
  onboarding_completed_at timestamptz,
  primary key (workspace_id, client_id),
  foreign key (workspace_id, client_id) references public.client_accounts (workspace_id, id) on delete restrict
);

-- Client identity is immutable and archive is terminal (a new client is a new row).
create function public.client_accounts_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'client_accounts: client identity is immutable' using errcode = '55000';
  end if;
  if old.status = 'archived' and (new.status <> 'archived' or new.archived_at is distinct from old.archived_at
     or new.archived_by is distinct from old.archived_by) then
    raise exception 'client_accounts: archive is terminal' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger client_accounts_guard before update on public.client_accounts
  for each row execute function public.client_accounts_guard();

-- Grants are append-only: the one permitted change is active → revoked, once.
create function public.client_access_grants_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'client_access_grants: grants are append-only (revoke instead)' using errcode = '55000';
  end if;
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
     or new.client_id is distinct from old.client_id or new.user_id is distinct from old.user_id
     or new.generation is distinct from old.generation or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at then
    raise exception 'client_access_grants: grant identity is immutable' using errcode = '55000';
  end if;
  if old.revoked_at is not null then
    raise exception 'client_access_grants: revocation is terminal' using errcode = '55000';
  end if;
  if new.revoked_at is null then
    raise exception 'client_access_grants: the only change is a revocation' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger client_access_grants_guard before update or delete on public.client_access_grants
  for each row execute function public.client_access_grants_guard();

-- Membership removal by ANY writer (a future member-remove route, a service
-- path, direct SQL, a workspace cascade) terminally revokes that user's active
-- grants in the same transaction. Holds level 2 (the deleted row), then 4.
create function public.workspace_members_revoke_client_grants()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.client_access_grants g
     set revoked_at = clock_timestamp(), revoke_reason = 'membership_removed', revoked_by = null
   where g.workspace_id = old.workspace_id and g.user_id = old.user_id and g.revoked_at is null;
  return old;
end $$;
revoke all on function public.workspace_members_revoke_client_grants() from public, anon, authenticated, service_role;
create trigger workspace_members_revoke_client_grants
  after delete on public.workspace_members
  for each row execute function public.workspace_members_revoke_client_grants();

-- ── Browser visibility (O1, Codex's conservative answer) ─────────────────────
-- A member sees a client's id and name ONLY while they hold an active grant for
-- it. No all-member enumeration; owner/admin management uses the service-only
-- client_account_manage_list, which never implies Brain access. Client Brains
-- have no browser access at all: they are read through client_brain_read.
create function public.client_access_is_active(p_workspace_id uuid, p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and exists (select 1 from public.workspace_members m
                  where m.workspace_id = p_workspace_id and m.user_id = auth.uid())
     and exists (select 1 from public.client_access_grants g
                  where g.workspace_id = p_workspace_id and g.client_id = p_client_id
                    and g.user_id = auth.uid() and g.revoked_at is null);
$$;
revoke all on function public.client_access_is_active(uuid, uuid) from public, anon;
grant execute on function public.client_access_is_active(uuid, uuid) to authenticated;

alter table public.client_accounts enable row level security;
alter table public.client_access_grants enable row level security;
alter table public.client_company_brain enable row level security;
revoke all on public.client_accounts, public.client_access_grants, public.client_company_brain from public, anon, authenticated, service_role;
grant select on public.client_accounts, public.client_access_grants, public.client_company_brain to service_role;
grant select on public.client_accounts, public.client_access_grants to authenticated;

create policy client_accounts_granted_select on public.client_accounts
  for select to authenticated
  using (status = 'active' and public.client_access_is_active(workspace_id, id));
-- Your own grant rows, while you are a member of that workspace.
create policy client_access_grants_own_select on public.client_access_grants
  for select to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.workspace_members m
     where m.workspace_id = client_access_grants.workspace_id and m.user_id = auth.uid()));

-- ── THE rules ────────────────────────────────────────────────────────────────
-- Management (create/archive/grant/revoke/list): live session, current member,
-- owner or admin. Grants nothing on client data.
create function public.client_admin_authorization(p_workspace_id uuid, p_actor_id uuid, p_session_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  if not exists (select 1 from auth.sessions s
                  where s.id = p_session_id and s.user_id = p_actor_id
                    and (s.not_after is null or s.not_after > clock_timestamp())) then
    return 'session_invalid';
  end if;
  select lower(btrim(coalesce(m.role, ''))) into v_role from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id;
  if not found then return 'not_member'; end if;
  if v_role not in ('owner', 'admin') then return 'forbidden_role'; end if;
  return 'ok';
end $$;

-- Client data: may this actor, on this live session, read/edit/activate this
-- client's Brain RIGHT NOW? Callable as a GET pre-check (no write request for
-- an already-refused caller) and called again by the writer after its locks.
--   p_intent 'interactive'  a user's own request; pins must be absent.
--   p_intent 'task'         a stored task/approval resuming later; it MUST pin
--                           the grant id, its generation and the membership's
--                           permission_revision it was authorized with, and is
--                           refused when any of them moved (Codex O2/A7).
create function public.client_brain_authorization(
  p_workspace_id uuid, p_client_id uuid, p_actor_id uuid, p_session_id uuid,
  p_permission text, p_intent text default 'interactive',
  p_pin_grant_id uuid default null, p_pin_generation integer default null, p_pin_revision bigint default null)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text; v_rev bigint; v_status text; v_grant uuid; v_gen integer;
begin
  if p_permission is null or p_permission not in ('read', 'edit', 'activate') then
    raise exception 'client_brain_authorization: invalid permission %', p_permission using errcode = '22023';
  end if;
  if p_intent is null or p_intent not in ('interactive', 'task') then
    raise exception 'client_brain_authorization: invalid intent %', p_intent using errcode = '22023';
  end if;
  if p_intent = 'task' and (p_pin_grant_id is null or p_pin_generation is null or p_pin_revision is null) then
    raise exception 'client_brain_authorization: a task must pin grant, generation and permission revision' using errcode = '22023';
  end if;
  if p_intent = 'interactive' and (p_pin_grant_id is not null or p_pin_generation is not null or p_pin_revision is not null) then
    raise exception 'client_brain_authorization: pins belong to tasks' using errcode = '22023';
  end if;
  if p_workspace_id is null or p_actor_id is null then
    raise exception 'client_brain_authorization: missing argument' using errcode = '22023';
  end if;
  -- I1: never a fallback scope.
  if p_client_id is null then return 'client_context_required'; end if;

  if not exists (select 1 from auth.sessions s
                  where s.id = p_session_id and s.user_id = p_actor_id
                    and (s.not_after is null or s.not_after > clock_timestamp())) then
    return 'session_invalid';
  end if;
  select lower(btrim(coalesce(m.role, ''))), m.permission_revision into v_role, v_rev
    from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id;
  if not found then return 'not_member'; end if;
  if not (case p_permission
            when 'read' then true                                  -- any member role (else = viewer)
            when 'edit' then v_role in ('owner', 'admin', 'editor')
            when 'activate' then v_role in ('owner', 'admin')
          end) then
    return 'forbidden_role';
  end if;

  -- A client that is not in this workspace, or that this actor was never
  -- granted, is indistinguishable from an ungranted one (O1: no enumeration).
  select c.status into v_status from public.client_accounts c
   where c.workspace_id = p_workspace_id and c.id = p_client_id;
  if not found or not exists (select 1 from public.client_access_grants g
                               where g.workspace_id = p_workspace_id and g.client_id = p_client_id
                                 and g.user_id = p_actor_id) then
    return 'no_grant';
  end if;
  if v_status <> 'active' then return 'client_archived'; end if;

  select g.id, g.generation into v_grant, v_gen from public.client_access_grants g
   where g.workspace_id = p_workspace_id and g.client_id = p_client_id
     and g.user_id = p_actor_id and g.revoked_at is null;
  if p_intent = 'task' then
    -- I4: the pinned generation, not merely "a" grant. A revoke, or a revoke
    -- followed by a regrant, refuses the old task.
    if v_grant is null or v_grant <> p_pin_grant_id or v_gen <> p_pin_generation then return 'grant_changed'; end if;
    -- I5: any role change (demote→promote too) or remove→rejoin moved it.
    if v_rev <> p_pin_revision then return 'permission_changed'; end if;
  elsif v_grant is null then
    return 'no_grant';
  end if;
  return 'ok';
end $$;

-- ── Client data API ──────────────────────────────────────────────────────────
-- What a task records when it is authorized: the grant generation and the
-- permission revision it must still hold when it resumes.
create function public.client_brain_pin(
  p_workspace_id uuid, p_client_id uuid, p_actor_id uuid, p_session_id uuid, p_permission text)
returns table (outcome text, grant_id uuid, generation integer, permission_revision bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_auth text;
begin
  v_auth := public.client_brain_authorization(p_workspace_id, p_client_id, p_actor_id, p_session_id, p_permission);
  if v_auth <> 'ok' then
    return query select v_auth, null::uuid, null::integer, null::bigint; return;
  end if;
  return query
    select 'ok'::text, g.id, g.generation, m.permission_revision
      from public.client_access_grants g
      join public.workspace_members m on m.workspace_id = g.workspace_id and m.user_id = g.user_id
     where g.workspace_id = p_workspace_id and g.client_id = p_client_id
       and g.user_id = p_actor_id and g.revoked_at is null;
end $$;

-- One statement, one snapshot: the rule and the row it guards are read
-- together. STABLE, so it is called as a GET (never a write request). An
-- authorized client with no Brain yet returns ok with a null profile/version.
create function public.client_brain_read(
  p_workspace_id uuid, p_client_id uuid, p_actor_id uuid, p_session_id uuid,
  p_intent text default 'interactive',
  p_pin_grant_id uuid default null, p_pin_generation integer default null, p_pin_revision bigint default null)
returns table (outcome text, profile jsonb, version bigint, onboarding_completed boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_auth text;
begin
  v_auth := public.client_brain_authorization(p_workspace_id, p_client_id, p_actor_id, p_session_id, 'read',
                                              p_intent, p_pin_grant_id, p_pin_generation, p_pin_revision);
  if v_auth <> 'ok' then
    return query select v_auth, null::jsonb, null::bigint, null::boolean, null::timestamptz; return;
  end if;
  return query
    select 'ok'::text, b.profile, b.version, b.onboarding_completed, b.updated_at
      from (select 1) one
      left join public.client_company_brain b on b.workspace_id = p_workspace_id and b.client_id = p_client_id;
end $$;

-- The ONE writer of a client Brain. Locks 1→2→3→4, re-applies the rule on the
-- locked rows, then CAS on `version` (I6: content, never authorization) or a
-- first insert. There is no blind overwrite: a concurrent edit is `stale`.
create function public.client_brain_authorized_write(
  p_workspace_id uuid, p_client_id uuid, p_actor_id uuid, p_session_id uuid,
  p_permission text,               -- 'edit' | 'activate'
  p_intent text,                   -- 'interactive' | 'task'
  p_mode text,                     -- 'cas' | 'insert'
  p_profile jsonb,
  p_expected_version bigint default null,   -- required for 'cas'
  p_activate boolean default false,
  p_pin_grant_id uuid default null, p_pin_generation integer default null, p_pin_revision bigint default null)
returns table (outcome text, version bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_auth text;
  v_written bigint;
begin
  if p_permission is null or p_permission not in ('edit', 'activate') then
    raise exception 'client_brain_authorized_write: invalid permission %', p_permission using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('cas', 'insert') then
    raise exception 'client_brain_authorized_write: invalid mode %', p_mode using errcode = '22023';
  end if;
  if p_activate and p_permission <> 'activate' then
    raise exception 'client_brain_authorized_write: activation requires the activate permission' using errcode = '22023';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'client_brain_authorized_write: profile must be an object' using errcode = '22023';
  end if;
  if p_mode = 'cas' and p_expected_version is null then
    raise exception 'client_brain_authorized_write: cas needs expected_version' using errcode = '22023';
  end if;

  -- 1 session, 2 membership, 3 client, 4 active grant — FOR SHARE, in order.
  -- A revocation committed before a lock is seen by the rule below; one that
  -- starts after waits until this transaction commits.
  perform 1 from auth.sessions s
   where s.id = p_session_id and s.user_id = p_actor_id for share;
  perform 1 from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id for share;
  perform 1 from public.client_accounts c
   where c.workspace_id = p_workspace_id and c.id = p_client_id for share;
  perform 1 from public.client_access_grants g
   where g.workspace_id = p_workspace_id and g.client_id = p_client_id
     and g.user_id = p_actor_id and g.revoked_at is null for share;

  v_auth := public.client_brain_authorization(p_workspace_id, p_client_id, p_actor_id, p_session_id, p_permission,
                                              p_intent, p_pin_grant_id, p_pin_generation, p_pin_revision);
  if v_auth <> 'ok' then
    return query select v_auth, null::bigint; return;
  end if;

  -- 5 the data row.
  if p_mode = 'cas' then
    update public.client_company_brain b
       set profile = p_profile, version = b.version + 1, updated_at = v_now, updated_by = p_actor_id,
           onboarding_completed = case when p_activate then true else b.onboarding_completed end,
           onboarding_completed_at = case when p_activate then v_now else b.onboarding_completed_at end
     where b.workspace_id = p_workspace_id and b.client_id = p_client_id and b.version = p_expected_version
    returning b.version into v_written;
  else
    insert into public.client_company_brain as b
      (workspace_id, client_id, profile, version, updated_at, updated_by, onboarding_completed, onboarding_completed_at)
    values (p_workspace_id, p_client_id, p_profile, 1, v_now, p_actor_id, p_activate, case when p_activate then v_now end)
    on conflict (workspace_id, client_id) do nothing
    returning b.version into v_written;
  end if;
  if v_written is null then
    return query select 'stale'::text, null::bigint; return;
  end if;
  return query select 'ok'::text, v_written;
end $$;

-- ── Client and grant management (owner/admin; never implies data access) ────
create function public.client_account_create(p_workspace_id uuid, p_actor_id uuid, p_session_id uuid, p_name text)
returns table (outcome text, client_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_auth text; v_id uuid;
begin
  perform 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_actor_id for share;
  perform 1 from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id for share;
  v_auth := public.client_admin_authorization(p_workspace_id, p_actor_id, p_session_id);
  if v_auth <> 'ok' then return query select v_auth, null::uuid; return; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then
    return query select 'invalid_name'::text, null::uuid; return;
  end if;
  insert into public.client_accounts (workspace_id, name, created_by)
  values (p_workspace_id, btrim(p_name), p_actor_id) returning id into v_id;
  return query select 'ok'::text, v_id;
end $$;

-- I7: archive denies everything at once and revokes every active grant in the
-- same transaction. Holds 3 (FOR UPDATE), then 4.
create function public.client_account_archive(p_workspace_id uuid, p_client_id uuid, p_actor_id uuid, p_session_id uuid)
returns table (outcome text, revoked_grants integer)
language plpgsql security definer set search_path = '' as $$
declare v_auth text; v_status text; v_now timestamptz := clock_timestamp(); v_n integer;
begin
  perform 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_actor_id for share;
  perform 1 from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id for share;
  select c.status into v_status from public.client_accounts c
   where c.workspace_id = p_workspace_id and c.id = p_client_id for update;
  v_auth := public.client_admin_authorization(p_workspace_id, p_actor_id, p_session_id);
  if v_auth <> 'ok' then return query select v_auth, null::integer; return; end if;
  if v_status is null then return query select 'client_not_found'::text, null::integer; return; end if;
  if v_status = 'archived' then return query select 'already_archived'::text, 0; return; end if;
  update public.client_accounts c set status = 'archived', archived_at = v_now, archived_by = p_actor_id
   where c.workspace_id = p_workspace_id and c.id = p_client_id;
  update public.client_access_grants g
     set revoked_at = v_now, revoked_by = p_actor_id, revoke_reason = 'client_archived'
   where g.workspace_id = p_workspace_id and g.client_id = p_client_id and g.revoked_at is null;
  get diagnostics v_n = row_count;
  return query select 'ok'::text, v_n;
end $$;

-- A3/A4: grant (or self-grant, recorded with granted_by = actor) the next
-- generation. The target's membership row is locked FOR NO KEY UPDATE, which
-- serializes generation allocation for that user even when no grant row exists
-- yet, and waits out any in-flight Brain write by that user (it holds the row
-- FOR SHARE). Actor and target rows are locked in user_id order, one statement.
create function public.client_access_grant(
  p_workspace_id uuid, p_client_id uuid, p_target_user_id uuid, p_actor_id uuid, p_session_id uuid)
returns table (outcome text, grant_id uuid, generation integer)
language plpgsql security definer set search_path = '' as $$
declare v_auth text; v_status text; v_id uuid; v_gen integer;
begin
  perform 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_actor_id for share;
  perform 1 from (select m.user_id from public.workspace_members m
                   where m.workspace_id = p_workspace_id and m.user_id in (p_actor_id, p_target_user_id)
                   order by m.user_id for no key update of m) locked;
  select c.status into v_status from public.client_accounts c
   where c.workspace_id = p_workspace_id and c.id = p_client_id for share;
  v_auth := public.client_admin_authorization(p_workspace_id, p_actor_id, p_session_id);
  if v_auth <> 'ok' then return query select v_auth, null::uuid, null::integer; return; end if;
  if not exists (select 1 from public.workspace_members m
                  where m.workspace_id = p_workspace_id and m.user_id = p_target_user_id) then
    return query select 'target_not_member'::text, null::uuid, null::integer; return;
  end if;
  if v_status is null then return query select 'client_not_found'::text, null::uuid, null::integer; return; end if;
  if v_status <> 'active' then return query select 'client_archived'::text, null::uuid, null::integer; return; end if;
  select g.id, g.generation into v_id, v_gen from public.client_access_grants g
   where g.workspace_id = p_workspace_id and g.client_id = p_client_id
     and g.user_id = p_target_user_id and g.revoked_at is null;
  if v_id is not null then return query select 'already_granted'::text, v_id, v_gen; return; end if;
  select coalesce(max(g.generation), 0) + 1 into v_gen from public.client_access_grants g
   where g.workspace_id = p_workspace_id and g.client_id = p_client_id and g.user_id = p_target_user_id;
  insert into public.client_access_grants (workspace_id, client_id, user_id, generation, granted_by)
  values (p_workspace_id, p_client_id, p_target_user_id, v_gen, p_actor_id) returning id into v_id;
  return query select 'ok'::text, v_id, v_gen;
end $$;

-- Terminal revocation of the active generation. Holds 2, 3, then 4 FOR UPDATE.
create function public.client_access_revoke(
  p_workspace_id uuid, p_client_id uuid, p_target_user_id uuid, p_actor_id uuid, p_session_id uuid)
returns table (outcome text, grant_id uuid, generation integer)
language plpgsql security definer set search_path = '' as $$
declare v_auth text; v_id uuid; v_gen integer;
begin
  perform 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_actor_id for share;
  perform 1 from (select m.user_id from public.workspace_members m
                   where m.workspace_id = p_workspace_id and m.user_id in (p_actor_id, p_target_user_id)
                   order by m.user_id for no key update of m) locked;
  perform 1 from public.client_accounts c
   where c.workspace_id = p_workspace_id and c.id = p_client_id for share;
  v_auth := public.client_admin_authorization(p_workspace_id, p_actor_id, p_session_id);
  if v_auth <> 'ok' then return query select v_auth, null::uuid, null::integer; return; end if;
  select g.id, g.generation into v_id, v_gen from public.client_access_grants g
   where g.workspace_id = p_workspace_id and g.client_id = p_client_id
     and g.user_id = p_target_user_id and g.revoked_at is null
   for update;
  if v_id is null then return query select 'not_granted'::text, null::uuid, null::integer; return; end if;
  update public.client_access_grants g
     set revoked_at = clock_timestamp(), revoked_by = p_actor_id, revoke_reason = 'revoked'
   where g.id = v_id;
  return query select 'ok'::text, v_id, v_gen;
end $$;

-- Owner/admin management listing (Codex O1): names, status and the count of
-- active grants. It is not a client switcher and grants no Brain access.
create function public.client_account_manage_list(p_workspace_id uuid, p_actor_id uuid, p_session_id uuid)
returns table (outcome text, client_id uuid, name text, status text, active_grants integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_auth text;
begin
  v_auth := public.client_admin_authorization(p_workspace_id, p_actor_id, p_session_id);
  if v_auth <> 'ok' then
    return query select v_auth, null::uuid, null::text, null::text, null::integer; return;
  end if;
  return query
    select 'ok'::text, c.id, c.name, c.status,
           (select count(*)::integer from public.client_access_grants g
             where g.workspace_id = c.workspace_id and g.client_id = c.id and g.revoked_at is null)
      from public.client_accounts c where c.workspace_id = p_workspace_id
     order by c.created_at, c.id;
end $$;

-- The client switcher: only the active clients this actor holds an active
-- grant for, on a live session. Empty otherwise (no reason is leaked).
create function public.client_accounts_for_actor(p_workspace_id uuid, p_actor_id uuid, p_session_id uuid)
returns table (client_id uuid, name text, grant_id uuid, generation integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select c.id, c.name, g.id, g.generation
    from public.client_accounts c
    join public.client_access_grants g
      on g.workspace_id = c.workspace_id and g.client_id = c.id
     and g.user_id = p_actor_id and g.revoked_at is null
   where c.workspace_id = p_workspace_id and c.status = 'active'
     and exists (select 1 from public.workspace_members m
                  where m.workspace_id = p_workspace_id and m.user_id = p_actor_id)
     and exists (select 1 from auth.sessions s
                  where s.id = p_session_id and s.user_id = p_actor_id
                    and (s.not_after is null or s.not_after > clock_timestamp()))
   order by c.name, c.id;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.client_admin_authorization(uuid, uuid, uuid)',
    'public.client_brain_authorization(uuid, uuid, uuid, uuid, text, text, uuid, integer, bigint)',
    'public.client_brain_pin(uuid, uuid, uuid, uuid, text)',
    'public.client_brain_read(uuid, uuid, uuid, uuid, text, uuid, integer, bigint)',
    'public.client_brain_authorized_write(uuid, uuid, uuid, uuid, text, text, text, jsonb, bigint, boolean, uuid, integer, bigint)',
    'public.client_account_create(uuid, uuid, uuid, text)',
    'public.client_account_archive(uuid, uuid, uuid, uuid)',
    'public.client_access_grant(uuid, uuid, uuid, uuid, uuid)',
    'public.client_access_revoke(uuid, uuid, uuid, uuid, uuid)',
    'public.client_account_manage_list(uuid, uuid, uuid)',
    'public.client_accounts_for_actor(uuid, uuid, uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function public.client_accounts_guard(), public.client_access_grants_guard() from public, anon, authenticated, service_role;
