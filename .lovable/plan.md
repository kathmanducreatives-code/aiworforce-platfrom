# Continue Onboarding Rebuild — Implementation Plan

Picks up from completed infra (OnboardingGate, schema extensions, Auth/ResetPassword, `recommend.ts`, context builder). Focus is now UI + readiness + dashboard wiring.

## 1. Rebuild the wizard into the 12-step flow

File: `src/pages/OnboardingCompanyBrain.tsx` (replace the current 10-step `STEPS` array and render branch with a clean 12-step model).

New steps:

```
1.  welcome
2.  founder           (name, role, LinkedIn, timezone, first_help_goal)
3.  company           (name, website, linkedin, description, stage, team_size, location)
4.  analyzing         (Hawk + Pilot only; existing AI analysis pipeline reused)
5.  icp               (buyer roles, sizes, industries, geo, pains, disqualifiers ← new)
6.  gtm               (motion, primary_channel, preferred_channels, bottleneck, tools, 30-day goal)
7.  positioning       (promise, differentiators, use cases, proof, offer, pricing, avoid)
8.  voice             (tone, tags, style rules, avoid, example_message)
9.  workflow_prefs    (priority_workflows — chooses 1-3 from `recommendFor(brain)` top picks)
10. integrations      (readiness check; per-provider status from new edge fn)
11. approval          (draft_only, email_requires_approval, linkedin_manual_only, daily_credit_limit)
12. review_launch     (summary + completeness ring + "Activate Company Brain" CTA)
```

Behaviour:
- Each step persists via existing `setup-company-brain` action `save_structured` (already passes through new keys thanks to `mergeProfile`).
- `onboarding_meta.current_step` + `completed_steps` updated on every Next so users resume in place when they reload.
- "Skip for now" allowed only on `gtm`, `positioning`, `voice`, `workflow_prefs`, `integrations` — never on founder/company/icp/approval/review.
- Final step calls `save_basics` with `{ onboarding_completed: true }` then routes to `/workflows?firstRun=1`.
- Premium chrome reused (BackgroundGrid, ProgressRail extended to 12, AgentChipsRow, StepShell). No legacy 10-step code left.

## 2. Integration readiness

New edge function `supabase/functions/integration-readiness/index.ts`:
- JWT-verified, workspace-scoped.
- Returns `{ providers: { apify: {status,label,reason?}, firecrawl:{}, lovable_ai:{}, resend:{}, openai:{}, anthropic:{}, google_ai:{} } }`.
- Status derived purely from presence of secrets (`Deno.env.get`) + the `APIFY_ENABLE_PEOPLE_SEARCH` flag. No secret values returned.
- Writes the same map into `company_brain.profile.integration_status` via service role so agents can read it.

New hook `src/hooks/useIntegrationReadiness.ts`:
- Calls the function once per workspace, caches in React state + 60s memo.
- Exposes `{ providers, loading, refresh, summary: { connected, setup_needed, optional } }`.

Used in:
- Step 10 of the wizard (with explicit "Recheck" button — no auto-poll).
- `Workflows.tsx` to surface a small "Setup needed" badge on cards whose `requires` aren't satisfied (read-only; does not change run logic).

## 3. Workflow recommendations in UI

`src/pages/Workflows.tsx`:
- Replace the current `recommended` memo with `recommendFor(brain).slice(0,4)` (using `useCompanyBrain()`).
- Section title becomes "Recommended for your company" with a one-line reason chip pulled from `recommendFor` result (e.g. "Matches your goal: find leads").
- Falls back to current `w.recommended` list when brain is empty (defensive).

Wizard Step 9 (`workflow_prefs`):
- Renders the top 6 from `recommendFor(brain)` as toggleable cards.
- Stores chosen IDs in `workflow_preferences.priority_workflows`.

## 4. First safe workflow

After `review_launch` completes, before navigating away:
- Call `pilotChat` with a synthetic prompt built from `workflow_preferences.priority_workflows[0]` (or top recommended).
- Force inputs: `count: 5`, `draft_only: true` — wired through the workflow's `buildMetadata` override.
- Toast: "Your first workflow is drafting 5 results. Nothing is sent." Then route to `/dashboard` with `state.firstRun = true`.
- No emails, DMs, or comments. Pure drafts.

## 5. Dashboard first-run cleanup

`src/pages/Dashboard.tsx` + `WorkflowTimeline`:
- When `timeline.length === 0` and brain is fresh, render real empty-state component (already exists per design standard) instead of mock activity.
- Show `CompanyBrainStrip` only when `!brainComplete` (already does — verified).
- When `location.state.firstRun`, render a top "Welcome to Agentory" banner pointing to the just-dispatched workflow run.

## 6. Tests / validation

- Extend `src/lib/workflows/recommend.test.ts` with cases that include `workflow_preferences.priority_workflows`.
- Add `src/pages/__tests__/onboardingFlow.test.ts` (logic-only): step order, gating predicate, completeness on final step.
- Run `bunx vitest run` and `npx tsgo --noEmit`.

## 7. Files

Create: `supabase/functions/integration-readiness/index.ts`, `src/hooks/useIntegrationReadiness.ts`, `src/pages/__tests__/onboardingFlow.test.ts`.
Edit: `src/pages/OnboardingCompanyBrain.tsx` (large rewrite of step model + render), `src/pages/Workflows.tsx`, `src/pages/Dashboard.tsx`, `src/components/workforce/WorkflowTimeline.tsx` (empty state), `src/lib/workflows/recommend.test.ts`.
No DB migrations. No changes to chat/Workbench/agent logic. No auto-send anywhere.

## 8. Out of scope

- Landing page.
- DB schema migrations.
- Provider OAuth flows (only readiness reporting).
- Touching agent runtime / capability registry.
