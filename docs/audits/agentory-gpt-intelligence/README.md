# Agentory GPT intelligence architecture audit

2026-10-20. **Architecture audit and plan only. A7 remains NO-GO.**

Agentory needs better preservation of meaning between its existing model stages,
not an LLM in every function. It already uses real OpenAI/Anthropic boundaries
for interpretation, planning, evidence reading and writing. Several
deterministic semantic readers still reshape those interpretations;
syntactically valid output can therefore lose a customer's mandatory clause
before qualification sees it. Adding a second evaluator cannot recover a
requirement already erased upstream.

The strongest reusable pattern is already present: a model proposes a typed plan
or interpretation, code validates the available capabilities, evidence and
budget, and one canonical decision controls every projection. Complete Claude's
Q1–Q4 first. Improve the existing interpretation and grounding calls next, while
leaving authorization, identity, spending, persistence and execution invariants
in code.

## Scope and evidence

| Snapshot                          | Pinned commit                              | Status observed                                 |
| --------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Latest fetched `launch/hardening` | `5d86703712205a04d059a39cf0d38a0621fc3ddb` | Integration baseline                            |
| PR #113                           | `671edf35da4b4271ffcbd849ffece856ebd1057f` | OPEN draft; qualification hardening, not merged |
| PR #123                           | `2d0a6327978ba5605d12f6e2315af3df78041ccc` | OPEN draft; Q1 stacked on #113                  |
| PR #125                           | `a542b2f1e768e48d3ee794145b982d910d8253c7` | OPEN draft; Q2 stacked on #123                  |

Q3/Q4 are not treated as shipped. Claude's latest coordination comment describes
Q3 compiler-fidelity, unsupported-requirement and routing work, including
test-only draft #126. This audit changes none of those files or qualification
behavior. The integration kernel document and some model-routing comments
describe older architectures; executable call sites take precedence over those
comments.

Before publication, additional Q3 work was inspected: draft #129 at
`4e738a1fc522cd52b9c816d098a460f854f5b108` contains test-only compiler contracts
and the
[Q3 design](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/4e738a1fc522cd52b9c816d098a460f854f5b108/docs/launch/qualification-acceptance/q3-design.md);
its
[Q1–Q4 acceptance index](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/4e738a1fc522cd52b9c816d098a460f854f5b108/docs/launch/qualification-acceptance/README.md)
also defines the final native persistence/replay matrix. These designs were
read, not rerun or treated as deployed. Draft #127 (`abb12c83`) and #128
(`5d831405`) now contain agency-routing/interpretive-industry work; their
metadata was inspected, but their implementation was not independently tested
here. Thus H05 below is a measured **integration/Q2** failure, not a claim about
those newer drafts. R1's post-Q work should evaluate and extend the accepted Q3
contract for diverse language, not create a parallel implementation of its
already planned fixes.

Fresh offline receipts:

- The existing 40-scenario routing harness was rerun separately on all four
  pins: **85/85 characterization tests per snapshot**. These record known
  defects; characterization green does not mean customer expectations passed.
- On Q2, strict customer expectations produce **76 pass / 9 fail**. Remaining
  failures are L08, H05, C01, C02, C04 plus compiler assertions C01/C02/C04/H04.
- **120/120** focused request/compiler/model-policy/evidence/Brain/memory tests;
  **67/67** admission/router/request-body/telemetry tests; **11/11** Q2
  integrity tests. Additional funding/relevance controls pass **34/34 at
  runtime**, with a separate baseline fixture type-check failure preserved in
  the test receipt.
- Twelve new compiler/graph probes run on integration and Q2 with explicit mock
  model proposals. They do not execute providers or customer workflows.
- New T01 red proof: parseable JSON with `finish_reason: length` is accepted by
  the real GPT transport. Its strict assertion fails deterministically.
- E01 shows that a verbatim negative quotation labelled `supports` survives the
  extraction parser, while a fabricated quote is rejected. This proves the limit
  of substring validation, **not a final false qualification**.

No live model accuracy, provider reliability, deployed feature or native
database isolation is certified. Tests have no application network permission.
No provider purchase, migration, hosted write, deployment, merge or A7 dispatch
occurred.

## Reading guide

1. [Current intelligence map](current-map.md): real lifecycle, models, context,
   parsers, recovery and agent collaboration.
2. [Intelligence gaps and hardcoding audit](gaps.md): classifications, causes
   and the deterministic boundaries that must stay authoritative.
3. [Diverse scenarios](scenarios.md): twelve customer families and four-snapshot
   routing comparison, with actual JSON traces.
4. [Recommended architecture and roadmap](architecture-roadmap.md): actual
   versus proposed flows; small PRs, inputs/outputs, acceptance and ownership.
5. [Model-call budget analysis](budgets.md): tokens, cost, latency, retries,
   caching and unchanged A7 ceilings.
6. [Testing and limitations](testing.md), [source index](source-index.md),
   [machine-readable call-site inventory](evidence/model-call-sites.json).

## Five priorities after Q1–Q4

1. **Lossless intent contract in the existing compiler call.** Retain original
   clause spans, necessity, negation, subject, boolean grouping and each time
   window. Clarify ambiguity instead of inventing precision. This improves every
   downstream step without an extra normal-path call.
2. **Contextual, source-backed evidence interpretation in existing reading and
   evaluation calls.** Distinguish assertion from quotation, plans from events,
   the employer from a recruiting client, and expressed demand from speculation.
   Quote presence remains a prerequisite, never a semantic proof.
3. **Improve the existing capability-aware research planner and route
   controller.** Rank questions by decision value using real
   capability/readiness and reuse already purchased evidence. Refuse unsupported
   work and stop when a requirement is blocked. Do not add another free-running
   planner.
4. **Relevant, scoped context with controlled feedback.** Fix the existing
   memory association risk and adopt the disabled P1 boundary before model-rich
   client tasks. Snapshot approved Brain/rules/sources; propose updates for
   review instead of letting generated outputs rewrite truth.
5. **An enforced task-model contract and grounded caller-brief schema.** Reuse
   existing transports and ledger, preserve explicit provider choice, disable
   unsupported adapters, and produce reviewer-ready briefs from approved
   existing leads. This is the highest-value Nosh pilot extension; no new
   prospecting or agent debate is needed.

Items 1–3 do not authorize new A7 calls. Nosh's pilot depends on P1 native
acceptance and later reviewed P2–P8 work; this report does not implement them.
OO-01/OO-02/OO-03 remain mandatory before automated outreach or approved
external dispatch.

## Coordination

This report incorporates the independently reproduced routing findings from
`codex/discovery-routing-audit` (`aca94e6b`), Outbound Outpost #122
(`bc960c3e`), and the disabled P1 boundary #124 (`2ffd6f6c`). These remain
separate branches, not assumed merged or deployed. Apollo is a working
assumption for existing lead management; exact iGTM/Jungler products, access and
Apollo's CRM-of- record status remain unconfirmed. No recommendation depends on
those unverified APIs. Compiler/qualification remediation stays with Claude's
coordinated Q stages.
