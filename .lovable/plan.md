## Goal

Transform `/onboarding/company-brain` from the current "all cards at once" review screen into a true guided, step-by-step Company Brain activation wizard with one decision per screen, a premium progress rail, AI analysis screen, and a clean review + launch.

## Scope guardrails

- Frontend-only. No DB migrations, no edge-function changes, no schema changes.
- Reuse existing `setup-company-brain` actions: `save_basics`, `save_sources`, `analyze`, `save_structured`, `finalize`.
- Reuse `companyBrainSchema.ts` (`StructuredBrain`, `BRAND_VOICE_TAGS`, `getBrainDefaults`) and `onboardingDraftMap.ts`.
- Reuse current premium dark/emerald visual language (`BackgroundGrid`, `AgentChipsRow`, glass cards).
- No landing-page changes. No auto-send/post/DM/comment.
- Dashboard gating (`BrainReadinessCard`, `RecommendedMoves`) already in place — only minor copy tweak if needed.

## New wizard flow (10 visible steps)

```text
0  Welcome          → website URL or "describe manually"
1  Analyzing        → animated agent activity while `analyze` runs
2  Company basics   → name, website, LinkedIn, one-liner, category
3  ICP              → buyer roles, size, industries, geography, pain points
4  Goals            → multi-select first focus areas
5  Competitors      → known + adjacent + "not sure" toggle
6  Brand voice      → tone chips + style rules + avoid
7  Approval rules   → 4 safety toggles, safe by default
8  Review           → collapsible cards + Company Brain completeness %
9  Launch           → activated agents + first workflow picker
```

Returning users with `onboarding_completed=true` (or substantial existing profile) jump straight to step 8 ("Review your Company Brain") with all cards pre-filled.

## Progress UI

- Top-mounted horizontal stepper rail showing all 10 nodes: completed (emerald check), current (pulsing emerald ring), upcoming (muted dot). Collapses to compact pill `Step 3 of 10 — Define your ICP · 30%` on mobile.
- Animated emerald progress fill underneath the rail.
- Persistent footer with `Back` / `Continue` / `Skip` (where allowed). Continue is disabled only on Step 2 until company name exists.
- Step transitions: framer-motion fade + slide-x (8px), 180ms.

## Step-by-step specifics

### Step 0 — Welcome (website-first)
- Headline: "Teach Agentory your business."
- Sub: "Your AI workforce uses this Company Brain to find signals, track competitors, write content, and draft outreach."
- Single large URL input + Company name. CTA "Build Company Brain" → `save_basics` + `save_sources` → Step 1.
- Link "I'll describe my company manually" → skips Step 1, goes Step 2 with empty draft.
- Visual: centered glass card, AgentChipsRow idle (Pilot/Hawk/Scout/Scribe/Penn/Aria).

### Step 1 — AI analysis
- Calls `analyze`. Animated stepper cycles through 6 agent lines ("Hawk is reading your website", "Pilot is identifying your business model", "Scout is finding ICP and signal opportunities", "Scribe is extracting positioning and tone", "Aria is preparing prioritization rules", "Penn is learning outreach style"). Agent chips pulse, then light up emerald sequentially.
- On success: map draft via `mapDraftToStructured` + `mapDraftToBasics`, advance to Step 2 with pre-fill.
- On Firecrawl-missing warning / error: amber notice "We couldn't analyze the website automatically. You can still build your Company Brain manually." → Continue to Step 2 with empty draft.

### Step 2 — Company Basics (one focused card)
- Fields: company name (required), website, linkedin_company_url, founder_linkedin_url, short_description (one-liner), category (free text).
- Side panel "What your agents will remember" mirrors entered values live.

### Step 3 — ICP
- Chip inputs: buyer_roles, industries, pain_points (Enter / comma to add, examples placeholder). Text: company_size, geography.
- "Not sure yet" button pre-fills sensible examples and marks as draft.

### Step 4 — Goals
- Question: "What should Agentory help with first?"
- Multi-select premium cards (icon + agent + blurb), backed by 6 options reusing `FIRST_GOALS` ids: leads, competitors, content, outreach, engagement, review.
- Stored locally + persisted into `goals.gtm/content/competitor_tracking/outreach` keys as a short text summary (no schema change).

### Step 5 — Competitors
- Chip inputs: known, adjacent. Toggle "I'm not sure — help me discover them" → sets `competitors.unknown=true` and disables required-ness.

### Step 6 — Brand Voice
- Selectable tone chips from `BRAND_VOICE_TAGS` plus new visual-only chips ("concise","bold") merged into the tags array.
- Free text: tone summary, style_rules (one per line), avoid (one per line).
- Preview line: "Agentory will use this voice when Scribe writes content and Penn drafts outreach."

### Step 7 — Approval & Safety
- 4 polished switches, all defaulted ON: draft_only, email_requires_approval, linkedin_manual_only (covers comments + DMs), plus a static "Nothing is sent without approval" badge.
- Subhead: "Agentory prepares work. You stay in control."

### Step 8 — Review (collapsible)
- 6 collapsible glass cards (Company, ICP, Goals, Competitors, Brand Voice, Approval Rules) using shadcn `Collapsible`. Each shows a clean summary and an "Edit" button that jumps back to its step.
- Completeness ring (top right): computed locally as % of populated key fields across the 6 groups. Shows "Company Brain N% ready" + bullet list of missing items.
- Primary CTA "Activate Company Brain" → single `save_basics` + `save_structured` + `finalize`. Secondary "Edit details" stays on the screen.

### Step 9 — Launch
- "Your Company Brain is ready." Confetti-free, premium.
- Activated agents row (all 6 light emerald with checks).
- Workflow picker cards (Find signals / Track competitors / Create founder post / Draft outreach / Open Dashboard) reusing `FIRST_GOALS` routes + `chat:prefill` (no auto-send).

## Files

Rewrite:
- `src/pages/OnboardingCompanyBrain.tsx` — new wizard shell + step routing + save orchestration.

New under `src/components/onboarding/`:
- `ProgressRail.tsx` — horizontal stepper + animated fill + mobile pill.
- `WizardFrame.tsx` — shared chrome (background, header, footer with Back/Continue/Skip, framer-motion transition).
- `steps/WelcomeStep.tsx`
- `steps/AnalyzingStep.tsx` (already exists conceptually in current file — extract).
- `steps/BasicsStep.tsx`
- `steps/IcpStep.tsx`
- `steps/GoalsStep.tsx`
- `steps/CompetitorsStep.tsx`
- `steps/BrandVoiceStep.tsx`
- `steps/ApprovalStep.tsx`
- `steps/ReviewStep.tsx` (collapsible cards + completeness ring)
- `steps/LaunchStep.tsx`
- `lib/brainCompleteness.ts` — pure function returning `{percent, missing[]}` for the review ring; unit-tested.

Light touch:
- `src/components/dashboard/BrainReadinessCard.tsx` — already routes to `/onboarding/company-brain`; tweak CTA copy to "Complete Company Brain setup" / "Company Brain active" states if not already matching.

Unchanged: edge functions, DB, sidebar, App routes, other pages, `companyBrainSchema.ts`, `onboardingDraftMap.ts`.

## Save strategy

- Local React state holds the full `StructuredBrain` + basics during the wizard.
- Step 0: `save_basics({company_name, website})` + `save_sources({website})`.
- Steps 2–7: state-only, no per-step network calls (avoids partial writes and keeps wizard snappy).
- Step 8 "Activate": single batched `save_basics` + `save_structured` + `finalize`.
- Returning user with existing `company_brain.profile` → preload into state, land on Step 8.

## Animations

- Step container: framer-motion `AnimatePresence` fade/slide-x 180ms.
- Progress fill: width transition 400ms ease-out.
- Completed step check: scale-in 200ms.
- Agent chips during analysis: staggered pulse (existing pattern).
- Selectable cards: hover lift (translate-y-[-2px] + emerald ring), selected = emerald glow ring + check badge.
- Buttons: existing loading spinner pattern.

## Safety

- Approval defaults always ON; toggles cannot all be turned off without showing a sticky warning banner — but no enforcement (UI nudge only).
- Launch workflow cards = `navigate(...)` + `chat:prefill`. No `chat:send`.

## Tests / checks

- `src/lib/brainCompleteness.test.ts` — empty / partial / full profiles.
- Existing `onboardingDraftMap.test.ts` remains green.
- Manual: new-user happy path; Firecrawl-missing path; manual fallback; back/forward across steps preserves state; returning user lands on Review; Activate sets `onboarding_completed=true`; Dashboard reflects completion.
- Harness typecheck + build.

## Out of scope / remaining gaps

- No new DB columns; "category" stored as an additive key inside existing `profile` JSON.
- Goal "hiring" omitted (Agentory is GTM, not recruiting).
- Per-step autosave deferred — single batched save on Activate is the v1.
- No mobile-specific copy variants beyond responsive layout.
