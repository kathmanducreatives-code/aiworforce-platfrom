-- Add role_briefing and scenario_config columns to adaptive_screening_sessions
ALTER TABLE adaptive_screening_sessions 
ADD COLUMN IF NOT EXISTS role_briefing JSONB DEFAULT NULL;

ALTER TABLE adaptive_screening_sessions 
ADD COLUMN IF NOT EXISTS scenario_config JSONB DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN adaptive_screening_sessions.role_briefing IS 'Recruiter-defined context: role_title, skills_expected, experience_required, key_traits';
COMMENT ON COLUMN adaptive_screening_sessions.scenario_config IS 'Question limits config: total_limit, category_limits object';