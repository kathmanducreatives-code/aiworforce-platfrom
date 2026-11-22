-- Rollback of 20261122130000_company_brain_memory_activation.sql (Company Brain V2 · B2.3).
-- Decision proposals still PENDING are withdrawn first (the V1 check cannot hold them);
-- reviewed ones keep their row and history, and their resulting memory items stay.
-- Then the V1 proposal_submit body is restored byte-for-byte.
update public.company_brain_memory_proposals
   set status = 'withdrawn', reviewed_at = clock_timestamp(), review_note = 'withdrawn by rollback of 20261122130000', updated_at = clock_timestamp()
 where kind = 'decision' and status = 'pending';
alter table public.company_brain_memory_proposals drop constraint if exists cbmp_decision_has_outcome;
alter table public.company_brain_memory_proposals drop constraint if exists cbmp_kind_valid;
-- NOT VALID: reviewed decision proposals stay on record; new rows must be fact or preference again.
alter table public.company_brain_memory_proposals add constraint cbmp_kind_valid
  check (kind in ('fact', 'preference')) not valid;

create or replace function public.company_brain_proposal_submit(
  p_workspace_id uuid,
  p_agent text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := lower(coalesce(p_payload->>'kind', 'fact'));
  v_category text := lower(btrim(coalesce(p_payload->>'category', '')));
  v_key text := lower(btrim(coalesce(p_payload->>'fact_key', '')));
  v_scope text := lower(coalesce(nullif(p_payload->>'scope', ''), 'workspace'));
  v_scope_ref text := nullif(btrim(coalesce(p_payload->>'scope_ref', '')), '');
  v_type text := p_payload->>'value_type';
  v_value jsonb := p_payload->'value';
  v_evidence jsonb := coalesce(p_payload->'evidence', '[]'::jsonb);
  v_source_type text := coalesce(p_payload->>'source_type', 'agent_suggestion');
  v_dedupe text;
  v_active public.company_brain_memory;
  v_open public.company_brain_memory_proposals;
  v_id uuid;
  v_merged jsonb;
begin
  if p_workspace_id is null or not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'unknown workspace');
  end if;
  if p_agent is null or p_agent not in ('orion', 'atlas', 'lyra', 'lisa') then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'unknown agent');
  end if;
  if v_kind not in ('fact', 'preference')
     or v_category !~ '^[a-z][a-z0-9_]{1,40}$' or length(v_key) not between 1 and 200
     or v_source_type not in ('model_inference', 'agent_suggestion', 'provider_returned')
     or v_type is null or v_value is null or not public.company_brain_memory_value_valid(v_type, v_value)
     or jsonb_typeof(v_evidence) <> 'array'
     or length(btrim(coalesce(p_payload->>'rationale', ''))) not between 1 and 2000
     or (v_scope = 'workspace') <> (v_scope_ref is null) then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'malformed proposal');
  end if;
  if v_source_type = 'provider_returned' and jsonb_array_length(v_evidence) = 0 then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'a provider-returned proposal needs evidence');
  end if;

  v_dedupe := coalesce(nullif(p_payload->>'dedupe_key', ''),
                       md5(v_kind || '|' || v_key || '|' || v_scope || '|' || coalesce(v_scope_ref, '') || '|' || v_value::text));

  -- Serialise proposals for the same identity (two agents, two passes, one fact).
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || '|' || v_dedupe, 0));

  select * into v_active from public.company_brain_memory m
   where m.workspace_id = p_workspace_id and m.kind = v_kind and m.fact_key = v_key
     and m.scope = v_scope and coalesce(m.scope_ref, '') = coalesce(v_scope_ref, '')
     and m.lifecycle_status = 'active';
  if found and v_active.value = v_value then
    return jsonb_build_object('outcome', 'already_known', 'memory_id', v_active.id);
  end if;

  if exists (select 1 from public.company_brain_memory_proposals p
              where p.workspace_id = p_workspace_id and p.dedupe_key = v_dedupe
                and p.status = 'rejected' and p.reviewed_at > clock_timestamp() - interval '180 days') then
    return jsonb_build_object('outcome', 'previously_rejected');
  end if;

  select * into v_open from public.company_brain_memory_proposals p
   where p.workspace_id = p_workspace_id and p.dedupe_key = v_dedupe and p.status = 'pending'
   for update;
  if found then
    -- Same claim again: keep ONE proposal, accumulate distinct evidence.
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_merged from (
      select distinct on (coalesce(e->>'source_url', '') || '|' || coalesce(e->>'source_ref', '')) e
        from jsonb_array_elements(v_open.evidence || v_evidence) e
       order by coalesce(e->>'source_url', '') || '|' || coalesce(e->>'source_ref', '')
       limit 50) s;
    update public.company_brain_memory_proposals p
       set evidence = v_merged, updated_at = clock_timestamp()
     where p.id = v_open.id;
    return jsonb_build_object('outcome', 'duplicate_pending', 'proposal_id', v_open.id);
  end if;

  insert into public.company_brain_memory_proposals
    (workspace_id, proposed_by_agent, kind, category, fact_key, scope, scope_ref, value_type, value,
     rationale, evidence, source_type, confidence, dedupe_key, contradicts_memory_id)
  values (p_workspace_id, p_agent, v_kind, v_category, v_key, v_scope, v_scope_ref, v_type, v_value,
          btrim(p_payload->>'rationale'), v_evidence, v_source_type,
          coalesce(nullif(p_payload->>'confidence', ''), 'low'), v_dedupe,
          case when v_active.id is not null then v_active.id end)
  returning id into v_id;
  return jsonb_build_object('outcome', case when v_active.id is not null then 'contradiction' else 'created' end,
                            'proposal_id', v_id,
                            'contradicts_memory_id', v_active.id);
end;
$$;
revoke all on function public.company_brain_proposal_submit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.company_brain_proposal_submit(uuid, text, jsonb) to service_role;
