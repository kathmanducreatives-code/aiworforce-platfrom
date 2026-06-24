# Post-Onboarding Product Guide

Goal: After Activate Company Brain, Pilot walks the user through Agentory's 6 core areas with a premium guided tour, plus persistent navigation help on every major page. Skippable, restartable, non-blocking, no fake data.

## 1. State & persistence

Store completion in `company_brain.profile.onboarding_meta` (already exists, no migration):

```
onboarding_meta: {
  product_tour_completed: boolean,
  product_tour_completed_at: string | null,
  product_tour_skipped_at: string | null,
  first_run_helper_dismissed: boolean,
}
```

- New hook `src/hooks/useProductTour.ts` wraps `useCompanyBrain` to read/write these flags via existing `setup-company-brain` `save_structured` action (extend allowlist to include the new keys — already permits `onboarding_meta`).
- Tour auto-opens once when: brain is activated AND `product_tour_completed` is false AND `product_tour_skipped_at` is null.
- Restart entry points set both flags back to false and open the tour.

## 2. Tour component

New folder `src/components/tour/`:

- `ProductTour.tsx` — premium overlay (dark glass card, Pilot avatar from `agentProfiles`, animated transitions via framer-motion already in project). Not a generic spotlight library — fixed centered modal with a "spotlight panel" describing the area, plus a small thumbnail/illustration. No DOM-anchored highlights (avoids brittle selectors and layout breaks at 1280/1440).
- `tourSteps.ts` — 6 steps: Dashboard, Workflows, Conversations, Workbench, Awaiting You, Company Brain. Each step: `{ id, agent: 'pilot', title, body, bullets[], primaryCta: {label, route}, illustration }`.
- Progress: numbered dots 1–6 + linear bar.
- Controls: Back, Next, Skip tour, "Take me there" (navigates to the page and closes tour).
- Final step → CTA "Start recommended workflow" using `recommendWorkflows` top result and the goal-based copy in section 8.

Step copy comes verbatim from the user's brief (sections 2 and 8).

## 3. Trigger points

- `OnboardingCompanyBrain.tsx`: after `launchVisible` activation success, set `product_tour_pending=true` in sessionStorage and redirect to `/dashboard` (existing flow). Dashboard mounts the tour on detecting pending OR uncompleted state.
- `MainLayout.tsx`: mount `<ProductTour />` once (renders null unless open) so it's available across pages without re-mount churn.

## 4. Restart entry points

- Dashboard: "Restart product tour" link in the first-run helper card and in a small "?" menu in the header.
- User menu (existing avatar dropdown in `MainLayout`): add "Restart product tour".
- Help & Support: add a "Restart product tour" button on `SettingsIntegrations` help section (or new lightweight `/help` if missing — confirm in build).
- Command palette (existing global search): add a command "Restart product tour".

## 5. First-run helper card (Dashboard)

New `src/components/dashboard/FirstRunHelper.tsx`:

- Shows when `first_run_helper_dismissed` is false.
- 3-step checklist: Run a workflow → Review output in Workbench → Approve next actions.
- CTAs: Run recommended workflow (links to `/workflows` with top recommendation pre-selected), Open Workflows, Ask Pilot, Skip.
- Dismiss persists to `onboarding_meta.first_run_helper_dismissed`.

## 6. Page-level empty states

Update empty states only — no data shape changes — on:

- `Dashboard.tsx` — replace existing first-run banner empty copy with the brief's text.
- `Workflows.tsx` — empty/recommended header copy.
- `Conversations` (chat workspace empty view) — Ask Pilot copy.
- Workbench surfaces (`Leads.tsx` table empty, output panels in `OutreachEngine.tsx`, `LeadCRM.tsx`) — "Your results will appear here after a workflow runs."
- `AwaitingYou.tsx` — "No approvals yet. Drafts and risky actions wait here before anything is sent."

All empty states use the existing glass surface tokens (`bg-card/40`, emerald accent) — consistent with Verdant theme.

## 7. Contextual "What is this?" micro-help

New `src/components/help/InfoHint.tsx`:

- Small `(i)` icon button → shadcn `Tooltip` (or `Popover` on mobile).
- Single `helpContent.ts` registry keyed by term: `company_brain`, `workflows`, `workbench`, `awaiting_you`, `setup_needed`, `draft_only`, `locked_columns`, `credits`, `agent_role`.
- Drop `<InfoHint topic="setup_needed" />` next to labels in `Workflows.tsx`, `AwaitingYou.tsx`, lead tables, and agent cards. No layout changes — inline icon.

## 8. "Ask Pilot about this page"

New `src/components/help/AskPilotAboutPage.tsx`:

- Small ghost button in each major page header.
- A `pagePromptRegistry.ts` maps route → prompt, e.g. `/workflows` → "Explain the Workflows page and what I should do first. Reference my Company Brain."
- On click: opens the existing chat workspace (use `ChatWorkspaceContext`) and dispatches a new conversation pre-seeded with the page prompt. Pilot already receives `buildCompanyBrainContext` so answers are personalized.

Mounted on: Dashboard, Workflows, Conversations, Workbench pages (Leads, OutreachEngine, LeadCRM), AwaitingYou, Agents, Company Brain settings.

## 9. Goal-aware recommended first move

Extend `src/lib/workflows/recommend.ts`:

- New `recommendFirstMove(brain)` returns `{ headline, body, workflowSlug }` keyed by `workflow_preferences.primary_goal` (`leads`, `content`, `research`) with the exact copy from the brief.
- Used by both the tour's final step and the Dashboard FirstRunHelper "Run recommended workflow" CTA.

## 10. Out of scope / explicit non-goals

- No DB migration — uses existing `company_brain.profile.onboarding_meta`.
- No real tour-library dependency (no Shepherd/Driver.js). Built with framer-motion + shadcn Dialog/Card.
- No fake activity, no auto-run of outreach. The recommended workflow CTA reuses the existing safe draft-only run path.
- No changes to routes, auth, or RLS.

## 11. Technical notes

```
New files:
  src/hooks/useProductTour.ts
  src/components/tour/ProductTour.tsx
  src/components/tour/tourSteps.ts
  src/components/dashboard/FirstRunHelper.tsx
  src/components/help/InfoHint.tsx
  src/components/help/helpContent.ts
  src/components/help/AskPilotAboutPage.tsx
  src/components/help/pagePromptRegistry.ts

Edited:
  src/components/MainLayout.tsx          (mount ProductTour, header restart link)
  src/pages/Dashboard.tsx                (FirstRunHelper, empty copy, AskPilot)
  src/pages/Workflows.tsx                (empty copy, InfoHint, AskPilot)
  src/pages/AwaitingYou.tsx              (empty copy, InfoHint, AskPilot)
  src/pages/Leads.tsx + OutreachEngine.tsx + LeadCRM.tsx (workbench empty + AskPilot)
  src/pages/Agents.tsx                   (agent role InfoHint)
  src/pages/OnboardingCompanyBrain.tsx   (set product_tour_pending on activate)
  src/lib/workflows/recommend.ts         (recommendFirstMove)
  src/lib/companyBrainSchema.ts + supabase/functions/_shared/companyBrainSchema.ts
                                         (extend onboarding_meta keys)
  supabase/functions/setup-company-brain/index.ts
                                         (allow new onboarding_meta keys in save_structured)

Tests:
  src/lib/workflows/recommend.test.ts    (add recommendFirstMove cases)
  src/components/tour/tourSteps.test.ts  (6 steps, copy snapshot, ids unique)
```

## 12. QA checklist

- Fresh user: finish onboarding → activate → tour appears on Dashboard automatically.
- Step through all 6 steps; verify copy, progress, Back/Next/Skip/Take me there.
- Skip → tour closes, does not reappear on refresh, restart works from user menu, dashboard, command palette, help.
- FirstRunHelper appears once; dismiss persists.
- Empty states render correct copy on each page with no real data.
- InfoHint tooltips render on desktop, popover on touch.
- "Ask Pilot about this page" opens chat with correct seeded prompt; Pilot uses Company Brain context.
- Recommended first move matches `primary_goal`.
- No layout shift at 1280 and 1440 widths.
- Typecheck and existing tests pass; no new runtime errors.
