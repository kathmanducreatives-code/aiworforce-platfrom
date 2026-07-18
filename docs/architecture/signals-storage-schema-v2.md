# Signals Storage v2 — Hybrid Schema (Phase 1)

Implements the architecture accepted in `signals-storage-audit.md`.

> **Status: NOT DEPLOYED.** This phase adds migration SQL, static tests and this document
> only. The migration has **not been applied** to any project. No writer, reader, RLS
> policy or existing table has been changed. Applying it must leave runtime behaviour
> identical until a later cutover phase.

Migration: `supabase/migrations/20260717170000_signals_storage_v2_hybrid.sql`
Static tests: `supabase/functions/_shared/signalsStorageV2Migration.test.ts` (21 assertions)

---

## 1. Table diagram

```
workspaces
   │ (ON DELETE CASCADE on every table below)
   ├── lead_evidence ──────────────┐  durable identity / company / provenance
   │      ├─ contact_id ──► contacts
   │      ├─ account_id ──► accounts
   │      ├─ lead_candidate_id ──► lead_candidates
   │      └─ legacy_signal_id ──► signals   (SET NULL)
   │
   ├── signal_events ──────────────┐  time-bound opportunity events ("why now?")
   │      ├─ contact_id / account_id / lead_candidate_id
   │      ├─ legacy_signal_id ──► signals   (SET NULL)
   │      └── signal_event_evidence          many observations per event
   │              └─ (signal_event_id, workspace_id) ──► signal_events (id, workspace_id) CASCADE
   │
   └── engagement_events ──────────┐  interactions (NOT buying timing)
          └─ legacy_signal_id ──► signals   (SET NULL)

lead_candidates
   ├─ signal_id  ──► signals        (UNCHANGED — still the live anchor)
   └─ evidence_id ──► lead_evidence (NEW, nullable, unpopulated in Phase 1)
```

Family mapping (planned, not executed):

| Legacy `signals` row | Future home |
|---|---|
| `people_profile` | `lead_evidence` (`evidence_kind = person_identity`) |
| `hiring_signal` | `signal_events` (+ one `signal_event_evidence` observation) |
| `linkedin_engagement`, `competitor_engagement` | `engagement_events` |

---

## 2. Columns

### `lead_evidence` — durable facts (no expiry, freshness irrelevant)
`id`, `workspace_id*`, `evidence_kind*`, `contact_id`, `account_id`, `lead_candidate_id`,
`provider`, `actor_key`, `actor_id`, `source_url`, `source_record_id`, `observed_at*`,
`verified_at`, `verification_status*`, `confidence`, `normalized_value*` (jsonb),
`dedupe_key*`, `lifecycle_status*`, `sanitized*`, `legacy_signal_id`, `created_at*`,
`updated_at*`.

`evidence_kind ∈ person_identity | company_identity | person_role | person_geography |
company_geography | company_fit | provider_provenance`.
There is **no `occurred_at`** — identity is not an event.

### `signal_events` — time-bound opportunity events
`id`, `workspace_id*`, `contact_id`, `account_id`, `lead_candidate_id`, `signal_type*`,
`signal_category*`, `evidence_category`, **`occurred_at*`**, **`observed_at*`**,
`expires_at`, `freshness`, `confidence`, `verification_status*`, `listing_status`,
`normalized_value*`, `dedupe_key*`, `lifecycle_status*`, `sanitized*`, `provider`,
`actor_key`, `actor_id`, `source_url`, `legacy_signal_id`, `created_at*`, `updated_at*`.

`occurred_at` deliberately has **no default** — it must come from the source event time.

### `signal_event_evidence` — per-source observations
`id`, `workspace_id*`, `signal_event_id*`, `provider`, `actor_key`, `actor_id`,
`source_url`, `source_record_id`, `evidence_fingerprint*`, `observed_at*`,
`verification_status*`, `confidence`, `normalized_value*`, `sanitized*`,
`legacy_signal_id`, `created_at*`, `updated_at*`.

### `engagement_events` — interactions
`id`, `workspace_id*`, `contact_id`, `account_id`, `lead_candidate_id`, `channel*`,
`event_type*`, `occurred_at*`, `observed_at*`, `provider`, `actor_key`, `actor_id`,
`source_url`, `source_record_id`, `verification_status*`, `confidence`,
`normalized_value*`, `dedupe_key*`, `lifecycle_status*`, `sanitized*`,
`legacy_signal_id`, `created_at*`, `updated_at*`.

(*) = NOT NULL.

---

## 3. Canonical vocabulary (no competing taxonomy)

Every CHECK constraint reuses the merged in-memory contracts verbatim:

| Concept | Source of truth | Values |
|---|---|---|
| `signal_type` | `signalEvent.ts` `SignalType` | the 24 non-engagement members (growth 4, gtm 6, product 4, founder_intent 5, risk 5) |
| `signal_category` | `signalEvent.ts` `SignalCategory` | `growth, gtm, product, founder_intent, risk` (**`engagement` excluded by design**) |
| `evidence_category` | `evidenceContract.ts` `EvidenceCategory` | the 6 timing categories; **NULL for risk signals** (`evidenceCategoryForSignalType → null`) |
| `verification_status` | `signalEvent.ts` `SignalVerification` | `provider_verified, self_reported, unverified` |
| `listing_status` | `timingFreshnessPolicy.ts` `ListingStatus` | `active, closed, expired, unknown` |
| `freshness` | `timingFreshnessPolicy.ts` `TimingFreshnessBand` | `strong, medium, weak_supporting, stale` |
| `event_type` (engagement) | `signalEvent.ts` `EngagementSignalType` | the 6 engagement members |
| `confidence` | `evidenceContract.ts` `EvidenceConfidence` | `low, medium, high` |

**Lifecycle** is a deliberate **superset** of the in-memory `SignalStatus`
(`active|superseded|stale|retracted`): every canonical value persists unchanged, plus the
four states the audit recommended — `expired, contradicted, dismissed, archived`. Nothing
canonical was dropped or redefined.

---

## 4. `occurred_at` vs `observed_at`

`occurred_at` = when the event happened; **it alone controls freshness**.
`observed_at` = when we discovered it; audit/provenance only.

This is the load-bearing rule from the timing foundation: a funding round announced eight
months ago but scraped today is **stale**, not fresh. A new provider observation is
appended to `signal_event_evidence` and **never rewrites the parent's `occurred_at`**.
`lead_evidence` has only `observed_at`, because durable identity is not an event.

---

## 5. Deduplication rules

| Table | Uniqueness |
|---|---|
| `lead_evidence` | `UNIQUE (workspace_id, dedupe_key)` |
| `signal_events` | `UNIQUE (workspace_id, dedupe_key)` — the same real-world event found by several providers collapses to one row |
| `signal_event_evidence` | `UNIQUE (workspace_id, signal_event_id, evidence_fingerprint)` — one row per distinct observation |
| `engagement_events` | `UNIQUE (workspace_id, dedupe_key)` |
| legacy mapping | partial `UNIQUE (legacy_signal_id) WHERE NOT NULL` on `lead_evidence`, `signal_events`, `engagement_events` |

This is the property today's `signals` table lacks entirely (60 duplicate
`(signal_type,title)` groups in TEST).

---

## 6. RLS model

RLS is **enabled on all four** new tables. Each has the same four policies used
throughout the repository, gated on the existing helper:

```
USING / WITH CHECK  public.has_workspace_access(auth.uid(), workspace_id)
```

`GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated;` and `GRANT ALL … TO service_role;`
(matching `signals`/`accounts`/`contacts`). No `anon`, no `public`, no production-specific
values. Existing `signals` and `signal_reviews` policies are untouched.

**Cross-workspace protection**: `signal_event_evidence` cannot attach to a parent event in
another workspace — enforced at the database boundary by a composite FK
`(signal_event_id, workspace_id) → signal_events (id, workspace_id)`, backed by a
parent-side `UNIQUE (id, workspace_id)`. This does not rely on application code.

---

## 7. Raw payload and PII policy

- **No raw provider payload column anywhere.** Only sanitized `normalized_value jsonb`.
  (Today's `signals.raw jsonb NOT NULL` accepts arbitrary payload — that is the risk this
  design removes.)
- **No `email` or `phone` columns**, and no credential/authorization columns.
- `sanitized boolean NOT NULL DEFAULT true` records that a row passed sanitization.
- `source_url` is limited to public profile/company/posting URLs.

---

## 8. Legacy mapping and rollback

Every family carries `legacy_signal_id uuid → signals(id) ON DELETE SET NULL`.

- **Never cascades** into `signals` — legacy rows cannot be deleted through the new tables.
- Makes any future backfill **idempotent** (re-runnable, keyed on the source row) and
  **reversible** (the origin of every migrated row is recoverable).
- **One-to-many across tables is expected**: one legacy `hiring_signal` maps to **both** a
  `signal_events` row *and* one `signal_event_evidence` observation. Uniqueness is
  therefore enforced **per table**, not globally; `signal_event_evidence.legacy_signal_id`
  is intentionally non-unique.

---

## 9. Future `evidence_id` cutover (documented, not implemented)

`lead_candidates.evidence_id` is added **nullable and unpopulated**. `signal_id` remains
the live anchor and keeps its place in the existing dedupe index `lc_dedupe_uniq`:

```
UNIQUE (workspace_id, coalesce(plan_id,…), coalesce(account_id,…),
        coalesce(contact_id,…), coalesce(signal_id,…))
```

The future equivalent substitutes `coalesce(evidence_id,…)` for `coalesce(signal_id,…)`.

**Why it is not created now:** adding a second unique index over the same tuple space while
both columns exist could reject legitimate rows during dual-write (a lead written with
`signal_id` set and `evidence_id` NULL collides with another such lead on the
`evidence_id`-based tuple). A partial unique index `WHERE evidence_id IS NOT NULL` is the
intended Phase-5 mechanism and must land **with** the writer cutover, not before it. This
is the highest-risk step of the whole migration.

---

## 10. Rollout order (phases after this one)

| Phase | Action | Reversible by |
|---|---|---|
| 1 (**this**) | add tables + `evidence_id`; no writers/readers touched | dropping unused tables |
| 2 | dual-write behind `SIGNALS_V2` flag; legacy writes continue | flag off |
| 3 | idempotent backfill keyed on `legacy_signal_id` | delete rows where `legacy_signal_id IS NOT NULL` |
| 4 | reconcile counts + dedupe (new keys legitimately collapse the 60 duplicate groups — record the mapping) | — |
| 5 | move readers; add the `evidence_id` partial unique **with** the writer cutover | flag off + revert reader commit |
| 6 | stop legacy `signals` writes | flag on |
| 7 | archive `signals` (rename, read-only) then drop after a soak | restore from archive |

**Backfill order**: `lead_evidence` → `signal_events` → `signal_event_evidence` →
`engagement_events` (evidence before the events that reference entities; observations after
their parent events).

**Reader cutover order**: Signals "People" tab → `lead_evidence`; hiring/engagement tabs →
`signal_events`/`engagement_events`; `lead_candidates.signal_id` reads → `evidence_id`;
radar dedup read last (it is the only reader that also writes).

**`signal_reviews` plan**: it currently references `signals(id) ON DELETE CASCADE`. In
Phase 5 add nullable `signal_event_id` / `lead_evidence_id` columns with matching partial
uniques, backfill from `legacy_signal_id`, then retire the `signal_id` target. Not in scope
here.

**Duplicate-UI-event prevention**: readers switch atomically per tab, and `dedupe_key`
guarantees a backfilled row and a newly dual-written row collapse to one.

---

## 11. Known limitations

1. `freshness` is a materialized convenience; `occurred_at` + policy remain authoritative.
   It can go stale between recomputations.
2. Backfilling `occurred_at` for the 217 historical `hiring_signal` rows may be impossible
   where the posting date is absent from `raw`; those should land as
   `verification_status = 'unverified'` and must not retroactively satisfy timing.
3. The `evidence_id` dedupe substitution is documented but unimplemented (see §9).
4. Engagement → timing promotion is deliberately **not** granted; it needs a separate
   reviewed policy.
5. No retention/TTL job is defined yet; lifecycle states exist but nothing transitions them.
