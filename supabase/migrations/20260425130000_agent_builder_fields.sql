-- Agent Builder: extend agents + agent_capabilities
alter table public.agents
  add column if not exists role_prompt   text,
  add column if not exists tools         text[] not null default '{}',
  add column if not exists trigger_type  text not null default 'on_demand',
  add column if not exists avatar_color  text not null default 'emerald',
  add column if not exists is_default    boolean not null default false;

alter table public.agents drop constraint if exists agents_department_check;
alter table public.agents
  add constraint agents_department_check
  check (department in ('talent','growth','intelligence','content','operations'));

alter table public.agent_capabilities
  add column if not exists input_type  text,
  add column if not exists output_type text,
  add column if not exists priority    int not null default 1;

update public.agents
set is_default = true
where slug in ('aria','scout','penn','hawk','scribe');
