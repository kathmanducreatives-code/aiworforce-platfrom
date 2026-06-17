# Lead Workbench — Spreadsheet-Style Side Panel

Replace the card-list `LeadResultsView` with a premium, Clay/Airtable-style table inside the existing right-side Workbench. Rows = lead opportunities. Columns are either always visible (company, signal, persona, contact status, fit, source, status) or **locked** behind credit-gated unlock actions (decision maker, contact info, enrichment, personalized message). All actions stay in the same conversation and route through the existing `dispatchResultAction` dispatcher — no new chats, no sending, no DB migrations, no production deploys.

## Scope guardrails

- No migration 145631; no production DB changes.
- No auto-send / DM / comment / post / email. Drafts only.
- No production deploy without approval. `run-agent` edge function changes are limited to extending the `ui_panel` payload — they will be deployed only if/when the user approves.
- No fabricated emails, phone numbers, or contacts. Locked columns stay locked when source data is unavailable.
- Visual + presentation work only on the frontend side; backend changes are additive metadata.

## Files to change

Frontend
- `src/lib/chatActions.ts` — extend `LeadResultPanelAction` with `find_contacts`, `research_company`, `confirm` flag; keep existing actions backward compatible.
- `src/contexts/ChatWorkspaceContext.tsx` — extend `LeadResultsPanelMeta` (view, counts, locked_columns, recommended_next_action, available_actions). All optional, defaulted when missing so old messages still render.
- `src/hooks/useLeadResults.ts` — broaden the normalized row shape to the new `LeadTableRow` type (decision-maker / enrichment / draft statuses, persona, signal source, found_via). Join `lead_enrichments` and `outreach_drafts` (best-effort `.select` with graceful fallback if relations missing).
- `src/components/chat/workspace/workbench/LeadResultsView.tsx` — rewrite as a spreadsheet wrapper: header + recommendation banner + summary chips + bulk toolbar + table + detail drawer.
- New `src/components/chat/workspace/workbench/leadTable/` directory:
  - `LeadTable.tsx` — sticky header, sticky first column, horizontal scroll, row hover/select, compact density.
  - `LeadTableRow.tsx` — cell renderers per column.
  - `LockedCell.tsx` — blurred preview + "Unlock — N credits" inline button.
  - `StatusChip.tsx`, `CreditBadge.tsx`, `RecommendationBanner.tsx`, `BulkActionToolbar.tsx`.
  - `LeadDetailDrawer.tsx` — right-slide drawer inside the panel (Company / Signal / Recommended Contact / Enrichment / Draft / Activity / Raw).
  - `credits.ts` — single source of truth for credit estimates and recommended-next-action logic.
  - `csv.ts` — CSV export including locked placeholder values.

Backend (additive only; deploy gated on approval)
- `supabase/functions/run-agent/index.ts` — extend the emitted `ui_panel` for `kind: "lead_results"` with: `view: "spreadsheet"`, `lead_count`, `account_count`, `contact_count`, `locked_columns`, `available_actions`, `recommended_next_action {action,label,reason,estimated_credits}`. Existing fields preserved.
- No new edge function; backend action handling for `find_contacts` / `research_company` is out of scope for this UI change. The dispatcher sends the structured intent; if the backend has no handler yet, the assistant message gracefully reports "not configured yet" using existing fallback copy patterns. No fake data is ever rendered.

## Column spec

Always visible: Select · Company/Account · Signal · Recommended Persona · Contact Status · Fit Score · Source · Status.
Locked (visible but blurred + unlock CTA): Decision Maker 🔒 · Contact Info 🔒 · Company Enrichment 🔒 · Personalized Message 🔒.
Trailing: Notes / Next Step · Row Actions.

Unlock state derived from row data:
- Decision Maker / Contact Info → unlocked when `contact_id` present.
- Company Enrichment → unlocked when `lead_enrichments` row exists for the account.
- Personalized Message → unlocked when `outreach_drafts` row exists for the contact/account.

## Credit model

Local-only estimates in `credits.ts` (no ledger writes):
- find_contacts: 1 per row missing contact
- research_company: 1 per row with website and no enrichment
- draft_outreach: 2 per row with contact and no draft
- rank: ceil(rows/10)
- enrich_and_draft: research + draft combined
- export_csv / save: 0

Confirmation dialog before any non-zero action. Estimate is stored in dispatched metadata; nothing is deducted.

## Recommended next action logic

In order of precedence:
1. All rows missing contact → "Find decision-makers".
2. Contacts exist, no enrichment → "Research company context".
3. Contacts + enrichment, no drafts → "Generate approval-ready outreach".
4. Partial scout result → "Broaden search".
5. Any rows missing website → "Find domains".
Rendered as a banner above the table with one primary CTA + reason + credit estimate.

## Action dispatch

All bulk + row + banner actions call `dispatchResultAction({ conversationId, planId, leadCandidateIds, action, estimatedCredits })`. `conversationId` comes from `WorkbenchSelection.conversationId` (already plumbed). Export CSV runs locally and does not dispatch.

## Detail drawer

Click a row → in-panel drawer (absolute overlay inside the LeadResultsView container, not a new modal). Sections fed from the same normalized row + on-demand fetch of raw `lead_candidates` JSON. Closes with Esc or backdrop click. Does not navigate, does not change conversation.

## Chat copy

When the backend emits the panel, the existing assistant message is updated (text-only) to:
- Account-only: "Scout found N account opportunities. I opened them in the lead table. Decision-maker, enrichment, and outreach columns are locked until you run those actions. Nothing was sent."
- Contact-ready: "Scout found N contact-ready leads. I opened them in the lead table. You can now research companies or generate approval-ready outreach."
Selection is based on whether any row already has a contact.

## Backward compatibility

- Messages emitted before this change render with the new table using sensible defaults (all advanced columns locked, recommendation = Find decision-makers when no contact data found in DB).
- Old `actions` array (`enrich`, `draft_outreach`, …) still works; new actions added alongside.

## Visual design

Pitch-black surface, emerald accents, glassmorphic header — consistent with the existing Workbench. Sticky table head, sticky select+company column, monospaced numeric cells, status chips, locked cells with `backdrop-blur-sm` + diagonal lock pattern + inline credit CTA, compact 36px row height, hover row tint, keyboard row navigation (↑/↓, Space to select, Enter to open drawer).

## Tests

- `src/components/chat/workspace/workbench/leadTable/__tests__/LeadTable.test.tsx`
  - renders rows + locked columns when contacts/enrichment/drafts missing
  - unlocks decision-maker column when `contact_id` present
  - unlocks enrichment column when enrichment row present
  - unlocks personalized message when draft row present
  - draft row action disabled when no contact
  - bulk find_contacts dispatches with correct `conversation_id` and credit estimate
  - confirmation required for paid actions; zero-credit actions skip confirm
  - CSV export contains "Locked — not generated" for locked cells
  - recommendation banner reflects the precedence rules
- Existing `run-agent` and `pilot-chat` tests remain untouched.

## Browser QA (post-build, preview only)

A. "Find 5 companies hiring GTM roles in B2B SaaS USA" → spreadsheet opens, 5 rows, advanced columns locked, banner = Find decision-makers.
B. Click Find decision-makers → credit confirm; if backend handler missing, honest fallback assistant message; no fake contacts.
C. Click Research company → confirm; Firecrawl-backed enrichment populates column when backend returns; rows without websites stay locked with "Needs domain".
D. Click Generate outreach → blocked if no contact; otherwise draft appears in the unlocked column; approval required; nothing sent.
E. Export CSV → file downloads with locked placeholders.
F. All actions stay in the same conversation; no new chats spawned.

## Out of scope

- Backend handlers for `find_contacts` / `research_company` if not already wired (UI dispatches the intent; backend wiring is a separate task).
- Real credit ledger / deduction.
- Any DB migration.
- Production deploy.

## Final report (delivered after build)

Files changed, table behavior, locked-column behavior, credit estimate behavior, backend metadata diff, action dispatch wiring, contact/enrichment/draft unlock behavior, CSV export behavior, test results, browser QA results, remaining gaps.
