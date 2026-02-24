

## Fix Email Templates + Data Isolation for New Users

There are two separate issues to address: customizing Supabase auth emails, and ensuring each user only sees their own data.

---

### Part 1: Customize Auth Email Templates (Supabase Dashboard)

Supabase auth emails (confirmation, password reset, etc.) are **not controlled by code** -- they're configured directly in your Supabase Dashboard. Here's what you need to do:

1. Go to your Supabase Dashboard > **Authentication** > **Email Templates**
2. You'll see tabs for each email type:
   - **Confirm signup** -- the verification email new users receive
   - **Magic Link** -- passwordless login emails
   - **Change Email Address**
   - **Reset Password**
3. Edit the HTML template for each to match your brand (add your logo, colors, custom copy)
4. The `{{ .ConfirmationURL }}` variable inserts the verification link automatically

Example branded confirmation email:
```text
<div style="font-family: 'Work Sans', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; background: #ffffff; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #1a1a2e; font-size: 24px; margin: 0;">Welcome to Screening Pilot</h1>
    <p style="color: #6b7280; font-size: 14px;">AI-Powered Recruitment Intelligence</p>
  </div>
  <p style="color: #374151; font-size: 15px; line-height: 1.6;">
    Thanks for signing up! Click the button below to verify your email and get started.
  </p>
  <div style="text-align: center; margin: 32px 0;">
    <a href="{{ .ConfirmationURL }}" style="background: #3ecf8e; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
      Verify Email Address
    </a>
  </div>
  <p style="color: #9ca3af; font-size: 12px; text-align: center;">
    If you didn't create an account, you can safely ignore this email.
  </p>
</div>
```

---

### Part 2: Data Isolation -- Each User Sees Only Their Own Data

**The core problem**: The `resume_analyses` table (the main data source for the dashboard) has **no `user_id` column**. Its RLS policies use `USING (true)`, meaning every authenticated user sees every other user's candidates. The same issue applies to `scheduled_emails`.

#### Database Changes (Migration)

**Step 1**: Add `user_id` column to `resume_analyses`
```sql
ALTER TABLE public.resume_analyses
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Assign existing records to a default user (or leave NULL)
-- New records will require user_id

-- Drop old permissive policies
DROP POLICY IF EXISTS "Authenticated users can view resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can insert resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can update resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can delete resume analyses" ON public.resume_analyses;

-- Create user-scoped policies
CREATE POLICY "Users can view own resume analyses"
  ON public.resume_analyses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own resume analyses"
  ON public.resume_analyses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own resume analyses"
  ON public.resume_analyses FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own resume analyses"
  ON public.resume_analyses FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
```

**Step 2**: Add `user_id` column to `scheduled_emails`
```sql
ALTER TABLE public.scheduled_emails
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Similar RLS policies scoped to user_id
```

#### Code Changes

| File | Change |
|---|---|
| `src/pages/Dashboard.tsx` | Add `useAuth()` to get user, pass `user_id` filter to `resume_analyses` query |
| `src/components/ModernDashboard.tsx` | Filter `resume_analyses` queries by `auth.uid()` (handled automatically by RLS, but also set `user_id` on inserts) |
| `src/components/dashboard/WeeklyActivityChart.tsx` | No code change needed -- RLS will automatically filter results |
| `src/components/ResumeUpload.tsx` (or wherever resumes are saved) | Include `user_id: session.user.id` when inserting into `resume_analyses` |
| Edge functions (`saveResumeAnalysis`, `screen-candidate`) | Include `user_id` from the auth context when inserting records |

#### How It Works After the Fix

- New user signs up and verifies email with your branded template
- They log in and land on `/dashboard`
- Dashboard queries `resume_analyses` -- RLS automatically filters to only their records
- A brand new user sees **zero candidates, zero activity** -- a clean slate
- When they upload resumes, their `user_id` is attached to each record
- They never see another user's data

---

### Summary of All Changes

| Area | What | How |
|---|---|---|
| Email templates | Branded signup/reset emails | Edit in Supabase Dashboard > Auth > Email Templates |
| `resume_analyses` table | Add `user_id` column + user-scoped RLS | Database migration |
| `scheduled_emails` table | Add `user_id` column + user-scoped RLS | Database migration |
| Dashboard code | Set `user_id` on all inserts | Code changes in upload/save flows |
| Edge functions | Pass `user_id` from auth header | Update `saveResumeAnalysis` and `screen-candidate` |

