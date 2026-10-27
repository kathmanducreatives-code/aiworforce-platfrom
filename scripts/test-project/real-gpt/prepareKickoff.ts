// THE ZERO-APIFY REAL-GPT KICKOFF, PREPARED AND REVIEWED BEFORE ANYTHING RUNS.
//
// One function, no database access: compile the mission (the one model call
// made outside the worker), check the interpretation against the request,
// and write the single transaction the operator runs on TEST:
//   1. the plan row the kickoff references;
//   2. the compilation's model-call ledger row(s), recorded exactly as the
//      production writer records them, under `kickoff:<queue>:…`;
//   3. the queue row (status `queued`, the kickoff body as its request);
//   4. the smoke authorization: the reviewed catalog, every actor at ZERO
//      starts, 300 s. The gate then refuses each Apify start before sending.
// The worker claims the row once the transaction commits. The compile is
// injected: the CLI passes the real compiler; tests pass a scripted one.

import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { LEAD_INTELLIGENCE_CONTRACT_VERSION, runtimeIdentity } from "../../../supabase/functions/_shared/leadRuntimeIdentity.ts";
import { createLedgerWriter, type LedgerDb, ModelCallCollector } from "../../../supabase/functions/_shared/executionLedger.ts";
import { A7_EXPECTATIONS, judgeRealGptRun, type Json, type Verdict } from "./realGptJudge.ts";
import { textOnlyModelRequest } from "../../../supabase/functions/_shared/smokeAdmission.ts";

export const A7_MISSION =
  "Find 1 US B2B software company with a current declared 11–50 employee band and an open Account Executive posting dated within 30 days.";
export const JOBS_ACTOR = "apify:harvestapi~linkedin-job-search";
export const DETAILS_ACTOR = "apify:harvestapi~linkedin-company";

export interface ObservedPrices {
  /** Each template's maximum, observed on the test account (µ$). Required: nothing is invented. */
  jobs_maximum_microusd: number;
  details_maximum_microusd: number;
  /** When the prices above were observed (ISO). Must be within 24 h of authorization. */
  observed_at: string;
  /** Where they were read (an account page, a run receipt, an export). */
  source: string;
}

export interface KickoffInput {
  mission?: string;
  workspace_id: string;
  user_id: string;
  queue_id: string;
  plan_id: string;
  pricing_version: string;
  prices: ObservedPrices;
  /** The reviewed catalog's `approved_quotes` (docs/launch/proposals/smoke-catalog-two-actor.json). */
  catalog: Json;
  /** The compiler, given a model-call sink. Returns the raw proposal. */
  compile: (mission: string, onModelCall: ModelCallCollector["sink"]) => Promise<unknown>;
}

export interface KickoffArtifacts {
  request: Json;
  compiled_mission: Json;
  /** The model's proposal as it arrived, and what the compiler changed in it: read the
   *  interpretation against these, not against a reconstruction (first real-GPT run). */
  gpt_proposal: Json;
  validator_changes: string[];
  interpretation: Verdict[];
  compile_ledger_rows: Json[];
  authorization: { quotes: Json; actor_limits: Json; window_seconds: number };
  sql: string;
}

const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'`;
const str = (v: string) => `'${v.replace(/'/g, "''")}'`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function prepareKickoff(i: KickoffInput): Promise<KickoffArtifacts> {
  for (const [k, v] of Object.entries({ workspace_id: i.workspace_id, user_id: i.user_id, queue_id: i.queue_id, plan_id: i.plan_id })) {
    if (!UUID.test(v)) throw new Error(`${k} must be a uuid`);
  }
  const p = i.prices;
  for (const k of ["jobs_maximum_microusd", "details_maximum_microusd"] as const) {
    if (!Number.isSafeInteger(p[k]) || p[k] <= 0) throw new Error(`${k} must be an observed positive integer (µ$); nothing is invented`);
  }
  if (!Number.isFinite(Date.parse(p.observed_at))) throw new Error("observed_at must be an ISO timestamp");
  if (!p.source?.trim()) throw new Error("prices.source must say where the prices were read");
  const mission = i.mission ?? A7_MISSION;

  // 1. THE ONE COMPILATION, its model spend captured exactly as production records it.
  const collector = new ModelCallCollector();
  const raw = await i.compile(mission, collector.sink);
  if (!raw) throw new Error("the compiler proposed no mission");
  const c = compileLeadMission({ originalUserQuery: mission, proposal: raw as never, requestedCount: 1 });
  const compiled = { ...c.final_mission, mission_parser_source: c.parser_source,
    lead_intelligence_contract_version: LEAD_INTELLIGENCE_CONTRACT_VERSION, planner_runtime: runtimeIdentity("planner", "real-gpt-kickoff") } as Json;
  const rows = new Map<string, Json>();
  const capture: LedgerDb = {
    from: () => ({
      insert: (v: unknown) => { const r = v as Json; rows.set(String(r.id), { ...r }); return Promise.resolve({ error: null }); },
      update: (v: unknown) => ({ eq: (_col: string, id: string) => { rows.set(id, { ...rows.get(id), ...(v as Json) }); return Promise.resolve({ error: null }); } }),
    }),
  };
  await collector.drain(createLedgerWriter(capture), {
    workspace_id: i.workspace_id, task_id: null, plan_id: i.plan_id, logical_call_key: `kickoff:${i.queue_id}`,
  });
  const ledgerRows = [...rows.values()];

  // 2. THE INTERPRETATION, judged before anything is queued.
  const interpretation = judgeRealGptRun({ lead_mission: compiled }, A7_EXPECTATIONS).filter((v) => v.question === "I");

  // 3. THE KICKOFF BODY (validateV2KickoffBody's shape; the authorization binds to its hash).
  const request = {
    plan_id: i.plan_id, step_index: 0, agent_slug: "scout", workspace_id: i.workspace_id, user_id: i.user_id, instruction: mission,
    requested_lead_count: 1, workflow_kind: "qualified_lead_sourcing", execution_mode: "company_first", tool_needed: "source_with_apify",
    lead_mission: compiled, tool_input: { lead_mission: compiled, source_type: "jobs" }, run_budget: { provider_usd: 0.20, max_candidates: 3 },
  };

  // 4. THE AUTHORIZATION: the catalog with observed prices, every actor at ZERO starts.
  const evidence = { observed_at: p.observed_at, source: p.source };
  const q = i.catalog;
  const quotes = {
    jobs: { ...q.jobs, ...evidence, maximum_microusd: p.jobs_maximum_microusd },
    details: { ...q.details, ...evidence, maximum_microusd: p.details_maximum_microusd },
    reads: { ...q.reads, ...evidence },
    model: { ...q.luna, ...evidence },
  };
  const actor_limits = { [JOBS_ACTOR]: 0, [DETAILS_ACTOR]: 0 };

  const sql = `-- ZERO-APIFY REAL-GPT KICKOFF for queue ${i.queue_id}. Generated, then REVIEWED, then run once
-- on the TEST project as an administrator. Every actor is authorized for ZERO starts.
begin;
insert into public.task_plans (id, workspace_id, user_id, user_instruction, status)
  values (${str(i.plan_id)}, ${str(i.workspace_id)}, ${str(i.user_id)}, ${str(mission)}, 'running');
${ledgerRows.map((r) => {
    // Only the row's own columns: a key it omits keeps the column default.
    const cols = Object.keys(r).filter((k) => r[k] !== undefined).map((k) => `"${k}"`).join(", ");
    return `insert into public.lead_execution_calls (${cols})\n  select ${cols} from jsonb_populate_record(null::public.lead_execution_calls, ${lit(r)}::jsonb);`;
  }).join("\n")}
insert into public.lead_mission_queue (id, workspace_id, request, status)
  values (${str(i.queue_id)}, ${str(i.workspace_id)}, ${lit(request)}::jsonb, 'queued');
select public.authorize_discovery_smoke(${str(i.queue_id)}, ${str(i.pricing_version)},
  ${lit(quotes)}::jsonb, ${lit(actor_limits)}::jsonb, 300);
commit;
`;
  return { request, compiled_mission: compiled, gpt_proposal: raw as Json, validator_changes: [...c.validator_changes],
    interpretation, compile_ledger_rows: ledgerRows,
    authorization: { quotes, actor_limits, window_seconds: 300 }, sql };
}

/**
 * THE COMPILE'S OWN GATE. The preparer runs outside the worker's smoke
 * admission, so it applies the same bounds itself before anything is sent:
 * OpenAI chat completions only, `gpt-5.6-luna` only (the router may escalate
 * a failed compile to Terra, ~10x the price: refused), the Luna template's
 * request and output bounds, and at most `maxCalls` requests. A refused request
 * answers a synthetic 409 and never leaves the process. `sent` records every
 * request that did.
 */
export function lunaOnlyFetch(base: typeof fetch, o: { maxCalls?: number; maxRequestBytes?: number; maxOutputTokens?: number } = {}) {
  const maxCalls = o.maxCalls ?? 2, maxBytes = o.maxRequestBytes ?? 30_720, maxOut = o.maxOutputTokens ?? 4_000;
  const sent: Array<{ model: string; bytes: number }> = [];
  const refused: string[] = [];
  const refuse = (why: string) => {
    refused.push(why);
    return Promise.resolve(new Response(JSON.stringify({ error: { type: "compile_gate_refused", message: why } }), { status: 409 }));
  };
  const f = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.openai.com" || url.pathname !== "/v1/chat/completions" || (init?.method ?? "GET") !== "POST") {
      return refuse(`forbidden: ${url.hostname}${url.pathname}`);
    }
    const body = typeof init?.body === "string" ? init.body : "";
    const bytes = new TextEncoder().encode(body).length;
    let j: Json = {};
    try { j = JSON.parse(body); } catch { return refuse("unreadable body"); }
    if (!j || typeof j !== "object" || Array.isArray(j)) return refuse("body is not a JSON object");
    if (j.model !== "gpt-5.6-luna") return refuse(`model ${j.model} refused (Luna only)`);
    // The worker gate's audited text-only shape: no field that charges beyond the
    // request's own bytes (e.g. extended cache retention, tools, media), one choice.
    const shape = textOnlyModelRequest("openai", j);
    if (shape) return refuse(`request shape refused (${shape})`);
    if ("n" in j && j.n !== 1) return refuse(`n=${j.n} refused (one choice only)`);
    const outs = [j.max_completion_tokens, j.max_tokens].filter((v) => v !== undefined);
    if (outs.length === 0 || !outs.every((v) => Number.isInteger(v) && v >= 1 && v <= maxOut)) {
      return refuse(`output bound ${JSON.stringify(outs)} refused (≤ ${maxOut})`);
    }
    if (bytes > maxBytes) return refuse(`request ${bytes} bytes refused (≤ ${maxBytes})`);
    if (sent.length >= maxCalls) return refuse(`call ${sent.length + 1} refused (≤ ${maxCalls})`);
    sent.push({ model: j.model, bytes });
    return base(input, init);
  }) as typeof fetch;
  return { fetch: f, sent, refused };
}
