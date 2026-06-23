
# Agentory — Onboarding & First-Run Rebuild

Implementation plan. Scope: auth gating, mandatory onboarding wizard rebuild, Company Brain schema extension (JSONB-only, no migration), brain-aware first-run, Workflows personalization, integration readiness, tests. Out of scope: landing page, DB migrations, auto-send of any kind.

---

## 1. Routing gate (P0)

**New component:** `src/components/OnboardingGate.tsx`
- Reads `useAuth()` + `useCompanyBrain()`.
- While `wsLoading || brainLoading`: render a centered spinner (reuse `WorkspaceGate` styling).
- If `!user`: `<Navigate to="/auth" replace />`.
- If onboarding incomplete AND current path is not in `ALLOWED_PRE_ONBOARDING = ['/onboarding/company-brain', '/settings/integrations', '/auth']`: `<Navigate to="/onboarding/company-brain" replace />` (preserves intended path in state for post-onboarding bounce).
- Else: render children.

**`src/App.tsx`**
- Wrap every `<MainLayout>` route's children in `<OnboardingGate>`.
- Keep `/onboarding/company-brain` protected but NOT gated (so it can render itself).
- Mount `WorkspaceGate` inside `MainLayout` (currently dead — fix per audit).

**`src/pages/Auth.tsx`**
- After `signUp` success: navigate to `/onboarding/company-brain`.
- After `signInWithPassword` success: query `company_brain.onboarding_completed`; redirect to `/onboarding/company-brain` if false, else `/dashboard`.
- `onAuthStateChange` listener: same brain-aware redirect (don't blindly send to dashboard).
- Premium copy: headline "Build your AI workforce", subcopy "Create your workspace, teach Agentory about your company, and run your first AI workflow."

## 2. Auth additions (P0/P1)

- **Password reset:**
  - Add "Forgot password?" link on `/auth`.
  - New `ForgotPasswordDialog` (inline on /auth) → `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` })`.
  - New page `src/pages/ResetPassword.tsx` (public route). Detects `type=recovery` in URL hash, shows new-password form, calls `supabase.auth.updateUser({ password })`, then redirects per brain status.
  - Route `/reset-password` added to `App.tsx`.
- **Email-verification UX:** if `signUp` returns a user without a session, show a "Check your email" panel inline (no auto-redirect to dashboard). Detect on `/auth` mount if URL has `?confirmed=1` and show success toast.
- **Google sign-in:** add "Continue with Google" button using `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin })` per Cloud defaults. If the lovable module isn't generated, fall back to hiding the button (feature flag `VITE_ENABLE_GOOGLE_AUTH`). Will request `supabase--configure_social_auth(providers:["google"])` during build.

## 3. Onboarding wizard rebuild

**File:** rewrite `src/pages/OnboardingCompanyBrain.tsx` cleanly. Keep route, keep edge function `setup-company-brain`, extend its `save_structured` to accept the new shape (additive only, never overwrite existing keys).

**12 steps** (matches user spec):
1. Founder · name, role, linkedin_url, timezone, first_help_goal
2. Company · name, website_url, linkedin_url, description, category, industry, stage, team_size, location
3. Analyze · honest progress — only two real lines: "Hawk is reading your website" → "Pilot is preparing your Company Brain". Skip cosmetic Scout/Aria/Penn/Scribe lines.
4. ICP · buyer_roles, industries, company_size, geography, pain_points, **disqualifiers** (new)
5. GTM · motion, primary_channel, preferred_channels[], biggest_bottleneck, current_tools[], thirty_day_goal
6. Positioning · offer, promise, differentiators[], use_cases[], proof_points[], pricing, competitors.known[], competitors.adjacent[], avoid_positioning[]
7. Brand voice · tone, tags[], style_rules[], avoid[], example_message
8. Workflow preferences · priority_workflows[] (1–3 from registry)
9. Integrations · readiness panel (see §6) — no secret values, status badges only
10. Safety · draft_only, email_requires_approval, linkedin_manual_only, daily_credit_limit; banner "Agentory will not send outreach without your approval."
11. Review · collapsible per-section editable summary + readiness score
12. First workflow · brain-aware recommended action; "Run first workflow" or "Skip to dashboard"

**Design:** premium dark, no sidebar (already the case — onboarding renders without `MainLayout`). Small Agentory logo top-left, progress rail, autosave indicator ("Saved · 2s ago"), agent presence "Pilot is building your Company Brain". One-card-per-step.

**Save/resume:** persist on every step transition via `setup-company-brain` `save_structured`. Store resume marker in `profile.onboarding_meta = { current_step, completed_steps[], updated_at }` (JSONB, no migration). On mount, jump to `current_step` if present and not completed.

**Validation:** required fields per step gate the Next button; inline errors; no zod schema on edge (keep current loose merge), but add zod validation on the client form.

## 4. Company Brain schema extension

**`src/lib/companyBrainSchema.ts`** + **`supabase/functions/_shared/companyBrainSchema.ts`** (mirror):

Add additive interfaces & defaults — keep all existing keys for back-compat:

```ts
founder: { name?, role?, linkedin_url?, timezone?, first_help_goal? }
company: { name?, website_url?, linkedin_url?, description?, category?, industry?, stage?, team_size?, location? }
icp: { ...existing, disqualifiers: string[] }
gtm: { motion?, primary_channel?, preferred_channels: string[], biggest_bottleneck?, current_tools: string[], thirty_day_goal? }
positioning: { ...existing, offer?, pricing?, avoid_positioning: string[] }
workflow_preferences: { priority_workflows: string[] }
integration_status: Record<string, { status, label, reason? }>
onboarding_meta: { current_step, completed_steps, updated_at }
```

`mergeProfile` already shallow-merges per top-level key — extend the defaults map; user data still wins.

Update `isOnboardingComplete` unchanged (boolean flag remains source of truth).

## 5. Brain context builder for AI

**`supabase/functions/_shared/companyBrainContext.ts`** — extend `buildCompanyBrainContext()` to surface (in compact labeled lines, never raw JSON):

- Founder: name (role) · timezone · first_help_goal
- Company: name · stage · team_size · category/industry · location
- Description
- ICP: roles, sizes, industries, geography, pains, **disqualifiers**
- GTM: motion · primary channel · preferred channels · biggest bottleneck · current tools · 30-day goal
- Positioning: offer · promise · differentiators · proof · pricing
- Voice: tone · tags · avoid
- Competitors: known / adjacent
- Workflow prefs: priority workflows
- Approval rules: existing summary
- Integration readiness: 1-line summary of which sources are Ready vs Setup-needed (no secret values)

Keep total block ≤ ~1.5KB. Update `hasUsableBrain` to keep using `onboarding_completed` + presence of company name/desc/ICP.

Update `agentorySystemPrompt.ts` to reference the new fields where it lists guidance.

## 6. Integration readiness

**Edge function (new):** `supabase/functions/integration-readiness/index.ts` — auth-required, returns:
```json
{ "items": [ { "key":"apify", "label":"Apify", "status":"connected|setup_needed|optional|unavailable", "reason":"..." } ] }
```
Reads `Deno.env.get(...)` for project secrets (Apify, Firecrawl, Anthropic, Lovable AI, Resend, OpenAI, Gemini). For per-workspace items (Google Calendar), queries `google_calendar_tokens` by workspace. Maps Apify actors to known capabilities via `sourceCapabilities` registry. **Never returns secret values.**

**Hook (new):** `src/hooks/useIntegrationReadiness.ts` — invokes the function, caches via react-query. Used by:
- Onboarding step 9
- Workflows page (badges)
- Dashboard "Recommended moves"
- Pilot "setup-needed" detection (already partly server-side)

Persist a snapshot into `profile.integration_status` on finalize so AI context can summarize.

## 7. First-run / dashboard

- **Dashboard empty state:** when `brainComplete && totals.* === 0`, hide mock-feeling cards. Show one hero panel: "Your Company Brain is ready. Run your first workflow." + 3 recommended workflow buttons derived from `workflow_preferences` and `first_help_goal`.
- Strip the static seed fallbacks in `useWorkforceState` / `DepartmentPreview` "Recent Activity" — show real empties.
- `BrainReadinessCard` already hides when complete. Keep.

## 8. Workflows page personalization

`src/pages/Workflows.tsx` + `src/lib/workflows/registry.ts`:
- Add `recommendFor(brain)` helper that ranks registry items by:
  - `priority_workflows` (selected during onboarding) → top
  - `first_help_goal` → boosted
  - GTM motion / primary_channel → boosted (cold call → openers; content → LinkedIn post; outbound → outreach drafts)
- Render a "Recommended for you" row at top when brain is complete.
- Per-card readiness badge from `useIntegrationReadiness`: Ready / Setup needed / Coming soon.

## 9. Pilot behavior

`supabase/functions/pilot-chat/index.ts` already gates on `brainReady`. Update only the "brain missing" reply copy + action chips to match spec: "I need your Company Brain first so Scout, Aria, Hawk, Penn, and Scribe can work with the right context." Action chips: "Complete onboarding", "Add company website". Once brain is complete, existing personalized path already works — no behavioural rewrite.

## 10. First safe workflow (step 12)

After `finalize`:
- Pick recommended workflow from `workflow_preferences[0]` / `first_help_goal`.
- If integration ready: invoke `orchestrate` with a **drafts-only, count=5** preset; surface result in Workbench; post a single compact chat message: "Pilot started your first workflow. Scout is sourcing now." No outreach send. No DMs. No comments. No emails.
- If integration missing: show "This workflow needs setup" + link to Settings → Integrations + alternative ("Start with Daily briefing or review your Company Brain").
- Always show "Skip to dashboard" secondary button.

## 11. Legacy cleanup

- `src/components/OnboardingWizard.tsx` (screening-pilot 3-step): delete. Verify no imports via `rg -n "OnboardingWizard"`.
- `WorkspaceGate.tsx`: wire into `MainLayout` (replaces inline spinner-only paths).

## 12. Tests

**Edge / shared (Deno):**
- `_shared/companyBrainContext.test.ts` extend: founder/ICP-disqualifiers/GTM/voice/integration summary render; no raw JSON; ≤1.5KB; `hasUsableBrain` unchanged semantics.
- `_shared/companyBrainSchema.test.ts` extend: defaults include new sections; `mergeProfile` preserves user values; backwards-compat with legacy flat keys.
- New: `_shared/integrationReadiness.test.ts` — pure mapping helper extracted from the edge function.

**Frontend (vitest):**
- `OnboardingGate` redirect matrix (unauth, incomplete brain, complete brain, allowed pre-onboarding paths).
- `Auth.tsx` post-signup destination.
- Workflows recommendation ranking by brain inputs.
- Dashboard empty-state renders no mock activity when totals are 0.

**Manual browser QA** scripts under `/tmp/browser/` for scenarios A–G in the spec.

## 13. Validation

```
deno test supabase/functions/_shared --allow-all
npx tsgo --noEmit
npm run build  (harness auto-runs)
```

Safety scan: grep for any new auto-send path (`send-`, `sendEmail`, `dm`, `comment`, `autopost`) introduced by diff — assert none.

## 14. Out of scope (explicit)

- Landing page untouched.
- No DB migrations. All new fields live inside `company_brain.profile` JSONB.
- Migration `145631` not applied.
- No outreach send, DM, comment, post, or email auto-trigger.
- Production DB only read (no writes outside normal `setup-company-brain` flow).

---

## File map

**New**
- `src/components/OnboardingGate.tsx`
- `src/pages/ResetPassword.tsx`
- `src/components/auth/ForgotPasswordDialog.tsx`
- `src/components/auth/GoogleSignInButton.tsx`
- `src/hooks/useIntegrationReadiness.ts`
- `src/lib/workflows/recommend.ts`
- `supabase/functions/integration-readiness/index.ts`
- `supabase/functions/_shared/integrationReadiness.ts` (+ test)
- `src/components/onboarding/**` (12 step components, shared chrome) — splitting current ~1009-line file

**Edited**
- `src/App.tsx` (gate wiring, /reset-password route)
- `src/pages/Auth.tsx` (brain-aware redirect, Google btn, forgot-pw link, premium copy, email-verify state)
- `src/hooks/useAuth.tsx` (no change unless needed)
- `src/pages/OnboardingCompanyBrain.tsx` (slimmed orchestrator pulling step components)
- `src/lib/companyBrainSchema.ts` + `supabase/functions/_shared/companyBrainSchema.ts` (additive fields)
- `supabase/functions/_shared/companyBrainContext.ts` (new sections)
- `supabase/functions/setup-company-brain/index.ts` (accept new sections, persist `onboarding_meta`, finalize records `integration_status` snapshot)
- `supabase/functions/pilot-chat/index.ts` (brain-missing copy + action chips only)
- `src/pages/Dashboard.tsx` + `src/components/workforce/*` (real empty states)
- `src/hooks/useWorkforceState.ts` (drop mock seeds)
- `src/pages/Workflows.tsx` + `src/lib/workflows/registry.ts` (recommendations, readiness badges)
- `src/components/MainLayout.tsx` (wrap with `WorkspaceGate`)

**Deleted**
- `src/components/OnboardingWizard.tsx` (legacy)

---

## Acceptance

- New user signs up → lands in onboarding, cannot reach `/dashboard` until activation.
- Onboarding captures founder, company, ICP (with disqualifiers), GTM, positioning, voice, workflow prefs, integrations, safety.
- Company Brain context reaches Pilot/Scout/Aria/Hawk/Penn/Scribe with all new fields, compact format.
- First safe workflow runs drafts-only, count ≤5, opens in Workbench, posts one chat update, never sends.
- Dashboard, Workflows, Pilot recommendations all derive from brain — no mock activity.
- Password reset works end-to-end. Google sign-in works when configured, hidden when not.
- Build + typecheck + Deno tests green. Migration 145631 untouched. No auto-send paths added.

Approve and I'll implement in build mode.
