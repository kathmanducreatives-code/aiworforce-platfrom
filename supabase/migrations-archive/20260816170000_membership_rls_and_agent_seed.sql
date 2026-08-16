-- ============================================================================
-- Eight core policies keyed on an empty table, and agents in nobody's workspace
-- ============================================================================
--
-- The onboarding loop was one symptom of this, not the whole of it. EIGHT
-- policies — the entire orchestration surface — authorise against
-- `public.users`:
--
--   workspace_id in (select users.workspace_id from users where users.id = auth.uid())
--
-- `public.users` is empty. Membership lives in `workspace_members`. So every
-- one of these tables returns zero rows to a signed-in user, and RLS denies a
-- select by returning NOTHING rather than by erroring — which is why the app
-- showed an empty Workbench and a redirect loop instead of a permission error.
--
--   agents             no agents visible anywhere in the UI
--   tasks, task_plans  the Workbench renders an empty run
--   activity_feed      no activity, ever
--   approvals          approval gates invisible; work silently stalls
--   handoffs           agent-to-agent handoffs unreadable
--   agent_capabilities capability checks see nothing
--   workspaces         the user cannot read their own workspace row
--
-- The old project has 20 rows in `workspace_members` and 2 in `users`, so this
-- was broken there for 18 of 20 members too. It is not a migration regression;
-- the migration carried it faithfully into a project where nobody has a `users`
-- row, which took it from "broken for most" to "broken for all".
--
-- All eight now route through `has_workspace_access`, the SECURITY DEFINER
-- helper that already encodes this correctly — so the next change to what
-- "access" means happens once rather than eight times.
--
-- ── AND THE AGENTS WERE IN THE WRONG WORKSPACE ──────────────────────────────
--
-- `agents` is workspace-scoped, and all five were seeded into the sentinel
-- workspace that exists only to satisfy their foreign key. Even with the policy
-- fixed, a real user is not a member of that workspace and would still see
-- none. Every workspace needs its own five, so provisioning seeds them and a
-- backfill covers the workspaces that already exist.

-- ── 1. MEMBERSHIP-BASED RLS ─────────────────────────────────────────────────

do $$
declare
  t text;
  p text;
begin
  -- `agent_capabilities` is deliberately absent: it has no `workspace_id`
  -- column and scopes through `agent_id`. It is handled separately below.
  foreach t in array array[
    'agents','tasks','task_plans','approvals','activity_feed','handoffs'
  ] loop
    -- Drop whatever the users-based policy was called on this table.
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
        and (qual::text ~ 'FROM users' or with_check::text ~ 'FROM users')
    loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;

    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using (public.has_workspace_access(auth.uid(), workspace_id))
        with check (public.has_workspace_access(auth.uid(), workspace_id))
    $f$, t || '_workspace_member_access', t);
  end loop;
end $$;

-- `agent_capabilities` reaches its workspace through the agent it belongs to.
drop policy if exists capabilities_access on public.agent_capabilities;
create policy agent_capabilities_member_access
  on public.agent_capabilities
  for all to authenticated
  using (exists (
    select 1 from public.agents a
    where a.id = agent_capabilities.agent_id
      and public.has_workspace_access(auth.uid(), a.workspace_id)
  ))
  with check (exists (
    select 1 from public.agents a
    where a.id = agent_capabilities.agent_id
      and public.has_workspace_access(auth.uid(), a.workspace_id)
  ));

-- `workspaces` keys on `id`, not `workspace_id`, so it cannot share the loop.
drop policy if exists workspace_access on public.workspaces;
create policy workspaces_member_access
  on public.workspaces
  for all to authenticated
  using (public.has_workspace_access(auth.uid(), id))
  with check (public.has_workspace_access(auth.uid(), id));

-- ── 2. EVERY WORKSPACE GETS ITS OWN AGENTS ──────────────────────────────────

create or replace function public.seed_agents_for_workspace(_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
  template_ws uuid;
begin
  -- Nothing to do if this workspace already has agents.
  if exists (select 1 from public.agents where workspace_id = _workspace_id) then
    return 0;
  end if;

  -- Copy from whichever workspace currently holds the canonical five, so the
  -- role prompts stay in ONE place. Hardcoding them here would create a second
  -- copy that drifts the first time anyone edits a prompt.
  select workspace_id into template_ws
  from public.agents
  group by workspace_id
  order by count(*) desc
  limit 1;

  if template_ws is null then
    return 0;
  end if;

  insert into public.agents (workspace_id, slug, name, model, role_prompt, department)
  select _workspace_id, a.slug, a.name, a.model, a.role_prompt, a.department
  from public.agents a
  where a.workspace_id = template_ws;

  get diagnostics inserted = row_count;
  return inserted;
end $$;

-- Fold seeding into provisioning so a new signup gets a working workspace.
create or replace function public.provision_workspace_for_user(_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  new_id uuid;
  display_name text;
begin
  select workspace_id into existing_id
  from public.workspace_members
  where user_id = _user_id
  order by created_at asc
  limit 1;

  if existing_id is not null then
    -- Idempotent, and it repairs an older workspace that predates seeding.
    perform public.seed_agents_for_workspace(existing_id);
    return existing_id;
  end if;

  select coalesce(nullif(p.full_name, ''), 'My Workspace')
    into display_name
  from public.profiles p
  where p.user_id = _user_id
  limit 1;

  if display_name is null then
    display_name := 'My Workspace';
  end if;

  insert into public.workspaces (name, created_by)
  values (display_name || '''s Workspace', _user_id)
  returning id into new_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_id, _user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.company_brain (workspace_id, profile)
  values (new_id, '{}'::jsonb)
  on conflict (workspace_id) do nothing;

  perform public.seed_agents_for_workspace(new_id);

  return new_id;
end $$;

grant execute on function public.provision_workspace_for_user(uuid) to authenticated;

-- ── 3. BACKFILL ─────────────────────────────────────────────────────────────

do $$
declare w record;
begin
  for w in
    select ws.id from public.workspaces ws
    where exists (select 1 from public.workspace_members m where m.workspace_id = ws.id)
  loop
    perform public.seed_agents_for_workspace(w.id);
  end loop;
end $$;
