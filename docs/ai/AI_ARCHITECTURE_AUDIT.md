# Agentory AI architecture audit — interpretation, capability awareness, model routing

Audited at `121d8e1` (Candidate C head, PR #194). This branch is stacked on it, and every behavioural
change sits behind a flag that is **off by default**. With both flags unset, compiled missions are
byte-identical to `121d8e1` (verified on 3,000 generated GPT wordings, 873 production-style requests
and every earlier review probe set). The agency-only A7 TEST and its I1–I9 gate are unaffected.

| Flag | Default | Effect |
|---|---|---|
| `AGENTORY_GPT_MODEL_FAMILY` | `gpt-5.6` | `gpt-6` routes Luna → `gpt-6-luna`, escalation → `gpt-6.1-sol` |
| `AGENTORY_MISSION_CONTRACT` | `v1` | `v2` adds per-signal timeframes, capability availability and a cache-friendly payload |

Offline report: `deno run --allow-read --allow-env scripts/model-routing-eval/interpretationEval.ts`.

---

## 1. What runs where (measured from code)

| Work | Product name(s) | Model | Selected by | Fallback |
|---|---|---|---|---|
| Mission compilation | (lead pipeline) | `gpt-5.6-luna`, effort `low` | `gptModelRouter` | Retry on the same route (pilot-chat `MAX_COMPILATION_ATTEMPTS`). No deterministic or Claude substitute: refusal instead |
| Chat request understanding | Pilot | `gpt-5.6-luna` low → `gpt-5.6-terra` | router, `chatBrain` | Clarification on provider failure |
| Discovery selection, execution plan, amendments | Atlas (discovery) | `gpt-5.6-luna` low | router / strategist config `LEAD_STRATEGIST_*` | Strategist primary/escalation tiers |
| Triage, evaluation, qualification, pool, grounded evidence, extraction, planning | Atlas (qualification) | `gpt-5.6-luna` effort `none` | router | None (degrades to `uncertain`) |
| Signal relevance | Lyra (Signal Scout) | `gpt-5.6-luna` low → `gpt-5.6-terra` | router; the only production escalation | Deterministic cluster |
| Pilot chat, orchestration plan, agent execution (content), Company Brain analyse/follow-ups | Pilot / Orion / Mira ("Lisa") / Company Brain | `claude-haiku-4-5-20251001` | `aiProvider.TASK_MODELS` | `gpt-4.1-mini` for `tool_input_planning` and `helper` only |
| Strategist fallback model | — | `gpt-4.1` (`gptProvider.GPT_MODEL`) | `modelForTier` | — |

**Findings**

* **The Luna → Terra repair ladder (`runWithEscalation`) has no production caller.** Only
  `signal_relevance` escalates, through its own code. Mission compilation *retries* on Luna; it does not
  escalate.
* **There are three AI-employee rosters, and they disagree.**
  * The product registry (`src/config/agentRegistry.ts`): Pilot, **Lyra** (Signal Scout), Atlas,
    Mira (Message Strategist), Orion (Pipeline Operator).
  * The landing page shows Mira as **"Lisa"**.
  * The briefing sent to GPT (`agentoryBriefing.AGENTORY_AGENTS`) names **"Nova"**, who exists
    nowhere else.
  * The brief that prompted this audit describes yet another mapping: Orion = planning,
    Lisa = signals, Lyra = content.

  Not changed here: renaming roles is a product decision. *Blocker 4.*
* **Company Brain context reaches the mission compiler twice**: once in the briefing
  (industries and size) and once as `company_brain_context` (all fields). About 0.3k characters, so
  low priority.
* **Telemetry is already per call**: model, effort, input/cached/output tokens, latency and estimated
  cost (`buildModelTelemetry`); escalation reasons are recorded in `EscalationRecord`. Requirement 8
  was already met.

## 2. Prompts the mission compiler receives (measured)

The mission compiler receives one JSON payload: about 16.7k characters, roughly 4.2k tokens. Largest parts:
* `capability_catalogue`: 6.5k characters (39%)
* `agentory_briefing`: 4.2k
* `instruction`: 2.4k
* `response_shape`: 1.8k

The strict schema adds another 6.8k characters.

* **No credential, workspace id, provider, Actor or price is in it** (asserted by existing tests and by
  the new capability-context test).
* **In v1 the user's sentence is the 4th key**, so about 9k characters of fixed text follow it and
  cannot be served from the prompt cache. v2 puts it last.

## 3. Confirmed causes of previous interpretation failures

| Failure | Origin | Evidence |
|---|---|---|
| Run 1 A7: I2, I5, I6, I7 | **Compiler** | The proposal's meaning was right; the compiler split "B2B software", lost the role term, duplicated constraints and kept prose broadening (PR #194 commit 3ff911d, real proposal reproduced offline) |
| W1 (missing hiring window) | **Contract + compiler** | v1 has one `signal_recency_days`; when GPT omitted it, the runtime got `null` while the criterion displayed a default 30 |
| R1 (funding/tenure window read as hiring) | **Compiler heuristic** | `statedHiringWindowDays` reads any number after the hiring clause ("funding closed within 6 months" became 180, "joined within 90 days" became 90) |
| R2 (late hiring signal without window) | **Compiler ordering** | `compileMissionSemantics` adds the user's hiring signal *after* the window step |
| Windows rewritten 3 times | **Architecture** | The model's single window, C's hiring regex and the semantics pass's own sentence reader (`window_days_by_kind`) each rewrite signal windows in sequence |
| T8 "AE roles posted less than 30 days ago" read as a social *post* | **Signal reader** (`readSignalPhrase`) | New finding (call it MC-9). Fails under v1 *and* v2; not changed here |
| 2026-08-17 "AI startups" became B2B SaaS | **Wiring** (no model ran; regex + Company Brain) | Documented in `gptMissionModel.ts` |

**No confirmed failure originated in GPT's semantics.** The one real GPT proposal on file (A7 run 1) was
right in meaning. Every confirmed failure is in the contract, the compiler, the reader heuristics or
the wiring. The synthetic eval inputs in this repo are not model failures and are not counted as such.

## 4. Capability awareness

| Layer | Exists in code | Shown to GPT (v1) | Shown to GPT (v2) |
|---|---|---|---|
| 1. In the codebase | `leadCapabilityCatalogue` | ✅ description | ✅ |
| 2. Engine can execute it | `capabilityExecutability` | ❌ | ✅ `availability` |
| 3. Needs user approval | offers (`kind: offer`) | partly, in prose | ✅ `offer_requires_user_approval` |
| 4. Can spend credits | catalogue `paid` | ❌ | ✅ `may_spend_credits` |
| 5. Enabled for the workspace / credentials / authorised for this mission | `integrationReadiness` (secret *presence*), Lead V2 flags, `providerAvailability`, credit authorisation | ❌ | ❌ **deliberately**: per workspace and vendor-specific; enforced by code where money moves |

v1 offers GPT `technology_evidence` and `company_post_evidence`, which the engine cannot execute, and
`expansion_evidence` and `product_launch_evidence`, which can only *verify*, not discover. They are
offered on equal footing with working capabilities. `capabilityExecutability`'s own header records a
run where this produced an empty pool that was reported as satisfied.

Apollo and LeadOcean are not on this lineage; they live in PR #195, which is not touched here. When it
lands, its capabilities join through the same catalogue and executability tables, not through prompt
text.

## 5. Implemented on this branch (low risk, flag-gated)

1. **GPT-6 compatibility.**
   * The request builder sends gpt-6 the reasoning-model shape. Before this it fell through to the
     gpt-4.1 body: `temperature` and `max_tokens`, no `reasoning_effort`.
   * `gpt-6.1-sol` never receives `reasoning_effort: "none"`, which it rejects.
   * Both GPT-6 models are priced **before** they can be routed to. An unpriced model counts $0
     against the spend ceiling.
2. **Configurable Luna-first routing** (`AGENTORY_GPT_MODEL_FAMILY`). The policy is unchanged: the
   same stages escalate, on validator rejection only, one rung only. A typo falls back to the
   default. Routes on a non-default family record `model_family`.
3. **Bounded escalation per run** (`EscalationBudget`). Optional and shared across a run's stages.
   When spent, a rejected result fails safely with `escalation_budget_exhausted` instead of
   escalating.
4. **Interpretation contract v2.**
   * The model writes each stated timeframe under its own signal (`signal_windows`), quoting the user.
   * Code refuses quotes not in the request, unknown events and company-age windows, and computes
     the days itself.
   * A signal with no window gets none.
   * C's hiring regex and the semantics reader are *recorded* where they disagree, never applied.
   * Every decision is in `validator_changes` and in `interpretation_trace`, which traces each
     timeframe from the request to the runtime signal.
5. **Dynamic capability context** (v2). Availability is derived from the code-owned executability
   table, with an instruction to report a dependency on an unavailable capability in `unknowns`.
6. **Cache-friendly payload** (v2). All fixed parts come first and the request comes last.
7. **Reusable offline evaluation.**
   * `interpretationCorpus.ts`: 9 cases, 5 seeded model errors.
   * `interpretationEval.ts`: compiler-versus-model errors, routing tables, cost.
   * Tests `missionContractV2.test.ts` (25) and `aiModelFamilyRouting.test.ts` (8).

Not implemented, because there is no evidence of a problem or the risk is too high for this branch:
* changing the Claude task models
* renaming AI employees
* fixing MC-9
* wiring mission compilation into the escalation ladder
* prompt changes to the two large planning prompts (see §8)

## 6. Offline evaluation results

| | v1 (today) | v2 |
|---|---|---|
| Correct proposal → correct runtime windows (9 cases) | **3/9** | **8/9** (T8 = MC-9, a reader defect) |
| The example from the brief: "hiring AEs whose funding closed within six months" | hiring **30** (a default the user never stated), funding 180 | hiring **none**, funding **180** ✅ |
| Seeded model errors code can catch (wrong days, invented window, age-as-funding) | not expressible | **3/3 caught and recorded** |
| Model errors code cannot see (right words on the wrong signal; omitted window) | — | 2: passed through, documented, measured only by a live comparison |
| Structured output | v1 schema unchanged | v2 schema strict, `signal_windows` required |
| A7 runtime (hiring 30, Account Executive) | ✅ | ✅ identical |

## 7. Recommended routing (GPT-6 family, after the live comparison confirms it)

| Task | Model / effort | Escalation |
|---|---|---|
| Mission compilation, request understanding | `gpt-6-luna` low | `gpt-6.1-sol` low, **only** on a validator rejection, at most once, within the run budget |
| Discovery selection, execution plan, amendments | `gpt-6-luna` low | `gpt-6.1-sol` low via the repair stages |
| Triage, evaluation, qualification, extraction, evidence planning, summaries | `gpt-6-luna` none | none: an undecidable verdict is already a handled outcome |
| Pool ranking | deterministic | — |
| Filtering, dedup, dates, validation, accounting, credits | code | — |
| Run escalation budget | 3 per run (proposed) | `escalation_budget_exhausted` beyond it |

Official prices, from the OpenAI model pages read 2026-10-28:

| Model | Input / cached / output per 1M tokens | Reasoning effort | Notes |
|---|---|---|---|
| `gpt-6-luna` | $0.10 / $0.01 / $0.50 | `none`–`max`, default `medium` | Chat Completions function calling only at effort `none` |
| `gpt-6.1-sol` | $2 / $0.10 / $10 | `low`–`max` (**no `none`**) | 2× input / 1.5× output above 272K input tokens; tools need the Responses API |

Sol is **cheaper than today's escalation model**, `gpt-5.6-terra` ($2 / $12).

## 8. Estimated cost per representative mission

These re-price the recorded token counts of two real runs (`tests/fixtures/lead-v2`, harvested). A
different model emits a different number of tokens, so these are estimates, not measurements.

| Mission | Today (gpt-5.6-luna) | GPT-6 Luna-first | Sol everywhere (for scale) | Each escalation of the largest call (Sol) |
|---|---|---|---|---|
| `4250f181` (13 calls, 237k input tokens) | $0.051 | **$0.025** | $0.485 | +$0.080 |
| `1e52d43c` (43 calls, 355k input tokens) | $0.092 | **$0.044** | $0.868 | +$0.079 |
| Mission compilation alone (one call) | $0.0030 | **$0.0013** (v2 with a warm cache ≈ $0.0010) | $0.027 | — |

**The largest remaining cost lever is not routing.** Plan amendments (5 calls of about 26.5k tokens
each, 20–40% cached) and discovery selection (2 calls of about 36k tokens each, **0% cached**) are
about 75% of input tokens. Making their fixed prefixes stable and leading is the next saving; it was
not changed here.

## 9. Capped live comparison plan (NOT executed; needs separate approval)

* **Prerequisite.** `run.ts --live` is "authorized but not implemented". Implement it with a
  pre-flight cost cap that refuses to start once the plan's ceiling is reached, and record per-call
  telemetry in the existing `[model-telemetry]` format.
* **Stage.** Mission compilation only; it is the decision every later stage inherits.
* **Inputs.**
  * The 9 interpretation cases
  * The A7 request
  * The 7 `corpus.ts` cases
  * The real run-1 A7 request

  18 requests in total.
* **Arms.**

  | Arm | Model | Effort | Contract |
  |---|---|---|---|
  | A | `gpt-6-luna` | low | v1 |
  | B | `gpt-6-luna` | low | v2 |
  | C | `gpt-6-luna` | medium | v2 |
  | D | `gpt-6.1-sol` | low | v2 |

  Three repeats each: 18 × 4 × 3 = **216 calls**.
* **Cap.**
  * Estimated cost: about 162 Luna calls at ≈$0.0014 (≈$0.23) and 54 Sol calls at ≈$0.028
    (≈$1.51), **≈$1.74 in total**.
  * Hard stop at **$3.00**. Use a TEST-project key with its own OpenAI usage cap.
  * No provider calls, no worker, no database.
* **Scoring** (all offline, from the saved outputs):
  * `interpretationCorpus.evaluate`, which separates model errors from compiler errors: a correct
    proposal that compiles wrongly is the compiler's fault.
  * `checkMissionInvariants`.
  * The I1–I9 judge on A7.
  * Structured-output validity rate, latency, tokens and cost.
* **Decision rule.** Move a stage to Luna effort `low` only if Luna's error rate on that stage is
  within one case of Sol's and its validity rate is 100%. Escalate to Sol only on validator
  rejections, never by default.

## 10. Remaining blockers before enabling

1. **v2 has one omission path code cannot see**: GPT leaves out a stated window (T2-E). Before
   enabling v2, wire `hiring_window_reader_disagrees_with_contract` (and the semantics reader's
   equivalent) as a **validator rejection** in a production escalation path. That means mission
   compilation through `runWithEscalation` with the run's `EscalationBudget`, so one bounded Sol
   re-read resolves the disagreement instead of an unconfirmed regex.
2. **Live comparison** (§9): needs approval and the `run.ts --live` implementation.
3. **The TEST gate on v2**: I9 is unchanged and checks the runtime window. Any future paid TEST on v2
   needs its own review; this branch must not reach the A7 TEST.
4. **AI-employee roster**: a product decision on Lisa/Lyra/Mira/Nova/Orion roles before any prompt
   names them.
5. **MC-9** ("roles posted" read as a social post) and the open MC-1…MC-8 issues from PR #194's
   reviews.
6. **Stacked on PR #194.** This draft targets `test/agency-candidate-c-compiler` so its diff is
   reviewable; retarget it after #194 lands. **Do not merge it into the Candidate C branch.**
