# Premium Company Brain Onboarding — Final Pass

The 10-step wizard at `/onboarding/company-brain` already exists (`src/pages/OnboardingCompanyBrain.tsx`, ~995 lines) with progress rail, agent chips, analysis animation, ChipInput, completeness ring, review collapsibles, and launch screen. The supporting pieces also exist: `useCompanyBrain`, `companyBrainSchema`, `onboardingDraftMap`, `brainCompleteness`, `BrainReadinessCard`, `CompanyBrainStrip`, `setup-company-brain` edge function, and Pilot chat gating in `supabase/functions/_shared/companyBrainGate.ts`.

This pass focuses on the **gaps vs. the spec** and a premium polish — not a rewrite.

## Scope

In scope (frontend only):
- Polish the wizard chrome and microcopy to match the spec.
- Add Dashboard entry points for both *incomplete* and *complete* Company Brain states, including **Restart onboarding**.
- Make the wizard re-entrant from the start when restarted, without destroying saved data.
- Add an "Add later / Skip for now" affordance on optional steps.
- Tighten Pilot chat gating to add the missing `analyze_url` / business-specific intents already enumerated in `companyBrainGate.ts` and ensure Pilot loads Company Brain context for gated prompts.

Out of scope (per user):
- Landing page, public site
- New database tables
- Supabase function shape changes (we only call existing `setup-company-brain` actions: `save_basics`, `save_sources`, `analyze`, `save_structured`, `finalize`)
- Any auto-send / auto-DM / auto-post / LinkedIn credential capture

## Changes

### 1. `src/pages/OnboardingCompanyBrain.tsx` — polish + restart support
- Read `?restart=1` from the URL. When present, **do not** auto-jump to the Review step during hydration; prefill values but start at Step 1.
- Add per-step "Skip for now" link on ICP, Competitors, Positioning, and Brand Voice (soft, secondary). "Welcome" keeps "I'll describe my company manually".
- Replace any "Required / Incomplete" copy with "Recommended / Add later / Needs a little more context".
- Tighten Welcome subtext, add the trust line "You can edit everything later."
- Ensure the Goals step renders all 7 spec options: add the missing **Weekly growth system** card alongside existing 6 (`leads`, `competitors`, `content`, `outreach`, `engagement`, `review`).
- Confirm graceful fallback copy when `analyze` returns warnings (already present — verify text matches spec).
- Confirm "nothing is sent without approval" line on Safety step.
- Review step: keep collapsible cards + readiness ring; add explicit **Edit details** secondary that jumps to the first incomplete step, and **Activate Company Brain** primary.
- Activation step: keep the staggered agent activation, then show the workflow cards. Cards must dispatch `chat:prefill` + `navigate(route)` only — never auto-send (already the behavior).

### 2. `src/pages/Dashboard.tsx` + new `src/components/dashboard/CompanyBrainStatusCard.tsx`
- Replace the current single `BrainReadinessCard` slot with a status card that handles **both states**:
  - **Incomplete or skipped:** Title "Company Brain setup", subtitle explaining why it matters, list missing sections from `computeCompleteness`, primary "Continue setup" → `/onboarding/company-brain`, secondary "Start from beginning" → `/onboarding/company-brain?restart=1`.
  - **Complete:** Title "Company Brain active", show `company_name`, `category`, readiness %, primary "Edit Company Brain" → `/onboarding/company-brain`, secondary "Restart onboarding" → `/onboarding/company-brain?restart=1` (confirm via a lightweight inline confirm — does not delete data).
- Keep the premium dark glass aesthetic already used on the dashboard.
- `CompanyBrainStrip` (top warning strip) stays for incomplete state, unchanged.

### 3. `src/lib/pilotChat.ts` + `supabase/functions/_shared/companyBrainGate.ts`
- Confirm `analyze_url`, `content_draft`, `source_signals`, `draft_outreach`, `enrich_existing_leads`, `rank_existing_leads`, `competitor_tracking` all gated (already in `GATED_INTENTS`).
- In the client classifier (`pilotChat.ts`), make sure prompts about "leads / outreach / competitors / content / signals / our website" map to a gated intent so the existing gate fires the `ONBOARDING_GATE_REPLY` when the brain is empty.

### 4. Microcopy + visuals (no logic)
- Apply soft tone strings across steps: "A rough answer is enough.", "You can edit this later.", "Not sure? Skip for now.", "Agentory will improve this as it learns."
- Audit headings for consistent eyebrow → title → subtitle hierarchy.
- Verify progress rail shows: step number, X of Y, label, and % at all viewports.

## Files touched

- edit `src/pages/OnboardingCompanyBrain.tsx`
- edit `src/pages/Dashboard.tsx`
- new  `src/components/dashboard/CompanyBrainStatusCard.tsx`
- edit `src/lib/pilotChat.ts` (intent classification tightening only)
- (optional) edit `supabase/functions/_shared/companyBrainGate.ts` only if a missing intent string is found during implementation

No DB migrations. No edge function deployments unless gate file is touched.

## Verification checklist

1. Fresh workspace (no brain row) → Dashboard shows "Company Brain setup" card + top strip; clicking takes user to Step 1.
2. User skips at Step 1 → returns to Dashboard, setup card still visible, "Start from beginning" reloads Step 1 with no data loss.
3. User completes flow → Dashboard shows "Company Brain active" card with company name, category, readiness %.
4. "Restart onboarding" from completed state loads Step 1 with all fields prefilled, does not wipe `company_brain.profile` (only re-saves on Activate).
5. Each step shows step number, progress %, and Back/Continue.
6. Website path: enter URL → analysis animation → fields prefilled → continue.
7. Website failure: warning shown softly, manual flow continues.
8. Refresh mid-flow keeps already-saved data (basics persist after `save_basics`).
9. Pilot chat with empty brain on a business-specific prompt returns the gate reply, not generic content.
10. Approval toggles default to safe; no auto-send anywhere; no LinkedIn credential prompts.
11. `bunx tsc --noEmit` passes.

## Out of plan / known gaps after this pass

- The `setup-company-brain` edge function's `analyze` quality is unchanged — better extraction would be a separate task.
- Per-agent activation status icons on Dashboard (post-activation) are not added; only the brain status card.
