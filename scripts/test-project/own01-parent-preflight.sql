-- OWN-01 PREFLIGHT (read-only). Run before applying
-- supabase/migrations-held/20261025120000_lead_graph_same_workspace_parents.sql:
--   psql "$DB_URL" -X -At -F ' ' -f scripts/test-project/own01-parent-preflight.sql
-- Lists every lead-graph row whose parent lives in ANOTHER workspace. The
-- migration aborts if any exist; it never reassigns a parent. Each listed row
-- needs a human decision (null the parent, or correct it), recorded before the
-- migration is approved. Clean project: a single line "OK 0 mismatched rows".
begin transaction read only;
with mismatched as (
  select 'contacts.account_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.contacts c join public.accounts p on p.id = c.account_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'engagement_events.account_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.engagement_events c join public.accounts p on p.id = c.account_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'lead_candidates.account_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.lead_candidates c join public.accounts p on p.id = c.account_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'lead_enrichments.account_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.lead_enrichments c join public.accounts p on p.id = c.account_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'lead_evidence.account_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.lead_evidence c join public.accounts p on p.id = c.account_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'outreach_drafts.account_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.outreach_drafts c join public.accounts p on p.id = c.account_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'signal_events.account_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.signal_events c join public.accounts p on p.id = c.account_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'engagement_events.contact_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.engagement_events c join public.contacts p on p.id = c.contact_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'lead_candidates.contact_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.lead_candidates c join public.contacts p on p.id = c.contact_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'lead_enrichments.contact_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.lead_enrichments c join public.contacts p on p.id = c.contact_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'lead_evidence.contact_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.lead_evidence c join public.contacts p on p.id = c.contact_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'outreach_drafts.contact_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.outreach_drafts c join public.contacts p on p.id = c.contact_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'signal_events.contact_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.signal_events c join public.contacts p on p.id = c.contact_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'engagement_events.lead_candidate_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.engagement_events c join public.lead_candidates p on p.id = c.lead_candidate_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'lead_enrichments.lead_candidate_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.lead_enrichments c join public.lead_candidates p on p.id = c.lead_candidate_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'lead_evidence.lead_candidate_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.lead_evidence c join public.lead_candidates p on p.id = c.lead_candidate_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'outreach_drafts.lead_candidate_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.outreach_drafts c join public.lead_candidates p on p.id = c.lead_candidate_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'signal_events.lead_candidate_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.signal_events c join public.lead_candidates p on p.id = c.lead_candidate_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'signal_reviews.lead_candidate_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.signal_reviews c join public.lead_candidates p on p.id = c.lead_candidate_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'lead_candidates.evidence_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.lead_candidates c join public.lead_evidence p on p.id = c.evidence_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'engagement_events.legacy_signal_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.engagement_events c join public.signals p on p.id = c.legacy_signal_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'lead_candidates.signal_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.lead_candidates c join public.signals p on p.id = c.signal_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'lead_evidence.legacy_signal_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.lead_evidence c join public.signals p on p.id = c.legacy_signal_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'signal_event_evidence.legacy_signal_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.signal_event_evidence c join public.signals p on p.id = c.legacy_signal_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'signal_events.legacy_signal_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.signal_events c join public.signals p on p.id = c.legacy_signal_id where c.workspace_id is distinct from p.workspace_id
  union all
  select 'signal_reviews.signal_id' as ref, c.id as child_id, c.workspace_id as child_ws, p.id as parent_id, p.workspace_id as parent_ws
    from public.signal_reviews c join public.signals p on p.id = c.signal_id where c.workspace_id is distinct from p.workspace_id
)
select 'MISMATCH', ref, child_id, child_ws, parent_id, parent_ws from mismatched
union all
select 'OK', '0 mismatched rows', null, null, null, null where not exists (select 1 from mismatched);
rollback;
