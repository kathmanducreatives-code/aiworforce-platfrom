-- Cleanup for the 5 Q1 evaluation outreach drafts (fabricated recipients, never sent).
-- ============================================================================
-- DO NOT AUTO-RUN. Requires explicit human approval + manual execution against
-- the TEST project ONLY (zbwsbnqqpkvdhqwavjke). NEVER run against production
-- (wqnigjhcwjxtmordrwno).
-- ============================================================================
--
-- Constraints enforced (idempotent — safe to run more than once):
--   * exactly the five recorded Q1 draft IDs
--   * status = 'draft' (never touch sent/approved)
--   * created_at within the recorded Q1 window (2026-07-13 09:37:00–09:37:10Z)
--   * workspace = My Company (00000000-0000-0000-0000-000000000001)
-- It does NOT touch historical drafts, sent messages, leads, or Company Brain.
--
-- Q1 plan_id (provenance, for the record): 055ad021-a3d4-4444-b83d-391957e75f84
-- (outreach_drafts rows had lead_candidate_id = NULL, so they are targeted by id.)

-- 1) DRY RUN — verify exactly 5 rows match before deleting:
SELECT id, status, created_at, lead_candidate_id
FROM outreach_drafts
WHERE id IN (
  '8854b757-4f71-4da3-8ab5-13da477f06d4',
  '9135648c-28b9-4226-95f8-02004856edbd',
  'c8a2e267-e2d2-4a02-b450-1a567715e01b',
  '9075f8a6-1d0b-430d-9e66-d8d203c3b945',
  '91dc6731-9daf-4a0e-a8d3-aa38552ef3cc'
)
  AND workspace_id = '00000000-0000-0000-0000-000000000001'
  AND status = 'draft'
  AND created_at >= '2026-07-13T09:37:00Z'
  AND created_at <  '2026-07-13T09:37:10Z';

-- 2) DELETE (uncomment to execute only after the dry run shows exactly 5 rows):
-- DELETE FROM outreach_drafts
-- WHERE id IN (
--   '8854b757-4f71-4da3-8ab5-13da477f06d4',
--   '9135648c-28b9-4226-95f8-02004856edbd',
--   'c8a2e267-e2d2-4a02-b450-1a567715e01b',
--   '9075f8a6-1d0b-430d-9e66-d8d203c3b945',
--   '91dc6731-9daf-4a0e-a8d3-aa38552ef3cc'
-- )
--   AND workspace_id = '00000000-0000-0000-0000-000000000001'
--   AND status = 'draft'
--   AND created_at >= '2026-07-13T09:37:00Z'
--   AND created_at <  '2026-07-13T09:37:10Z';
