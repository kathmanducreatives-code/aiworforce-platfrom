-- 102 POLICIES THAT AUTHORISED EVERYONE.
--
-- ── WHAT THEY WERE ─────────────────────────────────────────────────────────
--
-- 102 policies across 46 tables whose whole predicate is `true`. 33 of them,
-- on 18 tables, are granted to `anon` or PUBLIC — unauthenticated. Not only
-- reads:
--
--     linkedin_posts                DELETE  anon     "Allow anonymous delete access"
--     screening_templates           DELETE  PUBLIC   "…can delete templates"
--     screening_applications        SELECT  anon     "…select for candidates"
--     audit_log / error_log         INSERT  PUBLIC
--     dialer_* / lead_imports       ALL     PUBLIC   "public_all"
--
-- The anon key ships in the frontend bundle. So today anyone can read every
-- application ever submitted, delete a workspace's screening templates, and
-- flood the audit log — as soon as any of these tables holds a row.
--
-- ── WHY THIS IS SAFE TO DROP RATHER THAN REWRITE ───────────────────────────
--
-- All 46 tables are EMPTY. Every one belongs to the recruiting / dialer /
-- lead-scraper surface that no longer runs: 90 of 120 tables in this database
-- have never held a row, and these are among them.
--
-- And they could not be rewritten correctly even if we wanted to. FORTY-TWO of
-- the 46 have no `workspace_id` column at all, so there is nothing to scope a
-- multi-tenant predicate against. `USING (workspace_id in …)` cannot be written
-- for a table with no workspace. Replacing `true` with a guess would be
-- inventing a security model, not restoring one.
--
-- ── WHY NO REPLACEMENT POLICY, AND WHY NO REVOKE ───────────────────────────
--
-- RLS with no policy denies every non-owner role. For SELECT that denial is
-- SILENT — it returns zero rows, not an error, which is the behaviour
-- `rlsMembershipSource.test.ts` documents at length. So the seventeen legacy
-- pages that still query these tables keep rendering exactly what they render
-- now: an empty list. Dropping the policies changes nothing a user can see and
-- closes the hole underneath.
--
-- Grants are deliberately NOT revoked here. `anon` holds the default Supabase
-- grant on all 120 tables and RLS is what holds it back everywhere else;
-- revoking on these 46 alone would turn a silent empty list into a 401 on
-- pages that currently work, for no security gain. `ops_stuck_run_archive` was
-- revoked for a reason that does not apply here — it held real data, and
-- TRUNCATE is not filtered by RLS.
--
-- `service_role` bypasses RLS entirely, so every Edge Function that reads
-- these tables — the screening functions among them — is untouched.
--
-- ── WHAT THIS COSTS ────────────────────────────────────────────────────────
--
-- One thing, and it is worth stating plainly: `screening_applications` loses
-- its anonymous INSERT, which is what the public `/apply/:slug` route uses for
-- a candidate to submit an application without an account. That flow is part
-- of the dormant recruiting product and the table has never held a row. If it
-- is ever revived it needs a real policy — one that lets a candidate INSERT
-- their own application and read nothing back — which is precisely what
-- `WITH CHECK (true)` plus `USING (true)` was not.

-- adaptive_screening_sessions
drop policy if exists "Authenticated users can create screening sessions" on public.adaptive_screening_sessions;
drop policy if exists "Authenticated users can update screening sessions" on public.adaptive_screening_sessions;
drop policy if exists "Authenticated users can view screening sessions" on public.adaptive_screening_sessions;

-- agent_presence
drop policy if exists public_select on public.agent_presence;
drop policy if exists public_write on public.agent_presence;
drop policy if exists service_role_all on public.agent_presence;

-- audit_log
drop policy if exists "Authed insert audit logs" on public.audit_log;
drop policy if exists "Authed view audit logs" on public.audit_log;

-- call_attempts
drop policy if exists public_select on public.call_attempts;
drop policy if exists service_role_all on public.call_attempts;

-- candidate_notes
drop policy if exists "Authenticated users can create notes" on public.candidate_notes;
drop policy if exists "Authenticated users can view candidate notes" on public.candidate_notes;

-- candidate_profiles
drop policy if exists "Authed manage candidate profiles" on public.candidate_profiles;
drop policy if exists "Authed view candidate profiles" on public.candidate_profiles;

-- client_active_positions
drop policy if exists "Authenticated users can delete active positions" on public.client_active_positions;
drop policy if exists "Authenticated users can insert active positions" on public.client_active_positions;
drop policy if exists "Authenticated users can update active positions" on public.client_active_positions;
drop policy if exists "Authenticated users can view active positions" on public.client_active_positions;

-- client_placements
drop policy if exists "Authenticated users can delete placements" on public.client_placements;
drop policy if exists "Authenticated users can insert placements" on public.client_placements;
drop policy if exists "Authenticated users can update placements" on public.client_placements;
drop policy if exists "Authenticated users can view placements" on public.client_placements;

-- clients
drop policy if exists "Authenticated users can delete clients" on public.clients;
drop policy if exists "Authenticated users can insert clients" on public.clients;
drop policy if exists "Authenticated users can update clients" on public.clients;
drop policy if exists "Authenticated users can view clients" on public.clients;

-- closely_events
drop policy if exists "Authed manage closely events" on public.closely_events;

-- codex_leads
drop policy if exists "Authed manage codex leads" on public.codex_leads;

-- collaboration_contact_history
drop policy if exists "Anyone can view contact history" on public.collaboration_contact_history;

-- deep_search_analysis
drop policy if exists "Authenticated users can delete deep search analysis" on public.deep_search_analysis;
drop policy if exists "Authenticated users can insert deep search analysis" on public.deep_search_analysis;
drop policy if exists "Authenticated users can update deep search analysis" on public.deep_search_analysis;
drop policy if exists "Authenticated users can view deep search analysis" on public.deep_search_analysis;

-- deep_search_results
drop policy if exists "Authenticated users can delete deep search results" on public.deep_search_results;
drop policy if exists "Authenticated users can insert deep search results" on public.deep_search_results;
drop policy if exists "Authenticated users can update deep search results" on public.deep_search_results;
drop policy if exists "Authenticated users can view deep search results" on public.deep_search_results;

-- dialer_campaigns
drop policy if exists public_all on public.dialer_campaigns;

-- dialer_leads
drop policy if exists public_all on public.dialer_leads;
drop policy if exists service_role_all on public.dialer_leads;

-- dialer_locks
drop policy if exists public_select on public.dialer_locks;
drop policy if exists service_role_all on public.dialer_locks;

-- dialer_sessions
drop policy if exists public_all on public.dialer_sessions;
drop policy if exists public_select on public.dialer_sessions;
drop policy if exists service_role_all on public.dialer_sessions;

-- dialer_status
drop policy if exists "Authed manage dialer status" on public.dialer_status;

-- email_tracking
drop policy if exists "Anyone can insert tracking events" on public.email_tracking;
drop policy if exists "Authenticated users can view tracking events" on public.email_tracking;

-- error_log
drop policy if exists "Authed insert error logs" on public.error_log;
drop policy if exists "Authed view error logs" on public.error_log;

-- icp_lookalike_results
drop policy if exists "Authed manage ICP results" on public.icp_lookalike_results;
drop policy if exists "Authed read ICP results" on public.icp_lookalike_results;

-- icp_lookalike_sessions
drop policy if exists "Authed manage icp sessions" on public.icp_lookalike_sessions;
drop policy if exists "Authed view icp sessions" on public.icp_lookalike_sessions;

-- interviews
drop policy if exists "Authenticated users can create interviews" on public.interviews;

-- lead_imports
drop policy if exists public_all on public.lead_imports;

-- linkedin_leads
drop policy if exists "Authenticated users can delete linkedin leads" on public.linkedin_leads;
drop policy if exists "Authenticated users can insert linkedin leads" on public.linkedin_leads;
drop policy if exists "Authenticated users can update linkedin leads" on public.linkedin_leads;
drop policy if exists "Authenticated users can view linkedin leads" on public.linkedin_leads;

-- linkedin_posts
drop policy if exists "Allow anonymous delete access" on public.linkedin_posts;
drop policy if exists "Allow anonymous insert access" on public.linkedin_posts;
drop policy if exists "Allow anonymous read access" on public.linkedin_posts;
drop policy if exists "Allow anonymous update access" on public.linkedin_posts;

-- marketing_videos
drop policy if exists "Anyone read marketing videos" on public.marketing_videos;
drop policy if exists "Authed manage marketing videos" on public.marketing_videos;

-- outreach_activities
drop policy if exists "Authed manage outreach activities" on public.outreach_activities;

-- outreach_daily_queue
drop policy if exists "Authed manage daily queue" on public.outreach_daily_queue;

-- outreach_error_log
drop policy if exists "Authed manage outreach errors" on public.outreach_error_log;

-- outreach_leads
drop policy if exists "Authed manage outreach leads" on public.outreach_leads;

-- outreach_sequences
drop policy if exists "Authed manage outreach sequences" on public.outreach_sequences;

-- outreach_settings
drop policy if exists "Authed manage outreach settings" on public.outreach_settings;

-- resume_analyses
drop policy if exists "Authenticated users can delete resume analyses" on public.resume_analyses;
drop policy if exists "Authenticated users can insert resume analyses" on public.resume_analyses;
drop policy if exists "Authenticated users can update resume analyses" on public.resume_analyses;
drop policy if exists "Authenticated users can view resume analyses" on public.resume_analyses;

-- scheduled_emails
drop policy if exists "Authenticated users can create scheduled emails" on public.scheduled_emails;

-- scraping_sessions
drop policy if exists "Authenticated users can delete scraping sessions" on public.scraping_sessions;
drop policy if exists "Authenticated users can insert scraping sessions" on public.scraping_sessions;
drop policy if exists "Authenticated users can update scraping sessions" on public.scraping_sessions;
drop policy if exists "Authenticated users can view scraping sessions" on public.scraping_sessions;

-- screening_applications
drop policy if exists "Allow anonymous insert for candidates" on public.screening_applications;
drop policy if exists "Allow anonymous select for candidates" on public.screening_applications;
drop policy if exists "Allow anonymous update for candidates" on public.screening_applications;
drop policy if exists "Anyone can create applications" on public.screening_applications;

-- screening_behavioral_analysis
drop policy if exists "Authenticated users can view behavioral analysis" on public.screening_behavioral_analysis;
drop policy if exists "System can create behavioral analysis" on public.screening_behavioral_analysis;
drop policy if exists "System can update behavioral analysis" on public.screening_behavioral_analysis;

-- screening_conversation_logs
drop policy if exists "Anyone can insert conversation logs" on public.screening_conversation_logs;
drop policy if exists "Authenticated users can view conversation logs" on public.screening_conversation_logs;

-- screening_scenarios
drop policy if exists "Authenticated users can manage scenarios" on public.screening_scenarios;

-- screening_template_questions
drop policy if exists "Authenticated users can create template questions" on public.screening_template_questions;
drop policy if exists "Authenticated users can delete template questions" on public.screening_template_questions;
drop policy if exists "Authenticated users can update template questions" on public.screening_template_questions;
drop policy if exists "Authenticated users can view template questions" on public.screening_template_questions;

-- screening_templates
drop policy if exists "Authenticated users can create templates" on public.screening_templates;
drop policy if exists "Authenticated users can delete templates" on public.screening_templates;
drop policy if exists "Authenticated users can update templates" on public.screening_templates;
drop policy if exists "Authenticated users can view templates" on public.screening_templates;

-- sp_outreach_leads_scored
drop policy if exists "Authed manage outreach scored" on public.sp_outreach_leads_scored;

-- sp_wellfound_leads
drop policy if exists "Authed manage wellfound leads" on public.sp_wellfound_leads;

-- telnyx_events
drop policy if exists service_role_all on public.telnyx_events;
