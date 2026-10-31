-- HELD — NOT APPLIED. Discovery engine: reusable verification evidence per workspace
-- (discoveryEngine/cache.ts). A company record bought once is reused while fresh.
-- Keyed by (workspace, LinkedIn company slug): one workspace never reads another's
-- purchases. Service role only; members may read their workspace's rows.

create table public.discovery_evidence_cache (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null check (length(slug) between 2 and 200),
  evidence jsonb not null,
  facts jsonb,
  observed_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, slug)
);

alter table public.discovery_evidence_cache enable row level security;
revoke all on public.discovery_evidence_cache from public, anon, authenticated;
grant select on public.discovery_evidence_cache to authenticated;
create policy discovery_evidence_cache_member_read on public.discovery_evidence_cache
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));
grant select, insert, update on public.discovery_evidence_cache to service_role;
