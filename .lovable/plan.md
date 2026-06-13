# Phase 6 + Phase 7 Final Verification Plan

## Findings from exploration (read-only)

**🔴 Blocking issue found:** the `signal_reviews` migration file exists at `supabase/migrations/20260613130000_phase6_signal_reviews.sql` but the table is **not present in the database**.
- `psql \dt public.signal_reviews` → "Did not find any relation".
- Browser console shows repeated `PGRST205 Could not find the table 'public.signal_reviews'` errors on `/signals` from `fetchSignalReviews`.
- Consequence: none of the Phase 6 review actions (reviewed / saved / ignored / actioned) are currently persisting in the preview environment.

**🟢 Frontend wiring looks correct** (no code changes needed):
- `SignalFeed.tsx` bulk actions all dispatch via `chat:send` only — `rank`, `draft_comment`, `draft_dm`, `create_outreach`, plus content-draft follow-ups (`find_engagement`, `draft_comments`). No direct send/post code paths.
- `useSignalReviews` performs optimistic update + rollback on failure — once the table exists, persistence will work end-to-end without code edits.
- Phase 7 orchestration (Scribe / Scout / Aria, `contentEngagementLoop`, `workflowClassifier`, `providerRouting`) is present in `supabase/functions/`. No verification of actual model output is possible without running prompts through the live chat.

## Plan

### Step 1 — Apply the pending migration
Run `supabase/migrations/20260613130000_phase6_signal_reviews.sql` against the database. The file already includes:
- `signal_reviews` table with status check constraint
- GRANTs to `authenticated` + `service_role`
- RLS enabled, workspace-scoped policies pinned to `auth.uid()`
- Partial unique indexes per signal / per lead candidate
- `updated_at` trigger

No edits to the SQL needed.

### Step 2 — Re-verify in the database
- `select to_regclass('public.signal_reviews')` → expect non-null.
- Confirm RLS is enabled and 4 policies are present.

### Step 3 — Re-verify in the preview
- Reload `/signals`; confirm console no longer logs `PGRST205`.
- Spot-check single-signal `Save`, `Mark reviewed`, `Ignore` and bulk equivalents — each should toggle without rollback.

### Step 4 — Frontend typecheck/build
- Run the project build (Lovable harness) and report any TS errors.

### Step 5 — Phase 7 flow verification (manual prompts, documentation only)
Phase 7 happy-paths require live model calls; I will **not** execute them automatically. The plan documents the expected behavior so you can run them in chat:
1. *"Write a LinkedIn post about what we shipped this week."* → Scribe only, Claude preferred, `saved_outputs` row of type `content_draft`, no Apify.
2. *"Write a founder LinkedIn post about AI GTM agents, then find 5 posts I should comment on."* → Scribe → Scout → Aria → Scribe comments, ≤5 LinkedIn results, draft-only.
3. *"Write a post and automatically comment on 50 LinkedIn posts."* → refusal or draft-only counter-offer.

I will grep the orchestration code to confirm no `auto-post`, `auto-send`, `auto_comment`, or autonomous publishing primitives exist before reporting.

### Step 6 — Final report
Will include:
- Phase 6 status (after migration applied)
- Phase 7 code-level safety audit
- Build/typecheck result
- Production-deploy go/no-go recommendation
- Any remaining UI polish issues

## What I will NOT do
- No new features.
- No schema changes beyond running the already-written Phase 6 migration.
- No production deploy.
- No edits to edge functions or frontend code unless the build surfaces a real error.
