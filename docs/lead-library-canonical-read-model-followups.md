# Lead Library — follow-up phases (design notes only)

This PR (`lead-library-canonical-read-model-v1`) added a **read-only compatibility
layer**: `deriveCanonicalLeadView` + `canonicalToLeadRow`, wired into
`useLeadLibrary`. It changes no storage and applies no migrations. The following
phases are **not implemented here** — captured so the sequencing is explicit.

## A. Durable one-lead-per-account migration
`lead_candidates` dedups by `(plan_id, account_id, contact_id, signal_id)`, so a
company discovered in N plans has N rows (prod: 12 accounts with 2–4 rows). Target:
one durable lead per `(workspace_id, account_id)`; plan/search-run becomes a
**source association**, not a new lead. Requires a migration to drop `plan_id`
from the lead dedup key + a backfill that collapses duplicate rows while
preserving every stage success. This PR already groups by account at read time,
so the UI is ready for the durable model.

## B. Source-association table + production schema-drift reconciliation
`lead_evidence` and `signal_events` exist in repo migrations but are **absent from
production** (Signals V2 = TEST-only). Reconcile the drift, then deploy a real
source table (`lead_evidence` or a `lead_sources` table) and write one row per
discovery with method/URL/query/`search_run_id`/provider/evidence. The read
adapter's `provenance.discoverySources` is the shape to persist toward; it
currently reconstructs best-effort from `lead_candidates.raw`.

## C. `contacts.account_id` backfill
All 9 prod contacts have `account_id = null`; they attach to a lead, not the
durable account. Stamp `account_id` on contact ingest and backfill. The adapter
already filters contacts by `account_id`, so once populated, `verifiedContacts`
and recipient recommendation fill in automatically.

## D. Unified outreach persistence
Personalized openers live in `raw.agentory_workbench.outreach` (JSONB); legacy
full-drafts live in `outreach_drafts` (5/6 unlinked in prod). Converge on one
store (recommend: keep JSONB canonical, migrate/relink legacy drafts, or promote
JSONB openers into `outreach_drafts` with recipient + brain provenance). The
adapter's outreach precedence already prefers the JSONB opener and only falls back
to a **provably linked** legacy draft.

## E. Persisted lists / tags / activity
Lists, tags, manual status and follow-up are **localStorage-only**
(`lead-library:aug:<workspaceId>`), already workspace-keyed in memory but not
cross-device or multi-user. Add `lead_lists`, `lead_tags`, `lead_list_members`
(M:N, workspace-scoped, RLS) and a lead-scoped `activity` stream; move the
augmentation store to the backend. `RowAug` is the seam to swap.
