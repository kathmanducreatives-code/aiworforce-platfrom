## Company Brain Onboarding — Premium Redesign

Pure UI/UX makeover of the 5-step flow. Backend contract, action names, payloads, save/activate rules, and route (`/onboarding/company-brain`) all unchanged.

### Visual system (locked to project's Verdant theme)

- Pitch-black `bg-background` with a soft radial emerald wash behind the shell (`bg-gradient-to-b from-emerald-500/[0.04] via-transparent to-transparent`).
- Typography: existing display + body fonts already in the app; step title jumps to `text-4xl` tracking-tight, section titles `text-sm uppercase tracking-[0.14em] text-muted-foreground`.
- Semantic tokens only — `primary`, `card`, `border`, `muted`, `emerald` (already themed). No hex.
- Cards: `rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm shadow-[0_1px_0_hsl(var(--border))_inset]`, generous `p-6` / `p-8`.
- Subtle motion: framer-motion (already in project) — 200 ms fade+8 px slide on step transitions, spring on the completeness ring.

### New shell (`OnboardingCompanyBrain.tsx`)

Replaces the current shell only; step handlers and edge-function calls stay bit-identical.

```
┌────────────────────────────────────────────────────────────┐
│ Top bar: Agentory mark · "Company Brain setup" · Save draft│
├──────────────────────────────┬─────────────────────────────┤
│  Stepper (5 elegant chips)   │                             │
│                              │  LIVE PREVIEW PANEL         │
│  H1 step title               │  – Ring: completeness %     │
│  Sub: "This powers …"        │  – Confidence badge         │
│                              │  – What Agentory knows      │
│  Step content card(s)        │  – Needs confirmation       │
│                              │  – "This powers" (Leads,    │
│  Primary CTA · Secondary     │    Radar, Content, Agents,  │
│                              │    Outreach — from          │
│  Reassurance strip           │    BRAIN_POWERS constant)   │
└──────────────────────────────┴─────────────────────────────┘
```

- Left column `max-w-[640px]`; right rail `w-[360px]` sticky, becomes a collapsible accordion under `lg`.
- Stepper: 5 pill chips connected by a thin gradient rail that fills to current step; check-mark on completed, ring pulse on active.
- Every step ends with a fixed footer nav (Back · Save draft · Continue/Activate).

### Per-step polish (behavior unchanged)

1. **Founder** — two glass cards: "About you" and "Enrich from LinkedIn". Consent checkbox restyled as a soft toggle row with lock icon + one-line privacy note. Result panel becomes an inline "Found on LinkedIn" card with avatar-placeholder monogram, credibility chips, GTM-relevance chips.
2. **Company** — same two-card rhythm. Description textarea auto-grows. Result becomes a mini "site read" card with favicon (from `www.google.com/s2/favicons`), pages-read chips, proof-point quotes.
3. **AI Research** — hero moment: two large SourceTiles side-by-side with status glyphs, then a single wide CTA `Draft my Company Brain` with a shimmer/loading state that swaps label to "Reading evidence… drafting Brain…". Falls back to a friendly empty state if neither source ran.
4. **Review Brain** — the marquee screen. Replaces the vertical stack with a 2-column masonry of `BrainReviewCard`s on ≥ md. Each card gets:
   - a header row with icon + title + one badge (`AI drafted` / `Needs confirmation` / `High confidence` / `Missing proof`) driven by existing `confidence` / `needs_confirmation` data,
   - a "Sources" footer with domain chips (from `evidence.source_pages`),
   - inline `EditableList` refreshed as chip-input with add/remove, not a comma textarea.
   Quick-action row becomes small ghost pills below the card body.
5. **Activate** — centered "launch" card with animated circular completeness ring (SVG), confidence badge, "What this powers" grid (from `BRAIN_POWERS` — real names only), missing-fields list, and a large primary `Activate Company Brain`. Reassurance strip: three inline pills — "No outreach sent" · "No Radar scan started" · "You stay in control".

### Files to change

- `src/pages/OnboardingCompanyBrain.tsx` — full rewrite of presentation; keep `analyzeFounder`, `analyzeCompany`, `draftBrain`, `persist`, `onQuickAction`, all edge-function calls, imports from `onboardingV3` and `normalizeCompanyBrain` **unchanged**.
- `src/components/onboarding/BrainPreviewPanel.tsx` — redesign into sticky rail with SVG completeness ring, sections (Knows / Needs confirmation / Powers), same props.
- `src/components/onboarding/BrainReviewCard.tsx` — restyle header/footer, add badge computation from existing props; API unchanged.
- New `src/components/onboarding/StepProgress.tsx` — extracted premium stepper.
- New `src/components/onboarding/ChipInput.tsx` — replaces the comma-textarea `EditableList` inside the review step (behavior identical: emits `string[]`).
- New `src/components/onboarding/CompletenessRing.tsx` — reusable animated SVG ring.
- `src/components/onboarding/BrainOrb.tsx` — small polish only; used as the shell hero mark.

### Non-goals / guardrails

- No changes to `src/lib/onboardingV3.ts`, `companyBrainCompleteness.ts`, `normalizeCompanyBrain.ts`, `onboardingDraftMap.ts`, or any test file.
- No changes to any edge function, migration, secrets, RLS, `run-agent`, `run-radar-scan`, Account A branch, Commit 4B.
- No new provider calls; buttons still gated by `canEnrichFounder` / `canAnalyzeCompany`.
- No fake agent names — "What this powers" is rendered from the existing `BRAIN_POWERS` constant only.
- Error paths keep `explain()` messages verbatim; the amber notice becomes a friendlier inline banner but same copy source.
- Responsive: two-column on ≥ `lg`, single column with the preview collapsed into an accordion on mobile.

### Validation before finishing

- `bun run build` (project uses bun).
- Type check via the harness (`tsgo`).
- Route sanity via Playwright: load `/onboarding/company-brain`, screenshot each of the 5 steps (mocking `supabase.functions.invoke` is not needed — steps 1 & 2 render without calling providers; skip forward through steps to screenshot).
- Grep to confirm: `research_founder`, `research_company`, `draft`, `save_draft`, `activate` still appear in `OnboardingCompanyBrain.tsx` exactly once each.

### Final report will include

1. list of changed/new UI files
2. per-step visual description + Playwright screenshots
3. confirmation the 6 backend action calls and their payloads are byte-identical
4. confirmation no provider ran, no migration, no deploy
5. mobile + laptop screenshots
6. remaining manual-QA checklist (activate blocked-reasons, skipped enrichment, provider-not-configured banners)
