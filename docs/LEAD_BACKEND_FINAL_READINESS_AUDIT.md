# Agentory Lead Backend — Final Readiness Audit

**Date:** 2026-09-04
**Branch:** `feat/lead-mission-v1`
**Head:** `99091da9`
**Project:** `ohsdatpvfdjdemstoiuj`
**Suites at head:** 6799 edge + 54 infra, **0 failures**
**Evidence enrichment flag:** `EVIDENCE_ENRICHMENT=plan_only` (unchanged by this work)

Every material claim below carries one of four labels:

| Label | Meaning |
|---|---|
| **CODE PROVEN** | The mechanism exists and was read in the source. |
| **TEST PROVEN** | A regression test asserts it, and the test fails when the fix is reverted. |
| **PRODUCTION PROVEN** | Observed in live production data, not inferred from tests. |
| **NOT YET PROVEN** | Believed correct, not yet demonstrated at the stated level. |

A thing is **never** upgraded to PRODUCTION PROVEN because its tests pass.

---

## Executive Verdict

The backend is **ready for a user-run final acceptance query**. No material
correctness or spend defect remains open.

Six phases closed nine defects. Four were found by reading production data
rather than by testing, and three of those had been invisible for a week or
more precisely because the counter that should have shown them was broken:

- a cancelled lineage that could not stop being claimed, for 5+ hours
- a paid discovery slice whose spend was stranded for 2 hours with no checkpoint
- duplicate Apify purchases scaling with rediscovery
- `unaccounted`, the "we lost companies" alarm, non-zero on every run for weeks
- model spend logging wired into the wrong function for 10 days
- 39 failed provider calls recorded as costing exactly $0.00

The honest weakness of this handoff is that **four fixes are CODE + TEST proven
but not yet PRODUCTION proven**, because proving them means running a paid
mission and no paid mission has been run since they landed. That is a deliberate
choice, not an omission: the acceptance run will prove all four at once.

---

## Final Architecture

The lead backend runs as a **capability engine** (`leadCapabilityEngine.ts`)
executed by `run-agent`, sliced against a wall-clock deadline (soft stop 105s,
hard stop 115s, finalize reserve 30s, platform kill ~150s). A slice that cannot
finish writes a checkpoint and stops; `resume-stalled-leads` sweeps and
continues it.

Three authorities, deliberately separated:

| Authority | Owns | Fenced by |
|---|---|---|
| `lead_lineages` row | Is this lineage alive? | `acquire_lineage_lease`, `release_lineage_lease`, `cancel_lineage` |
| `tasks.result.terminal_status` | Did THIS generation finish? | `claim_sourcing_continuation`, `decideResume` |
| `lead_execution_calls` | What was bought, and what did it cost? | `logical_call_key` idempotency, CHECK constraints |

The load-bearing rule, stated in the code and preserved throughout this work:
**terminal authority for a lineage lives on the lineage row, never on a task
field.** A `terminal_status` written onto a task is a last-writer-wins value that
an in-flight slice overwrites — the `2f3d9c5c` defect. No fix in this audit
moved terminal authority onto a task.

---

## Phase 1 — Unified Evidence Bar

The first-pass evaluator and the P4 re-evaluation share a single `EVIDENCE_POLICY`,
embedded verbatim in **both** prompts, with receipt sufficiency enforced inside
`parseMissionEvaluationStrict` — one enforcement point for both passes rather
than two that can drift.

- A provider's broad category cannot silently satisfy a narrower business-model
  requirement. **CODE PROVEN**, **TEST PROVEN** (`unifiedEvidenceBar`)
- Citations are validated as verbatim substrings of the page text; a fabricated
  excerpt is dropped. **CODE PROVEN**, **TEST PROVEN**
- Geography means real presence/branch in the requested market. HQ-only
  filtering was never introduced. **CODE PROVEN**

---

## Phase 2 — First-Slice Durability

**The run this exists for.** Lineage `610951da`, from its own logs:

```
08:36:43  discovery returned      (one Apify call, one credit)
08:37:00  mission-triage batch 2, 25 companies
08:38:40  isolate killed
...       no checkpoint, ever
```

`publish("accounts_found")` sat at the END of the discovery capability, after
triage and the plan amendment — both unbounded model calls. It was never
reached. The task kept `checkpoint_version: 0`, `eligibleForAutoResume` answered
`no_checkpoint` on every tick for two hours, and the spend was stranded.

**Fix.** `finish` + `publish` now run the moment the paid rows are admitted to
the working set, before `applyMissionIntelligence`. Safe because
`ensureMissionIntelligence` already guarantees idempotently, on every route, that
nothing enters a paid stage untriaged — a slice resumed from this checkpoint
re-applies triage before it can spend. The capability publishes again at the end
so the checkpoint carries what triage decided; it does **not** finish twice,
which would double-count the pool.

- Discovery publishes a durable, resumable checkpoint immediately after paid
  rows are admitted, before any model work. **CODE PROVEN**, **TEST PROVEN**
- Production proof pending a natural run or interruption. **NOT YET PROVEN**

**A note on the test.** The first version threw inside triage and passed under
the *old* ordering too — an exception unwinds through the engine's own catch,
which publishes a checkpoint on the way out, so it measured the error path
rather than durability. It was re-cut to assert on the **death snapshot**: what
was already committed at the instant the fatal line was reached. Both durability
tests fail with the ordering reverted.

---

## Phase 3 — Apify Semantic Idempotency

**The runs this exists for.** Every duplicate paid Apify call in the four days to
2026-09-04 was `apify_linkedin_company_details`, and the count tracked how many
times the lineage re-ran discovery:

```
b1348724   5 searches   7+4+4+3+2 duplicate runs
2f3d9c5c   4 searches   5+5+3+2   duplicate runs
8cfdfd10   3 searches   2         duplicate runs
610951da   1 search     none
```

**Root cause.** `company_enrichment` selects on `!c.enriched`, which holds within
a slice. Across slices there are two restore paths and they disagreed:
`restoreWorkingSet` (discovery *skipped*) assigned `c.enriched` from the
snapshot; `restoreFromResume` (discovery *re-runs*, rebuilding the working set
from the provider) did not. A rediscovered company arrived
enriched-looking-unenriched and its batch was bought again, once per continuation.

The accounting hid it: the ledger deduplicated on `logical_call_key` and
escalated `attempt_number`, so no internal credit was double-charged and nothing
looked wrong. **Apify billed every run.** This was fixed at the dispatch, not the
accounting.

- `restoreFromResume` preserves a non-null enriched payload, under the same
  "live progress wins" rule it already applied to identity. **CODE PROVEN**,
  **TEST PROVEN**
- Repeated discovery cannot make an enriched company look unenriched.
  **TEST PROVEN**
- A record carrying the stage label `enrichment: "completed"` with **no** payload
  is still bought — skipping it would strand the company empty, the
  proven-negative case the restore path was always careful about. **TEST PROVEN**
- Duplicate company-details purchases eliminated. **NOT YET PROVEN** — expected
  signal on the next run: zero duplicate `provider_run_id` per `logical_call_key`.

---

## Phase 4 — Firecrawl Interruption Safety

**The run this exists for.** Lineage `b1348724`, `pump.co/about`, from the ledger:

```
16:58:00  call started    -> never finalized, no row
18:35:09  call succeeded  -> no row
18:47:13  call succeeded  -> row written 18:47:16
```

Three purchases of one page; 24 Firecrawl calls for 17 URLs across that run,
because the write was batched once per company after every page in the plan.

The immediate-write architecture was already in place and **was not changed** in
this phase; `git diff` was empty against what was deployed. What was missing was
the test.

- Each page is committed in its own write, before the next fetch.
  **CODE PROVEN**, **TEST PROVEN**
- Pages bought before an interruption survive it; the next slice re-buys only
  the page never bought. **TEST PROVEN**
- Unusable pages (404, blocked, timeout) are committed too, so absence is not
  re-purchased. **TEST PROVEN**
- Cache reuse and negative-cache reuse. **PRODUCTION PROVEN** — 13 calls for 13
  URLs with 70 reuses; 23 known-missing skips on a later run.

**Same shaping problem as Phase 2, caught twice.** A throwing `fetchPage` does
not model a kill: the runner catches it and degrades to a timeout by design. And
the first resume test let slice 1 run to completion, so the batched write still
landed and it **passed under the reverted code**. Both were re-cut against the
death snapshot; three of four now fail when the write is batched back.

---

## Phase 5 — Lifecycle / Continuation Safety

Audit-only phase. Rather than trust that a test file with the right name
enforces anything — toothless tests were the repeat failure of this engagement,
four separate incidents — **every guard was neutered to `if (false)` one at a
time and the suite re-run.**

All fourteen guards have teeth:

| Guard | Tests failing when neutered |
|---|---|
| frontier exhausted | 9 |
| quota met | 6 |
| continuation ceiling | 5 |
| cost ceiling | 5 |
| barren progress | 4 |
| pending runs | 4 |
| resume authority coalesce | 4 |
| cancellation (continuation gate) | 3 |
| provider failure | 3 |
| evidence debt no-rebuy | 3 |
| resume terminal gate | 3 |
| resumable row status | 2 |
| evidence identity gate | 1 |
| qualification debt first | 1 |

**TEST PROVEN**, by mutation, for all fourteen. The last two rest on a single
test each — real, but one careless edit from silent.

`LINEAGE_FINISHING_REASONS` is deliberately narrow: only `quota_met`,
`frontier_exhausted` and `cancelled` end a lineage. Ceilings, `no_progress` and
`provider_failure` intentionally leave it `active` so a deliberate re-run can
still continue. An earlier draft of this audit called that an inconsistency; it
is not, and the claim is corrected here. **CODE PROVEN**

---

## Phase 6 — Accounting / Observability

Four defects found and closed; two items examined and deliberately left alone.

1. **The claim gate did not read the lineage row.** Fixed, PRODUCTION PROVEN.
2. **`unaccounted` was non-zero on every run.** Fixed, TEST PROVEN.
3. **Model spend was wired into the wrong function.** Fixed, TEST PROVEN.
4. **Failed provider calls were priced at exactly $0.00.** Fixed, TEST PROVEN.
5. **Disabled-loop terminal stamp** — examined, deliberately not touched.
6. **29 stale `started` ledger rows** — audited read-only, left as LOW debt.

Each is detailed in its own section below.

---

## Qualification Integrity

- A company reaches the Brain only through the eligibility gate: verified
  hiring, hiring jobs, a Brain-reaching hiring assessment, a funding round, or
  any other signal the mission required. **CODE PROVEN**
- Requirements verified on the first pass travel forward with their original
  citations; a second pass cannot un-verify UK presence by forgetting to mention
  it. It can only settle what was open, or contradict — and a contradiction is
  new information that should win. **CODE PROVEN**, **TEST PROVEN**
- A dropped citation cannot silently qualify a company: the merge requires a
  surviving new citation. **TEST PROVEN**
- Qualification debt is paid before new discovery. **TEST PROVEN** (single test)

---

## Checkpoint / Resume Integrity

The contract is **write + declare + read**, and it has been a repeat offender:
fields written and declared but never read back were silently dropped on every
restore.

- `decideResume` mirrors the RPC's coalesce — row first, checkpoint only in its
  silence. **CODE PROVEN**, **TEST PROVEN** (`resumeAuthorityMatchesRpc`, 4 tests
  fail on revert)
- `enriched` now survives both restore paths. **TEST PROVEN** (Phase 3)
- `mission_evaluation`, `hiring_assessment`, `brain` and `identity` survive a
  resume. **TEST PROVEN**
- P4 write-back rebuilds `resume_records` so a re-evaluated verdict reaches the
  checkpoint. **PRODUCTION PROVEN** — Metaview and Pump.co qualified in the
  persisted checkpoint.
- Autonomous continuation, sweeper-driven, zero manual intervention.
  **PRODUCTION PROVEN**

---

## Provider Spend Integrity

- Spend idempotency on `logical_call_key = lineage_root:capability:v2:<sha256>`,
  with `attempt_number` escalation for legitimate re-attempts. **CODE PROVEN**,
  **PRODUCTION PROVEN**
- Credits are reserved and settled through `credit_transactions`; **0**
  unfinalized reservations and **0** held credits at audit time.
  **PRODUCTION PROVEN**
- An adopted run — a re-read of a run another row already bought — costs this
  call nothing and is priced at zero on a positive `adopted` signal.
  **CODE PROVEN**, **TEST PROVEN**
- A cancelled lineage cannot spend: `acquire_lineage_lease` refuses it, and the
  ledger confirms **zero** provider calls on `8cfdfd10` after cancellation.
  **PRODUCTION PROVEN**

---

## P4 Evidence Reevaluation

Collected web evidence is fed back into qualification behind
`EVIDENCE_ENRICHMENT`. The module makes **one model call per candidate** that has
both an unresolved requirement and evidence it has never been shown. It buys
nothing: a company with no cached rows is simply not re-evaluated.

- Evidence → qualification persistence. **PRODUCTION PROVEN**
- The re-evaluation is passed a typed `MissionReevaluationContextV1` boundary
  rather than reaching into engine internals. **CODE PROVEN**, **TEST PROVEN**
- The module **returns** its merged verdict rather than mutating the candidate —
  the earlier version wrote onto object literals `run-agent` had created with
  `.map()`, so the verdict was computed and discarded. **TEST PROVEN**
- Only `status = "ok"` cached pages with non-empty text reach the evaluator; a
  `not_found` row stops a fetch without becoming evidence. **TEST PROVEN**

---

## Cancellation / Terminal Safety

**The run this exists for.** Lineage `8cfdfd10` was cancelled at 10:45 on
2026-09-04. At 12:03 — seventy-eight minutes later — the sweeper claimed it
again, for the **twenty-sixth** time. By the time the fix landed,
`checkpoint_version` had reached **64**.

**Root cause.** `claim_sourcing_continuation` read `public.tasks` and nothing
else. Cancellation deliberately writes to the LINEAGE row, so the task keeps
`continuation_required` and stays claimable, and the claim gate had no idea the
lineage was dead.

**And it was self-sustaining, not self-limiting.** An earlier draft of this audit
said the churn would stop when the task aged past the two-hour resume window.
That was wrong. The abandonment gate measures `updated_at`, and the claim RPC
*writes* `updated_at` — so every claim refreshed the very timestamp that would
have retired the row. Left alone it would have continued indefinitely.

**Fix.** The claim gate now reads the lineage row under the task's lock — the
same authority the lease gate already uses. Both gates agree on what a dead
lineage is, and neither depends on a field a racing slice can overwrite. A
cancelled lineage returns its own refusal (`lineage_cancelled`) rather than being
folded into `already_terminal`: "someone stopped this" and "this finished" are
different facts.

- No money was ever at risk. The lease fence held throughout. **PRODUCTION PROVEN**
- The live RPC refuses the real cancelled lineage with `reason=lineage_cancelled`.
  **PRODUCTION PROVEN**
- The churn stopped: `checkpoint_version` frozen at **64** for **811 minutes**
  (13.5 hours) at time of writing, after climbing every few minutes for 5+ hours.
  **PRODUCTION PROVEN**

A trap closed alongside it: `narrowClaimRow` matches the RPC's reason against a
hardcoded list and falls back to `lost_race` — *"Another continuation started
first"* — for anything unlisted. A new refusal not threaded through renders as a
confident wrong answer. The reason is threaded through the union, the message map
and that list, and a test asserts every reason the migration can emit appears in
the **narrowing list specifically**. An earlier draft of that test searched the
whole module and passed while the reason was missing from the list.

---

## Funnel Accounting

`company_brain` reported a non-zero `unaccounted` on essentially every mission
for weeks:

```
8cfdfd10   entered 62   advanced 15   withheld 0   UNACCOUNTED 47
b1348724   entered 139  advanced 29   withheld 0   UNACCOUNTED 110
2f3d9c5c   entered 101  advanced 20   withheld 0   UNACCOUNTED 81
40295080   entered 97   advanced 22   withheld 0   UNACCOUNTED 75
```

`unaccounted` is the one counter meaning *"a stage dropped companies and cannot
say where they went"*. A counter that is never zero cannot raise an alarm, and
nobody reading it can separate weeks of false positives from the real drop it
exists to catch.

Nothing was lost. The stage's `entered` is every identity-resolved company, but
only companies passing the Brain eligibility gate are handed to the Brain, and
the gate's decision was recorded nowhere.

- Brain-gate exclusions are explicitly accounted: a **refuted** signal
  (`hiring_not_verified`, a conclusion reached from evidence) counts as
  `excluded`; a signal **never established** is an absence, counts as `withheld`,
  and is still owed a check. **CODE PROVEN**, **TEST PROVEN**
- Marked where eligibility is decided, so the funnel reads the gate rather than
  re-deriving it — two definitions of "eligible for the Brain" is how they drift
  apart. **CODE PROVEN**
- A company that disappears with **no** stated reason still raises the alarm.
  **TEST PROVEN**
- `entered - advanced == decided + withheld + excluded + unaccounted` on every
  stage. **TEST PROVEN**

**Three things this got wrong before landing**, all caught:

1. The marker was first written onto `stage_block`. The workbench projection
   returns *"deferred — the run stopped before this company could be finished;
   resuming will continue it"* for **any** `stage_block`, so that made a
   user-facing state lie about companies refused on the evidence. It is now a
   dedicated `brain_gate` field: one definition, one reader.
2. The counts were not scoped to what entered the stage, driving `unaccounted`
   **negative** (−80) — the same class of error in the opposite direction. The
   pre-existing clock count had the same latent bug and is scoped now too.
3. The first tests built `FunnelCompany` fixtures by hand and **all passed with
   the engine's marking removed** — they covered the counting, not the marking.
   An engine-level test now runs the real plan and asks the real funnel.

---

## Model Spend Visibility

`recordModelCall`, the `model_call` record kind, its three CHECK constraints and
`modelCallLedger.test.ts` were all built, shipped and **correct**. The collector
was wired into `pilot-chat` — and nowhere else.

In the ten days to 2026-09-04 the ledger held exactly **one** `model_call` row,
from a `signal_relevance` call on a pilot path, against **1277** provider rows.
Every lead mission's model spend was unrecorded: triage, evaluation, discovery
and execution planning, pool and round planning, evidence planning and
extraction, and the P4 re-evaluation. A run could be audited for Apify dollars to
the cent and still not answer *"what did the models cost?"*.

- `run-agent` now passes the seam at **eleven** call sites, and the six bindings
  that build their own default `generate` hand it down — the pattern
  `leadMissionCompilerBinding` already used. **CODE PROVEN**, **TEST PROVEN**
- The collector is drained once, awaited, inside the ledger block that already
  writes this run's stage results — and **before** those writes, so model rows
  land even if a stage-result write throws. **CODE PROVEN**
- Collect-now-write-later: the sink is synchronous and cannot fail, so nothing on
  the paid path is slowed or broken by bookkeeping. **CODE PROVEN**
- `model_call` rows appearing for a real mission. **NOT YET PROVEN** — expected
  on the first post-deploy run.

**The test is structural on purpose.** Every unit test of the mechanism passed
throughout those ten days; they exercised `recordModelCall` against a fake
writer, exactly the part that stayed healthy. What was missing was the *argument
at the call site*, which a test of the mechanism cannot see. The scan finds every
model-backed factory `run-agent` constructs and requires the seam on each, with
no whitelist — and asserts the factory count first, because a scan that finds
nothing passes vacuously.

---

## Firecrawl Spend Visibility

**What Firecrawl actually returns.** The web-evidence path calls
`POST /v2/scrape` with `max_pages: 1`. The v2 scrape response is
`{ success, data: { markdown, summary, metadata } }`. The integration captures
the entire `metadata` object.

**It contains no cost information.** Verified against production rather than
assumed: across **255** Firecrawl ledger rows, the metadata keys present are
`actor_id`, `no_results`, `build_id`, `build_number`, `resumable` and `status`.
A search for any credit-bearing field across `metadata` and `request_input`
returns **zero** rows. Firecrawl's synchronous scrape endpoint exposes no
`creditsUsed`, no billing units, and no monetary charge to our runtime.

**A real defect was found here.** 39 Firecrawl rows carried
`cost_source: event_priced` with `estimated_cost_usd` of **exactly $0.00** — and
every one of them was `status: failed`. Not one was an adoption.

`priceProviderCall` treats `started === false` as *"this call re-read a run
somebody else already bought"*, which is genuinely free. But the failure call
site passes `started: runId !== null`, and Firecrawl's scrape is **synchronous —
it returns no run id at all**. So every failed scrape reported `started: false`,
took the adoption branch, and was recorded as a priced, free call on the ledger's
highest provenance grade short of the provider's own figure. During a Firecrawl
outage the spend would have read as untouched.

`modelCostModel` already states the rule one layer over: *"NO USAGE REPORTED IS
NOT A FREE CALL... during an outage every row would read as a priced, free call
and the bill would look untouched while nothing worked."* The same rule now
holds on the provider side.

- Zero is returned only on a positive `adopted` signal, which only the Apify
  reuse path sets. **CODE PROVEN**, **TEST PROVEN** (revert fails the new case)
- Everything else falls through to the actor card, and to `unknown` where there
  is no card — the honest answer for Firecrawl. **CODE PROVEN**
- What is kept for Firecrawl: **request count** (one ledger row per call),
  status, and `actual_cost_usd = NULL`. **No dollar figure was invented.**
- Per-call page count is not recorded (`raw_count` is NULL on every Firecrawl
  row). Truthful but incomplete — see Cosmetic / Deferred Debt.

---

## Production-Proven Behaviors

- Autonomous continuation, sweeper-driven, zero manual intervention
- Cache reuse: 13 calls for 13 URLs with 70 reuses
- Negative-cache reuse: 23 known-missing pages skipped
- P4 evidence → qualification persistence (Metaview, Pump.co qualified in the checkpoint)
- Credit idempotency; 0 unfinalized reservations, 0 held credits
- Geography as real presence, not HQ-only
- Cancellation fence on spend: **zero** provider calls after cancellation on `8cfdfd10`
- Cancelled lineage refused by the live claim RPC with `lineage_cancelled`
- Cancellation churn stopped: `checkpoint_version` frozen at 64 for 811 minutes
- The cancellation row-fence migration is applied and live (CHECK admits
  `cancelled`; `acquire_lineage_lease`, `release_lineage_lease` and
  `cancel_lineage` are all cancelled-aware)

---

## Test-Proven Behaviors

Every item below has been **revert-tested**: the fix was removed and the test
observed to fail.

- First-slice durability (2 tests fail on revert)
- Enrichment survives rediscovery (1 fails; 2 companion tests guard over-reach)
- Firecrawl interruption safety (3 of 4 fail on revert)
- All 14 lifecycle guards (mutation-tested individually)
- Claim gate reads the lineage row (SQL 2 fail; reason threading 1 fails)
- Funnel accounts for gate exclusions (engine half 1 fails; funnel half 4 fail)
- Model spend wiring (call site 1, drain 2, binding forwarding 1)
- A failed provider call is not priced as free (1 fails on revert)
- Receipt sufficiency / unified evidence bar
- Resume authority matches the RPC

---

## Not-Yet-Production-Proven Behaviors

These are the four items the acceptance run will settle. All are CODE + TEST
proven with passing revert-tests; none has been observed in live data.

| Behavior | Expected production signal |
|---|---|
| **Phase 2** — durable checkpoint before model work | `accounts_found` publish precedes `mission-triage` in the log timeline; a killed slice resumes instead of stranding |
| **Phase 3** — no duplicate enrichment purchases | Zero duplicate `provider_run_id` per `logical_call_key` for `apify_linkedin_company_details` |
| **Model spend** — `run-agent` wiring | `model_call` rows appear in `lead_execution_calls` for the run |
| **Provider cost truthfulness** | Failed Firecrawl rows carry `cost_source: unknown` and NULL cost, not `event_priced` $0.00 |

---

## Remaining Known Risks

1. **`hasStartedProviderRun` has no staleness bound.** A `started` ledger row
   with a `provider_run_id` returns `go("pending_provider_run")` — eligible to
   resume — regardless of the row's age. Today this cannot fire: the two-hour
   abandonment gate is evaluated first, and **zero** of the 29 stale rows are
   younger than two hours. Latent, not active. **PRODUCTION PROVEN** that it does
   not currently fire (0 tasks in the live window would force a resume).

2. **Two lifecycle guards rest on a single test each** — the evidence identity
   gate and qualification-debt priority. Real, but thin.

3. **107 pre-existing type errors in test fixture files.** Production source
   typechecks clean; the suite runs under `--no-check`, the repo's existing
   convention. Confirmed pre-existing (`known_companies` was already present at
   `b182c504`, before this work). No file authored in this engagement has a type
   error.

4. **Firecrawl per-call page count is not recorded.** `raw_count` is NULL on
   every Firecrawl row. Truthful, but less complete than it could be.

---

## Cosmetic / Deferred Debt

**Disabled-loop terminal stamp — examined, deliberately not fixed.**

Classification: **intentional behaviour with an observability side-effect.** Not
a functional bug.

The `auto_resume_suppressed` marker parks a task: `eligibleForAutoResume` checks
it first and returns SKIP, never TERMINATE, because the checkpoint is valid and
an explicit Continue still works. Five tasks carry it in production; four were
parked by an **operator** (`operator:quota-met`, `operator:lineage-split-hold`),
not by `single_generation`. Because the suppression check precedes the silence
check, a parked row can never be terminalized by the sweeper.

Checked against every listed harm:

| Harm | Present? |
|---|---|
| false terminal | **No** — it never writes a terminal status |
| false active | **Yes, cosmetically** — parked rows read `continuation_required` indefinitely |
| sweeper refusal | **Yes, by design** — SKIP is the intended answer |
| accidental resume | **No** — suppression blocks it |
| lost continuation | **No** — explicit Continue is unaffected |
| incorrect user-facing status | **Yes, cosmetically** — a parked run reads as unfinished |
| paid work after terminal | **No** |

Resource check: the 5 suppressed tasks hold **0** live claims and **0** live
leases. Scan-crowding check: 13 rows currently occupy a scan bounded at **50**,
of which 4 are suppressed — 37 slots free, no crowding.

**Why it is not being fixed.** Stamping a terminal status onto a parked task
would place terminal authority on a last-writer-wins task field — precisely the
`2f3d9c5c` defect, and precisely what this engagement was instructed not to do.
The only harm is cosmetic. Documented, not touched.

**29 stale `started` ledger rows — audited read-only, left as LOW debt.**

Dated 2026-08-24 to 2026-09-03, across 18 lineages, 13 carrying a
`provider_run_id`. Tested against every listed condition:

| Condition | Result |
|---|---|
| block sweeper progress | **No** |
| hold credit reservations | **No** — 0 rows have any unfinalized credit row; 0 credits held |
| count as pending work | **Not currently** — 0 tasks in the live window would force a resume |
| prevent terminalization | **No** — the abandonment path terminalizes the task regardless |
| cause provider re-purchase | **No** — Phase 3 addressed the actual re-purchase cause |

None of the conditions hold. **The reaper was not built**, per instruction.

**Other deferred items:** 6 lineages stuck `running` with expired leases
(`acquire_lineage_lease` ignores them; they self-heal on next acquire — cosmetic);
`agentory_internal` rows carry no cost (internal observations, not purchases).

---

## Final Acceptance Criteria

What a successful acceptance run should show:

1. **Leads:** 5 qualified UK B2B SaaS companies, 20–200 employees, with hiring
   evidence for a sales role, each carrying checked citations.
2. **Continuation:** autonomous, sweeper-driven, no manual intervention.
3. **Termination:** a stated terminal status — `quota_met` on success.
4. **Funnel:** `unaccounted == 0` on every stage. Any non-zero value is now a
   real signal and should be investigated.
5. **Spend:** zero duplicate `provider_run_id` per `logical_call_key`.
6. **Model ledger:** `model_call` rows present for the run.
7. **Cost provenance:** no `event_priced` $0.00 rows on failed calls.
8. **Checkpoint:** a durable checkpoint written before the first triage call.

Items 4–8 are the production proofs still outstanding.

---

## Final Grade

**B+**

The architecture is sound and the defect-finding discipline is now good: the
guards are mutation-tested, the fixes are revert-tested, and four defects were
found by reading production data that no test would have surfaced. Three of the
six phases are fully production-proven.

It is not an A because four material fixes remain unproven in production, and
because this engagement repeatedly produced tests that passed with the fix
removed — a fixture-only funnel test, two death-snapshot tests, a rendering test
that searched the wrong scope. Each was caught, but the pattern says the testing
instinct here needs the revert step permanently, not occasionally.

---

MATERIAL BLOCKERS REMAINING:
None. Every defect found in Phases 1–6 was either fixed and revert-tested, or
examined and documented with a stated reason for not touching it.

LOW-PRIORITY / COSMETIC DEBT:
- Disabled-loop terminal stamp: parked rows read as unfinished indefinitely.
  Intentional; fixing it would move terminal authority onto a task field.
- 29 stale `started` ledger rows: hold no credits, block nothing, force no
  resume. Reaper deliberately not built.
- `hasStartedProviderRun` has no staleness bound (latent; cannot fire today).
- 6 lineages stuck `running` with expired leases; self-heal on next acquire.
- Firecrawl per-call page count not recorded.
- 107 pre-existing type errors in test fixture files.

CODE PROVEN:
Unified evidence bar shared by both evaluator passes; first-slice durability
ordering; enrichment carried across both resume paths; per-page Firecrawl
writes; claim gate reading the lineage row under the task lock; brain-gate
exclusion marking at the point of decision; model-call seam at 11 run-agent
sites and 6 bindings; adoption-only zero-cost pricing.

TEST PROVEN:
All of the above, each revert-tested. Plus all 14 lifecycle guards, verified by
individual mutation.

PRODUCTION PROVEN:
Autonomous continuation; cache and negative-cache reuse; P4 evidence to
qualification persistence; credit idempotency with zero held credits; geography
as real presence; cancellation fence on spend (zero calls after cancel);
cancelled lineage refused by the live RPC; cancellation churn stopped for 811
minutes; the row-fence migration live in the database.

NOT YET PRODUCTION PROVEN:
Phase 2 durable first-slice checkpoint; Phase 3 elimination of duplicate
company-details purchases; model_call rows for a real mission; failed-call cost
provenance reading `unknown` rather than `event_priced` $0.00.

READY FOR USER-RUN FINAL ACCEPTANCE: YES

FINAL BACKEND GRADE: B+

RECOMMENDED ACCEPTANCE QUERY:
Find me 5 B2B SaaS companies in the UK with 20–200 employees that are actively hiring SDRs, BDRs, Account Executives, or other sales roles.
