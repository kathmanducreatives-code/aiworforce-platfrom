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