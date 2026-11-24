-- Agent collaboration (Phase 5): the reviewable handoff ledger between LISA,
-- ORION, ATLAS and LYRA.
--
-- HELD. Applied only by the disposable database-contract lane
-- (tests/db-contract/bootstrap.sh). Additive: no existing table, column,
-- policy, grant or function changes. Depends on the LISA V2 held migration
-- (20261111120000) for signal_events.normalized_value.lisa, and on
-- company_brain_write_authorization (20261024120000).
--
-- WHY NOT `approvals`. public.approvals has a FOR ALL member policy, so any
-- member — a viewer included — can set status = 'approved' from the browser.
-- A handoff here gates paid research, so it is written ONLY by the SECURITY
-- DEFINER functions below (service_role), which lock the caller's session and
-- membership and re-check the CURRENT role in the same transaction.
--
-- What the database guarantees (not just the code):
--   * one handoff per (workspace, idempotency_key): duplicate signals, retries
--     and concurrent requests converge on one row;
--   * a research / content handoff may only cite signals of the SAME workspace
--     that are still current (active; not dismissed, disputed, retracted,
--     expired or stale) — research additionally needs a COUNTED verification
--     (corroborated or self-reported), content refuses contradicted claims;
--   * approval re-checks the signals: one retracted while awaiting review
--     blocks the handoff instead of approving it;
--   * only listed transitions happen, by compare-and-set on the current status,
--     so a cancelled or rejected handoff can never run later;
--   * `completed` requires a persisted result; an ATLAS "qualified" result must
--     name a lead_candidates row in the same workspace; a LYRA draft and the
--     handoff's completion are written in ONE transaction;
--   * every transition is appended to agent_handoff_events.

create table if not exists public.agent_handoffs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contract_version text not null default 'agent-collab-v1' check (contract_version = 'agent-collab-v1'),
  source_agent text not null check (source_agent in ('lisa', 'orion', 'atlas', 'lyra', 'brain')),
  target_agent text not null check (target_agent in ('lisa', 'orion', 'atlas', 'lyra', 'brain')),
  kind text not null check (kind in ('atlas_research', 'lyra_content', 'orion_review')),
  status text not null check (status in ('proposed', 'awaiting_review', 'approved', 'rejected', 'queued', 'running',
                                         'completed', 'partially_completed', 'failed', 'cancelled', 'blocked')),
  company jsonb,
  signal_ids uuid[] not null default '{}',
  lead_ids uuid[] not null default '{}',
  brain_fingerprint text,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  verification jsonb not null default '{}'::jsonb,
  requires_approval boolean not null,
  idempotency_key text not null check (char_length(idempotency_key) between 3 and 300),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text check (error is null or char_length(error) <= 1000),
  attempts int not null default 0 check (attempts between 0 and 3),
  parent_id uuid references public.agent_handoffs(id) on delete set null,
  decided_by uuid,
  decided_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  constraint agent_handoffs_not_self check (source_agent <> target_agent),
  constraint agent_handoffs_consequential_reviewed check (kind = 'orion_review' or requires_approval),
  constraint agent_handoffs_research_has_company check (kind <> 'atlas_research' or company ? 'name'),
  constraint agent_handoffs_completed_persisted check (
    status not in ('completed', 'partially_completed') or coalesce((result->>'persisted')::boolean, false))
);
create index if not exists agent_handoffs_ws_status_idx on public.agent_handoffs (workspace_id, status, created_at desc);

create table if not exists public.agent_handoff_events (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  handoff_id uuid not null references public.agent_handoffs(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor text not null check (actor ~ '^(user:[0-9a-f-]{36}|agent:(lisa|orion|atlas|lyra|brain))$'),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists agent_handoff_events_handoff_idx on public.agent_handoff_events (handoff_id, id);

alter table public.agent_handoffs enable row level security;
alter table public.agent_handoff_events enable row level security;
revoke all on public.agent_handoffs, public.agent_handoff_events from public, anon, authenticated, service_role;
revoke all on sequence public.agent_handoff_events_id_seq from public, anon, authenticated, service_role;
grant select on public.agent_handoffs, public.agent_handoff_events to authenticated, service_role;
create policy agent_handoffs_member_read on public.agent_handoffs
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));
create policy agent_handoff_events_member_read on public.agent_handoff_events
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));

-- ───────────────────────────────────────────── is a cited signal current?
-- Returns NULL when every cited signal may back this kind of handoff, else the reason.
create or replace function public.agent_handoff_signal_problem(p_workspace_id uuid, p_kind text, p_signal_ids uuid[])
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_missing int;
  v_bad text;
begin
  if p_kind = 'orion_review' or coalesce(cardinality(p_signal_ids), 0) = 0 then
    return case when p_kind = 'orion_review' then null else 'no_signal' end;
  end if;
  select count(*) into v_missing from unnest(p_signal_ids) s(id)
   where not exists (select 1 from public.signal_events e where e.id = s.id and e.workspace_id = p_workspace_id);
  if v_missing > 0 then return 'signal_not_in_workspace'; end if;

  select case
           when e.lifecycle_status <> 'active' then 'signal_' || e.lifecycle_status
           when e.expires_at is not null and e.expires_at <= now() then 'signal_expired'
           when p_kind = 'atlas_research'
                and coalesce(e.normalized_value->'lisa'->'verification'->>'level', '') not in ('corroborated', 'self_reported')
             then 'signal_unverified'
           when p_kind = 'lyra_content'
                and coalesce(e.normalized_value->'lisa'->'verification'->>'level', '') = 'contradicted'
             then 'signal_contradicted'
         end
    into v_bad
    from public.signal_events e
   where e.workspace_id = p_workspace_id and e.id = any(p_signal_ids)
     and (e.lifecycle_status <> 'active'
          or (e.expires_at is not null and e.expires_at <= now())
          or (p_kind = 'atlas_research' and coalesce(e.normalized_value->'lisa'->'verification'->>'level', '') not in ('corroborated', 'self_reported'))
          or (p_kind = 'lyra_content' and coalesce(e.normalized_value->'lisa'->'verification'->>'level', '') = 'contradicted'))
   limit 1;
  return v_bad;
end;
$$;
revoke all on function public.agent_handoff_signal_problem(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.agent_handoff_signal_problem(uuid, text, uuid[]) to service_role;

create or replace function public.agent_handoff_log(p_ws uuid, p_id uuid, p_from text, p_to text, p_actor text, p_note text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.agent_handoff_events (workspace_id, handoff_id, from_status, to_status, actor, note)
  values (p_ws, p_id, p_from, p_to, p_actor, left(p_note, 1000));
$$;
revoke all on function public.agent_handoff_log(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────── propose
-- outcome: created | duplicate | <signal problem> ; agents call this (service role).
create or replace function public.agent_handoff_propose(p_workspace_id uuid, p_handoff jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := p_handoff->>'kind';
  v_signals uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_handoff->'signal_ids', '[]')) x), '{}');
  v_leads uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_handoff->'lead_ids', '[]')) x), '{}');
  v_problem text;
  v_row public.agent_handoffs;
  v_status text;
begin
  if p_handoff->>'contract_version' is distinct from 'agent-collab-v1' then
    raise exception 'agent_handoff_propose: unknown contract version' using errcode = '22023';
  end if;
  if (p_handoff->>'workspace_id')::uuid is distinct from p_workspace_id then
    raise exception 'agent_handoff_propose: workspace mismatch' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    return jsonb_build_object('outcome', 'workspace_not_found');
  end if;
  if exists (select 1 from unnest(v_leads) l(id)
              where not exists (select 1 from public.lead_candidates c where c.id = l.id and c.workspace_id = p_workspace_id)) then
    return jsonb_build_object('outcome', 'lead_not_in_workspace');
  end if;
  -- Duplicates first: a re-sent proposal answers with the existing row, whatever happened since.
  select * into v_row from public.agent_handoffs h
   where h.workspace_id = p_workspace_id and h.idempotency_key = p_handoff->>'idempotency_key';
  if found then
    return jsonb_build_object('outcome', 'duplicate', 'id', v_row.id, 'status', v_row.status);
  end if;
  v_problem := public.agent_handoff_signal_problem(p_workspace_id, v_kind, v_signals);
  if v_problem is not null then
    return jsonb_build_object('outcome', v_problem);
  end if;
  v_status := case when coalesce((p_handoff->>'requires_approval')::boolean, true) then 'awaiting_review' else 'proposed' end;

  insert into public.agent_handoffs as h (
    workspace_id, source_agent, target_agent, kind, status, company, signal_ids, lead_ids, brain_fingerprint,
    reason, evidence, verification, requires_approval, idempotency_key, payload, parent_id
  ) values (
    p_workspace_id, p_handoff->>'source_agent', p_handoff->>'target_agent', v_kind, v_status,
    case when jsonb_typeof(p_handoff->'company') = 'object' then p_handoff->'company' end,
    v_signals, v_leads, p_handoff->>'brain_fingerprint', p_handoff->>'reason',
    coalesce(p_handoff->'evidence', '[]'::jsonb), coalesce(p_handoff->'verification', '{}'::jsonb),
    coalesce((p_handoff->>'requires_approval')::boolean, true), p_handoff->>'idempotency_key',
    coalesce(p_handoff->'payload', '{}'::jsonb), (p_handoff->>'parent_id')::uuid
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning h.* into v_row;
  if v_row.id is null then
    -- Lost a race with an identical proposal: answer with the winner.
    select * into v_row from public.agent_handoffs h
     where h.workspace_id = p_workspace_id and h.idempotency_key = p_handoff->>'idempotency_key';
    return jsonb_build_object('outcome', 'duplicate', 'id', v_row.id, 'status', v_row.status);
  end if;
  perform public.agent_handoff_log(p_workspace_id, v_row.id, null, v_status, 'agent:' || (p_handoff->>'source_agent'), p_handoff->>'reason');
  return jsonb_build_object('outcome', 'created', 'id', v_row.id, 'status', v_status);
end;
$$;
revoke all on function public.agent_handoff_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.agent_handoff_propose(uuid, jsonb) to service_role;

-- ─────────────────────────────────────────────────────── a person decides
-- outcome: ok | blocked (signal no longer current) | session_invalid | not_member |
--          forbidden_role | not_found | invalid_transition
create or replace function public.agent_handoff_decide(
  p_workspace_id uuid, p_actor_id uuid, p_session_id uuid, p_handoff_id uuid, p_decision text, p_note text default null
)
returns table (outcome text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth text;
  v_row public.agent_handoffs;
  v_to text;
  v_problem text;
begin
  if p_decision is null or p_decision not in ('approve', 'reject', 'cancel') then
    raise exception 'agent_handoff_decide: invalid decision %', p_decision using errcode = '22023';
  end if;
  perform 1 from auth.sessions s
   where s.id = p_session_id and s.user_id = p_actor_id and (s.not_after is null or s.not_after > clock_timestamp())
   for share;
  perform 1 from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id
   for share;
  v_auth := public.company_brain_write_authorization(p_workspace_id, p_actor_id, p_session_id, 'edit');
  if v_auth <> 'ok' then
    return query select v_auth, null::text; return;
  end if;

  select * into v_row from public.agent_handoffs h
   where h.id = p_handoff_id and h.workspace_id = p_workspace_id for update;
  if not found then return query select 'not_found'::text, null::text; return; end if;

  v_to := case p_decision
    when 'approve' then case when v_row.status = 'awaiting_review' then 'approved' end
    when 'reject' then case when v_row.status in ('proposed', 'awaiting_review') then 'rejected' end
    when 'cancel' then case when v_row.status in ('proposed', 'awaiting_review', 'approved', 'queued') then 'cancelled' end
  end;
  if v_to is null then return query select 'invalid_transition'::text, v_row.status; return; end if;

  if v_to = 'approved' then
    v_problem := public.agent_handoff_signal_problem(p_workspace_id, v_row.kind, v_row.signal_ids);
    if v_problem is not null then
      update public.agent_handoffs h set status = 'blocked', error = 'approval refused: ' || v_problem,
             decided_by = p_actor_id, decided_at = now(), updated_at = now() where h.id = v_row.id;
      perform public.agent_handoff_log(p_workspace_id, v_row.id, v_row.status, 'blocked', 'user:' || p_actor_id, v_problem);
      return query select 'blocked'::text, 'blocked'::text; return;
    end if;
  end if;

  update public.agent_handoffs h set status = v_to, decided_by = p_actor_id, decided_at = now(), updated_at = now()
   where h.id = v_row.id;
  perform public.agent_handoff_log(p_workspace_id, v_row.id, v_row.status, v_to, 'user:' || p_actor_id, p_note);
  return query select 'ok'::text, v_to;
end;
$$;
revoke all on function public.agent_handoff_decide(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.agent_handoff_decide(uuid, uuid, uuid, uuid, text, text) to service_role;

-- ─────────────────────────────────────────────── an agent reports progress
-- Compare-and-set on p_expected. outcome: ok | conflict | invalid_transition |
-- not_found | not_persisted | lead_not_in_workspace | attempts_exhausted
create or replace function public.agent_handoff_advance(
  p_workspace_id uuid, p_handoff_id uuid, p_agent text, p_expected text, p_to text,
  p_result jsonb default null, p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.agent_handoffs;
  v_ok boolean;
  v_lead uuid;
begin
  select * into v_row from public.agent_handoffs h
   where h.id = p_handoff_id and h.workspace_id = p_workspace_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if p_agent is distinct from v_row.target_agent then
    return jsonb_build_object('outcome', 'wrong_agent', 'status', v_row.status);
  end if;
  if v_row.status is distinct from p_expected then
    return jsonb_build_object('outcome', 'conflict', 'status', v_row.status);
  end if;
  v_ok := case v_row.status
    when 'approved' then p_to in ('queued', 'blocked')
    when 'queued' then p_to in ('running', 'blocked', 'failed')
    when 'running' then p_to in ('completed', 'partially_completed', 'failed', 'blocked')
    when 'failed' then p_to = 'queued'
    else false end;
  if not v_ok then return jsonb_build_object('outcome', 'invalid_transition', 'status', v_row.status); end if;
  if v_row.status = 'failed' and v_row.attempts >= 3 then
    return jsonb_build_object('outcome', 'attempts_exhausted', 'status', v_row.status);
  end if;
  if p_to in ('completed', 'partially_completed') then
    if not coalesce((p_result->>'persisted')::boolean, false) then
      return jsonb_build_object('outcome', 'not_persisted', 'status', v_row.status);
    end if;
    if v_row.kind = 'atlas_research' and p_result->>'qualification' = 'qualified' then
      v_lead := nullif(p_result->>'lead_candidate_id', '')::uuid;
      if v_lead is null or not exists (select 1 from public.lead_candidates c where c.id = v_lead and c.workspace_id = p_workspace_id) then
        return jsonb_build_object('outcome', 'lead_not_in_workspace', 'status', v_row.status);
      end if;
    end if;
  end if;
  update public.agent_handoffs h
     set status = p_to,
         attempts = case when p_to = 'running' then least(3, h.attempts + 1) else h.attempts end,
         result = coalesce(p_result, h.result),
         error = case when p_to in ('failed', 'blocked', 'partially_completed') then left(p_error, 1000) when p_to = 'queued' then null else h.error end,
         completed_at = case when p_to in ('completed', 'partially_completed', 'failed', 'blocked') then now() else null end,
         lead_ids = case when v_lead is not null and not (v_lead = any(h.lead_ids)) then h.lead_ids || v_lead else h.lead_ids end,
         updated_at = now()
   where h.id = v_row.id;
  perform public.agent_handoff_log(p_workspace_id, v_row.id, v_row.status, p_to, 'agent:' || p_agent, coalesce(p_error, p_result->>'summary'));
  return jsonb_build_object('outcome', 'ok', 'status', p_to);
end;
$$;
revoke all on function public.agent_handoff_advance(uuid, uuid, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.agent_handoff_advance(uuid, uuid, text, text, text, jsonb, text) to service_role;

-- ───────────────────────────────────────── LYRA: draft + completion, atomically
-- An APPROVED lyra_content handoff becomes ONE content_item draft. The draft
-- row and the handoff's `completed` are one transaction: a failed insert can
-- never leave a "completed" handoff, and a retry finds the existing draft.
create or replace function public.agent_handoff_lyra_draft(p_workspace_id uuid, p_handoff_id uuid, p_draft jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.agent_handoffs;
  v_item uuid;
  v_signal uuid;
begin
  select * into v_row from public.agent_handoffs h
   where h.id = p_handoff_id and h.workspace_id = p_workspace_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_row.kind <> 'lyra_content' then return jsonb_build_object('outcome', 'wrong_kind'); end if;
  if v_row.status = 'completed' then
    return jsonb_build_object('outcome', 'duplicate', 'content_item_id', v_row.result->>'content_item_id');
  end if;
  if v_row.status <> 'approved' then
    return jsonb_build_object('outcome', 'not_approved', 'status', v_row.status);
  end if;
  v_signal := v_row.signal_ids[1];
  -- The current content_item schema (content_v1): LinkedIn formats, source_type
  -- 'signal' with its FK, and the agent-generation provenance value.
  insert into public.content_item (workspace_id, status, format, title, body, source, source_type, source_signal_id,
                                   agent_slug, last_generation_source, metadata)
  values (p_workspace_id, 'draft', case when p_draft->>'format' = 'linkedin_comment' then 'linkedin_comment' else 'linkedin_post' end,
          left(p_draft->>'title', 300), coalesce(p_draft->>'body', ''), 'signal', 'signal', v_signal, 'lyra', 'scribe_generation',
          coalesce(p_draft->'metadata', '{}'::jsonb) || jsonb_build_object('handoff_id', v_row.id, 'review_required', true))
  returning id into v_item;
  update public.agent_handoffs h
     set status = 'completed', attempts = least(3, h.attempts + 1), completed_at = now(), updated_at = now(),
         result = jsonb_build_object('persisted', true, 'content_item_id', v_item, 'content_status', 'draft',
                                     'summary', 'Draft ready for review (not published)')
   where h.id = v_row.id;
  perform public.agent_handoff_log(p_workspace_id, v_row.id, 'approved', 'completed', 'agent:lyra', 'draft created, unpublished');
  return jsonb_build_object('outcome', 'created', 'content_item_id', v_item);
end;
$$;
revoke all on function public.agent_handoff_lyra_draft(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.agent_handoff_lyra_draft(uuid, uuid, jsonb) to service_role;
