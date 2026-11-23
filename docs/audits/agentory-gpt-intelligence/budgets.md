# Model-call budget, latency and failure analysis

**Unchanged A7 ceiling: four runtime model attempts, $0.05 model, $0.20
provider, $0.25 combined.** No change to these limits, retries or admission is
proposed by this audit. A named stage is not an attempt: a transient retry,
repair, fallback or resumed call consumes its own applicable
attempt/reservation.

## Current boundaries

`gptModelRouter` deterministically routes stage/repair policies. `gptProvider`
allows at most one bounded transient transport retry. Quota exhaustion is not
retried; provider errors are distinct from invalid model output. Mission and
plan repair paths are separately bounded by their wrappers/validators. They must
still pass real per-attempt spending admission; two layers each allowing a retry
do not authorize exceeding the global cap.

The routing ledger summarizes logical stage routes, not a complete per-fetch
attempt receipt. The transport can retry within one facade call; use admission
operation/attempt receipts to establish actual bounded sends, not stage counts
alone.

The shared `aiProvider` has task-specific fallback permission, not universal
cross-vendor fallback. Generic execution, orchestration and Brain refuse missing
intended provider; helper/tool-input planning can use approved OpenAI fallback.
Telemetry records actual provider/model, usage and degradation. An `ok` text
response is not a persisted task/lead, approved export or external-delivery
receipt.

`smokeAdmission` bounds admitted in-flight fetches by remaining
slice/authorization deadline and revocation using abort signals. The generic GPT
transport has no independent fetch timeout. Planner wrappers have a 25-second
promise deadline; a timed-out promise alone does not prove the vendor stopped
processing. Outside the admitted smoke boundary, review each caller's abort and
uncertain-liability handling before enabling new paid paths. Never repurchase an
uncertain attempt merely because a wrapper stopped waiting.

Minimal A7 orchestration skips route control, triage, discovery replan,
execution- plan amendments, pool-ranking shadow and P2 receipt rereads. Do not
add them back as “intelligence improvements.” Existing
transport/schema/admission tests pass offline, but this audit does not replay
actual SQL reservation concurrency or execute the final native combined A7
suite.

Request understanding/chat and preflight compilation may occur at different
entry points from the runtime mission. Do not count only visible runtime phases
and claim that is the total customer interaction cost. Exact approved A7
dispatch must retain its existing runtime admission scope, while future UI/pilot
tasks need their own explicitly reviewed ceilings.

## Existing stage output ceilings and context costs

| Boundary                           | Configured output ceiling / shape                                 | Input/token and latency implications                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Request understanding              | 1,500 tokens; RequestV1 schema                                    | Prior references/schema can outweigh the request; one normal interpretation and validator-earned repair only                          |
| Mission adapter                    | Caller maxTokens, default 4,000; strict mission schema            | Public catalogue, Brain and original query. Planner wrapper may set 1,500; do not confuse adapter default with effective caller limit |
| Discovery planner                  | 2,000 tokens; typed Actors/inputs                                 | Offered cards and held results; subset/compact cards reduce repeated input                                                            |
| Execution planner                  | 3,000 tokens; dependency chain                                    | Often largest planning payload. A larger repair model can exceed the remaining dollar ceiling despite the same call count             |
| Strategist wrapper/evaluation      | Wrapper 1,500 tokens; adapter default 4,000 if caller omits limit | Evidence registry and Brain/mission context scale with companies; batching and input selection matter more than a tiny output change  |
| Route control                      | 700 tokens                                                        | Compact measured yields and constraints; optional normal path, disabled in minimal A7                                                 |
| Opportunity reasoning              | 1,200 tokens                                                      | Only eligible bounded batches and citation IDs; optional, cannot improve source truth                                                 |
| Signal relevance                   | 700 tokens                                                        | Existing cluster events + workspace context; validator repair can consume a second attempt                                            |
| Workbench opener                   | 300 tokens                                                        | Grounded observation/seller relevance; does not imply a complete call briefing                                                        |
| Brain/content/chat/generic writing | Caller-specific limits via shared policy                          | Relevant bounded context needed; full Brain/history stuffing adds tokens and leakage surface                                          |

No production p50/p95 latency, token distribution, real-model accuracy or
account throughput was measured. Mock milliseconds are not usable latency
benchmarks. Use existing `latency_ms`/usage/ledger records in a separately
authorized controlled acceptance run, with synthetic input and no customer data,
to validate estimates.

## Proposed calls: mostly improve existing work

The figures below are planning assumptions, not observed quality improvements or
vendor latency guarantees. Short-context standard list prices inspected on
2026-10-20: Luna $0.20 input/$1.20 output per million tokens; Terra $2/$12.
Account pricing/availability, cache writes, regional/service-tier premiums and
actual billed reasoning tokens need validation.
[Luna pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[Terra pricing](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

| Improvement                                        | Additional calls                                                       | Assumed input/output                 | Luna / Terra illustrative USD            | Latency planning allowance                                             | Quality expectation and use                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Lossless compilation R1                            | 0 normal-path; improve current call                                    | 6k / 0.8k                            | .00216 / .02160 for that whole call      | 2–15s / 5–30s, unmeasured                                              | Better clause/group/window fidelity; all missions; no claim of measured percentage gain                                |
| Contextual interpretation R2                       | 0 normal-path; improve existing extraction/evaluator                   | 8k / 1k                              | .00280 / .02800                          | Same assumed ranges                                                    | Better negation/attribution and event interpretation; evidence-consuming tasks. Larger context still needs reservation |
| Planner improvement R3                             | 0 normal-path; existing route/plan calls only                          | 5k / 0.7k                            | .00184 / .01840                          | Same assumed ranges                                                    | Higher useful-evidence yield; route controller only when its existing eligibility permits                              |
| Scoped retrieval R4                                | 0 required                                                             | No generative tokens                 | $0 model                                 | Local DB latency unmeasured                                            | Less irrelevant context and no client leakage; auth/versioning do not need AI                                          |
| Caller brief R6                                    | 1 per separately approved pilot draft; not added to A7                 | 6k / 1k                              | .00240 / .02400                          | Same assumed ranges; writer model must be separately selected/accepted | Reviewer-ready concise synthesis, not discovery or second qualification                                                |
| Memory amendment R7                                | 0 until a reviewed outcome batch warrants it; future separate proposal | 4k / 0.6k                            | .00152 / .01520                          | Same assumed ranges                                                    | Controlled learning from real verified outcomes; not every run or mandatory pilot work                                 |
| Universal critic / agent debate / multi-model vote | Not recommended                                                        | Unbounded unless separately designed | Additional attempts and repeated context | Additional sequential latency                                          | No new evidence, correlated errors; no demonstrated benefit justifying A7 spend                                        |

Illustration: four 6k/800-token Luna calls total .00864; replacing one with
Terra gives .02808, before any premium/extra reasoning. But a
16k-input/3k-output Terra plan alone is .068, over the entire A7 model cap. This
is why model choice and max-output reservation must be enforced, not inferred
from a cheap average. These examples neither allocate the four attempts nor
authorize a fallback.

The repository's cost table is historical metadata. Its Luna/Terra rates match
the inspected list prices; its Sol entry is older than the official current
page, and normal router policy excludes Sol. Do not silently change prices or
enable another model in this documentation PR. Legacy fallback models also need
lifecycle review: official deprecations list GPT-4.1/4o family snapshots for
January 14, 2027. That is a future compatibility concern, not evidence of a
current outage or authorization to migrate.
[Official deprecations](https://developers.openai.com/api/docs/deprecations).

## Reuse, caching and controlled failure

- Cache approved **evidence receipts**, normalized sources and immutable context
  projections before caching model opinions. Key by workspace/client, company,
  source/version digest, criterion contract/window, policy/model/schema/prompt
  version. A shared email/domain/source ID is not a cross-client cache key.
- Reauthorize on every use. Source staleness, changed user intent or policy,
  conflicting identity and revoked permission invalidate reuse. A cached PASS
  cannot bypass the current canonical decision. Brain updates do not silently
  rewrite an old task's context.
- Schema/parse failure, refusal, truncation and transport failure need explicit
  normalized states. T01 must retain usage on failure; parser repair does not
  get a fresh spending allowance. Timed-out dispatched attempts stay uncertain
  until reconciled, with no automatic new vendor purchase.
- Stop when mandatory evidence cannot be obtained with the actually available
  capabilities or remaining authorized budget. Request human clarification or
  return partial/unknown outcomes; neither extra model confidence nor more
  agents can manufacture that evidence.

Structured output support constrains shape, not factual correctness; OpenAI
explicitly notes that schema-conforming output can still contain mistakes.
[Structured-output limitations](https://developers.openai.com/api/docs/guides/structured-outputs).
