# Reproduction, verification and risks

## Safety and tested boundaries

Audit branch `codex/gpt-intelligence-audit` starts from integration
`5d86703712205a04d059a39cf0d38a0621fc3ddb`; production code is unchanged. All
published additions are inside this documentation directory, including
reproducible offline fixtures. PR113/123/125 were inspected in separate detached
read-only checkouts. They were neither merged nor assumed deployed. No
migrations were created/installed and no hosted database or customer records
were accessed.

Tests run with `--allow-read --allow-env` and **without `--allow-net`**.
External responses are injected. Reading Deno dependencies is tooling
resolution, not permission for application model/provider calls. The twelve
probes do not call the live model; T01 injects a synthetic response into the
real transport parser. The routing harness injects model/provider boundaries but
runs the actual compiler, capability engine, claim and criterion parsers,
canonical/projection and outcome functions. It does not replace application
decisions with scripted answers.

## Receipts

| Lane                                                            | Result                                                                      | Meaning                                                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing routing harness, four pinned roots                     | 85/85 per root                                                              | Characterization passes while reporting known customer expectation failures                                                                   |
| Strict routing expectations on Q2                               | 76 pass / 9 fail                                                            | Existing Q3 gaps remain red; not hidden or converted to ignored tests                                                                         |
| Focused request/compilation/policy/evidence/Brain/memory, typed | 120/120                                                                     | Existing contracts hold, not proof of live semantic quality                                                                                   |
| Admission/router/body/cost telemetry, typed                     | 67/67                                                                       | Existing model routing and spending contract controls; no actual SQL concurrency proof                                                        |
| Q2 evidence integrity, typed                                    | 11/11                                                                       | Conflict, ownership, event windows, first hire plus controls                                                                                  |
| Funding-stage/pair and signal relevance                         | Typed lane fails existing fixture TS2352; runtime `--no-check` 34/34        | `p6FundingStageClaim.test.ts:204` has an incomplete MissionCriterion fixture. No test or qualification code changed to hide it                |
| New 12 compiler/graph probes, integration and Q2                | Both run successfully, recorded outputs                                     | Supplied mock proposals reveal actual compilation/projection; not a quality score                                                             |
| T01 transport truncation contract                               | Strict assertion fails as expected                                          | `finish_reason: length` plus parseable JSON accepted; stop positive control also accepted                                                     |
| F01 funding conflict/control                                    | Both snapshots: Seed agreement PASS; cited same-date Series A mismatch FAIL | Real funding corroboration/decision; no provider or full mission                                                                              |
| E01 extraction boundary                                         | Characterization passes                                                     | Fabricated excerpt rejected; semantically wrong reading of a real negative excerpt accepted as an inference; final qualification not executed |

Detailed text outputs are in `evidence/`. In particular
[semantic-controls.txt](evidence/semantic-controls.txt) preserves the typed
failure, [runtime controls](evidence/semantic-controls-runtime.txt) preserve the
separate runtime pass, [strict routing](evidence/pr125-strict.txt) preserves
known reds, and [T01](evidence/truncation-red.txt) preserves the new failing
contract.

## Commands

Create isolated detached checkouts at the pinned commits in README; do not check
out or update Claude's working branches. From an isolated integration worktree:

```sh
deno run --node-modules-dir=auto --no-lock --allow-read --allow-env \
  docs/audits/agentory-gpt-intelligence/probe.ts

INTELLIGENCE_SOURCE_ROOT=/tmp/agentory-gpt-pr125 \
  deno run --node-modules-dir=auto --no-lock --allow-read --allow-env \
  docs/audits/agentory-gpt-intelligence/probe.ts

# Expected nonzero: deterministic red proof, no retry/model purchase.
INTELLIGENCE_ASSERT_EXPECTATIONS=1 \
  deno run --node-modules-dir=auto --no-lock --allow-read --allow-env \
  docs/audits/agentory-gpt-intelligence/probe.ts
```

The routing harness itself is unchanged from the independent routing audit. Its
source is pinned at `aca94e6b` in
`tests/edge-functions/_shared/independentRoutingAudit.test.ts`. Retrieve it with
`git show` into a temporary file or use that audit's clean checkout; no branch
merge is required. Its source root is always supplied explicitly:

```sh
ROUTING_AUDIT_SOURCE_ROOT=/absolute/path/to/pinned-source \
ROUTING_AUDIT_COMMIT=FULL_PINNED_SHA \
  deno test --node-modules-dir=auto --no-lock --no-check --allow-read --allow-env \
  /absolute/path/to/independentRoutingAudit.test.ts

# Add ROUTING_ASSERT_EXPECTATIONS=1 for the expected known-gap failures.
```

The baseline harness uses loose dynamic adapter types, so its published command
uses `--no-check`; this is separate from the typed focused lanes.
`ROUTING_TRACE` and `ROUTING_SEMANTIC_ASSERTION` lines contain JSON. Relative
fixture times change on rerun; source identities, semantic outcomes and margins
remain deterministic.

Focused typed lane:

```sh
deno test --node-modules-dir=auto --no-lock --allow-read --allow-env \
  tests/edge-functions/_shared/chatBrainParser.test.ts \
  tests/edge-functions/_shared/chatBrainBinding.test.ts \
  tests/edge-functions/_shared/gptMissionCompiler.test.ts \
  tests/edge-functions/_shared/taskModelPolicy.test.ts \
  tests/edge-functions/_shared/modelFailurePropagation.test.ts \
  tests/edge-functions/_shared/webEvidencePageDiscovery.test.ts \
  tests/edge-functions/_shared/webEvidenceCachedPages.test.ts \
  tests/edge-functions/_shared/groundedWebPageEvidence.test.ts \
  tests/edge-functions/_shared/companyBrainConsumption.test.ts \
  tests/edge-functions/_shared/memoryReader.test.ts

deno test --node-modules-dir=auto --no-lock --allow-read --allow-env \
  tests/edge-functions/_shared/smokeAdmission.test.ts \
  tests/edge-functions/_shared/lunaFirstRouting.test.ts \
  tests/edge-functions/_shared/modelRequestBody.test.ts \
  tests/edge-functions/_shared/modelCostTelemetry.test.ts

# Run in the pinned Q2 checkout:
deno test --node-modules-dir=auto --no-lock --allow-read --allow-env \
  tests/edge-functions/_shared/qualificationEvidenceIntegrity.test.ts
```

The three extra control files are `p6FundingStageClaim.test.ts`,
`p6FundingPairLive.test.ts`, `signalRelevanceJudge.test.ts`; rerun typed first,
then explicitly use `--no-check` only to inspect their runtime behavior. “LIVE”
in a test name refers to saved historic fixture contracts, not a live operation
performed by this audit. No account entitlement is inferred from those fixtures.

`collect.py` collects `/tmp/gpt-audit-*.log` outputs into this report and
generates the source call-site scan. It is a local documentation utility, not
application runtime. The checked-in evidence is the receipt; raw routing logs
are summarized with hashes. Repetitive engine diagnostics and checkpoint dumps
are omitted from JSONL while criterion/evidence/canonical/output boundary fields
remain.

## Risk assessment and acceptance gates

| Risk                                          | Severity / current evidence                                                    | Engineering gate                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Lost or weakened mandatory intent             | High; current C01/C02/C04/H04/L08 plus new compiler projections                | Complete Q3/Q4, then held-out clause/paraphrase evaluation. A valid JSON schema alone is insufficient                            |
| Hallucinated semantic support / buying intent | High; E01 boundary demonstrated, actual model error rate unmeasured            | Source-backed structured interpretation, conservative UNKNOWN, negative/quotation controls and final canonical adversarial cases |
| Unsupported claims becoming qualified later   | High; integration regressions, Q1/Q2 improve specific cases                    | One canonical decision and immutable criteria, all downstream consumers/replay/persistence tested on final combined SHA          |
| Cross-client context/credentials              | High; inherited memory findings, disabled P1 foundation only                   | One client/workspace, native access/parent/write tests, scoped retrieval/model policy, no model authorization decisions          |
| Unsupported provider substituted              | High; capability vs executability distinction proven in routing harness        | Registry/readiness/admission enforcement before every effect; return unsupported instead of invented collection                  |
| Unsafe outreach / duplicate dispatch          | High; independent Outpost OO-01/02/03 remain                                   | Durable operation/approval/delivery receipts and recovery before external dispatch; draft-only stays separate                    |
| Excess model cost / layered retries           | High for spending authorization; arithmetic examples in budgets                | Every runtime attempt passes existing four-attempt/.05/.20/.25 admission, no per-stage or resume allowance reset                 |
| Incomplete structured response accepted       | Medium; new deterministic T01                                                  | Transport normalization retaining usage, caller error propagation and no added automatic retry                                   |
| In-flight timeout uncertainty                 | Medium; generic GPT no timeout, admitted smoke has abort/deadline              | Verify scope-specific abort/liability/reconciliation; a timed-out promise is not proof of zero spend                             |
| Memory poisoning / feedback loop              | High if autonomous updates enabled; no validated universal learning loop found | Proposed updates only, approved sources/outcomes, human review, scoped version/expiry and rollback                               |
| Model selection ignored                       | Medium/high client trust; existing shared policy vs agent label disconnect     | Server-owned task model/credential policy; exact actual receipt; unsupported model disabled                                      |
| Misleading confidence from mocks              | High audit risk                                                                | Label compiler-only, engine-with-mocks, native persistence and live model evidence separately; no LIVE VERIFIED claim here       |

The shortest safe intelligence work is better existing contracts plus controlled
semantic evaluation. The shortest safe Nosh demonstration remains a separately
authorized draft-only briefing from approved existing records after isolation
gates. Neither requires an autonomous multi-agent debate or a second prospecting
workflow. No native final A7 acceptance or live customer workflow was executed.
