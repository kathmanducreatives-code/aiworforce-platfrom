# Multi-model support: actual implementation

Source snapshot `5d867037`. Current account availability, exact model entitlements and live execution are UNVERIFIED. UI logos and historic code comments are not routing evidence.

| Capability | Actual path | Outcome / classification | Evidence |
|---|---|---|---|
| OpenAI API | `_shared/gptProvider.ts`; `gptModelRouter.ts`; lead strategy adapters | IMPLEMENTED / NOT LIVE VERIFIED. Direct OpenAI transport and strict/JSON response handling; internal Luna/Terra routing/escalation | Prior routing audit actual bindings with injected model responses; model telemetry/request-body tests |
| Anthropic API | `_shared/aiProvider.ts` calls `/v1/messages` | IMPLEMENTED / NOT LIVE VERIFIED. Current generic policy uses `claude-haiku-4-5-20251001`; no live call in audit | M01, M02, M03 and taskModelPolicy tests |
| Gemini task execution | UI option `gemini-pro`; historical gateway references remain | NOT IMPLEMENTED on current shared text path. ProviderName is Anthropic/OpenAI; task policies do not route Gemini | M04; taskModelPolicy; no direct Gemini API transport found |
| Per-agent UI model choice | Builder stores `agents.model`; custom settings display it | BROKEN end to end. `run-agent` reads model but generic execution passes only task type and preferred provider; aiProvider selects TASK_MODELS, ignoring preference | M01 actual mocked transport goes to Anthropic even with preferred OpenAI; source chain below |
| Per-task/workflow user model choice | No approved user-specified task policy threaded end to end | NOT IMPLEMENTED | Task/capability request contracts do not carry this selectable policy |
| Automatic selection | GPT stage ladder, bounded validation-driven escalation; generic TASK_MODELS | IMPLEMENTED / NOT LIVE VERIFIED. Internal routing only; not Nosh's selectable cross-provider policy | gptModelRouter; modelFailurePropagation; taskModelPolicy |
| Model/context switching | Stateless prompt assembly and shared Brain/memory | PARTIALLY WORKING primitives; no versioned user-choice/context replay guarantee | I02 shows same-workspace client context risk; no model policy snapshot |
| Structured outputs | GPT JSON schema when supplied or caller-owned parser; Anthropic text plus JSON extraction | PARTIALLY WORKING; no common strict cross-provider schema/result contract and no Gemini adapter | `modelRequestBody.ts`, `aiProvider.generateJson/extractJson`, evaluator receipts |
| Usage/cost | ModelCallCollector → lead_model_calls; telemetry includes actual model/vendor/intended/fallback | IMPLEMENTED / NOT LIVE VERIFIED. Event-priced estimates depend on stored rates; unknown rates remain unknown | modelCostTelemetry, modelSpendIsBounded, M03 |
| Workspace/client model config | Environment/task constants; `agents.model` label | NOT IMPLEMENTED as enforceable per-client task policy | Current GenerateOpts lacks selected model/policy version/client scope |
| Failure/fallback controls | Critical generic tasks refuse if Anthropic unavailable; helper/input planner may use OpenAI fallback; lead path has its own escalation | IMPLEMENTED / NOT LIVE VERIFIED. No universal automatic cross-provider fallback | M02 refuses without calling; M03 records a declared helper fallback as degraded |
| Model/provider authorization | Server environment credentials, task policy, existing budgets and workspace endpoint access | PARTIALLY WORKING. No per-client provider consent/allowlist tied to user selection | Auth tests; missing user policy/selection enforcement |
| Pricing/usage UI | Billing credits and activity, internal call ledger | PARTIALLY WORKING; not task/provider choice with current quoted costs or client cost attribution | SettingsBilling, modelCostModel; price freshness not verified |

## Exact routing disconnect

1. `src/components/agents/AgentBuilderModal.tsx:143` passes `form.model` to createAgent.
2. `src/lib/orchestration.ts:482` persists it in `agents.model`.
3. `supabase/functions/run-agent/index.ts:1236` selects it along with role_prompt.
4. `run-agent/index.ts:8512` calls generic `generateText` with taskType `agent_execution`, not `agent.model`.
5. `_shared/aiProvider.ts:317` chooses TASK_MODELS by task type; :324 builds attempts from that policy. The `preferredProvider` argument is not consulted.
6. Anthropic transport :270 sends its fixed ANTHROPIC_MODEL. Thus stored GPT/Sonnet/Gemini choices do not establish corresponding execution.

M01 submits the same synthetic task with both provider preferences and records identical Anthropic/Haiku routing; it is not a live provider/model accuracy comparison. In strict expectation mode the selection contract fails. M03 separately proves the allowed helper fallback normalizes content and records two actual-attempt telemetry entries with degraded output. Persistence of those entries in a deployed database is not proven by the callback test.

Comments in providerRouting, run-agent and aiProvider still describe Gemini/Lovable fallback even though current executable task policy removed that gateway. `integration-readiness` reports “connected” from environment-variable presence and can write those statuses into Brain; it is neither a provider health check nor evidence of a working Gemini adapter. Never call it as a read-only probe: it can write Brain state.

## Minimum reusable design — proposal only

Extend existing model boundaries and ledger, rather than create a new agent engine:

- An approved task policy specifies provider, exact allowed model, schema version, token/cost ceiling, permitted fallback(s), data-sharing consent and workspace/client binding. Validate against a server-owned capability registry; UI cannot introduce arbitrary endpoints or models.
- Freeze the policy and Brain/context version with the task. Record requested and actual provider/model, fallback reason, prompt/schema version and source evidence IDs. Retry/resume must reuse these inputs and operation identity.
- Adapters normalize content, structured result, refusal, truncation, timeout, usage and provider request ID into one result contract. Preserve uncertainty and validate semantics/evidence after parsing. No adapter may silently upgrade UNKNOWN evidence.
- Keep current model/provider admission and usage collector for every attempt; fail closed on missing permission or price/budget policy. Do not add model calls to A7's approved budget by introducing multi-model voting.
- Cross-provider contracts must be tested using the same synthetic task and negative evidence. Later, separately approved sandbox calls can compare output validity and grounding. No current provider is certified by these offline tests.

Vendor structured-output support exists, but availability differs by model/schema and is not semantic truth. OpenAI documents refusal/incomplete-response handling; Claude and Gemini document their own schema subsets and model constraints. Use the intersection of an explicitly validated schema or provider-specific schema adapters, plus a shared application validator. [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat), [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

No current dollar quotes or best-model recommendation is inferred from the repository's historic pricing table. Before enabling a provider, verify account-specific access, billing, retention/data-sharing terms, supported schema and token limits under separate authorization.
