-- PRODUCTION-SHAPED CLONE for the Company Brain chain (20261023 → 20261024 →
-- held 20261110). company_brain exactly as production holds it (columns,
-- defaults, PK/FKs, policies, grants, updated_at trigger) — read from the
-- production catalog 2026-11-12. Applied AFTER prod_security_clone.sql.
create table if not exists auth.users (id uuid primary key);
create table if not exists auth.sessions (id uuid primary key, user_id uuid not null, not_after timestamptz);
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create table public.company_brain (
  workspace_id uuid not null primary key references public.workspaces(id) on delete cascade,
  company_name text, what_we_do text, who_we_sell_to text, voice_and_tone text,
  do_not_say jsonb not null default '[]'::jsonb, examples jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null,
  id uuid default gen_random_uuid(), profile jsonb not null default '{}'::jsonb,
  onboarding_completed boolean not null default false, created_at timestamptz default now(), onboarding_completed_at timestamptz);
create trigger company_brain_set_updated_at before update on public.company_brain for each row execute function public.set_updated_at();
alter table public.company_brain enable row level security;
create policy company_brain_member_insert on public.company_brain as permissive for insert to authenticated with check (has_workspace_access(auth.uid(), workspace_id));
create policy company_brain_member_select on public.company_brain as permissive for select to authenticated using (has_workspace_access(auth.uid(), workspace_id));
create policy company_brain_member_update on public.company_brain as permissive for update to authenticated using (has_workspace_access(auth.uid(), workspace_id)) with check (has_workspace_access(auth.uid(), workspace_id));
grant references, select, trigger on public.company_brain to anon;
grant delete, insert, references, select, trigger, update on public.company_brain to authenticated;
grant all on public.company_brain to service_role;
-- Fictional people: A owner a001, A viewer a004; B owner b001. Live sessions.
insert into auth.users values ('00000000-0000-4000-8000-00000000a001'),('00000000-0000-4000-8000-00000000a004'),('00000000-0000-4000-8000-00000000b001');
insert into auth.sessions values ('10000000-0000-4000-8000-00000000a001','00000000-0000-4000-8000-00000000a001',null),
  ('10000000-0000-4000-8000-00000000a004','00000000-0000-4000-8000-00000000a004',null),('10000000-0000-4000-8000-00000000b001','00000000-0000-4000-8000-00000000b001',null);
insert into public.workspace_members (workspace_id, user_id, role) values ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-00000000a004','viewer');
-- An EXISTING Brain (production holds 2 onboarded rows): must survive untouched.
insert into public.company_brain (workspace_id, company_name, what_we_do, profile, onboarding_completed, updated_at)
  values ('00000000-0000-4000-8000-0000000000a1','Fictional Co','Makes things','{"company":{"name":"Fictional Co"},"target_customer":{"industries":["Manufacturing"]}}', true, '2026-10-22T06:10:42Z');
