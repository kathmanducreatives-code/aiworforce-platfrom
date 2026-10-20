# T01 completion validation and E01 ownership boundary

Base: `launch/hardening` at `5d86703712205a04d059a39cf0d38a0621fc3ddb`.
Related documentation-only intelligence audit: [PR #130](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/130).

## T01 behavior and scope

`gptProvider.ts` previously returned success whenever the message content parsed
as JSON, even if OpenAI reported `finish_reason: length`. Parseable JSON does
not establish that generation completed. The compiler and planning adapters
could consequently consume an incomplete result as a successful proposal.

The shared GPT transport now requires an explicit `stop` before accepting JSON:

| Provider result | Result code | Automatic completion repair |
| --- | --- | --- |
| `stop`, valid JSON | success | none needed |
| `length` | `incomplete_response` | prohibited |
| `content_filter`, `tool_calls`, `function_call`, unrecognized/null/missing termination | `unexpected_completion` | prohibited |
| refusal (including absent termination metadata) | `schema_refused` | existing policy unchanged |
| `stop`, empty/non-text content | `empty_response` | existing policy unchanged |
| `stop`, malformed content or malformed API JSON envelope | `unparseable_json` | existing policy unchanged |

Refusal is checked first, termination second, content third. No arbitrary
termination metadata, tool arguments or response content enters new diagnostics.
All received completion results settle usage exactly once with their true
success/failure outcome. Known input, cached-input and output tokens remain
charged when content/termination validation fails. No reservations or attempt
slots are refunded. Existing transient HTTP retry behavior is unchanged.

`modelFailureContract.ts` declares the two terminal completion codes. The existing
compiler binding already consults `isUnrecoverableModelFailure`; extending that
contract stops its repair without editing compiler implementation files.
`gptDiscoveryPlanner.ts` and `gptExecutionPlanner.ts` throw a typed terminal
completion error, so the real engine's existing exception paths block before
invalid-plan repair. Strategist/mission adapters retain their existing error-code
forwarding; no qualification behavior is added or changed.

No request-size/output-token settings, model routing, fallback allowances,
authorization, checkpoints, schema, admission code or budget constants change.
Successful HTTP fixtures now explicitly report `stop`. These changes describe
provider metadata only; their semantic model responses are unchanged.

## Offline acceptance

Run without network permission:

```sh
deno test --allow-read --allow-env \
  tests/edge-functions/_shared/gptCompletionValidation.test.ts \
  tests/edge-functions/_shared/gptCompletionAdmission.test.ts \
  tests/edge-functions/_shared/gptProvider.test.ts \
  tests/edge-functions/_shared/modelFailurePropagation.test.ts \
  tests/edge-functions/_shared/missionCompilationRetry.test.ts \
  tests/edge-functions/_shared/transientProviderFailure.test.ts \
  tests/edge-functions/_shared/modelCostTelemetry.test.ts
```

The new tests use the real GPT transport, mission and strategist adapters,
compiler binding, capability engine, ledger collector/writer, spend authorization
and fetch admission gate. Only HTTP responses, database/RPC responses and sleep
are mocked. Coverage includes every termination above, positive `stop` control,
refusal precedence, malformed/empty responses, no compiler repair, no engine
planning repair/provider work, one failed ledger record, repeated failure/cancel
flush, and spend visible to a subsequent slice.

The admission integration test drives an HTTP retry, truncated response,
resumed generation, cancellation after admission and another resumed generation
through the real fetch gate. Shared synthetic RPC state retains all four slots
and the $0.05 commitment; cancellation does not refund either. It reads the
existing smoke budget specification. The existing smoke admission and budget
spec suites cover the unchanged $0.20 provider and $0.25 combined bounds.
This RPC fixture is not evidence of a deployed authorization or SQL execution;
existing disposable-database CI contracts cover SQL enforcement separately.

The admission gate counts physical attempts. The existing model collector
settles a transport invocation's reported usage; this fix does not redesign
accounting of intermediate transient HTTP failures. Durable admission still
bounds each physical send, including HTTP retries. Exactly-once claims here
refer to the received completion's usage and the collector's normal exit flush,
not crash-proof delivery of telemetry across arbitrary process termination.

Performance: constant-time termination inspection and one existing telemetry
callback. No additional model/provider call, prompt tokens, retry allowance,
latency round trip or budget increase. The four runtime model attempts and
$0.05 model / $0.20 provider / $0.25 combined ceilings remain unchanged.
A proxy or local stub omitting successful completion metadata now fails closed
and must be corrected rather than grandfathered into success. GPT transports
outside `gptProvider.ts` are not changed or certified by this patch. Semantic
correctness and full schema validation remain downstream responsibilities.

## E01: quotation authenticity is not semantic support

The offline counterexample is a real quotation, attached to a false claim:

- Page: "We are not looking for new sales tools. We already have a CRM."
- Model claim: "Company is searching for new sales tools"
- Model relation: `supports`; confidence: `high`.

`webEvidenceExtraction.ts:parseExtractionStrict` checks known-page membership,
quote presence and enum values. It accepts this quote. It cannot establish
semantic entailment merely by finding a substring. A fabricated quotation is
rejected; that is a different property.

Complete downstream trace on the pinned integration:

1. `run-agent/index.ts` supplies optional legacy extraction to
   `webEvidenceRunner.ts:runEvidenceCollection`.
2. The runner persists fetched raw pages through `webEvidenceStore.ts` **before**
   extraction. Accepted claim bodies/support labels are not written or returned.
3. Extraction affects `claims_kept`, `claims_rejected`, rejection counters and
   `collected`/`no_useful_pages`. `supports`, `contradicts` and `inconclusive` for
   the same quote produce identical stored pages and collection outcomes.
4. `webEvidenceReevaluation.ts` rebuilds the registry with raw cached pages via
   `leadEvidenceRegistry.ts` and uses the existing mission evaluator/parser.
5. Canonical qualification remains authoritative. A Q2 boundary probe on
   `a542b2f1` accepted a false semantic PASS in the evaluator parser but returned
   canonical pending with an empty supporting fact graph. It did not exercise
   persistence or a complete customer mission and does not establish a final
   false-qualification bypass.

The measured extraction impact is misleading support interpretation and claim
counts/collection reporting, not direct promotion of that label into canonical
qualification. The optional extraction call currently discards its claim bodies;
removing or repurposing it is a separate decision, not part of T01.

Recommended follow-up, under Claude's evaluator ownership: improve the existing
evaluator's instructions to distinguish support, contradiction and irrelevance
against the exact criterion using surrounding context, subject/speaker, quoted
speech, negation, hypothetical versus completed events, and event time. Reuse
existing matched/failed/unknown outputs and canonical authority; no second
semantic evaluator and no new model call. Keep quote existence, identity,
provenance, timestamps, authorization and budgets deterministically enforced.

Contrastive fixtures should include true positive support, explicit negation,
competitor/employee quotations, hypothetical plans, unrelated genuine quotes,
wrong-company receipts, fabricated quotes and misleading partial quotations.
Mock tests prove contract and propagation safety; they cannot prove a model
will interpret natural language correctly. Do not claim E01 solved by T01.

## Ownership and safety

Before editing, fetched origin and inspected the open stack through #129
`f4056493122b069157fc0db6d35b5c1f90170a92`. No active stack diff overlaps the four
T01 runtime files. `missionEvaluation.ts`, evidence-registry and re-evaluation
changes overlap Claude's qualification work and are not edited here. Coordination:
[PR #123 comment](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/123#issuecomment-6294471088).

This reliability branch is separate from PR #130's audit and PR #124's Nosh
client-isolation pilot. No compiler/qualification branches, hosted databases,
migrations, deployments, paid providers, outreach or A7 execution are used.
A7 remains NO-GO.

## Local verification receipt

- New T01 transport/adapters/engine/accounting tests: 32 typed passes; admission
  retry/cancellation/resume test: 1 typed pass.
- Focused transport/failure/compiler/retry regression: 90 typed passes; the
  combined accounting and new-test run: 48 typed passes (overlapping suites).
- Entire Edge Function suite: **8,711 passed, 0 failed**, offline, matching CI's
  `--no-check` runtime lane. The original `length` assertion fails on the
  unchanged integration runtime, confirming the regression test detects T01.
- All production Edge Functions (excluding generated MCP) and `worker/main.ts`
  type-check; both new test files type-check explicitly.
- Infrastructure/deploy-safety/admission-spec suite: **187 passed, 0 failed**.
- Frontend type and lint ratchets pass without new debt; production build passes
  with the existing chunk-size advisory. `git diff --check` passes.
- No network permission was granted to Edge Function tests. No live provider,
  customer workflow, hosted DB, migration, deployment or A7 execution occurred.

The old source-string telemetry assertion was replaced with a behavioral test
that checks malformed content retains usage and emits one failed event. No
baseline was weakened to make a completion with missing metadata succeed.

The first GitHub CI run passed backend, frontend, Replay Lab and two contract
shards. The third exposed two admission runtime tests whose successful vendor
fixtures omitted termination metadata. All five successful envelopes in that
contract fixture now explicitly report `stop`; no assertion or limit changed.
Terminal cases also test malformed/empty partial content, ensuring termination
is checked before content parsing can enter the ordinary repair path.
