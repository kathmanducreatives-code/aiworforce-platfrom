# Switch Pilot brain to Lovable AI Gateway (Anthropic optional)

## Audit (current state)

Direct Anthropic `fetch("https://api.anthropic.com/v1/messages")` calls live in three places:

- `supabase/functions/pilot-chat/index.ts` — hard-fails 500 if `ANTHROPIC_API_KEY` is missing.
- `supabase/functions/orchestrate/index.ts` — uses Claude for planning; falls back to deterministic planner only if key missing or call fails.
- `supabase/functions/run-agent/index.ts` — every agent step calls Claude directly.

`supabase/functions/_shared/` only contains `toolRegistry.ts`. No provider adapter exists yet. `LOVABLE_API_KEY` is already in project secrets.

Unrelated functions (`adaptive-screening-chat`, `screen-candidate`, etc.) are out of scope.

## Goal

Make Lovable AI Gateway the default brain for Pilot, orchestrate, and run-agent. Keep Anthropic as an opt-in advanced/fallback provider. App must function fully without `ANTHROPIC_API_KEY`.

## Architecture (unchanged)

```
ChatWorkspace → pilot-chat → aiProvider → (Lovable AI Gateway | Anthropic)
                          ↘ orchestrate → aiProvider → task_plans/tasks
                                       → run-agent → aiProvider + toolRegistry
                                                  → activity_feed / approvals / messages
```

## Changes

### 1. New `supabase/functions/_shared/aiProvider.ts`

Single model-calling layer. Exposes:

- `generateText(opts)` → `{ ok, content, provider, model, usage?, error?, latencyMs }`
- `generateJson(opts)` → same shape plus `json?: unknown` (uses robust extraction: strip ``` fences, slice first/last braces, repair).

Options: `{ role, agentSlug?, taskType, messages, systemPrompt?, temperature?, maxTokens?, preferredProvider?, responseFormat? }`.

Provider implementations:

- **Lovable AI Gateway** (default): POST to `https://ai.gateway.lovable.dev/v1/chat/completions` with header `Authorization: Bearer ${LOVABLE_API_KEY}`. OpenAI-compatible body. Handle 429 (rate limit) and 402 (credits exhausted) as typed errors that propagate to UI.
- **Anthropic** (optional): existing `api.anthropic.com/v1/messages` flow, used only if `ANTHROPIC_API_KEY` set AND (`preferredProvider === "anthropic"` OR Lovable fallback triggers).

Default models per task type:
- `pilot_chat` → `google/gemini-3-flash-preview`
- `orchestration_plan` → `google/gemini-3-flash-preview`
- `agent_execution` → `google/gemini-3-flash-preview`
- `helper` → `google/gemini-2.5-flash-lite`

Fallback order: preferred → Lovable default → Lovable alt (`openai/gpt-5-mini`) → Anthropic (if key) → return `{ ok: false, error }`.

Each call returns metadata; helper `logProviderCall(supabase, { workspace_id, function_name, agent_slug, task_type, provider, model, success, latency_ms, error_code })` writes a row to `activity_feed` with `event_type: 'ai_provider_call'` and the metadata in `metadata` JSON. No keys, no full prompts logged.

### 2. `supabase/functions/pilot-chat/index.ts`

- Remove the `ANTHROPIC_API_KEY` precondition and the inline `callAnthropicWithRetry`.
- Replace the Claude call with `generateJson({ taskType: 'pilot_chat', systemPrompt: PILOT_SYSTEM_PROMPT, messages, ... })` to parse the decision JSON.
- On `{ ok: false }` from adapter (all providers failed), insert assistant message: *"Pilot is online, but the AI provider is temporarily unavailable. I saved your message — you can retry."* (`is_error: true`), return 200 (not 500) so chat UI stays functional.
- Delegation branch unchanged — still posts to `orchestrate`.

### 3. `supabase/functions/orchestrate/index.ts`

- Replace the direct Anthropic block with `generateJson({ taskType: 'orchestration_plan', ... })`.
- Keep all existing post-processing: robust JSON extraction (already in adapter), slug normalization, deterministic fallback planner, specific error codes (`agent_lookup_failed`, `task_plan_insert_failed`). Never return `empty_plan`.
- If adapter returns `ok:false`, go straight to deterministic planner — log fallback reason in activity_feed.

### 4. `supabase/functions/run-agent/index.ts`

- Replace the inline Claude `fetch` with `generateText({ taskType: 'agent_execution', agentSlug, systemPrompt, messages, ... })`.
- Drop the gemini→claude model-name mapping (adapter owns model selection).
- toolRegistry flow (Hawk/Scout `research_web`, context appending, approval gates) unchanged.

### 5. Frontend

No changes. `ChatWorkspace` → `pilotChat()` → `pilot-chat` edge function path is preserved.

## Out of scope

- No new tables (`ai_calls` table not created; metadata goes in `activity_feed.metadata`).
- No UI changes. No backend project switch. No removal of toolRegistry / orchestrate / run-agent / approvals.
- Other edge functions that call AI for non-Pilot purposes (`screen-candidate`, `adaptive-screening-chat`, `parse-resume`, etc.) are not migrated in this pass.

## Verification

After deploy, in Lovable Preview:
1. `hello` → Pilot replies; activity_feed row shows `provider: lovable-ai`, `model: google/gemini-3-flash-preview`.
2. `Find 10 React engineers in London` → plan created with Scout → Aria → Penn; no `empty_plan`; orchestrate row shows lovable-ai provider.
3. `Brief me on today` → Hawk task runs; since no `PERPLEXITY_API_KEY`, response says live research connector required; no hallucinated data; no crash.
4. `Write a LinkedIn post about our Q4 wins` → Scribe task plan + response via lovable-ai.
5. Simulate missing Anthropic (it's optional already): all four flows still succeed via Lovable AI Gateway.

## Files touched

- **New:** `supabase/functions/_shared/aiProvider.ts`
- **Edit:** `supabase/functions/pilot-chat/index.ts`
- **Edit:** `supabase/functions/orchestrate/index.ts`
- **Edit:** `supabase/functions/run-agent/index.ts`
