-- Signals recovery · MONITORING PLANS — a reviewable proposal before anything watches or spends.
--
-- HELD. Applied in the database-contract lane and, with approval, on Brain TEST by
-- scripts/test-project/brain-test/install-lisa.sh. Additive; no existing row changes.
-- Ownership: Signals (LISA). Rollback: rollback/20261128140000_signals_monitoring_plans.down.sql
--
-- WHY: a typed "watch acme.com" used to insert an ENABLED monitoring_subjects row at once — no
-- confirmation, no role check — and that row is scanned on a schedule against paid providers.
-- An ICP-wide request ("monitor US manufacturers that are hiring AEs") had nowhere to go at all.
--
-- NOW: chat creates a DRAFT plan (a named company or an ICP target), stating what would be
-- watched, which signal categories and sources, how often, the estimated usage and the
-- execution constraints. Nothing is enabled and nothing is called. A person with the edit role
-- approves it; activation is a separate, explicit step that creates the (enabled) monitoring
-- subject. Every transition is checked in the database against the caller's live role.
create table if not exists public.monitoring_plans (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  kind               text not null,
  status             text not null default 'draft',
  title              text not null,
  -- company: { label, identifier }   icp: the Company Brain targeting the plan was built from
  target             jsonb not null,
  signal_categories  text[] not null,
  sources            text[] not null default '{}',
  frequency          text not null default 'once',
  estimated_usage    jsonb not null default '{}'::jsonb,
  constraints        jsonb not null default '{}'::jsonb,
  -- Where the request came from (a conversation message), for provenance.
  source_ref         text,
  created_by         uuid,
  approved_by        uuid,
  approved_at        timestamptz,
  activated_by       uuid,
  activated_at       timestamptz,
  monitoring_subject_id uuid references public.monitoring_subjects(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint monitoring_plans_kind_valid check (kind in ('company', 'icp')),
  constraint monitoring_plans_status_valid check (status in ('draft', 'approved', 'active', 'rejected', 'paused')),
  constraint monitoring_plans_frequency_valid check (frequency in ('once', 'daily', 'weekly')),
  constraint monitoring_plans_categories_nonempty check (cardinality(signal_categories) > 0),
  constraint monitoring_plans_company_target check (kind <> 'company' or coalesce(length(trim(target->>'identifier')), 0) > 0),
  constraint monitoring_plans_approval_coherent check (status in ('draft', 'rejected') or approved_by is not null),
  constraint monitoring_plans_active_coherent check (status <> 'active' or activated_by is not null)
);
create index if not exists monitoring_plans_workspace_idx on public.monitoring_plans (workspace_id, status, created_at desc);

alter table public.monitoring_plans enable row level security;
revoke all on public.monitoring_plans from public, anon, authenticated;
grant select on public.monitoring_plans to authenticated;
grant select, insert, update on public.monitoring_plans to service_role;
drop policy if exists monitoring_plans_member_read on public.monitoring_plans;
create policy monitoring_plans_member_read on public.monitoring_plans
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));

comment on table public.monitoring_plans is
  'A reviewable monitoring proposal (named company or ICP-wide). Created as a draft by chat (service role); approved and activated only through monitoring_plan_decide by an owner/admin/editor. Only activation creates an enabled monitoring_subjects row.';

-- ─────────────────────────────────────────────── the one transition path
-- p_decision: 'approve' | 'reject' | 'activate' | 'pause'. Caller = auth.uid() (a browser JWT).
-- approve/reject: from draft. activate: from approved (creates or re-enables the subject).
-- pause: from active (disables the subject). Viewers and non-members are refused in here.
create or replace function public.monitoring_plan_decide(p_plan_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.monitoring_plans;
  v_role text;
  v_subject uuid;
  v_kind text;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthenticated');
  end if;
  select * into v_plan from public.monitoring_plans where id = p_plan_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select lower(btrim(m.role)) into v_role from public.workspace_members m
   where m.workspace_id = v_plan.workspace_id and m.user_id = v_uid;
  if v_role is null then
    return jsonb_build_object('outcome', 'not_member');
  end if;
  if v_role not in ('owner', 'admin', 'editor') then
    return jsonb_build_object('outcome', 'forbidden_role', 'role', v_role);
  end if;

  if p_decision in ('approve', 'reject') then
    if v_plan.status <> 'draft' then
      return jsonb_build_object('outcome', 'invalid_transition', 'status', v_plan.status);
    end if;
    update public.monitoring_plans
       set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
           approved_by = case when p_decision = 'approve' then v_uid else null end,
           approved_at = case when p_decision = 'approve' then now() else null end,
           updated_at = now()
     where id = p_plan_id;
    return jsonb_build_object('outcome', 'ok', 'status', case when p_decision = 'approve' then 'approved' else 'rejected' end);
  elsif p_decision = 'activate' then
    if v_plan.status <> 'approved' and v_plan.status <> 'paused' then
      return jsonb_build_object('outcome', 'invalid_transition', 'status', v_plan.status);
    end if;
    v_kind := case when v_plan.kind = 'icp' then 'icp' else 'tracked_company' end;
    if v_plan.monitoring_subject_id is not null then
      update public.monitoring_subjects set enabled = true, updated_at = now()
       where id = v_plan.monitoring_subject_id and workspace_id = v_plan.workspace_id;
      v_subject := v_plan.monitoring_subject_id;
    else
      insert into public.monitoring_subjects (workspace_id, subject_kind, identifier, label, signals, enabled)
      values (v_plan.workspace_id, v_kind,
              case when v_kind = 'icp' then null else v_plan.target->>'identifier' end,
              v_plan.title, to_jsonb(v_plan.signal_categories), true)
      returning id into v_subject;
    end if;
    update public.monitoring_plans
       set status = 'active', activated_by = v_uid, activated_at = now(), monitoring_subject_id = v_subject, updated_at = now()
     where id = p_plan_id;
    return jsonb_build_object('outcome', 'ok', 'status', 'active', 'monitoring_subject_id', v_subject);
  elsif p_decision = 'pause' then
    if v_plan.status <> 'active' then
      return jsonb_build_object('outcome', 'invalid_transition', 'status', v_plan.status);
    end if;
    update public.monitoring_subjects set enabled = false, updated_at = now()
     where id = v_plan.monitoring_subject_id and workspace_id = v_plan.workspace_id;
    update public.monitoring_plans set status = 'paused', updated_at = now() where id = p_plan_id;
    return jsonb_build_object('outcome', 'ok', 'status', 'paused');
  end if;
  return jsonb_build_object('outcome', 'invalid_decision');
end;
$$;
revoke all on function public.monitoring_plan_decide(uuid, text) from public, anon;
grant execute on function public.monitoring_plan_decide(uuid, text) to authenticated;
