

# Screening Pilot — Full Software Audit Report

---

## 1. ARCHITECTURE OVERVIEW

The application is a **recruitment SaaS platform** built with React + Vite + Tailwind CSS, connected to an external Supabase project (`zbwsbnqqpkvdhqwavjke`). It has 15 edge functions, ~30 pages, and integrates with external n8n webhooks for lead scraping and deep search.

---

## 2. WHAT IS WORKING

### Authentication & Core Infrastructure
- **Auth flow** (signup/login/logout via Supabase Auth) — functional
- **Protected routes** with `ProtectedRoute` wrapper — functional
- **Profile fetching** from `profiles` table on login — functional
- **Theme system** (light/dark toggle) — functional
- **Sidebar navigation** renders correctly for Recruit, Source, Engage, Analyze groups

### Job Screening Module (Core Feature)
- **Create Screening Job** (`/screening-jobs`) — functional, creates jobs with slug, stores in `screening_jobs` table
- **Screening link generation** (public `/apply/:slug` route) — functional
- **Candidate landing page** (`JobLandingStep`) — functional
- **Resume upload to Supabase Storage** (`screening-resumes` bucket) — functional
- **Resume parsing** (`parse-resume` edge function) — recently fixed, uses Gemini AI with base64 inline data for PDFs
- **Duplicate application detection** by email — functional
- **AI Screening Chat** (`screen-candidate` edge function) — functional with question generation, answer evaluation, and final scoring
- **Applicant review dashboard** (`/screening-jobs/:jobId`) — functional with fit categories, detail modal, Q&A review

### Dashboard
- **Dashboard metrics** from `resume_analyses` table — functional (shows totals, averages, weekly trends)
- **Recent candidates list** — functional

### Interview Scheduler
- **Schedule interviews** with calendar view — functional
- **Interview CRUD** (create, cancel, update notes) — functional via `useInterviews` hook
- **Email invites** via `send-interview-invite` edge function — functional

### Email Sequences
- **View/manage scheduled email sequences** from `scheduled_emails` table — functional
- **Email tracking** (opens/clicks) via `email-tracking` edge function — functional

### ICP Intelligence
- **Session management** (create/delete ICP sessions) — functional
- **Results viewing** — functional from `icp_lookalike_sessions` and `candidate_profiles` tables

### Expert Marketplace
- **UI prototype** with mock data — functional (Expert Directory, Booking Workflow, Interview Hub, Company Review Panel)
- **No backend** — intentionally UI-only prototype

---

## 3. WHAT IS BROKEN OR HAS ISSUES

### Critical Issues

**3.1. Broken Sidebar Navigation Links (Routes Don't Exist)**
The sidebar contains navigation groups whose routes are **commented out** in `App.tsx` but still appear in the sidebar:
- **Verify** section: `/verify`, `/verify/results` — routes commented out (lines 232-233)
- **Expert Interviews** section: `/interviews`, `/interviews/marketplace`, `/interviews/scheduled`, `/interviews/completed`, `/interviews/reports` — routes commented out (lines 235-239)
- **Interviewer Portal** section: `/portal/assignments`, `/portal/submit`, `/portal/earnings`, `/portal/profile` — routes commented out (lines 241-244)

Clicking any of these links shows the 404 page. Console confirms: `404 Error: User attempted to access non-existent route: /portal/submit`

**3.2. `screen-candidate` Edge Function — Incomplete CORS Headers**
The `screen-candidate` function uses old CORS headers missing the Supabase client platform headers:
```
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
```
Should include: `x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version`

This can cause CORS preflight failures on some browsers/versions during the screening chat step.

**3.3. `screening-resumes` Storage Bucket is Private — No Public Access for Candidates**
The bucket is private (not public). Candidates uploading resumes via the public `/apply/:slug` route are **unauthenticated**. The upload `supabase.storage.from('screening-resumes').upload(...)` will fail with a 403 unless there's an RLS policy allowing anonymous uploads. Currently there's no evidence of such a policy.

**3.4. Stale Auth Session — "Invalid Refresh Token" Errors**
Console shows repeated `AuthApiError: Invalid Refresh Token: Refresh Token Not Found`. The auth provider doesn't handle this gracefully — it should catch this error and force sign-out/redirect to login instead of leaving the user in a broken state.

### Medium Issues

**3.5. Lead Scraper & Deep Search — External n8n Dependency**
Both features depend on external n8n webhooks (`n8n.prasidha.me`):
- Lead Scraper: `https://n8n.prasidha.me/webhook/4e7f4a2b-...`
- Deep Search: `https://n8n.prasidha.me/webhook/21eba91f-...`
- Resume Upload (legacy): `https://n8n.prasidha.me/webhook/4406aa6a-...`

If this n8n instance is down or the webhooks are deactivated, these features silently fail. There's no health check or fallback.

**3.6. Growth Signals — TypeScript Type Casting Workaround**
`GrowthSignals.tsx` line 27: `.from("growth_signal_companies" as any)` — indicates the table may not be in the generated types file, meaning it could have been added manually or the types are stale.

**3.7. Settings Route Doesn't Exist**
Sidebar has a "Settings" button that navigates to `/settings` — no such route exists in `App.tsx`. Will show 404.

**3.8. InterviewSettings Page Exists But Has No Route**
`src/pages/InterviewSettings.tsx` exists as a file but is never imported or routed in `App.tsx`.

**3.9. Dashboard Queries `resume_analyses` Table — Not in Schema**
The Dashboard page queries `resume_analyses` table, but this table is not listed in the provided database schema. It either doesn't exist (causing silent empty data) or was added outside migration tracking.

**3.10. `screening_applications` Insert — Missing `user_id` / RLS Concerns**
When candidates create applications via the public route, the insert `{ job_id: job.id }` has no `user_id` since candidates aren't authenticated. The RLS policy on `screening_applications` must allow anonymous inserts — this needs verification.

### Minor Issues

**3.11. Candidates Page Shows Legacy ModernDashboard**
`/candidates` just renders `<ModernDashboard />` which is the old resume analysis dashboard. The naming is confusing and doesn't match the current screening-centric architecture.

**3.12. `generate-screening-questions` Uses Non-Existent Model**
Line 117: `model: 'google/gemini-3-flash-preview'` — this model may not exist on the Lovable AI gateway, while other functions use `google/gemini-2.5-flash`.

**3.13. Job Distribution — UI Only**
The Job Distribution page creates records in `job_distribution_status` but has no actual integration with LinkedIn, Indeed, or Wellfound APIs. It's a tracking UI without real posting functionality.

**3.14. Collaboration Hub Not Routed**
Collaboration components exist (`src/components/collaboration/`) but there's no route to access them from the sidebar or App.tsx.

**3.15. Google Calendar OAuth — Credentials Named Incorrectly**
Secrets are named `CLEINT_ID` and `CLEINT_SECERT_CALENDER` (typos of "CLIENT"). They'll work as long as the edge functions reference the same misspelled names, but it's error-prone.

---

## 4. SUMMARY TABLE

| Module | Status | Notes |
|--------|--------|-------|
| Auth/Login | ✅ Working | Stale refresh token not handled gracefully |
| Dashboard | ⚠️ Partial | Depends on `resume_analyses` table (may be empty) |
| Job Screening (Create) | ✅ Working | Full flow functional |
| Resume Upload & Parse | ⚠️ Risk | Storage bucket RLS may block unauthenticated uploads |
| AI Screening Chat | ⚠️ Risk | CORS headers incomplete on `screen-candidate` |
| Applicant Review | ✅ Working | Fit categories, scores, Q&A all display |
| Interview Scheduler | ✅ Working | Calendar, scheduling, email invites |
| Email Sequences | ✅ Working | View, manage, tracking |
| ICP Intelligence | ✅ Working | Session management, results |
| Lead Scraper | ⚠️ External | Depends on n8n webhooks |
| Deep Search | ⚠️ External | Depends on n8n webhooks |
| Growth Signals | ✅ Working | Type casting workaround |
| Job Distribution | ⚠️ UI Only | No real job board integrations |
| Expert Marketplace | ✅ UI Only | Mock data prototype |
| Verify section | ❌ Broken | Routes commented out, sidebar links lead to 404 |
| Expert Interviews section | ❌ Broken | Routes commented out, sidebar links lead to 404 |
| Interviewer Portal | ❌ Broken | Routes commented out, sidebar links lead to 404 |
| Settings | ❌ Broken | No route exists |
| Collaboration Hub | ❌ Hidden | Components exist but no route |

---

## 5. RECOMMENDED FIX PRIORITY

1. **Remove or hide broken sidebar links** (Verify, Expert Interviews, Interviewer Portal, Settings) — immediate, causes 404 errors
2. **Fix `screen-candidate` CORS headers** — could break the screening flow for candidates
3. **Verify `screening-resumes` bucket allows unauthenticated uploads** — could block the entire candidate application flow
4. **Handle stale refresh tokens** in `useAuth` — sign out user gracefully instead of leaving broken state
5. **Fix `generate-screening-questions` model name** — `gemini-3-flash-preview` may not exist
6. **Wire up InterviewSettings page** to a route or remove it

