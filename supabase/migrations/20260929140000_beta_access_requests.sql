-- BETA ACCESS REQUESTS — the path from "no credits" to a grant.
--
-- Spend fails closed (20260929 budget safety): a workspace spends provider
-- credits only after an operator grants them. The refusal tells the user to
-- request beta access; this is where that request lives, and where the operator
-- decides it (scripts/beta/review-requests.ts). Signup stays open.
--
-- A member may FILE a request for their own workspace and READ their
-- workspace's requests. Only the service role decides one: there is no client
-- UPDATE or DELETE policy, so status, credits_granted and the decision fields
-- cannot be written from a browser.

create table if not exists public.beta_access_requests (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  requested_by    uuid not null,
  note            text check (note is null or char_length(note) <= 1000),
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'declined')),
  credits_granted integer check (credits_granted is null or credits_granted > 0),
  decided_at      timestamptz,
  decision_note   text check (decision_note is null or char_length(decision_note) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A decision is complete or absent: never "approved" without a time.
  constraint beta_access_requests_decided_consistent check (
    (status = 'pending' and decided_at is null and credits_granted is null)
    or (status = 'approved' and decided_at is not null and credits_granted is not null)
    or (status = 'declined' and decided_at is not null and credits_granted is null)
  )
);

-- One open request per workspace: a second click answers "already requested".
create unique index if not exists beta_access_requests_one_pending
  on public.beta_access_requests (workspace_id) where status = 'pending';

create index if not exists beta_access_requests_status_created
  on public.beta_access_requests (status, created_at);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.beta_access_requests enable row level security;
revoke all on table public.beta_access_requests from anon;
-- A browser files and reads; it never edits or removes a request.
revoke update, delete, truncate on table public.beta_access_requests from authenticated;

drop policy if exists "beta_access_requests members read" on public.beta_access_requests;
create policy "beta_access_requests members read" on public.beta_access_requests
  for select using (public.has_workspace_access(auth.uid(), workspace_id));

-- Filed AS the caller, FOR a workspace they belong to, and undecided.
drop policy if exists "beta_access_requests members file" on public.beta_access_requests;
create policy "beta_access_requests members file" on public.beta_access_requests
  for insert with check (
    public.has_workspace_access(auth.uid(), workspace_id)
    and requested_by = auth.uid()
    and status = 'pending'
    and credits_granted is null
    and decided_at is null
    and decision_note is null
  );
