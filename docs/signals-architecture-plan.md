# Signals — final architecture & phased plan

**Date:** 2026-08-24 · **Commit:** `6ff08961` · **Status:** Phases 0–2 complete and live-verified. Phase 3A–3F built and offline-proven end to end; **3F's live anti-viewer gate is blocked on two empty provider balances**, so 3G and 3H have not started.
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

#### Phase 3 status, 2026-08-24

| Step | State |
|---|---|
| **3A** monitoring mission contract | ✅ `monitoringMission.ts` — `mission_objective`, subject kinds, lead-only capability list, boundary check |
| **3B** monitoring subject store | ✅ `20260824140000_monitoring_subjects.sql`, applied |
| **3C** monitoring compiler | ✅ subjects → a `LeadMissionV1` with no quota and no persistence terminal |
| **3D** routing | ✅ graph's terminal branch omits `persistence` for a monitoring mission |
| **3E** cross-origin reuse pre-flight | ✅ `monitoringPreflight.ts` — keyed on the question, never the origin |
| **3F** independent collection | ⚠️ **built and deployed, gate not passed** — `run-monitoring-scan` runs end to end and reports honestly, but cannot yet produce a feed. Two blockers below. |
| **3G** read switch | ⛔ not started — depends on 3F |
| **3H** retire the Radar provider path | ⛔ not started — depends on 3G |

**Blocker 1 — Apify has no credit (external).** The provider returns HTTP 402,
so `company_identity_resolution` cannot run. The engine defers the company
rather than recording it unresolved — "no call, no verdict" — which is correct
and is what the live run showed.

**Blocker 2 — OpenAI has no credit (external).** `evaluateMission` is the
qualification authority; without it nothing qualifies and no event is written.
For an ICP subject `planDiscovery` is also blocked, though a named-subject
mission schedules no discovery capability and never asks.

Both block Lead sourcing today exactly as much as they block monitoring. Neither
needs code.

**Resolved — `known_company_resolution` is now a real shared capability.** It was
declared in the graph and skipped as `skipped_no_input`; every route into the
company pool ran through a discovery provider, so a mission naming its own
companies discovered nothing. The engine now seeds those companies into the
ORDINARY pool and stops — it buys nothing, decides no identity, and hands them
to the same `company_identity_resolution` every discovered company goes through.

Identity strictness is unchanged and is the point: a supplied bare NAME reaches
`ambiguous` and no further, so a `tracked_company` subject identified by a word
honestly produces nothing, while one identified by a domain or a LinkedIn URL
carries through. One path serves both callers — a Signals subject and a Lead
mission naming companies compile to the same `known_companies`, schedule the
same entry capability and produce the same pool entry.

A second collapse surfaced on the way: `freeHiringAssessment` returned
`hiring_not_verified` for a company carrying no openings, which is right for one
a provider answered about and wrong for one nobody had asked about. The paid job
check now also fires for a supplied row with no job evidence, and only for one.

#### What the live runs proved, and what remains

| Step | Live state |
|---|---|
| Scheduler invocation (no user JWT) | ✅ |
| Subject load, mission compile, boundary check | ✅ |
| `known_company_resolution` seeding | ✅ `added: 1, by_kind {domain: 1}` |
| Triage, budget, investigation slice | ✅ |
| Provider permission (`signals_monitor` on `source_with_apify`) | ✅ after the allow-list fix |
| Identity resolution | ⛔ Apify 402 — company deferred honestly |
| Qualification → `signal_events` | ⛔ OpenAI 402, never reached |
| No Lead rows, no cross-workspace effect | ✅ fixture holds 0/0/0; the real workspace unchanged at 32 leads / 8 events |

The deterministic half is proven in full: `monitoringEndToEnd.test.ts` carries a
tracked company through the real compiler, the real graph, the real
`runCapabilityPlan` and the real writer contract to a written `signal_event`
with `origin: scheduled_monitor`, `occurred_at: null` and
`occurred_at_basis: unknown`. What remains unproven is the two provider calls
themselves — not the path they sit in.

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

## 8. Recommended first phase

**Phase 0 — prove the Radar path persists a row.** It is hours, not days; it
is the only phase whose outcome can invalidate the others; and 0 rows after a
substantial build is precisely the class of problem that ships unnoticed.

Then **Phase 1** regardless of Phase 0's result: the credit leak exists whether
or not Radar persists, and it is now the only unmetered provider path in the
product.
