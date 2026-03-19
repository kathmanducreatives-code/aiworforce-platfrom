

## Fix: Make Glowing Grid Background Visible Across All Pages

### Root Cause Analysis

Three issues are preventing the grid background from showing:

1. **Missing CSS keyframes** — The `AuthenticatedBackground` component references three animations (`grid-drift`, `nebula-breathe`, `star-twinkle`) that **do not exist** in `index.css`. They were supposed to be added in earlier iterations but are absent.

2. **Opaque page backgrounds covering the grid** — Dozens of pages (Dashboard, EmailSequences, LeadScraper, CompetitorMonitor, etc.) wrap their content in `<div className="min-h-screen bg-background">`. Even though `[data-theme="dark"]` sets `--background` to transparent, many pages also use `bg-card`, `bg-card/95`, or other opaque values that stack on top.

3. **MainLayout has its own opaque layer** — `MainLayout.tsx` line 27 uses `bg-background` which creates another opaque layer between the fixed background and the page content.

### Plan

#### 1. `src/index.css` — Add the three missing keyframes

Add after the existing animation keyframes:

- `@keyframes grid-drift` — translateX/Y loop over 60s to create floating movement
- `@keyframes nebula-breathe` — scale 1 → 1.15 → 1 over 8s for breathing glow effect
- `@keyframes star-twinkle` — opacity 0.2 → 0.8 → 0.2 over 3s for star pulse

Also ensure the light theme `[data-theme="light"]` background is semi-transparent so the grid shows faintly in light mode too (user wants both modes).

#### 2. `src/components/MainLayout.tsx` — Remove opaque background

Change `bg-background` to `bg-transparent` on the wrapper div (line 27) so the fixed `AuthenticatedBackground` behind it remains visible.

#### 3. Bulk-fix page backgrounds — Replace opaque `bg-background` on page wrappers

The following pages have top-level `min-h-screen bg-background` wrappers that need `bg-background` removed or changed to `bg-transparent`:

- `Dashboard.tsx` (line 158)
- `EmailSequences.tsx` (line 267)
- `LeadScraper.tsx` (line 538)
- `InterviewScheduler.tsx` (line 60)
- `CompetitorMonitor.tsx` (line 78)
- `EmailSequenceSetup.tsx` (line 385)
- `FolderView.tsx` (lines 157, 170)
- `Candidates.tsx` (line 10)
- `ICPCandidateDetail.tsx` (lines 241, 250)
- `GoogleOAuthCallback.tsx` (line 91)

Each page's outermost `bg-background` will be replaced with `bg-transparent` so the fixed background layer shows through.

#### 4. `src/components/AuthenticatedBackground.tsx` — Conditional opacity for light mode

Wrap the component to read the current theme and reduce overall opacity to ~30% when in light mode, so the grid appears as a subtle watermark rather than clashing with light content.

---

### Files Modified
1. `src/index.css` — Add 3 missing keyframes, adjust light theme background transparency
2. `src/components/MainLayout.tsx` — Remove opaque bg
3. `src/components/AuthenticatedBackground.tsx` — Light mode opacity adjustment
4. ~10 page files — Replace `bg-background` with `bg-transparent` on outermost wrappers

