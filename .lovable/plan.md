## Goal

Make the qualified-lead strategist provider-independent. The strategy brain becomes an interface with two interchangeable adapters (Lovable AI gateway now, direct OpenAI later), selected purely by environment configuration. Everything else — policy, prompts, schemas, validation, fallback, qualification, quota, persistence — stays provider-agnostic and untouched when the provider changes.

## Current state (already built, needs restructuring)

`supabase/functions/_shared/` currently has:
- `leadStrategyModels.ts` — hardcodes Lovable gateway URL + `openai/gpt-5.6-luna` / `openai/gpt-5.6-terra` model IDs, and is imported directly by the owner.
- `leadStrategyOwner.ts` — imports the Lovable-specific call function as its default. This is the one provider leak to remove.
- `leadRoleTaxonomy.ts`, `leadStrategyContract.ts`, `leadStrategyValidator.ts` — already pure and provider-independent; they keep their shapes.
- `run-agent/index.ts` — constructs the planner behind the `qualified_lead_sourcing` + `company_first` gate.

## Target structure

```text
_shared/leadStrategy/
  provider.ts        QualifiedLeadStrategistProvider interface + request/response types
  config.ts          env resolution + logical model config (no provider names inlined)
  factory.ts         provider selection: lovable_ai | openai
  adapters/
    lovableAi.ts     LovableAIStrategistProvider  (gateway URL, Lovable-Api-Key)
    openai.ts        OpenAIStrategistProvider     (api.openai.com, OPENAI_API_KEY)
    shared.ts        OpenAI-compatible chat body builder + response→canonical mapper
```
Existing pure modules stay where they are; `leadStrategyModels.ts` collapses into the adapters.

### 1. The interface (provider.ts)

```ts
interface QualifiedLeadStrategistProvider {
  readonly id: string;                    // "lovable_ai" | "openai"
  validateModelId(modelId: string): { ok: true } | { ok: false; reason: string };
  createInitialStrategy(req: QualifiedLeadStrategyRequest): Promise<QualifiedLeadStrategyResponse>;
  chooseNextAction(req: SourceFeedbackRequest): Promise<SourceFeedbackResponse>;
}
```
Requests carry only canonical data: mission, round context, role family, approved title universe, eligible query packs, approved sources, Company Brain constraints, actor capability cards, plus `{ modelId, timeoutMs }`. Responses are the canonical `{ ok, rawJson, modelId, latencyMs, usage, errorCode }` envelope — never a provider SDK type. No provider type, header, URL or model string appears in any signature.

### 2. Configuration (config.ts)

Read once, server-side:
- `LEAD_STRATEGIST_PROVIDER` = `lovable_ai` (default) | `openai`
- `LEAD_STRATEGIST_PRIMARY_MODEL`, `LEAD_STRATEGIST_ESCALATION_MODEL` — logical slots; IDs come from config and are validated by the selected adapter's `validateModelId`, not by a global allow-list.
- Sensible per-provider defaults so nothing breaks if the model vars are unset.
- An unknown provider value, or a model ID the adapter rejects, resolves to the deterministic fallback and logs the reason — it never throws and never silently calls a different provider.

### 3. Adapters

Both build the same OpenAI-compatible chat body from `adapters/shared.ts` (`reasoning_effort: "none"`, `max_completion_tokens`, `response_format: json_object`, no `max_tokens`/`temperature`) and map the reply into the canonical envelope. They differ only in endpoint, auth header, key name, and `validateModelId`:
- **Lovable**: `https://ai.gateway.lovable.dev/v1/chat/completions`, `Authorization: Bearer LOVABLE_API_KEY`, accepts gateway-catalog `openai/*` ids.
- **OpenAI**: `https://api.openai.com/v1/chat/completions`, `Authorization: Bearer OPENAI_API_KEY`, accepts bare OpenAI ids (no `openai/` prefix). Missing key → clean `no_provider` error, deterministic fallback, no crash. Edge-function-only; the key is never referenced in `src/` and never prefixed `VITE_`.

### 4. Owner becomes provider-agnostic

`leadStrategyOwner.ts` drops its Lovable import and takes a `QualifiedLeadStrategistProvider` (defaulting to `factory.resolveStrategistProvider()`). The Luna→Terra escalation generalizes to primary-model → escalation-model → deterministic fallback, with identical validation and provenance. Provenance records `provider_id` and the resolved model IDs alongside the existing fields. `chooseNextAction` is wired for source feedback using the same closed action union and validator.

### 5. Call sites

`run-agent/index.ts` keeps the same gate and the same `createLeadStrategyPlanner(...)` call — only the internals change, so no controller, Actor, Company Brain, Workbench or qualification code is touched. Zero references to Lovable APIs remain outside `adapters/lovableAi.ts`.

### 6. Tests

- **Contract tests** (`leadStrategyProviderContract.test.ts`): the same fixture set is run through both adapters with mocked HTTP, asserting byte-identical canonical strategy output, identical validation verdicts, and identical deterministic fallbacks. Includes a body-shape test proving both send the same GPT-5-family-safe payload.
- **Config tests**: provider selection, model-slot resolution, unknown-provider and rejected-model behaviour.
- **Leak guard**: a source-scan test asserting no file outside `adapters/lovableAi.ts` mentions the Lovable gateway URL or `LOVABLE_API_KEY`, and that no `src/` file mentions `OPENAI_API_KEY`.
- Existing 25 strategy tests keep passing, re-pointed at the injected provider.

## Switching providers afterwards

Add `OPENAI_API_KEY`, set `LEAD_STRATEGIST_PROVIDER=openai` plus the two model IDs, redeploy `run-agent`. No code, prompt, schema or policy change.

## Scope

Backend `supabase/functions/` only. No deployment, no migrations, no secret changes, no live sourcing run in this work.
