
# Agentory UI Restructuring Pass

Frontend/presentation only. No backend, schema, or edge function changes. No route deletions — only consolidation + redirects.

## 1. Sidebar restructure (`src/components/Sidebar.tsx`)

Collapse 4 groups → 4 groups, fewer items:

```text
Workspace
  Dashboard             /dashboard
  Signals               /signals
  Conversations         /dashboard  (placeholder until /conversations exists)
  Awaiting You          /awaiting-you  (badge preserved)

Growth
  Leads                 /leads
  Competitors           /competitors
  Content               /content

AI Team
  Agents                /agents
  Company Brain         /onboarding/company-brain

Settings
  Integrations          /settings/integrations  (new stub)
  Email Sequences       /email-sequences
```

Bottom: Help & Support, Sign Out, Collapse (unchanged).

Removed from sidebar (routes preserved, accessible by URL): Talent room, Growth room, Intelligence room, Content room, Lead Scraper, ICP Intelligence, Deep Search, Growth Signals, Talent Intel, Competitor Intel, Analytics, Interviews, "New Agent" button (moves inside `/agents`).

Also remove the duplicate in-sidebar search button (CommandBar already exposes ⌘K globally).

## 2. Route consolidation (`src/App.tsx`)

Add new pages + redirects (use `<Navigate replace>` to keep deep links working):

| Old route | New behavior |
|---|---|
| `/lead-scraper` | Redirect → `/leads` |
| `/icp-intelligence` | Redirect → `/leads?tab=icp` |
| `/deep-search` | Redirect → `/leads?tab=research` |
| `/talent-intel` | Redirect → `/leads?tab=people` |
| `/growth-signals` | Redirect → `/signals` |
| `/competitor-intel` | Redirect → `/competitors` |
| `/analytics` | Redirect → `/dashboard` |
| `/rooms/:dept`, `/departments` | Redirect → `/agents` |
| `/interview-scheduler` | Redirect → `/settings/integrations` (kept reachable, hidden) |
| `/post-interceptor`, `/lead-crm`, `/outreach-engine` | Stay accessible, not in sidebar |

New routes: `/leads`, `/competitors` (already exists as CompetitorMonitor — wrap with new shell), `/content`, `/agents`, `/settings/integrations`.

## 3. New pages (thin shells that wrap existing functionality)

- **`src/pages/Leads.tsx`** — Tabs: Find leads / Saved / ICP / Research. Each tab renders existing components: `LeadScraper`, `LeadCRM`, `ICPManager`, `DeepSearch`. GTM copy, no candidate language.
- **`src/pages/Competitors.tsx`** — Wraps existing `CompetitorMonitor` + `CompetitorIntelligence` views in one premium shell. Buttons: Add competitor / Find conversations / Analyze my website. Hide Firecrawl key warning unless `import.meta.env.DEV`.
- **`src/pages/Content.tsx`** — Surfaces founder post drafts, comment drafts, engagement opps from `saved_outputs` + `outreach_drafts` already loaded by `useSignalFeed`. Buttons: Create post / Find posts to comment on / Build content loop (each dispatches existing `chat:send` actions).
- **`src/pages/Agents.tsx`** — Cards for Pilot, Scout, Aria, Hawk, Penn, Scribe (sourced from `src/data/dockAgents.ts` / `agentProfiles.ts`). Each card: role, capabilities, last activity, Start task → opens AgentBuilder or `chat:send`. Includes "New Agent" button.
- **`src/pages/SettingsIntegrations.tsx`** — Stub linking to Email Sequences, Interviews, OAuth.

## 4. Dashboard rewrite (`src/pages/Dashboard.tsx`)

Replace ScreeningPilot/recruiting metrics with GTM cards: Signals found • Hot leads • Competitor signals • Content drafts • Pending approvals • Outreach drafts • Saved/actioned signals • Time saved. Data pulled from existing hooks (`useSignalFeed`, `useApprovals`, `useSignalReviews`) — no new queries.

Top banner "Complete Company Brain Setup" rendered when `useCompanyBrain().onboarding_completed !== true` (keep existing logic, restyle as prominent hero).

Replace Getting Started steps:
1. Set up Company Brain
2. Find signals (Scout)
3. Review and act (Aria + Scribe + Penn)

Strip: "Welcome to ScreeningPilot", "Create a Screening Job", "Source Talent", "Review Candidates", hiring pipeline / total candidates / AI screening copy.

## 5. Awaiting You copy pass (`src/pages/AwaitingYou.tsx`)

Replace recruiting wording with: pending approvals, outreach drafts, email send approvals, comment/DM draft approvals, content approvals. All actions remain approval-gated (no auto-send introduced).

## 6. Signals page (`src/pages/Signals.tsx`, `src/components/signals/*`)

No structural change. Light copy sweep only: confirm competitor metadata + review states + bulk actions all still wired (already implemented in Phases 5–7).

## 7. Global copy rules

Sweep visible strings in: Dashboard, Sidebar, Awaiting You, new pages, MobileHeader, CommandBar, CommandPalette, empty states.

- candidate → lead / person / contact
- screening → review / ranking / qualification
- resume/placement/recruitment/hiring pipeline/screening job → drop or rephrase

Exceptions: `CandidateApply`, `BookInterview`, `JobApplicants`, `ScreeningJobs` (explicit hiring features) keep their wording. Internal variable/table/column names untouched.

## 8. Polish

- Remove dummy room messages (repeated "ok") in chat workspace mock data if present.
- Confirm chat composer bottom padding (already fixed Phase 5) still clears new pages.
- Consistent empty states (reuse existing `EmptyState` standard).
- Keep dark premium tokens; no hardcoded hex.

## 9. Safety (unchanged)

No auto-comment / auto-DM / auto-send code paths added. All new buttons dispatch `chat:send` or open drafts.

## 10. Verification

- Frontend typecheck (auto-run by harness).
- Visual check via preview: sidebar count down, Dashboard says "Agentory", redirects resolve, new pages render.
- Grep for "ScreeningPilot", "candidate", "screening" in user-visible strings outside the recruiting exception files.

## Files changed (estimate)

Edited: `src/components/Sidebar.tsx`, `src/App.tsx`, `src/pages/Dashboard.tsx`, `src/pages/AwaitingYou.tsx`, `src/components/MobileHeader.tsx` (nav parity), `src/components/shared/CommandPalette.tsx` (entries).
Created: `src/pages/Leads.tsx`, `src/pages/Competitors.tsx`, `src/pages/Content.tsx`, `src/pages/Agents.tsx`, `src/pages/SettingsIntegrations.tsx`.

## Out of scope

- No DB migrations, no edge function edits, no new tables.
- No deletion of legacy page files (kept for redirect targets / direct URL access).
- No production deploy.
