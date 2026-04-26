-- ============================================================
-- 20251209004316_f343a91a-e82b-4478-9387-b4c429d06c6b.sql
-- ============================================================
-- Add a name column to scraping_sessions for folder organization
ALTER TABLE public.scraping_sessions 
ADD COLUMN name text;
-- ============================================================
-- 20251211173016_34ae9dc8-612a-4a70-90a4-04b5961e40b4.sql
-- ============================================================
-- Assign orphaned leads to the correct session based on timestamp matching
-- Leads with session_id NULL will be matched to the session that was created most recently before the lead
WITH lead_sessions AS (
  SELECT 
    l.id as lead_id,
    (SELECT s.id 
     FROM scraping_sessions s 
     WHERE s.created_at <= l.created_at 
     ORDER BY s.created_at DESC 
     LIMIT 1) as matched_session_id
  FROM linkedin_leads l
  WHERE l.session_id IS NULL
)
UPDATE linkedin_leads
SET session_id = lead_sessions.matched_session_id
FROM lead_sessions
WHERE linkedin_leads.id = lead_sessions.lead_id
  AND lead_sessions.matched_session_id IS NOT NULL;

-- Update total_leads count for all sessions to reflect actual counts
UPDATE scraping_sessions s
SET total_leads = (
  SELECT COUNT(*) 
  FROM linkedin_leads l 
  WHERE l.session_id = s.id
);
-- ============================================================
-- 20251220012716_9330afe4-4eb1-42ea-a044-ea34ed0e6565.sql
-- ============================================================
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Authenticated users can create rooms" ON collaboration_rooms;
DROP POLICY IF EXISTS "Users can view rooms they are members of" ON collaboration_rooms;

-- Create PERMISSIVE INSERT policy for authenticated users
CREATE POLICY "Authenticated users can create rooms"
ON collaboration_rooms
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

-- Create PERMISSIVE SELECT policy that allows members OR creators to view rooms
CREATE POLICY "Users can view rooms they are members of or created"
ON collaboration_rooms
FOR SELECT
TO authenticated
USING (is_room_member(auth.uid(), id) OR auth.uid() = created_by);
-- ============================================================
-- 20251223234638_502ed15f-1a80-43ff-b11d-2969ebb4e273.sql
-- ============================================================
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
-- ============================================================
-- 20251224000020_fa5d229e-b434-4f3a-a9e3-483365d96243.sql
-- ============================================================
-- Create job_postings table
CREATE TABLE public.job_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  company_name text NOT NULL,
  location text NOT NULL,
  job_type text NOT NULL DEFAULT 'full-time',
  salary_min integer,
  salary_max integer,
  salary_currency text DEFAULT 'USD',
  description text NOT NULL,
  requirements text[] DEFAULT '{}',
  benefits text[] DEFAULT '{}',
  remote_option text DEFAULT 'no',
  experience_level text,
  posted_boards jsonb DEFAULT '{}',
  status text DEFAULT 'draft',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Users can view their own job postings"
ON public.job_postings
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own job postings"
ON public.job_postings
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own job postings"
ON public.job_postings
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own job postings"
ON public.job_postings
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_job_postings_updated_at
BEFORE UPDATE ON public.job_postings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
-- ============================================================
-- 20251224095158_5b83cb83-67d4-4e9e-bb07-da752ee6131c.sql
-- ============================================================
-- Create enum for screening session status
CREATE TYPE screening_session_status AS ENUM ('invited', 'in_progress', 'completed', 'expired', 'abandoned');

-- Create enum for risk level
CREATE TYPE behavioral_risk_level AS ENUM ('low', 'medium', 'high');

-- Create enum for scenario category
CREATE TYPE scenario_category AS ENUM ('ambiguity', 'accountability', 'competing_priorities', 'time_pressure', 'conflict_resolution');

-- Table: adaptive_screening_sessions - Track each screening session
CREATE TABLE public.adaptive_screening_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES public.resume_analyses(id) ON DELETE CASCADE,
  session_status screening_session_status NOT NULL DEFAULT 'invited',
  access_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '7 days'),
  scenario_count INTEGER DEFAULT 3,
  current_scenario_index INTEGER DEFAULT 0,
  candidate_consent_given BOOLEAN DEFAULT false,
  consent_given_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table: screening_scenarios - Reusable scenario templates
CREATE TABLE public.screening_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category scenario_category NOT NULL,
  scenario_prompt TEXT NOT NULL,
  follow_up_prompts JSONB DEFAULT '[]'::jsonb,
  difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
  target_signals JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table: screening_conversation_logs - Full conversation history
CREATE TABLE public.screening_conversation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.adaptive_screening_sessions(id) ON DELETE CASCADE,
  message_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('system', 'assistant', 'user')),
  content TEXT NOT NULL,
  scenario_id UUID REFERENCES public.screening_scenarios(id),
  behavioral_signals_detected JSONB DEFAULT '{}'::jsonb,
  response_time_seconds INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table: screening_behavioral_analysis - Final risk assessment
CREATE TABLE public.screening_behavioral_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID UNIQUE NOT NULL REFERENCES public.adaptive_screening_sessions(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.resume_analyses(id) ON DELETE CASCADE,
  
  -- Behavioral scores (0-100)
  ownership_score INTEGER CHECK (ownership_score BETWEEN 0 AND 100),
  ownership_evidence JSONB DEFAULT '[]'::jsonb,
  
  clarity_score INTEGER CHECK (clarity_score BETWEEN 0 AND 100),
  clarity_evidence JSONB DEFAULT '[]'::jsonb,
  
  emotional_regulation_score INTEGER CHECK (emotional_regulation_score BETWEEN 0 AND 100),
  emotional_evidence JSONB DEFAULT '[]'::jsonb,
  
  consistency_score INTEGER CHECK (consistency_score BETWEEN 0 AND 100),
  consistency_evidence JSONB DEFAULT '[]'::jsonb,
  
  -- Overall assessment
  overall_risk_level behavioral_risk_level,
  risk_summary TEXT,
  red_flags JSONB DEFAULT '[]'::jsonb,
  green_flags JSONB DEFAULT '[]'::jsonb,
  
  -- AI analysis metadata
  ai_confidence_score INTEGER CHECK (ai_confidence_score BETWEEN 0 AND 100),
  analysis_completed_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add screening_status to resume_analyses
ALTER TABLE public.resume_analyses 
ADD COLUMN IF NOT EXISTS screening_status TEXT DEFAULT 'not_invited' 
CHECK (screening_status IN ('not_invited', 'invited', 'in_progress', 'completed', 'expired'));

-- Create indexes for performance
CREATE INDEX idx_screening_sessions_candidate ON public.adaptive_screening_sessions(candidate_id);
CREATE INDEX idx_screening_sessions_token ON public.adaptive_screening_sessions(access_token);
CREATE INDEX idx_screening_sessions_status ON public.adaptive_screening_sessions(session_status);
CREATE INDEX idx_conversation_logs_session ON public.screening_conversation_logs(session_id);
CREATE INDEX idx_behavioral_analysis_candidate ON public.screening_behavioral_analysis(candidate_id);

-- Enable RLS on all tables
ALTER TABLE public.adaptive_screening_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_conversation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_behavioral_analysis ENABLE ROW LEVEL SECURITY;

-- RLS Policies for adaptive_screening_sessions
CREATE POLICY "Authenticated users can view screening sessions"
ON public.adaptive_screening_sessions FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can create screening sessions"
ON public.adaptive_screening_sessions FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update screening sessions"
ON public.adaptive_screening_sessions FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Public access by token for candidates"
ON public.adaptive_screening_sessions FOR SELECT
TO anon
USING (access_token IS NOT NULL);

CREATE POLICY "Candidates can update their session by token"
ON public.adaptive_screening_sessions FOR UPDATE
TO anon
USING (access_token IS NOT NULL);

-- RLS Policies for screening_scenarios
CREATE POLICY "Anyone can view active scenarios"
ON public.screening_scenarios FOR SELECT
USING (is_active = true);

CREATE POLICY "Authenticated users can manage scenarios"
ON public.screening_scenarios FOR ALL
TO authenticated
USING (true);

-- RLS Policies for screening_conversation_logs
CREATE POLICY "Authenticated users can view conversation logs"
ON public.screening_conversation_logs FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Anyone can insert conversation logs"
ON public.screening_conversation_logs FOR INSERT
WITH CHECK (true);

-- RLS Policies for screening_behavioral_analysis
CREATE POLICY "Authenticated users can view behavioral analysis"
ON public.screening_behavioral_analysis FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "System can create behavioral analysis"
ON public.screening_behavioral_analysis FOR INSERT
WITH CHECK (true);

CREATE POLICY "System can update behavioral analysis"
ON public.screening_behavioral_analysis FOR UPDATE
USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_screening_sessions_updated_at
BEFORE UPDATE ON public.adaptive_screening_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_scenarios_updated_at
BEFORE UPDATE ON public.screening_scenarios
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_behavioral_analysis_updated_at
BEFORE UPDATE ON public.screening_behavioral_analysis
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default scenarios
INSERT INTO public.screening_scenarios (name, category, scenario_prompt, follow_up_prompts, difficulty_level, target_signals) VALUES
-- Ambiguity scenarios
('Unclear Project Requirements', 'ambiguity', 
 'Your manager assigns you a critical project but gives very vague instructions. They say "Make it great" and then leave for a two-week vacation with no way to contact them. The deadline is in 10 days. What do you do first, and how do you proceed?',
 '["What if the stakeholders you reach out to have conflicting opinions about what ''great'' means?", "How would you handle it if you made a decision that later turned out to be wrong?", "What would you do if you''re halfway through and realize you interpreted the requirements incorrectly?"]'::jsonb,
 3, '["ownership", "clarity", "initiative", "problem_solving"]'::jsonb),

('Conflicting Stakeholder Instructions', 'ambiguity',
 'You receive an urgent email from the VP of Sales asking you to prioritize Feature A, while simultaneously the VP of Product sends a message insisting Feature B is the top priority. Both claim their request comes from the CEO. How do you handle this?',
 '["What if neither VP responds to your clarification request and the deadline is tomorrow?", "How would you document your decision-making process?", "What would you do if your decision upset one of the VPs?"]'::jsonb,
 4, '["clarity", "communication", "judgment", "conflict_resolution"]'::jsonb),

-- Accountability scenarios
('Project Failure Ownership', 'accountability',
 'A project you led missed its deadline by two weeks, and the client is threatening to cancel their contract. Your team worked hard, but looking back, there were warning signs you could have addressed earlier. You have a meeting with the executive team in one hour. What do you say?',
 '["How would you respond if an executive asks specifically what YOU could have done differently?", "What if a team member publicly blames you for not providing clear direction?", "How do you prevent this from happening again?"]'::jsonb,
 4, '["ownership", "accountability", "self_awareness", "learning_orientation"]'::jsonb),

('Discovered Mistake', 'accountability',
 'You just discovered a significant error in a report you submitted last week. The report has already been shared with the board of directors and influenced a major business decision. What do you do?',
 '["What if correcting the error might make the business decision look bad?", "How would you communicate this to your manager?", "What steps would you take to prevent similar errors?"]'::jsonb,
 3, '["honesty", "ownership", "proactive_communication", "integrity"]'::jsonb),

-- Competing priorities scenarios
('Triple Deadline Crisis', 'competing_priorities',
 'It''s Monday morning. You have three critical deadlines all due by Friday: a client presentation, a quarterly report for leadership, and a project deliverable your team is depending on. Realistically, you can only complete two of them well. Walk me through your decision-making process.',
 '["What factors matter most in your prioritization?", "How do you communicate to the stakeholder whose deadline you can''t meet?", "What if your manager insists all three must be done?"]'::jsonb,
 3, '["prioritization", "communication", "judgment", "stress_management"]'::jsonb),

('Colleague Request Conflict', 'competing_priorities',
 'A colleague who helped you significantly on a past project asks for your help on an urgent task. However, you''re already behind on your own critical work, and helping them would mean missing your own deadline. How do you handle this?',
 '["What if this colleague is more senior than you?", "How would you feel if the roles were reversed?", "What if helping them only requires 2 hours but you''re already at capacity?"]'::jsonb,
 2, '["boundaries", "communication", "relationship_management", "self_awareness"]'::jsonb),

-- Time pressure scenarios
('Last-Minute Change Request', 'time_pressure',
 'Your client calls at 4 PM on Friday requesting major changes to a presentation you''re giving Monday morning. The changes would require significant rework. The client is important, but you also had personal plans this weekend. How do you respond?',
 '["What if the client insists these changes are non-negotiable?", "How do you balance client needs with your own well-being?", "What would you do differently to prevent this situation in the future?"]'::jsonb,
 3, '["boundary_setting", "negotiation", "client_management", "stress_management"]'::jsonb),

-- Conflict resolution scenarios
('Team Disagreement', 'conflict_resolution',
 'Two members of your team are in a heated disagreement about the technical approach to a project. Both have valid points, but their conflict is affecting team morale and slowing progress. As the project lead, what do you do?',
 '["What if one of them is clearly more experienced but the other has a better idea?", "How do you ensure the person whose idea isn''t chosen still feels valued?", "What if the conflict becomes personal?"]'::jsonb,
 3, '["leadership", "conflict_resolution", "emotional_intelligence", "fairness"]'::jsonb);

-- Enable realtime for screening sessions
ALTER PUBLICATION supabase_realtime ADD TABLE adaptive_screening_sessions;
-- ============================================================
-- 20251228022612_9d546d64-45c0-45ee-967a-ba2b0aef260b.sql
-- ============================================================
-- Create screening_templates table
CREATE TABLE public.screening_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  role_focus TEXT,
  is_default BOOLEAN DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create screening_template_questions table
CREATE TABLE public.screening_template_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES public.screening_templates(id) ON DELETE CASCADE,
  scenario_id UUID REFERENCES public.screening_scenarios(id),
  category TEXT NOT NULL,
  question_text TEXT NOT NULL,
  follow_up_prompts JSONB DEFAULT '[]',
  difficulty_level INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  is_custom BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add template_id to adaptive_screening_sessions
ALTER TABLE public.adaptive_screening_sessions
ADD COLUMN template_id UUID REFERENCES public.screening_templates(id);

-- Enable RLS on screening_templates
ALTER TABLE public.screening_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies for screening_templates
CREATE POLICY "Authenticated users can view templates"
ON public.screening_templates FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can create templates"
ON public.screening_templates FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update templates"
ON public.screening_templates FOR UPDATE
USING (true);

CREATE POLICY "Authenticated users can delete templates"
ON public.screening_templates FOR DELETE
USING (true);

-- Enable RLS on screening_template_questions
ALTER TABLE public.screening_template_questions ENABLE ROW LEVEL SECURITY;

-- RLS policies for screening_template_questions
CREATE POLICY "Authenticated users can view template questions"
ON public.screening_template_questions FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can create template questions"
ON public.screening_template_questions FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update template questions"
ON public.screening_template_questions FOR UPDATE
USING (true);

CREATE POLICY "Authenticated users can delete template questions"
ON public.screening_template_questions FOR DELETE
USING (true);

-- Create trigger for updated_at on screening_templates
CREATE TRIGGER update_screening_templates_updated_at
BEFORE UPDATE ON public.screening_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert a default template with existing scenarios
INSERT INTO public.screening_templates (name, description, is_default)
VALUES ('Default Behavioral Screening', 'Standard behavioral assessment covering all scenario categories', true);

-- Copy existing scenarios to the default template
INSERT INTO public.screening_template_questions (template_id, scenario_id, category, question_text, follow_up_prompts, difficulty_level, sort_order, is_custom)
SELECT 
  (SELECT id FROM public.screening_templates WHERE is_default = true LIMIT 1),
  id,
  category::text,
  scenario_prompt,
  follow_up_prompts,
  difficulty_level,
  ROW_NUMBER() OVER (PARTITION BY category ORDER BY created_at),
  false
FROM public.screening_scenarios
WHERE is_active = true;
-- ============================================================
-- 20251229161155_25847aa6-b29b-4319-8d75-dcad5807b733.sql
-- ============================================================
-- Add role_briefing and scenario_config columns to adaptive_screening_sessions
ALTER TABLE adaptive_screening_sessions 
ADD COLUMN IF NOT EXISTS role_briefing JSONB DEFAULT NULL;

ALTER TABLE adaptive_screening_sessions 
ADD COLUMN IF NOT EXISTS scenario_config JSONB DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN adaptive_screening_sessions.role_briefing IS 'Recruiter-defined context: role_title, skills_expected, experience_required, key_traits';
COMMENT ON COLUMN adaptive_screening_sessions.scenario_config IS 'Question limits config: total_limit, category_limits object';
-- ============================================================
-- 20260214141447_d3869193-dd49-4fa5-b4e5-c1d7eb1c4f9b.sql
-- ============================================================

-- Create screening_jobs table
CREATE TABLE public.screening_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  company_name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  required_years integer NOT NULL DEFAULT 0,
  required_skills text[] NOT NULL DEFAULT '{}',
  education_requirement text NOT NULL DEFAULT 'None',
  salary_min integer,
  salary_max integer,
  custom_questions jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.screening_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own screening jobs"
  ON public.screening_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own screening jobs"
  ON public.screening_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own screening jobs"
  ON public.screening_jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own screening jobs"
  ON public.screening_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Public read policy for candidates accessing via slug
CREATE POLICY "Anyone can view active screening jobs by slug"
  ON public.screening_jobs FOR SELECT
  USING (status = 'active');

-- Create screening_applications table
CREATE TABLE public.screening_applications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.screening_jobs(id) ON DELETE CASCADE,
  access_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'started',
  resume_url text,
  extracted_data jsonb,
  candidate_edits jsonb,
  screening_answers jsonb DEFAULT '[]'::jsonb,
  tab_switches integer NOT NULL DEFAULT 0,
  total_time_seconds integer NOT NULL DEFAULT 0,
  match_score integer,
  match_category text,
  strengths jsonb DEFAULT '[]'::jsonb,
  red_flags jsonb DEFAULT '[]'::jsonb,
  interview_questions jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.screening_applications ENABLE ROW LEVEL SECURITY;

-- Candidates can insert (start an application)
CREATE POLICY "Anyone can create applications"
  ON public.screening_applications FOR INSERT
  WITH CHECK (true);

-- Candidates can update their own application by token
CREATE POLICY "Anyone can update applications by token"
  ON public.screening_applications FOR UPDATE
  USING (access_token IS NOT NULL);

-- Candidates can view their own application by token
CREATE POLICY "Anyone can view applications by token"
  ON public.screening_applications FOR SELECT
  USING (access_token IS NOT NULL);

-- Recruiters can view applications for their jobs
CREATE POLICY "Recruiters can view applications for their jobs"
  ON public.screening_applications FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.screening_jobs
    WHERE screening_jobs.id = screening_applications.job_id
    AND screening_jobs.user_id = auth.uid()
  ));

-- Create screening-resumes storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('screening-resumes', 'screening-resumes', false);

-- Anyone can upload resumes
CREATE POLICY "Anyone can upload resumes"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'screening-resumes');

-- Anyone can read their uploaded resume
CREATE POLICY "Anyone can read screening resumes"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'screening-resumes');

-- ============================================================
-- 20260214142823_705f2b92-59f7-4987-ad60-4b4da6a7b3d3.sql
-- ============================================================

ALTER TABLE public.screening_applications
ADD COLUMN IF NOT EXISTS recruiter_status text DEFAULT 'new',
ADD COLUMN IF NOT EXISTS recruiter_notes text,
ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;

-- ============================================================
-- 20260219164639_3632834e-01f5-404d-a970-0aa174f5ffb6.sql
-- ============================================================
ALTER TYPE candidate_source ADD VALUE IF NOT EXISTS 'screening_flow';
