-- R1.2.1 · A CONVERSATION'S WORKSPACE IS SET ONCE, BY A MEMBER, AND NEVER MOVED.
--
-- HELD: not applied anywhere until approved (TEST first, then production).
-- Additive: one function and one trigger on public.conversations. No data change.
-- Rollback: supabase/migrations-held/rollback/20261121120000_conversation_workspace_guard.down.sql
--
-- WHY. RLS on conversations is owner-only (user_id = auth.uid()) for every
-- verb, so the browser may INSERT a conversation naming ANY workspace_id and
-- UPDATE workspace_id on its own conversation at will. pilot-chat (R1.2.1)
-- binds an unbound conversation on first use and refuses one bound elsewhere,
-- but a client that rewrote workspace_id could still carry a conversation's
-- history from one workspace into another. This makes the binding a database
-- invariant instead of a convention:
--   1. Once workspace_id is set it cannot be changed or cleared — except by the
--      foreign key's own ON DELETE SET NULL when the workspace itself is deleted.
--   2. A browser session (auth.uid() present) may set workspace_id only to a
--      workspace it is a member of. The service role (pilot-chat, auth.uid()
--      NULL) is not restricted here: it checks membership before binding.
-- Legacy rows with workspace_id NULL are untouched and keep working.

create or replace function public.conversations_workspace_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.workspace_id is not null
     and new.workspace_id is distinct from old.workspace_id then
    -- The FK's ON DELETE SET NULL runs after the workspace row is gone.
    if new.workspace_id is null
       and not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      return new;
    end if;
    raise exception 'conversation % is bound to its workspace; it cannot be moved', old.id
      using errcode = '42501';
  end if;

  if new.workspace_id is not null
     and (tg_op = 'INSERT' or old.workspace_id is null)
     and auth.uid() is not null
     and not exists (
       select 1 from public.workspace_members m
        where m.workspace_id = new.workspace_id and m.user_id = auth.uid()
     ) then
    raise exception 'not a member of workspace %', new.workspace_id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.conversations_workspace_guard() from public, anon, authenticated;

drop trigger if exists conversations_workspace_guard on public.conversations;
create trigger conversations_workspace_guard
  before insert or update of workspace_id on public.conversations
  for each row execute function public.conversations_workspace_guard();
