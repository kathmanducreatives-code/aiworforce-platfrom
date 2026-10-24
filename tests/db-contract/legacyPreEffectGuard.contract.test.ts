// THE LEGACY PRE-EFFECT GUARD through the REAL handlers (run-agent, orchestrate,
// enqueue-lead-mission) against real PostgREST + real Postgres.
//
// Every refusal is judged by EFFECTS, not by the status: row counts of every
// table a run writes (tasks, plans, messages, ledger, credits, queue, tool
// calls, lineages) are unchanged, no request left for a model or provider host,
// and no write reached the database. A blocked transport is recorded even when
// the caller swallows the failure.
//
// Covered: the pilot marker on the request; the STORED pilot task with the
// request's markers stripped (resume); a client-scoped request; a requester who
// is no longer a member; a resume by a different principal; a task of another
// workspace. Positive controls: a current member's non-pilot request passes
// the guard (and the A7 scenario suites run full missions through it).
// tests/db-contract/mutation.sh removes each part and requires a named test to fail.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";
import { MISSION, PROPOSAL } from "./lib/discoveryScenario.ts";
import { compileLeadMission } from "../../supabase/functions/_shared/leadMissionCompiler.ts";

// A real compiled mission (no model call): both entries refuse a kickoff without one.
const LEAD_MISSION = compileLeadMission({ originalUserQuery: MISSION, proposal: PROPOSAL as never, requestedCount: 1 }).final_mission;

const opts = { sanitizeResources: false, sanitizeOps: false };

type Sent = { method: string; host: string; path: string };
const EFFECT_TABLES = ["tasks", "task_plans", "lead_execution_calls", "credit_transactions",
  "lead_mission_queue", "tool_calls", "lead_lineages"] as const;

async function effects(ws: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of EFFECT_TABLES) {
    out[t] = Number((await sql.unsafe(`select count(*)::int n from public.${t} where workspace_id = $1`, [ws]))[0].n);
  }
  // Messages have no workspace column; tests in a file run one at a time, so the global count is exact.
  out.messages = Number((await sql`select count(*)::int n from public.messages`)[0].n);
  return out;
}

/** Runs `fn` with the handlers' env and a fenced transport; returns what was sent. */
async function fenced<T>(env: Record<string, string>, authUser: string | null, fn: () => Promise<T>): Promise<{ value: T; sent: Sent[] }> {
  const original = globalThis.fetch;
  const sent: Sent[] = [];
  const saved = new Map(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    sent.push({ method, host: url.host, path: url.pathname });
    const rest = new URL(REST_URL);
    if (url.host === rest.host && url.pathname.startsWith("/auth/v1/user")) {
      // GoTrue's user lookup for orchestrate's JWT: the test user, or 401.
      return Promise.resolve(authUser
        ? new Response(JSON.stringify({ id: authUser, aud: "authenticated", role: "authenticated" }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("{}", { status: 401 }));
    }
    if (url.host === rest.host) return original(url.href.replace(`${REST_URL}/rest/v1`, REST_URL), init);
    // Anything else (a model, a provider, a webhook) is an EFFECT: recorded, blocked.
    return Promise.resolve(new Response(JSON.stringify({ error: "blocked by the test fence" }), { status: 599 }));
  }) as typeof fetch;
  try {
    return { value: await fn(), sent };
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of saved) { if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v); }
  }
}

const vendorRequests = (sent: Sent[]) => sent.filter((s) => s.host !== new URL(REST_URL).host);
const dbWrites = (sent: Sent[]) => sent.filter((s) => s.host === new URL(REST_URL).host && s.method !== "GET" && s.method !== "HEAD" && !s.path.startsWith("/auth/"));

async function world() {
  const ws = await seedWorkspace();
  const member = uuid(), teammate = uuid();
  for (const u of [member, teammate]) {
    await sql`insert into auth.users (id, email) values (${u}, ${`guard-${u.slice(0, 8)}@contract.test`})`;
    await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${u}, 'owner')`;
  }
  await sql`insert into public.agents (workspace_id, slug, name, role_prompt, department) values (${ws}, 'scout', 'Guard Scout', 'Find companies.', 'research')`;
  const plan = uuid();
  await sql`insert into public.task_plans (id, workspace_id, user_id, user_instruction, status) values (${plan}, ${ws}, ${member}, 'Find 1 US B2B software company', 'running')`;
  const pilotTask = uuid();
  await sql`insert into public.tasks (id, workspace_id, user_id, plan_id, status, agent_slug, payload)
    values (${pilotTask}, ${ws}, ${member}, ${plan}, 'ready', 'scout',
            ${sql.json({ execution_mode: "pilot_draft_only", pilot_scope: "signed.claims.v1", pilot_origin_session_id: uuid() } as never)})`;
  const ownTask = uuid();
  await sql`insert into public.tasks (id, workspace_id, user_id, plan_id, status, agent_slug, payload)
    values (${ownTask}, ${ws}, ${member}, ${plan}, 'running', 'scout', ${sql.json({ instruction: "nonpilot" } as never)})`;
  return { ws, member, teammate, plan, pilotTask, ownTask };
}

const kickoff = (w: { ws: string; plan: string }, user: string, extra: Record<string, unknown> = {}) => ({
  plan_id: w.plan, step_index: 0, agent_slug: "scout", workspace_id: w.ws, user_id: user,
  instruction: "Find 1 US B2B software company", requested_lead_count: 1, ...extra,
});

async function runAgent(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown>; sent: Sent[] }> {
  const key = await mintJwt("service_role");
  const { value, sent } = await fenced({
    RUN_AGENT_IMPORT_ONLY: "1", SUPABASE_URL: REST_URL, SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_ANON_KEY: key,
    OPENAI_API_KEY: "fake-openai-no-network", APIFY_API_TOKEN: "fake-apify-no-network",
    MODEL_SPEND_ENFORCEMENT: "enforce", MODEL_SPEND_CEILING_USD: "0.05", MODEL_SPEND_PERIOD_DAYS: "1",
  }, null, async () => {
    const { handleRunAgent } = await import("../../supabase/functions/run-agent/index.ts");
    const res = await handleRunAgent(new Request(`${REST_URL}/functions/v1/run-agent`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
  });
  return { ...value, sent };
}

async function assertRefusedWithoutEffect(ws: string, call: () => Promise<{ status: number; json: Record<string, unknown>; sent: Sent[] }>, code: string, status: number) {
  const before = await effects(ws);
  const r = await call();
  assertEquals([r.status, r.json.error], [status, code], JSON.stringify(r.json));
  assertEquals(await effects(ws), before, "no row written anywhere");
  assertEquals(vendorRequests(r.sent), [], "no model / provider / webhook request");
  assertEquals(dbWrites(r.sent), [], "no database write");
}

Deno.test("run-agent: a resume of a STORED pilot task is refused before any effect, with the request's markers stripped", opts, async () => {
  const w = await world();
  await assertRefusedWithoutEffect(w.ws, () => runAgent(kickoff(w, w.member, { resume_task_id: w.pilotTask })), "pilot_execution_disabled", 403);
});

Deno.test("run-agent: a request carrying the pilot marker is refused before any effect", opts, async () => {
  const w = await world();
  await assertRefusedWithoutEffect(w.ws,
    () => runAgent(kickoff(w, w.member, { tool_input: { execution_mode: "pilot_draft_only" } })), "pilot_execution_disabled", 403);
});

Deno.test("run-agent: a client-scoped request is refused before any effect (client research disabled until #174)", opts, async () => {
  const w = await world();
  await assertRefusedWithoutEffect(w.ws,
    () => runAgent(kickoff(w, w.member, { tool_input: { client_id: uuid() } })), "client_scope_unsupported", 403);
});

Deno.test("run-agent: a service call for a user who is no longer a member is refused before any effect", opts, async () => {
  const w = await world();
  await sql`delete from public.workspace_members where workspace_id = ${w.ws} and user_id = ${w.member}`;
  await assertRefusedWithoutEffect(w.ws, () => runAgent(kickoff(w, w.member)), "principal_not_member", 403);
  // …and so is the resume of that user's existing task (the sweeper's and the worker's path).
  await assertRefusedWithoutEffect(w.ws, () => runAgent(kickoff(w, w.member, { resume_task_id: w.ownTask })), "principal_not_member", 403);
});

Deno.test("run-agent: a resume keeps its original principal — another member cannot resume it", opts, async () => {
  const w = await world();
  await assertRefusedWithoutEffect(w.ws, () => runAgent(kickoff(w, w.teammate, { resume_task_id: w.ownTask })), "principal_mismatch", 403);
});

Deno.test("run-agent: a task of another workspace is refused before any effect", opts, async () => {
  const w = await world(), other = await world();
  await assertRefusedWithoutEffect(w.ws, () => runAgent(kickoff(w, w.member, { resume_task_id: other.ownTask })), "referenced_task_foreign", 409);
});

Deno.test("run-agent positive control: a current member's non-pilot request passes the guard", opts, async () => {
  const w = await world();
  // An unknown agent is the first check AFTER the guard: reaching it proves the
  // guard admitted the request, with nothing bought (the full A7 scenario
  // suites run whole missions through the same guard).
  const r = await runAgent(kickoff(w, w.member, { agent_slug: "no-such-agent" }));
  assertEquals([r.status, r.json.error], [404, "agent_not_found"], JSON.stringify(r.json));
  // A teammate may still CONTINUE someone's work as a new child task (a parent, not a resume).
  const c = await runAgent(kickoff(w, w.teammate, { agent_slug: "no-such-agent", lead_resume_parent_task_id: w.ownTask }));
  assertEquals([c.status, c.json.error], [404, "agent_not_found"], JSON.stringify(c.json));
});

async function enqueue(request: Record<string, unknown>, ws: string): Promise<{ status: number; json: Record<string, unknown>; sent: Sent[] }> {
  const key = await mintJwt("service_role");
  const { value, sent } = await fenced({
    ENQUEUE_LEAD_MISSION_IMPORT_ONLY: "1", SUPABASE_URL: REST_URL, SUPABASE_SERVICE_ROLE_KEY: key,
    LEAD_V2_WORKER_WORKSPACES: ws,
  }, null, async () => {
    const { handleEnqueueLeadMission } = await import("../../supabase/functions/enqueue-lead-mission/index.ts");
    const res = await handleEnqueueLeadMission(new Request(`${REST_URL}/functions/v1/enqueue-lead-mission`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ request }),
    }));
    return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
  });
  return { ...value, sent };
}

Deno.test("enqueue-lead-mission: no pilot, client-scoped or non-member mission is queued", opts, async () => {
  const w = await world();
  const body = (u: string, extra: Record<string, unknown> = {}) => ({
    ...kickoff(w, u), workflow_kind: "qualified_lead_sourcing", execution_mode: "company_first", tool_needed: "source_with_apify",
    lead_mission: LEAD_MISSION, tool_input: { lead_mission: LEAD_MISSION, source_type: "jobs" }, ...extra,
  });
  await assertRefusedWithoutEffect(w.ws, () => enqueue(body(w.member, { execution_mode: "pilot_draft_only" }), w.ws), "pilot_execution_disabled", 403);
  await assertRefusedWithoutEffect(w.ws, () => enqueue(body(w.member, { client_id: uuid() }), w.ws), "client_scope_unsupported", 403);
  await sql`delete from public.workspace_members where workspace_id = ${w.ws} and user_id = ${w.teammate}`;
  await assertRefusedWithoutEffect(w.ws, () => enqueue(body(w.teammate), w.ws), "principal_not_member", 403);
  // Positive control: a member's non-pilot mission is queued.
  const ok = await enqueue(body(w.member), w.ws);
  assertEquals(ok.status, 201, JSON.stringify(ok.json));
  assertEquals(Number((await sql`select count(*)::int n from public.lead_mission_queue where workspace_id = ${w.ws}`)[0].n), 1);
});

async function orchestrate(body: Record<string, unknown>, user: string): Promise<{ status: number; json: Record<string, unknown>; sent: Sent[] }> {
  const key = await mintJwt("service_role");
  const userJwt = await mintJwt("authenticated", user);
  const { value, sent } = await fenced({
    ORCHESTRATE_IMPORT_ONLY: "1", SUPABASE_URL: REST_URL, SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_ANON_KEY: key,
    OPENAI_API_KEY: "fake-openai-no-network", ANTHROPIC_API_KEY: "fake-anthropic-no-network",
  }, user, async () => {
    const { handleOrchestrate } = await import("../../supabase/functions/orchestrate/index.ts");
    const res = await handleOrchestrate(new Request(`${REST_URL}/functions/v1/orchestrate`, {
      method: "POST", headers: { Authorization: `Bearer ${userJwt}`, "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
  });
  return { ...value, sent };
}

Deno.test("orchestrate: a pilot or client-scoped request is refused before any plan, Brain read, model call or dispatch", opts, async () => {
  const w = await world();
  const base = { workspace_id: w.ws, user_instruction: MISSION, lead_mission: LEAD_MISSION };
  await assertRefusedWithoutEffect(w.ws,
    () => orchestrate({ ...base, tool_input: { intent: "lead_sourcing", execution_mode: "pilot_draft_only" } }, w.member), "pilot_execution_disabled", 403);
  await assertRefusedWithoutEffect(w.ws,
    () => orchestrate({ ...base, client_id: uuid() }, w.member), "client_scope_unsupported", 403);
  // No Company Brain read happened either: the only reads were auth and membership.
  const r = await orchestrate({ ...base, tool_input: { execution_mode: "pilot_draft_only" } }, w.member);
  const reads = r.sent.filter((s) => s.method === "GET" && s.host === new URL(REST_URL).host).map((s) => s.path);
  assert(reads.every((p) => p.startsWith("/auth/v1/user") || p.endsWith("/workspace_members")), JSON.stringify(reads));
});
