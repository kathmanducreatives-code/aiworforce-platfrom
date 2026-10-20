# Offline tests, receipts and reproduction

Source: `5d86703712205a04d059a39cf0d38a0621fc3ddb` plus this audit-only test. No migrations installed, database provisioned, hosted data read/written, customer record updated or live provider invoked. Tests use real modules/handlers, injected external model/provider transport and in-memory PostgREST/auth fixtures. Runtime network permission is omitted. Deno may resolve toolchain packages; that is distinct from an application provider request.

## New deterministic audit

[Fixture source](../../../tests/edge-functions/_shared/outpostReadinessAudit.test.ts). Repository path: `tests/edge-functions/_shared/outpostReadinessAudit.test.ts`.

| Case | Real exercised code | Positive/failure condition | Observed | Expectation verdict |
|---|---|---|---|---|
| M01 | aiProvider.generateText / actual transport selection | Same task, preferred OpenAI then Anthropic; both credentials synthetic | Both invoke mocked Anthropic Haiku | FAIL selected-provider contract; source traces builder's saved model not threaded |
| M02 | generateText / plannedAttempts | Required Anthropic key absent, only synthetic OpenAI key | no_provider_for_task; zero transport calls | PASS conservative refusal |
| M03 | generateText / telemetry | Helper primary returns503, allowed fallback OpenAI returns valid response | Degraded normalized result, two telemetry entries | PASS declared fallback boundary; DB persistence not tested |
| M04 | actual TASK_MODELS | Inspect supported provider policy | No Gemini text route | NOT IMPLEMENTED, not provider failure |
| I01 | getCompiledCompanyBrainForWorkspace | Non-member asks for B; legitimate A/B contexts | Foreign request refused before Brain read; distinct legitimate contexts | PASS loader boundary, not native RLS proof |
| I02 | loadConversationMemory | Fresh B conversation in workspace holding A draft | A draft returned, has_any_memory false | FAIL multi-client memory boundary |
| R01 | handleSendScheduledEmails | Concurrent callers synchronize after pending-row read | Two accepted mock sends for one email | FAIL duplicate-effect guard |
| R02 | same real handler | Accepted mock send, DB PATCH400, repeat request | Both report sent1, row still pending, two sends | FAIL persistence/uncertain-delivery handling |
| R03 | same handler and real supabase-js filters | Two different authenticated owners' emails seeded | Only caller's email sent | PASS user ownership boundary |
| R04 | same handler auth | No bearer | 401; no provider/database mutation | PASS unauthorized refusal |
| A01 | handleApproveAndContinue | Owner approves, downstream503, repeats approval | First returns continuing; approval settled; second already_settled, no new dispatch | FAIL recoverable handoff contract |

[Structured offline receipts](evidence/offline-receipts.json), [characterization output](evidence/custom-characterization.txt), [strict failing output](evidence/custom-expectations.txt).

Characterization: **11 pass / 0 fail**, intentionally asserting current observed behavior. Strict customer safety expectations: **6 pass / 5 fail** (M01/I02/R01/R02/A01). M04 records unsupported Gemini rather than asserting a nonexistent execution. A green characterization lane does not make these defects acceptable.

```sh
deno test --node-modules-dir=auto --lock=/tmp/outpost-audit-deno.lock \
  --allow-read --allow-env \
  tests/edge-functions/_shared/outpostReadinessAudit.test.ts

OUTPOST_ASSERT_EXPECTATIONS=1 deno test --node-modules-dir=auto \
  --lock=/tmp/outpost-audit-deno.lock --allow-read --allow-env \
  tests/edge-functions/_shared/outpostReadinessAudit.test.ts

# Isolate a deterministic proof, for example:
OUTPOST_ASSERT_EXPECTATIONS=1 deno test --node-modules-dir=auto \
  --lock=/tmp/outpost-audit-deno.lock --allow-read --allow-env \
  --filter 'outpost R01' \
  tests/edge-functions/_shared/outpostReadinessAudit.test.ts
```

M01 fails on its first selected OpenAI task in strict mode; the characterization receipt separately records both preferences. `fetch` is restored and synthetic provider environment overrides are restored after each transport test. Other external calls use an explicit injected strict network. No selected provider is genuinely contacted. Local fixture tables are JavaScript objects, not Supabase or hosted databases.

## Existing focused tests rerun

**142/142 typechecked passes** in this narrow group:

```sh
deno test --node-modules-dir=auto --lock=/tmp/outpost-audit-deno.lock \
  --allow-read --allow-env \
  tests/edge-functions/_shared/companyBrainConsumption.test.ts \
  tests/edge-functions/_shared/companyBrainOriginSave.test.ts \
  tests/edge-functions/_shared/companyBrainSourceRole.test.ts \
  tests/edge-functions/_shared/companyBrainRefreshDiff.test.ts \
  tests/edge-functions/_shared/taskModelPolicy.test.ts \
  tests/edge-functions/_shared/modelFailurePropagation.test.ts \
  tests/edge-functions/_shared/modelCostTelemetry.test.ts \
  tests/edge-functions/_shared/workflowContinuation.test.ts \
  tests/edge-functions/endpointSecuritySweep.test.ts \
  tests/edge-functions/approveAndContinueAuthorization.test.ts \
  tests/edge-functions/_shared/signalsWorkspaceIsolation.test.ts
```

[Output](evidence/focused-typed.txt). Covers Brain source roles, instruction preservation, workspace refusal, provider contracts, endpoint auth, tracking validation, approval access and continuation. These are mocks/pure contracts, not installed RLS or live operations.

**114/114 typechecked passes** for reusable account research/outreach and monitoring:

```sh
deno test --node-modules-dir=auto --lock=/tmp/outpost-audit-deno.lock \
  --allow-read --allow-env \
  tests/edge-functions/_shared/leadActionRequestContract.test.ts \
  tests/edge-functions/_shared/leadActionExecutor.test.ts \
  tests/edge-functions/_shared/leadActionRunner.test.ts \
  tests/edge-functions/_shared/openerBackend.test.ts \
  tests/edge-functions/_shared/openerGroundingRules.test.ts \
  tests/edge-functions/_shared/sellerIdentityBlock.test.ts \
  tests/edge-functions/_shared/monitoringSchedule.test.ts
```

[Output](evidence/reuse-typed.txt). Includes unknown claim/evidence IDs, conflicting seller identity, no-call refusals, draft-only output and cadence/lease/budget controls. No dedicated call-brief/iGTM integration was invented for the tests.

**40/40 budget runtime passes**, with a pre-existing typecheck failure explicitly preserved:

```sh
deno test --node-modules-dir=auto --lock=/tmp/outpost-audit-deno.lock \
  --allow-read --allow-env \
  tests/edge-functions/_shared/modelSpendIsBounded.test.ts
# This fails typechecking at lines623/630: ModelUsage fixture shapes omit
# cached_input_tokens or all usage fields. No runtime assertions execute.

deno test --no-check --node-modules-dir=auto \
  --lock=/tmp/outpost-audit-deno.lock --allow-read --allow-env \
  tests/edge-functions/_shared/modelSpendIsBounded.test.ts
# Runtime: 40 pass. This is not a clean typechecked pass.
```

[Type failure](evidence/budget-typecheck-failure.txt), [runtime assertions](evidence/budget-runtime.txt). The type failure occurred in an initial combined command; that command did not run its tests. It was then split from the 142-test typechecked group. No existing financial test was weakened or changed.

## Prior routing audit rerun on the current integration source

The audit-only harness from commit `aca94e6b739e5f5c129ae0e11b56676e9da09c80` was rerun with `ROUTING_AUDIT_SOURCE_ROOT` pointing to this exact integration tree: **85 characterization tests passed**, recording the same known routing defects. [Per-scenario summary](evidence/routing-rerun-summary.json). The [previous report](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/aca94e6b739e5f5c129ae0e11b56676e9da09c80/docs/launch/discovery-routing-audit/README.md) includes full original/PR113 JSON and Mermaid paths and opt-in expected-failure counts. It is linked rather than duplicating multi-megabyte traces here.

Reproduce using a separate checkout of the audit harness; set source root to the pinned target. No merging is needed:

```sh
ROUTING_AUDIT_SOURCE_ROOT=/absolute/path/to/integration-at-5d867037 \
ROUTING_AUDIT_COMMIT=5d86703712205a04d059a39cf0d38a0621fc3ddb \
deno test --node-modules-dir=auto --lock=/tmp/outpost-routing-deno.lock \
  --allow-read --allow-env \
  /absolute/path/to/routing-audit/tests/edge-functions/_shared/independentRoutingAudit.test.ts
```

PR113's latest head `671edf35...` only merges CI changes relative to the earlier runtime-tested `623db1b4...`; runtime code is unchanged. It is OPEN draft, with a failed native database CI shard. Those earlier comparison results are not represented as a new full native run or live qualification acceptance.

## Explicitly not executed

Native local Postgres/RLS/queue fault suites require provisioning/bootstrap/migration actions and were not run under this audit's no-install-migrations constraint. Existing successful integration CI native/mutation jobs were inspected as CI evidence only. No hosted customer records, tasks, Brain profiles, tokens or API account state were queried.

There is no live Apollo/iGTM/Jungler/Sheets/Slack adapter to test. No call dispositions, replies, campaigns or selected-model live comparisons were fabricated. Current worker queue recovery, database lead/account/task/lineage persistence, provider spending admission concurrency and real remote delivery are NOT TESTED here. Their absence is reflected in readiness classifications and the acceptance backlog.
