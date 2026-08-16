-- Enable RLS on deep_search_analysis table
ALTER TABLE deep_search_analysis ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users only
CREATE POLICY "Authenticated users can view deep search analysis"
ON deep_search_analysis FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert deep search analysis"
ON deep_search_analysis FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update deep search analysis"
ON deep_search_analysis FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete deep search analysis"
ON deep_search_analysis FOR DELETE TO authenticated USING (true);

-- Fix resume_analyses: require authentication
DROP POLICY IF EXISTS "Public users can view resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Public users can insert resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Public users can update resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Public users can delete resume analyses" ON resume_analyses;

CREATE POLICY "Authenticated users can view resume analyses"
ON resume_analyses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert resume analyses"
ON resume_analyses FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update resume analyses"
ON resume_analyses FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete resume analyses"
ON resume_analyses FOR DELETE TO authenticated USING (true);

-- Fix scheduled_emails: require authentication
DROP POLICY IF EXISTS "Anyone can view scheduled emails" ON scheduled_emails;
DROP POLICY IF EXISTS "Anyone can create scheduled emails" ON scheduled_emails;
DROP POLICY IF EXISTS "Anyone can update scheduled emails" ON scheduled_emails;
DROP POLICY IF EXISTS "Anyone can delete scheduled emails" ON scheduled_emails;

CREATE POLICY "Authenticated users can view scheduled emails"
ON scheduled_emails FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create scheduled emails"
ON scheduled_emails FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update scheduled emails"
ON scheduled_emails FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete scheduled emails"
ON scheduled_emails FOR DELETE TO authenticated USING (true);

-- Fix linkedin_leads: require authentication
DROP POLICY IF EXISTS "Anyone can view linkedin leads" ON linkedin_leads;
DROP POLICY IF EXISTS "Anyone can insert linkedin leads" ON linkedin_leads;
DROP POLICY IF EXISTS "Anyone can update linkedin leads" ON linkedin_leads;
DROP POLICY IF EXISTS "Anyone can delete linkedin leads" ON linkedin_leads;

CREATE POLICY "Authenticated users can view linkedin leads"
ON linkedin_leads FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert linkedin leads"
ON linkedin_leads FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update linkedin leads"
ON linkedin_leads FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete linkedin leads"
ON linkedin_leads FOR DELETE TO authenticated USING (true);

-- Fix deep_search_results: require authentication
DROP POLICY IF EXISTS "Anyone can view deep search results" ON deep_search_results;
DROP POLICY IF EXISTS "Anyone can insert deep search results" ON deep_search_results;
DROP POLICY IF EXISTS "Anyone can update deep search results" ON deep_search_results;
DROP POLICY IF EXISTS "Anyone can delete deep search results" ON deep_search_results;

CREATE POLICY "Authenticated users can view deep search results"
ON deep_search_results FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert deep search results"
ON deep_search_results FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update deep search results"
ON deep_search_results FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete deep search results"
ON deep_search_results FOR DELETE TO authenticated USING (true);

-- Fix candidate_notes: require authentication
DROP POLICY IF EXISTS "Anyone can view candidate notes" ON candidate_notes;
DROP POLICY IF EXISTS "Anyone can create notes" ON candidate_notes;

CREATE POLICY "Authenticated users can view candidate notes"
ON candidate_notes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create notes"
ON candidate_notes FOR INSERT TO authenticated WITH CHECK (true);

-- Fix email_tracking: require authentication for viewing (keep insert open for tracking pixels)
DROP POLICY IF EXISTS "Anyone can view tracking events" ON email_tracking;

CREATE POLICY "Authenticated users can view tracking events"
ON email_tracking FOR SELECT TO authenticated USING (true);

-- Fix scraping_sessions: require authentication
DROP POLICY IF EXISTS "Anyone can view scraping sessions" ON scraping_sessions;
DROP POLICY IF EXISTS "Anyone can insert scraping sessions" ON scraping_sessions;
DROP POLICY IF EXISTS "Anyone can update scraping sessions" ON scraping_sessions;
DROP POLICY IF EXISTS "Anyone can delete scraping sessions" ON scraping_sessions;

CREATE POLICY "Authenticated users can view scraping sessions"
ON scraping_sessions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert scraping sessions"
ON scraping_sessions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update scraping sessions"
ON scraping_sessions FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete scraping sessions"
ON scraping_sessions FOR DELETE TO authenticated USING (true);

-- Fix client_placements: require authentication
DROP POLICY IF EXISTS "Public users can view placements" ON client_placements;
DROP POLICY IF EXISTS "Public users can insert placements" ON client_placements;
DROP POLICY IF EXISTS "Public users can update placements" ON client_placements;
DROP POLICY IF EXISTS "Public users can delete placements" ON client_placements;

CREATE POLICY "Authenticated users can view placements"
ON client_placements FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert placements"
ON client_placements FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update placements"
ON client_placements FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete placements"
ON client_placements FOR DELETE TO authenticated USING (true);

-- Fix client_active_positions: require authentication
DROP POLICY IF EXISTS "Public users can view active positions" ON client_active_positions;
DROP POLICY IF EXISTS "Public users can insert active positions" ON client_active_positions;
DROP POLICY IF EXISTS "Public users can update active positions" ON client_active_positions;
DROP POLICY IF EXISTS "Public users can delete active positions" ON client_active_positions;

CREATE POLICY "Authenticated users can view active positions"
ON client_active_positions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert active positions"
ON client_active_positions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update active positions"
ON client_active_positions FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete active positions"
ON client_active_positions FOR DELETE TO authenticated USING (true);

-- Fix clients: require authentication (keep user's own client policy)
DROP POLICY IF EXISTS "Public users can view clients" ON clients;
DROP POLICY IF EXISTS "Public users can insert clients" ON clients;
DROP POLICY IF EXISTS "Public users can update clients" ON clients;
DROP POLICY IF EXISTS "Public users can delete clients" ON clients;

CREATE POLICY "Authenticated users can view clients"
ON clients FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert clients"
ON clients FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update clients"
ON clients FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete clients"
ON clients FOR DELETE TO authenticated USING (true);

-- Fix interviews: require authentication for anonymous inserts
DROP POLICY IF EXISTS "Anyone can create interviews" ON interviews;

CREATE POLICY "Authenticated users can create interviews"
ON interviews FOR INSERT TO authenticated WITH CHECK (true);

-- Create security definer function for fetching room member profiles
CREATE OR REPLACE FUNCTION public.get_room_member_profiles(room_uuid uuid)
RETURNS TABLE (user_id uuid, full_name text, logo_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.full_name, p.logo_url
  FROM profiles p
  INNER JOIN collaboration_room_members m ON m.user_id = p.user_id
  WHERE m.room_id = room_uuid;
$$;