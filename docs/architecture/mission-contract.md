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

## Invariants (enforced in code, tested)

- **I1:** the frozen mission's criteria are exactly the contract's executable requirements.
- **I2:** the plan's hard requirements are exactly the contract's.
- **I3:** what runs has the approved contract hash. The approval token replays **the contract itself**, and a changed contract is refused before any provider call.
- **I4:** one verdict per executable required requirement. `verified` requires cited evidence. Unknown or not-evaluated is `unverified`, never verified. Disclosed requirements are `not_applicable`.
- **Absence is not negation; a preference never gates; contradictions and empty missions are refused.**

## Where it runs

`lead-pipeline` (`strategy_plan` / `strategy_run`) when **`AGENTORY_MISSION_CONTRACT_V4=enabled`** is set on the function.
- TEST only; it is not set anywhere today.
- The plan hash binds `mission-contract-v1:<contract hash>`.
- Production (`pilot-chat` / `run-agent`) is unchanged and still runs v1.

## Evidence (offline, $0)

| Check | Result |
|---|---|
| Historical round trip: 355 missions (corpus v1/v3, run #24 compilations, every persisted production / quality / canary mission) → contract → compiled | **353 identical** (criteria and planner reading), 0 lossy. The 2 refused are invalid meanings: no requirement; size 100–0 |
| Corpus, 55 phrasings, through v4 | **55/55** (one approved difference: `tests/fixtures/mission-reliability/v1/v4-expectations.json`, M17's raw-text "saas" duplicate) |
| Live study run #24, 165 real answers, through v4 | **161/165**. The 4 failures: 2 incomplete responses, 1 genuine clarification, 1 misreading. None is compiler-side, with no reconciler code in the path |
| v4 study dry run (guarded transport, stub model) | 165/165 |

## Not done yet (continuation)

1. **Independent live v4 study (release gate G2).** Needs owner authorization:
   - dispatch `discovery-test-worker.yml` with `canary_stage=study_v4`, the merged commit, and the approval phrase `run the live paraphrase study within 2 USD`;
   - gate: at least 157/165.
2. **Enable on TEST:** set `AGENTORY_MISSION_CONTRACT_V4=enabled` on TEST `lead-pipeline` (owner), then run the TEST smoke and an approved plan / run.
3. **Company Brain in contract mode:** not yet applied. TEST holds no Brain. Brain values must become requirements with `company_brain_*` origins.
4. **Production chat path** (`pilot-chat` → `orchestrate` → `run-agent`):
   - compile through the contract in shadow (the boundary converts every stored mission exactly);
   - bind `approvals` to `contractHash`;
   - strangle `leadEntityIntent` / `leadSearchIntent` / `jobIntentTaxonomy` behind the contract.
5. **Retire** `restatementReconciler.ts`, the `restates*` functions and the deterministic fallback, once v4 is authoritative everywhere and stored missions are frozen.
