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

> **Corrected after a failed self-review of `da3c0b08`.** The first cut of contract v2 could drop or
> invert a stated requirement, advertised capabilities that cannot run, and left the escalation budget
> unwired. §11 lists each defect, its fix and its regression test. All results below are
> **self-verified by the author only**. They are not an independent review, and nothing here claims
> production readiness.

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
3. **Bounded escalation.**
   * One repair per decision, as before.
   * A **mission-level cap** under `gpt-6`: `AGENTORY_MAX_ESCALATIONS_PER_MISSION`, default 3, with
     0 disabling escalation. It is counted on the engine's checkpointed state (`escalations_used`)
     and spent by the engine's real repair rounds (`discovery_actor_selection_repair`,
     `execution_plan_repair`).
   * Past the cap, the refusal stands: discovery keeps the first selection's refusal, and the
     execution plan is blocked with `escalation_budget_exhausted`.
   * There is no cap on the default family, so behaviour there is unchanged. `EscalationBudget`
     remains an optional per-run helper for `runWithEscalation`, which still has no production
     caller.
4. **Interpretation contract v2** (only when `AGENTORY_MISSION_CONTRACT=v2`; under v1
   `signal_windows` is ignored and recorded as `signal_windows_ignored:contract_v1`).
   * **The model attributes.** It writes each stated timeframe under its signal (`signal_windows`),
     quoting the user, and names the `signal` when one event carries two windows.
   * **Code counts.** Code parses the quote: past windows only. Older-than, future, negated and
     undirected quotes are conflicts. A quote with no time expression in it is refused. Windows are
     capped at 730 days, and the cap is recorded.
   * **The reader checks independently.** The deterministic sentence reader (`window_days_by_kind`)
     is restored as an independent check:
     * The model omits a window the reader reads → the reader's window is applied
       (`window_from_reader_contract_omitted`).
     * They disagree → conflict.
     * The model puts on a signal a window the reader assigns to another signal → conflict.
   * **The R1 hiring regex is record-only**
     (`hiring_regex_disagrees_with_contract`). It is the one reader not allowed to override.
   * **Every past timeframe must be accounted for.** Every past time expression in the request must
     be quoted by a window, be a company-age or tenure window, or be carried by the reader. Otherwise
     `timeframe_unaccounted` is raised. A negated one gives `timeframe_negated`.
   * **Other conflicts.** A global `signal_recency_days` that disagrees with `signal_windows` is a
     conflict. So is a window whose signal is missing at runtime (`signal_missing_for_window`).
   * **Two windows for one event are refused.** `per_signal_windows_not_enforced_at_runtime` is
     raised because the runtime job filter (`requestedHiringFromSignals`) enforces the shortest
     hiring window on every posting. Without names, `signal_window_ambiguous` is raised.
   * **Conflicts fail closed.** Any conflict throws `MissionCompilationBlockedError`
     (`interpretation_conflict:*`) before spend. The compiler binding first spends its existing
     second call on one repair, sending the exact problems as `repair_feedback`. There is never a
     third call.
   * **Trace.** `interpretation_trace` is built from the **final** runtime signals: event, runtime
     days and source. It sits alongside every proposed window's decision.
5. **Dynamic capability context** (v2). Availability is derived from the executability table **and**
   `PRODUCTION_READINESS` over the stage's providers, with configuration by credential *presence*.
   Values are `available`, `verification_only`, `partially_available`, `not_available` and
   `offer_requires_user_approval`. Funding-event discovery, expansion and product-launch evidence are
   `not_available`: their providers are carded but not live.
6. **Cache-friendly payload** (v2). All fixed parts come first and the request comes last.
7. **Reusable offline evaluation.**
   * `interpretationCorpus.ts`: 19 cases and 16 seeded model errors.
   * `interpretationEval.ts`: compiler-versus-model errors and refusals, routing tables, cost.
   * Tests:
     * `missionContractV2.test.ts` (63)
     * `aiRoutingBudgetFixes.test.ts` (12)
     * `aiModelFamilyRouting.test.ts` (8)

Not implemented, because there is no evidence of a problem or the risk is too high for this branch:
* changing the Claude task models
* renaming AI employees
* fixing MC-9
* wiring mission compilation into the escalation ladder (its bounded repair re-asks the routed
  model; it does not escalate to Sol)
* per-signal windows at runtime (the job filter change is a separate piece of work; refused until
  then)
* prompt changes to the two large planning prompts (see §8)

## 6. Offline evaluation results

| | v1 (today) | v2 |
|---|---|---|
| Correct proposal → correct runtime (12 cases) | **5/12** | **12/12** |
| Requests that must be refused (older-than, future, negated, MC-9, per-signal, non-signal timeframe: 7) | compiled **silently** (e.g. "over 90 days ago" → 90) | **7/7 refused before spend** |
| The example from the brief: "hiring AEs whose funding closed within six months" | hiring **30** (a default the user never stated), funding 180 | hiring **none**, funding **180** ✅ |
| Seeded model errors | not expressible | **15/16 caught** (corrected or refused); 1 documented as invisible to code (T19-E) |
| 873 requests, every window **omitted** by the model | — | 861 identical hard criteria, 9 refused, 3 narrowed by the 730 cap, **0 downgraded** |
| 873 requests, every timeframe misfiled under hiring / under funding | — | **0 downgraded** (62 / 34 refused) |
| Flags off vs `121d8e1` | — | **byte-identical** (see §11) |
| A7 runtime (hiring 30, Account Executive), I1–I9 on a correct v2 proposal | ✅ | ✅ identical, I1–I9 pass |

**Known costs of failing closed.**
* "who should I contact **this week**" is refused (T19), because the contract has no safe way to say
  a timeframe qualifies no signal.
* The A7 sentence with the window omitted is refused rather than repaired by the R1 regex.

## 7. Recommended routing (GPT-6 family, after the live comparison confirms it)

| Task | Model / effort | Escalation |
|---|---|---|
| Mission compilation, request understanding | `gpt-6-luna` low | `gpt-6.1-sol` low, **only** on a validator rejection, at most once, within the run budget |
| Discovery selection, execution plan, amendments | `gpt-6-luna` low | `gpt-6.1-sol` low via the repair stages |
| Triage, evaluation, qualification, extraction, evidence planning, summaries | `gpt-6-luna` none | none: an undecidable verdict is already a handled outcome |
| Pool ranking | deterministic | — |
| Filtering, dedup, dates, validation, accounting, credits | code | — |
| Mission escalation cap | 3 per mission under `gpt-6` (`AGENTORY_MAX_ESCALATIONS_PER_MISSION`) | blocked with `escalation_budget_exhausted` beyond it |

Official prices, from the OpenAI model pages read 2026-10-28:

| Model | Input / cached / cache write / output per 1M tokens | Reasoning effort | Notes |
|---|---|---|---|
| `gpt-6-luna` | $0.10 / $0.01 / $0.125 / $0.50 | `none`–`max`, default `medium` | Chat Completions function calling only at effort `none` |
| `gpt-6.1-sol` | $2 / $0.10 / $2.50 / $10 | `low`–`max` (**no `none`**) | 2× input / 1.5× output above 272K input tokens; tools need the Responses API |

**Cache writes.**
* On GPT-5.6 and later, cache writes are billed at 1.25× input for the 30-minute write and 2.5× for
  the 12-hour write. They are reported as `cache_write_tokens`, with `ttl_12h_tokens` broken out.
* `readModelUsage` carries them when reported, and `priceModelCall` charges them for the two GPT-6
  models.
* **Pre-existing gap, deliberately left:** `gpt-5.6-*` writes are still priced as plain input, to keep
  Candidate C's accounting byte-identical. That under-states 5.6 spend by at most 0.25× of the
  written tokens.

Sol is **cheaper than today's escalation model**, `gpt-5.6-terra` ($2 / $12).

## 8. Estimated cost per representative mission

These re-price the recorded token counts of two real runs (`tests/fixtures/lead-v2`, harvested). A
different model emits a different number of tokens, so these are estimates, not measurements.

| Mission | Today (gpt-5.6-luna) | GPT-6 Luna-first | Sol everywhere (for scale) | Each escalation of the largest call (Sol) |
|---|---|---|---|---|
| `4250f181` (13 calls, 237k input tokens) | $0.051 | **$0.025** | $0.485 | +$0.080 |
| `1e52d43c` (43 calls, 355k input tokens) | $0.092 | **$0.044** | $0.868 | +$0.079 |
| Mission compilation alone (one call) | $0.0030 | **$0.0014** cold, including the cache write (v2 with a warm cache ≈ $0.0010) | $0.028 | — |

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
  * The 19 interpretation cases
  * The A7 request
  * The 7 `corpus.ts` cases
  * The real run-1 A7 request

  28 requests in total.
* **Arms.**

  | Arm | Model | Effort | Contract |
  |---|---|---|---|
  | A | `gpt-6-luna` | low | v1 |
  | B | `gpt-6-luna` | low | v2 |
  | C | `gpt-6-luna` | medium | v2 |
  | D | `gpt-6.1-sol` | low | v2 |

  Three repeats each: 28 × 4 × 3 = **336 calls**, plus up to one v2 repair call each.
* **Cap.**
  * Estimated cost: about 252 Luna calls at ≈$0.0015 (≈$0.38) and 84 Sol calls at ≈$0.031
    (≈$2.60), about **$3.0**, and up to twice that if every v2 call repairs.
  * Hard stop at **$6.00**. Use a TEST-project key with its own OpenAI usage cap.
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

1. **An independent review** of the corrected commit. Everything here is the author's own
   verification.
2. **Live comparison** (§9): needs approval and the `run.ts --live` implementation. The refusal rate
   of v2 on real model output, and how often the bounded repair resolves a refusal, are unmeasured.
3. **Per-signal windows at runtime.** `requestedHiringFromSignals` takes the shortest hiring window,
   so v2 refuses "AEs in 2 weeks or SDRs in 90 days" instead of collapsing it. Supporting it needs a
   role-aware job filter.
4. **No safe way to declare a timeframe that qualifies no signal** (T19), and no "older-than" or
   exclusion window at runtime. Both are refused today.
5. **The TEST gate on v2**: I9 is unchanged and checks the runtime window. Any future paid TEST on v2
   needs its own review; this branch must not reach the A7 TEST.
6. **AI-employee roster**: a product decision on Lisa/Lyra/Mira/Nova/Orion roles before any prompt
   names them.
7. **MC-9** ("roles posted" read as a social post) is now refused under v2, not fixed. The open MC-1…MC-8
   issues from PR #194's reviews remain.
8. **Stacked on PR #194.** This draft targets `test/agency-candidate-c-compiler` so its diff is
   reviewable; retarget it after #194 lands. **Do not merge it into the Candidate C branch.**

## 11. Corrections after the failed self-review of `da3c0b08`

| # | Defect in `da3c0b08` | Fix | Regression test |
|---|---|---|---|
| 1 | v2 omission downgraded hard funding (42/873) and hiring windows | Reader restored as an independent check. An omitted window it reads is applied; one it cannot place fails closed | `DEFECT 1` (×4), corpus T5-E, T10-E, T2-E |
| 2 | Any quote accepted ("posting", "days" took the model's days) | Quote must contain a time expression; only a quote that *contains* an expression accounts for it | `DEFECT 2`, trivial-quote tests, T2-E-quote-* |
| 3 | "over 90 days ago" → 90, "not in the last 90" → 90, "in 6 months" → 180 | Direction-aware parser; older-than / negated / future / undirected are conflicts | `DEFECT 3`, `readTimeframePhrase`, T11–T14 |
| 4 | v2 fields processed with the flag off | `signal_windows` processed only under contract v2; recorded and ignored under v1 | `DEFECT 4` |
| 5 | Funding / expansion / product launch advertised as usable | Availability from `PRODUCTION_READINESS` + configuration | `DEFECT 5`, availability tests |
| 6 | Global `signal_recency_days` silently ignored | Must agree with `signal_windows` or the compile is refused | `DEFECT 6` |
| 7 | Trace said "applied" with no runtime signal (MC-9) | Trace built from final signals; missing signal → `signal_missing_for_window` | `DEFECT 7`, trace test |
| 8 | Same-event windows collapsed to the minimum | Named → refused (runtime cannot enforce); unnamed → ambiguous, refused | `DEFECT 8`, T15 |
| 9 | `EscalationBudget` not connected to production | Mission cap spent by the engine's repair rounds (gpt-6 only) | `ENGINE` tests (cap 0 → no repair call) |
| 10 | Strategist sent Sol `none` (rejected); body-build throw leaked the abort timer | Effort floor applied; build failure is a `request_build_failed` result, timer cleared | `STRATEGIST`, `GPT PROVIDER` tests |
| 11 | Cache writes unpriced on GPT-6 | Priced at the write rate when reported | `PRICING` tests |

Found while re-running the probes against the first correction:
* A trivial quote still "covered" the expression it sat in.
* Calendar funding windows ("this month") were refused.
* A window copied from one signal onto another was invisible to code.

All three are fixed and tested.

**Which call sites the family flag covers.** `AGENTORY_GPT_MODEL_FAMILY` changes only what
`gptModelRouter` routes:

| Call site | Covered | Note |
|---|---|---|
| Router stages (mission compilation, discovery and execution planning and repairs, triage, evaluation, qualification, pool, grounded evidence, signal relevance, chat brain) | ✅ | Luna → `gpt-6-luna`, escalation → `gpt-6.1-sol` |
| Lead strategist adapters (`LEAD_STRATEGIST_*` model config) | ❌ | Configured separately; Sol's effort floor now applies if it is configured |
| `aiProvider` Claude tasks (`TASK_MODELS`) and their `gpt-4.1-mini` fallbacks | ❌ | Not GPT-5.6 routing |
| `gptProvider.GPT_MODEL` default (`gpt-4.1`) for callers that pass a tier, not a route | ❌ | Unchanged |
| `run-monitoring-scan` literal model label | ❌ | A label, not a call |

**Escalations per mission.**
* The engine's two repair rounds are capped under gpt-6.
* The only other production escalation, `signal_relevance` (its own code, not `runWithEscalation`),
  escalates at most once per decision. It is **not** counted against the mission cap, because it is
  outside the lead engine's state.

**Flags-off equivalence with `121d8e1`** (re-run on the corrected tree):
* The whole `compileLeadMission` result is byte-identical for 873 requests × 4 proposal variants
  (3,492 results).
* The 3,000-wording sweep, the criteria corpus and all 15 earlier probe scripts give identical output.
* The v1 payload, system prompt, schema, default routes and request body are identical.
* `buildModelTelemetry` output is identical for every default-family model.
* The one internal difference: `readModelUsage` now returns `cache_write_input_tokens` when OpenAI
  reports it. No telemetry, log, row or price reads it for a `gpt-5.6` model.
