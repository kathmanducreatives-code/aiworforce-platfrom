# Company Brain Onboarding — Premium Redesign

Pure UI/UX makeover. No backend, DB, edge function, provider, migration, or secret changes. All 6 backend actions (`status`, `research_founder`, `research_company`, `draft`, `save_draft`, `activate`) and the `generate-company-brain-draft` invocation remain byte-identical. The 5-step structure (Founder → Company → AI Research → Review → Activate) stays. `onboardingV3.ts`, `companyBrainCompleteness.ts`, `normalizeCompanyBrain.ts` are not modified.

## Visual direction

"Agentory Brain Lab" — cinematic, focused, premium dark AI workspace.

- Deep near-black canvas with an orbital/grid ambient background layer (SVG dot-grid + soft radial emerald washes, no heavy libs).
- Translucent glass cards (`bg-card/40 backdrop-blur-xl`, hairline `border-border/50`, soft emerald edge glow on hover/focus).
- Editorial serif-mixed typography for step titles (`text-4xl/5xl font-semibold tracking-tight`) paired with tight uppercase eyebrows.
- Emerald primary accents used sparingly — glow shadows on primary CTAs, ring pulses on active step, gradient hairlines on card tops.
- Motion via existing `framer-motion` only (installed). Subtle fade/slide step transitions, staggered card reveals, animated completeness ring, scanning-line for research state, skeleton shimmer for loading.

## Files changed (all in `src/`, presentation only)

**Rewrite**
- `src/pages/OnboardingCompanyBrain.tsx` — new shell + all 5 step components (FounderStep, CompanyStep, ResearchStep, ReviewStep, ActivateStep). All existing handler names + action calls preserved verbatim.
- `src/components/onboarding/BrainPreviewPanel.tsx` — live intelligence panel redesign.
- `src/components/onboarding/BrainReviewCard.tsx` — premium card chrome + smart empty states.
- `src/components/onboarding/ChipInput.tsx` — better chip styling, hover state, "Add another" affordance.
- `src/components/onboarding/StepProgress.tsx` — animated 5-pill rail.
- `src/components/onboarding/CompletenessRing.tsx` — polish (gradient stroke, animated fill).

**New**
- `src/components/onboarding/AmbientBackground.tsx` — reusable dot-grid + radial-wash ambient layer.
- `src/components/onboarding/SourceEvidenceCard.tsx` — clean source card for the AI Research step (Homepage / Pricing / Features / About / Customers / Careers) with status glyph (Read / Extracted / Needs confirmation / Not enough evidence), confidence badge, extracted bullet list. No raw scraped text.
- `src/components/onboarding/ResearchTimeline.tsx` — animated vertical timeline (Founder → Website → LinkedIn Co. → Evidence → ICP hypothesis → Draft) with scanning-line motion.
- `src/components/onboarding/BrainSection.tsx` — section grouping wrapper (Targeting / Signals / Messaging / Safety) with sticky sub-header and icon.
- `src/components/onboarding/ActivationHero.tsx` — launch-moment activation panel: large animated brain orb (CSS/SVG only), readiness score, "What Agentory will use" feature grid, safety reassurance strip.
- `src/components/onboarding/PagePreviewChips.tsx` — Step 2 "What we will read" preview with page-cap note.
- `src/components/onboarding/EnrichmentConsentPanel.tsx` — Step 1 premium consent block.
- `src/components/onboarding/FoundOnLinkedInCard.tsx` — Step 1 result card (avatar monogram, name, headline, evidence count).
- `src/components/onboarding/ErrorState.tsx` — premium error surface (what failed / why / next steps / retry / continue manually).

## Per-step redesign

### Step 1 — Founder
Two glass cards side-by-side on desktop, stacked on mobile:
1. **About you** — name (required), role, timezone, first goal. Inline validation, tight labels.
2. **Enrich from LinkedIn** — URL input, premium consent toggle in a highlighted panel with lock icon, "Analyze founder profile" secondary CTA. Skip button as ghost.

After successful enrichment: `FoundOnLinkedInCard` replaces the enrichment card contents (avatar monogram, headline, evidence bullets, confidence badge). Errors → `ErrorState` with retry.

Copy under title: "We use this to understand your background, credibility, and how Agentory should communicate."

### Step 2 — Company
Two-card rhythm:
1. **Company identity** — name, description, stage, team size.
2. **Web presence** — website URL, optional LinkedIn company URL (validated via `isLinkedInCompanyUrl`), favicon preview.

Below cards: `PagePreviewChips` showing Homepage / Pricing / Features / About / Customers / Careers with a subtle "Up to 10 pages · no broad web crawl" note.

Primary CTA: "Analyze company" (gated by `canAnalyzeCompany`). After success, small results strip: pages read count, extracted category, promise, audience hint.

### Step 3 — AI Research
Full "research theatre" screen.

- `ResearchTimeline` on the left showing 6 stages with per-stage status glyphs, animated scanning line moving down as `busy === 'draft'`.
- Right column: grid of `SourceEvidenceCard`s (one per page/source actually available from `founderResearch` + `companyResearch`), each with:
  - Source label (Homepage / Pricing / About / LinkedIn profile / etc.)
  - Status (Read / Extracted / Needs confirmation / Not enough evidence)
  - 2–4 clean extracted bullets (product category, main promise, audience hint, proof point)
  - Confidence badge
- Fallback empty tiles when Apify/Firecrawl env vars missing — friendly copy, not an error dump.
- Hero CTA at bottom: "Draft my Company Brain" (calls existing `draftBrain` → `draft` action). Loading state: gradient shimmer + copy "Reading evidence… drafting Brain…".

### Step 4 — Review Brain ("Brain Board")
Grouped `BrainSection`s in a 2-column masonry (≥ md):

1. **Targeting** — Ideal customers, Buyer personas, Company size, Geography.
2. **Signals** — Buying triggers, Jobs to watch, Tools to watch, Competitor signals.
3. **Messaging** — Pain points, Positioning, Content angles, Brand voice.
4. **Safety** — Disqualifiers, Bad-fit examples, Banned claims, Required evidence.

Each card via `BrainReviewCard` shows: AI-drafted badge, confidence, source proof count, needs-confirmation count, edit affordance, quick-action ghost pills. `ChipInput` replaces textareas with per-field smart empty states:
- "No bad-fit examples yet — add companies Agentory should avoid"
- "Add roles that should never be contacted"

All edits still flow through existing `applyQuickAction` / `setEdited`.

### Step 5 — Activate
`ActivationHero`:
- Large animated brain orb (SVG circle + `CompletenessRing` overlay + soft pulsing emerald glow).
- Readiness score + confidence chip + required-met counter.
- "What Agentory will use" grid — uses `BRAIN_POWERS` verbatim (Leads / Scout Radar / Content / Agents / Outreach). No fake agent names.
- "What still needs review" list (from `completeness.missing`) — collapsible.
- Safety reassurance strip: "No outreach sent · No Radar scan started · You stay in control".
- Primary CTA: "Activate Company Brain" with emerald glow. Copy: "Agentory will use this to qualify leads, score signals, draft content, and prepare outreach. Nothing sends automatically."

## Right-side live panel (`BrainPreviewPanel`) redesign

Sticky on desktop; collapsible bottom sheet on mobile.

Sections:
1. **Header** — animated completion orb (SVG ring + inner dot pulse), confidence chip, "AI draft ready" / "Last updated" timestamp.
2. **Agentory understands** — compact icon rows: Company / Market / Buyers / Signals / Disqualifiers / Confidence. Each row: icon, label, value, tiny state dot (green filled / amber ring / grey).
3. **Needs confirmation** — amber list only when `completeness.missing.length > 0`.
4. **Evidence** — source count ("12 sources across 4 pages") from research state.
5. **This powers** — grid of `BRAIN_POWERS` with on/off tint driven by `completeness.complete`.

No dashes, no plain rows — all use icon + typographic hierarchy.

## Responsive

- ≥ lg: 2-column with sticky 360 px right rail.
- md: single column, right panel becomes collapsible section above the step content.
- sm: full-width, chip-grid gracefully wraps, cards stack; step progress collapses to "Step n of 5 · <label>" pill with mini dots.

## Error & empty states

- Provider missing / research failed → `ErrorState` component (headline, plain-English cause, next steps, retry, "Continue manually"). Never surface raw backend error strings; existing `explain()` helper stays as the source of copy.
- Draft unavailable → step 3 CTA disabled with tooltip "Add a website first" or similar.
- Activation blocked → keep existing behaviour (`blocked_reasons` toast) but re-style as inline `ErrorState` inside the activation hero.

## Backend contract guardrails

- All 6 actions still called exactly where they are today via `supabase.functions.invoke('generate-company-brain-draft', …)`.
- `buildDraftInput`, `buildSavePatch`, `applyQuickAction`, `previewBrain`, `canEnrichFounder`, `canAnalyzeCompany`, `canContinue` used unchanged.
- No changes to `profile.signal_preferences`, `profile.icp`, `target_customer`, `buyer_personas`, `qualification_rules`, `evidence`, `missing_fields`, `brain_confidence`, `setup_status`, `founder`, `company`, `content_angles`, `disqualifiers`.
- No new secrets, no new env reads, no new fetches.
- `BRAIN_POWERS` labels used as-is (Leads / Scout Radar / Content / Agents / Outreach). No invented agent names.

## Validation

1. `bun run build` — must pass.
2. `tsgo --noEmit` on changed files — must pass.
3. `rg` sanity: exactly one call site each for `research_founder`, `research_company`, `'draft'`, `save_draft`, `activate`.
4. Playwright screenshot each step (`/onboarding/company-brain`) at 1280×1800 and 390×844 for the visual report.
5. Manual confirmations in final message: backend contract unchanged, no providers run, no migration/deploy, ready for manual QA.

## Out of scope (explicitly not touched)

- Any file under `supabase/`, `supabase/functions/`, `supabase/migrations/`.
- `src/lib/onboardingV3.ts`, `companyBrainCompleteness.ts`, `normalizeCompanyBrain.ts`, `onboardingDraftMap.ts`.
- `src/integrations/supabase/*`, secrets, RLS.
- `run-agent`, `run-radar-scan`, Apify, Firecrawl.
- Account A branch. Commit 4B.
