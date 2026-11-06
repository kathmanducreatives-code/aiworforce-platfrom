# Legacy interpreters: inventory and status (Mission Contract v4)

This is the rule now in code (`supabase/functions/_shared/missionContract/authority.ts`):

- A mission's **own version** decides its semantic authority.
  - A mission carrying `mission_contract` is read **only** through its approved contract.
  - Every other mission (v1, v3, stored history) keeps its legacy behaviour unchanged.
- The two never compete for the same mission.

**Status legend:**

- **Bypassed for v4**: a v4 mission never reaches this code.
- **Under authority**: the code asks the boundary and reads the contract for v4.
- **Display only**: it reads the sentence for text shown to people or given as model context, not to decide a requirement.
- **Legacy (isolated)**: reached only by v1 or v3 missions.

## A. Interpretation paths

| # | Component | Callers | Semantics it controls | v4 status | Retirement condition |
|---|---|---|---|---|---|
| 1 | `leadMissionCompiler.compileLeadMission` (v1/v3) | pilot-chat (`compileRequestMission`, `buildMissionForPrompt`), lead-pipeline (`compileWithBrain`), study harness | the whole mission | **Bypassed for v4.** A v4 card comes from `missionFromContract`; lead-pipeline in contract mode uses `compileContract` | v4 authoritative in production (rollout stage 5) and no new v1 cards |
| 2 | `missionCriteria.deriveMissionCriteria` (re-reads `original_user_query`: hedges, audience words, "or" groups, scope words) | `missionCriteriaReader.criteriaOf` for **unfrozen** missions; pilot-chat `buildMissionForPrompt` | criteria | **Bypassed for v4.** v4 missions are frozen (criteria-v1), so `criteriaOf` returns the approved criteria. Measured: a legacy re-derivation of v4 carriers would *drop* hard signals in 9/55 phrasings and never *adds* one (pinned by a test) | No unfrozen missions left in flight |
| 3 | `leadMission.parseLeadMissionDeterministic` + `VERTICAL_MARKERS` (raw-text regexes) | orchestrate fallback for `deterministic` workspaces; v1 compiler | verticals, stages, locations | **Bypassed for v4** (orchestrate uses the supplied mission). Source of the documented M17 "saas" duplicate | With #1 |
| 4 | `requestToMission.compileRequestMission` + `leadEntityIntent` projection | pilot-chat Chat Brain lead route | mission from the Chat Brain RequestV1 | v4 card path replaces its **result** (`contractForCard`). The projection still runs first, for routing/refusal (negations, research without identity) | When the v4 interpreter owns lead routing (open: §C1) |
| 5 | `leadSearchIntent` (`original_query`) | run-agent company-first sourcing (`jobSearchSpec`, `sourcingConstraints`, `inferFamilyKey` context) | job family, title strategy, search context | **Under authority:** `executionQueryOf` gives contract text for v4. Measured: same job family as the sentence in 45/45 phrasings where the sentence yields one; the 5 where the sentence yields none (typos, synonyms) now resolve | With #1 |
| 6 | `leadIntentModel` (`original_query`) | run-agent intent separation | personas, company profile context | **Under authority** (same function) | With #1 |
| 7 | `jobIntentTaxonomy.compileJobIntent(original_user_query)` in run-agent's run context | `buildQualifiedLeadRunContext` | Workbench panel (`job_family`) | Display only | Low priority |
| 8 | `qualifiedLeadRunContext.inferCompanyStage(original_user_query)` | run context | Workbench `company_stage` | Display only | Low priority |
| 9 | `leadDiscoveryStrategy` YC cohort regex on the sentence | actor cohort refusal (`cohortRefusalFor`), capability graph, execution plan | whether a YC-only actor may be used | **Under authority:** a v4 mission names YC through a `company_stage` requirement | With #1 |
| 10 | run-agent runtime Brain gates (`effectivePolicy`, `brainIcpCtx` → `excluded_industries`, size rule, `disqualifier_keywords`) | capability engine fit gate; GPT discovery planner context (×2) | **rejections** by workspace policy | **Under authority:** for v4 the gates are `runtimeBrainGatesFromContract`. The Brain's size rule and exclusions are in the approved contract (`missionContract/brain.ts`); there is no separate run-time Brain authority. Preferences (business models, buyer roles, target signals) stay ranking context | With #1 |
| 11 | `companyBrainSemanticFit.applyMissionPrecedence` (keeps workspace industries the sentence mentions) | capability engine | which workspace categories inform the fit model | **Under authority** (`executionQueryOf`): context only, never a hard gate; v4 reads the contract's text | With #1 |
| 12 | `restatementReconciler.ts` and the v3 `restates*` functions | v3 compiler | duplicate-requirement removal | **Not in the v4 path** (one channel: nothing to reconcile) | With #1 |
| 13 | `leadMissionCompiler.preserveStatedHiringWindow` / `statedHiringWindowDays` (raw-text window regex) | v1 compiler | hiring window | Not in the v4 path (windows come from the model's quoted `signal_windows`, or from the named `DEFAULT_SIGNAL_WINDOWS`) | With #1 |
| 14 | `mergeCompanyBrainIntoMission` + `compileEffectiveCompanyPolicy` "mission may only TIGHTEN" | v1 compiler, run-agent | Brain vs user size precedence | **Replaced for v4** by `applyCompanyBrain`: the user's stated size outranks the Brain's rule, and the conflict is shown. This is a deliberate, documented difference from v1 | With #1 |

## B. To delete once v4 is authoritative everywhere (rollout stage 5)

Nothing in A was deleted in this change. Each item is still the authority for v1 missions, which production runs today.

Deleting any of them before v4 is the only path for new missions would break production. They are isolated by version instead, as the instruction allows.

**Delete first:** #12 and #13. They are reachable only through the v3 compiler, which production does not run.

**Deletion criteria:**

- no mission without `mission_contract` is created for 30 days;
- in-flight legacy missions have drained;
- the corpus, replay and shadow baselines are re-pinned against v4 only.

## C. Open items

1. **Lead routing still starts with Chat Brain's RequestV1.** With `AGENTORY_CHAT_CONTRACT_V4`:
   - Chat Brain decides *that* this is a lead request (and refuses negations and identity-less research);
   - v4 decides *what* it means.

   That is two model calls per card. Folding routing into the contract interpreter is the next step.
2. Done: `AGENTORY_CHAT_CONTRACT_V4_WORKSPACES` scopes shadow and v4 to listed workspaces (rollout stage 4).
