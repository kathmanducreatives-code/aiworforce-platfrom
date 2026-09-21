# Q1 — v88 Complete Find Leads Positive Path (TEST) — Audit

**Verdict: PASS — COMPLETE POSITIVE FIND LEADS PATH** (one documented non-safety caveat: the
generic `signals` table gained 1 `people_profile` lead-persistence row — the Phase A timing
SignalEvents stayed in memory).

Date: 2026-07-17 · Project: TEST `zbwsbnqqpkvdhqwavjke` · Production `wqnigjhcwjxtmordrwno` **never accessed**.

## Release identity

| Item | Value |
|---|---|
| PR | #55 (MERGED 2026-07-17T16:42:55Z) — "Reconcile Find Leads enrichment staging after timing" |
| Merge commit / merged main | `0fa4d1f75c4c9413a9373a9bc6734086ad4d13bf` |
| PR head | `fd745eb4` — contained in main: **yes** |
| run-agent | v87 → **v88** (ACTIVE) |
| orchestrate | **v31** (unchanged; all other functions unchanged) |

Merged main verified to contain `stillStagedByEnrichmentAfterTiming`, both reducer call sites using
the reconciliation helper, `finalCandidateState.ts` unchanged. Provider-free validation: focused
**205/205**, full **1481 pass / 1 known pre-existing** URL-shortener failure, Deno run-agent 4 /
toolRegistry 1 (baseline), tsc pass, build pass, no drift.

## Boot checks (v88)

401 unauthenticated · 400 `missing_required_fields` · zero DB change · Brain fingerprint unchanged.

## Pre-Q1 baseline (locked, post-boot-check)

lead_candidates 426 · contacts 165 · signals 426 · accounts 149 · drafts 64 · approvals 25 ·
task_plans 186 · tasks 358 · tool_calls 346 · Penn 24 · queued 0 · sent 3 · outreach activities 4 ·
activity_feed 1715. Company Brain `030f4f36-171d-4c27-85e1-1c791f05e391` · fp `0d65a1c211458d80d2d488fe5ea14ec6`.

## Submission (exactly one)

- `Find B2B SaaS founders currently hiring for RevOps — who should I contact this week?`
- workspace `00000000-0000-0000-0000-000000000001`, tool_input `{execution_mode: source_and_qualify_only, max_results: 5}`
- HTTP **200** · plan **`783dd33d-1dfd-4628-b7b2-ebbdfd3a3f80`** · planner `ai` · agents `[scout, aria, scout, scribe]`
- Scout task **`84614655-3c87-49f8-9f1c-1ef0b2ace057`** · Aria task **`f4ee1ee1-1469-4146-8e1e-82efe5bbf7b6`**
- **Plan reached `complete`** — the first run ever to complete the full scout → aria → scribe flow
  (every prior run terminated `failed — no qualified matches`).

## Bounded execution — healthy, no 504

| Stage | Detail |
|---|---|
| People | `apify_people_search` — **27.8s**, 1 call |
| Company | `apify_linkedin_company_details` — 5 calls, **max concurrency 3**, 4 enriched / 1 no_result |
| Jobs | `apify_jobs` / `curious_coder/linkedin-jobs-scraper` — 4 calls, **max concurrency 3**, 1 enriched / 3 timed_out |
| Scout runtime | **135.5s** (at the budget ceiling; Aria still ran after ⇒ finalization protected) · **no 504** |
| Actors | exactly the 3 approved canonical actors. **research_web 0 · Firecrawl 0 · Perplexity 0** |

The jobs stage recorded one tool_call at 58.7s: a LATE completion the orchestrator had already
classified `timeout` at its 30s per-company bound (signal obs `companies_timed_out: 3`). The 30s
enforcement held; the row is the abandoned late-return telemetry, not a timeout violation.

## Timing signals (signal enrichment observability — reconciles)

```
companies_deduplicated 5 · planned 4 · called 4 = enriched 1 + no_result 0 + failed 3 (timed_out 3 ⊆ failed)
raw_job_records 9 · normalized_job_events 9 · verified_signal_events 9 · deduplicated 9
signals_fresh 6 · signals_weak_supporting 0 · signals_stale 3 · closed_or_expired_listings 0
candidates_considered 5 · candidates_requalified 1
candidates_timing_sufficient 1 · candidates_missing_timing_evidence 4 · candidates_timing_contradicted 0
budget 4/5 · stop_reason "completed" · reconciles true
```

occurred_at is source posting time; no closed/expired listings satisfied timing; SignalEvents carry no
raw payload / PII. **0 `hiring_signal` rows persisted — the 9 verified timing SignalEvents stayed in memory.**

## Company enrichment (reconciles)

planned 5 = called 5 + cached 0 + skipped 0 · called 5 = enriched 4 + no_result 1 + failed 0 · reconciles true.

## THE POSITIVE PATH — stale-stage reconciliation proven live

| Company | decision | reason_code | evidence_missing | persisted |
|---|---|---|---|---|
| **LABRA Technology, LLC** | **qualify_now** | **all_required_evidence_verified** | **[]** | **true** |
| RevGenics | stage_missing_evidence | missing_timing_signal | [company_industry, company_website, company_size, job_signal] | false |
| Stealth Startup | stage_missing_evidence | missing_timing_signal | [job_signal] | false |
| Book Your Pet | stage_missing_evidence | missing_timing_signal | [job_signal] | false |
| amplificx | stage_missing_evidence | missing_timing_signal | [job_signal] | false |

**LABRA** is the decisive proof: company enrichment force-staged it (fit complete, timing pending →
post sufficiency `signal_enrichment`), the jobs stage found a fresh RevOps hiring signal ⇒
`timing_sufficient`, `stillStagedByEnrichmentAfterTiming` cleared the stale flag, and the reducer
returned `qualify_now` / `all_required_evidence_verified` / `evidence_missing []` / persist=true. This
is the exact v87 condition that previously stayed staged.

The reconciliation also correctly PRESERVED staging for the other four: RevGenics still lacks company
fit (company no_result), and the remaining three lack a fresh job signal (their jobs lookups timed
out). None was falsely promoted.

## Final qualification funnel (reconciles)

```
raw 5 → normalized 5 → source_gate accepted 5 / rejected 0 → hard_gate_rejected 0
qualification_accepted 1 · qualification_staged 4 · qualification_rejected 0
staged_count 4 · persisted_count 1 · downstream_aria_count 5 · aria_screening_count 5
reconciles true · duplicate_state_candidate_ids []
```

Total evaluated 5 = 1 qualify_now + 4 staged + 0 reject. Persisted (1) equals finalPersistSet (1).

## Aria — first truthful positive handoff

Aria **scheduled** (task `f4ee1ee1…`) because `finalPersistSet.length > 0`. Screening is the wide
input: `downstream_aria_count 5` / `aria_screening_count 5` — the whole source-gate-accepted provider
pool was screened, while only **1** persisted. This is the correct screening-vs-persistence
separation: `sent_to_downstream_aria: true` on all five, `persistence_eligible: true` on LABRA only.
**Zero outreach created.**

## Persistence safety

The single persisted lead (LABRA) created **lead_candidates +1** and **contacts +1**, both provider-
backed, timing_sufficient, no contradiction, `evidence_missing []`. No raw provider payload, phone,
unsupported email, secret or authorization header in the persisted lead, contact, or signal. Staged
and rejected candidates created no final artifacts.

## Database deltas (vs locked baseline)

| Table | Δ | Explanation |
|---|---|---|
| lead_candidates | **+1** | LABRA (qualify_now) persisted |
| contacts | **+1** | LABRA's founder contact |
| accounts | 0 | — |
| **signals** | **+1** | one `people_profile` row (source `apify_people`, PII-free) recorded when the qualified lead persisted. **NOT a timing SignalEvent**: 0 `hiring_signal` persisted; the 9 verified timing SignalEvents stayed in memory. See caveat. |
| drafts · queued outreach · sent outreach · outreach activities | **0** | required safety |
| approvals · Penn tasks | 0 | — |
| task_plans | +1 | the Q1 plan |
| tasks | +4 | scout, aria, scout, scribe (full positive flow) |
| tool_calls | +10 | 1 people + 5 company + 4 jobs |
| activity_feed | +27 | workflow logging only; no PII/raw |

Company Brain unchanged. Production untouched.

### Caveat — signals +1

The literal "generic signals delta = 0" expectation is not met: the `signals` table gained **1**
`people_profile` row. This is a pre-existing people-sourcing/persistence artifact tied to the first
successful lead persistence (v87 persisted 0 → signals delta 0; v88 persisted 1 → +1), source
`apify_people`, PII-free. It is **not** a Phase A timing SignalEvent — those (9 `hiring_signal`) all
stayed in memory, which is the requirement's intent. Flagged transparently for review; it is not a
timing-signal leak, unsafe staged/rejected persistence, or any outreach.

## Verdict

**PASS — COMPLETE POSITIVE FIND LEADS PATH.** LABRA satisfies every positive criterion: verified
identity, verified company fit, fresh applicable RevOps hiring signal, `timing_sufficient`,
`qualify_now`, correct persistence, truthful Aria screening, zero outreach. The v87 stale-stage
blocker is fixed and proven live, and the fix correctly leaves genuinely incomplete candidates staged.
All observability objects reconcile; no 504; timing SignalEvents remained in memory; production
untouched. The one non-safety caveat (a PII-free `people_profile` lead-persistence signal row) is
documented above.

Core Find Leads backend: **complete** (positive path proven end-to-end).
