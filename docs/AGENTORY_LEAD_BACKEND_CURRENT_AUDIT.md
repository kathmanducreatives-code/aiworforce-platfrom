# Agentory Lead Backend — Current Production Audit

**Audit date:** 2026-09-02 (16:20–17:10 UTC)
**Auditor:** read-only forensic against live production `ohsdatpvfdjdemstoiuj`
**Scope:** lead-mission backend only. No UI, no landing page, no frontend changes.
**Method:** git inspection, Supabase Management API (deployed function bodies, SQL, edge logs), Apify run/dataset reads, full backend test suite, source trace.

Evidence is labelled throughout:

| Label | Meaning |
|---|---|
| **CODE PROVEN** | Read in current source at a cited line |
| **TEST PROVEN** | Covered by a test that runs and passes today |
| **PRODUCTION PROVEN** | Observed in live production data/logs from a real run |
| **ASSUMED / NOT PROVEN** | Believed but not demonstrated in this audit |

---

## 1. Executive Verdict

**Grade: C — CORE WORKS, MATERIAL RELIABILITY GAPS REMAIN.**

The autonomous machinery is genuinely finished and production-proven. A real user mission runs end-to-end with **zero manual continuation**: the sweeper drove 10 continuations across 20 cron ticks, discovery replenished when the pool emptied, three of four in-flight paid provider runs were adopted for free on later slices, the checkpoint survived 11 resumes, credits were charged exactly once per semantic operation, and a qualified company was written through to the Lead Library.

It nevertheless **cannot reach quota on the canonical mission**, and the reason is not the machinery. In the acceptance run, **7 companies passed every checkable requirement** — UK presence, employee count, verified sales hiring, zero failed requirements — and were refused solely because the evaluator could not prove "B2B SaaS" from the evidence the pipeline collects. Only 1 of 5 was returned. Had that one gap been closed, the same run had enough verified candidates to satisfy the request.

Two further defects are confirmed live:

1. **An orphaned paid provider run** — a run the user was charged a credit for, which succeeded 2m36s after the lineage terminated, and whose 363 job rows were discarded.
2. **Funnel accounting is not balanced** — `company_brain: 51→14 UNACCOUNTED=37`. The invariant `unaccounted = 0` is violated on the currently deployed version.

The verdict is C rather than D because the system stops **truthfully and explainably** (`continuation_ceiling`, `barren_slices: 0`) rather than falsely, and never silently corrupts state. It is C rather than B because the headline user promise — "find me 5" — is not met when the evidence to meet it demonstrably existed.

---

## 2. Current Git / Deployment State

### Repository

The audit's working directory (`/Users/prasidha/claudecode-agentory`) is **not** the repo; it contains only `.claude/launch.json`. The real repo is **`/Users/prasidha/agentory-main-local`**.

| Item | Value |
|---|---|
| Branch | `feat/lead-mission-v1` (expected branch ✓) |
| HEAD | `b9b55cf204f54b8d4f192d5199a110fb358e6bd9` |
| vs `origin/feat/lead-mission-v1` | `0 0` — no divergence, fully pushed |
| Working tree | 1 modified frontend file (`src/components/landing/DayTimelineSection.tsx`), 1 untracked probe file. **Not touched by this audit.** |

Recent commits (newest first):

```
b9b55cf2 Keep Pilot out of the sections that present the four employees
d4dabe10 Recruiting: a scroll-driven mission, not a static candidate list
191261dc Navbar labels and recruiting copy
31c534a1 Timeline: one job followed through the team, not an activity log
7ebb078d Landing: one scroll system instead of four sets of ad-hoc values
eb6dec59 Workforce cards: product surfaces instead of diagrams
567cc47f Workforce sequence: final polish
3656feb8 Workforce sequence: introduce the AI employees
0956aa13 Landing: clear the remaining flagged defects
e42aa1fa War room: symmetric scrolling
880f48bb A Brain verdict is progress, and a paid run outranks a barren verdict
080b4ced Fix qualification starvation on resumed lead missions
```

### Is `880f48bb` actually deployed?

**Yes — deployed, not merely committed.** Verified three independent ways:

1. `git merge-base --is-ancestor 880f48bb HEAD` → **contained in HEAD**.
2. `git diff --name-only 880f48bb HEAD -- supabase/` → **0 files**. Every commit after `880f48bb` is frontend-only, so HEAD's backend *is* `880f48bb`'s backend.
3. The **deployed bundles were downloaded** from the Management API and grepped for the commit's distinctive symbols.

`880f48bb` touched exactly:
`leadAutoContinuation.ts`, `stalledLeadResume.ts`, `resume-stalled-leads/index.ts`, `run-agent/index.ts`, plus three test files.

### Live edge function versions (production `ohsdatpvfdjdemstoiuj`)

| Function | Version | Status | Deployed (UTC) |
|---|---|---|---|
| `run-agent` | **164** | ACTIVE | 2026-09-02 15:00:45 |
| `resume-stalled-leads` | **13** | ACTIVE | 2026-09-02 15:00:59 |
| `pilot-chat` | 124 | ACTIVE | 2026-09-01 15:57:23 |
| `run-monitoring-scan` | 70 | ACTIVE | 2026-09-01 15:57:29 |

`run-agent` advanced **v163 → v164** and `resume-stalled-leads` **v12 → v13** at the `880f48bb` deploy. 33 functions are deployed in total.

### Bundle-level marker verification (occurrences in the deployed eszip)

`run-agent` v164 (11,507,041 bytes):

| Marker | Count |
|---|---|
| `brain_decided` | 6 |
| `brainDecidedInPool` | 4 |
| `replenishment_required` | 11 |
| `qualification_deferred` | 5 |
| `availableAdmittedNow` | 9 |
| `MAX_RAW_ROWS_PER_ADMITTED` | 5 |
| `mission_evaluation` | 40 |
| `enrichedGeography` | 3 |
| `QUALIFICATION_PRIORITY_CAPABILITIES` | 5 |
| `PAGE_COMMITTING_OUTCOMES` | 3 |
| `DEFERRED_STAGE_REASONS` | 3 |

`resume-stalled-leads` v13 (774,561 bytes): `brain_decided` 6, `hasStartedProviderRun` 7, `RECOVERABLE_STAMPED_ROW_STATUSES` 3, `continuation_required` 22.

> **Correction to an earlier internal note:** `DEFERRED_STAGE_REASONS` lives in `run-agent/index.ts:387`, **not** in `resume-stalled-leads/index.ts`. Its absence from the sweeper bundle is correct, not drift. Deployed bundles match current source.

**Deployment state: PRODUCTION PROVEN.**

### Production cron (all active)

| Job | Schedule | Active |
|---|---|---|
| `resume-stalled-leads` | `*/3 * * * *` | ✓ |
| `sweep-stuck-runs` | `*/5 * * * *` | ✓ |
| `release-stale-credit-reservations` | `*/10 * * * *` | ✓ |
| `monitoring-tick` | `*/15 * * * *` | ✓ |

---

## 3. Architecture

Backend surface, by file, with the role each plays:

| File | Role |
|---|---|
| `supabase/functions/run-agent/index.ts` | Mission entrypoint; capability dispatch; funnel emission; auto-continuation call; persistence into Lead Library |
| `_shared/leadCapabilityEngine.ts` | The engine. Discovery sizing, admission, identity, enrichment, hiring, Brain qualification, checkpoint write/restore. Largest surface (~9,100 lines) |
| `_shared/leadAutoContinuation.ts` | `decideAutoContinuation` — the terminal/continue decision and its ordering |
| `_shared/stalledLeadResume.ts` | Sweeper-side eligibility: leases, ceilings, barren detection, pending-run precedence |
| `supabase/functions/resume-stalled-leads/index.ts` | The 3-minute sweeper; queue selection; dispatch |
| `_shared/leadResumeState.ts` | Checkpoint contract (`lead-resume-state-v1`) |
| `_shared/executionLedger.ts` | `lead_execution_calls` writer; attempt escalation |
| `_shared/creditAuthorization.ts` | Credit reserve/settle, idempotent on `logical_call_key` |
| `_shared/providerInputFingerprint.ts` | `v2:` canonical SHA-256 fingerprints |
| `_shared/hiringActorNormalizers.ts` | Provider row → `NormalizedHiringCompany`, incl. `enrichedGeography` |
| `_shared/leadMissionFunnel.ts` | Stage-by-stage accounting; `unaccounted` invariant |
| `_shared/multiRoundState.ts` | Round bookkeeping; emits `round_limit_reached` |
| `_shared/leadMissionCompiler.ts` | NL request → `LeadMissionV1` |

### Persistence model

| Table | Contents |
|---|---|
| `lead_lineages` | One row per lineage. `current_state` jsonb holds `lead_resume_checkpoint`, `capability_execution_state`, `run_outcome`, `terminal_status` |
| `tasks` | One row per lineage root, **reused across continuations** (`checkpoint_version` increments) |
| `lead_execution_calls` | Provider ledger: `logical_call_key`, `provider_run_id`, `status`, cost |
| `credit_transactions` | Credit reserve/charge, idempotent on `idempotency_key` |
| `accounts` | Qualified companies surfaced in the Lead Library |
| `lead_model_calls` | **Effectively unused — 1 row total, dated 2026-08-25** |

---

## 4. End-to-End Mission Flow

Traced against acceptance lineage `a5c1616e`, whose stored payload is the canonical prompt **verbatim**:

> "Find me 5 B2B SaaS companies in the UK with 20–200 employees that are actively hiring SDRs, BDRs, Account Executives, or other sales roles."

| # | Stage | Source | Persisted state | Resume behaviour | Production evidence |
|---|---|---|---|---|---|
| 1 | Request understanding → `RequestV1` | `pilot-chat` v124 | `request_understanding_log` | n/a | agent_slug `scout` |
| 2 | Objective routing → `LeadMissionV1` | `leadMissionCompiler.ts` | `tasks.payload` | mission re-read on resume | payload verbatim ✓ |
| 3 | Stage 0 feasibility / preview | `leadCapabilityEngine` | — | — | not exercised in this audit |
| 4 | Discovery | `apify_linkedin_company_search` | `capability_execution_state.company_keys` | `pages_taken` **derived**, not stored | 2 calls, 100 raw, $0.290 |
| 5 | Candidate admission | `admittedTarget`, triage | `snapshot.triage`, `investigation_rank` | restored | 99 discovered → 81 → 51 |
| 6 | Identity resolution | engine | `snapshot.identity` | restored | 51/51 resolved, 0 unresolved |
| 7 | Enrichment | `apify_linkedin_company_details` | `snapshot.enriched` (full object) | restored via `s.enriched` | 12 calls, 54 rows, $0.033 |
| 8 | Hiring verification | `apify_linkedin_job_search` | `snapshot.hiring_jobs`, `hiring_assessment` | restored | 10 ok / 5 reused / **4 timed_out**, $0.273 |
| 9 | Brain qualification | `company_brain_qualification` | `snapshot.brain`, `snapshot.mission_evaluation` | restored | 14 evaluated, 1 qualified |
| 10 | Persistence | `run-agent` | `accounts`, `lead_results` | idempotent | Neota Logic @ 15:39:48 ✓ |
| 11 | Continuation / replenishment | `decideAutoContinuation` | lineage `generation` | sweeper-driven | 10 continuations, 1 replenishment |
| 12 | Final `RunOutcome` | `run-agent` | `current_state.run_outcome` | terminal | `round_limit_reached`, PARTIALLY_SATISFIED |

**Failure behaviour observed:** provider timeout → `timed_out` + `awaiting_provider_run` deferral → adoption on a later slice at zero extra cost (3 of 4 times).

---

## 5. Discovery & Adaptive Sourcing

### Constants (CODE PROVEN, `leadCapabilityEngine.ts`)

```
MAX_RAW_ROWS_PER_ADMITTED = 4
MIN_PAGINATION_YIELD      = 0.2
ADMITTED_PER_OWED_LEAD    = 4
MINIMUM_ADMITTED_TARGET   = 8

admittedTarget = min(maxCandidates,
                     max(MINIMUM_ADMITTED_TARGET, owedLeads * ADMITTED_PER_OWED_LEAD))
```

`availableAdmittedNow()` counts admitted ∧ `investigation_state !== "excluded_permanently"` ∧ `nextStageFor(...) !== null` — i.e. **available**, not lifetime-admitted (fix R1).

### Page cursor honesty (fix R2) — CODE PROVEN

`pages_taken` is **derived**, not stored:

```ts
const PAGE_COMMITTING_OUTCOMES = new Set([
  "ok", "empty", "rows_dropped",
  "skipped_idempotent", "skipped_resume_reuse", "run_adopted",
]);
const attemptCountFor = (actorKey) =>
  state.provider_attempts.filter(a =>
    a.capability === cap && a.provider === actorKey &&
    PAGE_COMMITTING_OUTCOMES.has(String(a.outcome))).length;
```

This is why the checkpoint contains **no page cursor** — it cannot drift, because it is recomputed from real operations. Production agrees: `pages_taken: 2` with exactly 2 `company_search` calls.

### Adaptive replenishment — PRODUCTION PROVEN

`frontier_remaining` across the acceptance run's continuations:

```
14 → 7 → 1 → 0 → 27 → 25 → 19 → 9 → 6 → 3
                  ↑ pool reopened (replenishment_required, fired once)
```

The `0 → 27` step is discovery genuinely reopening, not a recount.

The **50 → 100 → 150** expansion is proven across lineages: `74de044e` 50, `a5c1616e` 99, `57b937ab` 100, `ecb9afe9`/`633ad466`/`e70cbf3a` **150**.

### Hard constraints

- **Employee size:** exact semantics enforced — 30 companies excluded with reason `employee_size`; evaluator cites `"131 employees"` / `"196 employees"` against the 20–200 band.
- **Geography:** UK **presence**, not HQ — see §10.

### Weakness found: triage produces no positive signal

`capability_execution_state.triage` for the acceptance run:

```
total: 99   relevant: 0   uncertain: 57   irrelevant: 42
```

**Zero** companies were ever rated `relevant`; all 51 shortlisted carry `relevance: "uncertain"`. Triage runs on the *search* normalization, which has no geography, so its stated reasons penalise companies for "no UK location shown" when the details call later proves one. Triage is therefore contributing ranking noise rather than signal. Not currently harmful (ordering only), but it is dead weight and a latent mis-ranking risk.

---

## 6. Provider Execution & Adoption

### Async start + adoption — PRODUCTION PROVEN

Four job searches exceeded the ~90s in-function wait cap and were recorded `timed_out` with `failure_code: apify_run_running`, each retaining its real `provider_run_id`. Adoption on a later slice:

| Apify run | Started | Ledger rows | Adopted? |
|---|---|---|---|
| `nsbhORTBWwKbg5glP` | 15:19:54 | 2 (`timed_out`, `reused`) | **Yes** @ 15:27:23 |
| `GpSvtZXuu5tmY5Agg` | 15:27:24 | 2 (`timed_out`, `reused`) | **Yes** @ 15:36:37 |
| `fHReLEXUNh2PVpOe5` | 15:38:15 | 2 (`timed_out`, `reused`) | **Yes** @ 15:45:24 |
| `haICm96EMNNftbtgS` | 15:51:36 | **1 (`timed_out` only)** | **NO — orphaned** |

Adoption re-reads an already-purchased run for free (`reused`, `$0.000`). **The adoption mechanism works.**

### DEFECT-1: orphaned paid provider run — CONFIRMED, PRODUCTION PROVEN

Queried directly from Apify:

```
runId      haICm96EMNNftbtgS
actor      harvestapi/linkedin-job-search
status     SUCCEEDED
startedAt  2026-09-02T15:51:36.941Z
finishedAt 2026-09-02T15:55:48.379Z
items      363   computeUnits 0.01744
```

The lineage wrote its terminal state at **15:53:12** — **2m36s before the run finished**. The 363 job rows (hiring evidence for this very mission) were paid for, charged 1 credit, and discarded. `capability_execution_state.progress.awaiting_external_run` was `true` at termination, so the system *knew*.

**Root cause — deliberate, documented ordering** in `leadAutoContinuation.ts`:

> "`pendingRuns` suppresses the three FINDINGS — an exhausted frontier, a provider failure, a barren streak … It does **NOT** suppress the ceilings, because those are protections and a run that never finishes must still be bounded."

So `pendingRuns` gates `frontier_exhausted`, `provider_failure` and `no_progress`, but **not** `continuation_ceiling`. When the ceiling lands while a run is in flight, the run is abandoned by design.

**Smallest likely fix (NOT IMPLEMENTED):** before emitting a *ceiling* terminal decision, perform one settle-and-adopt pass over `pendingRuns` — adoption is a free `GET /actor-runs/{id}` and buys nothing new. Alternatively allow a single bounded grace continuation whose only permitted work is adoption. Both preserve the bound the comment is protecting; neither raises the ceiling.

---

## 7. Spend / Credit Idempotency

### Identity scheme (CODE PROVEN)

```
logical_call_key = <lineage_root>:<capability>:v2:<sha256(canonicalJson({actorKey, input}))>
```

`credits_reserve` is idempotent on this key; the execution ledger is separately keyed `(workspace_id, logical_call_key, attempt_number)`.

### Acceptance run spend

| Capability | Actor | Status | n | USD |
|---|---|---|---|---|
| `company_search` | `harvestapi/linkedin-company-search` | succeeded | 2 | 0.290 |
| `company_details` | `harvestapi/linkedin-company` | succeeded | 12 | 0.033 |
| `job_search` | `harvestapi/linkedin-job-search` | succeeded | 10 | 0.273 |
| `job_search` | " | **reused** | 5 | 0.000 |
| `job_search` | " | **timed_out** | 4 | 0.000 |
| `company_discovery` | (planner) | succeeded | 10 | 0.000 |
| `decision_maker` | (planner) | succeeded | 10 | 0.000 |

Total **53 ledger rows**, **$0.596**, matching `run_outcome.spend.usd_reported` exactly.

Credits: **28 rows, all `charged`, 28 actual, 0 refunded** — matches `credits_charged: 28`.

### Can a user be double-charged? **No.**

```sql
select idempotency_key, count(*) from credit_transactions
where task_id like 'a5c1616e%' group by 1 having count(*) > 1;
-- → 0 rows
```

Every semantic operation was charged exactly once. **Credit idempotency: PRODUCTION PROVEN.**

### DEFECT-2: one duplicate *paid provider execution* — CONFIRMED

Distinguishing the two things the brief asks to separate:

- **Duplicate DB/log record:** not the case here.
- **Actual duplicate paid provider execution:** **yes, one.**

```
logical_call_key  a5c1616e...:apify_linkedin_company_details:v2:d5815ae859ccc981f3104e53
  run nGEBzzCNDGHVVKD1G  attempt 1  succeeded  $0.0001  15:45:07  (3 companies)
  run rxa40AIIFs9Vqm6nH  attempt 2  succeeded  $0.0001  15:51:24  (same 3 companies)
```

Identical fingerprint, two distinct Apify runs, both executed and both billed by the provider. The **credit** guard held (charged once), so the user was not double-charged; Apify compute was spent twice.

Historical trend across lineages (extra paid runs beyond the first per semantic key):

| Lineage | Date | Duplicate keys | Extra paid runs | USD |
|---|---|---|---|---|
| `a5c1616e` | 09-02 | 1 | **1** | 0.000 |
| `74de044e` | 09-01 | 1 | 1 | 0.000 |
| `744644ab` | 09-01 | 1 | 1 | 0.035 |
| `ecb9afe9` | 09-01 | 4 | **20** | 0.150 |
| `fd4ed70a` | 08-31 | 3 | 6 | 0.001 |
| `7eab99fc` | 08-30 | 1 | 1 | 0.126 |

**20 → 1 is a real improvement, but the target `duplicate paid semantic operations = 0` is NOT met.**

**Note on the ledger's attempt escalation** (`executionLedger.ts:1049-1085`): escalating `attempt_number` on a unique violation is *intentional* and is not the money gate — the comment says so explicitly. It is therefore not the cause; the cause is that a re-attempt was dispatched to the provider at all. Likely mechanism: after restore, `c.enriched` is repopulated but the batch was re-selected before the ledger short-circuit could classify it `skipped_idempotent`. **Diagnosed, not fixed.**

### DEFECT-3: charged for discarded work

Four credits were charged with reason `apify_run_running`. Three bought runs later adopted (fair). The fourth bought `haICm96EMNNftbtgS`, whose output was orphaned — **1 credit for nothing**, with `refunded_credits: 0`.

### Observability gap: model spend is unlogged

`lead_model_calls` contains **1 row in the entire table**, dated 2026-08-25, despite 14 Brain evaluations in this run alone. Provider spend is fully auditable; **model spend is not**.

---

## 8. Checkpoint & Resume Semantics

### Contract

`lead_resume_checkpoint` = `{ version: "lead-resume-state-v1", companies: [...] }` — 99 companies for the acceptance run.

Per-company node keys:
`brain, company_key, company_name, completed_operations, enrichment, founder, hiring, identity, invalidated_stages, linkedin_company_url, snapshot, updated_at`

`snapshot` keys:
`brain, company, enriched, enrichment_outcome, hiring_assessment, hiring_jobs, identity, investigation_rank, investigation_state, mission_evaluation, prequal_key, prequalified, shortlisted, triage, yc_open_jobs`

### The write + declare + read rule holds for the fields that matter

| Field | Written | Restored | Production check |
|---|---|---|---|
| `enriched` (full normalized object) | ✓ | `leadCapabilityEngine.ts:8259` | **51/51** enriched companies carry a full object |
| `mission_evaluation` | ✓ | ✓ | present on all 14 evaluated |
| `investigation_state` | ✓ | ✓ | populated |
| `hiring_assessment` / `hiring_jobs` | ✓ | ✓ | populated |

`enrichment` at the node level is a **status string** (`"completed"`, 51 of 99); the actual enrichment payload lives at `snapshot.enriched`. Both exist — an earlier reading that took the status string for the payload was wrong.

**Checkpoint survives resume: PRODUCTION PROVEN** across 11 checkpoint versions on a single task row.

### Wall-clock survival

The run spanned **15:01:38 → 15:53:12 (51m34s)** on a platform with a per-invocation wall-clock limit, across 12 generations of one task row. Each slice ends on `execution_deadline_checkpoint` and hands off. **PRODUCTION PROVEN.**

### Lineage status columns are cosmetically wrong

`lead_lineages.status` is `active`/`running` and `terminal_reason` is **NULL for every lineage in the table**, including terminated ones. The real terminal signal lives in `current_state.terminal_status`. Consumers reading the columns would be misled. Low severity (nothing in the sweeper path depends on it), but it is an inconsistency.

---

## 9. Qualification

### Ordering: qualification debt is paid first — CODE PROVEN + deployed

`QUALIFICATION_PRIORITY_CAPABILITIES = ["company_brain_qualification"]` reorders `orderedSteps`, present 5× in the v164 bundle. The intended resumed-slice order (restore → qualification first → identity/enrichment/hiring after) is in current code and shipped.

### Evidence path

`leadCapabilityEngine.ts:6778`:

```ts
const src = c.enriched ?? c.company;
```

so the evaluator reads enriched geography/size/description when enrichment has run, and falls back to the search row otherwise.

### The 14 evaluated companies

| Company | Decision | Score | hiring_fit | failed reqs | Blocked on B2B SaaS |
|---|---|---|---|---|---|
| **Neota Logic** | **qualified** | 94 | verified | 0 | no |
| Metaview | insufficient_evidence | 86 | verified | 0 | **yes** |
| Utila | insufficient_evidence | 82 | verified | 1 | yes |
| DiligenceVault | insufficient_evidence | 82 | verified | 1 | yes |
| Pump.co | insufficient_evidence | 82 | verified | 0 | **yes** |
| Kody | insufficient_evidence | 82 | verified | 0 | **yes** |
| InEvent | insufficient_evidence | 82 | verified | 0 | **yes** |
| Volody | insufficient_evidence | 78 | verified | 0 | **yes** |
| Hebbia | insufficient_evidence | 78 | verified | 0 | **yes** |
| Gloat | insufficient_evidence | 72 | plausible | 0 | yes |
| Twine | insufficient_evidence | 48 | absent | 1 | yes |
| FastSpring | insufficient_evidence | 0 | absent | 0 | no |
| Flagright | insufficient_evidence | 0 | absent | 0 | no |
| Metaprise | insufficient_evidence | 0 | absent | 0 | no |

**7 companies: `hiring_fit: verified`, zero failed requirements, blocked *solely* on B2B SaaS.**

### Was the Brain starved?

**No — and this corrects a natural misreading of the counters.** The Brain evaluated **14 of 14** companies whose hiring was verified. The 37 "unevaluated" enriched companies break down as:

```
investigation_state = investigated, stage_block = None:
  27 × hiring: not_verified          (refuted — no matching sales roles)
  10 × hiring: evidence_unavailable
```

They were withheld by **hiring verification**, not by the clock or the ceiling. Qualification throughput is not the bottleneck; **evidence sufficiency is**.

---

## 10. Geography

**FULLY SOLVED. PRODUCTION PROVEN.**

`enrichedGeography()` (`hiringActorNormalizers.ts:381`) walks **all** locations, prefers `parsed.text`, falls back to `city, countryFull`, dedupes, and **does not privilege `headquarter: true`**.

Live values from the acceptance checkpoint (`snapshot.enriched.geography`), **51 of 51 enriched companies populated**:

| Company | Geography |
|---|---|
| **Metaview** | **London, United Kingdom; San Francisco, CA, United States** |
| Como | Miami, FL, United States; **London, United Kingdom**; Reẖovot, Israel; Dubai, UAE; Paris, France |
| Hebbia | **London, United Kingdom**; San Francisco, CA, United States; New York City, NY, United States |
| PostGrid | **United Kingdom**; Dallas, TX; New York City, NY; Toronto; Sydney |
| Notchup | **London, United Kingdom**; Palo Alto, CA; New York City, NY |
| Appwrite | Wellington, NZ; Abu Dhabi, UAE; **London, United Kingdom** |

Metaview matches the required target semantic exactly.

The **HQ-is-not-required rule is empirically satisfied**: Como's London office is `headquarter: false` (its HQ is Miami) and Como is still carried as UK-present. PostGrid's UK entry is likewise non-HQ. Verified against the raw provider payload (Apify dataset `pE312d3LIbL4Mr9pG`).

The evaluator cites it as first-class evidence — Metaview's `matched_requirements` contains:

```
requirement: "Company is located in the United Kingdom"
excerpt:     "London, United Kingdom; San Francisco, CA, United States"
evidence_id: company_location:linkedin:42681bd9
```

**Caveat (cosmetic, not functional):** `snapshot.company.geography` — the *search-stage* normalization — is `null` for all 99, and all 99 snapshots carry `raw_ref.actor_key: apify_linkedin_company_search`. Only `snapshot.enriched` carries geography. This is by design (`src = c.enriched ?? c.company`) but it means **triage** (which reads the search row) is blind to geography and writes misleading reasons such as Como's *"no UK location … is shown."* That text is triage's, not the Brain's, and no qualification decision rests on it.

---

## 11. B2B SaaS Evidence

**This is the dominant reliability limitation.** Classification: **weakly established / still unprovable for most companies.**

The pipeline's only industry evidence is LinkedIn's taxonomy, which returns `Software Development` — a label that does not distinguish B2B SaaS from consumer software, marketplaces, or services. The evaluator correctly refuses to infer, and returns `insufficient_evidence`.

Verbatim from production (`snapshot.mission_evaluation`):

> **Metaview** — "satisfies the employee-count requirement, has a London, United Kingdom location, and has current London-based openings for Sales Development Representative and Account Executive, Enterprise. However, the supplied industry evidence identifies the company only as Software Development, while the Mission requires B2B SaaS." — `confidence: 0.94`, `evidence_quality: strong`, `match_score: 86`, `failed_requirements: []`

> **Hebbia** — "has a verified London, United Kingdom location, 196 employees within the Mission's 20–200 range, and a current Account Executive, Enterprise opening. However, the evidence identifies the company as an AI platform for finance and Software Development, not clearly B2B SaaS." — `confidence: 0.93`, `match_score: 78`

> **Twine** — "satisfies the United Kingdom location and employee-count requirements … the company description describes a freelance-expert network and marketplace rather than clearly establishing B2B SaaS." (here the refusal is *correct*)

The evaluator's behaviour is **not a bug** — it is being honest about evidence it does not have, and Twine shows the discrimination is real. The bug is upstream: **nothing in the pipeline ever collects business-model evidence.** No website scrape, no pricing-page check, no product-page classification. `company.description` is present and often decisive to a human reader ("AI recruiting platform", "AI platform for finance"), but is not treated as sufficient proof.

**Impact, quantified:** 7 of 14 evaluated companies were blocked on this alone. With 5 requested and 7 available, **closing this gap alone would plausibly have satisfied the mission**.

**Smallest likely fix (NOT IMPLEMENTED):** either (a) add one business-model classification step over the already-collected `description` + `website` so the requirement becomes checkable, or (b) treat "Software Development + B2B-shaped description + enterprise sales roles" as sufficient corroboration at a stated confidence rather than demanding explicit proof. (a) is more truthful; (b) is cheaper. **This requires a product decision on the evidence bar and must not be changed silently.**

---

## 12. Frontier / Replenishment

### Definition (CODE PROVEN, `run-agent/index.ts:4852-4874`)

`sliceFrontier` counts companies where `isUnfinishedFrontier(investigation_state, deferred)` holds, with `DEFERRED_STAGE_REASONS = ["deferred", "qualification_deferred"]` — so both a budget-abandoned company and a fully-investigated company owing only a Brain call count as live work. The comment is explicit that dropping the second "would abandon four fully-paid candidates in order to buy replacements."

### Is anything stuck in the frontier forever? **No.**

Frontier drained to 0, replenishment fired, and it refilled to 27 — candidates transition. No permanently-stuck population was found.

### Are valuable candidates discarded to trigger sourcing? **No.**

The 51 enriched candidates were retained across all 11 checkpoints with their enrichment and hiring evidence intact.

### DEFECT-4 (latent): frontier under-counts hiring-refuted candidates

Final `frontier_remaining: 3`, while **37** fully-enriched companies had `brain: not_started`. Those 37 carry `investigation_state: "investigated"` with `stage_block: None`, so they are outside the frontier.

For the 27 `hiring: not_verified` this is defensible — the mission requires active sales hiring, and hiring was refuted. For the **10 `hiring: evidence_unavailable`** it is questionable: the engine's own comment says an empty provider answer is *"not a rejection — it is an absence of evidence, and qualification holds on it rather than deciding."* Yet they are marked `investigated`, excluded from the frontier, and never evaluated.

**Risk:** if the ceiling had not landed first, `frontierRemaining <= 0` with no discovery routes would emit `frontier_exhausted` — *"every discovered candidate has been investigated"* — while 10 candidates held only an absence of evidence. That is the precise false-exhaustion class the split was built to prevent. **Not observed in production** (this run stopped on the ceiling), so it is a latent path, not a live defect.

---

## 13. Progress / Barren Semantics

### Current definition (CODE PROVEN, `leadAutoContinuation.ts`)

```ts
sliceWasBarren = qualifiedDelta <= 0 && investigatedDelta <= 0 && (brainDecidedDelta ?? 0) <= 0
MAX_BARREN_SLICES = 2
```

`LineageProgress.brain_decided` is folded, read and persisted; `run-agent` supplies `brainDecidedInPool = companies.filter(c => c.brain !== null).length`.

Progress **includes**: newly investigated company, persisted Brain decision, qualification transition, provider-result adoption, pool expansion.
Progress **excludes**: a provider merely started, replay with no state change, logging, waiting.

### Does a pending run outrank barren termination? **YES — in both deciders.**

- `leadAutoContinuation.ts`: `if (!awaiting && i.barrenSlices >= MAX_BARREN_SLICES)` — the barren stop is gated on `!awaiting`.
- `stalledLeadResume.ts`: the pending-run check was moved **above** the barren check (`880f48bb`).

### PRODUCTION PROVEN

Across the entire 10-continuation acceptance run, **`barren_slices: 0`** at every decision point, including slices where `reached_evaluation` did not advance (9 → 9). Two slices deferred with `awaiting_provider_run` rather than counting barren. **There were zero false `no_progress` terminations.**

Final decision record:

```
qualified: 1, requested: 5, frontier_remaining: 3,
continuations_used: 10, cost_units_used: 28,
barren_slices: 0, decision: "continuation_ceiling"
```

---

## 14. Sweeper / Autonomous Continuation

### Autonomy — PRODUCTION PROVEN, zero manual continues

- `cron.job_run_details` for `resume-stalled-leads`: **20 executions, all `succeeded`**, 15:00:00 → 15:57:00, 3-minute cadence.
- The lineage advanced to `generation: 12`, `checkpoint_version: 11`, on **one** task row — continuations resume in place rather than spawning children.
- `[run-agent][auto-continuation] continuation_dispatched … handed_off: true` at indices 1–8, plus two sweeper deferrals.

### Decision sequence observed

| # | frontier | decision |
|---|---|---|
| 1–4 | 14 → 7 → 1 → 0 | `quota_unmet_frontier_remains` → dispatched |
| 5 | 0 → 27 | **`replenishment_required`** |
| 6, 7 | 25, 19 | **`awaiting_provider_run`** → deferred to sweeper |
| 8 | 9 | `quota_unmet_frontier_remains` |
| 9 | 6 | `awaiting_provider_run` |
| 10 | 3 | **`continuation_ceiling`** (terminal) |

`terminal_status_overridden { from: "round_limit_reached", to: "continuation_required" }` appears on every non-final slice — the multi-round controller proposes a stop each slice and the continuation layer correctly overrides it.

**The full chain — slice 1 → slice 2 → qualification → replenishment → provider adoption → later pages → terminal result — ran autonomously.**

---

## 15. Production Acceptance Evidence

### Primary acceptance run

| Field | Value |
|---|---|
| Lineage / task | `a5c1616e-db34-4cd4-85b0-2824f24b670e` |
| Date | 2026-09-02 15:01:38 → 15:53:12 UTC (51m34s) |
| Deployed version | **`run-agent` v164, `resume-stalled-leads` v13** |
| Prompt | canonical, **verbatim** |
| Pool discovered | 99 |
| Shortlisted / identity / enriched | 51 / 51 / 51 |
| Hiring verified / refuted / unavailable | 14 / 27 / 10 |
| Brain evaluated | 14 |
| **Qualified** | **1 of 5** (Neota Logic, score 94) |
| `pages_taken` | 2 |
| Continuations | 10 (ceiling) |
| Provider runs | 33 calls, 53 ledger rows |
| Duplicate paid semantic ops | **1** |
| Orphaned paid runs | **1** (`haICm96EMNNftbtgS`) |
| Credits | 28 charged, 0 refunded |
| Final decision | `continuation_ceiling` / `round_limit_reached`, `PARTIALLY_SATISFIED` |
| Main finding | 7 fully-verified candidates blocked solely on B2B SaaS evidence |

### Comparative lineage table

| Lineage | Date | Terminal | State | Disc | Short | Eval | **Qual** | NotReached | Cred | Gen |
|---|---|---|---|---|---|---|---|---|---|---|
| `862e81be` | 08-30 07:25 | round_limit_reached | **SATISFIED** | 50 | 21 | 10 | **5** | 11 | 23 | **30** |
| `74de044e` | 09-01 02:38 | round_limit_reached | PARTIAL | 50 | 21 | 7 | 0 | 27 | 15 | 10 |
| `ecb9afe9` | 09-01 07:16 | round_limit_reached | PARTIAL | **150** | 59 | 12 | 0 | 95 | 31 | 10 |
| `e01ad74f` | 09-01 07:53 | round_limit_reached | PARTIAL | 99 | 43 | 7 | 0 | 60 | 20 | 11 |
| `633ad466` | 09-01 08:52 | round_limit_reached | PARTIAL | **150** | 62 | 16 | 0 | 90 | 34 | 11 |
| `57b937ab` | 09-01 09:09 | continuation_required | PARTIAL | 100 | 51 | 15 | 0 | 53 | 25 | 10 |
| `e70cbf3a` | 09-01 10:30 | round_limit_reached | PARTIAL | **150** | 62 | 14 | 0 | 92 | 28 | 10 |
| `3417c428` | 09-01 10:55 | round_limit_reached | PARTIAL | 50 | 20 | 3 | 1 | 31 | 12 | 4 |
| `744644ab` | 09-01 15:57 | continuation_required | PARTIAL | 90 | 48 | 13 | 1 | 48 | 28 | 11 |
| **`a5c1616e`** | **09-02 15:01** | **round_limit_reached** | **PARTIAL** | **99** | **51** | **14** | **1** | **55** | **28** | **12** |

`862e81be` — the **only** SATISFIED run — reached **generation 30**, roughly triple every subsequent run. Every run since has stopped at generation 10–12 against `DEFAULT_MAX_CONTINUATIONS = 10`. This is worth flagging: the one successful acceptance in the record ran under materially more continuations than the current ceiling permits.

> **Note:** lineage `862e81be` was still present; `ecb9afe9`, `57b937ab` and `744644ab` were all retrievable and are included above.

### Fresh acceptance run — deliberately NOT executed

The brief permits one fresh run "if the latest backend fixes are deployed and it is safe to do so." The fixes are deployed — **and `a5c1616e` already is that run**: canonical prompt verbatim, on v164/v13, sweeper-driven, untouched, completed 15:53 UTC on the audit date, roughly an hour before this audit began.

Re-running would spend ~28 credits and ~$0.60 to reproduce a result whose limiting factor is deterministic (the evaluator cannot prove B2B SaaS from evidence never collected), and would likely mint a second orphaned provider run. Because that is a real-money, outward-facing action with a predictable outcome and equivalent evidence already in hand, it is **left to the user's explicit go-ahead** rather than taken unilaterally.

---

## 16. Test Coverage

Executed on this audit, current HEAD:

| Suite | Command | Result |
|---|---|---|
| Edge functions | `deno test --allow-read --allow-env --no-check tests/edge-functions/` | **6645 passed, 0 failed, 0 ignored** (25s) |
| Infra / deploy safety | `deno test --allow-read --allow-env --allow-run tests/infra/` | **32 passed, 0 failed** (589ms) |
| Typecheck | `deno check run-agent/index.ts resume-stalled-leads/index.ts` | **clean, 0 errors** |

**Total: 6677 passed, 0 failed, 0 skipped, no baseline errors.** No frontend code was modified.

Named suites confirmed present and passing: `adaptiveDiscoveryYield`, `discoveryReplenishmentReopen`, `replenishmentAvailabilityAndPages`, `continuationRouteAndLifecycle`, `enrichmentBatchNotRepurchased`, `adoptedRunIsNotResurrected`, `missionEvaluationSurvivesResume`, `enrichedGeographyIsPopulated`, `qualificationDebtIsPaidFirst`, `brainDecisionsAreProgress`, `pendingRunOutranksBarren`, `stalledLeadResume`, `schemaDrift`.

**Caveat on interpretation:** the suite is large and green, but every defect in §17 is live in production *with* these tests passing. Green tests here mean "no regression in the modelled paths", not "the mission works". The defects found are at seams the tests do not model: ceiling-vs-pending-run interaction, cross-slice provider re-dispatch, and stage attribution in the funnel.

---

## 17. Known Remaining Defects

| # | Defect | Severity | Status | Evidence |
|---|---|---|---|---|
| **D1** | **B2B SaaS unprovable** — no business-model evidence is ever collected; 7 fully-verified candidates refused | **Critical** | Open | §11, `mission_evaluation` for Metaview/Hebbia/Kody/… |
| **D2** | **Orphaned paid provider run** — ceilings do not defer to pending runs; run SUCCEEDED 2m36s post-termination, 363 rows discarded, 1 credit charged | **High** | Open | §6, Apify `haICm96EMNNftbtgS` |
| **D3** | **Funnel `unaccounted ≠ 0`** — `company_brain: 51→14 UNACCOUNTED=37` | **Medium** | Open | §18, edge logs (20 UNACCOUNTED lines) |
| **D4** | **Duplicate paid provider execution** — 1 semantic op ran twice on Apify (credits protected) | **Medium** | Open | §7, runs `nGEBzzCNDGHVVKD1G` / `rxa40AIIFs9Vqm6nH` |
| **D5** | **Frontier under-counts `hiring: evidence_unavailable`** — latent false `frontier_exhausted` path | **Medium** | Latent | §12, 10 companies |
| **D6** | **`lead_lineages.status` / `terminal_reason` never written** — NULL for every lineage incl. terminated | Low | Open | §8 |
| **D7** | **Model spend unlogged** — `lead_model_calls` has 1 row since 2026-08-25 | Low | Open | §7 |
| **D8** | **Triage yields no positive signal** — 0 `relevant` of 99; blind to geography | Low | Open | §5 |

### D3 detail

Full funnel for the final slice:

```
discovery:             99→99
mission_intelligence:  99→81  excluded=18
smart_shortlist:       81→51  excluded=30
identity_resolution:   51→51
enrichment:            51→51
company_brain:         51→14  UNACCOUNTED=37   ← the only unbalanced stage
mission_evaluator:     14→1   decided=3 withheld=10
persistence:            1→0   withheld=1
```

Every other stage balances exactly. The 37 are the hiring-refuted (27) and evidence-unavailable (10) — they are *known*, not lost, but `company_brain` attributes them to no bucket. **Smallest likely fix (NOT IMPLEMENTED):** attribute them as `withheld` with reasons `hiring_refuted` / `hiring_evidence_unavailable`, which is what they factually are. This is an accounting change only and must not alter which companies are evaluated.

---

## 18. Reliability Risks

1. **The evidence bar is stricter than the evidence pipeline.** The evaluator is well-built and honest; it is being asked to certify a property nothing collects. Every mission phrased with a business-model qualifier ("B2B SaaS", "fintech", "PLG") will under-deliver in the same way.
2. **Ceilings are absolute and do not settle in-flight work.** Any lineage that reaches `continuation_ceiling` with a pending run loses that run and its credit. Frequency is proportional to how often job searches exceed the ~90s wait cap — 4 of 19 in this run (21%).
3. **The one historically successful run used ~3× the current continuation budget.** `862e81be` reached 5/5 at generation 30. Every run since caps at 10–12. Whether 10 is the right ceiling is an open product question, not a defect — but the evidence suggests the current ceiling is binding on success.
4. **Green tests do not track these failures.** All four material defects coexist with 6677 passing tests.
5. **`hiring: evidence_unavailable` is treated as terminal in practice** despite being explicitly documented as non-terminal, creating a latent false-exhaustion path.

---

## 19. What Is Fully Proven

**PRODUCTION PROVEN — no further work needed:**

- Autonomous sweeper-driven continuation with **zero manual continues** (20 cron ticks, 10 continuations, 1 task row, 11 checkpoints).
- **Checkpoint survival across resume** — `enriched`, `mission_evaluation`, `hiring_assessment`, `investigation_state` all restored.
- **Adaptive replenishment** — frontier 0 → 27 via `replenishment_required`; 50 → 100 → 150 pool expansion across lineages.
- **Provider run adoption** — 3 of 4 timed-out runs adopted on later slices at zero extra cost.
- **Geography as real presence, not HQ** — 51/51 populated; Metaview exactly as specified; Como/PostGrid non-HQ UK offices retained and cited as evidence.
- **Credit idempotency** — 28 operations, zero double charges, no key charged twice.
- **No false `no_progress`** — `barren_slices: 0` throughout; pending runs outrank barren in both deciders.
- **Page-cursor honesty (R2)** — derived from committing outcomes, cannot drift.
- **Exact employee-size semantics** — 30 excluded on `employee_size`; counts cited against the band.
- **Wall-clock survival** — 51m34s across 12 generations.
- **Qualified-lead persistence** — Neota Logic → `accounts` @ 15:39:48, visible in the Lead Library.
- **Truthful terminal reporting** — `continuation_ceiling` with frontier and counts stated.

---

## 20. What Is Not Yet Proven

- **That the canonical mission can return 5/5 on the current build.** It has not, in any run since 2026-08-30.
- **That `duplicate paid semantic operations = 0`** — currently 1 per run.
- **That no paid run is orphaned** — currently 1 per run.
- **That `unaccounted = 0`** — currently 37.
- **Stage 0 feasibility and truthful preview** — not exercised in this audit (**ASSUMED / NOT PROVEN**).
- **Behaviour when Apify itself fails hard** (non-timeout `failed`) — no such rows in the audited window.
- **Refund semantics** — `refunded_credits` is 0 everywhere; no refund path was observed executing.
- **`decision_maker` capability** — 10 ledger rows, 297 raw, **0 accepted**; never produced a contact. Unexplained, not investigated.

---

## 21. Required Next Work

In priority order. **None of this was implemented during the audit.**

1. **Close the B2B SaaS evidence gap (D1).** Either add a business-model classification step over the already-collected `description` + `website`, or explicitly lower the bar to corroboration-at-confidence. Requires a product decision on truthfulness vs yield. *Highest value: alone, this plausibly turns 1/5 into 5/5.*
2. **Settle pending runs before any ceiling terminal (D2).** One free adoption pass over `pendingRuns` before emitting `continuation_ceiling` / `cost_ceiling`. Preserves the bound; recovers the paid work.
3. **Balance the funnel (D3).** Attribute Brain-stage non-evaluation to `withheld` with hiring-based reasons.
4. **Eliminate the last duplicate dispatch (D4).** Trace why a restored batch re-reaches the provider instead of short-circuiting `skipped_idempotent`.
5. **Decide whether `evidence_unavailable` belongs in the frontier (D5).** Closes the latent false-exhaustion path.
6. **Revisit `DEFAULT_MAX_CONTINUATIONS = 10`** in light of `862e81be` succeeding at generation 30 — as a deliberate product decision, not a quiet bump.
7. **Write `lead_lineages.status` / `terminal_reason` (D6)**; **log model spend (D7)**; **fix or retire triage (D8)**.

---

## 22. Production-Readiness Checklist

| Capability | Status | Basis |
|---|---|---|
| Runs autonomously, zero manual continues | ✅ | PRODUCTION PROVEN |
| Survives Edge wall-clock limits | ✅ | PRODUCTION PROVEN |
| Checkpoint restores all semantic decisions | ✅ | PRODUCTION PROVEN |
| Adaptive replenishment | ✅ | PRODUCTION PROVEN |
| Resumes after provider delays | ✅ | PRODUCTION PROVEN (3/4) |
| Geography = real UK presence, not HQ | ✅ | PRODUCTION PROVEN |
| No user-facing double charge | ✅ | PRODUCTION PROVEN |
| No false `no_progress` | ✅ | PRODUCTION PROVEN |
| Truthful terminal reporting | ✅ | PRODUCTION PROVEN |
| Qualified leads persist to Lead Library | ✅ | PRODUCTION PROVEN |
| Test suite green | ✅ | 6677 / 0 |
| Zero duplicate paid provider executions | ❌ | 1 per run |
| Zero orphaned paid provider runs | ❌ | 1 per run |
| `unaccounted = 0` | ❌ | 37 |
| **Returns 5 qualified when evidence exists** | ❌ | **1 of 5; 7 candidates blocked on B2B SaaS** |

---

## 23. Final Grade

### **C — CORE WORKS, MATERIAL RELIABILITY GAPS REMAIN**

The autonomous execution substrate is finished: it continues itself, replenishes, adopts paid work, checkpoints faithfully, bills once, and stops honestly. That is the hard part and it is done.

What is not done is the **evidence layer the qualification bar depends on**. The system currently finds the right companies, verifies their geography, size and hiring — and then cannot certify the one attribute the mission names. Add one confirmed orphaned paid run, one duplicate paid execution, and an unbalanced funnel, and the result is a backend that is reliable in its mechanics and unreliable in its outcome.

Not D: it never lies, never falsely terminalizes, never loses state, never double-charges.
Not B: the headline promise fails on the canonical mission with the evidence sitting in the checkpoint.

---

### Explicit answers

| Question | Answer | Evidence |
|---|---|---|
| Can a normal user give Agentory a lead mission and trust it to finish autonomously? | **YES** | 20 cron ticks, 10 continuations, 1 task row, zero manual intervention (§14) |
| Can it return 5 qualified companies when enough evidence exists? | **NO** | 7 verified candidates available, 1 returned; blocked on B2B SaaS (§9, §11) |
| Can it truthfully stop when enough companies do not exist? | **PARTIAL** | Stops truthfully, but on `continuation_ceiling` — a budget bound, not evidence exhaustion. Never reached genuine `frontier_exhausted` (§13, §14) |
| Can it replenish automatically? | **YES** | frontier 0→27; 50→100→150 across lineages (§5) |
| Can it resume after provider delays? | **YES** | 3 of 4 timed-out runs adopted free on later slices (§6) |
| Can it avoid duplicate spend? | **PARTIAL** | Credits: YES, zero double charges. Provider executions: NO, 1 duplicate run (§7) |
| Can it survive Edge Function wall-clock limits? | **YES** | 51m34s across 12 generations, 11 checkpoints (§8) |
| Can it restore all important semantic decisions? | **YES** | `enriched`, `mission_evaluation`, hiring, investigation state all restored (§8) |
| Can it handle UK presence correctly? | **YES** | 51/51 populated; non-HQ London offices retained and cited (§10) |
| Is B2B SaaS evidence reliable enough? | **NO** | Never collected; 7 of 14 refused on it alone (§11) |
| Are there current known paths to false `no_progress`? | **NO** (for `no_progress`) / **PARTIAL** (exhaustion) | `barren_slices: 0` throughout; pending runs outrank barren. But D5 is a latent false `frontier_exhausted` path (§12, §13) |
| Are there current known paths to orphaned provider runs? | **YES** | Confirmed: `haICm96EMNNftbtgS`, 363 rows, SUCCEEDED 2m36s after termination (§6) |
