// Independent integration assertions against the actual #179 handler and native
// persistence. A simulated lost response AFTER the first task INSERT stops the
// probe; the committed row (not the response) proves the authorization boundary.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mintJwt,
  REST_URL,
  seedWorkspace,
  sql,
  uuid,
} from "../db-contract/lib/harness.ts";
const opts = { sanitizeOps: false, sanitizeResources: false };
async function probe(
  attack: "foreign_plan" | "removal_after_guard" | "authorized",
) {
  const ws = await seedWorkspace(),
    foreign = await seedWorkspace(),
    actor = uuid(),
    plan = uuid();
  await sql`insert into auth.users(id,email) values (${actor},${`${actor}@audit.example`})`;
  await sql`insert into public.workspace_members(workspace_id,user_id,role) values (${ws},${actor},'owner')`;
  await sql`insert into public.agents(workspace_id,slug,name,role_prompt,department) values (${ws},'scout','Synthetic audit','Research','research')`;
  await sql`insert into public.task_plans(id,workspace_id,user_id,user_instruction,status) values (${plan},${
    attack === "foreign_plan" ? foreign : ws
  },${actor},'Synthetic audit','running')`;
  const key = await mintJwt("service_role");
  const env = {
    RUN_AGENT_IMPORT_ONLY: "1",
    SUPABASE_URL: REST_URL,
    SUPABASE_SERVICE_ROLE_KEY: key,
    SUPABASE_ANON_KEY: key,
    OPENAI_API_KEY: "offline-not-a-key",
    APIFY_API_TOKEN: "offline-not-a-key",
    MODEL_SPEND_ENFORCEMENT: "enforce",
    MODEL_SPEND_CEILING_USD: "0.05",
    MODEL_SPEND_PERIOD_DAYS: "1",
  };
  const saved = new Map(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  const original = globalThis.fetch;
  let removed = false, writes = 0, external = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method =
      (init?.method ?? (input instanceof Request ? input.method : "GET"))
        .toUpperCase();
    if (url.origin !== new URL(REST_URL).origin) {
      external++;
      throw new Error("external request blocked");
    }
    if (
      attack === "removal_after_guard" && !removed &&
      url.pathname.endsWith("/agents") && method === "GET"
    ) {
      await sql`delete from public.workspace_members where workspace_id=${ws} and user_id=${actor}`;
      removed = true;
    }
    if (method !== "GET" && method !== "HEAD") {
      writes++;
      if (
        url.pathname.endsWith("/tasks") && method === "POST" && writes === 1
      ) {
        const response = await original(
          url.href.replace(`${REST_URL}/rest/v1`, REST_URL),
          init,
        );
        await response.text(); // Wait until the native INSERT really committed.
        throw new Error(
          "audit: response lost after task commit; stop further work",
        );
      }
      throw new Error("audit: further write blocked");
    }
    return original(url.href.replace(`${REST_URL}/rest/v1`, REST_URL), init);
  }) as typeof fetch;
  let status = 0;
  let answer: unknown;
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
          agent_slug: "scout",
          instruction: "Synthetic offline call preparation",
        }),
      }),
    );
    status = response.status;
    answer = await response.json();
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of saved) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
  const rows =
    await sql`select t.workspace_id,p.workspace_id as plan_workspace from public.tasks t join public.task_plans p on p.id=t.plan_id where t.plan_id=${plan}`;
  console.log(
    JSON.stringify({
      scenario: attack,
      status,
      answer,
      removed,
      writes,
      external,
      persisted_tasks: rows.length,
      foreign_plan_links: rows.filter((r) =>
        r.workspace_id !== r.plan_workspace
      ).length,
    }),
  );
  assertEquals(external, 0);
  if (attack === "authorized") {
    assertEquals(rows.length, 1, "positive control reaches native task writer");
  } else {assertEquals(
      rows.length,
      0,
      "unauthorized task creation must not commit",
    );}
}
Deno.test(
  "EXEC-PLAN: a member of A cannot create a task linked to a plan in B",
  opts,
  () => probe("foreign_plan"),
);
Deno.test(
  "EXEC-REVOKE: removal committed after entry guard must prevent task creation",
  opts,
  () => probe("removal_after_guard"),
);
Deno.test(
  "EXEC positive: authorized own-workspace request reaches native task writer",
  opts,
  () => probe("authorized"),
);
