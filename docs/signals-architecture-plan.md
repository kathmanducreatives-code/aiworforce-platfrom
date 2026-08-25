# Signals — final architecture & phased plan

**Date:** 2026-08-25 · **Commit:** `616ec721` · **Status:** **Phases 0–7 complete and live-verified.** Every signal the system claims to collect has produced a canonical `signal_event` from a real provider call, every signal it cannot collect refuses with a stated reason, the feed shows situations rather than rows, monitoring runs on a schedule inside a per-workspace ceiling, and clusters carry a grounded relevance verdict citing their own evidence. Phase 8 not started.
**Companion:** `docs/signals-content-backend-audit.md`
**Progress:** see `docs/signals-phase-2-completion.md` for the Phase 2 verification record.

---

## The finding that reshapes this plan

The audit said Signals has "no funding collector" and that expansion, launches
and technology "aren't connected". Both are true **of Radar** — and both are
wrong about **Agentory**. The Lead capability registry already contains, with
real provider bindings, every one of them:

```
funding_signal_discovery        1 provider    ✅ supported
expansion_signal_discovery      1 provider    ✅ supported
product_launch_discovery        1 provider    ✅ supported
company_post_verification       1 provider    ✅ supported
technology_verification         1 provider    ✅ supported
hiring_verification             1 provider    ✅ supported
company_identity_resolution     1 provider    ✅ supported
company_enrichment              1 provider    ✅ supported
```

*(verified by executing `isCapabilitySupported` over `CAPABILITY_IDS`)*

**Signals' coverage gaps are wiring gaps, not capability gaps.** The correct
move is not to build collectors — it is to make Signals a second *orchestrator*
over the Lead capability engine. That is a substantially smaller build than the
audit implied, and it is what makes "one intelligence system" real rather than
aspirational.

Three more facts that shape the ordering:

- **`signal_events` already supports correlation.** It carries `account_id`,
  `contact_id`, `lead_candidate_id`, `occurred_at`, `expires_at`, `freshness`,
  `confidence`, `dedupe_key`, `provider`/`actor_key`, and `legacy_signal_id` as
  a bridge back to v1. Correlation needs **no new schema** — it is a query.
- **A safe migration already exists.** `signalsV2Writer` is flag-gated,
  sanitized, idempotent, and explicitly *legacy-authoritative*: it writes only
  after a confirmed legacy write and never throws into the legacy path. Radar
  does not call it (0 references); only `memoryWriter` does.
- **No `pg_cron`, no `pg_net`.** Scheduled monitoring needs infrastructure that
  does not exist yet.

---

## 0. Governing principle — `signal_events` is a shared memory, not a Lead output

```
                        COMPANY BRAIN
                     ICP + OFFER + BUYER
                              │
                              ▼
                    AGENTORY INTELLIGENCE
                              │
                       signal_events          ← shared market-intelligence memory
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
              LEADS        SIGNALS       CONTENT
           who to target    why now      what to say
```

`signal_events` receives intelligence from **whichever workflow legitimately
discovers evidence**:

```
Lead missions              ─┐
Scheduled Signals monitoring│
Manual Signals scans        ├─►  signal_events  ─►  Leads / Signals / Content
Tracked-company monitoring  │
Competitor monitoring       │
Website/change monitoring  ─┘        (future)
```

Two rules follow, and they pull in opposite directions — holding both is the
whole design:

1. **Reuse, don't re-buy.** If a Lead mission already found Acme's funding
   round an hour ago, a monitoring scan must not purchase it again.
2. **Signals and Content are NOT viewers of Lead byproducts.** A workspace that
   has never run a Lead mission must still open Signals and find real market
   intelligence, because monitoring discovered it independently.

### What this costs, structurally

| Requirement | Consequence |
|---|---|
| Distinguish who discovered a fact | **`signal_events.origin` — new column** |
| Monitor things the user chose, not just ICP | **monitoring-subject store — new table** |
| Never re-buy fresh evidence | **cross-origin freshness pre-flight before any provider call** |
| Content consumes the same intelligence later | **correlation output must be origin-agnostic, not a Signals view model** |
| Monitoring must not corrupt the Lead pipeline | **tested boundary: monitoring missions write no lead rows** |

### The anti-viewer gate

Every phase that converges storage carries one non-negotiable acceptance test:

> **For a workspace with zero Lead missions, the Signals feed is non-empty
> after monitoring has run.**

If that fails, convergence has turned Signals into a viewer and the phase is
not done.

---

## 1. Proposed final architecture

```
              COMPANY BRAIN + ICP + OFFER + BUYERS
                              │
                              ▼
                   SIGNAL MONITORING BRAIN
              (what matters for THIS workspace)
                              │
              ┌───────────────┴───────────────┐
        scheduled scans                 manual scans
              └───────────────┬───────────────┘
                              ▼
                  SIGNAL MISSION COMPILER
        a mission whose objective is MONITORING, not sourcing
                              │
                              ▼
            ►  LEAD CAPABILITY ENGINE  ◄   (reused whole)
              buildCapabilityGraph → execution plan
                              │
                              ▼
                       runTool boundary
            authorizeProviderCall → provider → settle
                    execution ledger + credits
                              │
                              ▼
                        RAW EVIDENCE
                              │
                              ▼
              DETERMINISTIC QUALITY FLOOR
        identity · evidence · recency · ICP hard exclusions
              (icpSignalScorer + signalQuality + freshness)
                              │
                              ▼
                    ►  signal_events  ◄  one canonical store
                       + signal_event_evidence
                              │
                              ▼
                 PER-COMPANY CORRELATION
        group by account_id over a freshness window
                              │
                              ▼
                       SIGNAL BRAIN                    ← GPT, last
        "why does this cluster matter to THIS user?"
              Luna → validator → Terra, via gptModelRouter
                              │
                              ▼
                       PRIORITY FEED
```

**The load-bearing decision:** Signals compiles a *monitoring mission* and hands
it to the existing capability engine. It does not own actor logic, provider
adapters, credit calls, or evidence contracts — all of those are already
hardened on the Lead path and become shared by reuse rather than by refactor.

---

## 2. Phased implementation plan

Ordering principle: **prove, then meter, then converge, then extend, then
reason.** Every phase before 7 is fully buildable with no OpenAI credits.

---

### Phase 0 — Prove the Radar path persists a row

| | |
|---|---|
| **Objective** | Turn 0 rows into ≥1 row, or delete the claim that Radar works. |
| **Problem solved** | Everything downstream assumes a code path nobody has observed. |
| **Reuses** | `run-radar-scan` as-is. No new code expected. |
| **New capability** | None. This is diagnosis. |
| **Database** | None. |
| **Provider** | One real Apify hiring scan, smallest possible. |
| **Credits** | ⚠️ Unmetered — this is the last sanctioned unmetered run. |
| **GPT** | No. |
| **Offline tests** | Existing radar suites. |
| **Live validation** | One manual scan → `select count(*) from signals`. |
| **Done** | A row exists, **or** a written root cause for why none can. |
| **Blocks** | Everything. |

> If Radar cannot persist, phases 1–3 change from "adapt" to "replace", and we
> need to know that before investing in either.

---

### Phase 1 — Put Signals behind the credit boundary

| | |
|---|---|
| **Objective** | No provider call from Signals without authorization + settle. |
| **Problem solved** | Radar bypasses `runTool`, so `authorizeProviderCall` never sees it. Leads are metered; Signals is not. A workspace at zero credits is blocked from leads and unrestricted on Signals. |
| **Reuses** | `runTool`, `authorizeProviderCall`/`settleProviderCall`, `creditPricing`, `executionLedger`, `logicalCallKey`. |
| **New capability** | Route radar provider calls through `runTool`; add signal capabilities to `creditPricing`; a per-workspace **scan budget** ceiling. |
| **Database** | None — `credit_transactions.kind` already accepts `provider_call`. |
| **Provider** | Same calls, now wrapped. |
| **Credits** | **This is the phase that stops the leak.** |
| **GPT** | No. |
| **Offline tests** | No radar provider call outside `runTool`; refusal leaves the scan un-run; budget caps enforced; settle-0 on a scan that never dispatched. |
| **Live validation** | Scan with balance → reserved + settled rows. Scan at zero → refused, nothing spent. |
| **Done** | Zero unmetered provider paths in Signals; ledger shows radar spend with provenance. |
| **Blocks** | Phase 6 (scheduling) is unsafe without it. |

---

### Phase 2 — Converge storage (dual-write only; **no read switch**) — ✅ COMPLETE 2026-08-24

| | |
|---|---|
| **Objective** | One canonical store receiving from both origins. **The UI keeps reading v1.** |
| **Problem solved** | Two architectures; `SIGNALS_V2` off; Radar never calls the v2 writer. |
| **Reuses** | `signalsV2Writer`, `signalsV2DualWrite`, `signalEvent.ts` sanitization, `legacy_signal_id`. |
| **New capability** | Radar calls the v2 writer after its legacy write (the same legacy-authoritative pattern `memoryWriter` uses). **Plus `signal_events.origin`.** |
| **Database** | **New migration: `origin` column** — `lead_mission · scheduled_monitor · manual_scan · tracked_company · competitor_monitor`. Widening only; existing rows backfill to `lead_mission` (the only writer today). Backfill v1 → v2 via `legacy_signal_id`. |
| **Provider** | None. |
| **Credits** | None. |
| **GPT** | No. |
| **Offline tests** | Dual-write idempotency; sanitization rejects; flag-off = zero DB calls; **every write states an origin**; read parity v1 vs v2 for one scan. |
| **Live validation** | Enable `SIGNALS_V2`, scan, confirm both stores agree and rows carry the right origin. |
| **Done** | ✅ Both stores agree (4 legacy → 4 events, 1:1); every row attributable to a real subject; **the UI still reads v1**. |
| **Blocks** | 3, 4, 5, 7 — now unblocked. |

**Two departures from the plan as written, both deliberate:**

1. **The subject model was not in the plan.** This row said the migration adds
   `origin` only. Enabling Radar exposed that `signal_events` *required* a lead
   entity, so a competitor's activity could only be stored by attaching it to
   some account — fabricating attribution and dropping competitor news into
   prospect queries. `subject_type` + `subject_key` were added so market
   evidence can be about a competitor or a category without pretending to be
   about a prospect.

2. **`occurred_at` became nullable.** It was `NOT NULL`, and Radar does not
   know when the event behind a web-search result happened. The available
   shortcut — writing the scan time — would have stated a fact nobody observed
   and made every freshness band derived from it a fiction. `occurred_at_basis`
   now records how the time is known, and a CHECK makes the pair inseparable:
   `source_reported` requires a timestamp, `unknown` forbids one. There is no
   way to record an invented time, and no way to lose a real one.

> **The read switch moved to Phase 3, deliberately.** Flipping it here would
> point the Signals feed at a store that only Lead missions populate — which is
> exactly how Signals becomes a viewer of Lead byproducts. The switch is safe
> only once monitoring writes to the same store independently.

---

### Phase 3 — Independent monitoring orchestration (**and only now, the read switch**)

| | |
|---|---|
| **Objective** | Signals discovers its own intelligence, then the feed moves to `signal_events`. |
| **Problem solved** | Two provider stacks for one company universe — *and* the risk that convergence leaves Signals dependent on Lead output. |
| **Reuses** | `leadCapabilityGraph`, `buildCapabilityGraph`, `leadCapabilityEngine`, actor cards, `leadDiscoveryStrategy`, identity resolution, `compileCompanyBrainContext`, `signalFreshness`. |
| **New capability** | Three things: **(a)** a deterministic **monitoring-mission compiler** (objective = monitoring, not sourcing); **(b)** a **monitoring-subject store** — tracked companies, competitors, signal interests, which have no home today; **(c)** a **cross-origin freshness pre-flight**: before any monitoring provider call, query `signal_events` for fresh matching evidence and skip the purchase if it exists, *whatever origin produced it*. |
| **Database** | **New table** for monitoring subjects (workspace, subject type, identifier, cadence, enabled). |
| **Provider** | Same actor cards as Leads — including the funding/expansion/launch/technology capabilities Radar never had. |
| **Credits** | Inherits Phase 1. The pre-flight **reduces** spend: reuse is the cheapest provider call. |
| **GPT** | No — the compiler is deterministic here, deliberately. |
| **Offline tests** | A monitoring mission yields a valid capability plan; **the plan contains no lead-only terminal step and writes no `lead_candidates`/`lead_results`**; subjects drive the mission; the pre-flight skips a purchase when fresh evidence exists from a *lead* origin; a stale hit does not skip. |
| **Live validation** | **THE ANTI-VIEWER GATE:** a workspace with zero Lead missions runs monitoring and gets a non-empty feed. Then flip the read to `signal_events` and confirm the feed is unchanged for a workspace that *has* run leads. |
| **Done** | Signals collects independently; the feed reads `signal_events`; both origins populate it; Radar's own adapters are unreferenced. |
| **Depends on** | 1, 2. |

#### Phase 3 completion, 2026-08-24

| Step | State |
|---|---|
| **3A** monitoring mission contract | ✅ |
| **3B** monitoring subject store | ✅ `monitoring_subjects` |
| **3C** monitoring compiler | ✅ subjects → a mission with no quota and no persistence terminal |
| **3D** routing | ✅ the graph's terminal branch omits `persistence` for a monitoring mission |
| **3E** cross-origin reuse pre-flight | ✅ keyed on the question, never the origin |
| **3F** independent collection | ✅ **live gate passed** |
| **3G** read switch | ✅ the feed reads `signal_events`, with measured parity |
| **3H** retire the duplicate Radar provider paths | ✅ jobs actor and hiring/funding web search retired |

**The gate, verified in the database rather than inferred.** One
`signal_events` row: `origin: scheduled_monitor`, `subject_type: competitor`,
`account_id` NULL, `occurred_at` NULL with basis `unknown`. Zero
`lead_candidates`, zero v1 `signals`. The real workspace untouched at 32 leads /
8 events. Credits 50 → 44, one transaction per distinct call, all settled, no
reservation left held. Provider costs in `lead_execution_calls` with
`execution_owner: monitoring` and `cost_source: provider_reported`; a timed-out
call recorded with a null cost and no rows, never as evidence. Repeat passes
deduplicate.

**What had to be fixed to get there** — six defects, each real:

1. **No continuation.** The job-search actor finishes in ~156s; the tool's poll
   gives up at 90s and reports the run PENDING. Monitoring had nowhere to keep
   that id, so every pass started a second run and discarded the first.
   `monitoring_runs` now holds the engine state per (workspace, mission_hash). A
   monitoring resume carries `pending_runs` and DROPS `completed_capabilities`:
   monitoring keeps no per-company records, so a skipped stage would leave the
   pool without the results that stage produced.
2. **The wall clock was invisible.** No `deadline`, no `readPendingRun`, so a
   worker kill recorded a running provider call as `provider_error`.
3. **The wrong gate for a named subject.** An ICP subject must qualify; a named
   subject needs an evidenced signal. The workspace answered the fit question
   when it chose to watch the company.
4. **Code had no way to assert what it proved.** `assessSignals` accepted a
   positive verdict only from the model. `provenVerdicts` now carries a
   capability's own finding — admitted only where the model contributed nothing
   usable, never over a cited model verdict, never over a model `absent`, and
   subject to the same citation rule.
5. **The evidence that earned the verdict was discarded.** `hiring_jobs` read
   `yc_open_jobs` unconditionally, so a paid search that upgraded a company had
   its rows dropped.
6. **A boundary leak.** Ten v1 `signals` rows had been written into a
   monitoring-only workspace. `memoryWriter`'s guard was already fixed to accept
   any engine authority and was unreachable, because `toolRegistry` narrowed
   anything not exactly `capability_engine` to `legacy` one layer above it. All
   three layers now derive from `PERSISTENCE_AUTHORITIES`.

**3G parity, measured.** The real workspace holds 14 v1 rows; 8 have canonical
counterparts and 6 predate the dual-write. The feed shows 14 — 8 rendered from
the canonical row, 6 carried through as legacy on an EXACT `legacy_signal_id`
join. The Radar payload worth keeping (ICP scoring, priority, freshness
reasoning, diagnostics) now travels in `normalized_value`, backfilled for rows
written before the mapper carried it.

**3H scope, and its limit.** Retired: the second Apify jobs adapter, and the
hiring/funding web search whose rows the canonical store refuses anyway. Kept:
`linkedin_intent`, `competitor`, `workflow_trend` — no capability searches the
web for market discussion — and Radar's posts/comments/people Apify adapters,
which nothing has been proven to replace.

#### Known limits carried into Phase 4

* **Monitoring re-buys on every pass.** The reuse pre-flight only reuses
  evidence with `occurred_at_basis: source_reported`, and monitoring's own
  events are `unknown` — undated cannot prove recency. What prevents re-spend is
  the subject's `cadence_minutes`, not the pre-flight. That is the correct
  division, but the cadence is not yet enforced by a scheduler.
* **No scheduler.** `run-monitoring-scan` accepts the service-role caller a
  cadence needs; nothing calls it on a cadence yet.
* **Monitoring's ledger keys collide across passes.** With no task id the
  `logical_call_key` is `no-task:…`, so repeated passes read as replays: credits
  correctly refuse to double-charge, and the execution ledger does not record
  the repeat.
* **A supplied bare NAME cannot resolve.** By design — a name is not an
  identity. Subjects should be stored as a domain or a LinkedIn URL, and the UI
  does not yet say so.

> This is the phase the whole rule exists to protect. If it is skipped or
> reordered after the read switch, Signals silently becomes a Lead viewer and
> the defect is invisible to anyone whose workspace happens to run leads.

---

### Phase 4 — Coverage: funding, expansion, launches, technology, posts

| | |
|---|---|
| **Objective** | Close the audit's "gaps" — which are wiring, not capability. |
| **Problem solved** | The UI offers filters (`funding`, `workflows`, `people`) with nothing behind them. |
| **Reuses** | `funding_signal_discovery`, `expansion_signal_discovery`, `product_launch_discovery`, `technology_verification`, `company_post_verification` — **all already supported with providers**. |
| **New capability** | Mapping signal categories → capability ids in the monitoring mission. Little new code. |
| **Database** | None. |
| **Provider** | Existing actor cards. |
| **Credits** | Each category priced in `creditPricing`. |
| **GPT** | No. |
| **Offline tests** | Each category maps to a supported capability; an unsupported category is refused, never silently empty. |
| **Live validation** | One scan per category yields typed `signal_events`. |
| **Done** | Every UI filter has a real collector or is honestly disabled. |
| **Depends on** | 3. |

---

#### Phase 4 completion, 2026-08-25

**The premise did not survive the audit.** The plan called this phase "wiring,
not capability", because five capabilities are "all already supported with
providers". They were all registered and all carded. Two of them ran.

| Signal | `icp` | named | Live-proven |
|---|---|---|---|
| `hiring` | ✅ | ✅ | ✅ Phase 3F — `sales_hiring` |
| `funding` | ✅ | ❌ nothing scheduled | ✅ `recent_funding` ×2 |
| `expansion` | ✅ | ✅ | ✅ `market_expansion` |
| `product_launch` | ✅ | ✅ | ✅ `product_launch` |
| `technology` | ⛔ | ⛔ | no canonical type can exist |
| `post` | ⛔ | ⛔ | evidence source, not a signal |
| `headcount_change` | ⛔ | ⛔ | no capability exists |

**Collectability is derived and checks the whole chain.** It asks the real graph
what it would schedule, the real engine-driven list what it would run, and the
canonical vocabulary whether the finding could ever be filed — that last check
first, because it is cheapest and most absolute. A test recomputes every verdict
independently from the graph, so the module cannot drift from the engine it
describes. It is also the first thing to express that collectability depends on
the SUBJECT KIND.

**Five defect classes were found and fixed, the same ones each time:**

1. **Scheduled but not engine-driven** — expansion and launch sat in the skip
   list; `known_company_resolution` had in Phase 3.
2. **Provider rows transformed into the wrong shape** — `resolveResponseKind`
   returned "jobs" for BOTH `apify_funding_rounds_datahyena` and
   `apify_google_news`. Funding's cost 25 rows read as "the actor returned no
   rows at all". Offline tests could not catch either: they hand the engine the
   provider's shape, and the transport sits between them.
3. **Evidence collected then discarded** — `fundingRounds` was pushed to and
   never read; `hiring_jobs` dropped the rows a paid search had upgraded on.
4. **Hiring-shaped qualification gates** — every eligibility clause asked about
   openings, so a company with a dated Series A never reached qualification.
5. **Code unable to assert what it proved** — `assessSignals` accepted a
   positive verdict only from the model. `provenVerdicts` now carries a
   capability's own finding, admitted only where the model contributed nothing
   usable, never over a cited model verdict, never over a model `absent`, and
   subject to the same citation rule.

#### Live validation, 2026-08-25

Smallest controlled runs. Every claim read from the database, not the logs.

| Check | Result |
|---|---|
| provider call → real rows | funding 3 rows, expansion/launch 19 articles |
| correct transport shape | both actors on the shape-preserving path |
| evidence in company state | `funding_signal`, `expansion_signal`, `launch_signal` registry items |
| verdict uses that evidence | funding `verified`, expansion/launch `plausible`, each citing its own items |
| canonical event written | `recent_funding` ×2, `market_expansion`, `product_launch` |
| credits reserve/settle | balance 50 → 38, `reserved_credits: 0`; **2 transactions `not_charged` and refunded** — a call that never started returns its credit |
| cost/provenance in the ledger | every succeeded call `cost_source: provider_reported`, `execution_owner: monitoring` |
| failed calls are not evidence | `failed` ×2, `timed_out` ×1, `started` ×1 — all with 0 rows and 0 cost; only `succeeded` rows carry either |
| no Lead rows or v1 leakage | real workspace unchanged at 32 leads / 14 v1 signals; fixture 0 / 0 |
| retries do not duplicate | repeat runs: `deduplicated: 1` and `written: 0` |

A run may now ask to be SMALLER — `max_candidates`, clamped to the ceiling. The
first real-workspace funding pass discovered 25 companies and
`qualification_deadline_stop` fired with `evaluated: 0`: the wall clock was gone
before the first model call, so nothing could qualify and the feed stayed empty
for a run that had paid for everything up to that point.

#### Decisions held, not worked around

* **Technology adoption stays unsupported.** BuiltWith reports what a domain
  runs NOW and publishes no adoption date — `adopted_at` is always null,
  deliberately. Real historical snapshots and change detection are what would
  make "adopted X" an event.
* **Company posts stay evidence.** The capability registry already lists
  `apify_linkedin_company_posts` as a provider for expansion and launch
  VERIFICATION, which is what reading a company's posts is for. A post becomes a
  signal only by proving an underlying business signal.
* **`headcount_change` stays unsupported.** No executable capability exists.

#### Known limits carried into Phase 5

* **A named subject cannot monitor funding.** Nothing schedules a funding
  capability for a supplied company; it is refused with that reason rather than
  spending on identity and enrichment first.
* **A domain-supplied subject may not resolve.** The identity search runs in
  `short` mode, which returns no website, so a supplied domain has nothing to
  match against and two companies sharing a name stay ambiguous. Supplying a
  LinkedIn URL resolves canonically and for free.
* **A URL-supplied subject needs enrichment for its name.** The news search has
  nothing to search for until enrichment supplies one; the stage now reports
  `skipped_unnamed` rather than an unexplained zero.
* **Monitoring's ledger keys still collide across passes** (`no-task:…`), so
  repeats read as replays: credits refuse to double-charge, and the execution
  ledger does not record the repeat.
* **Still no scheduler.** The endpoint accepts the service-role caller a cadence
  needs; nothing calls it on one.

---

### Phase 5 — Per-company correlation

| | |
|---|---|
| **Objective** | Turn independent events into situations. |
| **Problem solved** | *"Acme raised + hiring SDRs + founder posting"* cannot be expressed today; each event is scored alone. |
| **Reuses** | `signal_events.account_id` + `occurred_at` + `freshness` — **already present**. `company_identity_resolution` for the join key. |
| **New capability** | A correlation module producing a **shared, origin-agnostic `SignalCluster`** read model: group by account over a window, contributing events, deterministic priority, evidence per event. **Not a Signals view model** — Content consumes this exact structure in Phase 9, so a Signals-shaped output here buys a refactor later. |
| **Database** | Optionally a materialised cluster table; a view may suffice initially. |
| **Provider** | None — pure aggregation. |
| **Credits** | None. |
| **GPT** | No — deterministic priority first. |
| **Offline tests** | Three events on one account cluster; events on different accounts don't; stale events fall out of the window; priority is reproducible; a single event is a valid cluster of one; **a cluster mixing lead-origin and monitor-origin events forms normally and its priority does not depend on origin**. |
| **Live validation** | A real multi-signal company surfaces as one card. |
| **Done** | The feed shows situations, not rows. |
| **Depends on** | 2, 4. |

> **Identity is the risk here.** Correlation is only as good as `account_id`.
> Companies arriving from different providers must resolve to one account or
> clusters fragment silently.

---

#### Phase 5 completion, 2026-08-25

**The plan said group by `account_id` over an `occurred_at` window. Neither
exists.** Both columns are in the schema, which is what made them look
available. Read from the store: all thirteen events carry `account_id: NULL` and
all thirteen carry `occurred_at: NULL` with basis `unknown`. Grouping by account
would produce one cluster of nulls; a window over `occurred_at` would select
nothing.

That is Phase 2's rule holding, not a data gap: a market or competitor signal
uses a REAL SUBJECT MODEL rather than a borrowed account identity, and no source
time is invented. So the cluster key is `account_id` when an event has one and
the subject pair otherwise, and the window is over the best time each event
actually has — with the cluster stating which it used.

**An observation is never presented as an occurrence.** Every cluster reports
`timing: { occurred, observed_only }`, an undated cluster says so in its own
priority reasons, and the UI says "3 signals seen" rather than "3 signals this
week". The distinction is the difference between a claim about the company and a
claim about when we looked.

**Priority is deterministic and origin-agnostic.** Breadth over volume — three
funding rows about one company is one fact reported three times, so distinct
categories weigh most and raw count is capped. Proven over asserted, dated over
merely noticed. Nothing reads `origin` except to count it, so the same facts
rank identically whether a Lead mission or a monitor found them. Phase 9's
Content consumer reads this exact structure, which is why the output is not
Signals-shaped.

**The risk the plan named is reported, not papered over.** A company watched by
LinkedIn URL and the same company discovered by a funding round land under
different keys and split silently. `identityFragmentationRisk` NAMES the
candidate pairs and merges nothing — joining them needs
`company_identity_resolution`, and guessing from string shape would merge two
companies sharing a word.

**Imported, not mirrored.** The module is pure and import-free, so the browser
uses the same file the edge runtime does. The codebase's other cross-runtime
modules are mirrored into `src/`, and a mirror is a second copy that drifts — a
test asserts no mirror exists.

| Live validation | Result |
|---|---|
| clustering the real store | 13 events → 6 clusters, 0 excluded |
| a real multi-signal company as one card | Vercel at priority 93 — `market_expansion` + `product_launch` + `sales_hiring`, three categories |
| single-signal clusters below it | 11–15 |
| fragmentation candidates in current data | none |
| the feed renders it | "1 situation · Vercel · Expansion · Product launch · Hiring · 3 signals seen" |

No database object was added. The plan allowed a materialised table or a view;
the clusters are computed from rows the feed already fetches, which is the
simplest thing that works and leaves materialisation as an optimisation.

#### Known limits carried into Phase 6

* **Correlation is per-namespace.** Subject keys and account ids do not meet.
  Nothing in the current data fragments, but nothing prevents it either.
* **Every cluster is undated.** No event yet carries `occurred_at`, so every
  window is over observation time. A dated event would improve ranking
  immediately — the scoring already rewards it.
* **A cluster is computed per feed load.** Fine at 13 events; a materialised
  table is the answer when a workspace holds thousands.

---

### Phase 6 — Scheduled monitoring with spend control

| | |
|---|---|
| **Objective** | Signals answers "what's happening" without being asked. |
| **Problem solved** | Manual-only defeats the product premise. |
| **Reuses** | Phase-1 budgets, `logicalCallKey` idempotency, `signalFreshness`, continuation/checkpoint patterns from the lead engine. |
| **New capability** | Scheduler (**needs `pg_cron` enabled — not currently installed**, or Supabase scheduled functions); per-workspace cadence driven by the Phase-3 subject store. **Cached-evidence reuse is inherited from Phase 3's pre-flight, not built here** — it had to exist the moment two origins wrote to one store. |
| **Database** | A scan-schedule + last-run table. |
| **Provider** | Recurring — the highest-risk spend surface in the product. |
| **Credits** | Hard ceilings per workspace per period; refuse rather than overspend. |
| **GPT** | No. |
| **Offline tests** | A scan inside the freshness window buys nothing; **a scan skips evidence a Lead mission collected an hour ago**; budget exhaustion refuses and checkpoints; two schedulers firing once produce one scan. |
| **Live validation** | Two consecutive scheduled runs: the second must cost materially less than the first. |
| **Done** | Scheduled scans run within budget and demonstrably reuse cached evidence. |
| **Depends on** | 1 (hard), 3, 5. |

---

#### Phase 6 status, 2026-08-25

**The plan expected Phase 3's pre-flight to prevent the re-spend.** It does — for
DATED evidence. Its rule is `occurred_at_basis === "source_reported"`, because an
undated event cannot be shown to fall inside a recency window, and monitoring
writes every event with `occurred_at: null`. So the pre-flight can never reuse
monitoring's own evidence.

That is not a defect to route around. The two mechanisms answer different
questions and neither substitutes for the other:

| Mechanism | Question | Answerable from |
|---|---|---|
| Pre-flight (Phase 3E) | is the ANSWER still fresh? | evidence with a source date |
| Cadence (Phase 6) | did we ASK recently? | `last_run_at` + `cadence_minutes` |

**Three guards, each for something the others cannot do.**

* **The cadence** decides whether to ask. A subject that has never run is due
  immediately — waiting a full cadence for the first answer is the opposite of
  what somebody who just added a subject wants.
* **The period ceiling** bounds unattended spend. Every other guard answers "may
  THIS call happen"; none can stop a hundred small calls a day for a month. It
  refuses rather than truncating, and is checked BEFORE the claim so a refused
  workspace does not have its cadence advanced for a pass that never ran.
* **The claim** is a compare-and-swap in one statement, so two ticks produce one
  scan — and a LEASE, not a flag, because a flag set by a run that crashes
  freezes the subject forever.

**Unattended spend has its own name in the ledger.** Every provider charge was
`provider_call`, so a period total could not tell a scheduled pass from a person
clicking Scan. `task_id IS NULL` does not separate them either — a Radar scan is
taskless too. The distinction is who decided to spend, which the system already
records as the persistence authority, so `monitoring_call` is charged exactly
when the engine runs under `monitoring_engine`.

**The tick owns no engine.** It decides and then calls `run-monitoring-scan` —
the same endpoint a person triggers. A scheduled pass and a manual one must be
the same pass, or the thing that runs unattended is not the thing anybody
tested.

| Live validation | Result |
|---|---|
| dry run decides, spends nothing | 1 due, "would scan — 200 of 200 credits left" |
| tick 1 scans unattended | 5 capabilities completed |
| **tick 2, immediately** | **0 due, `inside_cadence: 1`, nothing scanned, 0.22s** |
| ledger records unattended spend separately | `monitoring_call` charged 1 |
| ceiling 0 refuses | "scheduled scans are off", `claimed: 0`, `last_run_at` unchanged |
| two ticks fired together | one claimed and scanned; the other stood down |
| **the real cron fired unattended** | claimed 09:15:00.9 → scanned → `last_run_at` 09:15:59.8 → claim released |
| **evidence is reused, not just cadence-gated** | `reused: 1, investigating: 0` — "1 investigation(s) reused, 0 bought" |

**The event now carries the source's own date, which is what makes that last row
possible.** It was written `occurred_at: null` unconditionally, on the grounds
that the stage states no source time of its own. The stage does not — but the
EVIDENCE does: a funding round has an announced date, a news article a
publication date, a job posting a posted date. Discarding it made every
monitoring event undated, which then made the pre-flight unable to reuse one, so
a monitor re-bought answers it already held. A live expansion event now reads
`occurred_at: 2026-07-28` with basis `source_reported` against
`observed_at: 2026-08-25` — when it happened, and when we looked.

Still null when nothing cited carries a date, and a future date is refused
outright: a provider reporting tomorrow is reporting a mistake, and writing it
would make an event look fresher than anything that has happened.

`pg_cron` and `pg_net` are enabled and `monitoring-tick` runs every 15 minutes.
That is not how often a workspace is scanned — the cadence decides that. A
frequent tick is a single indexed read when nothing is due, and it means a
newly-added subject answers within fifteen minutes rather than within its
cadence. The service key lives in `vault.decrypted_secrets`, never in a
migration.

#### What Phase 6 does NOT do

* **No workspace auto-scans until it enables a monitoring subject.** The real
  workspace's subject is disabled; enabling it is a spend decision and belongs
  to its owner.
* **The Signals page updates on load, not by push.** Clusters are computed from
  the rows the feed already fetches, so a scheduled scan appears on the next
  visit. Live push is a Phase 7+ concern.
* **The ceiling counts credits, not dollars.** One credit is one provider call
  whatever it cost; a per-dollar ceiling would need the ledger's
  `actual_cost_usd`, which is recorded but not yet summed.

---

### Phase 7 — Semantic relevance (**requires OpenAI credits**)

| | |
|---|---|
| **Objective** | Answer "why does this matter to *this* user?" |
| **Problem solved** | Relevance is lexical string matching; it cannot tell that a founder post is *about* the pain the user solves. |
| **Reuses** | `gptModelRouter` (Luna → validate → Terra), `modelEscalation`, `modelCostModel` telemetry, `creditPricing`. |
| **New capability** | A cluster-level relevance judge that **re-ranks only what the deterministic floor already accepted** — it may demote and explain, never promote past the evidence gate, and never invent relevance where evidence is absent. |
| **Database** | Relevance verdict + reasoning + evidence refs on the cluster. |
| **Provider** | None. |
| **Credits** | Model spend in dollars (execution ledger), not credits. |
| **GPT** | **Yes — the only phase that needs it.** |
| **Offline tests** | Golden clusters with fixed model output: a cluster with no evidence is never rated urgent; the judge cannot raise a cluster the floor rejected; a provider failure leaves the deterministic ranking intact. |
| **Live validation** | Blind comparison of deterministic vs re-ranked ordering on real clusters. |
| **Done** | Clusters carry a grounded "why this matters" citing their own evidence. |
| **Depends on** | 5. **Blocked on OpenAI credits.** |

---

#### Phase 7 completion, 2026-08-25

**The boundary is code, not a prompt instruction.** A prompt that says "only
cite real events" is a request; a validator that drops uncited claims is a
guarantee. Every rule is enforced against the cluster the model was given, and
two of them are enforced again by the database.

| Rule | Where it is enforced |
|---|---|
| cannot invent a signal | every cited id must be an event in this cluster; a verdict left with none is refused |
| cannot promote | the band is a multiplier in (0, 1] — no arithmetic raises a cluster — **and a CHECK refuses a stored row whose adjusted priority exceeds the deterministic one** |
| cannot call a stale situation timely | `timely` needs a cited event with a SOURCE date inside 45 days; an observation date is when we looked |
| a believed verdict must cite | the validator refuses it, **and a CHECK refuses the row** |
| failure changes nothing | any provider error, unparseable answer or refused verdict returns the deterministic cluster untouched |

**Luna, validate, then Terra — and only then.** Terra is bought exactly once,
and only when the validator found something a re-read could FIX: a miscited id,
a missing field, a band outside the vocabulary. A provider that is unavailable
produces no verdict to repair, so those fall straight back. Sol is never routed
here; the stage policy names only Luna and Terra.

| Live validation | Result |
|---|---|
| **identical evidence, different Company Brain** | generic B2B SaaS reads `low`, 96 to 38; developer-tooling reads `medium`, 96 to 67 |
| the explanation cites a real event | the verdict's `evidence_event_ids` JOIN to a `signal_events` row dated 2026-07-28 |
| it uses the SOURCE date, not the observation | "a reported market-expansion event from 28 days ago" — the article's date, not today |
| model cost, latency, usage in the ledger | `model_call` row: Luna, 3806 ms, 786 in / 286 out, $0.0005, `event_priced`, outcome `believed` |
| the database refuses a promotion | insert with adjusted 999 over deterministic 10 rejected |
| the database refuses an uncited believed verdict | rejected — after a fix; see below |
| the feed shows it | "Vercel · Worth a look · Why now: … 28 days ago · Why it matters: … · 1 dated · 2 seen · 1 cited" |

**A CHECK that passed on NULL was not a CHECK.** The first version of
`signal_cluster_relevance_model_verdict_cites` read
`array_length(evidence_event_ids, 1) >= 1`. `array_length` of an EMPTY array is
NULL, `NULL >= 1` is NULL, and a CHECK rejects only FALSE — so a believed
verdict citing nothing was accepted. Found by inserting one and watching it go
in. The point of restating the validator's rule in the database was to hold when
a caller bypasses the validator; a constraint that cannot fail is the appearance
of a second line of defence, which is worse than none.

**`model_call` already had a contract nobody had used.** The record kind was
declared, and two CHECKs required a non-empty `metadata.model` and forbade
provider run ids on such a row. Following the existing contract was the fix,
rather than inventing a second convention beside it.

#### What Phase 7 does NOT do

* **It judges only what a pass touched.** Re-judging a whole feed on every scan
  would pay for opinions nothing new bears on. A cluster no pass has touched
  keeps its last verdict, or none.
* **It never promotes, so it cannot surface something the floor missed.** If the
  evidence gate refused a signal, no amount of relevance brings it back — that
  is the boundary, not a gap.
* **The verdict is a cache of an opinion.** Deleting
  `signal_cluster_relevance` loses no intelligence: the events remain, the
  clusters rebuild, and the feed falls back to the deterministic ranking.

---

### Phase 8 — Product integration (Signals ↔ Leads)

Signal → lead prioritisation (`signal_events.lead_candidate_id` already exists),
"Open in Leads", track-company (writes to the Phase-3 subject store, closing the
loop). Lead → Signals already works via `memoryWriter`. No GPT for the wiring.
Depends on 5; on 7 for the "why".

---

### Phase 9 — Content consumes the same intelligence

| | |
|---|---|
| **Objective** | Content becomes a third consumer of the kernel, not a fourth stack. |
| **Problem solved** | Content is a `switch` over the Signals feed. It must understand what the market is *talking about*, independent of whether leads were just generated. |
| **Reuses** | `SignalCluster` (Phase 5, origin-agnostic by design), `signal_events` filtered by type — posts, comments, competitor activity — plus qualified leads, Brain/ICP/offer, `gptModelRouter`. |
| **New capability** | Theme extraction across clusters + lead conversations + competitor content; opportunity persistence **with evidence references**. |
| **Database** | Content opportunity + evidence-link tables. |
| **Provider** | None new — competitor/post collection is Phase 4 coverage under a different subject type. |
| **Credits** | Collection already metered; generation is model spend in dollars. |
| **GPT** | Yes. |
| **Offline tests** | An opportunity cites ≥1 real `signal_event`; an opportunity with no evidence is refused; **Content produces output for a workspace with zero Lead missions**. |
| **Live validation** | An opportunity traceable to the events behind it. |
| **Done** | Opportunities are grounded, persisted and provenanced. |
| **Depends on** | 5, 7. |

> **Because Phase 5's cluster is origin-agnostic and Phase 3 gives Content a
> monitoring path through the same subject store, this needs no refactor of
> anything below it** — which is the point of settling the boundary now rather
> than when Content is built.

---

## 3. Dependencies

```
0 ──► 1 ──► 2 ──► 3 ──► 4 ──► 5 ──► 6 ──► 8
                    │         │
                    │         └────► 7 (needs OpenAI) ──► 9
                    │
                    └── read switch + anti-viewer gate lives HERE, not in 2
```

Two hard gates:

- **1 gates 6.** Scheduling an unmetered provider path is the one combination
  that can spend without limit.
- **3 gates the read switch.** Pointing the feed at `signal_events` before
  monitoring populates it independently is how Signals becomes a Lead viewer —
  and the failure is invisible in any workspace that runs leads.

## 4. Completable without OpenAI

**Phases 0–6 and 8.** That is collection, metering, convergence, independent
monitoring, coverage, correlation, scheduling and Lead integration — the entire
deterministic product, including the shared-memory rule. Only **7** and **9**
need OpenAI.

Deliberate consequence: the deterministic floor ships as the *product*, not as
scaffolding. If GPT never arrives, Signals still works; it explains less.

## 5. Needs live provider validation

| Phase | Why code cannot prove it |
|---|---|
| 0 | 0 rows is exactly the thing tests didn't catch |
| 1 | reserve/settle against a real balance |
| 2 | v1↔v2 parity on real rows |
| 4 | each actor returns the shape the card claims |
| 5 | identity resolution actually joins real companies |
| 3 | **the anti-viewer gate** — zero-Lead workspace gets a non-empty feed |
| 6 | second scan costs less than the first |

## 6. What happens to the old Radar

| Component | Disposition |
|---|---|
| `icpSignalScorer` | **Preserve.** The deterministic floor. Real ICP/disqualifier logic. |
| `signalQuality`, `signalFreshness`, `signalDedupeKey` | **Preserve.** Shared with Leads. |
| `compileCompanyBrainContext` | **Preserve.** Already shared. |
| `radarDiagnostics` | **Adapt.** Fold into the execution ledger. |
| `radarScanPlanner` | **Merge** into the monitoring-mission compiler (Phase 3). Its per-category budget mix is the seed of the subject store's cadence model. |
| `radarCandidatePipeline` | **Merge** — scoring survives, dedupe moves to the writer. |
| `radarProviderAdapters`, `radarSources/*` | **Deprecate** after Phase 3 — the capability engine owns providers. |
| `runFirecrawlSource` | **Adapt.** Search role is legitimate; meter it, and keep it distinct from Deep Company Research. |
| `competitorIntelligence.ts`, `marketIntelligence.ts` | **Delete.** 0 importers. Rebuild against clusters if wanted. |
| `signals` (v1 table) | **Retire** after Phase 2 read-switch + backfill. |
| `signalsV2DualWrite` | **Preserve, then retire** once v2 is sole. |

## 7. Major risks

1. **Radar may not work at all** (Phase 0). Mitigated by ordering.
2. **Identity fragmentation** breaks correlation silently — clusters look thin
   rather than broken. Needs an explicit unresolved-identity metric.
3. **Scheduled spend** is the largest new cost surface. Phase 1 first, always.
4. **Migration breaking the live feed** — never flip the read before parity.
5. **GPT fabricating relevance.** The judge must be structurally unable to
   promote past the evidence gate, not merely instructed not to.
6. **Reuse pressure on the Lead engine.** A monitoring mission must not be able
   to trigger lead-only terminal steps or write lead rows. Now a *tested
   invariant*, not a note: the shared store widens the blast radius.
7. **Signals silently becoming a Lead viewer.** The highest-consequence risk
   this revision addresses, and the hardest to notice — a workspace that runs
   leads sees a full feed either way. Mitigated by holding the read switch
   until Phase 3 and by the zero-Lead acceptance test.
8. **Origin-blind dedupe collapsing distinct facts.** Reuse depends on
   `dedupe_key`. Too loose and a monitoring scan skips evidence it should have
   bought; too tight and the same fact is purchased twice. Needs measuring in
   Phase 3, not assuming.

#### Phase 8 record — Leads ↔ Signals integration, 2026-08-25

**Status: shared execution path built and proven offline; one live gate open.**

##### What the audit found (the plan's premises were again not all true)

1. **"Lead → Signals already works via `memoryWriter`" — false.** The Phase 3F
   guard returns at `memoryWriter.ts:343`, before the dispatch at line 350, so
   a Lead mission never reached the canonical writer at all.

2. **Dedupe keys were namespaced by surface.** Keys carried a surface prefix,
   which made cross-surface dedupe structurally impossible: monitoring and a
   Lead mission observing the same fact could not collide by construction.
   Fixed by `canonicalSignalEvent.ts` (origin-free projection) plus migration
   `20260825170000_canonical_dedupe_keys.sql`, which backfills existing rows.

3. **The Lead mission compiler could NOT accept a company-only mission.** This
   is the answer to the audit question the phase asked, and it was the real
   blocker. `compileLeadEntityIntent` asserts its own invariant — a
   `target_entity` of `company` always means `execution_mode: "company_first"`
   with `company_gate_required: true`. But its ambiguity fallback degrades an
   unsure sentence to `person_first` with no gate, and
   `applyMissionEntityAuthority` then overlaid the mission's `target_entity`
   and cleared `clarification_required` **without restoring the mode**. The
   result was an intent that said *company* and executed *person_first*.

   That is not cosmetic. `run-agent/index.ts:1230` nests the entire
   mission-driven capability engine inside `isCompanyFirstRequest`, which
   requires both flags. A company-only mission — exactly the shape a Signals
   "Investigate company" action produces — was refused with
   `sourcing_requires_mission_architecture` and no provider was ever called.

   Fixed in the shared path (`applyMissionEntityAuthority`), not with a
   Signals-specific executor: the overlay now restores only the entity's
   *unconditional* rules, exactly as the compiler states them. The person
   branch and the job gate stay text-dependent and are left as compiled, so
   this reinstates the compiler's invariant rather than adding a second
   routing rule. Covered by `missionEntityAuthorityCoherence.test.ts`, whose
   three failing assertions were written before the fix and which keeps two
   guard tests (person untouched, no-mission passthrough) green.

##### Proven

- Cross-surface dedupe, **live**: inserting a `lead_mission` row with key
  `competitor|linkedin-com-company-vercel|sales_hiring` was refused by
  `signal_events_workspace_dedupe_uniq`. Before the backfill it would have
  created a duplicate.
- The paid-execution boundary is real, **live**: a hand-written mission was
  refused by `PaidExecutionBlockedError` with `incompatible_planner_contract`
  and `mission_compilation_failed`. An uncompiled mission cannot be spent
  against — the guard was not worked around.
- Signals → Leads decisioning (`signalsToLeads.ts`): `openInLeads` refuses
  `not_a_company_subject` and `no_safe_identifier`; only a domain or a
  LinkedIn company URL is a safe identifier, so no company is ever merged
  from a fuzzy name. `investigateMissionFields` runs every requested signal
  through the existing origin-agnostic preflight and drops already-answered
  signals, returning `everything_already_known` when nothing remains.
- Opening a situation creates no Lead rows and spends nothing: the fixture
  workspace still reports `lead_candidates = 0`.
- 5724 edge-function tests, 235 frontend tests, `tsc --noEmit` clean.
- Five mutations confirmed to bite: surface prefix restored to the dedupe key;
  slug reversal; name-as-identifier; stale evidence suppressing purchase;
  origin-filtered reuse.

##### Open — the live half of requirement 1

A Lead-mission run that writes a `lead_mission`-origin `signal_event` has not
been observed live. The write block is implemented, deployed (`run-agent` v68)
and type-checked, and the routing defect that blocked it is fixed, but
executing it end-to-end requires a **model-compiled** mission, and the only
entry point that compiles one — `pilot-chat` — requires an authenticated user
JWT and correctly rejects the service key. Minting one is not something this
work should do.

**To close it:** run one Lead mission from the app against a workspace, then
confirm a row with `origin = 'lead_mission'` appears in `signal_events`.

Requirements 2, 6 and 9 depend on the same live gate. Per the phase's own
instruction — *integrate into the real Signals UI only after the underlying
shared execution path is proven* — the situation actions
(`Open in Leads` / `Investigate` / `Track` / `Find decision makers`) are
**deliberately not wired into `SituationStrip.tsx` yet**. The decision layer
they will call is built and tested.

## 8. Recommended first phase

**Phase 0 — prove the Radar path persists a row.** It is hours, not days; it
is the only phase whose outcome can invalidate the others; and 0 rows after a
substantial build is precisely the class of problem that ships unnoticed.

Then **Phase 1** regardless of Phase 0's result: the credit leak exists whether
or not Radar persists, and it is now the only unmetered provider path in the
product.
