import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mintJwt,
  REST_URL,
  seedWorkspace,
  sql,
  uuid,
} from "../db-contract/lib/harness.ts";
async function run(remove: boolean) {
  const ws = await seedWorkspace(), actor = uuid(), plan = uuid();
  await sql`insert into auth.users(id,email) values(${actor},${`${actor}@offline.example`})`;
  await sql`insert into public.workspace_members(workspace_id,user_id,role) values(${ws},${actor},'owner')`;
  await sql`insert into public.task_plans(id,workspace_id,user_id,user_instruction,status) values(${plan},${ws},${actor},'Synthetic draft','running')`;
  await sql`insert into public.agents(workspace_id,slug,name,role_prompt,department) values(${ws},'scribe','Synthetic Scribe','Write a short draft using supplied facts only.','content')`;
  const key = await mintJwt("service_role");
  const values = {
    RUN_AGENT_IMPORT_ONLY: "1",
    SUPABASE_URL: REST_URL,
    SUPABASE_SERVICE_ROLE_KEY: key,
    SUPABASE_ANON_KEY: key,
    OPENAI_API_KEY: "offline",
    ANTHROPIC_API_KEY: "offline",
    LOVABLE_API_KEY: "offline",
    MODEL_SPEND_ENFORCEMENT: "enforce",
    MODEL_SPEND_CEILING_USD: "0.05",
    MODEL_SPEND_PERIOD_DAYS: "1",
  };
  const saved = new Map(Object.keys(values).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(values)) Deno.env.set(k, v);
  const original = globalThis.fetch;
  let removed = false, models = 0, inserted = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    const method =
      (init?.method ?? (input instanceof Request ? input.method : "GET"))
        .toUpperCase();
    if (u.origin !== new URL(REST_URL).origin) {
      models++;
      return new Response(
        JSON.stringify({ error: { message: "offline model blocked" } }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }
    const response = await original(
      u.href.replace(`${REST_URL}/rest/v1`, REST_URL),
      init,
    );
    if (
      method === "POST" && u.pathname.endsWith("/tasks") && response.ok &&
      !inserted
    ) {
      await response.clone().text();
      inserted = true;
      if (remove) {
        await sql`delete from public.workspace_members where workspace_id=${ws} and user_id=${actor}`;
        removed = true;
      }
    }
    return response;
  }) as typeof fetch;
  try {
    const { handleRunAgent } = await import(
      "../../supabase/functions/run-agent/index.ts"
    );
    const response = await handleRunAgent(
      new Request(`${REST_URL}/functions/v1/run-agent`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workspace_id: ws,
          user_id: actor,
          plan_id: plan,
          step_index: 0,
          agent_slug: "scribe",
          instruction:
            "Draft one sentence from this synthetic company fact: it makes test widgets.",
        }),
      }),
    );
    console.log(
      JSON.stringify({
        case: remove ? "revoke_after_insert" : "authorized_model_control",
        removed,
        inserted,
        model_attempts: models,
        status: response.status,
      }),
    );
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of saved) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
  assert(inserted, "control must reach actual native task insertion");
  if (remove) {
    assert(removed);
    assertEquals(
      models,
      0,
      "revoked principal must not start new model/provider operations",
    );
  } else {assert(
      models > 0,
      "authorized control must reach the model boundary with all providers mocked",
    );}
}
Deno.test({
  name:
    "POST-INSERT-REVOKE: removal before model invocation prevents new model attempts",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => run(true),
});
Deno.test({
  name:
    "POST-INSERT positive: authorized work reaches the mocked model boundary",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => run(false),
});
