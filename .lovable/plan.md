
# Agentory — Current-State Audit (Auth · Onboarding · Company Brain · First-Run)

Read-only audit. No code, schema, or DB changes proposed here. Implementation comes in a separate plan.

---

## A. Current auth state

**Provider:** Supabase Auth (managed via Lovable Cloud), email + password only. No Google/social, no magic link, no phone, no SAML configured client-side. No `lovable.auth.signInWithOAuth` integration present.

**Routes**
- `/` → `Landing` (public)
- `/auth` → `Auth.tsx` — single page, toggles between Sign in / Sign up. No `/forgot-password`, no `/reset-password`, no email-verification landing page.
- `/onboarding/company-brain` → `OnboardingCompanyBrain` (protected, no `MainLayout`)
- All product routes wrapped in `ProtectedRoute` → `MainLayout`.

**Flow**
- `useAuth` (`src/hooks/useAuth.tsx`) sets up `onAuthStateChange` then `getSession`, with a graceful `signOut` on stale-refresh-token failure.
- `Auth.tsx` calls `signInWithPassword` / `signUp` (with `emailRedirectTo: window.location.origin`) and on success navigates to `/dashboard`. An `onAuthStateChange` listener also redirects any signed-in visitor of `/auth` straight to `/dashboard`.
- `ProtectedRoute` shows a spinner while loading and redirects unauthenticated users to `/auth`. No onboarding gate — a logged-in user with empty Brain lands on `/dashboard`.
- `WorkspaceProvider` resolves `getCurrentWorkspaceId()` (provisions a workspace via DB trigger `handle_new_user_workspace` → `provision_workspace_for_user`). `WorkspaceGate` shows "Loading workspace…" / "Workspace couldn't load" with Retry / Setup / Sign out — but **`WorkspaceGate` is never used in `App.tsx`**; only the inline retry logic in `WorkspaceProvider` is active. Dead component.
- Sign-out is wired through `useAuth.signOut`; no explicit `/logout` route.

**What works**
- Session persistence, auto-refresh, token-refresh recovery.
- Workspace auto-provisioned on first signup via DB trigger.
- "Back to Home" on `/auth`.

**Gaps / issues**
- No password reset (no `resetPasswordForEmail` call, no `/reset-password` route).
- No Google sign-in (Agentory positions as premium SaaS — defaults missing).
- No email-verification handling UI; if Supabase is set to require confirmation, user is shown a toast but no landing page handles the redirect.
- No onboarding gate — see B.
- `Auth.tsx` `useEffect` fires `navigate('/dashboard')` on any auth event including immediately after sign-up (before email confirmation if enabled), which can be inconsistent depending on auth settings.
- `WorkspaceGate.tsx` is orphaned (not mounted anywhere).

---

## B. Current onboarding state

**Exists?** Yes — one route, one file: `src/pages/OnboardingCompanyBrain.tsx` (~1009 lines), backed by edge function `supabase/functions/setup-company-brain/index.ts` (220 lines).

**Steps (10):** `welcome → analyzing → basics → icp → goals → competitors → voice → approval → review → launch`. Built with framer-motion, a `ProgressRail`, animated "AI analysis" sequence (Hawk/Pilot/Scout/Scribe/Aria/Penn), chip inputs, completeness meter.

**Data captured (persisted to `company_brain.profile` JSONB):**
- basics: `company_name`, `website_url`, `linkedin_company_url`, `founder_linkedin_url`, `short_description`, `category`
- structured (from `src/lib/companyBrainSchema.ts`):
  - `icp`: buyer_roles[], company_size, industries[], geography, pain_points[]
  - `goals`: gtm, content, competitor_tracking, outreach, hiring
  - `positioning`: promise, differentiators[], use_cases[], proof_points[]
  - `brand_voice`: tone, tags[], style_rules[], avoid[]
  - `competitors`: known[], adjacent[], unknown
  - `approval_rules`: draft_only, email_requires_approval, linkedin_manual_only
- `current_primary_goal` (set in `finalize` action)
- `onboarding_completed` (bool) + `onboarding_completed_at` (column on `company_brain`)

**Routing / gating**
- Onboarding is **fully skippable**. There is no router-level guard that forces a new user into `/onboarding/company-brain`. After sign-up, user lands on `/dashboard` with `CompanyBrainStrip` + `BrainReadinessCard` nudging completion.
- Re-entry works: `?restart=1` reloads wizard at welcome with prefilled values; review step lets users edit. Sidebar and `WorkspaceGate` link to it.
- Completion is stored server-side (`finalize` action sets `onboarding_completed=true`). `useCompanyBrain` reads it. `useWorkforceState` derives `brainComplete`.

**Strengths**
- Edge-side analysis (`call('analyze')`) prefills via website scrape; non-blocking, falls back to manual.
- Reasonable structured schema; merge-without-overwrite (`mergeProfile`) preserves user input.
- Persists state on every step; review allows full edit.

**Gaps**
- No onboarding gate → users routinely land on dashboard with empty Brain. The whole product narrative ("AI workforce learns your business") is undermined.
- No founder/user identity captured beyond LinkedIn URL (no name confirm, no role, no "what I want help with").
- No team-size / stage / pricing / GTM motion fields collected as first-class — only free-text inside `goals.gtm`.
- No integration checks during onboarding (Apify, Firecrawl, calendar, email sender). Workflows can fail later with no setup-needed step.
- No "safe first workflow" runs at end of wizard — `launch` step just routes to a page. No actual first dopamine moment.
- `Auth.tsx` does not redirect new sign-ups to `/onboarding/...` — only to `/dashboard`.
- Onboarding has no resume marker (e.g., `last_step`) — user that drops mid-flow restarts logically at `review` because of the hydration heuristic.

---

## C. Current Company Brain state

**Storage:** single row per `workspace_id` in `public.company_brain` with columns:
`workspace_id (uuid)`, `profile (jsonb)`, `onboarding_completed (bool)`, `onboarding_completed_at (timestamptz)`, `created_at`, `updated_at`. One policy. Auto-created in `provision_workspace_for_user`.

**Fields present (in `profile` JSON)** — basics, ICP, goals, positioning, brand_voice, competitors, approval_rules, plus a flat-shape legacy fallback (`what_we_do`, `who_we_sell_to`, `voice_and_tone`, `competitors[]`) supported by `_shared/companyBrainContext.ts`.

**Fields missing / weak**
- No founder profile (name, role, working style, time zone, calendar prefs)
- No company stage / team size / funding stage as structured fields
- No pricing / offer / packages
- No buyer personas as objects (only flat `buyer_roles` chips); no decision-makers vs influencers vs champions
- No disqualifiers / negative ICP
- No "current GTM motion" enum (PLG, outbound, inbound, partnerships)
- No "biggest manual bottleneck" / "what would you automate first"
- No preferred channels (cold call / LinkedIn / email / content) as structured
- No current tools / tech stack
- No proof points as objects with metrics
- No "things to avoid saying" structured (only `brand_voice.avoid[]` chips — exists, OK)
- No safe-automation limits (rate caps, daily send caps)
- No integration status (Apify token present? Firecrawl key? calendar connected?)
- No workflow memory / recently-run preferences

**Fields used by AI** (see D): company_name, description, ICP composite, goals, positioning, competitors, voice, approval_rules. Everything else captured by the wizard (e.g., `founder_linkedin_url`, `linkedin_company_url`) is **stored but unused** by `buildCompanyBrainContext`.

---

## D. Current AI-context wiring

`supabase/functions/_shared/companyBrainContext.ts` is the single ingest point. It exports `hasUsableBrain`, `buildCompanyBrainContext`, `brainCompanyName`, `brainCompetitors`, `brainICP`, `brainMissingFields`.

| Surface | Uses brain? | How |
|---|---|---|
| Pilot chat (`pilot-chat/index.ts`) | Yes | Loads `company_brain` once, gates `brainReady`, injects compact `<company_brain>` block into system prompt; uses for personalized replies, lead source selector, competitor seeding, signal sourcing gate. |
| run-agent (`run-agent/index.ts`) | Yes | `renderBrainForAgent()` returns a labeled block; if no brain, instructs model not to invent. Used for Scout, Aria, Hawk, Penn, Scribe via the shared system prompt. |
| orchestrate (`orchestrate/index.ts`) | Partial | Loads `company_brain.profile` "best-effort" but doesn't enforce `brainReady`; passes raw to downstream steps. |
| daily-brief | Yes | Imports brain context. |
| Workflow classifier (`_shared/workflowClassifier.ts`) | Yes | Imports brain context. |
| Workflows page (`src/pages/Workflows.tsx`) | **No** | Static registry; no per-workspace recommendation based on brain. |
| Workbench recommendations | **No** | Same — recommendations are static. |
| Dashboard (`Dashboard.tsx`, `PilotBriefing`, `DepartmentPreview`) | Partial | `useWorkforceState` reads `brainComplete` to switch CTA, but department totals/cards are not personalized to ICP/goals. |

**Mock / placeholder data still in dashboard layer** (worth flagging — verifying scope in next phase):
- `useWorkforceState` derives `totals` from real tables but several `DepartmentPreview` numbers and "Recent Activity" entries fall back to static seed data when the workspace is empty.
- Onboarding "ANALYSIS_STEPS" are cosmetic — the actual analyzer is one call; UI shows six fake-progress lines regardless of what ran.
- "Workflow Center" cards advertise capabilities (e.g. "Find Decision-Makers", "Audit Website") that are not all wired to real run-agent paths — some are marked `setup_needed`/`coming_soon` in the registry, but the registry is not derived from real capability checks against the workspace.
- Pilot's "Next move" callout phrasing is brain-aware, but the underlying counts can be 0 with copy that implies activity.

**Bottom line:** Brain reaches Pilot and run-agent well. It does **not** drive Workflows recommendations, Workbench, or dashboard departmental copy.

---

## E. Current first-run experience

Walking through it as a new user:

1. Lands on `/`, signs up at `/auth`. Email/password only. No Google option.
2. On success → toast → `navigate('/dashboard')`. (Email confirmation flow is not handled visually.)
3. `WorkspaceProvider` provisions a workspace silently via trigger.
4. Dashboard renders with: `CompanyBrainStrip` ("Set up your Company Brain"), `PilotBriefing` (greets generically), empty `WorkforceDock`, `DepartmentPreview` (mostly empty cards), `WorkflowTimeline` (empty), `WorkforceHandoffStrip`.
5. User can ignore the strip and click around. Chat works but Pilot will refuse business-specific prompts (correct: returns "I don't have your Company Brain yet").
6. If user clicks Brain strip → 10-step wizard → after `activateBrain` → `launch` screen → click a goal → routed to product page (no actual workflow auto-run).

**Issues**
- Not obvious that onboarding is the unlock — strip is dismissable-looking and user can navigate past it.
- Dashboard feels "full" of UI but empty of personal content; the gap between premium chrome and zero data is jarring.
- No explicit "what is Agentory" tour for someone who arrived from a paid ad without reading landing.
- Empty states exist but are inconsistent — some say "Coming soon", others "Setup needed", others just render zeros.
- No "first 5 minutes" guided path. The wizard's `launch` step exits onboarding without proving value.

---

## F. Current integration setup

`supabase/functions/_shared` and `src/pages/SettingsIntegrations.tsx` are the surfaces.

**Secrets already configured** (project-level): Apify, Firecrawl, Anthropic, Lovable AI, Resend, Google AI, OpenAI, Supabase keys.

**Per-user integrations**
- Google Calendar: `google_calendar_tokens` table + `GoogleOAuthCallback` route + `useGoogleCalendar` hook. Wired.
- Email sender: shared Resend key, no per-user domain validation.
- LinkedIn actors / people search / comments actor: project-level Apify, not surfaced as per-workspace setup.
- No "integrations checklist" inside onboarding. `SettingsIntegrations` page exists but is not part of first-run.

**Blocking behaviour**
- Workflows registry marks some items `setup_needed` / `coming_soon` (static), but actual run-agent gates by checking env/secrets at call-time, not by surfacing "you need X" at the UI level pre-run.
- User can launch a workflow that will then fail in agent because of a missing capability.

---

## G. Fake / mock data found

- Wizard `ANALYSIS_STEPS` simulates 6 sequential agents while only one `analyze` call runs.
- `DepartmentPreview` / `WorkforceDock` show derived totals but rely on copy that implies more activity than the data supports.
- Workflows page registry uses static descriptions ("Reach 50 decision-makers", "Audit any website") — not personalized, no real count.
- `BrainReadinessCard` and `RecommendedMoves` reference generic suggestions ("Save 5 leads") that are not tied to current workspace counts.
- Some department `nextAction` routes in `workforce/departmentConfig.ts` point to product pages with no precondition checks.
- `OnboardingWizard.tsx` (legacy screening-pilot 3-step wizard) is still in `src/components/` and references screening routes. Dead/legacy for Agentory.

These are not deceptive in themselves but make the product feel "scripted" rather than alive. Worth replacing with real counts or honest empty states.

---

## H. P0 — must fix before product is usable

1. **Force onboarding before first dashboard load** — block `/dashboard` (and protected app routes) until `company_brain.onboarding_completed = true`, except `/onboarding/company-brain` itself and `/settings/*`.
2. **Sign-up → onboarding redirect** — `Auth.tsx` should route new accounts to `/onboarding/company-brain`, returning users to `/dashboard`.
3. **Password reset flow** — add `resetPasswordForEmail` + `/reset-password` route. Currently absent; account recovery is broken.
4. **Replace the cosmetic analyzer with honest progress** — show what actually ran (1 call), or chain real per-agent steps. Don't fake 6 agents.
5. **Capture founder identity** — name, role, "what do you want Agentory to help with first" — these are missing and are needed by Pilot/Penn/Scribe to sound authentic.
6. **Surface integration setup inside onboarding** — at minimum a "what's connected" pane (Apify ✓, Firecrawl ✓, calendar ✗, email sender ✗) before the user reaches Workflows.
7. **Wire `WorkspaceGate` (or remove it).** Currently dead code; protected routes show inline spinners only.

## I. P1 — improvements for strong onboarding

1. Add Google sign-in via `lovable.auth.signInWithOAuth("google", …)` per Cloud defaults.
2. Add a "resume onboarding" pointer (`profile.onboarding_step`) so drop-off users return to the right step instead of `review`.
3. Run an actual safe first workflow at the end of onboarding (Scout demo search using user's ICP, drafts-only). Real activation moment.
4. Extend Company Brain schema (see C) with structured GTM motion, channels, stage, team size, pricing, founder profile, disqualifiers, current tools.
5. Personalize Workflows page recommendations from `goals` + `current_primary_goal`.
6. Personalize Dashboard "Recent Activity" — hide or show "Nothing yet — let's start" empty states instead of mock-feeling cards.
7. Add an integrations checklist with clear per-item setup-needed states gating workflows server-side AND surfaced client-side.
8. Email-verification landing page if Supabase auth is set to confirm emails.

## J. P2 — later polish

- Animated onboarding micro-interactions reduced; copy editor pass.
- Per-agent "what I learned about you" review screen.
- Workspace switcher / multi-workspace support.
- Re-onboarding triggers when ICP or competitors change significantly.
- Onboarding analytics events for funnel measurement.

## K. Recommended onboarding architecture (high-level only)

```text
Sign up
  ↓
/onboarding/company-brain  (gated; cannot skip to /dashboard)
  ├─ 1. Founder      name, role, LinkedIn, "what do you want help with"
  ├─ 2. Company      name, site, stage, team size, geo, one-liner, category
  ├─ 3. Auto-analyze website (real, honest progress)
  ├─ 4. ICP          personas, sizes, geos, disqualifiers
  ├─ 5. GTM          motion enum, channels, biggest bottleneck, current tools
  ├─ 6. Positioning  promise, differentiators, proof points, pricing/offer
  ├─ 7. Voice        tone, tags, style rules, avoid
  ├─ 8. Competitors  known, adjacent, "discover for me"
  ├─ 9. Integrations Apify/Firecrawl/Calendar/Email status + connect
  ├─ 10. Safety      approval rules, daily caps, channels off by default
  ├─ 11. Review      single editable summary
  └─ 12. First run   actually run one safe workflow (Scout drafts, no send)
            ↓
       /dashboard (now real)
```

Persistence: extend `company_brain.profile` (still JSONB to avoid migration churn) + add `onboarding_step` and `integration_status` keys. Schema migration only if structured promotion is needed later.

## L. Files inspected

- Routing: `src/App.tsx`
- Auth: `src/pages/Auth.tsx`, `src/hooks/useAuth.tsx`, `src/components/ProtectedRoute.tsx`, `src/components/WorkspaceGate.tsx`, `src/contexts/WorkspaceContext.tsx`
- Onboarding: `src/pages/OnboardingCompanyBrain.tsx`, `src/lib/companyBrainSchema.ts`, `src/lib/onboardingDraftMap.ts` (referenced), `src/lib/brainCompleteness.ts` (referenced), `src/hooks/useCompanyBrain.ts`
- Dashboard / first-run: `src/pages/Dashboard.tsx`, `src/components/dashboard/BrainReadinessCard.tsx`, `src/components/dashboard/CompanyBrainStatusCard.tsx`, `src/components/dashboard/NeedsAttentionPanel.tsx`, `src/components/dashboard/RecommendedMoves.tsx`, `src/components/workforce/CompanyBrainStrip.tsx`, `src/components/workforce/departmentConfig.ts`, `src/hooks/useWorkforceState.ts`
- Workflows: `src/pages/Workflows.tsx`, `src/lib/workflows/registry.ts`
- Legacy: `src/components/OnboardingWizard.tsx` (screening-pilot, unused for Agentory)
- Edge functions: `supabase/functions/setup-company-brain/index.ts`, `supabase/functions/pilot-chat/index.ts`, `supabase/functions/run-agent/index.ts`, `supabase/functions/orchestrate/index.ts`, `supabase/functions/_shared/companyBrainContext.ts`, `supabase/functions/_shared/companyBrainSchema.ts`, `supabase/functions/_shared/agentorySystemPrompt.ts`, `supabase/functions/_shared/workflowClassifier.ts`
- Schema: `public.company_brain`, `public.profiles`, `public.workspaces`, `public.workspace_members`, DB function `provision_workspace_for_user`, trigger `handle_new_user_workspace`

## M. Risks

- **Privacy/leakage:** Pilot system prompt injects the full compact Brain block. If model output is logged anywhere user-visible across tenants, ICP/competitor info could leak. RLS appears correct at table level (single policy per `workspace_id`); no cross-tenant query observed.
- **Auth recovery missing:** no password reset path = locked-out users have no self-serve recovery.
- **Onboarding bypass:** every user-facing brain-aware surface tolerates empty brain, which is graceful but means users can run weeks without ever filling it. Risk: bad first impression.
- **Shared Resend domain:** outreach sent under a shared domain is a deliverability + brand risk if outreach ever auto-sends. Today it is draft-only.
- **Static workflow registry:** users can attempt workflows their workspace can't run. Failures happen inside agent, not at UX layer.
- **Orphan `WorkspaceGate` / legacy `OnboardingWizard.tsx`:** dead code increases drift risk during the upcoming rebuild.

---

## Readiness scores (strict, 0–100)

| Area | Score | Why |
|---|---|---|
| Auth | **45** | Basic email/password works; no Google, no password reset, no email-verification UX, no onboarding gate. |
| Onboarding | **55** | Wizard exists, structured, persists, editable — but skippable, cosmetic analyzer, no integrations step, no first-run workflow, no founder identity. |
| Company Brain | **60** | Solid schema for ICP/positioning/voice; missing founder, stage, GTM motion enum, channels, pricing, integration status; some captured fields unused by AI. |
| First-run UX | **35** | Dashboard renders before any context; no forced path to value; mock-feeling cards; no real activation moment. |
| Agent context wiring | **70** | Pilot + run-agent + daily-brief consume Brain well and refuse to invent. Workflows page, Workbench, dashboard department copy do not personalize. |
| Integrations | **40** | Project-level secrets exist; per-workspace status not surfaced; no checklist; failures happen at agent runtime. |
| **Overall ready-to-use** | **45** | Strong primitives, weak first 10 minutes. Onboarding must be forced, founder identity captured, integrations checked, and a real safe first run executed before this feels usable. |

No code will be changed from this audit. When you're ready, approve a rebuild plan and we'll redesign onboarding around the P0/P1 list above.
