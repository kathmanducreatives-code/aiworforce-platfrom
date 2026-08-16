-- ============================================================================
-- workspace_sources — the next onboarding step that would have failed
-- ============================================================================
--
-- Found by diffing every table the edge functions reference against the tables
-- that exist, rather than by waiting for the failure. `setup-company-brain`
-- deletes from and inserts into this table on `save_sources`, and reads it on
-- `analyze`. It has never existed — not here and not in the old project — so
-- the sources step of onboarding would have thrown exactly as founder analysis
-- did, one screen later.
--
-- The shape is taken from the two call sites, which agree: `workspace_id`,
-- `source_type`, `url`, `label`, `status`, and nothing else is ever written or
-- selected.
--
-- Two other tables are missing for the same reason — `signal_feed` and
-- `lead_results`, both read only by the MCP server's `list_signals` and
-- `list_leads` tools. They are NOT created here. Their shape cannot be
-- recovered from a `select("*")` and a `select` of seven columns, and inventing
-- a schema for a feature nobody has exercised would be guessing dressed as a
-- migration. Those two tools stay broken and named rather than silently
-- half-built.

create table if not exists public.workspace_sources (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type  text not null default 'other',
  url          text not null,
  label        text,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- `analyze` reads every source for one workspace; that is the only query shape.
create index if not exists workspace_sources_workspace_idx
  on public.workspace_sources (workspace_id);

-- The same URL twice in one workspace is a duplicate scrape at full price. The
-- writer clears before inserting, so this constrains a concurrent second save
-- rather than the normal path.
create unique index if not exists workspace_sources_workspace_url_key
  on public.workspace_sources (workspace_id, url);

alter table public.workspace_sources enable row level security;

drop policy if exists workspace_sources_member_select on public.workspace_sources;

-- READ-ONLY FOR MEMBERS, matching company_brain_research_runs. Writes are the
-- edge function's under the service role: a client that could insert a source
-- could point the Company Brain research at a URL of its choosing and have the
-- result stored as the workspace's own evidence.
create policy workspace_sources_member_select
  on public.workspace_sources
  for select to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspace_sources.workspace_id
      and m.user_id = auth.uid()
  ));
