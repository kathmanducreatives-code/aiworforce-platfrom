# Discovery repair after canary session 2 (Contract 2)

GitHub Actions run `41051862651`, queue `763fc2b9-63fb-40be-a3d0-0cd3dded59b1`,
task `25906701-391b-474a-820b-f4af4174cf5e` (isolated TEST project). Mission:
"Find one US company hiring Account Executives that raised funding within the
last six months." Three companies were discovered (LangChain, Baseten,
Oscilar), all were held as pending, and Atomus never ran.

Everything below is backed by the run's own records. The run's checkpoint is
replayed offline in `tests/replay/historical/N_canarySession2Contract2.test.ts`
(fixture `tests/replay/fixtures/canarySession2.contract2.json`). No provider
was called and no hosted data was changed.

## Root-cause map

| # | Defect | Component | Effect in Contract 2 |
|---|---|---|---|
| 1 | GPT repeated the hiring signal in `hard_constraints` (`hiring currently_hiring "Account Executives"`). It compiled to a second HARD criterion with dimension `constraint`, which no evidence dimension answers. | `missionCriteria.deriveMissionCriteria` | Every candidate kept an unknown hard check with no route. `canStillQualify` was false for all three, so the funding verifier never targeted anyone. |
| 2 | The same restatement for the funding window (`funding_event announced_within_last_days 180`). | `missionCriteria` | A redundant target `constraint` row. |
| 3 | A hard `constraint` compiled as status `ok`. The D7 gate and the approval card therefore called it provable. | `missionCriteria`, `demoFundingJudge` D7 | D7 PASSED an impossible requirement. |
| 4 | The company-details route counted ANY `"linkedin"` source as "details already answered". The evidence registry gives that label to every LinkedIn-derived field, including the company object inside a job-search row. | `evidenceGapRouter` `LINKEDIN_DETAILS.evidence_actors` | Baseten and Oscilar were never enriched. Their headquarters gap still showed `tried: true`, `next: blocked`. |
| 5 | An evaluator abstention ("unknown", which asserts no fact) lowered a check that a registered authority rule had proved. | `candidateEligibility.evaluateEligibility` | LangChain's company record flagged exactly one HQ (San Francisco, United States; `li_record_flagged_headquarters`, proven). The model hesitated over the office list, and the proven pass became unknown. |
| 6 | A failed evaluator call (the binding returns `null`) was parsed into an "evaluation" with an `unknown` row per criterion (`origin: "unparsed"`). The engine recorded it as `model_evaluated`. | engine qualification branch, run-agent telemetry | Oscilar's checks all read `not_an_object`, including its proven hiring. Telemetry said 3 companies were evaluated. |
| 7 | The spend gate's refusal is an HTTP response. `gptProvider` called it `http_error`, and a 503 "purchase may exist" refusal counted as transient (retryable). | `gptProvider` | Oscilar's call was the contract's 4-attempt limit, misreported as an OpenAI failure. |
| 8 | Contract 2 bought a pool of 3 but allowed company details for 1 and 4 worker model calls (plan + pool evaluation + 3 evaluations = 5 needed). | canary contract | One company enriched; the third evaluation refused. |
| 9 | `prepareKickoff` hard-coded `max_candidates: 3` for the canary, independently of the catalog's gate-pinned `maxItems`. The gate REFUSES (does not clamp) a larger request. | `prepareKickoff` | Latent: any narrower catalog would have had its first purchase refused. |
| 10 | The Replay Lab's "verbatim" copy of run-agent's verification-candidate builder had lost the evaluator verdicts and holds. The source pins did not cover that line. | `tests/replay/lib/prod.ts` | No replay could reproduce defect 5 or 6. |
| 11 | The only record of why the verification phase skipped a candidate was a worker console line, and those lines are kept off the public log. | run-agent | The investigation had to reconstruct the decision from code. |

## Fixes

| Fix | Proven by |
|---|---|
| `restatesHiringSignal` and `restatesFundingWindow`: a `hard_constraints` entry is skipped ONLY when a closed list matches the field and operator AND the value is the same (role terms or window days). Different roles, windows, amounts, operators and exclusions are kept. | `canarySession2Interpretation.test.ts`; replay N "criteria today" |
| A stated hard `constraint` compiles as `unprovable_today`. It is disclosed at approval (`assessRequestFeasibility` constraints) and is answerable only by the evaluator citing the company's own words. D7 also fails a hard `constraint`. | "a genuinely DISTINCT stated requirement…", D7 tests |
| `LINKEDIN_DETAILS.evidence_actors = ["apify_linkedin_company_details"]`. A fetched record is still seen through its own actor and `attemptedRoutesOf` (an answered enrichment). | router unit test; replay N Baseten; Phase C tests now pass the production attempted set |
| `authorityResolvesAbstention`: a genuine abstention cannot lower a pass proved by a registered authority rule unless a proven item disagrees. Fail, downgraded and unparsed verdicts still lower it. Interpretive dimensions and funding (which has its own rule) are excluded. | replay N LangChain + controls |
| `evaluatorAnswered`: a failed call takes the never-evaluated path (`model_unavailable`) and stores no fabricated rows. Run-agent counts `calls_failed` separately. | Q4.9b (engine), replay N Oscilar |
| `admission_refused` failure code: never retried, never repaired, never escalated to a dearer model. | `gptProvider.test.ts`, `gptCompletionAdmission.test.ts` |
| Contract checks A10 (worker attempts ≥ 2 + pool) and A11 (details units ≥ pool). S18 pins the engine's pool to the gate's job count. `maxCandidates` is derived from the catalog. | `tests/infra/canarySession.test.ts` (Contract 2 now fails exactly A10/A11) |
| `verifiableCandidatesFrom` moved into the engine. Run-agent and the Replay Lab call the same function. | replay N; `qualificationAuthority` callers |
| `verificationDecisions`: every candidate × verifier, with the reason, persisted as `capability_execution_state.verification_decisions`. | replay N "decision trace" |

All 11 defects were re-injected one at a time (fault injection). Each made at least one of the tests above fail.

## Offline replay of Contract 2 (repaired code)

| Company | Headquarters | Hiring | Funding | Next step |
|---|---|---|---|---|
| LangChain | **pass** (company record, flagged HQ San Francisco, US) | pass | unknown | **Atomus targeted** |
| Baseten | unknown: only a job-row location, which is not HQ evidence | pass | unknown | company details first (`cheap_stage_first`), then Atomus |
| Oscilar | unknown | unknown (its only evaluation failed) | unknown | `cannot_still_qualify` (see open decision) |

Nothing qualifies offline. No funding round was ever fetched, and none is
assumed. Continuation now sees 2 executable verification routes, where the
run reported `frontier_exhausted`.

## Second pass (verification and readiness)

| # | Defect found | Fix | Proven by |
|---|---|---|---|
| 12 | A company whose only evaluator call FAILED was never evaluated again: the placeholder was restored as a decision. Q4.9 deliberately asserts that a resume evaluates nothing. | `LEAD_REEVALUATE_FAILED_EVALUATION=on` (default **off**) re-asks **once**, and only for a call that was made and failed (`evaluation_failed` mark). It never applies to "no evaluator", budget exhaustion or a timeout (`null`). A second failure is marked `evaluation_retried` and restored. | `failedEvaluationRetry.test.ts` (Q4.9 holds with the flag off and on) + 4 fault injections |
| 13 | Old runs showed a hard `constraint` no evidence could answer as `PENDING`, as if evidence might still come. | `readMissionView` marks the exact pre-repair shape `legacy_unverifiable`; the Workbench line reads "NOT VERIFIABLE …". Stored history is unchanged. | `workbenchCanonicalView.test.ts` (Contract 2's stored LangChain checks) |
| 14 | The kickoff preparer hard-coded Contract 2's catalog, the stage hard-coded its prices, and the validator hard-coded K11 (`=== 4000/4050/10550`), K12 (`=== 18600`) and K17. A narrower Contract 3 could never run, and its session would have stopped (fail-closed) at S08 and K11. | The contract names its catalog (`catalog`). The stage derives prices from the contract and the catalog. A12 requires a reviewed `smoke-catalog-canary-funding*.json` path whose maxima and pinned units equal the contract's. K11/K12/K17 read the catalog, with Contract 2's figures as hard ceilings. | `canarySession.test.ts`, `canaryWorkflow.test.ts`, `local-rehearsal.sh` |
| 15 | When a contract omitted an actor, the stage defaulted that actor's price to Contract 2's figure, not the named catalog's. The session was refused at K11 instead of S06. | `max_of` falls back to the contract's own catalog. | `local-rehearsal.sh` (`session-plan-outside-contract` now fails at S06, as asserted) |
| 16 | `contractChecks` threw on a `null` actor entry instead of failing A05. | A05 tolerates and refuses a malformed entry. | `canarySession.test.ts` |

### Verified, no defect

- **Continuation slices.** The execution plan is reused from the checkpoint (re-validated, never re-bought), and pool evaluation is restored. A slice adds GPT calls only for companies it actually evaluates, so A10's "2 + pool" holds across slices. A company left `enrichment: not_started` reopens company enrichment (`capabilityStillOwed`). C3-7 resumes after discovery and buys each actor once.
- **Atomus without Pvalyou.** Checked on the real 2026-09-21 Atomus payload. Atomus alone PASSES a dated round inside a 180-day window and FAILS a complete history with nothing in it. No record at all stays PENDING. STAGE still needs the cited pair; recency does not (`contract3FundingLive.test.ts`).

## Contract 3: offline rehearsal

1. **Engine** (`contract3Rehearsal.test.ts`): the Contract 3 mission, the real Contract 2 GPT proposal, the real engine and verification phase, and Pvalyou unavailable. Every purchase passes through the gate's own `classifyRequest` and `boundRequest` with Contract 3's catalog (`maxItems: 1`, one company per start).
   - Proven US HQ + AE posting + a round 40 days ago → 1 qualified. Exactly one start of each of jobs, details and Atomus; no Pvalyou; inside 9600 µ$.
   - A US job at a Canadian-HQ company → ineligible, and no Atomus is bought.
   - Empty company details → pending, and no Atomus is bought.
   - A 300-day-old round → ineligible after one Atomus start.
   - No funding record → pending.
   - A failed evaluator → nothing qualifies.
   - An interrupted slice → resumed, with each actor bought once.
2. **Stages** (`scripts/test-project/canary/local-rehearsal.sh`, local Postgres 17 + the fake Apify): all 49 stage runs as expected, with no secret in any output.
   - Every session variant is built on Contract 3, and the session reaches READY FOR THE WORKER.
   - A narrower contract stops at S06.
   - A wider one, Pvalyou and an expired contract stop at A03/A05.
   - Run receipts within the cap reconcile; over-cap and wrong-actor runs stay open.
   - NO_RUN is concluded only on its two records.

## Open product decision

Whether to turn on `LEAD_REEVALUATE_FAILED_EVALUATION` for the TEST worker. It is off; Contract 3 is sized so that its one evaluation has its own attempt (A10), and gptProvider already retries transient HTTP errors within a call.
