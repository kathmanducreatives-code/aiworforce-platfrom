## Goal

Replace the centered modal product tour with a Pilot-led **spotlight tour** that highlights real UI elements (sidebar items, command dock, page areas) and anchors a small glass guide card next to each one. The tour teaches *where* each feature lives, *what* it's for, and *what to try first*.

No DB migrations, no landing-page changes, no automation/email side-effects. All existing tour state, copy registry, first-run helper, and restart entry points are preserved.

---

## 1. Tag the real UI with stable anchors (no visual change)

Add `data-tour="<id>"` attributes to existing elements so the spotlight can find them across routes:

- `src/components/Sidebar.tsx` — add per-item `data-tour` to the NavLinks:
  - `sidebar-dashboard`, `sidebar-conversations`, `sidebar-workflows`, `sidebar-awaiting`, `sidebar-company-brain`
  - (Conversations and Dashboard share `/dashboard`; we tag both rows by `label` match.)
- `src/components/dock/CommandDock.tsx` — add `data-tour="command-dock"` on the outer container.
- `src/pages/Dashboard.tsx` — add `data-tour="dashboard-main"` on the main grid wrapper.
- `src/pages/Workflows.tsx` — add `data-tour="workflows-featured"` on the "Start here" / featured section (fallback to the workflow grid if missing).
- `src/pages/AwaitingYou.tsx` — add `data-tour="awaiting-queue"` on the queue container.
- `src/pages/OnboardingCompanyBrain.tsx` — add `data-tour="company-brain-main"` on the page wrapper.

These are purely additive attributes — no style or logic changes.

---

## 2. New spotlight tour engine

### `src/components/tour/useAnchorRect.ts` (new)
Hook that:
- Resolves a CSS selector to an element, returns its `DOMRect` (in viewport coords).
- Re-measures on `resize`, `scroll` (capture), `MutationObserver` on `<body>`, and a `requestAnimationFrame` poll for 1s after route changes.
- Returns `null` if the anchor is missing, so the card can fall back to centered.

### `src/components/tour/SpotlightOverlay.tsx` (new)
- Fixed full-viewport SVG overlay at `z-[115]`.
- Renders a dark mask (`rgba(0,0,0,0.55)`) with a rounded-rect cutout around the anchor rect (padding ~8px, radius ~12px), using SVG `mask` with `fill-rule: evenodd`.
- Adds an animated emerald ring (`stroke="#10b981"`, soft glow filter) around the cutout.
- Click on the mask (outside the cutout) triggers `onDismiss` (skip).
- Clicks inside the cutout pass through (`pointer-events: none` on the mask path, `auto` on backdrop).
- When no anchor rect, renders a subtler full-screen dim only (no cutout).

### `src/components/tour/GuideCard.tsx` (new)
Small glass card (~320–360px wide) at `z-[120]`, used by ProductTour:
- Pilot avatar, eyebrow "Pilot · Workforce guide", "Step N of 6".
- Title, 3-line body, and the **Where / Use it for / Try first** mini-grid (rendered from the new step fields).
- Footer: Back · Skip · "Open <feature>" (secondary) · Next/Finish (primary).
- Subtle emerald border + glow, `bg-[#0a0c0a]/92 backdrop-blur-xl`.
- Receives `anchorRect`, computes placement (right of sidebar items, above the dock, below top areas, beside cards) with viewport clamping. Falls back to centered when `anchorRect` is null or viewport < 900px wide.
- Renders an SVG pointer/arrow from card edge to the anchor when placed adjacent.

### `src/components/tour/ProductTour.tsx` (rewrite)
- Keep public API: default export + `restartProductTour()` event.
- Keep `useProductTour` integration (auto-open, skip/complete/restart persistence in `onboarding_meta`). **No changes to `useProductTour.ts`.**
- New flow per step:
  1. If step has `route` and current path !== route, do nothing extra (user can press "Open <feature>" to navigate; tour stays active across routes because it's mounted in `MainLayout`).
  2. Resolve `step.anchorSelector` via `useAnchorRect`.
  3. Render `<SpotlightOverlay rect={rect} onDismiss={skip} />` + `<GuideCard rect={rect} step={...} />`.
- "Open feature" button: `navigate(step.route)` and keeps tour open; anchor re-measures after route render.
- Keyboard: Esc = skip, ← / → = back / next.

---

## 3. Updated step data — `src/components/tour/tourSteps.ts`

Extend `ProductTourStep` with:
```ts
where: string;
useItFor: string;
tryFirst: string;
route: string;             // "Open <feature>" target
anchorSelector: string;    // primary anchor
fallbackSelector?: string; // optional secondary
placement?: 'right' | 'left' | 'top' | 'bottom' | 'auto';
```

Six steps, all wired to real anchors:

1. **Dashboard** — `[data-tour="sidebar-dashboard"]`, fallback `[data-tour="dashboard-main"]`, placement `right`, route `/dashboard`.
2. **Workflows** — `[data-tour="sidebar-workflows"]`, fallback `[data-tour="workflows-featured"]`, placement `right`, route `/workflows`.
3. **Conversations** — `[data-tour="sidebar-conversations"]`, fallback `[data-tour="command-dock"]`, placement `right` (sidebar) or `top` (dock).
4. **Workbench** — no sidebar entry. Anchor `[data-tour="workflows-featured"]` when on `/workflows`, else centered with copy explaining "appears after a workflow runs". Route: `/workflows`.
5. **Awaiting You** — `[data-tour="sidebar-awaiting"]`, fallback `[data-tour="awaiting-queue"]`, placement `right`, route `/awaiting-you`.
6. **Company Brain** — `[data-tour="sidebar-company-brain"]`, fallback `[data-tour="company-brain-main"]`, placement `right`, route `/onboarding/company-brain`.

Copy uses the **Where / Use it for / Try first** structure from the brief; existing `tourSteps.test.ts` updated to assert the new fields (length > 0).

---

## 4. Page-level micro-help

Add a single subtle helper line under the page title on:
- `src/pages/Workflows.tsx` — "Pick a workflow when you want a repeatable process. Use Conversations when you want custom work."
- `src/pages/AwaitingYou.tsx` — "Drafts and risky actions wait here. Nothing is sent without approval."
- `src/pages/OnboardingCompanyBrain.tsx` — "Update this when your ICP, offer, voice, or goals change."
- Conversations helper text is added to the empty/intro area on `Dashboard.tsx` only if there's a clean slot; otherwise skipped (no Conversations page exists separately).

Styled as `text-[12.5px] text-neutral-400` next to existing `AskPilotAboutPage` chips. No new components.

---

## 5. First-run helper

No behavior change. It already shows after onboarding and offers Restart tour. Keep as-is.

---

## 6. Files changed

**New**
- `src/components/tour/useAnchorRect.ts`
- `src/components/tour/SpotlightOverlay.tsx`
- `src/components/tour/GuideCard.tsx`

**Edited**
- `src/components/tour/ProductTour.tsx` — rewritten to use spotlight engine; preserves public API.
- `src/components/tour/tourSteps.ts` — extended schema + anchors + Where/Use/Try copy.
- `src/components/tour/tourSteps.test.ts` — assert new fields.
- `src/components/Sidebar.tsx` — add `data-tour` per item (purely additive).
- `src/components/dock/CommandDock.tsx` — add `data-tour="command-dock"`.
- `src/pages/Dashboard.tsx` — add `data-tour="dashboard-main"`.
- `src/pages/Workflows.tsx` — add `data-tour="workflows-featured"` + helper line.
- `src/pages/AwaitingYou.tsx` — add `data-tour="awaiting-queue"` + helper line.
- `src/pages/OnboardingCompanyBrain.tsx` — add `data-tour="company-brain-main"` + helper line.

**Unchanged**
- `useProductTour.ts`, `FirstRunHelper.tsx`, `AskPilotAboutPage.tsx`, edge functions, DB, routes.

---

## 7. QA

- Typecheck + `tourSteps.test.ts` pass.
- Manual: complete onboarding → tour auto-opens → step 1 highlights Dashboard nav row with emerald ring and a card to its right.
- "Open Workflows" navigates and the highlight re-attaches to the Workflows row.
- Esc and Skip both close + persist `product_tour_skipped_at`.
- Finish persists `product_tour_completed`. Tour does not re-open. Restart from FirstRunHelper reopens at step 1.
- Sidebar collapsed (68px): highlight still wraps the icon row; card placement clamps inside viewport.
- 1280 and 1440 widths verified visually.

## 8. Out of scope / not touched

- No DB migrations. No edits to `useProductTour.ts` persistence shape.
- No landing page edits.
- No new automation, email, DM, or webhook triggers.
- No changes to Workbench, Workflow run engine, or Company Brain edge functions.
