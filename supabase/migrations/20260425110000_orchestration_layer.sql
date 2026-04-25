-- ============================================================
-- Orchestration Layer
-- ============================================================

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Workspace',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on public.workspace_members(user_id);
create index if not exists workspace_members_ws_idx on public.workspace_members(workspace_id);

create or replace function public.is_workspace_member(_user_id uuid, _workspace_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members
    where user_id = _user_id and workspace_id = _workspace_id);
$$;

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null,
  name text not null,
  department text not null check (department in ('talent','growth','intelligence','content')),
  model text not null default 'gpt-4o',
  status text not null default 'idle' check (status in ('idle','running','awaiting_approval','error')),
  current_task text,
  progress int not null default 0,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
create index if not exists agents_ws_idx on public.agents(workspace_id);

create table if not exists public.agent_capabilities (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  capability text not null,
  tool text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.task_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_instruction text not null,
  plan_summary text,
  status text not null default 'planning' check (status in ('planning','executing','awaiting_approval','complete','failed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists task_plans_ws_idx on public.task_plans(workspace_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.task_plans(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  step_index int not null default 0,
  description text not null,
  status text not null default 'pending' check (status in ('pending','running','complete','failed','skipped')),
  input jsonb,
  output jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tasks_plan_idx on public.tasks(plan_id);

create table if not exists public.activity_feed (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid references public.task_plans(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  event_type text not null check (event_type in (
    'plan_created','agent_started','handoff','awaiting_approval',
    'approved','rejected','plan_complete')),
  title text not null,
  body text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_feed_ws_created_idx on public.activity_feed(workspace_id, created_at desc);

create table if not exists public.handoffs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.task_plans(id) on delete cascade,
  from_agent_id uuid references public.agents(id) on delete set null,
  to_agent_id uuid references public.agents(id) on delete set null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid references public.task_plans(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  task_id uuid references public.tasks(id) on delete cascade,
  title text not null,
  description text,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists approvals_ws_status_idx on public.approvals(workspace_id, status);

alter table public.workspaces           enable row level security;
alter table public.workspace_members    enable row level security;
alter table public.agents               enable row level security;
alter table public.agent_capabilities   enable row level security;
alter table public.task_plans           enable row level security;
alter table public.tasks                enable row level security;
alter table public.activity_feed        enable row level security;
alter table public.handoffs             enable row level security;
alter table public.approvals            enable row level security;

drop policy if exists "ws_select_own" on public.workspaces;
create policy "ws_select_own" on public.workspaces for select to authenticated
  using (owner_id = auth.uid() or public.is_workspace_member(auth.uid(), id));
drop policy if exists "ws_insert_own" on public.workspaces;
create policy "ws_insert_own" on public.workspaces for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists "ws_update_owner" on public.workspaces;
create policy "ws_update_owner" on public.workspaces for update to authenticated using (owner_id = auth.uid());

drop policy if exists "wm_select_self_or_member" on public.workspace_members;
create policy "wm_select_self_or_member" on public.workspace_members for select to authenticated
  using (user_id = auth.uid() or public.is_workspace_member(auth.uid(), workspace_id));
drop policy if exists "wm_insert_self" on public.workspace_members;
create policy "wm_insert_self" on public.workspace_members for insert to authenticated
  with check (user_id = auth.uid());

-- agents
drop policy if exists "agents_select_member" on public.agents;
create policy "agents_select_member" on public.agents for select to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id));
drop policy if exists "agents_write_member" on public.agents;
create policy "agents_write_member" on public.agents for all to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id))
  with check (public.is_workspace_member(auth.uid(), workspace_id));

-- task_plans
drop policy if exists "tp_select_member" on public.task_plans;
create policy "tp_select_member" on public.task_plans for select to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id));
drop policy if exists "tp_write_member" on public.task_plans;
create policy "tp_write_member" on public.task_plans for all to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id))
  with check (public.is_workspace_member(auth.uid(), workspace_id));

-- tasks (via plan)
drop policy if exists "tasks_select_member" on public.tasks;
create policy "tasks_select_member" on public.tasks for select to authenticated
  using (exists (select 1 from public.task_plans p where p.id = tasks.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)));
drop policy if exists "tasks_write_member" on public.tasks;
create policy "tasks_write_member" on public.tasks for all to authenticated
  using (exists (select 1 from public.task_plans p where p.id = tasks.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)))
  with check (exists (select 1 from public.task_plans p where p.id = tasks.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)));

-- activity_feed
drop policy if exists "af_select_member" on public.activity_feed;
create policy "af_select_member" on public.activity_feed for select to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id));
drop policy if exists "af_write_member" on public.activity_feed;
create policy "af_write_member" on public.activity_feed for all to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id))
  with check (public.is_workspace_member(auth.uid(), workspace_id));

-- handoffs (via plan)
drop policy if exists "hf_select_member" on public.handoffs;
create policy "hf_select_member" on public.handoffs for select to authenticated
  using (exists (select 1 from public.task_plans p where p.id = handoffs.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)));
drop policy if exists "hf_write_member" on public.handoffs;
create policy "hf_write_member" on public.handoffs for all to authenticated
  using (exists (select 1 from public.task_plans p where p.id = handoffs.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)))
  with check (exists (select 1 from public.task_plans p where p.id = handoffs.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)));

-- approvals
drop policy if exists "appr_select_member" on public.approvals;
create policy "appr_select_member" on public.approvals for select to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id));
drop policy if exists "appr_write_member" on public.approvals;
create policy "appr_write_member" on public.approvals for all to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id))
  with check (public.is_workspace_member(auth.uid(), workspace_id));

-- agent_capabilities
drop policy if exists "ac_select_member" on public.agent_capabilities;
create policy "ac_select_member" on public.agent_capabilities for select to authenticated
  using (exists (select 1 from public.agents a where a.id = agent_capabilities.agent_id
    and public.is_workspace_member(auth.uid(), a.workspace_id)));
drop policy if exists "ac_write_member" on public.agent_capabilities;
create policy "ac_write_member" on public.agent_capabilities for all to authenticated
  using (exists (select 1 from public.agents a where a.id = agent_capabilities.agent_id
    and public.is_workspace_member(auth.uid(), a.workspace_id)))
  with check (exists (select 1 from public.agents a where a.id = agent_capabilities.agent_id
    and public.is_workspace_member(auth.uid(), a.workspace_id)));

-- realtime
alter table public.agents         replica identity full;
alter table public.activity_feed  replica identity full;
alter table public.approvals      replica identity full;
alter table public.task_plans     replica identity full;

do $$ begin
  begin alter publication supabase_realtime add table public.agents;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.activity_feed; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.approvals;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.task_plans;    exception when duplicate_object then null; end;
end $$;

-- provisioning function
create or replace function public.provision_workspace_for_user(_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws_id uuid;
begin
  select workspace_id into ws_id from public.workspace_members where user_id = _user_id limit 1;
  if ws_id is not null then return ws_id; end if;
  insert into public.workspaces (name, owner_id) values ('My Workspace', _user_id) returning id into ws_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws_id, _user_id, 'owner');
  insert into public.agents (workspace_id, slug, name, department, model, status, current_task, progress) values
    (ws_id, 'aria',   'Aria',   'talent',       'gpt-4o',        'idle', 'Ready for tasks', 0),
    (ws_id, 'scout',  'Scout',  'talent',       'claude-sonnet', 'idle', 'Ready for tasks', 0),
    (ws_id, 'penn',   'Penn',   'growth',       'claude-sonnet', 'idle', 'Ready for tasks', 0),
    (ws_id, 'hawk',   'Hawk',   'intelligence', 'gemini-pro',    'idle', 'Ready for tasks', 0),
    (ws_id, 'scribe', 'Scribe', 'content',      'claude-haiku',  'idle', 'Ready for tasks', 0);
  return ws_id;
end $$;

create or replace function public.handle_new_user_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.provision_workspace_for_user(new.id);
  return new;
exception when others then return new;
end $$;

drop trigger if exists on_auth_user_created_workspace on auth.users;
create trigger on_auth_user_created_workspace
  after insert on auth.users for each row execute function public.handle_new_user_workspace();

-- backfill
do $$ declare u record; begin
  for u in select id from auth.users loop
    perform public.provision_workspace_for_user(u.id);
  end loop;
end $$;
