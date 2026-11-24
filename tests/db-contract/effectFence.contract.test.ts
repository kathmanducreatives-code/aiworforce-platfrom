// THE LIVE-PRINCIPAL EFFECT FENCE (effectFence.ts, Codex EXEC-EFFECT) on the
// real run-agent handler, real PostgREST + Postgres, every external host
// answered by a fenced fake (nothing leaves the machine).
//
// The principal's membership is removed AFTER the task row has committed and
// BEFORE the first model call; the handler must start no new operation, and
// the task it created must still end terminal (accounting is not an effect).
// Codex's own reproduction (tests/outpost-native/post-insert-revocation-audit
// .test.ts) passes unchanged; this file adds the accounting and positive
// controls. mutation.sh removes the fence's check and its binding.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

async function seed() {
  const ws = await seedWorkspace(), actor = uuid(), plan = uuid();
  await sql`insert into auth.users (id, email) values (${actor}, ${`ef-${actor.slice(0, 8)}@contract.test`})`;
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${actor}, 'owner')`;
  await sql`insert into public.task_plans (id, workspace_id, user_id, user_instruction, status) values (${plan}, ${ws}, ${actor}, 'Synthetic draft', 'running')`;
  await sql`insert into public.agents (workspace_id, slug, name, role_prompt, department)
            values (${ws}, 'scribe', 'Synthetic Scribe', 'Write a short draft using supplied facts only.', 'content')`;
  return { ws, actor, plan };
}

/**
 * Run the real handler. `removeAfter` names the request after which the
 * principal's membership is deleted (and committed): "task_insert" or
 * "first_model". Every non-database request is counted and answered 503.
 */
async function run(removeAfter: "task_insert" | "first_model" | null) {
  const w = await seed();
  const key = await mintJwt("service_role");
  const env: Record<string, string> = {
    RUN_AGENT_IMPORT_ONLY: "1", SUPABASE_URL: REST_URL, SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_ANON_KEY: key,
    OPENAI_API_KEY: "offline", ANTHROPIC_API_KEY: "offline", LOVABLE_API_KEY: "offline",
    MODEL_SPEND_ENFORCEMENT: "enforce", MODEL_SPEND_CEILING_USD: "0.05", MODEL_SPEND_PERIOD_DAYS: "1",
  };
  const saved = new Map(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  const original = globalThis.fetch;
  let removed = false, external = 0, taskSeen = false;
  const remove = async () => {
    await sql`delete from public.workspace_members where workspace_id = ${w.ws} and user_id = ${w.actor}`;
    removed = true;
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (u.origin !== new URL(REST_URL).origin) {
      external++;
      if (removeAfter === "first_model" && !removed) await remove();
      return new Response(JSON.stringify({ error: { message: "offline model blocked" } }),
        { status: 503, headers: { "content-type": "application/json" } });
    }
    const res = await original(u.href.replace(`${REST_URL}/rest/v1`, REST_URL), init);
    if (method === "POST" && u.pathname.endsWith("/tasks") && res.ok && !taskSeen) {
      await res.clone().text();
      taskSeen = true;
      if (removeAfter === "task_insert") await remove();
    }
    return res;
  }) as typeof fetch;
  let status = 0;
  try {
    const { handleRunAgent } = await import("../../supabase/functions/run-agent/index.ts");
    const res = await handleRunAgent(new Request(`${REST_URL}/functions/v1/run-agent`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ workspace_id: w.ws, user_id: w.actor, plan_id: w.plan, step_index: 0, agent_slug: "scribe",
        instruction: "Draft one sentence from this synthetic company fact: it makes test widgets." }),
    }));
    status = res.status;
    await res.body?.cancel();
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of saved) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
  const tasks = await sql`select status from public.tasks where workspace_id = ${w.ws}`;
  return { ...w, removed, external, taskSeen, status, tasks: tasks.map((t) => t.status as string) };
}

Deno.test("fence: membership removed after the task INSERT — no model call starts, and the task still ends terminal", opts, async () => {
  const r = await run("task_insert");
  assert(r.taskSeen && r.removed);
  assertEquals(r.external, 0, "no new external operation after the committed removal");
  assertEquals(r.tasks.length, 1);
  assert(["failed", "complete", "blocked"].includes(r.tasks[0]), `the task is terminal, not left running: ${r.tasks[0]}`);
});

Deno.test("fence: membership removed during the first model call — the call in flight is not interrupted and the task ends terminal", opts, async () => {
  const r = await run("first_model");
  assert(r.removed);
  assertEquals(r.external, 1, "the call already started is not cut off (later calls: effectFenceMission)");
  assert(["failed", "complete", "blocked"].includes(r.tasks[0]), r.tasks[0]);
});

Deno.test("fence positive control: an authorized run reaches the model boundary", opts, async () => {
  const r = await run(null);
  assert(r.external >= 1, "authorized work is not fenced");
  assertEquals(r.tasks.length, 1);
});
