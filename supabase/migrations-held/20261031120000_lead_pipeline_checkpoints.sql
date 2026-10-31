-- HELD — NOT APPLIED. Lead pipeline walk checkpoints (leadPipeline/checkpoint.ts).
-- Requires 20261027120000_provider_connections.sql (the usage ledger) first.
-- Not approved for production.
--
-- One row per (workspace, walk): the LeadOcean person ids already bought for an
-- ICP walk, so a resumed walk excludes them, plus running totals. No cursor,
-- no contact value. Service role only; members may read their workspace's rows.

create table public.lead_pipeline_checkpoints (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  walk_id text not null check (length(walk_id) between 1 and 120),
  icp_id text not null,
  version text not null,
  seen_person_ids text[] not null default '{}',
  seen_company_keys text[] not null default '{}',
  pages_bought integer not null default 0 check (pages_bought >= 0),
  records_bought integer not null default 0 check (records_bought >= 0),
  exhausted text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, walk_id)
);

alter table public.lead_pipeline_checkpoints enable row level security;
revoke all on public.lead_pipeline_checkpoints from public, anon, authenticated;
grant select on public.lead_pipeline_checkpoints to authenticated;
create policy lead_pipeline_checkpoints_member_read on public.lead_pipeline_checkpoints
  for select to authenticated
  using (public.has_workspace_access(auth.uid(), workspace_id));
grant select, insert, update on public.lead_pipeline_checkpoints to service_role;
