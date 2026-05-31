# Company Brain Onboarding Flow

A guided 5-step setup that runs after signup so every workspace has structured context that Pilot and all agents consume. Nothing existing is removed: Pilot, ChatWorkspace, WorkspaceContext, aiProvider, orchestrate, run-agent, toolRegistry, task_plans, tasks, activity_feed, approvals, and agents stay as-is.

## Database (migration)

Existing `company_brain` is `(workspace_id, profile jsonb, updated_at)`. Extend it without breaking:

```sql
ALTER TABLE public.company_brain
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
```

All structured fields (company_name, company_summary, website_url, linkedin_company_url, founder_linkedin_url, target_customer_profile, target_candidate_profile, offer_summary, brand_voice, outreach_style, do_not_say, avoid_targets, competitors, approved_sources, active_goals, agent_instructions, pilot_followup_qa) live inside the existing `profile` JSONB so we don't fight the current shape.

New table `workspace_sources`:

```sql
CREATE TABLE public.workspace_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_type text NOT NULL,   -- website|linkedin_company|founder_linkedin|careers_page|competitor|case_study|booking|document|other
  url text NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'pending',
  extracted_summary text,
  last_checked_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_sources TO authenticated;
GRANT ALL ON public.workspace_sources TO service_role;

ALTER TABLE public.workspace_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members manage workspace sources"
  ON public.workspace_sources FOR ALL TO authenticated
  USING (has_workspace_access(auth.uid(), workspace_id))
  WITH CHECK (has_workspace_access(auth.uid(), workspace_id));
```

## Backend — new edge function `setup-company-brain`

`supabase/functions/setup-company-brain/index.ts`. Auth via JWT, verifies workspace membership via `has_workspace_access`. Actions (selected by `action` field):

- `save_basics` — persist Step 1 fields into `company_brain.profile`.
- `save_sources` — upsert URLs into `workspace_sources`.
- `analyze` — Step 3: call `aiProvider` (Lovable AI Gateway) with the provided basics + sources to draft `company_summary`, `target_customer_profile`, `offer_summary`, `brand_voice`, `competitors`, `agent_instructions`. If `isToolConfigured('scrape_url')` or `research_web` is ready, optionally enrich via `runTool` from `toolRegistry`; otherwise return `{enriched:false, reason:"connectors_missing"}` and proceed with manual data only. No hallucinated facts — prompt instructs the model to leave fields empty when unknown.
- `generate_followups` — return 3–5 Pilot follow-up questions generated from current profile.
- `save_followups` — store answers under `profile.pilot_followup_qa`.
- `finalize` — merge everything into `company_brain.profile`, set `onboarding_completed=true`, `onboarding_completed_at=now()`, write an `activity_feed` "onboarding_completed" entry (non-blocking).

All AI/tool calls server-side only; never exposes keys. Wraps every external call in try/catch so failures don't block onboarding.

## Frontend — onboarding flow

New route `/onboarding/company-brain` (added in `src/App.tsx`, protected). Page `src/pages/OnboardingCompanyBrain.tsx` containing a stepper with 5 steps:

1. **Company Basics** — form for company_name, website_url, linkedin_company_url, founder_linkedin_url (optional), short_description, current_primary_goal (radio: leads/hiring/competitors/outreach/content/other).
2. **Sources & References** — dynamic list of URL inputs grouped by source_type; all optional.
3. **AI Company Understanding** — calls `setup-company-brain { action:"analyze" }`, shows draft profile fields user can edit. If connectors missing, shows yellow notice: "Live enrichment requires Perplexity or Firecrawl. You can still complete setup manually." Retry button.
4. **Pilot Follow-up Questions** — fetches via `generate_followups`, renders 3–5 textareas, saves via `save_followups`.
5. **Success** — copy "Your AI workforce is ready" with per-agent lines (Scout/Aria/Penn/Hawk/Scribe) and quick action buttons (Brief me on today / Find leads like my ICP / Analyze competitors / Draft outreach / Create a hiring plan). Each navigates to `/dashboard` and prefills the ChatWorkspace composer via a new lightweight event/context hook (`window.dispatchEvent(new CustomEvent('pilot:prefill', { detail: prompt }))` already-compatible pattern; ChatWorkspace will subscribe).

### Onboarding gating

New hook `useCompanyBrain()` reads `company_brain` for current workspace. Update `MainLayout` (or `Dashboard`) to:
- If `!loading && workspaceId && !brain.onboarding_completed` and route is not `/onboarding/*`, render a non-blocking dashboard banner "Complete Company Brain Setup" linking to `/onboarding/company-brain`.
- After fresh signup (`Auth.tsx` success handler), `navigate('/onboarding/company-brain')` instead of `/dashboard`.
- User can click "Skip for now" to land on dashboard; banner persists until completed.

## Agent context injection

Add `supabase/functions/_shared/companyBrain.ts` exporting `loadCompanyBrainContext(admin, workspace_id)` that returns a compact text block (company summary, ICP, brand voice, outreach style, do_not_say, competitors, agent_instructions, active goals). Wire it into:

- `pilot-chat/index.ts` — prepend to system prompt.
- `orchestrate/index.ts` — include in planner prompt so intent expansion respects ICP & goals.
- `run-agent/index.ts` — inject into each agent's per-run system prompt; agent-specific slices already exist conceptually (Scout→ICP, Aria→ranking, Penn→tone/outreach_style/do_not_say, Hawk→competitors, Scribe→brand_voice). One helper, agent-aware via `agent_slug`.

No prompt rewrites beyond this prefix; the existing orchestrator logic stays.

## Safety

- All RLS preserved; new policies workspace-scoped.
- AI/tool failures caught and surfaced as warnings, never block save.
- No API keys in frontend; `setup-company-brain` is the only path.
- No changes to backend project, no disabling of RLS.

## Files

New:
- `supabase/migrations/<ts>_company_brain_onboarding.sql`
- `supabase/functions/setup-company-brain/index.ts`
- `supabase/functions/_shared/companyBrain.ts`
- `src/pages/OnboardingCompanyBrain.tsx`
- `src/components/onboarding/StepBasics.tsx`, `StepSources.tsx`, `StepAnalyze.tsx`, `StepFollowups.tsx`, `StepSuccess.tsx`
- `src/hooks/useCompanyBrain.ts`

Edited:
- `src/App.tsx` — add `/onboarding/company-brain` route
- `src/pages/Auth.tsx` — post-signup redirect
- `src/pages/Dashboard.tsx` — onboarding reminder banner
- `src/components/ChatWorkspace*.tsx` — listen for `pilot:prefill` event
- `supabase/functions/pilot-chat/index.ts`, `orchestrate/index.ts`, `run-agent/index.ts` — inject Company Brain

## Verification

1. New signup → redirected to `/onboarding/company-brain`.
2. Fill basics + sources → rows in `company_brain.profile` and `workspace_sources`.
3. Step 3 analyze → returns draft fields; with no Perplexity/Firecrawl shows warning, still proceeds.
4. Step 4 → 3–5 questions generated, answers saved under `profile.pilot_followup_qa`.
5. Step 5 finalize → `onboarding_completed=true`, dashboard loads without banner.
6. Pilot "Find leads for my company" → orchestrator plan reflects saved ICP.
7. Pilot "Draft outreach" → Penn step uses saved brand voice / outreach style / do_not_say.
