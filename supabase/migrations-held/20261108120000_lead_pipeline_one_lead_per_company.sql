-- HELD — NOT APPLIED. Lead pipeline: one lead per company, written in one transaction.
--
-- MRLE Phase 0 (audit 2026-11-07 X3 / X8). The pipeline wrote accounts, contacts and
-- lead_candidates as separate PostgREST calls with no transaction and no uniqueness for its
-- own leads (lead_type 'lead_pipeline'), so one company could become two leads and a failure
-- mid-row left a partial write after the provider spend. The application now writes
-- idempotently (leadPipeline/persistRows.ts); this migration adds the database half:
--
--   1. a unique index: ONE 'lead_pipeline' lead per (workspace, account);
--   2. lead_pipeline_persist_lead(...): account (by domain, then a same-named account with no
--      or the same domain), contact (by LinkedIn URL), lead (existing id, else upsert on the
--      index) — all in ONE transaction; returns the ids and whether the lead was created.
--
-- SAFE BY REFUSAL: if any workspace already holds two 'lead_pipeline' leads for one account,
-- the migration stops and names the count. It never deletes or merges existing data; resolve
-- duplicates deliberately first. Service role only. Rollback:
-- rollback/20261108120000_lead_pipeline_one_lead_per_company.down.sql

do $$
declare n integer;
begin
  select count(*) into n from (
    select workspace_id, account_id from public.lead_candidates
    where lead_type = 'lead_pipeline' and account_id is not null
    group by workspace_id, account_id having count(*) > 1) d;
  if n > 0 then
    raise exception 'lead_pipeline_one_lead_per_company: % (workspace, account) pairs already hold more than one lead_pipeline lead; resolve them first — nothing was changed', n;
  end if;
end $$;

create unique index if not exists lead_candidates_pipeline_account_uniq
  on public.lead_candidates (workspace_id, account_id)
  where lead_type = 'lead_pipeline';

comment on index public.lead_candidates_pipeline_account_uniq is
  'One lead_pipeline lead per (workspace, account): a company found twice is one lead (MRLE Phase 0).';

create or replace function public.lead_pipeline_persist_lead(
  p_workspace_id uuid, p_account jsonb, p_contact jsonb, p_lead jsonb, p_existing_lead_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_domain text := nullif(lower(btrim(coalesce(p_account->>'domain', ''))), '');
  v_name text := nullif(btrim(coalesce(p_account->>'name', '')), '');
  v_account uuid; v_existing_domain text; v_contact uuid; v_lead uuid; v_created boolean := false;
  v_attr jsonb := coalesce(p_lead->'raw'->'agentory_pipeline', 'null'::jsonb);
begin
  if p_workspace_id is null
     or (p_account->>'workspace_id')::uuid is distinct from p_workspace_id
     or (p_lead->>'workspace_id')::uuid is distinct from p_workspace_id
     or (p_contact is not null and p_contact <> 'null'::jsonb and (p_contact->>'workspace_id')::uuid is distinct from p_workspace_id) then
    raise exception 'lead_pipeline_persist_lead: every row must name the same workspace';
  end if;

  -- ACCOUNT: by domain; else a same-named account with no or the same domain; else new.
  if v_domain is not null then
    select id into v_account from public.accounts where workspace_id = p_workspace_id and lower(domain) = v_domain order by created_at limit 1;
  end if;
  if v_account is null and v_name is not null then
    select id, lower(domain) into v_account, v_existing_domain from public.accounts where workspace_id = p_workspace_id and name = v_name;
    if v_account is not null and v_existing_domain is not null and v_domain is not null and v_existing_domain <> v_domain then
      -- THE NAME IS NOT AN IDENTITY: another company owns it; this one is disambiguated.
      v_account := null; v_name := v_name || ' (' || v_domain || ')';
      select id into v_account from public.accounts where workspace_id = p_workspace_id and name = v_name;
    elsif v_account is not null and v_existing_domain is null and v_domain is not null then
      update public.accounts set domain = v_domain where id = v_account;
    end if;
  end if;
  if v_account is null then
    insert into public.accounts (workspace_id, name, domain, website_url, linkedin_url, location, industry, employee_count, source, raw)
    values (p_workspace_id, coalesce(v_name, '(unnamed company)'), v_domain, p_account->>'website_url', p_account->>'linkedin_url',
            p_account->>'location', p_account->>'industry', p_account->>'employee_count', p_account->>'source', coalesce(p_account->'raw', '{}'::jsonb))
    returning id into v_account;
  else
    update public.accounts set raw = raw || jsonb_build_object('agentory_pipeline', coalesce(p_account->'raw'->'agentory_pipeline', 'null'::jsonb)), updated_at = now()
    where id = v_account;
  end if;

  -- CONTACT: one per LinkedIn URL (the existing unique constraint), attribution merged.
  if p_contact is not null and p_contact <> 'null'::jsonb then
    if nullif(btrim(coalesce(p_contact->>'linkedin_url', '')), '') is not null then
      insert into public.contacts (workspace_id, account_id, full_name, title, linkedin_url, company, location, phone, source, raw)
      values (p_workspace_id, v_account, p_contact->>'full_name', p_contact->>'title', p_contact->>'linkedin_url', p_contact->>'company',
              p_contact->>'location', p_contact->>'phone', p_contact->>'source', coalesce(p_contact->'raw', '{}'::jsonb))
      on conflict (workspace_id, linkedin_url) do update set raw = public.contacts.raw || excluded.raw, updated_at = now()
      returning id into v_contact;
    else
      insert into public.contacts (workspace_id, account_id, full_name, title, company, location, phone, source, raw)
      values (p_workspace_id, v_account, p_contact->>'full_name', p_contact->>'title', p_contact->>'company',
              p_contact->>'location', p_contact->>'phone', p_contact->>'source', coalesce(p_contact->'raw', '{}'::jsonb))
      returning id into v_contact;
    end if;
  end if;

  -- LEAD: an existing Lead keeps id, status and stage (attribution only); else one per account.
  if p_existing_lead_id is not null then
    update public.lead_candidates set raw = raw || jsonb_build_object('agentory_pipeline', v_attr), updated_at = now()
    where id = p_existing_lead_id and workspace_id = p_workspace_id
    returning id into v_lead;
  end if;
  if v_lead is null then
    insert into public.lead_candidates (workspace_id, account_id, contact_id, lead_type, status, fit_score, reason, next_action, raw)
    values (p_workspace_id, v_account, v_contact, 'lead_pipeline', coalesce(p_lead->>'status', 'new'), (p_lead->>'fit_score')::numeric,
            p_lead->>'reason', p_lead->>'next_action', coalesce(p_lead->'raw', '{}'::jsonb))
    on conflict (workspace_id, account_id) where lead_type = 'lead_pipeline'
      do update set raw = public.lead_candidates.raw || jsonb_build_object('agentory_pipeline', excluded.raw->'agentory_pipeline'), updated_at = now()
    returning id, (xmax = 0) into v_lead, v_created;
  end if;
  return jsonb_build_object('account_id', v_account, 'contact_id', v_contact, 'lead_id', v_lead, 'created', v_created);
end $$;

revoke all on function public.lead_pipeline_persist_lead(uuid, jsonb, jsonb, jsonb, uuid) from public;
revoke all on function public.lead_pipeline_persist_lead(uuid, jsonb, jsonb, jsonb, uuid) from anon, authenticated;
grant execute on function public.lead_pipeline_persist_lead(uuid, jsonb, jsonb, jsonb, uuid) to service_role;
