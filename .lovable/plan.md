# Agentory Lead Library — Architecture & UX Plan (read-only)

## 1. Current architecture (audit)

Lead-adjacent surfaces today:

- `src/pages/Leads.tsx`, `LeadCRM.tsx`, `LeadScraper.tsx` — three overlapping lead UIs.
- `src/pages/Content.tsx`, `Signals.tsx`, `Dashboard.tsx` surface leads transiently.
- Workbench: `src/components/chat/workspace/workbench/leadTable/*`, `useLeadResults`, `useConversationActions`. Rows live inside chat tool-call results (`tool_calls`) and are re-derived on load.
- Scraper/scout: `scraping_sessions`, `lead-scraper/*`, `SavedSearches.tsx`.
- Persistence hits: `accounts`, `contacts`, `lead_candidates`, `lead_enrichments`, `linkedin_leads`, `outreach_leads`, `outreach_drafts`, `signals`, `signal_reviews`, `activity_feed`, `tasks`, `saved_outputs`, `conversations`/`messages`/`tool_calls`.
- Deduplication: none deterministic — `linkedin_leads` and `outreach_leads` are parallel silos to `accounts`/`contacts`.
- Provenance: `lead_candidates.conversation_id` + `plan_id` exist but are not surfaced; no `search_runs` table.
- Selected recipient: derived per render inside Workbench, not persisted per lead — same bug pattern seen in earlier tickets.

**Durable today:** accounts, contacts, lead_candidates, lead_enrichments, outreach_drafts, activity_feed, tasks, signals.
**Transient today:** Workbench row selection, "why selected", search query text, recipient choice, per-lead readiness flags, opener eligibility state.

## 2. Canonical domain model (reuse-first)

Reuse:

- `accounts` = LEAD ACCOUNT (add computed columns via a view, not new table).
- `contacts` = CONTACT (add `is_selected_recipient bool`, `role_family`, `employer_verified_at`).
- `lead_candidates` = SOURCE ASSOCIATION row (many-to-one to `accounts`) — keep one row per (account, search_run).
- `lead_enrichments` = research payload per account/contact.
- `outreach_drafts` = generated opener per (account, contact).
- `activity_feed` = ACTIVITY (extend `event_type` enum, add `account_id`, `contact_id`, `channel`).
- `tasks` = follow-up/next action.
- `signals` + `signal_reviews` = VERIFIED SIGNAL.

New (minimal):

- `search_runs` (workspace_id, user_id, conversation_id, plan_id, source ['chat'|'scout'|'workflow'|'import'|'workbench'], query_text, interpreted_filters jsonb, tool, status, result_count, accepted_count, rejected_count, cost_cents, created_at).
- `lead_lists` (workspace_id, name, kind ['list'|'saved_view'|'tag'], filter_json, color).
- `lead_list_members` (list_id, account_id, added_by, added_at).
- `lead_status` — narrow denormalized row per account for fast filtering (see §3).

Retire (or wrap behind adapter): `linkedin_leads`, `outreach_leads` — write-through migration into `accounts`/`contacts`/`outreach_drafts` scheduled for Phase 2.

## 3. Status model (six independent groups)

Store as columns on `lead_status`:

- `qualification`: new · researching · qualified · soft_mismatch · disqualified · archived
- `contact_readiness`: none · finding · verified · needs_review
- `outreach`: not_generated · generating · draft · edited · approved · skipped · failed
- `engagement`: not_contacted · contacted · replied · meeting · opportunity · won · lost
- `linkedin`: not_started · viewed · requested · connected · sent · replied · not_interested
- `email`: unavailable · draft · sent · delivered · opened · replied · bounced · unsubscribed
- `call`: not_attempted · attempted · no_answer · connected · callback

Every non-manual state must be gated on an integration source (`source: 'manual'|'gmail'|'linkedin'|'calendar'`). MVP ships manual-only; UI never claims `opened`/`delivered` without integration provenance.

## 4. Page IA

Routes: `/leads` (All), `/leads/lists`, `/leads/runs`, `/leads/activity`, `/leads/:accountId`.

Header KPI strip: total · qualified · contact-ready · draft-ready · contacted · replied · meetings.

Table columns: Account · Why selected · Source query (chip) · Fit · Signal · Selected buyer · Research · Opener · Engagement · Next action · Owner · Last activity.

Sticky filter bar (left) + table (main) + peek drawer (right) for lead detail preview. Full detail on `/leads/:accountId`.

Responsive: 3-pane at ≥1440, collapse peek at ≥1024, list-only + full-page detail on tablet, single-column card list on mobile.

## 5. Filters, lists, saved views

Filter facets: query text, run id, discovery date, industry, size, geo, funding stage, fit range, qualification, signal type, signal age, buyer role, recipient present, research state, opener state, contacted, LinkedIn, email, reply, owner, tags, lists, follow-up date, last activity, exclusion reason.

Persist filter combos as `lead_lists.kind = 'saved_view'`. Seed views: High-fit founders · Needs verified buyer · Drafts ready · Contacted no reply · Follow-up due · Recently funded SaaS · Outside preferred size.

## 6. Search-run provenance

Every chat/workflow result set writes a `search_runs` row + N `lead_candidates` rows keyed to `search_run_id` and `account_id`. Same account across runs → new `lead_candidates` row, single `accounts` row. Search Run detail page: query, filters, agents/tools, run status, cost, accepted/rejected, deep-link to lead detail filtered by that run.

Chat result cards get "View in Lead Library" → `/leads?run=<id>`.

## 7. Lead detail

Sections in order: Overview · Why selected · ICP qualification · Verified signals · Company research · Decision-makers · Selected recipient (single, persisted) · Personalized opener · Contact & engagement · Notes & tasks · Activity · Source queries · Lists & tags · Raw source (collapsed).

Every subview queried by `account_id` — no cross-lead fallback. On sync failure show inline "Lead data could not be synchronized. Refresh this lead." — never render another lead's data.

## 8. Contact tracking (MVP = manual)

Buttons on lead detail write to `activity_feed` and update the `linkedin`/`email`/`call`/`engagement` status columns with `source='manual'`. Phase 3 integrations (Gmail/Calendar/CRM/LinkedIn) overwrite with source-tagged events.

## 9. Tasks & follow-up

Reuse `tasks` with `account_id`. Next-action recommender pure-derives from readiness (no model call): missing research → "Research"; missing verified buyer → "Find contact"; draft ready → "Review draft"; approved → "Send/Contact"; contacted no reply >N days → "Follow up". Never recommend actions whose provider is unavailable.

## 10. Bulk actions

Toolbar shows selection count, aggregated readiness, and estimated paid cost (from `search_runs.cost_cents` model). Actions: add to list, tag, assign owner, research, find DMs, generate openers, mark contacted, set follow-up, archive, export CSV. Skip ineligible with per-row reason; never auto-send.

## 11. Deduplication

Account key priority: `workspace_id` + (normalized apex domain → `linkedin_url` slug → provider company id). Contact key: `account_id` + (normalized LinkedIn slug → verified email → provider person id). Name-only never merges. Conflicts → `needs_review`. Merge preserves oldest `id`, unions `lead_candidates`, activities, notes, enrichments, tags; keeps newest strongest evidence.

## 12. Visual design

Dark glass surfaces, emerald accents, sticky filter rail, spacious detail, no nested-card syndrome. Reuse `@/components/company-brain` glass tokens for panels; reuse `ChipInput`, `Pill`, `Sheet` for detail sections. Table uses existing `DataComponent V2` alt-row + sparkline standards from memory.

## 13. Safety & isolation

- Every new table gets workspace-scoped RLS + explicit GRANTs to `authenticated` + `service_role`.
- `lead_status` and `lead_lists*` scoped via `has_workspace_access`.
- Detail hooks always pass `account_id` explicitly; no "last selected" ambient state.
- Retry never wipes previous valid research/opener.
- No prompt/provider payload rendered.

## 14. Phasing

- **Phase 1 (MVP):** `search_runs`, extended `activity_feed`, `lead_status`, `lead_lists*`, unified `/leads` list + detail, manual statuses, selected-recipient persistence, provenance chips, CSV. Retire visible use of `Leads.tsx`/`LeadCRM.tsx`/`LeadScraper.tsx` behind the new page.
- **Phase 2:** owners, saved views UX, reminders, bulk workflows, richer activity, pipeline outcomes, dedupe merge UI, migration of `linkedin_leads`/`outreach_leads`.
- **Phase 3:** Gmail, Calendar, CRM, LinkedIn task tracking, integration-confirmed engagement events.

## 15. Files/components affected (Phase 1)

- New: `src/pages/LeadLibrary.tsx`, `src/pages/LeadDetail.tsx`, `src/pages/SearchRunDetail.tsx`, `src/components/leads/{Header,FiltersRail,LeadTable,LeadRow,ProvenanceChip,StatusPills,BulkBar,SelectedRecipient,ResearchPanel,OpenerPanel,ActivityTimeline,ListsSidebar,SavedViewPicker}.tsx`, `src/hooks/{useLeadLibrary,useLeadDetail,useSearchRuns,useLeadLists,useLeadFilters}.ts`, `src/lib/leads/{normalize,dedupe,status,recommender,filterSchema,csv}.ts`.
- Modify: `src/App.tsx` routes, `Sidebar.tsx`, Workbench `useLeadResults` (write-through to `search_runs` + `lead_candidates`), chat result cards ("View in Library" link).
- Retire (soft): current `Leads.tsx`, `LeadCRM.tsx` — keep as redirect.

## 16. Backend/Edge impact

- Migrations only (no edge fn changes required in Phase 1): create `search_runs`, `lead_status`, `lead_lists`, `lead_list_members`; add columns to `contacts`, `activity_feed`; RLS + GRANTs.
- Phase 2 edge fn `merge-lead-accounts` for admin merges.

## 17. Test matrix (Phase 1)

Chat→library appearance · run provenance preserved · dedupe across runs · filter independence · saved view restore · workspace isolation of lists/tags · status-group independence · manual channel events append activity · recipient consistency across row/detail/CSV · lead A never renders lead B data · failed retries preserve prior valid data · CSV = canonical state · bulk skip with reason · pre-action cost estimate · no auto-send · no cross-workspace leak · no live-customer fixtures.

## 18. PR breakdown

1. Schema migration (`search_runs`, `lead_status`, `lead_lists`, columns, RLS, GRANTs).
2. Write-through in Workbench + chat result cards.
3. `/leads` list + filters + saved views.
4. `/leads/:id` detail with persisted selected recipient.
5. `/leads/runs/:id` provenance page.
6. Bulk bar + CSV + activity manual events.
7. Redirect legacy pages, test pass.

## 19. Recommended first branch

`lead-library-phase1-schema-and-provenance` — ships PRs 1–2 only, low-risk read/write plumbing behind the existing Workbench.

## 20. Ready-to-paste Claude Code prompt

> Implement Agentory Lead Library Phase 1 per `.lovable/plan.md`. Deliver in two PRs on branch `lead-library-phase1-schema-and-provenance`: (a) migration creating `search_runs`, `lead_status`, `lead_lists`, `lead_list_members`, extending `contacts` with `is_selected_recipient`, `role_family`, `employer_verified_at`, and `activity_feed` with `account_id`, `contact_id`, `channel`, `source`; add workspace-scoped RLS using `public.has_workspace_access` and explicit GRANTs to `authenticated` + `service_role`; (b) wire chat/workflow result persistence in `useLeadResults` and Workbench so every result set writes one `search_runs` row plus `lead_candidates` rows keyed by `search_run_id` and `account_id`, deterministic account dedupe by workspace+domain / LinkedIn slug / provider id, contact dedupe by account+LinkedIn slug / verified email / provider id, and persist selected recipient on `contacts.is_selected_recipient`. Do not build the `/leads` page yet, do not touch outreach sending, do not remove `linkedin_leads`/`outreach_leads`, do not deploy edge functions, do not change providers, keep approval-first behavior. Add vitest coverage for dedupe, provenance write-through, RLS isolation, and recipient persistence. Report SHA, files changed, migration name, test results.