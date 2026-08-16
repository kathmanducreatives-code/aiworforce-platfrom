# Agentory — Pre-R2 Cleanup Audit

**Read-only.** Nothing was implemented, deployed, migrated, or called. No model or provider
request was made.

| | |
|---|---|
| Repo | `/Users/prasidha/agentory-main-local` |
| Branch | `feat/lead-mission-v1` |
| HEAD | `88239fe9aa0d42aeae4eb9d64fe680549bfc920f` — *R1: give the Mission somewhere to put what the request actually said* |
| Working tree | 6 modified + 3 untracked, **all belonging to other work** (tour/, Sidebar, buildInfo, mcp/index.ts, `artifacts/`, 2 untracked tests). Nothing from this audit. |
| Surface audited | 249 modules in `supabase/functions/_shared/`, 30 edge functions, `src/lib/qualifiedLead/*`, `src/components/chat/workspace/workbench/*` |

---

## 0. Corrections to the prior audit — read these first

Four load-bearing claims from `Agentory_Current_State_and_Target_Architecture_Audit.md` did not
survive re-verification (§0.1–§0.4). §0.5 is different in kind: a doctrine correction ruled
*after* this audit was written, which overrides the "fallback" framing used in the original
draft. All five change the cleanup plan, so they lead.

### 0.1 `person_social_first` and `existing_list_first` are not code

```
grep -rn "person_social_first\|existing_list_first" . --exclude-dir=node_modules --exclude-dir=.git
```

returns **only hits inside `artifacts/*.md`**. Neither string exists in `supabase/`, `src/`, or
`tests/`. They are planning vocabulary invented by the audit, never implemented.

The real enum is in `leadEntityIntent.ts:349-372`:

```ts
type ExecutionMode = "company_first" | "person_first" | "job_first"
```

**Consequence:** there is no three-playbook taxonomy to dismantle. There is one enum with three
values, of which `company_first` has an execution owner, `person_first` and `job_first` do not.
The instruction "do not preserve `company_first / person_social_first / existing_list_first`"
therefore reduces to: **retire `ExecutionMode` itself**, which is a much smaller job than the
prior audit implies.

### 0.2 The mission compiler already receives the verbatim user sentence

`leadMissionCompiler.ts` `buildMissionCompilerPayload()` sends `user_query: String(ctx.originalUserQuery ?? "")`.
The prior audit's headline ("GPT never sees the user's raw sentence") is true of the **live**
path only — `leadStrategyBridge`'s `buildLeadStrategyUserMessage` sends a pre-extracted
whitelist, and the mission compiler is gated OFF by default, so in practice no model saw the
sentence. The plumbing is not the defect. **The defect is which path is enabled.**

### 0.3 `generic_sourcing_v1` is genuinely outside the ownership ledger — confirmed

`leadOwnership.ts:188` defines `LeadExecutionOwner = "capability_engine_v1" | "company_first_v1"`.
`run-agent/index.ts:3848` and `:4561` write `execution_owner: "generic_sourcing_v1"`, a value the
type does not contain. It is a third executor that the ledger cannot see, cannot refuse, and
does not count as a second claim.

### 0.4 The decision-maker duplication is worse than "different type shapes"

Two files export **the same identifier with incompatible meanings**:

| File | `EmployerVerification` is… |
|---|---|
| `_shared/employerVerification.ts:14` | a 5-value string union: `verified_match \| verified_mismatch \| historical_only \| ambiguous \| insufficient_evidence` |
| `_shared/decisionMaker/employerVerification.ts:29` | an object: `{ status: "verified"\|"probable"\|"unverified"\|"rejected", match_methods, confidence, rejection_reasons }` |

Both are live. Within `_shared/decisionMaker/*`, `import … from "./employerVerification.ts"`
resolves to the second; everywhere else the same relative-looking specifier resolves to the
first. The same trap exists for `companyIdentity.ts`. This is not stylistic drift — it is two
different answers to "does this person work here?" reachable under one name.

> An earlier pass of this audit mis-counted these as zero-caller dead files by matching path
> suffixes. That was wrong; both are live. The correct method is matching `from "…/<base>.ts"`
> import statements, which is what the counts below use.

### 0.5 ACCEPTED CORRECTION — regex is not a fallback tier

Ruled after this audit was written, and it overrides every "fallback" framing in
the earlier draft and in the code comments that R1 landed:

```
new lead request → GPT raw-query Mission compiler → canonical Mission → execution

compilation fails or returns invalid output → RETRY → explicit compilation failure
```

**Never a silent fall back to regex semantic interpretation.** A regex reading of the
sentence is a *different* reading of the request, not a lower-resolution copy of the same
one — R1's gold fixtures showed it inventing personas the user never named (`persona-02`,
`multi-02`, `noBroaden-01`) and discarding companies the user supplied (`enrich-01`).
Serving that under an outage means answering a question nobody asked, with the user's
money, and reporting success.

Old parsers may remain during migration for **shadow comparison**, **historical
compatibility** and **migration verification** — never as the final semantic authority,
and never as the outage fallback for a new request.

This changes §4 step 5, §5, and §7 below.


---

## 1. Current architecture, as verified from code

### 1.1 Request → mission (live path)

```
user message
  │
  ▼
pilot-chat/index.ts:1199   classifyWorkflow()            workflowClassifier.ts
  │                        regex-first, 14 categories, Gemini fallback
  ▼
                           decideQualifiedLeadRouting()  qualifiedLeadRouting.ts
  │                        "is this a lead request at all?"
  ▼
                           compileLeadEntityIntent()     leadEntityIntent.ts
  │                        sets ExecutionMode + ~5 regex tables
  ▼
pilot-chat/index.ts:203    buildMissionForPrompt()
  │                          ├─ GPT proposal — OFF by default (flag + allow-list)
  │                          └─ compileLeadMission()     leadMissionCompiler.ts
  ▼                             deterministic reading OVERWRITES the model on
LeadMissionV1                   every field it resolves
  │
  ▼
orchestrate/index.ts ──► run-agent/index.ts (5,967 lines)
```

**The semantic decisions are made before any model is consulted**, by roughly five regex
modules, and the model — when enabled at all — can only fill gaps the regexes left open.

### 1.2 Mission → execution (four executors, two tracked)

| Executor | Entry | Ledger-tracked |
|---|---|---|
| `runCapabilityPlan` | `run-agent:1900`, claim at `:1878` | ✅ `capability_engine_v1` |
| `executeCompanyFirstRoute` | `run-agent:2567`, claim at `:2561` | ✅ `company_first_v1` (stage `route_executor`) |
| `executeRunAgentCompanyFirstSourcing` | `run-agent:3033`, claim at `:3027` | ✅ `company_first_v1` (stage `quota_loop`) |
| **generic sourcing branch** | `run-agent:3848`, `:4561` | ❌ **untracked** |

### 1.3 Output identity — two projections, deliberately different

Verified from `leadWorkbenchProjection.ts:1-25` — this is **correct design, not drift**:

- **`lead_candidates`** (table) — qualified rows only, written on an explicit Company Brain
  pass, counted against quota, carry `lead_candidate_id`, actionable.
- **`tasks.result.workbench_evaluation_rows`** / **`tasks.result.workbench_pool`** (JSON) —
  evidence of work done. Structurally un-actionable because they carry no `lead_candidate_id`,
  and every action path requires one.

`workbench_pool` is **not a table and not a competing identity model.** It is the ranked UI
projection built at `run-agent:2421`. The audit item "`lead_candidates` vs `workbench_pool`
identity/unlock models" resolves to: there is one identity model, plus a read-only projection.
Nothing to delete here.

### 1.4 Social/LinkedIn discovery already exists — disconnected

`_shared/radarIntel/` (10 modules, including `linkedInIntelligence.ts` with a
`CommentIntent` classifier and buying-signal detection) plus `_shared/radarSources/`.
Wired to exactly one caller: `run-radar-scan/index.ts`. Persists to `public.signals`, never to
`lead_candidates`.

The target architecture names "LinkedIn posts/comments" as a first-class discovery strategy.
**That code exists and works. It is a migration source, not a deletion candidate.**

---

## 2. Cleanup / deletion map

Classification legend — **KEEP** (infrastructure, stays permanently) · **MIGRATE** (behaviour moves
into the new architecture, module then dies) · **DELETE** (removable once its condition is met) ·
**LRCO** (legacy read-compat only — must still read old persisted rows, must not run for new requests).

### 2.1 Area 1 — raw-text semantic parsers

| Path | Callers | Responsibility | Class | Replacement | Safe to delete when | Risk if early |
|---|---|---|---|---|---|---|
| `workflowClassifier.ts` (59 regex sites) | pilot-chat, capabilityValidator | Top-level 14-category routing, regex-first + Gemini fallback | **MIGRATE** | GPT request understanding emits category + Mission in one call | GPT understanding is authoritative for all 14 categories, not just lead ones | Every non-lead workflow (daily_brief, content, outreach, approvals) loses routing — blast radius far beyond leads |
| `leadEntityIntent.ts` (21) | 12 files, mostly **sourcing/execution** not planning | `ExecutionMode`, entity/signal intent, evidence spans | **MIGRATE** | Mission `target_entity` + strategy selection | All 12 consumers read the Mission instead | `compoundSourcingPipeline`, `companyFirstQuotaController`, `runAgentCompound*` all lose their entity contract mid-run |
| `jobSearchSpec.ts` (17) | 6 files | **Split module.** (a) `extractRequiredSignalTerms` + `no_broadening_requested`; (b) provider-input shaping | (a) **DELETE** (b) **KEEP** | (a) already on `LeadMissionV1` as of R1 | (a) `leadStrategyBridge.ts:253-254` reads the Mission instead of the spec | (a) `leadStrategyValidator` loses its drift check → plans silently drift off the named signal |
| `leadIntent.ts` (28) | pilot-chat, run-agent, leadSearchIntent | Intent extraction **+ source routing + actor-input planning** | **MIGRATE (half)** / **KEEP (half)** | Extraction → Mission. Routing stays in code | Only after R2 proves the Mission carries the same information | Routing half is the containment property — no model-facing field may name a provider |
| `leadIntentModel.ts` | run-agent, orchestrate | `SeparatedIntent` — persona vs source strategy | **MIGRATE (extraction half)** | Mission personas + strategy selection | Same as `leadIntent.ts` | Same |
| `leadSearchIntent.ts` (27) | 4 files | Search-intent + its **own** `DEFAULT_DISQUALIFIERS` | **MIGRATE** | Mission + canonical exclusion list | Its disqualifier list is merged (see 2.6) | Third independent exclusion list re-diverges |
| `qualifiedLeadRouting.ts` | pilot-chat, orchestrate, +4 | "Is this a lead request at all?" — runs **upstream** of compilation | **KEEP → later MIGRATE** | Eventually the same GPT call that compiles the Mission | GPT understanding is trusted to gate spend, not just describe intent | This decides whether money may be spent at all; a model failure here is a spend failure |
| `leadIntake.ts` (32), `leadQuality.ts` (21), `leadMatchTier.ts` (16) | 1–3 each | Intake normalisation, quality heuristics, tiering | **MIGRATE** | GPT evaluation stage | The evaluate-results stage exists and is proven | Nothing scores results; Workbench ranking collapses |
| `jobIntentTaxonomy.ts` (41), `jobFamilyRegistry.ts`, `jobFamily.ts` | 6+ | Role/family vocabulary | **KEEP** | — | never | **This is a controlled vocabulary, not semantic parsing of the user's sentence.** Providers need canonical role terms. See §5. |
| `toolInputPlanner.ts` (29), `actorInputPlanner.ts` | 2+ | Turn a plan into a bounded actor payload | **KEEP** | — | never | Infrastructure. Deleting hands unbounded input to paid actors. |
| `sourcingRetry.ts` (15) | — | Attempt strategies | **MIGRATE** | GPT retry/strategy-change stage | Retry reasoning is proven in the new loop | Retries become unbounded or vanish |

### 2.2 Area 2 — Mission/Intent-shaped types (**14 found, not 10**)

| Type | Path | Files | Class | Notes |
|---|---|---|---|---|
| `LeadMissionV1` | `leadMission.ts` | **17** | **KEEP** | The canonical target. Everything else collapses into it. |
| `LeadEntityIntent` / `LeadSignalIntent` | `leadEntityIntent.ts` | 12 | **MIGRATE** | Recomputed independently at ≥2 sites for one request |
| `LeadStrategyMission` | `leadStrategyContract.ts` | 8 | **MIGRATE → DELETE** | **Holds `no_broadening_requested` + `required_signal_terms`, which R1 duplicated onto `LeadMissionV1`.** Collapsing this is R2's core job |
| `LeadInitialStrategy` | `intelligence/leads/leadStrategy.ts` | 6 | **MIGRATE** | Claude-era planner shape |
| `LeadSourcingMission` | `intelligence/leads/leadMission.ts` | 5 | **DELETE** | Extends `AgentoryMission`; superseded |
| `AgentoryMission` | `intelligence/mission.ts` | 3 | **LRCO** | Cross-department base; only lead subtype retires now |
| `CompiledJobSearchSpec` | `jobSearchSpec.ts` | 4 | **MIGRATE (semantic) / KEEP (provider)** | Same split as §2.1 |
| `LeadSearchIntent` | `leadSearchIntent.ts` | 4 | **MIGRATE** | |
| `AdaptiveStrategy` / `AdaptiveMission` | `intelligence/leads/leadSourceStrategy.ts` | 4 / 1 | **MIGRATE** | Closest existing analogue to "GPT chooses strategies" |
| `LeadIntent` | `leadIntent.ts` | 3 | **MIGRATE** | |
| `SeparatedIntent` | `leadIntentModel.ts` | 1 | **MIGRATE** | |
| `WorkflowIntent` | `leadQualityGate.ts` | 1 | **MIGRATE** | Thin; folds into Mission |
| `PeopleSearchIntent` | `peopleSearchQueryBuilder.ts` | 1 | **KEEP** | Provider query shape, not request semantics |
| `Intent` | `intentRouter.ts` | — | **MIGRATE** | Belongs with `workflowClassifier` |

### 2.3 Areas 3 & 4 — playbook taxonomy and parallel executors

| Item | Callers | Class | Safe deletion condition | Risk if early |
|---|---|---|---|---|
| `ExecutionMode` (`company_first`/`person_first`/`job_first`) | 40 files reference `company_first` | **MIGRATE** | Strategy selection is Mission-driven and every one of the 40 sites reads the new field | `person_first` and `job_first` already have no owner — removing the enum without a replacement sends *all* traffic to the untracked branch |
| **generic sourcing branch** `run-agent:3848`, `:4561` | 2 sites, self-owned | **DELETE** | Telemetry proves zero requests reach it for a full TEST cycle **after** person-first and supplied-list strategies exist | This is today's silent catch-all for `person_first`. Deleting first = person-first requests hard-fail instead of degrading |
| `executeRunAgentCompanyFirstSourcing` (quota loop) | run-agent:3033 | **MIGRATE** | Capability engine owns rounds for every mission | Multi-round quota fulfilment stops; runs return short without saying why |
| `executeCompanyFirstRoute` | run-agent:2567 | **MIGRATE** | Same | Primary-source execution disappears |
| `runCapabilityPlan` / `leadCapabilityEngine.ts` | run-agent:1900 | **KEEP** | — | **This is the engine the target architecture keeps.** |
| `leadOwnership.ts` | 5 | **KEEP — extend** | — | The ledger is the safety property that makes deletion provable. Add new owners to it; never bypass it |
| `hiringRouteContract.ts` (3 routes) | 3 | **DELETE** | `leadCapabilityGraph` covers its routes and its own docblock names it superseded | Route validation gone → broad job-board fallback with no recorded reason |

### 2.4 Area 5 — provider / capability registries (**12**)

| Registry | Callers | Lines | Class | Note |
|---|---|---|---|---|
| `actorRegistry.ts` | 13 | 693 | **KEEP** | Provider truth. Infrastructure. |
| `leadCapabilityGraph.ts` | 9 | 747 | **KEEP — fix** | **Imports only `type LeadMissionV1`. Actor keys (`apify_yc_companies_memo23`, …) are hardcoded literals with no import from, and no validation against, `hiringActorCatalog`.** Its own comment (line 24) claims ids live there. Drift is unblocked. |
| `toolRegistry.ts` | 7 | 1789 | **KEEP** | Function routing |
| `leadEvidenceRegistry.ts` | 5 | 406 | **KEEP** | Evidence contract |
| `hiringSourceCatalog.ts` | 5 | 308 | **MIGRATE** | Folds into capability graph |
| `hiringActorCatalog.ts` | 4 | 410 | **KEEP** | Key→id + verified limits |
| `actorCapabilityRegistry.ts` | 4 | 202 | **MIGRATE** | Overlaps capability graph |
| `providerRouting.ts` | 3 | 52 | **MIGRATE** | |
| `hiringRouteContract.ts` | 3 | 257 | **DELETE** | See §2.3 |
| `leadCapabilityCatalogue.ts` | 2 | 259 | **KEEP** | The model-facing catalogue — provider-name-free by construction |
| `capabilityValidator.ts` | 2 | 179 | **KEEP** | |
| `sourceCapabilities.ts` | 1 | 153 | **MIGRATE** | |

### 2.5 Area 6 — deterministic ICP / qualification vs GPT reasoning

The instruction is that GPT owns research reasoning. It does **not** follow that qualification
becomes a model opinion — several of these are the fail-closed gates that stop fabricated leads.

| Module | Class | Reason |
|---|---|---|
| `companyIcpFilter.ts` | **KEEP** | Post-source hard gate. Canonical exclusion list (merged in `14970f99`, narrowed in `83353288`). Cheap, deterministic, auditable |
| `leadQualityGate.ts` | **KEEP** | Fail-closed evidence rules — source proof, company identity. Not semantics |
| `companyBrainGate.ts`, `companyBrainEffectivePolicy.ts`, `getCompiledCompanyBrainForWorkspace.ts` | **KEEP** | Workspace policy. Persisted config, not request interpretation |
| `evidenceSufficiency.ts`, `evidenceContract.ts`, `compoundEvidence.ts`, `leadCompanyEvidence.ts` | **KEEP** | Evidence sufficiency is the anti-hallucination property |
| `companySemanticClassification.ts`, `groundedBatchEvaluation.ts`, `poolRanking.ts` | **KEEP → becomes the evaluate stage** | Already model-backed; these *are* the target's "GPT evaluates results" |
| `icpSignalScorer.ts`, `leadPreRank.ts`, `leadScoreBreakdown.ts`, `leadMatchTier.ts` | **MIGRATE** | Heuristic scoring that competes with GPT evaluation |
| `verticalQualification.ts` | **KEEP** | Business-model fit — a different axis from industry exclusion (confirmed during C2) |
| `companyBrainIcp.ts` + `leadSearchIntent.ts` `DEFAULT_DISQUALIFIERS` | **MIGRATE** | The 3rd and 4th exclusion lists. C2 merged only the first two; `getCompiledCompanyBrainForWorkspace.ts:14` already warns against adding more |

### 2.6 Area 7 — retry / broadening / quota (**20 modules**)

`actorBroadeningPlanner` · `broaden` · `broadeningPlan` · `broadeningPlannerAdapter` ·
`broadeningValidator` · `companyFirstQuotaController` · `companyFirstSourcingState` ·
`continuationClaim` · `crossRoundDedupe` · `leadQuotaPolicy` · `multiRoundBinding` ·
`multiRoundController` · `multiRoundState` · `roundPlanContract` · `sourcingContinuation` ·
`sourcingRetry` · `workflowContinuation` · `groundedBatchEvaluation` · `groundedBrainBinding` ·
`groundedClaims`

| Group | Class | Condition |
|---|---|---|
| Broadening **reasoning** (`actorBroadeningPlanner`, `broaden`, `broadeningPlan`, `broadeningPlannerAdapter`) | **MIGRATE** | GPT's retry/change-strategy stage exists and is proven |
| Broadening **enforcement** (`broadeningValidator`) | **KEEP** | Enforces `no_broadening_requested`. This is the guard, not the reasoning |
| Quota + budget (`leadQuotaPolicy`, `multiRound*`, `roundPlanContract`) | **KEEP** | Budget and stop conditions are explicitly Agentory's per the rules |
| `crossRoundDedupe`, `continuationClaim`, `sourcingContinuation`, `workflowContinuation` | **KEEP** | Task state |
| `companyFirstQuotaController`, `companyFirstSourcingState` | **MIGRATE** | Bound to the retiring `company_first_v1` owner |

### 2.7 Area 8 — decision-maker implementations (**6 live**)

| Path | Live callers | Class | Note |
|---|---|---|---|
| `_shared/decisionMaker/*` (11 files) | via `integration.ts` → `leadActionExecutor` | **KEEP** | The canonical pipeline. Correctly scoped to the manual `find_decision_makers` action |
| `_shared/decisionMakers.ts` | 4 | **KEEP** | Ingest-time text extraction via `memoryWriter`. Narrow, different job |
| `_shared/employerVerification.ts` | 7 | **MIGRATE** | **Name-collides with `decisionMaker/employerVerification.ts`** |
| `_shared/companyIdentity.ts` | 12 | **MIGRATE** | **Name-collides with `decisionMaker/companyIdentity.ts`** |
| `_shared/companyIdentityResolution.ts` | 4 | **MIGRATE** | A third identity resolver |
| `_shared/workbench/decisionMakerResolver.ts` | 2 (`outreachRecipient`, `openerBackend`) | **KEEP** | Workbench-side reconciliation. Per the rules, DM data is a Workbench enrichment |
| `unlock-founders/` + `founderUnlockRunner.ts` | **0 from `src/`** | **KEEP — unwired** | Correct, atomic, credit-ledgered. C3 confirmed the UI does not call it and corrected the label instead |

**Deletion condition for the collisions:** rename before merging. The two `EmployerVerification`
types must not be unified by deleting one — they answer different questions at different
confidence granularities. Rename to `EmployerMatchOutcome` (top-level) and
`EmployerVerificationRecord` (`decisionMaker/`), *then* decide whether one can absorb the other.

### 2.8 Area 10 — architecture flags (11 families, **all OFF by default**)

| Flag | Module | Class |
|---|---|---|
| `GPT_LEAD_MISSION_COMPILER` (+`_WORKSPACES`, `_MODEL`) | `leadMissionCompilerBinding.ts` | **KEEP → default ON at R2 cutover, then remove** |
| `GPT_LEAD_STRATEGY` (+`_WORKSPACES`) | `leadStrategyBridge.ts` | **DELETE with `LeadStrategyMission`** |
| `CLAUDE_LEAD_REPLANNING` | `intelligenceFlags.ts` | **DELETED** in `93d27a70` — declared and snapshotted, read by nothing |
| `CLAUDE_FIRST_LEAD_PLANNING` | `intelligenceFlags.ts`, `leadPlanningBridge.ts` | **MIGRATE** — live: `orchestrate:1219` → `leadPlanOrchestration:267` → `applyClaudeFirstLeadPlanning`. Off by default ≠ disconnected |
| `CLAUDE_SOURCE_FEEDBACK` | `sourceFeedbackRuntime.ts` | **MIGRATE** — not the planner path at all; live round-to-round "what next?", genuinely Anthropic |
| `SEMANTIC_TITLE_VALIDATION`, `GLOBAL_ROLE_PLANNING`, `LEAD_STRATEGY_MEMORY` | `intelligenceFlags.ts` | **DELETE** — never shipped |
| `SIGNAL_INTELLIGENCE_KERNEL`, `CONTENT_INTELLIGENCE_KERNEL`, `CROSS_DEPARTMENT_INTELLIGENCE` | `intelligenceFlags.ts` | **KEEP** — other departments, out of scope |
| `DYNAMIC_HIRING_SOURCE_PLANNING` | `hiringSourcePlan.ts` | **MIGRATE** — subsumed by GPT strategy choice |
| `MULTI_ROUND_SOURCING` (+4) | `multiRoundBinding.ts` | **KEEP** |
| `GROUNDED_COMPANY_BRAIN` (+4), `FULL_POOL_GROUNDED_EVALUATION` (+3), `GPT_POOL_RANKING` (+3), `SEMANTIC_COMPANY_CLASSIFICATION` (+3) | respective bindings | **KEEP → default ON** — these are the evaluate stage |
| `SIGNALS_V2` | `signalsV2Flag.ts` | **KEEP** |

`intelligenceFlags.ts` asserts every flag defaults OFF, enforced by a test. Deleting a flag
means deleting its branch **and** its entry in `INTELLIGENCE_FLAGS`, or the suite fails.

---

## 3. Looks old, must stay — infrastructure, not semantic reasoning

The single most likely way to break this system is to delete one of these because it is large,
regex-heavy, or old-looking.

| Module | Why it stays |
|---|---|
| `jobIntentTaxonomy.ts` (41 regex sites), `jobFamilyRegistry.ts`, `jobFamily.ts`, `leadRoleTaxonomy.ts` | **Controlled vocabulary for providers.** GPT decides *which roles matter*; providers still need canonical, bounded query terms. Free-text into a paid actor is unbounded spend |
| `toolInputPlanner.ts`, `actorInputPlanner.ts`, `hiringActorInputs.ts`, `jobsProviderInput.ts`, `finalActorPayload.ts` | Bounded-input compilation. The containment property: no model-facing field can name a provider |
| `leadOwnership.ts` | The ledger that makes "exactly one executor" provable rather than asserted. **Extend it; never bypass it** |
| `executionLedger.ts` | One row per provider call, written before it returns. The only spend audit trail |
| `leadCapabilityCatalogue.ts` | Model-facing catalogue, provider-name-free by construction |
| `companyIcpFilter.ts`, `leadQualityGate.ts`, `evidenceSufficiency.ts` | Fail-closed gates. Their determinism is the feature |
| `broadeningValidator.ts` | Enforces the user's `no_broadening_requested`. Reasoning may move to GPT; **enforcement may not** |
| `leadWorkbenchProjection.ts` | The qualified/evaluation split that stops progress rows leaking into quota |
| `_shared/radarIntel/*` | **Working LinkedIn post/comment intelligence.** The target architecture needs exactly this. Migrate it in; do not delete |
| `unlock-founders/`, `founderUnlockRunner.ts`, credit RPCs | Correct and atomic. Unwired ≠ dead. Its wiring is a product decision already deferred at C3 |

---

## 4. Recommended deletion order — small, safe commits

Each step is independently revertible and ends green. **Nothing here is authorised yet.**

**Phase A — free wins, no behaviour change (1 commit each)**

1. Delete never-shipped flags + branches: `SEMANTIC_TITLE_VALIDATION`, `GLOBAL_ROLE_PLANNING`, `LEAD_STRATEGY_MEMORY`. Remove from `INTELLIGENCE_FLAGS`.
2. ~~Delete the Claude planner path.~~ **Done as `93d27a70`, and much smaller than planned:** only `CLAUDE_LEAD_REPLANNING` was obsolete. `CLAUDE_FIRST_LEAD_PLANNING` + `applyClaudeFirstLeadPlanning` are production-wired (MIGRATE, R2), `CLAUDE_SOURCE_FEEDBACK` is a different live feature (MIGRATE), and `claude_lead_planner_v1` is legacy read-compat for persisted provenance rows.
3. Rename the two colliding `EmployerVerification` / `companyIdentity` exports. **Rename only** — no merge, no logic change.
4. Bind `leadCapabilityGraph`'s actor keys to `hiringActorCatalog` with a compile-time or test-time assertion. Additive; closes the drift named in §2.4.

**Phase B — the R2 cutover (the actual blocker for everything else)**

5. Make the GPT mission compiler authoritative, with **retry then explicit compilation failure** on invalid output — not a regex fallback (§0.5). Flip R1's four pinned `R2 GAP` tests to `PRESERVED`.
6. Collapse `LeadStrategyMission` into `LeadMissionV1`. `leadStrategyBridge.ts:253-254` reads Mission fields. **This retires the duplication R1 knowingly created.**
7. Delete `GPT_LEAD_STRATEGY` flag + `leadStrategyContract.ts`'s mission half.

**Phase C — strategies replace the playbook enum**

8. Add strategy selection to the Mission (hiring / funding / social / news / supplied-company / multi-signal). Additive.
9. Add a `known_company_research` strategy path — R1 already makes `known_companies` survive.
10. Migrate `radarIntel/` LinkedIn discovery behind a `social_signal` strategy, writing to `lead_candidates` via the capability engine.
11. Route `person_first` to a **ledger-tracked** owner. Only now does the untracked branch have a replacement.
12. Delete the generic sourcing branch — **after** telemetry shows zero arrivals for a full TEST cycle.
13. Retire `ExecutionMode` across all 40 sites.

**Phase D — parser removal**

14. Delete `hiringRouteContract.ts`, `actorCapabilityRegistry.ts`, `sourceCapabilities.ts`, `providerRouting.ts`.
15. Delete the semantic halves of `leadEntityIntent`, `leadIntent`, `leadIntentModel`, `leadSearchIntent`, `jobSearchSpec`. Keep every provider-input half.
16. Merge exclusion lists 3 and 4 into the canonical list.
17. Migrate `workflowClassifier` last — widest blast radius, and it routes non-lead workflows.

---

## 5. What must remain temporarily

| Item | Until |
|---|---|
| Deterministic parsers, for **shadow comparison, historical compatibility and migration verification only** — never as the semantic authority or the outage fallback for a new request (see §0.5) | The migration is verified and every consumer reads the Mission |
| `company_first_v1` owner + both stages | The capability engine owns rounds for every mission, not just mission-carrying tasks |
| The generic sourcing branch | `person_first` has a real owner. **It is today's only catch-all** |
| `AgentoryMission` | Only the lead subtype is in scope; signal/content departments still extend it |
| `ExecutionMode` | All 40 reference sites are migrated |
| Every `LRCO` item | Persisted rows in the old shape stop being read — needs a data check, not a code check |

---

## 6. Blockers to solve before any deletion

1. **R1 created a second home for `no_broadening_requested` and `required_signal_terms`.** They
   now live on both `LeadMissionV1` and `LeadStrategyMission`. If Phase B step 6 does not land,
   this becomes permanent duplication and R1 made things worse. **Highest-priority blocker.**
2. **`person_first` has no owner.** Any deletion of the generic branch before Phase C step 11
   turns a degraded path into a hard failure.
3. **No TEST telemetry on branch arrival.** Steps 12 and 15 both require "zero requests reached
   X". Nothing currently reports that. `executionLedger.ts` records provider calls, not branch
   entry — this needs adding before it can gate a deletion.
4. **The Mission cannot express three things the target needs:** "no count requested"
   (`requested_count` is non-nullable), an output meaning *social posts*
   (`RequestedOutput` has four values, none fit), and multi-strategy selection.
   All three must land before Phase C.
5. **`workflowClassifier` routes 14 categories, only ~4 lead-related.** Migrating it is a
   whole-product change. Sequenced last, deliberately.
6. **4 pre-existing test failures** (`apifyJobsHiringSource` ×1, `leadActionExecutor` ×3) predate
   all this work. They should be fixed or formally waived before a deletion campaign, or
   "same 4 failures" stops being a usable signal.
7. **No production data audit.** Every `LRCO` decision assumes old-shape rows exist. Unverified —
   this audit was code-only, by instruction.

---

## 7. Proposed minimal architecture after cleanup

```
user query
  │
  ▼  ONE model call — understanding + strategy selection
GPT request compiler ──────────────────────────────┐
  │  reads the verbatim sentence                   │  catalogue is
  │                                                │  provider-name-free
  ├─ invalid output ─► RETRY ─► still invalid ─►   │
  │                    EXPLICIT COMPILATION FAILURE│
  │                    (never a regex re-reading   │
  │                     of the sentence — §0.5)    │
  ▼                                                │
LeadMissionV1  (the single request contract)       │
  ├ what: entity, count, ICP, geography, personas  │
  ├ constraints: no-broadening, prohibitions,      │
  │              required signal terms, recency    │
  ├ supplied: known_companies                      │
  └ strategies[]: hiring | funding | social |      │
                  news | supplied_company |        │
                  multi_signal                     │
  │                                                │
  ▼  DETERMINISTIC — validation, canonicalisation, │
     hard constraints, budget, permissions ────────┘
capability graph → approved providers only
  │
  ▼
capability_engine_v1   (the ONE executor, ledger-claimed)
  │
  ├─► provider calls ──► executionLedger (one row per call, pre-flight)
  │
  ▼
results
  │
  ▼  GPT evaluation — grounded claims, semantic fit, pool ranking
evaluate ──► retry / change strategy / gather more evidence
  │           (reasoning: GPT · quota, budget, stop conditions: code)
  ▼
COMPANY candidates  (always normalised to a company)
  │
  ├─► lead_candidates          qualified, actionable, quota-counted
  └─► workbench_evaluation_rows  evidence of work, never actionable
  │
  ▼
Workbench
  │
  └─► optional unlocks: founder / decision-maker / contact
        └─ decisionMaker/pipeline + unlock-founders (credit-ledgered)
```

**What disappears:** 5 semantic regex parsers · 12 of 14 mission/intent types · `ExecutionMode` ·
3 of 4 executors · 5 registries · the Claude planner · 6 flags.

**What stays, and why:** the capability graph and actor catalogue (containment) · the ownership
and execution ledgers (provability) · the fail-closed ICP/evidence gates (anti-hallucination) ·
bounded provider-input compilation (spend safety) · role vocabulary (providers need canonical
terms) · quota/budget/stop conditions (explicitly Agentory's) · the qualified/evaluation split
(stops progress rows becoming leads) · Workbench unlocks (enrichment, not a second output
architecture).

---

**STOP.** No code has been changed. Awaiting approval before any deletion or rewrite.
