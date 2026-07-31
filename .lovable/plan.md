
# Unified OpenAI strategy owner for qualified-lead sourcing

Scope is gated strictly to `workflow = qualified_lead_sourcing` + `execution_mode = company_first`. Every other Agentory feature (Pilot chat, orchestration, Scribe/Penn Anthropic writing routing, radar, screening) keeps its current model routing untouched. `supabase/functions/mcp/index.ts` is never staged.

## Current (mixed) call graph — verified in the codebase

```text
orchestrate ──► leadPlanOrchestration ──► leadPlanningBridge
                                            └─ Claude-first flag → plannerWrapper → aiProvider (Anthropic or Gemini)
run-agent ──► companyFirstQuotaController
                ├─ broadeningPlannerAdapter ──► aiProvider.generateJson → google/gemini-3-flash-preview
                ├─ deterministicRoundPlan (broadeningPlan.ts) for round 1
                └─ sourceFeedbackRuntime ──► plannerWrapper → Claude (advance_source only)
actorInputPlanner ──► aiProvider (tool_input_planning → Gemini)
```

Three different authorities decide strategy; none owns the whole thing.

## Target (unified) call graph

```text
qualified-lead mission
  └─ leadStrategyOwner (NEW)
       ├─ buildStrategyRequest (user query + Company Brain + ICP + quota + capability cards)
       ├─ openaiStrategyClient → Lovable gateway → openai/gpt-5.6-luna
       ├─ validateLeadStrategy (deterministic)
       │     └─ invalid → ONE escalation → openai/gpt-5.6-terra → revalidate
       │           └─ invalid → deterministicLeadStrategy fallback
       └─ persists authoritative_source + fallback_reason + cost provenance

per source round:
  Agentory computes observations (deterministic counters)
    └─ leadStrategyOwner.nextAction() → gpt-5.6-luna → one bounded action → deterministic validation
```

## Work items

### 1. Model binding (`_shared/leadStrategyModels.ts`, new)
- `LEAD_STRATEGY_PRIMARY = "openai/gpt-5.6-luna"`, `LEAD_STRATEGY_ESCALATION = "openai/gpt-5.6-terra"`.
- Calls go through the existing Lovable gateway path in `aiProvider.ts` with `reasoning_effort: "none"` (required for GPT-5.6), `max_completion_tokens` (never `max_tokens`), default temperature only.
- Add a new `TaskType` `"lead_strategy"` to `aiProvider.ts` whose default model is Luna, so no existing `DEFAULT_MODELS` entry changes. Add an assertion that this task type can never resolve to a `google/*` or Anthropic model.

### 2. Strategy contract (`_shared/leadStrategyContract.ts`, new)
Typed request/response for `mission`, `role_taxonomy{families,negative_patterns}`, `query_packs[]`, `source_plan[]`, `broadening_ladder[]`, `company_evidence_policy`, `people_search_condition`, `stop_conditions`. Request carries the exact user query, compiled Company Brain, saved ICP, requested count, hiring-role seed, decision-maker roles, constraints, recency policy, budget, action limit and approved capability cards (keys only). Versioned prompt + schema constants.

### 3. Validator (`_shared/leadStrategyValidator.ts`, new)
Rejects: raw actor IDs, unknown capability keys, mutated Company Brain constraints/quota, recency > 60 days, generic operations families (warehouse/retail/people/clinical/logistics/generic ops or sales manager), missing exact title families, ATS in the source plan, and the "one broad OR query to every source" collapse. Prompt-injection scan reuses `broadeningValidator.detectInjection`.

### 4. Strategy owner (`_shared/leadStrategyOwner.ts`, new)
Luna → (one) Terra escalation with validation errors → deterministic fallback. Persists `authoritative_source ∈ {gpt_5_6_luna, gpt_5_6_terra_escalation, deterministic_fallback}` plus a precise `fallback_reason`. Deterministic fallback preserves Company Brain, exact role intent, capability keys, budget and quota.

### 5. Deterministic role taxonomy + packs (`_shared/leadRoleTaxonomy.ts`, new)
Exact/adjacent/evidence-gated families as specified, negative patterns, and the seven bounded query packs (pack id, titles, aliases, exclusions, evidence requirements, eligible sources, priority, broadening level, max attempts). Used both as the fallback and as the validation universe for model output.

### 6. Wiring (edits, no rewrites)
- `intelligence/leads/leadPlanningBridge.ts` + `leadPlanOrchestration.ts`: route qualified-lead planning to the strategy owner instead of the Claude/Gemini planner.
- `companyFirstQuotaController.ts`: replace the `broadeningPlannerAdapter` (Gemini) call with the strategy owner for qualified-lead/company-first only; other callers of the adapter unchanged.
- `sourceFeedbackRuntime.ts`: keep the bounded action union, checkpointing and deterministic mandatory-action logic; swap the injected planner from Claude to the strategy owner. Mandatory deterministic decisions still bypass the model.
- Source order becomes plan-driven (YC → LinkedIn → Indeed → Glassdoor for the startup fixture, not a hardcoded global), and the universal three-round cap is replaced with a bounded plan-aware action limit derived from remaining quota/budget/unused packs/source quality.

### 7. Provider compilation (edits)
`actorInputPlanner.ts` / `actorInputSchemas.ts` / `actorInputValidator.ts` keep sole ownership of Actor JSON. Fixes: no blank `datePosted` (Indeed) or `timePostedRange` (LinkedIn) when the verified schema supports a recent literal; Glassdoor keeps bounded `daysOld`; LinkedIn workplace filter not forced to on-site; unsupported SaaS/stage/employee filters are recorded as `unapplied_constraints` rather than invented. Immutable compiled-payload protection stays.

### 8. Company evidence (edits)
Trace provider → `apifyJobsNormalizer` → `companyIdentity` → company evidence → `companyBrainGate`. Map source-backed enriched fields (employee count, industry, description, website, LinkedIn URL, company type, founding/stage) into the existing evidence contract; no fabrication. Introduce `company_evidence_pending` so missing evidence routes through the approved enrichment path and is re-evaluated before qualify/reject/Needs Review. Company Brain stays deterministic and authoritative.

### 9. Observability
Persist per AI call: task id, model, purpose, request/response timestamps, input/output tokens, cost/credits, validation result, authoritative source, fallback reason, prompt/schema version — plus which pack produced each source call, so Workbench can explain strategy provenance. No credentials, no hidden reasoning.

### 10. Tests (all mocked; no live AI or provider calls)
New suites covering the 30 listed assertions: model routing (Luna used, Terra once, no Gemini/Claude in this workflow, unrelated routing preserved), strategy input fidelity, pack separation and no broad-OR, YC-first fixture, hiring vs decision-maker title separation, validation/escalation/fallback chain, compiler behaviour (recency non-blank, no on-site force, unapplied constraints recorded), company-evidence mapping and pending re-evaluation, adaptive source-switch on high Brain rejection, people-search trigger, contact-quota stop, cost provenance, and regression guards on payload validation, Brain authority, employer verification, CONTACT-only quota and Workbench Insights.

Run: full backend Deno suite, affected frontend tests, `deno check`, TypeScript check, production build. Only pre-existing baseline failures accepted.

### Delivery
One focused PR against `main`, not merged, not deployed, no production flag enabled, no live sourcing run, TEST untouched, `supabase/functions/mcp/index.ts` restored and unstaged before commit. Final report answers all 25 requested items.

## Technical notes
- GPT-5.6 models require `reasoning_effort: "none"`; `max_tokens` and non-default `temperature` are rejected by the GPT-5 family — the new client sends `max_completion_tokens` only.
- Structured output uses strict `json_schema` with a small, flat, bounds-free schema; length/count limits are stated in the prompt and clamped in code, with a fallback parse on non-conforming output.
