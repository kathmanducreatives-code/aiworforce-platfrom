

## Phase 1: Public Candidate Application Flow

Replace the existing behavioral screening with a job-specific screening system. This phase builds the candidate-facing experience: landing page, resume upload with AI extraction, conversational AI screening questions, and a thank-you page.

### What Gets Built

1. **Job Landing Page** -- When a candidate clicks a screening link (`/apply/:id`), they see the job title, company name, estimated completion time, and a "Start Application" button.

2. **Resume Upload Step** -- Drag-and-drop upload (PDF/DOCX, max 5MB) stored in Supabase Storage. AI extracts name, email, phone, work history, education, and skills. The candidate reviews and can edit the extracted info before proceeding.

3. **AI Conversational Questions** -- Chat-style interface where AI asks 3-5 personalized questions one at a time based on resume content + job requirements. Enforces minimum 50-character answers, tracks time per question, and detects tab switches.

4. **Thank You Page** -- Confirmation message after completion. No score shown to the candidate.

---

### Database Changes

**New table: `screening_jobs`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | uuid | Recruiter who created it |
| slug | text (unique) | URL slug for `/apply/:slug` |
| title | text | Job title |
| company_name | text | |
| description | text | Job description |
| required_years | integer | |
| required_skills | text[] | Tag array |
| education_requirement | text | None/High School/Bachelor's/Master's/PhD |
| salary_min | integer (nullable) | |
| salary_max | integer (nullable) | |
| custom_questions | jsonb | Optional recruiter-added questions |
| status | text | active/paused/closed |
| created_at | timestamptz | |

**New table: `screening_applications`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| job_id | uuid (FK -> screening_jobs) | |
| access_token | text (unique) | Session token |
| status | text | started/resume_uploaded/screening/completed |
| resume_url | text | Supabase Storage path |
| extracted_data | jsonb | AI-parsed resume data (name, email, skills, etc.) |
| candidate_edits | jsonb | Candidate corrections to extracted data |
| screening_answers | jsonb | Array of {question, answer, score, analysis, time_seconds} |
| tab_switches | integer | Count of tab focus losses |
| total_time_seconds | integer | |
| match_score | integer (nullable) | 0-100, filled after AI scoring |
| match_category | text (nullable) | strong_fit/good_fit/maybe/not_qualified |
| strengths | jsonb | |
| red_flags | jsonb | |
| interview_questions | jsonb | AI-generated interview prep |
| created_at | timestamptz | |
| completed_at | timestamptz (nullable) | |

**New storage bucket: `screening-resumes`** (private)

---

### New Edge Functions

**1. `parse-resume`**
- Accepts: file content (base64 or text extracted client-side) + job_id
- Uses Lovable AI (gemini-3-flash-preview) to extract structured data: name, email, phone, work history (company, title, dates, years), education, skills, certifications
- Returns structured JSON via tool calling
- Saves extracted_data to screening_applications

**2. `screen-candidate`** (handles the conversational AI)
- Actions: `generate_questions`, `evaluate_answer`, `complete_screening`
- `generate_questions`: Takes extracted resume data + job requirements, generates 3-5 personalized questions using AI
- `evaluate_answer`: Scores each answer 1-10 with analysis text
- `complete_screening`: Calculates match score (0-100%), categorizes candidate, generates strengths/red_flags, creates interview questions

---

### Frontend Changes

**New page: `/apply/:slug`** (`src/pages/CandidateApply.tsx`)

Multi-step flow within a single page:

- **Step 1 - Landing**: Job title, company, "Complete this quick 3-minute screening" message, Start button
- **Step 2 - Resume Upload**: Drag-and-drop area (PDF/DOCX), loading spinner during AI parsing, editable extracted info display
- **Step 3 - AI Questions**: Chat-style interface, one question at a time, progress bar, 50-char minimum enforcement, tab-switch detection via `visibilitychange` event
- **Step 4 - Thank You**: Completion confirmation, "hear back in 3-5 business days"

**New components:**
- `src/components/apply/JobLandingStep.tsx`
- `src/components/apply/ResumeUploadStep.tsx`
- `src/components/apply/ScreeningChatStep.tsx`
- `src/components/apply/ThankYouStep.tsx`

**Route update in `App.tsx`:**
- Add `<Route path="/apply/:slug" element={<CandidateApply />} />` as a public route

**Existing routes preserved:**
- `/behavioral-screening` and `/screening/:token` routes remain functional during migration but will be replaced by the new system in a subsequent phase

---

### Technical Details

**Resume parsing approach:**
- Client-side: Use FileReader to read PDF/DOCX as base64
- Send to `parse-resume` edge function
- Edge function sends text to Gemini via tool calling to extract structured fields
- Return JSON with extracted data for candidate review

**Tab-switch detection:**
```
document.addEventListener('visibilitychange', () => {
  if (document.hidden) tabSwitchCount++;
});
```

**Answer time tracking:**
- Record timestamp when question appears
- Calculate delta when answer is submitted
- Store per-question in screening_answers JSONB

**Match score algorithm (in `screen-candidate` edge function):**
- Requirements check: experience years, skills overlap, education match, salary alignment
- Answer quality: average score from AI evaluation
- Base score = (requirements met / total) * 100
- Bonus/penalty from answer quality
- Categorize: 80+% = Strong Fit, 60-79% = Good Fit, 40-59% = Maybe, below 40% = Not Qualified

---

### Implementation Order

1. Database migration (screening_jobs, screening_applications, storage bucket)
2. `parse-resume` edge function
3. `screen-candidate` edge function
4. CandidateApply page with all 4 steps
5. Route registration in App.tsx
6. Test end-to-end flow

---

### What Comes Next (Phase 2)

After this phase is approved and working:
- Recruiter page to create job screening links
- Recruiter dashboard with candidate cards, filters, match scores
- Detailed candidate view with Q&A analysis, match breakdown, AI interview questions
- Status management and notes

