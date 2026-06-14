## Goal

Replace the current 6-step form at `/onboarding/company-brain` with a premium, website-first AI setup experience that produces a complete Company Brain quickly and feels like a command center, not a form. Keep the existing `company_brain.profile` shape and `setup-company-brain` edge function — no schema or backend changes.

## Scope guardrails

- Frontend-only. No DB migrations. No new edge functions. No changes to landing page or unrelated pages.
- Reuse existing `setup-company-brain` actions: `save_basics`, `save_sources`, `analyze`, `save_structured`, `finalize`. Firecrawl enrichment already lives inside `analyze` via the scrape_url tool — we just trigger it.
- Zero auto-send / auto-post / auto-DM. First-goal CTA only `navigate(...)` or dispatch `chat:prefill` (existing pattern).
- Preserve the structured profile shape from `src/lib/companyBrainSchema.ts` (icp / goals / positioning / brand_voice / competitors / approval_rules). Spec-requested fields not in that schema (e.g. `goals.hiring` already exists; `category`, `linkedin_url` as top-level) map onto existing top-level basics fields — no shape drift.

## New flow (5 visible steps + launch)

```text
1 Welcome     →  website URL (or "describe manually")
2 Analyzing   →  animated agent status while edge fn runs
3 Review      →  editable Company Brain cards
4 First goal  →  pick what AI workforce helps with first
5 Launch      →  confirmation, approval reminder, CTA
```

### Step 1 — Welcome
- Headline: "Teach Agentory your business in minutes."
- Sub: "Your AI workforce uses this context to find signals, write content, track competitors, and draft outreach."
- Single big input: `website URL` + Company name (required minimum to save basics).
- Link: "I don't have a website — describe manually" → skips analyze, jumps to Step 3 with empty draft.
- CTA: "Build Company Brain" → calls `save_basics` + `save_sources` ({website}) → Step 2.
- Visual: dark glass card, soft emerald grid background, agent avatar row (Pilot / Scout / Hawk / Penn / Scribe) idle chips.

### Step 2 — AI analysis
- Calls `analyze` action (already invokes Firecrawl + Gemini server-side).
- Animated stepper with 6 lines cycling while request pending:
  - Reading website → Understanding product → Identifying ICP → Extracting use cases → Finding competitor categories → Preparing Company Brain
- Agent chips light up emerald as each phase ticks (purely visual timing, capped at request duration).
- On `warnings` returned (Firecrawl unconfigured) or thrown error: show amber notice "Couldn't analyze automatically — continue manually" and proceed to Step 3 with whatever draft exists (or empty).

### Step 3 — Review (editable cards, grid layout)
Cards (each a glass panel, two-column grid on desktop):
1. **Company basics** — name, website, LinkedIn company, founder LinkedIn, one-line description, product category (free text).
2. **ICP** — buyer_roles, company_size, industries, geography, pain_points.
3. **Goals** — gtm, content, competitor_tracking, outreach.
4. **Positioning** — promise, differentiators, use_cases, proof_points.
5. **Competitors** — known, adjacent, "Not sure yet" toggle (sets `competitors.unknown=true`).
6. **Brand voice** — tone, style_rules, avoid, tag chips from `BRAND_VOICE_TAGS`.
7. **Approval rules** — always-visible safety card with defaults pre-checked: draft_only, email_requires_approval, linkedin_manual_only. Copy: "Nothing is sent without your approval."

Pre-fills from `analyze` draft (`company_summary` → description, `target_customer_profile` → ICP hint, `competitors` array, `brand_voice`/`positioning` → matching cards) using a small mapping helper. User can edit anything; nothing required beyond company name.

Save = single call to `save_basics` (top-level fields) + `save_structured` (nested groups). Then → Step 4.

### Step 4 — First goal
Five cards (icon + title + 1-line explanation + example prompt):
- Find leads (Scout)
- Track competitor conversations (Hawk)
- Create founder content (Scribe)
- Draft outreach (Penn)
- Find LinkedIn engagement opportunities (Scout)
- Review saved signals (Pilot)

Selecting a card stores the goal locally; "Skip" allowed.

### Step 5 — Launch confirmation
- "Your Company Brain is ready." with checklist of activated agents, selected first goal, and approval-rules reminder.
- Calls `finalize` action (sets `onboarding_completed=true`).
- CTAs:
  - Primary: "Launch first workflow" → `navigate(route)` + `dispatchEvent('chat:prefill', { text: examplePrompt })` based on selected goal. No auto-send.
  - Secondary: "Go to Dashboard" → `/dashboard`.

## Manual fallback path

- "Describe manually" link on Step 1 → skip analyze, go to Step 3 with empty draft + a small sub-form at the top: "What does your company do / who do you sell to / what problem / main goal / competitors / tone" — these write to the matching review cards live (not a separate page).
- Allow "I'm not sure" toggle on competitors. No field required except company name.

## Dashboard gating (already partially in place)

- `BrainReadinessCard` (existing) keeps rendering when `onboarding_completed=false`. Update its CTA copy to "Teach Agentory your business" → `/onboarding/company-brain`.
- Add a tiny helper hook usage in content/GTM flows: when chat-driven prompts for content/outreach run without a brain, the Dashboard's "Needs Attention" already surfaces the brain row; add one explicit guard in `RecommendedMoves` content/outreach cards: if `!brain.onboarding_completed`, the card's onClick routes to `/onboarding/company-brain` instead of dispatching `chat:prefill`. No edge-function changes.

## Files to change

- Rewrite: `src/pages/OnboardingCompanyBrain.tsx` (new 5-step UX, premium styling).
- New components under `src/components/onboarding/`:
  - `WelcomeStep.tsx`
  - `AnalyzingStep.tsx` (animated stepper + agent chips)
  - `ReviewStep.tsx` (orchestrates the cards below)
  - `cards/BasicsCard.tsx`, `IcpCard.tsx`, `GoalsCard.tsx`, `PositioningCard.tsx`, `CompetitorsCard.tsx`, `BrandVoiceCard.tsx`, `ApprovalRulesCard.tsx`
  - `FirstGoalStep.tsx`
  - `LaunchStep.tsx`
  - `AgentChipsRow.tsx`, `ProgressRail.tsx`
- Small helper: `src/lib/onboardingDraftMap.ts` — maps `analyze` draft → structured cards (pure function, unit-tested).
- Light edit: `src/components/dashboard/RecommendedMoves.tsx` — route to onboarding when brain incomplete.
- Light edit: `src/components/dashboard/BrainReadinessCard.tsx` — copy tweak.

Unchanged: edge functions, DB schema, sidebar, routes, other pages, `companyBrainSchema.ts` (only consumed).

## Safety

- All "Launch first workflow" actions resolve to `navigate(...)` + `chat:prefill`. No `chat:send`, no direct send/post/DM/comment.
- Approval rules card is always visible on Review and Launch screens with the four defaults checked and an emerald "Safe by default" badge.

## Tests / checks

- Add `src/lib/onboardingDraftMap.test.ts` covering: empty draft, partial draft, competitors as string vs array, brand voice string → tone.
- Manual: new user (no brain) → onboarding renders; website-first happy path; Firecrawl-missing warning path; manual fallback path; finalize sets `onboarding_completed=true`; Dashboard recognizes completion.
- Typecheck + build (run by harness).

## Out of scope / remaining gaps

- No new DB columns. Fields like top-level `category` / `linkedin_url` from the spec map onto existing basics (`linkedin_company_url`) and an additive `category` key inside the existing JSON profile — no schema change.
- Goal "hiring" intentionally omitted from first-goal cards per Agentory positioning (GTM, not recruiting).
- No changes to agent prompt assembly — agents already read `company_brain.profile` server-side.
