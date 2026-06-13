# Dashboard Redesign — AI Workforce Command Center

Frontend-only redesign of `src/pages/Dashboard.tsx`. No backend, schema, edge function, route, or auto-send changes.

## Scope

- Rewrite `src/pages/Dashboard.tsx` with a new layered layout.
- Add small presentational subcomponents in `src/components/dashboard/` (new folder).
- Reuse existing hooks: `useCompanyBrain`, `useSignalFeed`, `useApprovals`, `useSignalReviews`, `useWorkspace`, `useAuth`, `useTheme`.
- No new data fetching, no new tables, no new edge functions.

## New layout (top → bottom)

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Company Brain Readiness Card (only if incomplete)         │
├──────────────────────────────────────────────────────────────┤
│ 2. Hero: Today's AI Workforce Brief                          │
│    "Good afternoon, {first}" + dynamic brief sentence        │
│    [Review approvals] [Open Signal Feed] [Run growth wf]     │
├──────────────────────────────────────────────────────────────┤
│ 3. Metrics grid (4 cols desktop, 2 cols mobile, 2 rows)      │
│    Signals · Hot leads · Approvals* · Drafts*                │
│    Competitor signals · Content drafts · Saved/actioned · Time saved │
│    (* = action-emphasized: amber ring when > 0)              │
├──────────────────────────┬───────────────────────────────────┤
│ 4. AI Workforce Activity │ 5. What Needs Attention           │
│    Scout / Aria / Hawk / │    Task queue rows                │
│    Penn / Scribe / Pilot │    (approvals, drafts, brain,     │
│    with derived counts   │     competitor signals)           │
├──────────────────────────┴───────────────────────────────────┤
│ 6. Recommended Next Moves (4–5 premium action cards)         │
├──────────────────────────────────────────────────────────────┤
│ pb-32 spacer so floating chat composer never overlaps        │
└──────────────────────────────────────────────────────────────┘
```

## Section details

### 1. Company Brain Readiness Card
- Render only when `data.onboarding_completed === false`.
- Show missing items derived from `profile` keys: `icp`, `competitors`, `brand_voice`, `goals` (badge per missing item).
- If `profile` has none of the keys → "Setup needed". If some present → list missing as small chips.
- CTA "Set up now" → `/onboarding/company-brain`.
- Premium styling: emerald border, subtle gradient, Sparkles icon, agent name list in copy.

### 2. Hero — Today's AI Workforce Brief
- Greeting (existing logic) + first name.
- Dynamic sentence built from metrics:
  - "Your AI workforce surfaced {signals} signals, prepared {drafts} drafts, and needs approval on {approvals} items."
  - Empty fallback: "Your AI workforce is ready. Start by finding signals or completing Company Brain."
- Action buttons:
  - "Review approvals" → `navigate('/awaiting-you')`
  - "Open Signal Feed" → `navigate('/signals')`
  - "Run growth workflow" → `dispatchEvent(new CustomEvent('chat:send', { detail: { text: 'Run my weekly growth workflow.' } }))`
- Keep theme toggle + NotificationCenter on the right.

### 3. Metrics Grid
Eight `MetricCard`s. Cards needing user action (Approvals pending > 0, Drafts ready > 0) get an amber/emerald ring + small "View" link. Each card adds a one-line description below the number:
- Signals found — "{n} saved signals" → /signals
- Hot leads — "{n} marked hot" → /signals?filter=hot
- Approvals pending — "{n} need your review" → /awaiting-you (emphasized)
- Drafts ready — "{n} outreach drafts" → /content (emphasized)
- Competitor signals — "{n} new this week" → /competitors
- Content drafts — "{n} saved drafts" → /content
- Saved / actioned — "{n} signals worked" → /signals
- Time saved — "~{n}m this week" (no link)

### 4. AI Workforce Activity panel
Left column on desktop (lg:col-span-3). Six agent rows with `AgentAvatar`:
- Scout — "Found {signalsFound} signals" / "Waiting for first workflow."
- Aria — "Ranked {savedActioned} opportunities" / fallback.
- Hawk — "Tracked {competitorSignals} competitor signals" / fallback.
- Penn — "Prepared {outreachDrafts} outreach drafts" / fallback.
- Scribe — "Saved {contentDrafts} content drafts" / fallback.
- Pilot — "Coordinating your workflows" (always shown).
Each row clickable to relevant route. No invented data.

### 5. What Needs Attention panel
Right column (lg:col-span-2). Existing pattern, plus rows for:
- Approvals pending → /awaiting-you
- Drafts ready → /content
- Company Brain incomplete → /onboarding/company-brain (only when not completed)
- Competitor signals → /competitors
Empty state: friendly "All clear" copy.

### 6. Recommended Next Moves
Grid of 4–5 cards. Each navigates or dispatches `chat:send` only.
1. Find competitor conversations — chat:send "Find 5 competitor conversations for my company."
2. Draft outreach for hot leads — chat:send "Draft outreach for my highest-priority saved leads."
3. Create a founder post — chat:send "Write a founder LinkedIn post based on this week's activity."
4. Rank saved signals — chat:send "Rank my saved signals by fit and urgency."
5. Complete Company Brain — navigate `/onboarding/company-brain` (hidden if completed).

Card: icon, title, one-line subtitle, subtle hover lift.

## Copy sweep
Within Dashboard only, ensure no occurrences of: ScreeningPilot, candidate, screening, hiring pipeline, AI screening, placement, recruitment. Use Agentory vocabulary.

## Empty state behavior
When all counts are zero AND brain incomplete → hero falls back to "ready" copy; metrics still render zeros; Needs Attention shows Company Brain row + onboarding suggestions; Recommended Next Moves stays visible.

## Visual / design
- Reuse existing tokens (`bg-card`, `border-border`, `text-primary` emerald, etc.). No hardcoded colors beyond existing semantic Tailwind utilities already used in the file.
- Rounded-2xl cards, subtle borders, generous spacing, `pb-32` on outer container for chat composer clearance.
- Section headers: small uppercase tracking label + larger title.

## Files

Edited:
- `src/pages/Dashboard.tsx` — full rewrite of layout, composed from subcomponents below.

Created (presentational, no logic outside props):
- `src/components/dashboard/BrainReadinessCard.tsx`
- `src/components/dashboard/WorkforceBriefHero.tsx`
- `src/components/dashboard/MetricsGrid.tsx`
- `src/components/dashboard/WorkforceActivityPanel.tsx`
- `src/components/dashboard/NeedsAttentionPanel.tsx`
- `src/components/dashboard/RecommendedMoves.tsx`

Not touched: hooks, routes, sidebar, edge functions, schema, AwaitingYou, Signals, other pages.

## Safety
- All "run" / "draft" / "post" buttons either `navigate(...)` or dispatch `CustomEvent('chat:send', ...)`. Zero direct send/post/DM/comment calls.
- No new network calls, no new secrets, no new tables.

## Verification
- Rely on auto typecheck/build.
- Visual QA via preview: Dashboard renders without errors, sections appear in order, chat composer doesn't overlap last card, all buttons navigate or open chat (no auto actions), no recruiting copy left.

## Out of scope
- Backend / schema / functions.
- Sidebar, route, or other-page changes.
- New data sources or analytics tables.
- Production deploy.
