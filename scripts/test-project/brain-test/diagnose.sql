-- READ-ONLY diagnostic for Brain TEST (scripts/test-env/brain-test diagnose).
-- Runs inside BEGIN READ ONLY; prints the Brain row state and its recent write
-- history. No secrets, no auth data beyond user ids and roles.
\pset footer off
\echo == workspaces and members (role per user id)
select w.id as workspace_id, w.name, m.user_id, m.role
  from public.workspaces w left join public.workspace_members m on m.workspace_id = w.id
 order by w.created_at, m.role;
\echo
\echo == company_brain (one row per workspace)
select b.workspace_id, b.onboarding_completed, b.updated_at,
       b.profile->>'setup_status' as setup_status,
       b.profile->'goals' as goals,
       b.profile->'positioning' as positioning, b.profile->'brand_voice' as brand_voice,
       (select string_agg(k, ',' order by k) from jsonb_object_keys(b.profile) k) as profile_keys
  from public.company_brain b order by b.updated_at desc;
\echo
\echo == last 20 writes (who, which sections, when)
select r.workspace_id, r.revision, r.written_at, r.actor_kind, r.permission, r.source_kind, r.changed_sections
  from public.company_brain_revisions r order by r.written_at desc limit 20;
\echo
\echo == approved / active memory (what every agent reads)
select m.workspace_id, m.kind, m.fact_key, m.value, m.version, m.lifecycle_status, m.approval_status, m.created_by_kind, m.updated_at
  from public.company_brain_memory m order by m.updated_at desc limit 30;
\echo
\echo == memory proposals (pending until a person approves)
select p.workspace_id, p.proposed_by_agent, p.kind, p.fact_key, p.value, p.status, p.contradicts_memory_id is not null as replaces_existing, p.updated_at
  from public.company_brain_memory_proposals p order by p.updated_at desc limit 20;
\echo
\echo == SIGNALS: which signal tables exist on this project (held LISA / collaboration migrations?)
select t.table_name from information_schema.tables t
 where t.table_schema = 'public' and t.table_name in ('signals','signal_events','signal_event_evidence','signal_reviews','signal_cluster_relevance',
   'monitoring_subjects','monitoring_budgets','lisa_scan_runs','lisa_watch_state','signal_event_transitions','agent_handoffs','agent_collaboration_items')
 order by 1;
\echo
\echo == SIGNALS: rows per workspace (legacy radar table vs canonical table)
select w.name, (select count(*) from public.signals s where s.workspace_id = w.id) as legacy_signals,
       (select count(*) from public.signal_events e where e.workspace_id = w.id) as canonical_signal_events,
       (select count(*) from public.signal_reviews r where r.workspace_id = w.id) as reviews,
       (select count(*) from public.monitoring_subjects m where m.workspace_id = w.id) as watches,
       (select count(*) from public.monitoring_subjects m where m.workspace_id = w.id and m.enabled) as enabled_watches
  from public.workspaces w order by w.created_at;
\echo
\echo == SIGNALS: latest stored signals (titles only)
select 'legacy' as store, s.created_at as at, s.signal_type, left(s.title, 80) as title, s.source from public.signals s
union all
select 'canonical', e.observed_at, e.signal_type, left(coalesce(e.normalized_value #>> '{lisa,title}', e.signal_type), 80), e.verification_status from public.signal_events e
order by 2 desc limit 15;
\echo
\echo == SIGNALS: Edit-radar preferences saved in the Company Brain (signal_preferences)
select b.workspace_id, b.profile->'signal_preferences' as signal_preferences from public.company_brain b;
\echo
\echo == SIGNALS: scheduled jobs in this database (must not call a hosted project)
select jobname, schedule, left(command, 120) as command from cron.job order by 1;
