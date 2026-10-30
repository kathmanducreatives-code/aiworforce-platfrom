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

## Open decision: re-evaluating a failed evaluation

The engine restores any company that carries a mission evaluation, the
never-evaluated placeholder included. The acceptance matrix asserts this
behaviour on purpose (Q4.9: "a resume from the final checkpoint buys and
evaluates nothing", even after an evaluator timeout). So a company whose only
evaluation failed (Oscilar) is never evaluated again, and the evaluator must
answer before it can qualify. Re-asking once on the next slice is a product
decision that would change Q4.9. It is left as it was and recorded here.

## Contract 3

`docs/launch/proposals/canary-session-contract-3.json` and
`smoke-catalog-canary-funding-3.json` are proposals that stay within every
reviewed cap: pool 1, details 1, Atomus 1, 4 worker attempts, worst case
$0.08448. They are not wired to the workflow.
