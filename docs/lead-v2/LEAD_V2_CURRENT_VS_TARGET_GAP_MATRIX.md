# Lead V2 — Current vs Target Gap Matrix

**Status:** discovery only. "Target" = the architecture recommended in `LEAD_V2_FINAL_ARCHITECTURE_REVIEW.md` (a modified version of the proposed Opportunity Retrieval Architecture). Verdicts: **KEEP** (as-is) · **KEEP+MODIFY** · **REPLACE** · **DELETE** · **UNKNOWN**.

---

## A. Concern-level gap matrix

| Concern | Current | Target | Difference | Risk | Verdict |
|---|---|---|---|---|---|
| Mission representation | `LeadMissionV1`, hashed, compiled in pilot-chat; Brain merged in | same object, plus `intent_terms`, typed `Constraint[]` with `hardness` + `source` | small | low | **KEEP+MODIFY** |
| Constraint handling | `hard_constraints` map + `company_profile` + `required_signals`; hardness implicit | one constraint list: `hard` / `preference` / `signal`, each with provenance | medium | medium (semantics shift) | **KEEP+MODIFY** |
| Hard vs soft semantics | hard constraints mostly enforced at evaluation; Brain bounds leak into discovery | hard = eligibility gate (deterministic); preference = ranking; signal = surfacing reason | large | high if softened silently | **REPLACE** (policy layer) |
| Opportunity signals | none as a concept; hiring is a "required signal" | first-class `signal` constraints, fed by Signals infra where available | large | medium (noise) | **NEW** (reuse Signals modules) |
| Query generation | execution planner + amendment + discovery planner + strategist + deterministic packs | one Retrieval Planner (GPT) emitting query families in one plan | large | high | **REPLACE** |
| Multi-query retrieval | accidental: 5 unrelated questions across attempts | deliberate: a portfolio of ≤N families with budgets and stop rules | large | high (spend) | **NEW** |
| Planner ownership | 5 live planner stacks | 1 planner + 1 evidence planner; amendments are the only change path | large | high | **REPLACE** |
| Search strategy | implicit in whichever planner ran last | explicit in the versioned plan | large | medium | **REPLACE** |
| Provider selection | GPT picks, validated against catalog; plus playbooks/source plans | GPT proposes per family, code validates against the capability matrix | medium | low | **KEEP+MODIFY** |
| Provider input generation | 3 builder families + scattered clamps | one spec compiler + pure per-actor serialisers | large | medium | **REPLACE** |
| Query mutation | silent (amendment replaces plan, logs "no change") | forbidden except via `PlanAmendment` with hash diff | large | low once built | **REPLACE** |
| Plan versioning | none (blob in `tasks.result`) | `lead_plan_versions` | large | low | **NEW** |
| Amendments | only refused removals recorded | typed amendments, trigger enum | large | low | **NEW** |
| Idempotency | `completed_runs` in state + query-family guard + logical keys | spec key with DB unique constraint across lineage | medium | low | **KEEP+MODIFY** (move to DB) |
| Candidate dedupe | `addCompany` keys; `prequalificationKey` | entity resolver keyed by canonical domain / LinkedIn URL, union across families | medium | medium | **KEEP+MODIFY** |
| Evidence storage | in checkpoint blob; `company_web_evidence`, `company_headcount_snapshots` cached; `lead_evidence` unused by leads | typed evidence items in `lead_evidence` (mission-scoped), caches kept | medium | medium (shared table) | **KEEP+MODIFY** |
| Candidate lifecycle | `deriveLifecycle` + investigation states + checkpoint stages; 6 writers of `lead_candidates` | one candidate record: exclusive state + evidence dimensions | medium | medium | **REPLACE** (projection kept) |
| Qualification | binary pass/reject/unknown via mission evaluation + Brain fit + grounded (shadow) | deterministic eligibility + GPT opportunity label constrained by code | large | high (quality) | **REPLACE** |
| Opportunity reasoning | partial: `opportunityPortfolio` (qualified/review/watch, tiers), `groundedClaims` with evidence ids | reasoner over evidence items; labels exact / strong / worth / low | medium | high (hallucination) | **KEEP+MODIFY** |
| Cost ledger | estimate + early read; Firecrawl unpriced on evidence path | receipt settlement, floors, per-family budgets | medium | low | **KEEP+MODIFY** |
| Continuation | V2 queue slices; each resume reopens discovery | resume plan version, restore portfolio + telemetry | medium | medium | **KEEP+MODIFY** |
| Retries | 5 attempts = 5 slices | retries = faults only; slices unbounded by count, bounded by time/spend | medium | low | **REPLACE** (policy) |
| Adaptive sourcing | replenishment + replan + amendment, 3 triggers | Retrieval Controller rule + amendment | large | medium | **REPLACE** |
| Observability | logs + ledger + state blob | append-only mission events + spec provenance | large | low | **NEW** |
| Workbench projection | rows + 3 count owners | one projection from candidate records, new labels | medium | medium (UI contract) | **KEEP+MODIFY** |

**Overall size:** the planning/retrieval/qualification core is a **large** change; infrastructure (queue, worker, lease, checkpoint, ledger, catalog, identity rules, Brain policy, Workbench shell) is **small-to-medium**. Net: **LARGE, not fundamental.**

---

## B. Module-by-module verdicts

### Request / control plane
| Module | Responsibility | Verdict | Note |
|---|---|---|---|
| `pilot-chat/index.ts` | chat, mission compile, confirmation card | KEEP+MODIFY | card must show hard/preference/signal and feasibility choices |
| `leadMissionCompiler.ts` | GPT proposal → `LeadMissionV1` | KEEP+MODIFY | add hardness policy + `intent_terms` |
| `leadMission.ts` (`mergeCompanyBrainIntoMission`, parser) | mission type, Brain merge | KEEP+MODIFY | Brain merge must emit constraints with `source: brain_inherited` |
| `requestV1.ts`, `requestV1Parser.ts` | RequestV1 / parts | KEEP | not on the retrieval path |
| `chatBrain.ts` (`understandRequest`) | Pilot understanding | KEEP | unmetered — add ledger rows |
| `missionConfirmationCard.ts`, `missionPreview.ts` | preview | KEEP+MODIFY | render feasibility decisions |
| `orchestrate/index.ts` | task_plans, V1/V2 routing | KEEP | |
| `enqueue-lead-mission` | queue insert | KEEP | |
| `leadExecutionEngine.ts` | V1/V2 resolver, ceilings | KEEP | |

### Worker / execution
| Module | Verdict | Note |
|---|---|---|
| `worker/main.ts`, `leadMissionRunner.ts`, `health.ts` | KEEP+MODIFY | continuation vs retry split |
| `leadMissionTerminal.ts` | KEEP | terminal reconciliation works |
| `leadMissionV2Request.ts` | KEEP | canary provenance |
| queue RPCs, `lead_lineages` lease | KEEP | |
| `leadAutoContinuation.ts`, `stalledLeadResume.ts`, `resume-stalled-leads`, `continue-workflow` | KEEP (V1 only) | must stay excluded from V2 tasks |
| `tasks_sweep_stuck_runs` | KEEP+MODIFY | skip V2-owned tasks |

### Planning / retrieval
| Module | Verdict | Note |
|---|---|---|
| `leadCapabilityGraph.ts` | KEEP+MODIFY | becomes the capability *requirements* input to the planner |
| `gptExecutionPlanner.ts` | REPLACE | by the Retrieval Planner |
| `leadExecutionPlan.ts` (validate/payload) | REPLACE | validation logic reused inside the new validator |
| execution-plan amendment (engine `5250–5340`) | DELETE | replaced by `PlanAmendment` |
| `gptDiscoveryPlanner.ts`, `leadDiscoveryStrategy.ts` | REPLACE | discovery is a query family, not a separate planner |
| `leadStrategy/*`, `leadStrategyOwner.ts` | DELETE (after port) | broadening becomes an adjacent-query family |
| `intelligence/leads/*` (planner, bridge, authority, query packs, adaptive runtime) | DELETE (after port) | third planner stack |
| `multiRoundController.ts`, `multiRoundBinding.ts` | DELETE | second sourcing loop |
| `companyFirstQuotaController.ts` | DELETE | legacy quota loop |
| `companyFirstRouteExecutor.ts`, `executeRunAgentCompanyFirstSourcing.ts` | DELETE (V2) / KEEP (V1 until GA) | |
| `hiringSourcePlan.ts`, `compoundSourcingPipeline.ts`, `sequentialSourceRuntime.ts`, `leadResearchPlaybooks.ts` | DELETE (after port) | deterministic ladders |
| `commercialSignalPolicy.ts` (`classifyTitle`, `BROADENING_ROUNDS`) | KEEP+MODIFY | keep classification; delete ladder |
| `leadRoleTaxonomy.ts`, `roleFamilies.ts`, `hiringSearchVocabulary.ts` | KEEP | vocabulary |
| `leadInvestigationBudget.ts`, `poolRanking.ts`, `leadEligiblePool.ts` | KEEP+MODIFY | fold into Retrieval Controller budget |
| `leadCapabilityEngine.ts` (9,854 lines) | KEEP+MODIFY → split | keep stage executors; extract planning, budgeting, compiling, cost |

### Provider layer
| Module | Verdict | Note |
|---|---|---|
| `hiringActorCatalog.ts` | KEEP+MODIFY | single registry; gains evidence powers |
| `actorEvidenceCapability.ts` | KEEP+MODIFY | merged into catalog as the capability matrix |
| `actorRegistry.ts`, `actorCapabilityRegistry.ts`, `apifyIntelligenceRegistry.ts`, `intelligence/capabilityRegistry.ts` | DELETE (after port) | 4 duplicate registries |
| `hiringActorInputs.ts` (13 compilers) | KEEP+MODIFY | pure serialisers |
| `compileActorInput`, `compileFirstProviderCall`, `buildIdentitySearchInput`, `actorInputPlanner.ts`, `actorInputStrategy.ts`, `discoveryInputMerge.ts` | DELETE | spec compiler replaces them |
| `toolRegistry.ts` (`runTool`) | KEEP | shared transport (5 other features) |
| `hiringActorNormalizers.ts` | KEEP | |
| `actorInputContracts.ts` | KEEP | verified contracts |

### Identity / evidence
| Module | Verdict | Note |
|---|---|---|
| `companyIdentityResolution.ts`, `leadCommercialPrequalification.acceptLinkedInMatch` | KEEP | domain rule stays authoritative |
| `suppliedCompanyIdentity.ts`, `actorIdentity.ts`, `referentBinding.ts` | KEEP+MODIFY | consolidate into the entity resolver |
| `structuredCompanyEnrichment.ts`, `leadCompanyEvidence.ts`, `companyAggregatorEvidence.ts` | KEEP+MODIFY | emit evidence items |
| `webEvidenceRunner.ts`, `webEvidencePlanner.ts`, `webEvidenceExtraction.ts`, `webEvidenceStore.ts` | KEEP+MODIFY | becomes targeted evidence retrieval |
| `groundedClaims.ts`, `groundedBatchEvaluation.ts` | KEEP+MODIFY | the citation discipline for the reasoner |
| `headcountSnapshotStore.ts`, `headcountGrowth.ts` | KEEP | growth signal |
| `leadEvidenceRegistry.ts` | UNKNOWN | no exports found by pattern; inspect before deciding |

### Qualification / output
| Module | Verdict | Note |
|---|---|---|
| `missionEvaluation.ts`, `missionTriage.ts` | REPLACE | by eligibility gate + opportunity reasoner |
| `companyBrainSemanticFit.ts`, `leadQualificationVerdict.ts` | KEEP+MODIFY | inputs to the reasoner |
| `opportunityPortfolio.ts` | KEEP+MODIFY | becomes output classification |
| `missionQualificationContext.ts` | KEEP | vocabulary + bounds |
| `leadWorkbenchProjection.ts` | KEEP+MODIFY | project from candidate records |
| `qualifiedLeadPersistence.ts`, `leadMissionPersistenceProjection.ts` | KEEP+MODIFY | the single `lead_candidates` writer for missions |

### Cost
| Module | Verdict | Note |
|---|---|---|
| `providerCostModel.ts`, `firecrawlCostModel.ts`, `modelCostModel.ts` | KEEP | pricing functions only |
| `executionLedger.ts` | KEEP+MODIFY | settlement + spec join |
| `creditAuthorization.ts`, `creditPricing.ts` | KEEP | |
| `modelSpendCeiling.ts` | KEEP+MODIFY | count floors; per-feature sub-budgets |
| cost arithmetic in `intelligence/*`, `sequentialSourceRuntime.ts`, `radarDiagnostics.ts` | DELETE with their stacks | |

### Frontend
| Module | Verdict | Note |
|---|---|---|
| `LeadResultsView.tsx`, `RunSummaryHero.tsx` | KEEP+MODIFY | new labels, one count source |
| `src/lib/workbench/*` | KEEP+MODIFY | buckets → opportunity classes |
| `src/lib/qualifiedLead/*` | KEEP+MODIFY | continuation/quota views |
