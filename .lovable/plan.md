## Goal

Make Pilot a real workforce orchestrator: convert user intent into multi-step plans with the right agents, tools, approval gates, and expected outputs. No UI changes. Keep architecture: pilot-chat → orchestrate → task_plans/tasks → run-agent → toolRegistry.

## Files changed

1. `supabase/functions/pilot-chat/index.ts` — stronger orchestrator system prompt + richer delegate announcement.
2. `supabase/functions/orchestrate/index.ts` — richer planner prompt, expanded `Step` schema, deterministic expansion, tool-availability annotation, improved persistence + activity log.
3. `supabase/functions/_shared/toolRegistry.ts` — small helper `isToolConfigured(name)` so orchestrate can flag missing connectors without trying to execute.

No new tables, no migrations, no RLS changes. All extra fields are stored inside the existing `task_plans.steps` JSON column (already JSONB).

## 1. Pilot system prompt (pilot-chat)

Rewrite `PILOT_SYSTEM_PROMPT` so Pilot knows:
- It is the orchestrator/router/planner — not a chatbot.
- DELEGATE is the default whenever the user asks for sourcing, research/extraction, competitive intel, outreach, content, or screening. REPLY only for greetings, capability questions, or pure clarifications.
- Trigger word groups (A–F from spec) are listed verbatim so the decision is stable.
- When delegating, the `instruction` it forwards must be a complete restated work order, including any URL, count, role, geography, criteria, or recipient mentioned by the user.

Output contract unchanged: `{ "decision": "reply" | "delegate", ... }`.

## 2. Orchestrate planner

### Expanded step schema

```ts
type Step = {
  step_index: number;
  agent_slug: 'scout'|'aria'|'penn'|'hawk'|'scribe';
  agent_name: string;
  task_title: string;          // short
  task_description: string;    // full instruction for run-agent
  instruction: string;         // = task_description, kept for back-compat
  tool_needed: 'research_web'|'scrape_url'|'summarize_text'|'extract_structured'|'draft_outreach'|'send_email'|null;
  expected_output: string;
  success_criteria: string;
  requires_approval: boolean;
  needs_approval: boolean;     // alias, kept for run-agent back-compat
  planner_source: 'ai'|'fallback'|'expansion';
  tool_status?: 'ready'|'connector_required';
  connector_required?: string; // e.g. 'PERPLEXITY_API_KEY'
};
```

### New planner prompt

Reworked to:
- Enumerate the six workflow archetypes (A–F) with their default agent chains.
- List the tool catalog (`research_web`, `scrape_url`, `summarize_text`, `extract_structured`, `draft_outreach`, `send_email`) and which agents may use each.
- Require Pilot's plan to include `task_title`, `task_description`, `tool_needed`, `expected_output`, `success_criteria`, `requires_approval`.
- Force `send_email` and any external write step to `requires_approval: true`.
- Forbid claiming live data was retrieved.

### Deterministic expansion (runs after model output, before persistence)

`expandPlan(instruction, steps)` rules:

- **Sourcing** (`find|source|candidates|engineers|developers|leads|prospects|founders|companies`): if plan lacks Scout, prepend Scout(research_web/scrape_url); if lacks Aria, append Aria(extract_structured); if lacks Penn, append Penn(draft_outreach, requires_approval).
- **Extraction from URL** (contains `http(s)://` or `from this (url|website|page)`): ensure first step is Hawk or Scout with `tool_needed=scrape_url`.
- **Competitor / latest / today** (`competitor|market|today|latest|monitor|changed|funding|hiring|pricing|launches`): ensure a Hawk step with `tool_needed=research_web`; append Scribe summary if any "brief/report/summary" word present.
- **Outreach/send** (`send|email|outreach|follow.?up|message|sequence`): ensure Penn step; if user asked to send, append a `send_email` step with `requires_approval=true`; never auto-send.
- **Content** (`write|post|linkedin|blog|brief|memo|report|summary`): ensure Scribe; prepend Hawk/Scout research only if user asked for "current/today/latest" facts.
- **Ranking** (`rank|screen|score|shortlist|evaluate|compare|fit`): ensure Aria; do not add Penn unless user asked for outreach.
- **"Brief me on today"** default plan: Scribe (internal activity + pending approvals + active plans) → Hawk(research_web) only if Perplexity is configured.

After expansion, `step_index` is renumbered 0..n-1 and `planner_source` set to `'expansion'` for any step the expander added.

### Tool-availability annotation

Use a new `isToolConfigured(name)` from toolRegistry:
- `research_web` → `PERPLEXITY_API_KEY`
- `scrape_url` → `FIRECRAWL_API_KEY`
- `send_email` → `RESEND_API_KEY`
- `summarize_text`, `extract_structured`, `draft_outreach` → always ready (Lovable AI Gateway).

For each step with a `tool_needed`, set `tool_status = 'ready' | 'connector_required'` and `connector_required = '<ENV_VAR>'` when missing. The plan is still created; run-agent already returns a graceful unavailable result when the tool is missing.

### Persistence

- Insert into `task_plans` as today, with the richer `steps` JSON.
- Also write the `intent` (sourcing/research/intel/outreach/content/screening/brief/general) into the `steps[0]` parent or as a top-level field on the plan summary string — no new column.
- Keep kicking off step 0 via `run-agent` (unchanged).
- Activity feed `plan_created` event metadata gets `intent`, `tools_required`, `connectors_missing`.

### Response back to pilot-chat

`orchestrate` already returns `plan_summary`, `total_steps`, `task_plan_id`. Add `agents: string[]`, `intent: string`, `connectors_missing: string[]`.

## 3. pilot-chat announcement upgrade

After receiving the orchestrate response, build the announcement from the new fields:

> "I created a {N}-step plan: {Agent1} will {verb1}, {Agent2} will {verb2}, …. {ApprovalNote}{ConnectorNote}"

- `verbN` derived from `task_title`.
- `ApprovalNote`: "Penn will pause for your approval before sending." when any step has `requires_approval` + `tool_needed=send_email`.
- `ConnectorNote`: "Live {capability} requires a {connector} connector." when `connectors_missing` is non-empty (mapped to friendly names: Perplexity, Firecrawl, Resend).

## 4. toolRegistry helper

Add and export:

```ts
const TOOL_ENV: Record<string, string> = {
  research_web: 'PERPLEXITY_API_KEY',
  scrape_url:   'FIRECRAWL_API_KEY',
  send_email:   'RESEND_API_KEY',
};
export function isToolConfigured(name: string): { ready: boolean; env?: string } {
  const env = TOOL_ENV[name];
  if (!env) return { ready: true };
  return { ready: !!Deno.env.get(env), env };
}
```

No behavior change to existing `runTool`.

## Safety rules preserved

- RLS untouched; workspace membership still checked in orchestrate.
- `send_email` and any external write stay approval-gated via toolRegistry; orchestrate only marks intent, it never bypasses approvals.
- No mock data: if a tool is `connector_required`, the plan is created but tasks declare `tool_status='connector_required'` and Pilot's reply tells the user which connector to add.
- API keys remain server-side only.

## Verification (after build)

Manually trigger each prompt from the chat and confirm via `task_plans` + `activity_feed`:

1. "Find 10 React engineers in London" → 3 steps Scout→Aria→Penn, Penn requires_approval=true.
2. "Extract hiring signals from this competitor careers page: https://example.com/careers" → Hawk(scrape_url) + Scribe.
3. "What changed at our top 3 competitors today?" → Hawk(research_web); if no Perplexity, connector_required note in announcement.
4. "Draft outreach to the top candidates" → Penn draft; no send_email step unless user said "send".
5. "Write a LinkedIn post about our Q4 wins" → Scribe only.
6. "Rank these 5 candidates for a senior React role" → Aria only.
7. "Brief me on today" → Scribe internal brief (+ Hawk if Perplexity present).
8. "hello" → REPLY, no plan.

Final report after implementation will list: files changed, exact prompt diffs, deterministic rules added, new step metadata fields, test outcomes per prompt, and any connectors still missing in this workspace.
