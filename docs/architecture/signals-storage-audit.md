# Signals Storage Architecture Audit

**Read-only audit.** No runtime code, migrations, SQL, or database rows were changed. TEST project
`zbwsbnqqpkvdhqwavjke` was inspected read-only; production `wqnigjhcwjxtmordrwno` was never accessed.

Base main: `0fa4d1f7` · run-agent v88 · orchestrate v31.

---

## 1. Executive summary

The `public.signals` table (created 2026-06-11, migration
`20260611080445_…`, "Phase 2: Persistent Signal Memory") is a **flat, workspace-scoped, append-only
"signal memory" ledger with no deduplication, no event-time columns, and no lifecycle**. It currently
holds four semantically distinct row families under one loose `signal_type text`:

| Family | signal_type (count in TEST) | Semantics |
|---|---|---|
| Identity evidence | `people_profile` (25) | who a sourced person is + provider provenance |
| Opportunity/timing | `hiring_signal` (217) | a time-bound hiring event |
| Engagement | `competitor_engagement` (96), `linkedin_engagement` (89) | interactions on LinkedIn content |

`people_profile` — the v88 `signals +1` — is **not an opportunity signal**. It is **identity evidence +
provider provenance** written as the identity anchor of a persisted lead. It is actively consumed in two
places (a lead FK and the Signals UI "People" tab), so it **cannot be silently suppressed**.

The canonical `SignalEvent` contract (`signalEvent.ts`, 22 fields) **cannot be stored cleanly** in this
table: 10 fields are missing (`signal_category`, `person_ref`, `company_ref`, `occurred_at`,
`expires_at`, `verification`, `listing_status`, `dedupe_key`, lifecycle `status`, `sanitized`) and the
DB can enforce none of the validator invariants. **Recommendation: HYBRID — keep durable identity/company
facts in a `lead_evidence` table, add a purpose-built `signal_events` table for time-bound opportunity
signals, and a `engagement_events` table for interactions.** Do not extend the flat `signals` table to
carry timing SignalEvents.

---

## 2. Current schema (`public.signals`)

From migration `20260611080445_…` (verified against live introspection; not inferred from generated types):

```
id            uuid PK  default gen_random_uuid()
workspace_id  uuid NOT NULL  → workspaces(id) ON DELETE CASCADE
conversation_id uuid  (nullable, no FK)
plan_id       uuid    (nullable, no FK)   -- indexed
task_id       uuid    (nullable, no FK)
tool_call_id  uuid    (nullable, no FK)   -- indexed
source        text    (nullable)
signal_type   text    (nullable)          -- NO check constraint / enum
signal_label  text    (nullable)
title         text    (nullable)
description   text    (nullable)
source_url    text    (nullable)
confidence    numeric (nullable)          -- 100% NULL in TEST
raw           jsonb NOT NULL default '{}' -- arbitrary provider payload
created_by    uuid    (nullable)
created_at    timestamptz NOT NULL default now()
```

- **PK** `id`. **FKs**: only `workspace_id` (CASCADE). `plan_id`/`task_id`/`tool_call_id`/
  `conversation_id` are loose uuids with no FK.
- **No** unique/dedupe constraint, **no** check constraints, **no** `updated_at`/trigger, **no**
  soft-delete/archive column, **no** `occurred_at`/`observed_at`/`expires_at`/`verification`/`status`.
- **Indexes**: `(workspace_id, created_at DESC)`, `(conversation_id)`, `(plan_id)`, `(tool_call_id)`.
- **RLS**: enabled; 4 member policies (read/insert/update/delete) gated on
  `public.has_workspace_access(auth.uid(), workspace_id)`. `service_role` has `ALL` (Edge Functions
  bypass RLS by design).
- **Reverse linkage**: `lead_candidates.signal_id → signals(id) ON DELETE SET NULL`, and the
  `lead_candidates` dedupe unique index is
  `(workspace_id, coalesce(plan_id,…), coalesce(account_id,…), coalesce(contact_id,…), coalesce(signal_id,…))`
  — so a lead's `signal_id` is **part of its dedupe identity**.
- **Related table** `public.signal_reviews` (migration `20260613130000_…`, "Phase 6"): per-user
  review/watch/dismiss state (`status ∈ new|reviewed|ignored|saved|actioned`), `signal_id →
  signals(id) ON DELETE CASCADE`, unique `(workspace_id, user_id, signal_id)`. This is the existing
  lifecycle/review layer.

Live TEST introspection (aggregate, sanitized): 427 rows · 1 workspace · created 2026-06-11 → 2026-07-17 ·
`plan_id` non-null on all · `confidence` NULL on all 427 · `raw` non-empty on all · **427/427 referenced
by a `lead_candidate.signal_id` (1:1)** · 4 `signal_reviews` rows.

---

## 3. Writer inventory (5 writers)

| # | Writer | File:line | Stage | signal_type | Dedup | Best-effort? |
|---|---|---|---|---|---|---|
| 1 | `writeApifyPeople` | `_shared/memoryWriter.ts:557` | after lead persistence | `people_profile` | **none** | yes (try/catch) |
| 2 | `writeMemoryFromToolCall` (jobs) | `_shared/memoryWriter.ts:406` | tool-call memory | `hiring_signal` | none | yes |
| 3 | LinkedIn engagement | `_shared/memoryWriter.ts:678` | tool-call memory | `linkedin_engagement`/`competitor_engagement` | none | yes |
| 4 | Competitor commenters | `_shared/memoryWriter.ts:778` | tool-call memory | `competitor_engagement` | none | yes |
| 5 | `run-radar-scan` | `run-radar-scan/index.ts:329` | radar scan | `hiring_signal` (+ others) | app-level select-then-filter (`:200`) | fatal-checked |

All writes go through `service_role` (Edge Functions), bypassing RLS. Writers 2–4 fire on tool-call
completion; writer 5 is the Scout Radar path. Only writer 1 is gated on **successful lead persistence**
(see §5). No writer performs an upsert/`onConflict` on `signals`; the only in-repo dedup is
`run-radar-scan`'s read-compare against existing rows (`:200`). Result: **60 duplicate `(signal_type,
title)` groups** exist in TEST.

Call graph for the v88 row:
```
run-agent  (finalPersistSet.length > 0, index.ts:1889)
  → writeMemoryFromToolCall(output = ONLY accepted rawItems)   index.ts:1925
    → isPeopleOutput → writeApifyPeople                        memoryWriter.ts:277→515
      → contacts.upsert(onConflict workspace_id,linkedin_url)  memoryWriter.ts:544
      → signals.insert(signal_type=people_profile)             memoryWriter.ts:557  ← the +1
      → lead_candidates.insert(signal_id = new signal)         memoryWriter.ts:582
```

---

## 4. Reader inventory (3 readers + 1 lifecycle table)

| # | Reader | File:line | Filters | Treats people_profile as… | Breaks if removed? |
|---|---|---|---|---|---|
| 1 | `fetchSignals` → `SignalFeed.tsx` "People" tab | `src/lib/signalsFeed.ts:29`, `SignalFeed.tsx:80,156,318,326` | by `signal_type`; people tab = `people_profile\|people\|decision_maker` | a displayed **People** feed item (own `SignalCard` color, `SignalCard.tsx:10`) | **yes** — People tab empties for new leads |
| 2 | `run-radar-scan` dedup read | `run-radar-scan/index.ts:200` | `id, source_url, title, signal_type, raw` | dedup key material | no (radar-only) |
| 3 | run-agent plan summary | `run-agent/index.ts:2650` | `count … eq plan_id` | a count only | no |
| — | `signal_reviews` FK | migration `20260613130000_…` | `signal_id` | review-target anchor (`ON DELETE CASCADE`) | review rows cascade-deleted |

Plus the structural consumer: `lead_candidates.signal_id` FK + dedupe key (schema §2).

---

## 5. `people_profile` trace (precise)

**Path**: `run-agent` finalPersistSet → `writeMemoryFromToolCall` → `writeApifyPeople`
(`memoryWriter.ts:515-596`).

- **Trigger condition**: runs only inside `if (finalPersistSet.length > 0)` (`index.ts:1889`) with
  `output.items = rawItems` = **only the qualification-accepted candidates**. In `source_and_qualify_only`
  mode, staged/rejected candidates are excluded, so it fires **only for persisted/qualified leads**. This
  is why v88 (1 qualify_now) produced exactly **+1** people_profile, +1 contact, +1 lead — not +5.
- **Cardinality**: one `people_profile` row per persisted person. `contacts` is deduped
  (`onConflict workspace_id,linkedin_url`); **`signals` is NOT** — re-persisting the same person in a new
  plan writes a **new** people_profile row (the 60 duplicate title-groups confirm this).
- **Relationships**: `lead_candidates.signal_id → signals.id` (this row is the lead's identity anchor and
  part of its dedupe key); `lead_candidates.contact_id → contacts.id`. No `account_id` link for a
  person-only lead. No `activity_feed` link.
- **Required for downstream?** Yes: the lead FK + dedupe key, and the Signals "People" tab.
- **Tests**: `memoryWriter` has fixtures for people output detection (`isPeopleOutput`), but the
  people_profile **row write itself is not asserted by a provider-free unit test** at the DB boundary.

**Classification (by behaviour, not name):** predominantly **A. identity evidence** + **B. provider
provenance** (title = person name, `source_url` = LinkedIn profile, `signal_label` = headline, `raw` =
profile). It is **not** D (opportunity/timing — no `occurred_at`, no expiry, no freshness) and **not** E
(audit event). It is mislabelled as a "signal" and stored in a table named for opportunity signals — a
type-F legacy compatibility shape layered over genuine A+B evidence.

---

## 6. Semantic taxonomy of current `signal_type`s

| signal_type | Family | Temporal | occurred_at meaningful | Level | Evidence vs event | Belongs in Signals product | Dedup identity |
|---|---|---|---|---|---|---|---|
| `people_profile` | Identity evidence | durable | no | person | evidence | as identity, not a "signal" | workspace + person (linkedin) |
| `hiring_signal` | Opportunity | expires | **yes** | company | event | **yes** | workspace + company + role + posted-date |
| `linkedin_engagement` | Engagement | expires fast | yes | person | event | as engagement | workspace + person + post + action |
| `competitor_engagement` | Engagement | expires fast | yes | person/company | event | as engagement | workspace + entity + post |

Rows that **do not fit** the "signals" (opportunity) semantics: `people_profile` (identity evidence). It
carries no event time, cannot expire, and freshness is irrelevant — the antithesis of a timing signal.

---

## 7. Canonical `SignalEvent` compatibility matrix

`SignalEvent` (`signalEvent.ts`, 22 fields) vs `signals` columns:

| SignalEvent field | signals column | Status |
|---|---|---|
| signal_id | id | directly supported |
| workspace_id | workspace_id | directly supported |
| signal_type | signal_type (no enum) | representable but ambiguous |
| signal_category | — | **missing** |
| person_ref | — (reverse via lead FK only) | missing |
| company_ref | — | **missing** |
| evidence_refs | raw jsonb | JSON-only |
| source_provider | source | representable |
| actor_key | raw jsonb | JSON-only |
| actor_id | raw jsonb | JSON-only |
| source_url | source_url | directly supported |
| occurred_at | — | **missing (critical for timing)** |
| observed_at | created_at (proxy) | representable but ambiguous |
| expires_at | — | missing |
| confidence | confidence (100% NULL) | representable but unused |
| verification | — | missing |
| normalized_value | raw jsonb | JSON-only |
| listing_status | — | missing |
| dedupe_key | — (no unique) | **missing (critical for dedup)** |
| status (lifecycle) | — | missing |
| provenance | raw jsonb | JSON-only |
| sanitized | — | missing |

**The DB cannot enforce the canonical validator** (`validateSignalEvent`: entity ref, evidence backing,
`occurred_at`, no-raw-payload/PII) at the boundary — there are no columns or constraints for entity refs,
`occurred_at`, verification, or sanitization, and `raw jsonb` is unconstrained. 10 of 22 fields are
missing or JSON-only; **2 of the missing are load-bearing** (`occurred_at` for freshness, `dedupe_key`
for reconciliation — exactly the properties the Phase-A timing work depends on).

---

## 8. Privacy / RLS findings (structural only)

- **RLS**: enabled with 4 member policies gated on `has_workspace_access`. Cross-workspace read is
  blocked for `authenticated`. Workspace isolation is correct. `service_role` bypasses RLS (all writers) —
  expected, but means writer-side sanitization is the only PII guard.
- **`raw jsonb NOT NULL`** stores arbitrary provider payload with **no DB-level sanitization**. TEST:
  0 rows with an email in `raw`, 0 with a phone in `raw` (writers happen not to persist those here), but
  **1 row carries a secret-shaped hex string** in `raw` and **25 rows carry personal `linkedin.com/in/`
  profile URLs** in `source_url`. The structural risk (arbitrary payload) is real even where current data
  is clean.
- **No retention / expiry / soft-delete / archive**. A provider deletion ("right to be forgotten")
  request cannot be honoured by a targeted lifecycle transition — only a hard `DELETE`, which cascades
  `signal_reviews` and null-sets `lead_candidates.signal_id`.
- **Indexing**: no sensitive value is indexed (indexes are on ids/timestamps).
- Logs: writers are best-effort with `console.warn` on failure; they log counts, not payloads.

---

## 9. Deduplication & lifecycle findings

- **Identity evidence (`people_profile`)**: natural key = workspace + person (LinkedIn URL). Contacts are
  deduped on that; **signals are not** → repeat persistence duplicates the evidence row. No "strengthen in
  place" — a better observation appends a new row.
- **Opportunity signals (`hiring_signal`)**: natural key = workspace + company + role + posted-date. **No
  DB uniqueness**; only `run-radar-scan` does an app-level compare. The Phase-A in-memory
  `buildSignalDedupeKey` exists but is **never persisted** (timing SignalEvents stay in memory).
- **No lifecycle**: no `active|stale|expired|contradicted|superseded|dismissed|archived` state. Stale rows
  are neither updated nor superseded — they simply accumulate. A closed listing cannot be marked; it just
  ages by `created_at` (which is insert time, not `occurred_at`).
- **Multiple evidence references / multiple providers per event**: not representable except by stuffing
  `raw`. The canonical `evidence_refs[]` has no relational home.

Recommended lifecycle states (design only, not implemented): `active`, `stale`, `expired`,
`contradicted`, `superseded`, `dismissed`, `archived`.

---

## 10. Architecture options

**Option A — separate tables** (`lead_evidence`, `signal_events`, `engagement_events`).
- +Semantic clarity; each family gets its own lifecycle, freshness, dedupe, retention, RLS, UI mapping.
- +`signal_events` can enforce `occurred_at`, `dedupe_key`, `verification`, `status` as real columns/
  constraints — the DB can enforce the validator.
- −Three tables; UI/aggregation joins across families; migration must re-home 427 rows and re-point the
  `lead_candidates.signal_id` FK + dedupe key.

**Option B — unified typed event ledger** (`signal_events` with `event_family ∈
identity_evidence|opportunity_signal|engagement|workflow_event`).
- +One table, one feed query, one RLS policy set; matches the existing "everything is a signal" shape.
- −Family-specific lifecycle/validation becomes conditional logic, not schema; freshness/`occurred_at`
  apply to only some families (nullable, ambiguous); a single dedupe key must span heterogeneous
  identities; easy to regress into today's mixed-semantics problem. The current table **is** an informal
  Option B and is precisely what produced the mislabelled `people_profile` and the 60 duplicate groups.

Neither is chosen by default. Decision below is driven by actual usage + migration risk.

---

## 11. Decision on `people_profile`

**KEEP BUT RECLASSIFY** → migrate to a durable `lead_evidence` record (identity + provenance), then
retire the `people_profile` `signals` shape.

- **Current purpose**: identity anchor + provenance for a persisted person lead.
- **Consumers**: `lead_candidates.signal_id` (FK + dedupe key), Signals UI "People" tab, `signal_reviews`
  cascade.
- **Compatibility risk of stopping writes**: HIGH — the lead dedupe key loses its `signal_id` component
  (risking dedupe collisions across people-sourced leads) and the "People" tab empties for new leads.
- **Migration requirement**: backfill 25 rows into `lead_evidence`; re-point `lead_candidates.signal_id`
  (or add `lead_candidates.evidence_id`); repoint the "People" tab reader to `lead_evidence`.
- **Suppressing lead persistence?** No — `writeApifyPeople` gates the lead insert on the signal insert
  path; the fix is to write evidence to the right table, not to stop writing.
- **Do not suppress in this audit branch.** No code changed.

---

## 12. Recommended canonical target schema (HYBRID — proposal only, no migration)

Three tables, all `workspace_id NOT NULL → workspaces(id) ON DELETE CASCADE`, member RLS via
`has_workspace_access`, `service_role ALL`, `created_at`/`updated_at` with the existing trigger.

**`lead_evidence`** — durable identity/company facts (absorbs `people_profile` + future company_profile).
```
id, workspace_id, person_ref uuid (→ contacts), company_ref uuid (→ accounts),
lead_candidate_id uuid (→ lead_candidates), evidence_kind text CHECK (person_identity|company_identity|
  company_fit|provenance), source_provider, actor_key, actor_id, source_url,
value jsonb (sanitized; no raw payload), confidence text CHECK (low|medium|high),
verification text CHECK (provider_verified|self_reported|unverified),
observed_at timestamptz, sanitized boolean NOT NULL,
UNIQUE (workspace_id, evidence_kind, coalesce(person_ref,company_ref), source_url)  -- dedupe
```

**`signal_events`** — time-bound opportunity signals (hiring/funding/launch/expansion/founder/gtm).
```
id, workspace_id, person_ref, company_ref, lead_candidate_id,
signal_type text CHECK (<taxonomy>), signal_category text CHECK (growth|gtm|product|founder_intent|risk),
source_provider, actor_key, actor_id, source_url,
occurred_at timestamptz NOT NULL,  observed_at timestamptz NOT NULL,  expires_at timestamptz,
confidence text CHECK (low|medium|high), verification text CHECK (…),
listing_status text CHECK (active|closed|expired|unknown),
normalized_value jsonb (sanitized), dedupe_key text NOT NULL, sanitized boolean NOT NULL,
status text NOT NULL DEFAULT 'active' CHECK (active|stale|expired|contradicted|superseded|dismissed|archived),
UNIQUE (workspace_id, dedupe_key)  -- collapses the same event across providers
```
Companion `signal_event_evidence(signal_event_id, category, source_type, source_url, actor_key, actor_id,
observed_at, confidence)` for **multiple evidence references / multiple provider observations** per event.

**`engagement_events`** — interactions (connection/like/comment/reply/content_engagement).
```
id, workspace_id, person_ref, company_ref, content_ref text,
kind text CHECK (<engagement taxonomy>), occurred_at NOT NULL, observed_at NOT NULL,
authorized boolean NOT NULL, confidence text CHECK (…), source_url, sanitized boolean NOT NULL,
UNIQUE (workspace_id, person_ref, content_ref, kind, date_trunc('day', occurred_at))
```

Raw-payload policy: **no raw provider payload** in any of the three; only sanitized `value`/
`normalized_value`. PII policy: no email/phone columns; `source_url` limited to public profile/company
URLs. Retention: `signal_events`/`engagement_events` age via `status` transitions; `lead_evidence`
durable. `signal_reviews` re-points to `signal_events.id` (and/or `lead_evidence.id`).

This is how the 10 required storage cases map: (1) people_profile → `lead_evidence(person_identity)`;
(2) company profile → `lead_evidence(company_identity/company_fit)`; (3) hiring / (4) funding / (5)
launch/expansion → `signal_events`; (6) engagement → `engagement_events`; (7) multiple evidence refs →
`signal_event_evidence`; (8) multiple providers → same `dedupe_key`, multiple evidence rows; (9) stale/
superseded → `signal_events.status`; (10) watch/dismiss/review → existing `signal_reviews` re-pointed.

---

## 13. Migration & rollout plan (design only — do not execute)

- **Phase 0** — inventory (this document).
- **Phase 1** — add `lead_evidence`, `signal_events`, `signal_event_evidence`, `engagement_events`
  (additive; no writer changes; add `lead_candidates.evidence_id` nullable FK).
- **Phase 2** — dual-write behind `SIGNALS_V2` flag: writers also write the new tables; readers unchanged.
- **Phase 3** — idempotent backfill: 25 `people_profile` → `lead_evidence`; 217 `hiring_signal` →
  `signal_events` (deriving `occurred_at` from `raw` posting date where present, else mark
  `verification=unverified`); 185 engagement → `engagement_events`. Backfill keyed on `signals.id` for
  idempotency.
- **Phase 4** — reconcile counts + dedupe (new dedupe may legitimately collapse the 60 duplicate groups;
  record the mapping).
- **Phase 5** — move readers: "People" tab → `lead_evidence`; hiring/engagement tabs → new tables;
  `lead_candidates.signal_id` reads → `evidence_id`.
- **Phase 6** — stop legacy `signals` writes (flag flip).
- **Phase 7** — archive `signals` (rename, retain read-only) then drop after a soak.

Compatibility: dual-write + flag; rollback = flip flag off (legacy writers still live through Phase 6).
Reconciliation: per-`signals.id` mapping table. Duplicate-UI-event prevention: readers switch atomically
per tab; timing events keyed on `dedupe_key` so a backfilled + newly-written event collapse. Partial
failure: backfill is idempotent and re-runnable; readers never read new tables until Phase 5.

---

## 14. Backend API boundary (design only)

Keep identity evidence and opportunity signals in **separate responses**:

- `listSignalEvents({workspace, entity?, since?, status?})` → opportunity signals: type, category,
  `occurred_at`, `observed_at`, freshness, `status`, confidence, verification, company/person ref,
  evidence refs, recommended next action.
- `getSignalEvent(id)` → the above + full `signal_event_evidence[]`.
- `listSignalsForCompany/Person/LeadCandidate(ref)` → opportunity signals for an entity.
- `listLeadEvidence({workspace, lead_candidate})` → identity/provenance facts (no freshness).
- `markReviewed / watch / dismiss / restore(target)` → writes `signal_reviews`.
- `refreshStaleSignal(id)` → re-enrichment trigger (no auto-outreach).
- `aggregateAudiencePatterns({workspace, filters})` → cohort `TopicInsight` inputs, read-only.

Evidence, confidence, `occurred_at`/`observed_at`, freshness, lifecycle, entity refs, and next action are
exposed on the **signal** responses; the **evidence** responses expose provenance/identity only.

---

## 15. Architecture decision — **C. HYBRID**

- **`lead_evidence`** for durable identity/company facts (people_profile, company profiles, provenance).
- **`signal_events`** for time-bound opportunity signals (the canonical `SignalEvent`, enforceable).
- **`engagement_events`** for user/content interactions.

**Why it matches usage**: the three families already behave differently (identity is durable and
1:1-anchored to a lead; hiring is time-bound and expiring; engagement is fast-decaying) and are already
read through different UI tabs. **Why not Option B**: the current table *is* an informal unified ledger,
and it produced exactly the mislabelling and duplication this audit found; a nullable-everything unified
schema cannot enforce `occurred_at`/`dedupe_key` for the family that needs them. **Why not pure Option A
for identity**: identity evidence is small, durable, and lead-anchored — a separate `lead_evidence` table
(not a third "signal" table) keeps it out of the opportunity-signal surface entirely.

- **Find Leads**: unaffected during Phases 0–2; timing SignalEvents gain a real persistent home in
  `signal_events` (today they stay in memory).
- **Signals UI**: cleaner per-family tabs; the "People" tab reads evidence, not signals.
- **Content intelligence**: `signal_events` + `engagement_events` are the aggregation source for cohort
  `TopicInsight`s.
- **Engagement loop**: `engagement_events` is the persistent home the Phase-A `EngagementEvent` contract
  anticipated.

---

## 16. Risks & open questions

1. **`lead_candidates.signal_id` re-pointing** is the highest-risk change (it is in the lead dedupe key).
   Needs a careful `evidence_id` addition + backfill before any legacy-write stop.
2. **`occurred_at` backfill for 217 historical `hiring_signal` rows** — posting date may be absent in
   `raw`; those become `verification=unverified` and should not retroactively satisfy timing.
3. **Duplicate collapse**: the new `dedupe_key` unique will merge the 60 duplicate groups — confirm no
   reader counts on duplicates.
4. **`signal_reviews` re-pointing** (currently `ON DELETE CASCADE` on `signals`).
5. Whether `engagement_events` should feed candidate timing now or remain audience-only until the
   engagement loop ships.

---

## Appendix — file/line references

Schema: `supabase/migrations/20260611080445_c6dc2c5b-…sql:10-38` (signals), `:41-98` (accounts/contacts),
`:100-136` (lead_candidates incl. dedupe index `:129`); `supabase/migrations/20260613130000_phase6_signal_reviews.sql`.
Writers: `_shared/memoryWriter.ts:277,313,406,515-596(557 people_profile),678,778`;
`run-radar-scan/index.ts:329`. Readers: `src/lib/signalsFeed.ts:27-33`;
`src/components/signals/SignalFeed.tsx:80,156,318,326`, `SignalCard.tsx:10`;
`run-radar-scan/index.ts:200`; `run-agent/index.ts:2650`. Persistence trigger:
`run-agent/index.ts:1889-1955`. Contract: `_shared/signalEvent.ts` (SignalEvent, validateSignalEvent).
