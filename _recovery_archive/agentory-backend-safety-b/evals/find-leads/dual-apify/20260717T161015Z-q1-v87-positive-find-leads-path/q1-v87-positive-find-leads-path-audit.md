# Q1 — v87 Positive Find Leads Path (TEST) — Audit

**Verdict: PARTIAL PASS** — the full dual-Apify + jobs-signal workflow completed safely and
timing was verified sufficient for 3 candidates, but a stale company-enrichment staging flag
blocks the timing-aware `qualify_now`, so no candidate persisted. Live evidence pinpoints a
one-line wiring defect (not a reducer defect).

Date: 2026-07-17 · Project: TEST `zbwsbnqqpkvdhqwavjke` · Production `wqnigjhcwjxtmordrwno` **never accessed**.

## Release identity

| Item | Value |
|---|---|
| PR | #54 (MERGED 2026-07-17T15:57:55Z) — "Find leads timing aware final qualification" |
| Merge commit / merged main | `6860a21820eab23387a39879209d3c591f3caf9a` |
| Feature head | `ac78b099` — contained in main: **yes** |
| Deploy source | detached HEAD at `6860a218` (merged-main content) |
| run-agent | v86 → **v87** (ACTIVE) |
| orchestrate | **v31** (unchanged) |
| Other functions | all 22 unchanged |
| PR #53 | MERGED (v86 evidence report) |

Provider-free validation on merged main: final-qualification policy **10/10**; full suite
**1467 pass / 1 known pre-existing** URL-shortener failure; Deno run-agent **4** / toolRegistry **1**
(baseline); tsc pass; build pass; `mcp/index.ts` reverted; no drift.

## Boot checks (v87)

401 unauthenticated · 400 `missing_required_fields` · zero DB change · Brain fingerprint unchanged.

## Pre-Q1 baseline (locked, post-boot-check)

lead_candidates 426 · contacts 165 · signals 426 · accounts 149 · drafts 64 · approvals 25 ·
task_plans 185 · tasks 357 · tool_calls 336 · Penn 24 · queued 0 · sent 3 · outreach activities 4 ·
activity_feed 1697. Company Brain `030f4f36-171d-4c27-85e1-1c791f05e391` · fp `0d65a1c211458d80d2d488fe5ea14ec6`.

## Submission (exactly one)

- `Find B2B SaaS founders currently hiring for RevOps — who should I contact this week?`
- workspace `00000000-0000-0000-0000-000000000001`, tool_input `{execution_mode: source_and_qualify_only, max_results: 5}`
- HTTP **200** · plan **`3b5a35a2-a468-41bf-a5a4-11fc9f0db821`** · planner `ai` · intent `sourcing`
- Agents `[scout, aria, scout, scribe]` (only Scout step 0 executed; plan terminated at qualification)
- Scout task **`10e14a07-d62d-4833-96e9-d534b220242d`** · **Aria task: never created** (0 persisted ⇒ willRunAria false)

## Bounded execution — healthy, no 504

| Stage | Detail |
|---|---|
| People | `apify_people_search` / `harvestapi/linkedin-profile-search` — **30.7s**, 1 call |
| Company | `apify_linkedin_company_details` / `harvestapi/linkedin-company` — 5 calls, **max concurrency 3**, 4 enriched / 1 no_result |
| Jobs | `apify_jobs` / `curious_coder/linkedin-jobs-scraper` — 4 calls, **max concurrency 3**, 47s wall, per-call 20.0 / 17.1 / 23.6 / 29.5s (all ≤30s) |
| Scout runtime | **98.4s** (inside the 135s budget) · **no 504** · Scout `complete`, plan terminal |
| Actors | exactly the 3 approved canonical actors. **research_web 0 · Firecrawl 0 · Perplexity 0** |

## Timing signals (signal enrichment observability — reconciles)

```
companies_deduplicated 5 · companies_planned 4 · companies_called 4
  = enriched 3 + no_result 0 + failed 1 (timed_out 1 ⊆ failed) · skipped 0
raw_job_records 27 · normalized_job_events 27 · verified_signal_events 27 · deduplicated 27
signals_fresh 20 · signals_weak_supporting 0 · signals_stale 7 · closed_or_expired_listings 0
candidates_considered 5 · candidates_requalified 3
candidates_timing_sufficient 3 · candidates_missing_timing_evidence 2 · candidates_timing_contradicted 0
budget 4/5 · stop_reason "completed" · reconciles true
```

SignalEvents remained **in memory** — generic `signals` table delta **0**. No raw payload / email /
phone / secret in the payload (swept).

## Company enrichment (reconciles)

planned 5 = called 5 + cached 0 + skipped 0 · called 5 = enriched 4 + no_result 1 + failed 0 ·
timed_out 0 · deadline-skip 0 · deduplicated 5 · reconciles true.

## THE BLOCKER — stale company-staging flag defeats the positive path

The signal stage produced **3 `timing_sufficient`** candidates, yet qualification reported
**0 `qualify_now`, 5 staged, 0 rejected** (funnel reconciles, `duplicate_state_candidate_ids []`).
All five staged `missing_timing_signal` → `signal_enrichment`; three of them carry an **empty
`evidence_missing`** (company fit complete), so the only pending gap was timing — which was closed.

Per-candidate:

| Company | decision | reason_code | evidence_missing |
|---|---|---|---|
| VeraAI Technologies Inc. | stage_missing_evidence | missing_timing_signal | [] |
| Stealth Startup | stage_missing_evidence | missing_timing_signal | [] |
| FlowStateGTM™ | stage_missing_evidence | missing_timing_signal | [] |
| amplificx | stage_missing_evidence | missing_timing_signal | [job_signal] |
| RevGenics | stage_missing_evidence | missing_timing_signal | [company_industry, company_website, company_size, job_signal] |

Root cause (wiring, not the reducer):

- `resolveFinalCandidateState` is correct and internally consistent. Its deterministic timing-aware
  `qualify_now` (step 3b) requires `timingDecision === "timing_sufficient"` **and**
  `stagedByEnrichment !== true` **and** `fitVerified`. `finalQualificationPolicy.test.ts:75` explicitly
  asserts that `stagedByEnrichment: true` + `timing_sufficient` stays staged — by design.
- run-agent (`index.ts:1674`) passes `stagedByEnrichment: companyEnrichmentStaged.has(key)`.
  `companyEnrichmentStaged` is computed during **company** enrichment, which force-stages a
  fit-complete candidate **precisely because timing was still missing at that point**
  (`runAgentCompanyEnrichment`: staged when `sufficientAfter` is false, i.e. `nextDecision ===
  "signal_enrichment"`).
- **Signal** enrichment then closes exactly that timing gap (`timing_sufficient`), but the stale
  `companyEnrichmentStaged` flag is never reconciled, so step 3b is skipped and the candidate falls
  through to the sufficiency routing → `missing_timing_signal`.

The two observability objects therefore disagree (signal: 3 timing_sufficient; qualification: 0
qualify_now) — the positive path is logically unreachable while the flag is stale.

**Surgical fix (one line, `index.ts:1674`):**

```ts
stagedByEnrichment: companyEnrichmentStaged.has(key)
  && timingByCandidate.get(key)?.decision !== "timing_sufficient",
```

Rationale: company enrichment can only force-stage a *fit-complete* candidate for missing timing
(a fit-incomplete one has `sufficiencyDecision = structured_company_enrichment`, so `fitVerified` is
false and step 3b never fires regardless). When the later signal stage proves `timing_sufficient`,
the company-staging reason is resolved, so the flag must no longer block. This preserves the reducer
contract and its test verbatim; the change is entirely in the integration layer. It needs its own
provider-free test (fit-verified + company-staged + later timing_sufficient ⇒ qualify_now) and a
fresh controlled query to validate live.

## Qualification funnel (reconciles)

```
raw 5 → normalized 5 → source_gate accepted 5 / rejected 0 → hard_gate_rejected 0
qualification_accepted 0 · qualification_staged 5 · qualification_rejected 0
staged_count 5 · persisted_count 0 · downstream_aria_count 0 · aria_screening_count 0
reconciles true · duplicate_state_candidate_ids []
```

Total evaluated 5 = 0 qualify_now + 5 staged + 0 reject. No candidate in two states.

## Aria

Not scheduled (`willRunAria = finalPersistSet.length > 0` = false, 0 persisted). No Aria task;
`downstream_aria_count 0`; telemetry truthful. The positive Aria path was **not** exercised — a direct
consequence of the blocker above, not a telemetry defect.

## Database deltas (vs locked baseline)

| Table | Δ | Note |
|---|---|---|
| lead_candidates · contacts · accounts | **0** | nothing persisted (all staged) |
| **signals** | **0** | SignalEvents stayed in memory (required) |
| drafts · queued outreach · sent outreach · outreach activities | **0** | required safety |
| approvals · Penn tasks | 0 | — |
| task_plans | +1 | the Q1 plan |
| tasks | +1 | the Scout task |
| tool_calls | +10 | 1 people + 5 company + 4 jobs |
| activity_feed | +18 | workflow logging only; no PII/raw |

Company Brain unchanged. Production untouched.

## Verdict

**PARTIAL PASS.** The workflow completed safely end-to-end — no 504, all three canonical actors,
bounded concurrency (company ≤3, jobs ≤3), 27 verified in-memory SignalEvents, 3 candidates
`timing_sufficient`, every observability object reconciles, zero unsafe persistence, zero outreach,
production untouched. It falls short of COMPLETE POSITIVE PATH because a stale
`companyEnrichmentStaged` flag (set for missing timing during company enrichment, never reconciled
after signal enrichment supplied it) blocks the reducer's timing-aware `qualify_now`, so all five
candidates stage and none persists.

Dominant remaining blocker: **the `stagedByEnrichment` wiring at `index.ts:1674` does not reconcile
the company-enrichment staging flag against the post-signal `timing_sufficient` verdict.** One-line
fix above; needs a provider-free test and a fresh controlled query to prove live.

Next: a dedicated fix branch (`stagedByEnrichment` reconciliation + test), then redeploy run-agent and
run one controlled positive-path query.
