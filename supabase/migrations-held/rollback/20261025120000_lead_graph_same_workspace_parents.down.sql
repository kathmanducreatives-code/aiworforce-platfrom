-- ROLLBACK for 20261025120000_lead_graph_same_workspace_parents.sql (held).
-- Restores the ID-only foreign keys under the same names, with their original
-- delete actions, then drops the (workspace_id, id) keys. Data is not touched.
-- After rollback, OWN-01 is open again: a child may reference another
-- workspace's parent.
do $own01_down$
declare r record; v_refs jsonb;
begin
  -- The 26 references, as data: no table is created (a temporary table would
  -- be one more relation for RLS audits to explain).
  v_refs := '[
    ["contacts",              "account_id",         "accounts",         "set null"],
    ["engagement_events",     "account_id",         "accounts",         "set null"],
    ["lead_candidates",       "account_id",         "accounts",         "set null"],
    ["lead_enrichments",      "account_id",         "accounts",         "set null"],
    ["lead_evidence",         "account_id",         "accounts",         "set null"],
    ["outreach_drafts",       "account_id",         "accounts",         "set null"],
    ["signal_events",         "account_id",         "accounts",         "set null"],
    ["engagement_events",     "contact_id",         "contacts",         "set null"],
    ["lead_candidates",       "contact_id",         "contacts",         "set null"],
    ["lead_enrichments",      "contact_id",         "contacts",         "set null"],
    ["lead_evidence",         "contact_id",         "contacts",         "set null"],
    ["outreach_drafts",       "contact_id",         "contacts",         "set null"],
    ["signal_events",         "contact_id",         "contacts",         "set null"],
    ["engagement_events",     "lead_candidate_id",  "lead_candidates",  "set null"],
    ["lead_enrichments",      "lead_candidate_id",  "lead_candidates",  "set null"],
    ["lead_evidence",         "lead_candidate_id",  "lead_candidates",  "set null"],
    ["outreach_drafts",       "lead_candidate_id",  "lead_candidates",  "set null"],
    ["signal_events",         "lead_candidate_id",  "lead_candidates",  "set null"],
    ["signal_reviews",        "lead_candidate_id",  "lead_candidates",  "cascade"],
    ["lead_candidates",       "evidence_id",        "lead_evidence",    "set null"],
    ["engagement_events",     "legacy_signal_id",   "signals",          "set null"],
    ["lead_candidates",       "signal_id",          "signals",          "set null"],
    ["lead_evidence",         "legacy_signal_id",   "signals",          "set null"],
    ["signal_event_evidence", "legacy_signal_id",   "signals",          "set null"],
    ["signal_events",         "legacy_signal_id",   "signals",          "set null"],
    ["signal_reviews",        "signal_id",          "signals",          "cascade"]
  ]'::jsonb;
  for r in select x->>0 as child, x->>1 as col, x->>2 as parent, x->>3 as on_delete from jsonb_array_elements(v_refs) x loop
    execute format('alter table public.%I drop constraint if exists %I', r.child, r.child || '_' || r.col || '_fkey');
    execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I (id) on delete %s',
      r.child, r.child || '_' || r.col || '_fkey', r.col, r.parent, r.on_delete);
  end loop;
  for r in select distinct x->>2 as parent from jsonb_array_elements(v_refs) x loop
    execute format('alter table public.%I drop constraint if exists %I', r.parent, r.parent || '_workspace_id_id_key');
  end loop;
end
$own01_down$;
notify pgrst, 'reload schema';
