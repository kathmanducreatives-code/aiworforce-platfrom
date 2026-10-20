# Independent Discovery routing audit

**A7 remains NO-GO.** No architecture fixes are included. This branch contains an offline audit harness and synthetic execution records only.

Forty scenarios exercise the real mission compiler, capability graph, strategy/plan validators, readiness policy, capability engine, claim verifier phase, canonical eligibility, persistence plans, Workbench and outcome reducers. External compiler/planner/evaluator responses and provider results are injected. Unsupported comment functionality is never made executable by the harness.

## Tested snapshots and PR review

| Snapshot | Exact SHA | State at publication |
|---|---|---|
| Original integration baseline | `e0a5daefa6b9ddfdca43aaa0fdcceffe9f7d7f61` | Initial audit base |
| Latest fetched launch/hardening | `5d86703712205a04d059a39cf0d38a0621fc3ddb` | Independently rerun; PR114 merge |
| PR113 | `623db1b43caefe58a905445c816b294ffbc88555` | OPEN, draft, separately checked out; not assumed merged |
| PR114 | head `110c9bec946921ae517f4aca65479ce3c06532f3`, merge `5d86703712205a04d059a39cf0d38a0621fc3ddb` | Became MERGED during audit |

PR114 was initially open at `16f26bbd80f58e64ec56c062b1da9d2d8066aec3`. Its final integration diff changes 11 CI/workflow/script/test/documentation files, zero application runtime files. The latest integration rerun has the same routing outcomes as the original baseline. This audit did not merge either PR or update their branches. PR113's criterion receipts, exact roles, provenance and evaluator-unavailable behavior are preserved in its separate comparison worktree.

## Evidence package

- [Complete scenario matrix](matrix.md): original customer requests, expected qualification, actual runtime statuses/counts on both current snapshots, and interpretation.
- [Capability map](capabilities.md) and [full registry/provider contracts](capability-map.json).
- [Recorded Mermaid paths](paths.md): 40 scenarios × 2 snapshots, including refusals.
- [Latest integration JSONL](integration-traces.jsonl), [PR113 JSONL](pr113-traces.jsonl), [original baseline JSONL](base-traces.jsonl). Each line joins the real compiler output with the execution record for one scenario.
- [Summary](summary.json), [compiler contract failures](pr113-semantics.json).
- [Offline tests](../../../tests/edge-functions/_shared/independentRoutingAudit.test.ts).

Each JSONL record contains the original request and supplied model proposal, compiled criteria/mandatory signals, graph and selection reason, Actor readiness, validated plan, simulated provider inputs/responses, compiled provider specs, evidence registry/identity/source timestamps, raw/parsed evaluator receipts, canonical decisions, Workbench, persistence plans, final-notice and terminal reductions, checkpoint resume, and bounded call counts. A null/empty stage after preflight refusal means **not reached**, not a successful zero-result provider retrieval. Normalized social fixtures are explicitly diagnostic-only; they are not collected mission evidence.

## Results

| Runtime scenario status | Integration | PR113 |
|---|---:|---:|
| PASS | 13 | 18 |
| FAIL | 12 | 7 |
| NOT SUPPORTED | 10 | 10 |
| BLOCKED | 3 | 3 |
| NOT TESTED | 2 | 2 |

H04 additionally fails the compiler semantic contract despite safely stopping as unsupported at runtime. Counting that as an overall scenario failure yields 13 integration failures and 8 PR113 failures. Compiler assertions overlap runtime scenarios; do not count them as four additional independent bugs.

The 85-test characterization lane passes on all three snapshots. It intentionally records known defects; green does **not** mean customer acceptance. Turning on `ROUTING_ASSERT_EXPECTATIONS=1` yields **69 pass / 16 fail** on integration and **74 pass / 11 fail** on PR113: 12/7 runtime expectation failures plus four compiler invariants. A separate focused existing lane passes **127/127**, covering executability, truthful feasibility, provider truth, social/news/growth evidence, per-signal windows, discovery strategy and execution-plan chains.

PR113 fixes five failures in this audit: wrong exact role (H10), invented receipt (R03), empty details (R04), optimistic batch followed by unavailable evaluator (R08), and foreign details identity (R11). Those protections are absent from current integration. Normal AE and explicit first-hire positives remain green. Stale/closed jobs, duplicate rows, employer conflicts, missing hiring evidence, invalid Actor/capability choices and unavailable job Actor controls behave safely at their exercised boundaries.

## Verified defects and smallest correction boundaries

Locations below refer to pinned PR113 unless stated otherwise. Severity reflects customer impact, not authorization to implement. All corrections are recommendations for Claude; no production implementation changed.

### P1 — Required founder evidence becomes an optional target (L08, C01, C04)

A company qualifies from a fresh AE posting although the request says its founder **must** have discussed outbound problems. No social provider runs. The compiled social criterion is `target`; its UNKNOWN verdict cannot block canonical qualification. Standalone social requests are refused correctly, but partial feasibility lets hiring continue in a combined request.

Root: [`missionCriteria.ts:729`](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/623db1b43caefe58a905445c816b294ffbc88555/supabase/functions/_shared/missionCriteria.ts#L729) only maps hiring/funding cue patterns; [`requirementElevation:843`](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/623db1b43caefe58a905445c816b294ffbc88555/supabase/functions/_shared/missionCriteria.ts#L843) falls back to phrase location and preceding modal language. A modal inside the founder clause is lost, including with a verbatim clause in the model proposal.

Smallest safe boundary: preserve explicit clause-level necessity in the frozen criteria, and make an unsupported mandatory clause a blocking UNKNOWN. Do not solve it by making a comment provider appear supported or by globally turning every preference into a hard criterion. Add positive preference and negative mandatory controls. **Upstream compiler addition to Claude's Q1 scope; Q1's decision authority alone cannot repair already lost intent.**

### P1 — “Must be hiring its first sales representative” passes an ordinary sales job (H02/H03)

Same request, same employer, same role: explicit first-hire text qualifies as expected; removing that text still qualifies with `first_in_function` absent and no Workbench caveat.

Root: [`missionCriteria.ts:586`](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/623db1b43caefe58a905445c816b294ffbc88555/supabase/functions/_shared/missionCriteria.ts#L586) retains the qualifier, but [`candidateEligibility.ts:296`](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/623db1b43caefe58a905445c816b294ffbc88555/supabase/functions/_shared/candidateEligibility.ts#L296) proves hiring by presence/role family without enforcing first-in-function. [`leadCapabilityGraph.ts:1036`](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/623db1b43caefe58a905445c816b294ffbc88555/supabase/functions/_shared/leadCapabilityGraph.ts#L1036) treats first-in-function as a target even when the customer makes it mandatory.

Smallest safe boundary: mandatory qualifiers need their own evidence-backed obligation or equivalent check. Ordinary jobs leave it UNKNOWN; explicit, attributable first-hire language may prove it. Preserve optional first-hire preferences. **Related to Q1/Q2; ownership needs explicit coordination.**

### P1 — Cross-signal OR is compiled as independent hard requirements (C02)

“Hiring Account Executives OR recent funding” produces hard hiring and funding criteria without a cross-dimension alternative group. Declarative playbooks report `any_may_satisfy`, but that does not survive as canonical boolean semantics. [`leadCapabilityGraph.ts:751`](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/623db1b43caefe58a905445c816b294ffbc88555/supabase/functions/_shared/leadCapabilityGraph.ts#L751) suppresses hiring-led discovery whenever funding exists. [`candidateEligibility.ts:491`](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/623db1b43caefe58a905445c816b294ffbc88555/supabase/functions/_shared/candidateEligibility.ts#L491) groups alternatives by dimension, so merely adding the current `any_of` array across dimensions is insufficient.

Exact proof: compiler invariant fails, the actual route uses profile discovery and funding verification rather than job discovery. The observed zero qualification is **not isolated proof** of a fully evidenced OR false negative: business proof is also absent in this general-company harness and the website phase is not run. The boolean-contract loss itself is deterministic and independent of that limitation.

Smallest safe boundary: preserve the customer's cross-signal expression in the approved criteria contract and use it consistently for planning/decision. Until supported, reject or explicitly clarify this request rather than promise OR semantics. **Additional compiler/graph scope; coordinate before changing Q1's schema.**

### P2 — A mixed signal request replaces an explicit 30-day social window with 90 days (C04)

Hiring within seven days is retained; founder discussion within thirty days becomes ninety. [`missionCriteria.ts:353`](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/623db1b43caefe58a905445c816b294ffbc88555/supabase/functions/_shared/missionCriteria.ts#L353) associates windows through the limited `SIGNAL_CUE` table. Social falls back to its default after hiring claims the explicit nearby window. This proves compilation loss; actual social recency evaluation is unsupported and not claimed tested.

Smallest safe boundary: bind the time expression to its signal clause before freezing criteria, preserve explicit dates through serialization, and add 7d/30d mixed controls beside existing 7d/90d hiring/funding controls. **Upstream addition to Q2; event-date enforcement alone cannot recover the lost window.**

### P2 — Sales-team growth becomes physical expansion (H04)

“Must be rapidly expanding its sales team” compiles into `expansion`, selects generic discovery/news paths and stops unsupported. [`signalKinds.ts:225`](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/623db1b43caefe58a905445c816b294ffbc88555/supabase/functions/_shared/signalKinds.ts#L225) recognizes “expanding its team” but misses the department modifier; the expansion reader then claims the phrase. Expected headcount-growth semantics are absent.

Smallest safe boundary: preserve typed growth meaning from the compiler, with contrastive sales-team/headcount versus office/region expansion controls. Do not qualify “rapid growth” from a single posting or introduce a closed list of departments. **Routing/compiler ownership addition; unsupported headcount proof must remain explicit afterward.**

### Existing confirmed defects already in Claude's plan

- **P1 R09:** aggregate evaluator FAIL plus individually PASS receipts still qualifies. [`leadCapabilityEngine.ts:11854`](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/623db1b43caefe58a905445c816b294ffbc88555/supabase/functions/_shared/leadCapabilityEngine.ts#L11854) projects criterion verdicts without the overall veto. Prior G09; **Q1/R1 already owned**. Keep veto as a cap, without new model calls.
- **P2 H05:** recruiting agencies hiring their own staff are dropped by the unconditional [`jobEmployerAgencyReason` filter at 6169](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/623db1b43caefe58a905445c816b294ffbc88555/supabase/functions/_shared/leadCapabilityEngine.ts#L6169). Prior agency finding; **Q3/R5 already owned**. Honor explicit employer ICP at discovery admission while retaining client-job attribution guards. Removing the filter alone is not proof that every recruiting-industry criterion will pass.

Ownership was checked against [Claude's full Q0–Q4 coordination comment](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/113#issuecomment-6284526188). The five upstream findings above were not individually assigned there; they overlap its frozen-criteria/evidence work and are reported for coordination rather than independently fixed.

## Supported versus unsupported categories

Fresh open matched-employer hiring has an executable jobs → dedupe/identity → details → qualification chain. Funding discovery's Datahyena Actor is carded, not live; the actual fallback is profile discovery followed by READY funding verifier Actors. F02 executes the real funding claim phase with matching source URL, identity, date and round: funding PASS. It does not certify a positive full mission because cached website/business verification is outside this harness.

Founder comments, founder-post buying intent, comment negation, commenter employment and founder identity do not have a complete executable qualification chain here. Provider cards and normalizers are present; neither proves engine support. L04–L06 preserve fixture content/author/date diagnostically and stop before semantic evaluation. Do not present them as passed buying-intent, founder-role or old-comment rejection tests.

Expansion/product-launch discovery needs extraction work; company posts and technology verification need engine work. Some news verification executors exist, but readiness still prevents production selection. Technology inventory is not proof of recent adoption. See every registered capability/provider in the map rather than infer support from a named Actor or playbook.

## Customer projections and execution limits

Exercised company results agree across canonical keys, Workbench counts, persistence-plan row counts, final-notice qualification counts and terminal delivered counts. Completed checkpoint replays do not promote held companies. **Wrong canonical decisions also propagate consistently**: C01/H03/R09 each become a qualified row plan and terminal delivered count of one.

These are real pure reducers, not database writes. The notice is explicitly given zero persisted rows; its “0 saved / 1 qualified” text reflects that harness input, not a proven production notice defect. Zero spend and absent funnel fields in these reducer inputs do not describe the engine's actual simulated provider/model counts; those are recorded separately under research_steps/resume. Database lead/account/task/lineage state, HTTP presentation and transactional agreement are NOT TESTED. Current run-agent Phase C also independently derives criteria at 5239 and calls fact-only eligibility at 5242/5399; those known Q4 paths must be tested in Claude's local database suite.

Normal hiring records two planner invocations (initial plus amendment), one grounded batch and one evaluator: four injected model-stage invocations. Each trace records before/after checkpoint counts. The harness enforces finite planner/evaluator/provider counts across two slices and no comment/technology Actor substitution. Funding verification uses real compiled specs, READY checks, idempotency hashes, `ledgerBoundCall` and guarded invocation with synthetic responses. No external network permission is granted to the test runtime. Cached Deno imports are resolved by the toolchain.

This does not re-prove SQL spending-admission concurrency, real paid-provider idempotency, account permissions, current quotes or an exact production-wide model-call budget. Timeout tests inject exceptions at external boundaries; they do not measure network deadlines. R10 exercises AbortError plus a completed engine checkpoint and observes no repeated calls; queue leases, in-flight cancellation, pending-Actor recovery, retry billing and actual worker resume remain NOT TESTED. No unbounded evaluation loop appeared in these bounded cases.

## Reproduction

Run in this audit checkout. Use separate detached worktrees for comparison; do not check out or modify Claude's branch. Replace the two source paths with equivalent local pinned checkouts.

```sh
# Latest integration source
ROUTING_AUDIT_SOURCE_ROOT=/absolute/path/to/integration-at-5d867037 \
ROUTING_AUDIT_COMMIT=5d86703712205a04d059a39cf0d38a0621fc3ddb \
deno test --node-modules-dir=auto --lock=/tmp/agentory-routing-deno.lock \
  --allow-read --allow-env tests/edge-functions/_shared/independentRoutingAudit.test.ts

# PR113 source, same harness and external responses
ROUTING_AUDIT_SOURCE_ROOT=/absolute/path/to/pr113-at-623db1b4 \
ROUTING_AUDIT_COMMIT=623db1b43caefe58a905445c816b294ffbc88555 \
deno test --node-modules-dir=auto --lock=/tmp/agentory-routing-deno.lock \
  --allow-read --allow-env tests/edge-functions/_shared/independentRoutingAudit.test.ts

# Fail deterministically on customer expectations rather than characterize them:
# add ROUTING_ASSERT_EXPECTATIONS=1 to either command.
# Isolate a case with --filter 'routing execution H03', or compiler invariants
# with --filter 'routing semantic contract'. Traces use ROUTING_* JSON prefixes.
```

Fixture dates are relative to execution time with large margins so semantic outcomes are repeatable, while observed timestamps naturally differ. Model outputs are realistic structured stand-ins, not claims about live GPT's interpretation rate. Existing lockfiles and production code are not changed.

Focused existing lane (same Deno flags):

```text
tests/edge-functions/_shared/p0ExecutabilityRegistry.test.ts
tests/edge-functions/_shared/p0TruthfulFeasibility.test.ts
tests/edge-functions/_shared/signalProviderTruth.test.ts
tests/edge-functions/_shared/socialNewsGrowthEvidence.test.ts
tests/edge-functions/_shared/rc06WindowPerSignal.test.ts
tests/edge-functions/_shared/leadDiscoveryStrategy.test.ts
tests/edge-functions/_shared/executionPlanChain.test.ts
```

## Recommendations and acceptance boundary

1. **A7 blockers:** preserve and integrate PR113's five demonstrated protections; resolve Claude's Q1 aggregate veto and complete the approved Q0–Q4 qualification/projection acceptance work. Revalidate on the final combined SHA. This audit is not full Stage 2 or spending authorization.
2. Add mandatory founder versus preferred-founder, first-hire positive versus ordinary-hire negative, cross-dimension AND/OR, separate-window, and sales-team versus physical-expansion fixtures to the approved compiler snapshot contract before broader customer readiness. Coordinate the five new upstream findings with Claude before architectural edits.
3. Keep unsupported social/comment/news/technology routes visibly unsupported. A mixed mission must not silently discard a mandatory unsupported signal. Test zero Actor calls for refused routes and prohibit substitution purchases.
4. On disposable local DBs, run actual compiler → orchestrator → persistence → Workbench → final task/lineage reads with missing, contradictory, stale and cross-employer evidence, evaluator timeout, aggregate veto, interrupted writes and resume. Assert no later fact-only projection upgrades UNKNOWN/rejected companies, and preserve the existing SQL admission and provider-operation identity tests.
5. For final narrow A7, require exact-role negative controls, missing/invalid receipts, missing mandatory criterion, wrong employer, old/closed/duplicate jobs, headquarters conflict, optimistic batch/evaluator timeout, aggregate FAIL/REVIEW, snapshot replay and model/provider caps. Include distinct tests for results qualified, results actually persisted and customer notices. Run broader comment/OR/growth requests as refusal or known-gap controls until supported.

Mandatory first-hire, social, cross-signal OR and growth defects block those customer promises even if a narrowly scoped A7 excludes them. H05 blocks recruiting-agency missions; R09 and the five integration regressions affect the general qualification foundation. Operational restrictions, webhook/token preflight, current prices, OpenAI budget and recovery-migration decisions remain separate prerequisites; this audit performs none of them.

GPT receipts establish that cited text exists, not that its meaning, employment claim, first-hire completeness or buying intent is correct. Negation, self-reported titles, ambiguous entities, missing negative evidence and conflicting sources still require conservative UNKNOWN decisions and adversarial model evaluation. Synthetic external responses establish deterministic application behavior, not live-model accuracy or provider reliability.
