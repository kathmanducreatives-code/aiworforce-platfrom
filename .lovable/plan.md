

## Phase 4: Email Notifications for Screening

Add automated email notifications to the screening system so recruiters are alerted when candidates complete applications, and candidates receive confirmation emails after submitting.

---

### What Gets Built

**1. Candidate Confirmation Email**
When a candidate completes the screening flow (Step 4 -- Thank You page), an email is sent to the candidate's extracted email address confirming their application was received.

**2. Recruiter Notification Email**
When a candidate completes screening and receives a match score, the recruiter (job owner) receives an email with:
- Candidate name and match category (Strong Fit, Good Fit, etc.)
- Match score percentage
- Top strengths summary
- Link to the applicant dashboard to review

**3. Status Change Email to Candidate**
When a recruiter updates a candidate's status (e.g., "Interview Scheduled" or "Rejected") from the Applicant Detail Modal, an optional email is sent to the candidate with the update.

---

### Implementation Details

**New Edge Function: `screening-notifications`**

Handles three notification types via an `action` field:

| Action | Trigger | Recipient |
|--------|---------|-----------|
| `candidate_confirmation` | Candidate completes screening | Candidate |
| `recruiter_new_application` | Screening completed with score | Recruiter (job owner) |
| `candidate_status_update` | Recruiter changes status | Candidate |

Uses the existing Resend API key (already configured) and follows the same email HTML pattern used by `send-interview-invite`.

**Edge function input:**

```text
{
  action: "candidate_confirmation" | "recruiter_new_application" | "candidate_status_update",
  application_id: string,
  // For status updates:
  new_status?: string,
  custom_message?: string
}
```

The edge function fetches the application and related job data from Supabase using the service role key, then constructs and sends the appropriate email via Resend.

---

### Frontend Changes

**1. `ScreeningChatStep.tsx`** -- After the `complete_screening` call succeeds, fire a request to `screening-notifications` with action `candidate_confirmation`.

**2. `ScreeningChatStep.tsx`** -- Also fire `recruiter_new_application` after completion so the recruiter gets notified.

**3. `ApplicantDetailModal.tsx`** -- Add a "Notify Candidate" checkbox (default checked) next to the status save button. When checked and status is changed, call `screening-notifications` with action `candidate_status_update`.

---

### Email Templates

**Candidate Confirmation:**
- Subject: "Application Received -- [Job Title]"
- Body: Thanks the candidate by name, confirms the position applied for, mentions they will hear back within 3-5 business days

**Recruiter New Application:**
- Subject: "New Applicant: [Candidate Name] -- [Match Category]"
- Body: Candidate name, match score with color-coded badge, top 3 strengths, link to `/screening-jobs/[jobId]`

**Candidate Status Update:**
- Subject: "Application Update -- [Job Title]"
- Body: Status-specific message (e.g., "We'd like to schedule an interview" for Interview Scheduled, "We've decided to move forward with other candidates" for Rejected)

---

### Files

**New:**
- `supabase/functions/screening-notifications/index.ts`

**Modified:**
- `src/components/apply/ScreeningChatStep.tsx` -- Add notification calls after screening completion
- `src/components/screening/ApplicantDetailModal.tsx` -- Add "Notify Candidate" checkbox on status change
- `supabase/config.toml` -- Register new edge function with `verify_jwt = false`

---

### Technical Notes

- Uses `RESEND_API_KEY` (already configured) and `SUPABASE_SERVICE_ROLE_KEY` (auto-available in edge functions)
- Sends from `onboarding@resend.dev` (Resend's default sandbox sender) consistent with existing email functions
- The recruiter notification email includes a direct link to the published app URL for the applicant dashboard
- No database changes required -- all notification state is fire-and-forget (no delivery tracking for screening emails)

---

### Implementation Order

1. Create `screening-notifications` edge function with all 3 email templates
2. Update `ScreeningChatStep.tsx` to trigger candidate + recruiter notifications on completion
3. Update `ApplicantDetailModal.tsx` to add notify checkbox on status change
4. Update `supabase/config.toml`
5. Deploy and test

