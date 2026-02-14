

## Fix: Screening Link Generation Fails for LinkedIn Lead Candidates

### Root Cause
The `generate-screening-invite` edge function only looks up candidates in the `resume_analyses` table (line 185-189). However, `ShareScreening.tsx` can send candidate IDs from **two sources**: `resume_analyses` and `linkedin_leads`. When a LinkedIn lead is selected, the ID doesn't exist in `resume_analyses`, so the function returns `404: Candidate not found`.

### Solution
Pass the `candidate_source` from the frontend so the edge function knows which table to query.

### Changes

#### 1. `src/components/screening/ShareScreening.tsx`
- Pass `candidate_source` (the `source` field from the selected candidate) in the request body to `generate-screening-invite`
- Both the `generateLink` call (line 92-113) and the `sendEmail` call (line 145-166) need this field added

#### 2. `supabase/functions/generate-screening-invite/index.ts`
- Accept new param `candidate_source` (default: `"resume_screening"`)
- Replace the single `resume_analyses` lookup with a multi-table lookup:
  - If `candidate_source === "linkedin_leads"`: query `linkedin_leads` table, map `contact_email` to `email`, and `candidate_name` to `name`
  - Otherwise: query `resume_analyses` as before
- Normalize the candidate object so the rest of the function works regardless of source
- For LinkedIn leads, the `screening_status` update on `resume_analyses` (line 456-459) should be skipped since the candidate isn't in that table

### Technical Details

| File | Change |
|------|--------|
| `src/components/screening/ShareScreening.tsx` | Add `candidate_source: selectedCandidate.source` to both function invoke bodies |
| `supabase/functions/generate-screening-invite/index.ts` | Accept `candidate_source`, add conditional table lookup, skip `resume_analyses` status update for non-resume candidates |

**No database changes needed.**
