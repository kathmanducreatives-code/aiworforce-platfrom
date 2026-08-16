-- ============ agents (workspace-scoped) ============
DROP POLICY IF EXISTS "Authed manage agents" ON public.agents;
CREATE POLICY "Members manage workspace agents" ON public.agents FOR ALL TO authenticated
  USING (workspace_id IS NULL OR public.has_workspace_access(auth.uid(), workspace_id))
  WITH CHECK (workspace_id IS NULL OR public.has_workspace_access(auth.uid(), workspace_id));

-- ============ agent_capabilities (scoped via parent agent) ============
DROP POLICY IF EXISTS "Authed manage agent capabilities" ON public.agent_capabilities;
DROP POLICY IF EXISTS "Authed read agent capabilities" ON public.agent_capabilities;
CREATE POLICY "Members manage agent capabilities" ON public.agent_capabilities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agents a WHERE a.id = agent_capabilities.agent_id
    AND (a.workspace_id IS NULL OR public.has_workspace_access(auth.uid(), a.workspace_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.agents a WHERE a.id = agent_capabilities.agent_id
    AND (a.workspace_id IS NULL OR public.has_workspace_access(auth.uid(), a.workspace_id))));

-- ============ job_postings (user-scoped) ============
DROP POLICY IF EXISTS "Authenticated users can manage job postings" ON public.job_postings;
DROP POLICY IF EXISTS "Authenticated users can view job postings" ON public.job_postings;
CREATE POLICY "Users manage own job postings" ON public.job_postings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ Service-role-only tables (no ownership column; backend-only access) ============
-- candidate_profiles
DROP POLICY IF EXISTS "Authed manage candidate profiles" ON public.candidate_profiles;
DROP POLICY IF EXISTS "Authed view candidate profiles" ON public.candidate_profiles;
CREATE POLICY "Deny direct access candidate_profiles" ON public.candidate_profiles FOR SELECT TO authenticated, anon USING (false);

-- agent_runs
DROP POLICY IF EXISTS "Authed manage agent_runs" ON public.agent_runs;
CREATE POLICY "Deny direct access agent_runs" ON public.agent_runs FOR SELECT TO authenticated, anon USING (false);

-- competitor_* group
DROP POLICY IF EXISTS "Authed all competitor_companies" ON public.competitor_companies;
CREATE POLICY "Deny direct access competitor_companies" ON public.competitor_companies FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS "Authed all competitor_profiles" ON public.competitor_profiles;
CREATE POLICY "Deny direct access competitor_profiles" ON public.competitor_profiles FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS "Authed all competitor_intel_signals" ON public.competitor_intel_signals;
CREATE POLICY "Deny direct access competitor_intel_signals" ON public.competitor_intel_signals FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS "Authed all competitor_job_postings" ON public.competitor_job_postings;
CREATE POLICY "Deny direct access competitor_job_postings" ON public.competitor_job_postings FOR SELECT TO authenticated, anon USING (false);

-- growth/firecrawl/market/distribution
DROP POLICY IF EXISTS "Authed manage growth signals" ON public.growth_signal_companies;
CREATE POLICY "Deny direct access growth_signal_companies" ON public.growth_signal_companies FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS "Authed all firecrawl_scrape_logs" ON public.firecrawl_scrape_logs;
CREATE POLICY "Deny direct access firecrawl_scrape_logs" ON public.firecrawl_scrape_logs FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS "Authed all job_market_intelligence" ON public.job_market_intelligence;
CREATE POLICY "Deny direct access job_market_intelligence" ON public.job_market_intelligence FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS "Authed manage job postings dist" ON public.job_distribution_postings;
CREATE POLICY "Deny direct access job_distribution_postings" ON public.job_distribution_postings FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS "Authed manage job distribution" ON public.job_distribution_status;
CREATE POLICY "Deny direct access job_distribution_status" ON public.job_distribution_status FOR SELECT TO authenticated, anon USING (false);

-- pricing_history & talent_signals (referenced by scanner)
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Authed all pricing_history" ON public.pricing_history';
  EXECUTE 'DROP POLICY IF EXISTS "Authed manage pricing_history" ON public.pricing_history';
  EXECUTE 'CREATE POLICY "Deny direct access pricing_history" ON public.pricing_history FOR SELECT TO authenticated, anon USING (false)';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Authed all talent_signals" ON public.talent_signals';
  EXECUTE 'DROP POLICY IF EXISTS "Authed manage talent_signals" ON public.talent_signals';
  EXECUTE 'CREATE POLICY "Deny direct access talent_signals" ON public.talent_signals FOR SELECT TO authenticated, anon USING (false)';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- outreach_* (no ownership column; backend-managed)
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Authed manage outreach leads" ON public.outreach_leads';
  EXECUTE 'CREATE POLICY "Deny direct access outreach_leads" ON public.outreach_leads FOR SELECT TO authenticated, anon USING (false)';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Authed manage outreach sequences" ON public.outreach_sequences';
  EXECUTE 'CREATE POLICY "Deny direct access outreach_sequences" ON public.outreach_sequences FOR SELECT TO authenticated, anon USING (false)';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Authed manage outreach activities" ON public.outreach_activities';
  EXECUTE 'CREATE POLICY "Deny direct access outreach_activities" ON public.outreach_activities FOR SELECT TO authenticated, anon USING (false)';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ collaboration_room_members: only creator can add members ============
DROP POLICY IF EXISTS "Users can join rooms" ON public.collaboration_room_members;
CREATE POLICY "Room creator adds members" ON public.collaboration_room_members FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.collaboration_rooms r WHERE r.id = collaboration_room_members.room_id AND r.created_by = auth.uid())
  );
