-- HELD. Not applied anywhere except the disposable database-contract lane
-- (tests/db-contract/bootstrap.sh). Needs explicit approval, after #176 and the
-- #174 contract, before it is applied to any hosted project. Client-scoped
-- execution stays refused at every entry (#179's guard: client_scope_unsupported)
-- until the owner enables client Brains; these columns are where an enabled
-- client task will carry its authorization. See supabase/migrations-held/README.md.
--
-- ── IMMUTABLE TASK PINS (contract #174 §8 "Pins in task storage", §9.1) ───────
--
-- A client task records, ONCE, the authorization it was created under:
--   client_id, client_grant_id, client_grant_generation, permission_revision,
--   origin_session_id
-- (from `client_brain_pin` at authorization). Every resume and retry presents
-- them to `client_brain_authorization(..., 'task', pins)` (§9.2); a re-pin is a
-- new user authorization, never a silent refresh.
--
-- What the database guarantees, for every writer:
--   * all five pins or none (check);
--   * the client is in the task's workspace, and the pinned generation is a
--     grant OF THIS TASK'S USER for that client in that workspace — composite
--     foreign keys onto #176's existing unique keys (no Brain schema change);
-- and for the application roles (service_role, authenticated, anon; the same
-- scoping as 20261025130000):
--   * pins are written only when the task is created, and only if they are
--     valid AT COMMIT: under the §5 lock order (membership 2 → client 3 →
--     grant 4) the trigger asks Brain's own rule,
--     client_brain_authorization(..., 'task', pins) = 'ok', so a revoke,
--     regrant, role change, archive or logout committed first refuses the task
--     (Codex: "revalidate under the commit boundary before creating an
--     executable task"), and one committing later waits for this transaction;
--   * the pinned grant id is that generation's row;
--   * pins never change afterwards, and neither do a pinned task's workspace
--     or principal (42501).
-- Administrative SQL (role postgres) is not an application writer.
--
-- Rollback: rollback/20261025170000_task_client_pins.down.sql

alter table public.tasks
  add column client_id uuid,
  add column client_grant_id uuid,
  add column client_grant_generation integer,
  add column permission_revision bigint,
  add column origin_session_id uuid;

alter table public.tasks
  add constraint tasks_client_pins_all_or_none check (
    (client_id is null and client_grant_id is null and client_grant_generation is null
       and permission_revision is null and origin_session_id is null)
    or (client_id is not null and client_grant_id is not null and client_grant_generation is not null
       and permission_revision is not null and origin_session_id is not null)),
  add constraint tasks_client_in_workspace foreign key (workspace_id, client_id)
    references public.client_accounts (workspace_id, id),
  add constraint tasks_client_grant_of_task_user foreign key (workspace_id, client_id, user_id, client_grant_generation)
    references public.client_access_grants (workspace_id, client_id, user_id, generation);

create or replace function public.tasks_client_pins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text;
begin
  if coalesce(current_setting('role', true), '') not in ('service_role', 'authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.client_id is distinct from new.client_id
       or old.client_grant_id is distinct from new.client_grant_id
       or old.client_grant_generation is distinct from new.client_grant_generation
       or old.permission_revision is distinct from new.permission_revision
       or old.origin_session_id is distinct from new.origin_session_id then
      raise exception 'tasks: client pins are written once, when the task is created (a re-pin is a new authorization)'
        using errcode = '42501';
    end if;
    if old.client_id is not null
       and (new.workspace_id is distinct from old.workspace_id or new.user_id is distinct from old.user_id) then
      raise exception 'tasks: a pinned task keeps its workspace and principal' using errcode = '42501';
    end if;
    return new;
  end if;
  -- No pins, or incomplete ones: the all-or-none check rejects the latter
  -- itself (23514), after this trigger.
  if new.client_id is null or new.client_grant_id is null or new.client_grant_generation is null
     or new.permission_revision is null or new.origin_session_id is null then
    return new;
  end if;
  -- §5 lock order: membership (2), client (3), grant (4); the read below then
  -- sees the state every concurrent writer committed or must wait behind.
  perform 1 from public.workspace_members m
    where m.workspace_id = new.workspace_id and m.user_id = new.user_id for key share;
  perform 1 from public.client_accounts c
    where c.workspace_id = new.workspace_id and c.id = new.client_id for share;
  perform 1 from public.client_access_grants g
    where g.id = new.client_grant_id for share;
  if not exists (select 1 from public.client_access_grants g
                  where g.id = new.client_grant_id and g.workspace_id = new.workspace_id
                    and g.client_id = new.client_id and g.user_id = new.user_id
                    and g.generation = new.client_grant_generation) then
    raise exception 'tasks: the pinned grant id is not the pinned generation of this user''s grant' using errcode = '23503';
  end if;
  v_outcome := public.client_brain_authorization(new.workspace_id, new.client_id, new.user_id, new.origin_session_id,
    'read', 'task', new.client_grant_id, new.client_grant_generation, new.permission_revision);
  if v_outcome <> 'ok' then
    raise exception 'tasks: client pins refused at commit (%)', v_outcome using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.tasks_client_pins() from public, anon, authenticated, service_role;

-- Named to fire after tasks_commit_boundary (20261025130000), which takes the
-- membership lock first; triggers fire in name order.
drop trigger if exists tasks_pins_at_commit on public.tasks;
create trigger tasks_pins_at_commit
  before insert or update of client_id, client_grant_id, client_grant_generation, permission_revision,
    origin_session_id, workspace_id, user_id on public.tasks
  for each row execute function public.tasks_client_pins();
