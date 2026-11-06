# Mission Contract (ADR-001): implementation status

**Code:** `supabase/functions/_shared/missionContract/`. **Design:** `agentory-architecture-review-2026-11.md`.

## What it is

One authoritative statement of what a user asked for.

```
request → GPT (ONE structured answer, v4 schema) → contractFromProposal (deterministic validation)
        → Mission Contract → approvability → contractHash (approval identity)
        → compileContract (frozen mission; criterion id = requirement id)
        → planner / executor / qualification (unchanged; read only the frozen criteria)
        → requirementVerdicts (one per requirement, evidence-backed)
```

| File | Role |
|---|---|
| `contract.ts` | Types (discriminated requirements, origins, windows), invariants (`contractProblems`, `approvability`), canonical JSON, `contractHash`, `hardRequirementSet`, `disclosures` |
| `interpret.ts` | v4 GPT schema: **one channel**, closed vocabulary, no free-form `hard_constraints`. `contractFromProposal`: span grounding, registry checks, the `DEFAULT_SIGNAL_WINDOWS` defaults recorded as assumptions, the audience policy on the item's own span, unsupported items **disclosed**, ambiguities block approval |
| `gptInterpreter.ts` | The model call (guarded `gptStructured`, injected for tests). A model failure is an error, never a fallback reading |
| `compile.ts` | Contract → frozen mission (deterministic, reads only the contract) |
| `boundary.ts` | The one compatibility boundary: any compiled or stored mission → contract, **losslessly**, or a named refusal |
| `invariants.ts` | I1 compile, I2 plan, I3 approval, I4 verdicts; `requirementVerdicts` |
| `brain.ts` | Company Brain → contract, before approval. Precedence: user > Brain policy (size rule, industry exclusions) > Brain preference (fills open dimensions, `preferred` only) > history (never a requirement). Conflicts are reported; an explicit workspace exclusion that conflicts with the request blocks approval as a question |
| `chatMission.ts` | Production-chat bridge: `missionFromContract` (contract → frozen lead-mission-v1), `contractBindingOf` / `verifyApprovalBinding` (approval identity for v1 and v4 cards), `contractMissionIntegrity` (pre-execution check), `compareContracts` (shadow metrics), flags |
| `chatIntegration.ts` | pilot-chat's two decisions: `contractForCard` (off / shadow / v4) and `checkStart` |
| `authority.ts` | The version boundary: a mission's own version decides contract vs legacy authority. `executionQueryOf`, `runtimeBrainGatesFromContract` |

## Invariants (enforced in code, tested)

- **I1:** the frozen mission's criteria are exactly the contract's executable requirements.
- **I2:** the plan's hard requirements are exactly the contract's.
- **I3:** what runs has the approved contract hash. The approval token replays **the contract itself**, and a changed contract is refused before any provider call.
- **I4:** one verdict per executable required requirement. `verified` requires cited evidence. Unknown or not-evaluated is `unverified`, never verified. Disclosed requirements are `not_applicable`.
- **Absence is not negation; a preference never gates; contradictions and empty missions are refused.**

## Where it runs

| Path | Flag (all off) | Behaviour |
|---|---|---|
| `lead-pipeline` strategy_plan/run (TEST) | `AGENTORY_MISSION_CONTRACT_V4=enabled` | v4 interpretation, Brain applied to the contract, plan hash binds `mission-contract-v1:<hash>`, per-requirement verdicts |
| `pilot-chat` lead cards | none | card stamped with `mission_contract_binding`; Start checked and logged (observe) |
| `pilot-chat` lead cards | `AGENTORY_CHAT_CONTRACT_V4_SHADOW=enabled` | v4 read beside v1, comparison stored, never executed |
| `pilot-chat` lead cards | `AGENTORY_CHAT_CONTRACT_V4=enabled` | the card IS the v4 contract; no v1 fallback |
| `pilot-chat` Start | `AGENTORY_CHAT_CONTRACT_BINDING=enforce` | a Start that differs from its card is refused |
| `pilot-chat` | `AGENTORY_CHAT_CONTRACT_V4_WORKSPACES=<ids>` | scopes shadow/v4 to those workspaces |
| `orchestrate`, `run-agent` (and the Railway worker, in-process) | none | a v4 mission that no longer equals its approved contract is refused before any work; v1 untouched |
| run-agent readers (search intent, intent model, YC cohort, runtime Brain gates, mission precedence) | none | v4 missions read the contract (`authority.ts`); v1 unchanged |

Production runs v1 and no flag is set anywhere. Rollout: [`mission-contract-rollout.md`](mission-contract-rollout.md). What still reads the sentence: [`legacy-interpreter-inventory.md`](legacy-interpreter-inventory.md).

## Evidence (offline, $0)

| Check | Result |
|---|---|
| Historical round trip: 355 missions → contract → compiled | **353 identical**, 0 lossy; 2 invalid meanings refused |
| Corpus, 55 phrasings, through v4 | **55/55** (one approved difference: M17 raw-text "saas") |
| Live study run #24, 165 real answers, replayed through v4 | **161/165**; the 4 failures are model or transport only |
| Production-chat bridge: v4 contract → lead-mission-v1 → binding hash | **55/55** exact |
| Shadow, v3 vs v4 (55 corpus + 162 live answers) | 0 added, 0 strengthened, 0 weakened, 0 approval differences; the only hard-plan difference is M17 |
| Job-family inference from contract text vs the sentence | equal in 45/45 where the sentence yields a family; 5 more resolved |
| End to end, stubbed model + mock providers (lead-pipeline contract mode), 14 categories | pass (`multiProvider.test.ts`, "v4 e2e") |
| Mutations (dropped / invented hard requirement, hard→preference, preference→hard, Brain overriding the user, approval reuse, execution after modification, unknown or evidence-less "verified", comparison blind spot) | **all caught** |

## Not done yet (continuation)

1. **Independent live v4 study (release gate G2): PASSED**, 164/165 (99.4%) in run 42194537607 at `07add82c`, spending $0.047 over 165 calls. The single failure (a quoted role with no id was dropped) is fixed and pinned. The current interpreter reads all 165 recorded answers correctly. Report: `docs/benchmarks/live-paraphrase/2026-11-06-contract-v4.md`.
2. **Enabled on TEST** (2026-11-06): the smoke passes with v4 live (`docs/launch/test-reports/2026-11-06-v4-enabled-smoke.md`). Still needed: one owner-approved `strategy_run` (Apify, ≤ $0.25) to observe verdicts on real evidence.
3. **Production rollout stages 1–5** (owner-approved, see the rollout doc).
4. **Lead routing still starts with Chat Brain RequestV1** (two model calls per v4 card). Fold routing into the contract interpreter.
5. **Retire** the legacy interpreters once v4 is authoritative everywhere (inventory §B).
