// REAL-PROCESS CRASH RECOVERY — two real `worker/main.ts` processes, a real
// SIGKILL, real lease expiry and claim, against the contract lane's disposable
// Postgres + PostgREST. Only OpenAI and Apify are scripted (vendorPreload.ts);
// any other host is refused and reported. Opt-in, not part of CI:
//
//   PG_ADMIN_URL=… POSTGREST_BIN=… tests/realprocess/run.sh
//
// Each case: create and authorize one mission, start worker 1, SIGKILL it at
// the named boundary, let its queue lease lapse, start worker 2, wait for the
// mission to end, then reconcile credits, liabilities, leads and lineage, and
// close the liability as the operator does.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintJwt, REST_URL, sql, uuid } from "../db-contract/lib/harness.ts";
import { reconcilePriorLiability, seedSmokeMission } from "../db-contract/lib/smokeMission.ts";
import { DETAILS, JOBS, MISSION, SYNTHETIC_DETAILS_MAXIMUM, vendorResponder } from "../db-contract/lib/discoveryScenario.ts";
import { buildMissionCompilerBinding } from "../../supabase/functions/_shared/leadMissionCompilerBinding.ts";
import { compileLeadMission } from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import { LEAD_INTELLIGENCE_CONTRACT_VERSION, runtimeIdentity } from "../../supabase/functions/_shared/leadRuntimeIdentity.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const opts = { sanitizeOps: false, sanitizeResources: false };
const ROOT = new URL("../../", import.meta.url);
const LEASE_SECONDS = 30; // the claim RPC floors a lease at 30 s
const CATALOG = JSON.parse(Deno.readTextFileSync(new URL("docs/launch/proposals/smoke-catalog-two-actor.json", ROOT)));
const reconciliationSql = Deno.readTextFileSync(new URL("scripts/test-project/smoke-reconciliation.sql", ROOT));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One mission, authorized, queued for any worker to claim. */
async function queueMission() {
  const evidence = { observed_at: new Date(Date.now() - 60_000).toISOString(), source: "synthetic offline fixture; not an approved vendor quote", liability_bound_ref: "offline rehearsal" };
  const p = CATALOG.approved_quotes as Json;
  const fill = (t: Json) => ({ ...t, ...evidence });
  const quotes = { jobs: fill(p.jobs), model: fill(p.luna), reads: fill(p.reads), details: { ...fill(p.details), maximum_microusd: SYNTHETIC_DETAILS_MAXIMUM } };
  const m = await seedSmokeMission({ quotes, actorLimits: { [JOBS]: 1, [DETAILS]: 1 } });
  const user = uuid(), plan = uuid();
  await sql`insert into auth.users (id, email) values (${user}, ${"rehearsal-" + user + "@example.invalid"})`;
  await sql`insert into public.agents (workspace_id, slug, name, role_prompt, department) values (${m.ws}, 'scout', 'Offline Scout', 'Find and verify the requested company using source evidence.', 'research')`;
  await sql`insert into public.task_plans (id, workspace_id, user_id, user_instruction, status) values (${plan}, ${m.ws}, ${user}, ${MISSION}, 'running')`;
  await sql`insert into public.workspace_credit_balances (workspace_id, balance_credits) values (${m.ws}, 10)`;

  // The mission is compiled here, by the real compiler, against the scripted model.
  const vendor = vendorResponder({ label: "compile" }, { trace: { requests: [], model_stages: [] }, vendorRequests: [], isCompiled: () => false });
  const original = globalThis.fetch;
  globalThis.fetch = ((u: RequestInfo | URL, i?: RequestInit) => {
    const url = new URL(u instanceof Request ? u.url : String(u));
    assertEquals(url.hostname, "api.openai.com", "only the compiler's model call leaves the driver");
    return vendor(url, i, null);
  }) as typeof fetch;
  let raw: unknown;
  try {
    Deno.env.set("OPENAI_API_KEY", "fake-openai-no-network");
    Deno.env.set("LEAD_STRATEGIST_PROVIDER", "openai");
    raw = await buildMissionCompilerBinding({ workspaceId: m.ws }).proposeMission!({ originalUserQuery: MISSION, requestedCount: 1 });
  } finally {
    globalThis.fetch = original;
  }
  assert(raw, "the compiler proposed the mission");
  const c = compileLeadMission({ originalUserQuery: MISSION, proposal: raw as never, requestedCount: 1 });
  const mission = { ...c.final_mission, mission_parser_source: c.parser_source,
    lead_intelligence_contract_version: LEAD_INTELLIGENCE_CONTRACT_VERSION, planner_runtime: runtimeIdentity("planner", "offline-rehearsal") };
  const request = { plan_id: plan, step_index: 0, agent_slug: "scout", workspace_id: m.ws, user_id: user, instruction: MISSION,
    requested_lead_count: 1, workflow_kind: "qualified_lead_sourcing", execution_mode: "company_first", tool_needed: "source_with_apify",
    lead_mission: mission, tool_input: { lead_mission: mission, source_type: "jobs" }, run_budget: { provider_usd: 0.20, max_candidates: 3 } };
  await sql`update public.tasks set status = 'complete' where id = ${m.taskId}`;
  await sql`update public.lead_mission_queue set status = 'queued', claimed_by = null, lease_expires_at = null, task_id = null,
              lineage_id = null, attempts = 0, created_at = now(), request = ${sql.json(request as never)} where id = ${m.queueId}`;
  await sql`update public.discovery_smoke_authorizations a set criteria_hash = encode(sha256(convert_to(q.request::text, 'UTF8')), 'hex')
              from public.lead_mission_queue q where q.id = a.queue_id and a.id = ${m.authorizationId}`;
  return m;
}

interface Proc { child: Deno.ChildProcess; log: string; id: string; flushed: Promise<unknown> }
function startWorker(label: string, ws: string, key: string, events: string, killAt: string | null): Proc {
  const id = uuid();
  const log = Deno.makeTempFileSync({ prefix: `rehearsal-${label}-`, suffix: ".log" });
  const env: Record<string, string> = {
    // The preload imports the scenario module, which reads the lane's own variables.
    ...Object.fromEntries(["DB_CONTRACT_REST_URL", "DB_CONTRACT_JWT_SECRET", "DB_CONTRACT_PG_URL"].map((k) => [k, Deno.env.get(k)!])),
    SUPABASE_URL: REST_URL, SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_ANON_KEY: key,
    LEAD_V2_WORKER_WORKSPACES: ws, LEAD_WORKER_ID: id, AGENTORY_ROLE: "worker", PORT: String(20000 + Math.floor(Math.random() * 9000)),
    LEAD_WORKER_LEASE_SECONDS: String(LEASE_SECONDS), LEAD_WORKER_HEARTBEAT_MS: "3000", LEAD_WORKER_IDLE_POLL_MS: "500",
    OPENAI_API_KEY: "fake-openai-no-network", APIFY_API_TOKEN: "fake-apify-no-network",
    DISCOVERY_SMOKE_ADMISSION: "enforce", LEAD_V2_SMOKE_WALL_CLOCK: "enforce", LEAD_STRATEGIST_PROVIDER: "openai",
    LEAD_CREDIT_ENFORCEMENT: "enforce", LINEAGE_LEASE_ENFORCED: "true", MODEL_SPEND_ENFORCEMENT: "enforce",
    MODEL_SPEND_CEILING_USD: "0.05", MODEL_SPEND_PERIOD_DAYS: "1", MODEL_RUN_MAX_CALLS: "2",
    LEAD_V2_MISSION_PROVIDER_USD_CAP: "0.20", LEAD_V2_MISSION_CREDIT_CAP: "5", LEAD_WORKER_MAX_RUNTIME_MS: "150000",
    LEAD_MAX_AUTO_CONTINUATIONS: "1", LEAD_V2_SMOKE_ORCHESTRATION: "minimal", EVIDENCE_ENRICHMENT: "off",
    REHEARSAL_EVENTS: events, REHEARSAL_SCENARIO: "{}", ...(killAt ? { REHEARSAL_KILL_AT: killAt } : {}),
    PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "", DENO_DIR: Deno.env.get("DENO_DIR") ?? `${Deno.env.get("HOME")}/.cache/deno`,
  };
  const file = Deno.openSync(log, { write: true, append: true });
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--node-modules-dir=none", "--allow-env", "--allow-read", `--allow-write=${events}`,
      "--allow-net=127.0.0.1,localhost,0.0.0.0", "--preload", new URL("tests/realprocess/vendorPreload.ts", ROOT).pathname,
      new URL("worker/main.ts", ROOT).pathname],
    cwd: new URL(".", ROOT).pathname, env, clearEnv: true, stdout: "piped", stderr: "piped",
  }).spawn();
  const flushed = Promise.all([
    child.stdout.pipeTo(file.writable).catch(() => {}),
    child.stderr.pipeTo(Deno.openSync(log, { write: true, append: true }).writable).catch(() => {}),
  ]);
  return { child, log, id, flushed };
}
const readEvents = (path: string) =>
  Deno.readTextFileSync(path).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Json);

async function waitFor<T>(what: string, ms: number, probe: () => Promise<T | null>): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await probe();
    if (v !== null) return v;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function rehearse(killAt: string) {
  const key = await mintJwt("service_role");
  await reconcilePriorLiability();
  const m = await queueMission();
  const events = Deno.makeTempFileSync({ prefix: "rehearsal-events-", suffix: ".jsonl" });

  // 1. Worker 1 claims, compiles its plan, buys — and is SIGKILLed at the boundary.
  const w1 = startWorker("w1", m.ws, key, events, killAt);
  await waitFor("the kill point", 120_000, async () => readEvents(events).some((e) => e.type === "kill_point") ? true : null);
  w1.child.kill("SIGKILL");
  const s1 = await w1.child.status;
  assertEquals(s1.signal, "SIGKILL", "worker 1 died by SIGKILL");
  const [q1] = await sql`select status, claimed_by, task_id, attempts from public.lead_mission_queue where id = ${m.queueId}`;
  assertEquals([q1.status, q1.claimed_by], ["running", w1.id], "the dead worker still holds the row until its lease lapses");

  // 2. Its lease lapses; worker 2 claims the same row and runs it to the end.
  await waitFor("lease expiry", (LEASE_SECONDS + 10) * 1000, async () => {
    const [q] = await sql`select lease_expires_at < now() as lapsed from public.lead_mission_queue where id = ${m.queueId}`;
    return q.lapsed ? true : null;
  });
  const w2 = startWorker("w2", m.ws, key, events, null);
  const final = await waitFor("the mission to end", 240_000, async () => {
    const [q] = await sql`select status, claimed_by, task_id, lineage_id, attempts from public.lead_mission_queue where id = ${m.queueId}`;
    return ["complete", "failed", "cancelled"].includes(q.status) ? q : null;
  });
  w2.child.kill("SIGTERM");
  await w2.child.status;
  await w2.flushed;
  const w2log = Deno.readTextFileSync(w2.log);

  const ev = readEvents(events);
  const posts = (actor: string) => ev.filter((e) => e.type === "vendor" && e.method === "POST" && String(e.path).includes(actor)).length;
  const [task] = await sql`select status, result->>'terminal_status' as terminal,
    result->'capability_execution_state'->'provider_attempts' as attempts from public.tasks where id = ${final.task_id}`;
  const [lineage] = await sql`select status, generation from public.lead_lineages where lineage_id = ${final.lineage_id}`;
  const credits = await sql`select idempotency_key, status, actual_credits from public.credit_transactions where workspace_id = ${m.ws}`;
  const [bal] = await sql`select balance_credits, reserved_credits from public.workspace_credit_balances where workspace_id = ${m.ws}`;
  const leads = await sql`select raw->>'company_name' as company, (raw->'canonical_decision'->>'qualified')::boolean as qualified
                            from public.lead_candidates where workspace_id = ${m.ws}`;
  const open = await sql.unsafe(reconciliationSql.replace(":'queue_id'", `'${m.queueId}'`)) as Json[];
  const ops = await sql`select actor, provider_run_id from public.discovery_smoke_operations where authorization_id = ${m.authorizationId} and kind = 'provider'`;
  const summary = {
    killAt, w1: w1.id, w2: w2.id, queue: final.status, attempts: final.attempts, task: task?.status, terminal: task?.terminal,
    lineage, posts: { jobs: posts("linkedin-job-search"), details: posts("linkedin-company") },
    forbidden: ev.filter((e) => e.type === "forbidden"), pids: [...new Set(ev.map((e) => e.pid))].length,
    adopted_by_gate: (w2log.match(/\[smoke-admission\] adopted/g) ?? []).length,
    adopted_from_ledger: ((task?.attempts ?? []) as Json[]).filter((a) => String(a.reason ?? "").startsWith("adopted run run-jobs")).length,
    credits: credits.map((c) => [String(c.idempotency_key).split(":")[1], c.status, c.actual_credits]),
    balance: [bal.balance_credits, bal.reserved_credits], leads: leads.map((l) => [l.company, l.qualified]),
    open_liability: open.map((o) => [o.actor, o.state]), ops: ops.map((o) => [o.actor, o.provider_run_id]),
    logs: [w1.log, w2.log],
  };
  console.log("REHEARSAL", JSON.stringify(summary));
  return { m, summary, ev, final };
}

/** What every recovery must hold, whatever its boundary. */
async function recoveredOnce(r: Awaited<ReturnType<typeof rehearse>>) {
  const s = r.summary;
  assertEquals(s.forbidden, [], "no forbidden external call from either process");
  assertEquals(s.pids, 2, "two real worker processes did the work");
  assertEquals([s.posts.jobs, s.posts.details], [1, 1], "one authorized purchase per logical provider call");
  assertEquals(s.queue, "complete");
  assertEquals(s.terminal, "completed");
  assertEquals(s.lineage.generation, 2, "the second worker ran generation 2 on the same lineage");
  assertEquals(s.leads.length, 1, "one persisted lead, no duplicate");
  assertEquals(s.leads[0][1], true, "qualified by the canonical decision");
  assertEquals(s.credits.map((c: unknown[]) => [c[1], c[2]]).sort(), [["charged", 1], ["charged", 1]], "each purchase charged once");
  assertEquals(s.balance, [8, 0], "zero refunds, zero held");
  assertEquals(s.open_liability.map((o: unknown[]) => o[1]), ["open", "open"], "each purchase listed once for the operator");

  // Delayed reaper: nothing changes.
  await sql`update public.credit_transactions set created_at = now() - interval '2 hours' where workspace_id = ${r.m.ws}`;
  await sql`select public.credits_release_stale(interval '30 minutes')`;
  const [bal] = await sql`select balance_credits, reserved_credits from public.workspace_credit_balances where workspace_id = ${r.m.ws}`;
  assertEquals([bal.balance_credits, bal.reserved_credits], [8, 0]);
  // Final reconciliation, as the operator performs it: no unresolved liability remains.
  assertEquals(await reconcilePriorLiability(), 2);
  const left = await sql.unsafe(reconciliationSql.replace(":'queue_id'", `'${r.m.queueId}'`)) as Json[];
  assertEquals(left.filter((o) => o.state === "open"), [], "no unresolved liability after reconciliation");
}

Deno.test("real process: SIGKILL between the paid job-search start and its execution-ledger run id — worker 2 adopts it via the gate", opts, async () => {
  const r = await rehearse("jobs_run_id_write");
  assertEquals(r.summary.adopted_by_gate, 1, "the replayed start was answered by verified adoption");
  await recoveredOnce(r);
});

Deno.test("real process (PR #150 control): SIGKILL at the first status read, run id already in the ledger — worker 2 adopts it from the ledger", opts, async () => {
  const r = await rehearse("jobs_status");
  assertEquals(r.summary.adopted_by_gate, 0, "nothing reached the gate: the ledger named the run");
  assert(r.summary.adopted_from_ledger >= 1, "adopted from the ledger");
  await recoveredOnce(r);
});

// ── THE ZERO-APIFY REAL-GPT PROCEDURE, END TO END (model scripted) ─────────
//
// Exactly what the operator will run on TEST: prepare the kickoff (compile,
// interpretation check, one SQL transaction), run that transaction, let a real
// worker process claim and run it, then judge the evidence document.
Deno.test("real process: the zero-Apify real-GPT kickoff — prepared, run by a real worker, judged PASS", opts, async () => {
  const { prepareKickoff } = await import("../../scripts/test-project/real-gpt/prepareKickoff.ts");
  const { judgeRealGptRun, overall } = await import("../../scripts/test-project/real-gpt/realGptJudge.ts");
  const evidenceSql = Deno.readTextFileSync(new URL("scripts/test-project/real-gpt/real-gpt-evidence.sql", ROOT));
  const key = await mintJwt("service_role");
  await reconcilePriorLiability();
  // The TEST workspace's standing state: a user, the Scout agent, 10 credits, no Company Brain.
  const ws = await (await import("../db-contract/lib/harness.ts")).seedWorkspace();
  const user = uuid();
  await sql`insert into auth.users (id, email) values (${user}, ${"real-gpt-" + user + "@example.invalid"})`;
  await sql`insert into public.agents (workspace_id, slug, name, role_prompt, department) values (${ws}, 'scout', 'Offline Scout', 'Find and verify the requested company using source evidence.', 'research')`;
  await sql`insert into public.workspace_credit_balances (workspace_id, balance_credits) values (${ws}, 10)`;

  const vendor = vendorResponder({ label: "kickoff-compile" }, { trace: { requests: [], model_stages: [] }, vendorRequests: [], isCompiled: () => false });
  const original = globalThis.fetch;
  // The preparer's own compile gate, in front of the scripted model, as the CLI installs it.
  const { lunaOnlyFetch } = await import("../../scripts/test-project/real-gpt/prepareKickoff.ts");
  const gate = lunaOnlyFetch(((u: RequestInfo | URL, i?: RequestInit) => {
    const url = new URL(u instanceof Request ? u.url : String(u));
    assertEquals(url.hostname, "api.openai.com", "only the compilation leaves the preparer");
    return vendor(url, i, null);
  }) as typeof fetch);
  globalThis.fetch = gate.fetch;
  Deno.env.set("OPENAI_API_KEY", "fake-openai-no-network");
  Deno.env.set("LEAD_STRATEGIST_PROVIDER", "openai");
  const queueId = uuid();
  let k;
  try {
    k = await prepareKickoff({
      workspace_id: ws, user_id: user, queue_id: queueId, plan_id: uuid(), pricing_version: "rehearsal-v1",
      catalog: CATALOG.approved_quotes,
      prices: { jobs_maximum_microusd: 5000, details_maximum_microusd: SYNTHETIC_DETAILS_MAXIMUM,
        observed_at: new Date(Date.now() - 60_000).toISOString(), source: "synthetic offline fixture; not an approved vendor quote" },
      compile: (mission, onModelCall) =>
        buildMissionCompilerBinding({ workspaceId: ws, onModelCall }).proposeMission!({ originalUserQuery: mission, requestedCount: 1 }),
    });
  } finally {
    globalThis.fetch = original;
  }
  assertEquals(k.interpretation.filter((v) => v.result !== "PASS"), [], "the interpretation passes before anything is queued");
  assertEquals([gate.sent.length, gate.refused], [1, []], "one Luna compilation inside the bounds, nothing refused");
  assertEquals(k.compile_ledger_rows.length, 1, "the compilation's model call is recorded");
  assertEquals(k.authorization.actor_limits, { [JOBS]: 0, [DETAILS]: 0 });

  // The reviewed transaction, run exactly as the operator runs it: psql, one transaction, stop on error.
  const kickoffFile = Deno.makeTempFileSync({ prefix: "kickoff-", suffix: ".sql" });
  Deno.writeTextFileSync(kickoffFile, k.sql);
  const psql = await new Deno.Command("psql", {
    args: [Deno.env.get("DB_CONTRACT_PG_URL")!, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", kickoffFile], stdout: "piped", stderr: "piped",
  }).output();
  assertEquals(psql.code, 0, new TextDecoder().decode(psql.stderr));
  const [q0] = await sql`select status from public.lead_mission_queue where id = ${queueId}`;
  assertEquals(q0.status, "queued");

  const events = Deno.makeTempFileSync({ prefix: "real-gpt-events-", suffix: ".jsonl" });
  const w = startWorker("real-gpt", ws, key, events, null);
  const final = await waitFor("the real-GPT run to end", 240_000, async () => {
    const [q] = await sql`select status from public.lead_mission_queue where id = ${queueId}`;
    return ["complete", "failed", "cancelled"].includes(q.status) ? q : null;
  });
  w.child.kill("SIGTERM");
  await w.child.status;
  await w.flushed;
  const ev = readEvents(events);
  assertEquals(ev.filter((e) => e.type === "forbidden"), [], "no forbidden external call");
  assertEquals(ev.filter((e) => e.type === "vendor" && e.host === "api.apify.com"), [], "no request reached Apify");

  const [row] = [...await sql.unsafe(evidenceSql.replace(":'queue_id'", `'${queueId}'`))] as Array<Record<string, unknown>>;
  const verdicts = judgeRealGptRun(Object.values(row)[0] as Record<string, unknown>);
  console.log("REAL_GPT_JUDGE", JSON.stringify({ queue: final.status, verdicts: verdicts.map((v) => `${v.result} ${v.id}`) }));
  assertEquals(verdicts.filter((v) => v.result === "FAIL"), [], "every automatic criterion passes");
  assertEquals(overall(verdicts), "PASS");
  await reconcilePriorLiability();
});
