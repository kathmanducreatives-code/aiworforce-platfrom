
## ⚠️ Critical issues with the request as written

Before doing anything, three things have to be flagged — your spec as written would **leak both API keys publicly and break the entire app**.

### 1. The keys you pasted are now compromised

You shared real `sk-ant-…` and `sk-proj-…` keys in chat. Treat them as **leaked**. Please rotate both immediately at console.anthropic.com and platform.openai.com **before** we wire anything up. I'll use whatever you generate next — never the ones above.

### 2. Putting `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in `.env` and `import.meta.env` puts them in the browser bundle

Vite only exposes vars prefixed with `VITE_`, **but** Step 2 reads them as `import.meta.env.ANTHROPIC_API_KEY` — which would be `undefined`. The only way to make that code "work" is to prefix them `VITE_…`, which **inlines the secret into the JS bundle every visitor downloads**. That is exactly what your own Rules section forbids. Anthropic and OpenAI's SDKs even refuse to run in browsers without an explicit `dangerouslyAllowBrowser: true` flag for this reason.

The correct pattern (and the one already used everywhere else in this project — Lovable AI, Resend, etc.) is: **secrets live in Supabase Edge Function env, not in `.env`. The frontend calls an edge function, which calls the model.**

### 3. Enabling Cloud blew away the generated DB types — the build is currently broken

When Cloud was just enabled, `src/integrations/supabase/types.ts` was reset to an empty schema (`Tables: { [_ in never]: never }`). That's why you see ~hundreds of `Argument of type '"resume_analyses"' is not assignable to parameter of type 'never'` errors. None of the existing tables (`resume_analyses`, `candidate_profiles`, `agents`, `tasks`, …) are typed anymore, so almost every page fails to compile.

This has to be fixed first — otherwise nothing else ships.

---

## Proposed plan

### Step 0 — Unblock the build (mandatory, do first)

Run a no-op migration to force Supabase to regenerate `src/integrations/supabase/types.ts` from the live database schema. All your existing tables are still there in Postgres; only the TS types file got wiped. Once regenerated, all the `"resume_analyses" is not assignable to never` errors disappear in one shot.

If regen doesn't pick everything up, fall back to manually re-running the most recent schema migration so the types tool sees current state.

### Step 1 — You rotate the leaked keys, then store them as Edge Function secrets

I'll trigger the secrets prompt for:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`

You paste the **newly rotated** values into the secure Lovable secrets dialog. They never touch `.env`, never touch `import.meta.env`, never enter the browser bundle. Existing `LOVABLE_API_KEY` and `RESEND_API_KEY` already follow this same pattern.

### Step 2 — Create the central AI client **on the server, not the client**

Instead of `src/lib/ai-clients.ts`, create `supabase/functions/_shared/ai-clients.ts` with the same intent as your spec:

```ts
// supabase/functions/_shared/ai-clients.ts
import Anthropic from 'npm:@anthropic-ai/sdk';
import OpenAI from 'npm:openai';

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
const openai    = new OpenAI({    apiKey: Deno.env.get('OPENAI_API_KEY')! });

export const MODEL_MAP: Record<string, 'anthropic' | 'openai'> = {
  'claude-sonnet-4-20250514':  'anthropic',
  'claude-haiku-4-5-20251001': 'anthropic',
  'gpt-4o':                    'openai',
};

export async function callAI(model: string, prompt: string, systemPrompt?: string) {
  const provider = MODEL_MAP[model];
  if (provider === 'anthropic') {
    const r = await anthropic.messages.create({
      model, max_tokens: 1024, system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    return r.content[0].type === 'text' ? r.content[0].text : '';
  }
  if (provider === 'openai') {
    const r = await openai.chat.completions.create({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user' as const, content: prompt },
      ],
    });
    return r.choices[0].message.content ?? '';
  }
  throw new Error(`Unknown model: ${model}`);
}
```

Same shape and `MODEL_MAP` semantics as your spec — just lives where secrets are safe.

### Step 3 — Wire `run-agent` (and `orchestrate`) to use `callAI`

Currently `run-agent/index.ts` only simulates work with a 600 ms `setTimeout` (line 75) and writes `{ note: 'auto-completed' }` to the task output. I'll replace that with:

```ts
const result = await callAI(agent.model, task.description, agent.role_prompt);
// store result in tasks.output
await admin.from('tasks').update({
  status: 'complete', finished_at: finishedAt,
  output: { text: result, model: agent.model },
}).eq('id', task.id);
```

Plus: switch `orchestrate/index.ts`'s planner from the Lovable AI Gateway call to `callAI('claude-sonnet-4-20250514', …)` so the orchestrator itself runs on Claude Sonnet, matching your Step 5 verification flow.

### Step 4 — Frontend: no SDK install, no client-side keys

Skip `npm install @anthropic-ai/sdk openai` on the frontend. The SDKs get installed automatically by Deno (`npm:@anthropic-ai/sdk`) inside the edge function only. The browser bundle stays clean.

If you ever need `callAI` from the React side, it goes through `supabase.functions.invoke('run-agent', …)` — which is already how the dock and command center talk to agents.

### Step 5 — Verification

Same as your spec, just routed through the new path:
1. Send a message without `@` in the Command Center → `orchestrate` → Claude Sonnet returns a plan.
2. `@scout` task → `run-agent` reads `agent.model = 'gpt-4o'` → routes via OpenAI.
3. `@aria` task → `run-agent` reads `agent.model = 'claude-haiku-4-5-20251001'` → routes via Anthropic.

I'll also add a tiny `text` field render in the activity feed so you can see the model's actual response, not just `auto-completed`.

---

## Files I will create / modify

**Create**
- `supabase/functions/_shared/ai-clients.ts` — the shared `callAI` + `MODEL_MAP`
- `supabase/migrations/<ts>_regen_types_noop.sql` — no-op DDL to trigger types regeneration

**Modify**
- `supabase/functions/run-agent/index.ts` — replace `setTimeout(600)` simulation with real `callAI(agent.model, …)` and write the model output into `tasks.output`
- `supabase/functions/orchestrate/index.ts` — swap the Lovable AI Gateway planner call for `callAI('claude-sonnet-4-20250514', …)`
- `src/components/command-center/…` (the bubble that renders task output) — surface the new `output.text` so verification is visible

**Will NOT create**
- `src/lib/ai-clients.ts` — would leak keys to the browser. Replaced by the shared edge module above.
- `.env` entries for `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — secrets go in Edge Function env only.

---

## What I need from you before I start coding

1. **Rotate both leaked keys** at Anthropic and OpenAI. Do not reuse the ones pasted in chat.
2. Confirm you want the orchestrator on `claude-sonnet-4-20250514` (your Step 5 implies it). If you'd rather keep the planner on Lovable AI / Gemini and only route per-agent tasks through Anthropic/OpenAI, say so and I'll skip the orchestrate change.
3. Approve and I'll: regen types → prompt for the two new (rotated) secrets → ship the shared client → wire `run-agent` and `orchestrate` → verify with @scout / @aria.
