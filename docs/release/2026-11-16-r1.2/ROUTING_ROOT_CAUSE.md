# ORION routing: root-cause investigation after three live TEST runs

**Status:** investigation (this document) → implemented as proposed in §4, with the changes listed in `R1.2_STABILIZATION.md` §11.

**Evidence:**
- TEST `request_understanding_log` (`chat_brain_shadow`) for all three runs (2026-11-16 10:13 / 10:52 / 14:52 UTC);
- the routing code at `61d658c6`.

`r12-transcript.json` stays on the owner's machine and is not readable from the cloud session.

## 1. Three runs, same prompts, same order

| Prompt (R1.2 suite) | Run 1 `36068e74` | Run 2 `3fb3a611` | Run 3 `61d658c6` |
|---|---|---|---|
| #12 "Give me a founder-only summary of risks and decisions…" | `compose`, no reference → converse ✅ | `read` + reference → `referent_unresolved` **ambiguous_referent** ❌ | same as run 2 ❌ |
| #4 "Tell me which of your previous claims…" | `read`, 4 referents bound ✅ | `read`, 12 bound ✅ | `read` → `referent_unresolved` **no_prior_results** ❌ |
| #13 "Scrape 200 companies… do nothing" | `source` → **no_prior_results** ❌ | ✅ | ✅ |
| #3 "Find 100 new US companies… do not execute" | `source` → **blocked: action** ❌ | 18 bound ✅ | 0 bound ✅ |
| #10 "Now write a LinkedIn post based on that internal report" | `compose` ✅ | `compose` → **blocked: reference** (rescued by the draft path) | same as run 2 |
| "Produce a weekly executive brief for Agentory…" | `read` | `read` | `compose` |

The same prompt in the same position is read differently from run to run: the objective, whether a back-reference is emitted, and its cardinality all change. Whether a reference can bind also changes, because it depends on what the *previous* ORION reply happened to cite.

## 2. The pipeline, and what is deterministic

| Step | Decides | Deterministic? |
|---|---|---|
| 1. Chat Brain (`understandRequest`) | Objective, parts, back-references (`kind`, `cardinality`, `value`), blocking ambiguities, confidence | **No.** GPT-5.6 Luna, a reasoning model at low effort with no temperature or seed control. |
| 2. Referent lookup (`loadLatestReferents`) | Which company set the conversation last presented | Yes, given the DB. But the set is whatever the last ORION reply persisted, which since R1.2 is the companies it **cited**, and that is model output. |
| 3. Referent resolution (`resolveReferents` / `selectEntities`) | Exact name or ordinal → that entity; `cardinality: "all"` → the whole set; **anything else → "bare singular pronoun"**, ambiguous if more than one entity, `no_prior_results` if none | Yes |
| 4. **Gate A: any referent failure → ASK** (before routing) | — | Yes, but it fires on model-supplied signals |
| 5. `orionRoute` (R1.1/R1.2 rules on the utterance and the request structure) | Reasoning reroutes, drafts, "do not execute" | Yes |
| 6. **Gate B: any blocking ambiguity → ASK** (`routeRequest`) | — | Yes, but the ambiguity is model-supplied |
| 7. Binding and guards: delegation guard, Start confirmation, spend ceiling | — | Yes |
| 8. ORION's answer | — | No |

## 3. Root cause

1. **Two hard "ask" gates (A and B) fire before the request's consequence is known, on model-supplied signals.** "Ask, never guess" is right for paid, outbound or state-changing work aimed at the wrong target. It is wrong for a free answer that ORION could give from the prior turns. Today the gates apply equally to both.
2. **The referent model has one target type: a company.** Every `prior_result` reference is resolved against company sets. A reference to *conversation content* ("your previous claims", "risks and decisions", "that report") can never resolve. A descriptive phrase that matches no company falls through to the singular-pronoun rule and becomes "ambiguous" whenever more than one company is on record (test 12).
3. **The referent corpus is itself model-dependent.** R1.2 made the presented set "named companies + companies the reply cited". A reply that cites nothing (an explanation, a refusal) leaves nothing to point back at, so "these companies" then fails as `no_prior_results` in one run and resolves in another (test 4).
4. **The fixes since R1.1 were rules over the utterance text, layered on a nondeterministic reading.** Each fix covered the reading that failed; the next run produced a different reading of a neighbouring prompt.
5. **Observability gap:** the understanding log records objectives and routes, but not the references' `kind`, `cardinality` and `value` or the ambiguity fields. That made each diagnosis an inference.

## 4. Proposed general design: consequence-gated reference resolution

Decide *whether asking is required* from deterministic facts (what the request would do, and what the reference points at), not from whether the model chose to emit an ambiguity.

### 4.1 Consequence class (deterministic, computed before any clarification)

| Class | From |
|---|---|
| `SPEND` | Any part whose objective may spend (`source`, `research`, `monitor`) **without** an explicit no-execution instruction |
| `OUTBOUND` | Compose-outreach, send/publish/schedule, delegation to agents |
| `STATE` | Writes: watch subjects, approvals, saved records |
| `ANSWER` | Everything else: reads, conversation, internal analysis, text-only drafts, and explain-only execution requests |

### 4.2 Reference target type (deterministic, from the model's fields plus a fixed lexicon)

| Type | Signals |
|---|---|
| `CONTENT` | The value names conversation content: *claims, answer, analysis, report, brief, findings, risks, decisions, recommendations, summary, priorities, plan, above, earlier, previous, you said* |
| `SET` | `cardinality: "all"`, a plural determiner or noun (*these/those/them/every/all + companies/leads/founders*) |
| `ENTITY` | `cardinality: "one"` with a singular pronoun or ordinal (*that one, it, the second one*), or an exact name |

### 4.3 Policy (one table replaces the three per-pattern patches)

| Target | `ANSWER` | `SPEND` / `OUTBOUND` / `STATE` |
|---|---|---|
| `CONTENT` | **Answer** from prior turns; never entity-resolved | Ask what to act on |
| `SET`, bound | Use the set | Use the set (Start confirmation and guards still apply) |
| `SET`, unbound | **Answer**; ORION states the set it assumed from the conversation | **Ask** |
| `ENTITY`, bound | Use it | Use it |
| `ENTITY`, unbound or ambiguous | **Ask** | **Ask** |
| Model's blocking ambiguity | Hand the question to ORION (it asks if it truly cannot answer). Exception: an `ENTITY` ambiguity still asks. | **Ask** |

### 4.4 Supporting changes

- **Referent persistence:** the presented set becomes the cited companies first, then the rest of the digest subjects, then the named companies. Set references then resolve whether or not the reply cited anything, and ordinals follow citation order.
- **Retire special cases:** remove the per-pattern patches (`dropAmbiguity` on explain-only, `explainsWithoutActing`, `answersWithoutResolvingTargets`). They become special cases of the table. `isExecutionRequest` and the no-execution wording stay, as inputs to the consequence class.
- **Observability:** log `references[{kind, cardinality, value, target_type}]`, `blocking_fields`, `consequence` and `policy_decision` on every understanding row.
- **Guards unchanged:** the delegation guard (`AGENTORY_DELEGATION_ENABLED=false`), the Start confirmation for paid work, the spend ceiling and workspace isolation are not touched. The policy can only *add* questions to `SPEND`/`OUTBOUND`/`STATE`, never remove them.

### 4.5 Tests: invariants over readings, not exact readings

A table-driven property test crosses:
- every R1.1 and R1.2 prompt plus paraphrases;
- **every plausible model reading**: objective ∈ {read, converse, compose, source}; reference ∈ {none, prior_result × {one, all, unset} × {company name, content phrase, plural phrase, pronoun}}; blocking ambiguity ∈ {none, action, reference};
- presented set ∈ {empty, one company, many}.

It asserts these invariants:
1. `SPEND`/`OUTBOUND`/`STATE` with an unbound `SET` or any unbound `ENTITY` → asks; never runs.
2. Nothing spends or delegates without confirmation, and nothing delegates while delegation is off.
3. `ANSWER` with a `CONTENT` or `SET` reference never asks.
4. An unbound or ambiguous `ENTITY` always asks.
5. The expected route of each acceptance prompt holds **for every reading in the matrix**, not just the one seen live.

The acceptance expectations are unchanged.

## 5. Measuring the variance (optional, capped, needs approval)

`scripts/orion-pilot/understanding-variance.ts` replays the exact preceding conversation from the local transcript. It calls **only** Chat Brain, N times, with no answers, no Supabase and no writes, and prints the distribution of readings.

**Proposed run:**
- **Readings:** the two failures (#4, #12) plus two controls (#3, #13), × 5 = 20 readings.
- **Cost:** about $0.01–0.02 expected, **hard cap $0.05**. The script stops before any call that could cross the cap, and the maximum allowed is $0.10.

This would quantify the instability. It does not decide the design: the design works for every reading, so it doesn't depend on which reading is most frequent.
