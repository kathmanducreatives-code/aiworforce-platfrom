# AI Workforce Tool System — Phase 1 to 4 (+ stubs for 5–7)

Scope: durable tool infrastructure for the existing pipeline `pilot-chat → orchestrate → run-agent`. No UI redesign, no frontend tool calls, no RLS off, backend stays `wqnigjhcwjxtmordrwno`.

Currently configured secrets include `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `LOVABLE_API_KEY`. `PERPLEXITY_API_KEY` and `FIRECRAWL_API_KEY` are not configured yet — the registry will degrade gracefully when missing and surface a clear "connector not configured" message.

## 1. Database migration — `tool_calls`

New table `public.tool_calls`:

- `id uuid pk default gen_random_uuid()`
- `workspace_id uuid not null`
- `plan_id uuid null`, `task_id uuid null`, `agent_id uuid null`
- `tool_name text not null`, `provider text not null`
- `input_json jsonb`, `output_json jsonb`
- `status text not null default 'queued'` (queued | running | succeeded | failed | unavailable)
- `error text null`
- `started_at timestamptz`, `completed_at timestamptz`
- `created_by uuid null`, `created_at timestamptz default now()`

Indexes: `workspace_id`, `task_id`, `agent_id`, `status`, `created_at desc`.

GRANTs + RLS:
- `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated; GRANT ALL … TO service_role;`
- RLS on. Policies:
  - SELECT for `authenticated` where `has_workspace_access(auth.uid(), workspace_id)`.
  - INSERT/UPDATE for `authenticated` where `has_workspace_access(auth.uid(), workspace_id)`. Edge functions use the service-role client and bypass RLS.
  - No DELETE policy (immutable log).

## 2. Backend tool registry

New shared module `supabase/functions/_shared/toolRegistry.ts` (Deno-resolvable via relative import from each function). Exports:

```ts
type ToolContext = { admin, workspace_id, agent_slug, agent_id, plan_id, task_id, user_id };
type ToolResult = { ok: boolean; data?: unknown; error?: string; unavailable?: boolean };
type Tool = {
  name: string;
  provider: string;
  description: string;
  allowed_agents: string[];
  requires_approval: boolean;
  inputSchema: ZodLike;            // lightweight runtime check, no external dep
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
};

export async function runTool(toolName, input, ctx): Promise<ToolResult>
```

`runTool` is the single entry point. It:
1. Looks up the tool. Unknown → `tool_not_found` (logged).
2. Checks `allowed_agents.includes(ctx.agent_slug)`. Wrong agent → `tool_forbidden`.
3. Inserts a `tool_calls` row with status `queued` → flips to `running` → final state.
4. Validates input against schema; bad input → `failed`.
5. Calls `tool.execute`. Catches throws, fills `error`, status `failed`.
6. Missing secret → status `unavailable`, error `"<PROVIDER>_API_KEY not configured"`.
7. Writes an `activity_feed` entry (`tool_used` event) on success and a `tool_failed` entry on failure/unavailable.

Initial registry entries (only #1 actually executes; the rest are declared stubs so `allowed_agents` validation works and Phase 5–7 can plug in):

1. `research_web` — provider `perplexity`, agents `hawk, scout`, approval `false` — **implemented**.
2. `scrape_url` — provider `firecrawl`, agents `hawk, scout`, approval `false` — declared, returns `unavailable` until FIRECRAWL_API_KEY exists.
3. `summarize_text` — provider `gemini` (via existing `GOOGLE_AI_API_KEY`), agents `scribe, aria, hawk, scout`, approval `false` — declared, implemented in Phase 6 only if needed (skipped for now to keep scope tight).
4. `draft_outreach` — provider `anthropic`, agents `penn`, approval `false` — declared stub.
5. `send_email` — provider `resend`, agents `penn`, approval `true` — declared stub (approval gate plumbed in Phase 7).

## 3. Implement `research_web` (Perplexity)

Inside the registry module:

- Read `PERPLEXITY_API_KEY` at call time. Missing → return `{ ok: false, unavailable: true, error: "PERPLEXITY_API_KEY not configured" }`.
- Direct fetch to `https://api.perplexity.ai/chat/completions`, model `sonar`, 25 s timeout, single retry on 5xx.
- Returns `{ ok: true, data: { content, citations[] } }`.
- All input/output captured into `tool_calls.input_json` / `output_json`.

## 4. Wire `run-agent` to call the registry

Edit `supabase/functions/run-agent/index.ts`:

- Per agent slug, pick a default tool when the step's `instruction` implies research:
  - `hawk` → always `research_web`.
  - `scout` → `research_web` for sourcing-strategy steps; **no candidate fabrication**. If Perplexity returns `unavailable`, Scout's output explicitly says: *"Live candidate discovery requires Perplexity / Firecrawl / Apollo connector."*
  - `aria`, `penn`, `scribe` → unchanged Claude reasoning path (no tool call yet).
- Tool result is concatenated into the model context so the agent can summarize it back to the user.
- Activity feed records `agent_used_tool` with tool name + provider.

## 5. Pilot / orchestrate (no contract change)

Already routes Hawk for competitor/market/"brief me" intents and Scout/Aria/Penn for sourcing (verified in last turn's fallback planner). No edits needed unless Phase 9 testing reveals routing gaps.

## 6. Approval gate (Phase 7 stub only)

For `send_email`: when `runTool` sees `requires_approval: true`, it does not call `execute`. Instead it:
- inserts `approvals` row with `plan_id, task_id, agent_id, title="Send email", description=<subject>`,
- writes `tool_calls` row status `queued` linked to the approval,
- writes `activity_feed` entry "Penn email send awaiting approval",
- returns `{ ok: false, error: "awaiting_approval" }` so the agent loop pauses.

The existing `approve-and-continue` function will later flip the `tool_calls` row to `running` and call `execute`. Not building send logic in this round.

## 7. Frontend

No component changes. Tool output already surfaces via the assistant message Pilot persists and via `activity_feed` (which the dashboard already reads). A dedicated "Tool Calls" panel is deferred.

## 8. Verification checklist (after implementation)

1. `"hello"` → normal Pilot reply, no tool_calls row.
2. `"Brief me on today"` → Hawk task, `tool_calls(research_web)` row, `succeeded` if `PERPLEXITY_API_KEY` set else `unavailable`; assistant message reflects either the brief or the connector-needed notice.
3. `"What changed at our top 3 competitors today?"` → same as above; no hallucinated data when unavailable.
4. `"Find 10 React engineers in London"` → 3-step plan (Scout → Aria → Penn); Scout tool_call recorded; no fake candidates.
5. `"Draft outreach to the top candidates"` → Penn drafts text; no email is sent; no `send_email` execution.

## Files to add / edit

```text
supabase/migrations/<ts>_tool_calls.sql          NEW
supabase/functions/_shared/toolRegistry.ts       NEW
supabase/functions/run-agent/index.ts            EDIT (call runTool for hawk/scout)
```

No edits to `pilot-chat`, `orchestrate`, `WorkspaceContext`, RLS helpers, or any UI file.

## Out of scope (explicit)

- Firecrawl, Apollo, LinkedIn-style live candidate connectors.
- `summarize_text`, `draft_outreach`, `send_email` execution bodies.
- Tool Calls UI panel.
- Streaming tool output.
- Any change to `chat-respond` (still removed) or `pilot-chat` contract.

## Open question

Should I request `PERPLEXITY_API_KEY` from you now via the secure secrets prompt so `research_web` runs live on first try, or leave it unconfigured for now and let Hawk return the "connector not configured" message until you're ready?
