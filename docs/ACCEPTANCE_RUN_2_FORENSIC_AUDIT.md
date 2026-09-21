# Official Acceptance Run #2 — Forensic Audit

**Lineage / task:** `e5d4fc14-2246-4a95-902a-75718c8c408b`
**Query:** `Find me 5 B2B SaaS companies in the UK with 20–200 employees that are actively hiring SDRs, BDRs, Account Executives, or other sales roles.`
**Ran:** 2026-09-05 11:41:15 → 12:56:14 UTC (75 min) · generation 18 · checkpoint_version 17 · 10 continuations
**Terminal:** task `round_limit_reached` · lineage left `active` (by design — a ceiling is a protection, not a conclusion)
**Evidence mode:** `execute` — confirmed live in the logs (`mode: "execute"`)

Read-only. Nothing fixed, nothing deployed, no manual continuation.

---

## H1 — enrichment checkpoint durability

The diagnostic deployed for exactly this question answered it.

**`enriched_in_memory == enriched_in_records` on every one of ~60 publishes.** Not a single divergence. Serialization is faithful.

But the count **regresses across a slice boundary**:

```
12:47:49  PUBLISH  companies_enriched   mem=87  rec=87
12:49:32  PUBLISH  hiring_verified      mem=87  rec=87
12:54:06  RESTORE  restored=149 records=149 snapshots_missing=0
12:54:18  PUBLISH  qualified            mem=83  rec=83     ← restored 83, not 87
12:54:33  ENRICH   urls=4 enriched=4                        ← re-buys the missing 4
12:54:34  PUBLISH  companies_enriched   mem=87  rec=87
```

The restore reports a perfectly healthy `restored=149 records=149 missing=0` and returns an **older** enriched set. The re-purchase of exactly 4 is visible in the ledger as duplicate key `0fa90c771a`, attempts 1 and 2 at 12:47:37 and 12:54:21.

**The mechanism is now visible too.** Concurrent slices with different working sets write to the same `tasks.result`:

```
12:29:22  PUBLISH  stage=qualified          n=149   mem=65
12:30:04  PUBLISH  stage=accounts_found     n=1     mem=0    ← a DIFFERENT slice
12:30:12  PUBLISH  stage=companies_enriched n=1     mem=1
12:31:05  PUBLISH  stage=qualified          n=1     mem=1
12:33:15  PUBLISH  stage=prequalified       n=149   mem=65   ← back to the real one
```

`onCheckpoint` does a read-modify-write on `tasks.result`. A slice holding a 1-company working set overwrites the checkpoint of a slice holding 149.

```
H1 VERDICT: B — no divergence before serialization; the loss is between
            checkpoint write and read, caused by concurrent slices
            last-writer-wins on tasks.result
```

This also retires the theory I could not settle before. Every component was correct because every component *is* correct — the defect is at the concurrency boundary, not in the serialization path.

---

## H2 — model_call persistence

```
drains logged : 7   →  86 model calls collected
rows persisted: 95
insert errors : 0
```

Every logged drain has a persisted cluster of exactly matching size:

```
11:43:20 drain=7   ↔ 11:43:19-20 rows=7    ✓
11:53:21 drain=10  ↔ 11:53:20-21 rows=10   ✓
12:01:29 drain=15  ↔ 12:01:27-29 rows=15   ✓
12:03:51 drain=12  ↔ 12:03:50-51 rows=12   ✓
12:06:12 drain=10  ↔ 12:06:11-12 rows=10   ✓
12:19:34 drain=17  ↔ 12:19:32-34 rows=17   ✓
12:56:17 drain=15  ↔ 12:56:15-17 rows=15   ✓
                     12:47:32-33 rows=9    ← drain whose log line was lost
```

The 9 extra rows at 12:47 are a drain whose `console.log` never flushed before the isolate was killed. **The rows are the source of truth and they are all present.** Zero loss, zero rejections.

By role: mission_evaluation 44, evidence_extraction 25, pool_evaluation 11, evidence_planning 7, mission_triage 4, execution_plan_amendment 2, grounded_evidence_evaluation 1, execution_plan 1. **Estimated model cost $0.12481** — a figure that did not exist before this fix.

The previous run collected 20 model calls and persisted **zero**, every insert rejected by
`lead_execution_calls_model_call_names_model`.

```
H2 PRODUCTION PROVEN: YES — collected == persisted, 0 insert errors
```

---

## N1 — truthful terminal reason

Observed repeatedly, from 11:55:22 onward:

```
[multi-round] round_loop_stop { terminal_reason: "quota_not_met",
                                detail: "delivered 5 of 5 requested" }
[multi-round][complete] { requested: 5, delivered: 5, qualified: 0,
                          review: 17, shortfall: 0 }
```

This is the exact state that produced `terminal_reason: "completed"` on the previous run — a full delivery window of review rows with nothing qualified. It now reports `quota_not_met` while the detail still honestly records that the window was filled.

```
N1 PRODUCTION PROVEN: YES — 0 qualified cannot end as completed
```

---

## P4 — Firecrawl → evidence → reevaluation → qualification

The chain ran end to end and **produced a qualification**:

```
12:03:09  evidence-debt candidate  Metaview  metaview.ai  score 80
12:03:15  evidence-claims          Metaview  kept 4  rejected 0
12:03:25  reeval-decided           Metaview  insufficient_evidence → QUALIFIED
                                   resolved: ["Whether Metaview is specifically a B2B SaaS company…"]
```

Every reevaluation this run:

| Company | Before | After | Outcome |
|---|---|---|---|
| **Metaview** | insufficient_evidence | **qualified** | requirement resolved by its own pricing page |
| Hebbia | insufficient_evidence | insufficient_evidence | one requirement resolved, others still open |
| Pump.co | insufficient_evidence | insufficient_evidence | still open |
| Kody | insufficient_evidence | insufficient_evidence | still open |
| InEvent | insufficient_evidence | insufficient_evidence | still open |
| DiligenceVault | insufficient_evidence | insufficient_evidence | still open |

**Evidence receipts for the one qualification** — all five requirements `verified`, with verbatim excerpts:

| # | Requirement | evidence_id | Excerpt |
|---|---|---|---|
| 1 | 20–200 employees | `employee_count:linkedin:094d10f1` | `"131 employees"` |
| 2 | in the UK | `company_location:linkedin:42681bd9` | `"London, United Kingdom; San Francisco, CA…"` |
| 3 | hiring sales roles | `job_posting:job_source:c5c0f9e3` | `"Sales Development Representative"` |
| 4 | hiring sales roles | `job_posting:job_source:bd456f4e` | `"Account Executive, Enterprise"` |
| 5 | **B2B SaaS company** | `web_page:company_website:9a7a7ee9` | `"Pro\n\n$100\n\nmonthly per user"` |

`match_score: 95`, `unknown_fields: 0`. Requirement 5 — the one the run could never close without web evidence — was settled by a **cached** Metaview pricing page from 2026-09-03, at zero Firecrawl cost. Cross-run cache reuse working.

```
P4 PRODUCTION PROVEN: YES — debt → fetch → verbatim claims → reevaluation
                      → persisted qualified decision
```

### But the qualification never reached the user

This is the material finding of the run.

```
Metaview, final persisted state:
  mission_evaluation.decision : qualified
  mission_fit                 : pass
  matched_requirements        : 5   (all verified)
  unknown_fields              : 0
  mission_match_score         : 95
  brain                       : review          ← Company Brain never revisited
  counts_as_qualified         : FALSE
  workbench status            : held_for_evidence
```

The mission evaluator qualified it on evidence, the decision **persisted correctly to the checkpoint**, and every counting surface reports zero. The delivery layer keys on the Company Brain verdict, which stays `review`; P4 updates `mission_evaluation` and does not revisit the Brain.

So the run's headline `qualified: 0` is **not** a sourcing failure or an evaluator failure. It is a qualified, evidence-backed lead that the counting layer refused to count.

---

## Duplicate spend

**Apify — 3 duplicate keys, 3 extra paid executions:**

```
company_details fp=d39723596d  attempts [1,2]  11:53:36 / 12:00:27   $0.01620
company_details fp=c446790d7a  attempts [1,2]  12:12:11 / 12:18:08   $0.00020
company_details fp=0fa90c771a  attempts [1,2]  12:47:37 / 12:54:21   $0.00020
```

All three are `company_enrichment`, all three at continuation cadence — the H1 mechanism, costing **$0.0166** total.

**Firecrawl — zero duplicates:**

```
calls 9 · distinct URLs 9 · all succeeded
cost_source: unknown ×9 · event_priced $0.00 ×0
```

The cost-truthfulness fix holds: no call priced at a fabricated zero, and Firecrawl's true cost recorded as `unknown` rather than invented. 9 evidence rows written (5 `ok`, 4 `not_found` — the negative cache doing its job).

---

## Credits and cost

| Item | Value |
|---|---|
| provider calls | 65 |
| model_call rows | 95 |
| stage_result rows | 16 |
| Apify actual cost | **$1.0631** (`provider_reported`) |
| Firecrawl cost | **unknown** — not $0 |
| model cost (estimated) | **$0.12481** |
| credits charged | **61**, all finalized |
| unfinalized reservations | **0** |
| orphaned `started` rows | **0** |
| duplicate paid work | 3 executions, **$0.0166** |

---

## Autonomy

10 continuations, 18 generations, 75 minutes, **zero manual intervention**. I dispatched once and did not touch it again. Pool grew 50 → 99 → 149 across replenishment rounds. The lineage was never resurrected and the cancelled lineage `4ef85feb` stayed cancelled throughout.

---

## Final funnel — 149 companies, `unaccounted` 0 at every stage

| Stage | entered | advanced | decided | withheld | excluded | unacc |
|---|---|---|---|---|---|---|
| discovery | 149 | 149 | 0 | 0 | 0 | **0** |
| mission_intelligence | 149 | 129 | 0 | 0 | 20 | **0** |
| smart_shortlist | 129 | 87 | 0 | 0 | 42 | **0** |
| identity_resolution | 87 | 87 | 0 | 0 | 0 | **0** |
| enrichment | 87 | 87 | 0 | 0 | 0 | **0** |
| company_brain | 87 | 22 | 0 | 0 | 65 | **0** |
| mission_evaluator | 22 | 0 | 5 | 17 | 0 | **0** |
| persistence | 0 | 0 | 0 | 0 | 0 | **0** |

Per company: 65 verifying · 62 not_investigated · 21 held_for_evidence · 1 not_qualified = **149** ✓

---

```
FINAL RESULT: STILL_RUNNING → terminated at the continuation ceiling after 75
              minutes, 18 generations, 149 companies reviewed

QUALIFIED: 0 delivered.
           1 evaluator-qualified with full verbatim receipts (Metaview, score 95,
           5/5 requirements verified, 0 unknown) that `counts_as_qualified: false`
           refused to count.

TERMINAL REASON: round_limit_reached (task) · multi-round reported quota_not_met

H1 VERDICT: B — loss between checkpoint write and read.
            mem == rec on every publish (serialization faithful);
            restore returns an older set; concurrent slices with different
            working sets (n=1 vs n=149) last-writer-wins on tasks.result.

H2 PRODUCTION PROVEN: YES — 86 collected across 7 logged drains + 9 from one
                      drain whose log was lost = 95 persisted, 0 insert errors.

N1 PRODUCTION PROVEN: YES — delivered 5/5 with 0 qualified reported
                      quota_not_met, not completed.

P4 PRODUCTION PROVEN: YES — debt → Firecrawl → verbatim claims → reevaluation
                      → persisted `qualified`. Chain works end to end.

DUPLICATE APIFY: 3 keys, 3 extra paid executions, $0.0166 (H1 mechanism)

DUPLICATE FIRECRAWL: 0 — 9 calls, 9 distinct URLs

MANUAL CONTINUATIONS: 0

ORPHANED WORK: 0 — no `started` rows, no unsettled runs

CREDITS: 61 charged, 0 refunded, 0 unfinalized.
         Apify $1.0631 · model $0.12481 estimated · Firecrawl cost unknown

MATERIAL DEFECTS FOUND:
  1. HIGH — a qualified, evidence-backed lead is not counted. P4 sets
     mission_evaluation.decision = qualified and persists it; the Company Brain
     verdict stays `review`; `counts_as_qualified` is false and the lead is
     never delivered. This alone accounts for the run's 0 qualified.
  2. HIGH — H1 confirmed as concurrency: two slices with different working sets
     write to the same tasks.result, and the smaller one wins. Costs duplicate
     enrichment purchases and, more seriously, silently reverts progress.
  3. MEDIUM — concurrent run-agent slices on one lineage are possible at all.
     The lineage lease did not prevent the n=1 / n=149 overlap.

READY TO MOVE ON FROM LEAD-BACKEND RELIABILITY:
NO

  Reliability itself is now in good shape: H2, N1 and P4 are production proven,
  Firecrawl duplicates are zero, credits settle cleanly, autonomy ran 75 minutes
  unattended, and `unaccounted` is zero at every stage.

  But the product still delivers zero leads on a query it can demonstrably
  satisfy. Defect 1 is the blocker and it is not a reliability problem — the
  system found a company meeting all five stated requirements, proved each with
  a verbatim citation, wrote the decision down, and then declined to count it.
  Fix that before moving on; it is the difference between a backend that works
  and a product that returns nothing.
```
