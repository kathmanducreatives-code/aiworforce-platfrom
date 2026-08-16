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