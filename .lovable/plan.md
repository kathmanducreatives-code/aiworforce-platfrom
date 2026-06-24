
# Plan — Premium Onboarding & Company Brain Activation

Scope: visual upgrade + honest analyzer mapping + persistent Company Brain context propagation. No landing-page edits, no DB migrations, no auto-send. All existing 12-step logic, auth gate, save/resume, schema, integration readiness, and first-safe-workflow logic preserved.

## 1. New presentation primitives (`src/components/onboarding/`)
New, isolated components — no behavior change to wizard state machine.

- `OnboardingShell.tsx` — full-bleed dark canvas, animated emerald grid + radial glow background, top-rail progress + optional left mini-timeline on ≥1280px, eyebrow/title/subtitle slot, footer slot.
- `ProgressRail.tsx` — 12 connected segment nodes with completed (emerald glow) / current (pulse) / future (muted) states. Hover tooltip labels (Founder, Company, Analyze, ICP, GTM, Positioning, Voice, Workflows, Integrations, Safety, Review, Launch). Sticky "Step N of 12 · {label}" line.
- `StepCard.tsx` — glassmorphic surface (backdrop blur, layered borders, inner highlight), dimensional shadow, emerald edge glow when active.
- `Chip.tsx` / `ChipGroup.tsx` — premium selectable chip with emerald border + soft glow + subtle scale-in on select.
- `FieldLabel.tsx` — uppercase letter-spaced label primitive (12.5–13.5px).
- `AgentOrb.tsx` — uses `AgentAvatar` from workforce, animated halo when "active".
- `BrainOrb.tsx` — welcome-screen central orb with 6 orbiting agent avatars and animated connection lines (CSS/Framer only).
- `AnalyzerTimeline.tsx` — honest step list driven by actual analyzer phases returned by backend (no fake fan-out); pulses while running, checks on done, warns on skipped.
- `ExtractedCard.tsx` — editable mapped-info card with confidence badge (High/Medium/Needs review), Accept/Edit/Reset actions.
- `BrainReadinessMeter.tsx` — derived from `computeCompleteness`, shows Good/Strong/Needs detail with segmented gauge.

Typography tokens applied via Tailwind utility composition in shell (no global font swap):
- eyebrow `text-[12px] tracking-[0.18em] uppercase text-emerald-400`
- title `text-[34px] md:text-[42px] leading-[1.08] font-semibold tracking-tight`
- subtitle `text-[17px] leading-[1.55] text-muted-foreground`
- input text `text-base`, labels per FieldLabel, helper `text-[13.5px]`.

## 2. Wizard refactor (`src/pages/OnboardingCompanyBrain.tsx`)
Keep the existing 12-step `StepId` union, save/resume meta writes, `save_structured`/`save_basics` calls, integration-readiness usage, and first-safe-workflow dispatch. Replace JSX only with the new primitives.

Per-step copy and visual updates:
- **welcome**: "Build your Company Brain" + safety line, BrainOrb visual, CTA "Build Company Brain".
- **founder**: title "Who's leading this workspace?" + Pilot avatar; goal options as premium chip cards using `FIRST_HELP_LABEL` expanded with "Find decision-makers" mapping.
- **company**: website + LinkedIn inputs, "Analyze with Hawk + Pilot" button transitions to analyzing step.
- **analyzing**: AnalyzerTimeline driven by actual response. Honest copy when scrape unavailable: "LinkedIn analysis isn't configured — using website + manual inputs." Calls existing `setup-company-brain` `analyze` (already returns `enriched`, `connectors`, `warnings`, `draft`). Stores draft in local state for review cards.
- **post-analyze review** (rendered inside same `analyzing` → `icp` transition as a sub-state, no new step id): ExtractedCard list for Company summary / ICP / Positioning / Competitors / Voice / Recommended workflows. Each Accept dispatches `save_structured` with only that section. No silent overwrite — nothing is saved until user accepts.
- **icp / gtm / positioning / voice / workflow_prefs / approval**: same fields, new visual layer, examples + helper text per spec, disqualifier emphasis, bottleneck chip cards, Scribe voice preview (deterministic preview from selected tags — no fake AI).
- **integrations**: capability cards (Ready / Setup needed / Optional / Unavailable) from `useIntegrationReadiness`. Never render secret values. Locked-workflow explainer.
- **review**: section cards with edit jumps, BrainReadinessMeter, CTA "Activate Company Brain".
- **launch (post-activation)**: new in-page screen after `onboarding_completed` flip, before route change. Recommended first workflow from `recommendWorkflows(brain).slice(0,1)`; if its required provider isn't `connected`, fall back to `daily_briefing` and show explainer. Buttons: "Run first workflow" (existing draft-only pilotChat path) / "Go to dashboard".

State additions (local only): `analyzerDraft`, `acceptedSections`, `analyzerPhases` (derived from response), `launchVisible`.

## 3. Honest analyzer mapping
Edge function `setup-company-brain` (`analyze` action) already returns a structured draft + warnings + connector flags. Extend it minimally:
- Add a `phases` array to the response describing what actually ran: `[{ agent:'hawk', label:'Reading your website', status:'ok'|'skipped'|'failed' }, { agent:'pilot', label:'Identifying business model', status:'ok' }]`. Derived from existing `scrapeReady` / `researchReady` / per-source try-catch — no new tool calls.
- Map the existing draft fields to Company Brain sections in the client (`src/lib/onboardingDraftMap.ts`, already imported) — extend it if needed to also emit a `competitors.known` suggestion list and `positioning.differentiators` array from the analyzer's `competitors` / `positioning` strings.
- No prefill into the saved brain until user clicks Accept on a card. Edited values always win.

No new edge functions, no migration.

## 4. Company Brain context propagation (verification + small fixes)
`buildCompanyBrainContext` already covers founder/ICP/GTM/positioning/voice/competitors/disqualifiers/workflow prefs/integration status. Audit downstream callers and ensure they inject it:

- `supabase/functions/pilot-chat/index.ts` — confirm `buildCompanyBrainContext` is prepended to system prompt; if missing, add.
- `supabase/functions/run-agent/index.ts` — same.
- `supabase/functions/chat-respond/index.ts` — same.
- `supabase/functions/daily-brief/index.ts` — same.
- Lead/ICP filtering: `src/hooks/useICPResults.ts` / `useLeadResults.ts` — verify ICP disqualifiers and industries are passed into scoring; add a thin selector `src/lib/brain/useBrainContext.ts` that exposes `{ icp, competitors, voice, positioning, gtm, founder }` for client-side rankers and content drafters.
- Competitor suggestions: `src/pages/CompetitorIntelligence.tsx` / `Competitors.tsx` — seed suggestions from `brain.competitors.known ∪ adjacent`.

Read-only audit first; only patch the smallest set where context isn't currently passed. No behavior change to ranking math beyond plumbing.

## 5. Animations
Framer-motion only (already a dep). Step transitions: 240ms fade+slide-x(8). Chip select: scale 0.98→1 + emerald shadow. Progress segment fill: 400ms ease-out. Analyzer pulse: 1.6s loop on active phase. Activation flourish: 600ms emerald glow expansion on BrainOrb. No bounces, no neon strobes.

## 6. Files changed
Created:
- `src/components/onboarding/OnboardingShell.tsx`
- `src/components/onboarding/ProgressRail.tsx`
- `src/components/onboarding/StepCard.tsx`
- `src/components/onboarding/Chip.tsx`
- `src/components/onboarding/FieldLabel.tsx`
- `src/components/onboarding/BrainOrb.tsx`
- `src/components/onboarding/AnalyzerTimeline.tsx`
- `src/components/onboarding/ExtractedCard.tsx`
- `src/components/onboarding/BrainReadinessMeter.tsx`
- `src/lib/brain/useBrainContext.ts`

Edited:
- `src/pages/OnboardingCompanyBrain.tsx` (UI rewrite, state machine preserved)
- `src/lib/onboardingDraftMap.ts` (extend mapping to competitors/positioning arrays)
- `supabase/functions/setup-company-brain/index.ts` (add `phases` to analyze response only)
- Possibly `supabase/functions/{pilot-chat,run-agent,chat-respond,daily-brief}/index.ts` only if audit shows brain context isn't already injected.

Untouched: landing, schema, migrations, auth, OnboardingGate, Workflows page logic, agents/runtime, registry, integration-readiness function.

## 7. QA
- `bunx vitest run` for existing onboarding/recommend tests.
- `npx tsgo --noEmit`.
- Playwright headless against localhost: A (first-time signup lands in onboarding), B (analyze with `https://agentory.space/` shows real timeline + editable extracted cards), C (chips/inputs render premium), D (refresh resumes), E (integrations readiness honest), F (review + activate), G (first safe workflow draft-only). Screenshots saved under `/tmp/browser/onboarding/`.

## 8. Out of scope
- Landing page edits.
- Any DB migration (including 145631).
- Auto-send / auto-DM / auto-post anywhere.
- Changing scoring/filter math beyond passing brain context through.
- New AI providers or new edge functions beyond extending `analyze` response.

## 9. Acceptance
Onboarding looks premium (glass, emerald glow, typography hierarchy), progress is unmistakable, analyzer is honest and renders editable Company Brain cards, integration readiness is clear, safety is reassuring, review shows a real Brain preview with readiness meter, activation triggers a compelling first-safe-workflow screen, and Pilot/Scout/Aria/Hawk/Penn/Scribe receive Company Brain context on every call.
