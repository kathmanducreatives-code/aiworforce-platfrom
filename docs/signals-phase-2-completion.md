# Phase 2 — storage convergence: completion record

**Date:** 2026-08-24 · **Project:** `ohsdatpvfdjdemstoiuj` (agentory) · **Branch:** `feat/lead-mission-v1`
**Plan:** `docs/signals-architecture-plan.md` § Phase 2

Phase 2 is complete. `signal_events` now receives from Lead missions *and* from
Radar, every row states where it came from, and market evidence is attributed to
a real subject rather than to a borrowed account.

```
Lead missions ─────────────┐
                           │
Radar / Signals ───────────┼──► signal_events
                           │
future monitoring ─────────┘   (Phase 3)
```

**The UI still reads v1.** Nothing in `src/` reads `signal_events`. The read
switch remains Phase 3, after independent monitoring passes the anti-viewer gate.

---

## What was deployed

| | |
|---|---|
| Migration | `20260824130000_signal_events_subject.sql` — applied; ledger reconciled across all 8 |
| Function | `run-radar-scan` **v15** (v14 predated the dual-write code) |
| Flag | `SIGNALS_V2 = true`, digest-verified |

---

## Verification

### Preconditions

`signal_events` was empty — exact `COUNT(*) = 0`, not inferred.

Every constraint change was independently confirmed to be a **strict widening**,
so the migration was safe regardless of emptiness: `signal_type` 24 → 26 values
with none removed, `signal_category` 5 → 6 with none removed, and
`signal_events_entity_present` replaced by `signal_events_attributable`, which
adds an `OR` branch and is therefore strictly weaker.

### Constraints reject what they must

Two valid controls accepted; nine invalid rows each refused by the **named**
constraint, nothing persisted. The controls matter: an earlier attempt used a
random `workspace_id` and every case failed on the foreign key, which would have
made "everything rejected" meaningless.

| Attempt | Refused by |
|---|---|
| `subject_type = vendor` | `signal_events_subject_type_valid` |
| non-canonical `subject_key` | `signal_events_subject_key_canonical` |
| type without key | `signal_events_subject_pair_complete` |
| no lead entity **and** no subject | `signal_events_attributable` |
| `origin = radar` | `signal_events_origin_valid` |
| `occurred_at_basis = guessed` | `signal_events_occurred_at_basis_valid` |
| **invented time** — `unknown` + a timestamp | `signal_events_occurred_at_coherent` |
| **lost time** — `source_reported` + null | `signal_events_occurred_at_coherent` |
| `signal_type` outside the vocabulary | `signal_events_type_valid` |

### One controlled Radar scan

Legacy `signals` 5 → 9 (+4). `signal_events` 0 → 4. Written ~200 ms apart.
**1:1 — no drops, no extras.**

| Legacy row | v2 type | Subject | Origin | Time basis |
|---|---|---|---|---|
| `competitor` — Outreach.io Product News | `competitor_activity` | `competitor:outreach` | `manual_scan` | `unknown`, null |
| 3 × `linkedin_intent` | `market_problem_discussion` | `market:buyer-intent` | `manual_scan` | `unknown`, null |

Provenance on every row: `provider = firecrawl_search`, a `source_url`, a link
back to the legacy row, `verification_status = unverified` (nothing external
verified a search result), `evidence_category = null` (market context is never
proof of a prospect's timing), `freshness = null` (no source time, nothing to
decay from), and `scan_run_id` correctly **not** carried into `normalized_value`.

**Zero rows carry a lead entity.** The rule that market signals must never wear
a fabricated account identity holds in live data, not only in tests.

### Idempotency — four ways

| Case | Result |
|---|---|
| Replay the same `dedupe_key` via `ON CONFLICT DO NOTHING` | deduplicated, 4 → 4 |
| **Blind** duplicate insert, no `ON CONFLICT` | refused by `signal_events_workspace_dedupe_uniq` |
| Second event for the same `legacy_signal_id` | refused by `signal_events_legacy_signal_uniq` |
| **Different** page, same subject | accepted — dedupe is per subject **+ evidence**, not per subject |

The second case is the one worth keeping: the guarantee does not depend on a
caller remembering the conflict clause.

---

## Known limitation, carried forward

One captured row is `policy-manual.mes.dhcs.ca.gov` — *"7. BHSA Components and
Requirements"*, California health policy — stored as
`market:buyer-intent` / `market_problem_discussion`.

The convergence carried it faithfully; the substance is junk. Two causes, both
in Radar rather than in this phase:

* Radar's web search returned an irrelevant result.
* `MARKET_SUBJECT_KEY` in `radarSignalToV2.ts` is coarse by design. Radar does
  not thread the Company Brain topic that generated a query onto the persisted
  row, so the honest available subject is the problem space the plan category
  represents. Refining it means carrying the topic through the scan plan — a
  change to Radar, not a guess for the adapter to make.

Neither weakens the storage contract. Both belong to Phase 4 (coverage) or a
Radar retrieval-quality pass.

---

## Not done here, deliberately

* **No read switch.** Phase 3, after the anti-viewer gate.
* **No monitoring orchestration.** Phase 3.
* **No revived Radar Apify adapters.** Future coverage reuses the shared Lead
  capability engine, per the plan's § 0.
* **No `signal_event_evidence` rows** from Radar. A search result is one
  locator, already carried on the event as `source_url` + `provider`; a
  separate evidence row would duplicate it without adding a second source.
