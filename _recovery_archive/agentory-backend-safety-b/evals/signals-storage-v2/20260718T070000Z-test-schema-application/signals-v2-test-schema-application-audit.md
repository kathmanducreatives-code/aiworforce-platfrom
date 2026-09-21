# Signals Storage V2 — TEST Schema Application Audit

Date: 2026-07-18 (UTC)
Session scope: merge verification of PR #57 + controlled TEST-only application of the
additive Phase-1 hybrid migration + schema/RLS validation. **No deploy, no writer/reader
change, no dual-write, no backfill, no provider calls, no production access.**

---

## 1. PR #57 merge

- PR: https://github.com/kathmanducreatives-code/remix-of-remix-of-screeningpilot/pull/57
- State when session started: **already MERGED** (mergedAt 2026-07-18T06:16:13Z — merged
  outside this session, presumably by the repository owner)
- Head at merge: `e3d25da04f1e47ece5015164f769c393cbf9de26` (expected `e3d25da0` ✓)
- Merge commit: `767c3ffc9c25e5c2aaf695189b790361f64e4d9d`
- Merge parents: `a0081e46` (previous main) + `e3d25da0` (PR head) — nothing else landed
- `git diff e3d25da0 remix/main` → empty (merged main is content-identical to the branch)
- Files merged (exactly 3, +935/−0):
  - `supabase/migrations/20260717170000_signals_storage_v2_hybrid.sql` (md5 `85cc755101f630fb82dfe11aa0fb838c`, 420 lines)
  - `supabase/functions/_shared/signalsStorageV2Migration.test.ts`
  - `docs/architecture/signals-storage-schema-v2.md`
- Static migration tests re-run post-merge: **21/21 pass**

## 2. Target confirmation

- Active MCP project URL: `https://zbwsbnqqpkvdhqwavjke.supabase.co` → **TEST** ✓
- Production project (`wqnigjhcwjxtmordrwno`) was **never accessed**.

## 3. Pre-migration baseline (read-only, captured before application)

Migration head: `20260706162848` (allow_hangup_status_in_call_attempts).
Version `20260717170000` absent. New tables absent (0 of 4). `lead_candidates.evidence_id` absent.

Row counts / checksums (md5 over ordered ids; lead_candidates checksum also embeds signal_id):

| table | rows | ids_md5 |
|---|---|---|
| signals | 427 | c47a2a631367225e5414380030788c78 |
| lead_candidates | 427 | 224dd38c6399602d98bb637b70721a10 |
| signal_reviews | 4 | 897afe2b355e7846eb30f28078e72f60 |
| contacts | 166 | 1eb21ab92ebce29c9fe0b1618bbbaada |
| accounts | 149 | ba2a94f845190733a67d9a1cc7ab1367 |

Other counts: task_plans 187, tasks 362, outreach_drafts 64, activity_feed 1742, workspaces 1.

Edge Functions before: run-agent **v88**, orchestrate **v31** (plus unrelated functions, all versions recorded).

**Explanation of the earlier "signals=1 / lead_candidates=1" observation:** the previous
review read row counts from `list_tables`, which reports PostgreSQL *estimated* row counts
(stale planner statistics), not exact counts. Exact `count(*)` shows 427/427, matching the
original audit. **TEST was NOT reset, cleaned, or switched** — the discrepancy was a
statistics artifact.

Pre-existing baseline note: TEST's `lead_candidates` carries **no `lc_dedupe_uniq` index**
(indexes: pkey, lc_conversation_idx, lc_plan_idx, lc_workspace_created_idx). TEST's applied
migration history diverges from the repo's migration files (TEST used
`local_agentory_test_schema` et al.). This predates this session and was left untouched.

Legacy schema fingerprints (info_schema columns, ordered):
- signals: 16 cols — md5 `386b4d6690149d0315495505db16eca8`
- signal_reviews: 12 cols — md5 `6c54469772c35f2999c5449368e9f051`
- Legacy RLS: 4 authenticated member policies each on signals / signal_reviews / lead_candidates.

## 4. Migration application

- Command: `mcp__supabase__apply_migration(name="20260717170000_signals_storage_v2_hybrid", query=<exact file contents>)`
  against MCP-scoped project `zbwsbnqqpkvdhqwavjke` (tool cannot target any other project).
- Result: `{"success": true}` — single execution, no partial failure.
- The MCP tool recorded the run under its own execution timestamp version
  (`20260718070135`) with the canonical name embedded; the bookkeeping row was corrected to
  the canonical `version='20260717170000', name='signals_storage_v2_hybrid'`
  (bookkeeping-only UPDATE on `supabase_migrations.schema_migrations`; no schema/data effect).
- Post-migration history: `20260717170000` recorded **exactly once**; no other version
  added; head is now `20260717170000`.

## 5. Post-migration object inventory

Tables created (all present, all **0 rows** immediately after application):
`lead_evidence`, `signal_events`, `signal_event_evidence`, `engagement_events`.

`lead_candidates.evidence_id`: present, nullable, no default, **0 populated** of 427;
`signal_id` non-null on 427/427 (unchanged).

### Constraints (verified from pg_constraint, all match the migration SQL)

- lead_evidence: kind_valid (7 kinds), verification_valid (3), confidence_valid (null|3),
  lifecycle_valid (8 incl. retracted), entity_present; FKs contact/account/lead_candidate
  SET NULL, workspace CASCADE, legacy_signal_id → signals SET NULL.
- signal_events: type_valid (**24 canonical non-engagement types**), category_valid
  (5, no 'engagement'), evidence_category_valid (null|6), verification_valid,
  confidence_valid, freshness_valid (null|4), listing_status_valid (null|4),
  lifecycle_valid (8), entity_present, `UNIQUE (id, workspace_id)` (composite-FK anchor).
  `occurred_at` NOT NULL **no default**; `observed_at` NOT NULL default now(); expires_at nullable.
- signal_event_evidence: verification/confidence checks, source_present
  (source_url OR source_record_id), **composite FK (signal_event_id, workspace_id) →
  signal_events(id, workspace_id) ON DELETE CASCADE**, legacy_signal_id SET NULL.
- engagement_events: channel_valid (4), type_valid (**6 canonical engagement types**),
  verification/confidence/lifecycle checks, entity_present, occurred_at NOT NULL no default.
- PII scan: **zero** columns matching raw|payload|email|phone|token|authorization|credential|secret
  across all four tables.

### Indexes (counts incl. pkeys — full documented set present)

- lead_evidence 8: workspace_dedupe_uniq, legacy_signal_uniq(partial), workspace_kind,
  workspace_lifecycle, contact, account, lead_candidate, pkey
- signal_events 11: workspace_dedupe_uniq, legacy_signal_uniq(partial), id_workspace_uniq,
  workspace_occurred, workspace_type_occurred, workspace_lifecycle_occurred,
  account_occurred, contact_occurred, lead_candidate_occurred, expires_at(partial), pkey
- signal_event_evidence 6: fingerprint_uniq (workspace,event,fingerprint), event,
  workspace_provider, source_record(partial), legacy_signal(partial), pkey
- engagement_events 7: workspace_dedupe_uniq, legacy_signal_uniq(partial),
  workspace_occurred, contact_occurred, account_occurred, channel_type, pkey
- lead_candidates: + lead_candidates_evidence_idx (partial, WHERE evidence_id IS NOT NULL)

### RLS

RLS **enabled** on all four tables; **16 policies** (4×4 SELECT/INSERT/UPDATE/DELETE),
all `TO authenticated`, all qual/with_check = `has_workspace_access(auth.uid(), workspace_id)`;
no anon/public policies. Grants: authenticated SELECT/INSERT/UPDATE/DELETE; service_role ALL
(repository convention). `has_workspace_access` = SECURITY DEFINER membership check on
workspace_members (unchanged).

## 6. Live RLS / constraint tests (synthetic data only)

Fixtures: workspace A `00000000-…-0001` (real, sole workspace), member user
`0b98ba63-…` (existing workspace_members row), non-member `11111111-…`, disposable
workspace B `bbbbbbbb-…-0001` (created and deleted this session). All test rows used
`aaaaaaaa-…` UUIDs, `example.com` URLs, `{"test":"synthetic"}` payloads — no real people,
companies, profile URLs, emails, or provider data.

| test | expectation | observed |
|---|---|---|
| A. member INSERT into all 4 tables | succeed | ✓ 4 rows inserted |
| A. member SELECT | visible | ✓ 1/1/1/1 |
| A. member UPDATE (lifecycle→superseded) | succeed | ✓ |
| A. member DELETE | succeed | ✓ (3 explicit deletes, all 1 row) |
| B. non-member SELECT | 0 rows visible | ✓ 0/0/0/0 |
| B. non-member UPDATE/DELETE | 0 rows affected | ✓ 0/0 |
| B. non-member INSERT | blocked | ✓ ERROR 42501 RLS violation |
| C. cross-workspace evidence→event link (as service role, RLS bypassed) | blocked at DB | ✓ ERROR 23503 `signal_event_evidence_parent_fk` |
| D. invalid taxonomy (`signal_category='engagement'`) | blocked | ✓ ERROR 23514 `signal_events_category_valid` |
| E. missing occurred_at | blocked | ✓ ERROR 23502 NOT NULL |
| F. duplicate (workspace_id, dedupe_key) | blocked | ✓ ERROR 23505 `signal_events_workspace_dedupe_uniq` |
| Cascade | parent event delete removes only its evidence child | ✓ child count 1→0 via single parent delete |

Cleanup proof: final counts lead_evidence **0**, signal_events **0**, signal_event_evidence
**0**, engagement_events **0**; workspace B removed (0 remaining); evidence_id populated **0**.

## 7. Legacy comparison (post-migration + post-cleanup vs baseline)

| table | baseline | after | delta | checksum |
|---|---|---|---|---|
| signals | 427 | 427 | 0 | identical (c47a2a63…) |
| lead_candidates | 427 | 427 | 0 | identical (224dd38c…, embeds signal_id) |
| signal_reviews | 4 | 4 | 0 | identical (897afe2b…) |
| contacts | 166 | 166 | 0 | identical |
| accounts | 149 | 149 | 0 | identical |
| task_plans / tasks / outreach_drafts / activity_feed | 187/362/64/1742 | 187/362/64/1742 | 0 | — |

signals + signal_reviews schema fingerprints identical to baseline. lead_candidates changed
only by the added nullable `evidence_id` (expected). Legacy indexes and policies untouched.

## 8. Function / application safety

- Edge Function inventory re-listed post-migration: **identical** — run-agent v88
  (ezbr_sha256 aba04719…), orchestrate v31 (0fb9ba03…), all other functions same
  version/updated_at. **No deployment.**
- No provider calls, no Q1 runs, no task plans, no leads, no drafts/outreach, no backfill,
  no dual-write, no writer/reader change, no UI change.
- Production `wqnigjhcwjxtmordrwno`: never accessed.

## 9. Result classification

**PASS — ADDITIVE SIGNALS V2 SCHEMA VERIFIED IN TEST**

- Migration applied cleanly, recorded once as `20260717170000`.
- All tables, constraints, indexes and comments exist as specified.
- RLS verified live (member CRUD ✓, non-member fully blocked ✓).
- Cross-workspace linkage blocked at the database boundary even with RLS bypassed.
- Legacy schema, data, dedupe, functions and behavior unchanged (checksums identical).
- All synthetic test rows and the disposable workspace cleaned up (0 rows remain).

## 10. Remaining issues / notes

1. Migration-history bookkeeping on TEST was normalized to the canonical version via a
   one-row UPDATE (documented in §4). Cosmetic; no schema/data effect.
2. Pre-existing TEST divergence: no `lc_dedupe_uniq` on lead_candidates and TEST's applied
   history differs from the repo's migration files. Not caused or touched by this session.
3. Next phase remains: flagged dual-write (`SIGNALS_V2`), no backfill — per
   docs/architecture/signals-storage-schema-v2.md rollout table.
