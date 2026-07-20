# Lead Library — Implementation Plan

Build a premium `/leads` (Lead Library) experience that becomes the permanent home for every account Agentory discovers. Frontend-only work, using existing Supabase tables and hooks; no publish, deploy, migrations, secrets, or provider calls.

## Scope guardrails
- Frontend commits only. No `preview_ui--publish`, `supabase--deploy_edge_functions`, `supabase--migration`, or secret changes.
- No AI/model/scraper/outreach calls at implementation time. Synthetic fixture data is used only for local visual validation and gated behind a dev-only flag; nothing persists to Supabase from this work.
- Reuse existing tables: `accounts`, `contacts`, `lead_candidates`, `linkedin_leads`, `outreach_drafts`, `outreach_activities`, `deep_search_results`, `deep_search_analysis`, `scraping_sessions`, `lead_enrichments`, `workspace_members`. No schema changes — where required data is not stored yet, surface a truthful "not recorded" empty state instead of inventing it.
- Design tokens only (bg-background, text-foreground, primary/emerald, glass surfaces). Follow existing pages (Dashboard, CompanyBrainDashboard, Workbench) for typography, spacing, borders, drawers, chips, status pills.

## Route + navigation
- Keep `/leads`; replace the current 4-tab wrapper with the new Lead Library shell.
- Preserve access to legacy sub-pages by moving them under: `/leads/find` (LeadScraper), `/leads/icp` (ICPManager), `/leads/research` (DeepSearch). Sidebar entry stays "Leads" and points to `/leads`.
- Deep-link support: `/leads?tab=all|lists|runs|activity&view=<savedViewId>&lead=<id>`.

## Page shell
`src/pages/LeadLibrary.tsx`
- Header: title "Lead Library", supporting line, global search input, buttons: Add lead, Import, Export, Create list (Import/Export/Add open lightweight dialogs; CSV import is parse-and-stage-only in this pass — no writes without explicit confirm, and Add lead writes to `accounts` + `contacts` via existing client).
- Compact metric strip (All, Qualified, Contact-ready, Draft-ready, Contacted, Replied, Meetings) — each is a filter chip button. Counts derived client-side from the loaded lead set.
- Tabs: All leads · Lists · Search runs · Activity.
- Sticky filter bar + sticky bulk-action bar when rows are selected.

## Data layer
`src/hooks/leadLibrary/` (new)
- `useLeadLibrary.ts` — React Query. Joins `accounts` with latest `contacts` (selected recipient), latest `outreach_drafts`, latest `outreach_activities`, and `deep_search_analysis`. Workspace-scoped via existing workspace context.
- `useSearchRuns.ts` — reads `scraping_sessions` + `lead_enrichments` grouped by run.
- `useLeadActivity.ts` — unions `outreach_activities`, status changes we write locally, and derived events (lead created, research completed, opener generated).
- `useLeadLists.ts` / `useLeadTags.ts` — reads/writes list membership; if no list table exists today, persist in `localStorage` keyed by `workspace_id` and clearly label as "local to this browser" (documented gap).
- `src/lib/leadLibrary/normalize.ts` — canonical `LeadRow` shape used by table, detail, CSV, bulk actions (single source of truth, mirrors the pattern already used in Workbench).
- `src/lib/leadLibrary/status.ts` — separate enums for Account / Contact Readiness / Outreach / Engagement / LinkedIn / Email / Phone. Helpers compute readiness, next step, and manual-vs-integration provenance.
- `src/lib/leadLibrary/csv.ts` — canonical CSV export (fields per spec, no secrets, no raw prompts).

## Components (new, under `src/components/leads/library/`)
- `LibraryHeader.tsx` — title + actions + global search.
- `MetricStrip.tsx` — clickable summary metrics.
- `FilterBar.tsx` — searchable filter popovers, active-filter chips, Clear all, Save view.
- `SavedViews.tsx` — dropdown of workspace-scoped saved views (persist to localStorage in this pass).
- `LeadTable.tsx` — spacious table with the 10 columns from the spec, virtualized (`@tanstack/react-virtual` already in deps if present, otherwise plain windowing). Row selection + hover states.
- `columns/` — one small component per column: `CompanyCell`, `SourceCell` (signal-first labeling, "N sources · Strongest…"), `WhySelectedCell`, `FitCell`, `SelectedBuyerCell`, `ReadinessStack`, `OpenerPreviewCell`, `EngagementCell`, `NextStepCell`, `LastActivityCell`.
- `BulkActionBar.tsx` — sticky bar with count, readiness summary, ineligible count, actions (Add to list, Add tags, Assign owner, Mark contacted, Set follow-up, Archive, Export CSV, and the research/find-DM/generate-opener buttons — these last three only *stage* the action into the existing Workbench queue rather than firing anything from this page).
- `ListsTab.tsx`, `SearchRunsTab.tsx`, `ActivityTab.tsx`.
- `LeadDetailDrawer.tsx` — spacious right drawer, keyed by lead id (clean remount on selection). Sections: Account overview, Why this lead appeared, ICP qualification, Verified signals, Company research, Decision-makers, Selected recipient, Personalized opener, Contact tracking (manual updates that append to activity), Tasks & follow-up, Notes, Activity timeline, Source queries, Lists & tags, Technical source data (collapsed).
- `ManualStatusMenu.tsx` — enforces the "manual" vs "integration-confirmed" label rule; blocks selecting Delivered / Opened / LinkedIn Connected / Replied unless an integration event exists.
- `EmptyStates.tsx` — the five spec'd empty states.
- `SourceProvenance.tsx` — renders discovery method, source type, source details, discovery context, and full source history (never overwrites older source).
- `DuplicateBadge.tsx` — "Possible duplicate" with review UI (client-side heuristic: same normalized domain or LinkedIn slug within workspace).

## Truthfulness rules baked into UI
- All manual status changes render with a "Marked manually" chip + owner + timestamp.
- Integration-only states (email delivered/opened, LinkedIn connected, reply detected) are read-only surfaces; disabled if no integration event exists, with tooltip "Requires connected integration".
- Lead Detail data is strictly scoped to the selected lead id; if a fetch fails, drawer shows "Lead data could not be synchronized. Refresh this lead." — never falls back to sibling lead data.
- CSV export uses only canonical, sanitized fields.

## Files changed (planned)
- `src/pages/LeadLibrary.tsx` (new)
- `src/pages/Leads.tsx` (replace body with LeadLibrary; keep route)
- `src/App.tsx` (add `/leads/find`, `/leads/icp`, `/leads/research` routes)
- `src/components/leads/library/*` (new, ~15 files listed above)
- `src/hooks/leadLibrary/*` (new, 4 files)
- `src/lib/leadLibrary/{normalize,status,csv,dedupe,provenance}.ts` (new)
- Small tests: `normalize.test.ts`, `status.test.ts`, `csv.test.ts`, `dedupe.test.ts` (Vitest, no network).

## Backend / infra
- 0 migrations, 0 edge function deploys, 0 secrets, 0 provider calls, 0 model calls.
- Known gaps to be flagged in the final report (not fixed here): no dedicated `search_runs`/`lists`/`tags`/`lead_status` tables — lists/tags/saved views persist in `localStorage` for this pass; provenance history is displayed only when already stored on `accounts`/`lead_enrichments`/`scraping_sessions`; email open/delivery/LinkedIn connect events surface only when the corresponding integration row exists.

## Validation
- Vitest run for the new unit tests.
- `tsgo` typecheck.
- Manual visual pass in preview against the 11 synthetic scenarios from the brief using an in-memory fixture (dev-only flag `?fixtures=1`), verifying filters, lists/tags, Search Runs, provenance, buyer consistency, manual tracking, bulk-action eligibility, CSV output, no auto-send, no provider/model calls.

## Final report will include
Route, tabs, metrics, columns, filters, saved views, lists/tags, Search Runs, provenance display, contact availability, all status tracks (account/LinkedIn/email/phone/engagement), Lead Detail sections, activity timeline, tasks & follow-up, bulk actions, duplicate handling, CSV fields, manual-vs-integration labeling, responsive behavior, tests, TypeScript result, build result, backend files changed (0), migrations (0), Edge Functions deployed (0), providers/models called (0), frontend published (no), commit SHA, known backend/storage gaps, safe-to-review yes, safe-to-publish-after-review conditional on the flagged gaps being acceptable.
