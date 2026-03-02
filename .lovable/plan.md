

## Fix: parse-resume Edge Function Mismatch

### Root Cause
The frontend (`ResumeUploadStep.tsx`) sends `{ file_content_base64, file_name, file_path, job_id }` but the edge function expects `{ file_content, file_name, application_id }` and tries to update a `screening_applications` row that doesn't exist yet (it's created *after* parsing completes in `CandidateApply.tsx`).

Additionally, the CORS headers are missing required Supabase client headers, which can cause preflight failures.

### Changes

**1. `supabase/functions/parse-resume/index.ts`** — Rewrite to match frontend contract:
- Accept `file_content_base64` (base64-encoded PDF/DOCX) instead of `file_content`
- Decode base64 to extract text for AI parsing
- Remove the `screening_applications` update (the parent component handles this after parsing)
- Accept `job_id` instead of `application_id` (for logging only)
- Update CORS headers to include all required Supabase client headers
- Return `{ success: true, extracted_data }` as the frontend expects

**2. No frontend changes needed** — `ResumeUploadStep.tsx` and `CandidateApply.tsx` already have the correct flow: parse resume → create application → save extracted data.

### Technical Detail
The base64 content from a PDF is binary, so the edge function will decode it to a string representation for the AI. For PDFs, raw base64→text won't produce readable content, so the function will pass the base64 to the AI model with instructions to handle it, or we extract text client-side. Given the current flow sends base64, we'll decode to a best-effort text string and let Gemini handle extraction (Gemini can process base64 document content when properly formatted).

