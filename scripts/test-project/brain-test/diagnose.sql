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
