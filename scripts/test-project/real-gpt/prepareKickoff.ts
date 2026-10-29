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
import { assumedWindowDisclosures, CANARY_FUNDING_MISSION, DEMO_FUNDING_MISSION, judgeDemoFundingInterpretation } from "./demoFundingJudge.ts";

export { CANARY_FUNDING_MISSION, DEMO_FUNDING_MISSION };

export const A7_MISSION =
  "Find 1 US B2B software company with a current declared 11–50 employee band and an open Account Executive posting dated within 30 days.";
export const JOBS_ACTOR = "apify:harvestapi~linkedin-job-search";
export const DETAILS_ACTOR = "apify:harvestapi~linkedin-company";
export const ATOMUS_ACTOR = "apify:atomus~linkedin-company-scraper";
export const PVALYOU_ACTOR = "apify:pvalyou~company-record";

/**
 * Which request the kickoff prepares. `a7` (the default) is exactly the A7
 * smoke as before. `demo_funding` is the five-company hiring-and-funding demo:
 * its own interpretation checks, its assumed windows disclosed, the funding
 * verifiers' templates in the catalog — and, like A7, every actor at ZERO
 * starts: preparing it authorizes no purchase.
 *
 * `canary_funding` is the first real-Apify canary: the same request for ONE
 * company, over docs/launch/proposals/smoke-catalog-canary-funding.json (jobs,
 * details, Atomus — no Pvalyou template, so no paid fallback). ZERO starts
 * unless `paid` names who approved the purchase: then exactly one start per
 * approved actor (the catalog's `actor_limits_proposed_for_paid_canary`).
 */
export type KickoffScenario = "a7" | "demo_funding" | "canary_funding";

/** The funding scenarios: their own judge, project guard and Atomus template. */
const FUNDING_SCENARIOS: ReadonlySet<KickoffScenario> = new Set(["demo_funding", "canary_funding"]);

/** Projects a kickoff is never prepared for: production, and the abandoned one. */
export const NON_TEST_PROJECT_REFS: readonly string[] = ["ohsdatpvfdjdemstoiuj", "wqnigjhcwjxtmordrwno"];

export interface ObservedPrices {
  /** Each template's maximum, observed on the test account (µ$). Required: nothing is invented. */
  jobs_maximum_microusd: number;
  details_maximum_microusd: number;
  /** When the prices above were observed (ISO). Must be within 24 h of authorization. */
  observed_at: string;
  /** Where they were read (an account page, a run receipt, an export). */
  source: string;
  /** Funding scenarios: the funding verifiers' maxima for this mission (µ$), observed like the rest (Pvalyou: demo only). */
  atomus_maximum_microusd?: number;
  pvalyou_maximum_microusd?: number;
}

export interface KickoffInput {
  scenario?: KickoffScenario;
  /** The TEST project the SQL is for. Refused when it is production; required for `demo_funding`. */
  project_ref?: string;
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
  /**
   * canary_funding only: authorize the PAID canary — one start per approved
   * actor — instead of zero. Names the approval; absent, nothing is purchasable.
   */
  paid?: { approved_by: string; actor_limits: Record<string, number> };
  /**
   * The commit the kickoff runs from (40 hex). `buildInfo.ts` is written only
   * at edge-deploy time, so without this the mission's `planner_runtime`
   * names whatever commit was last deployed, not the reviewed one.
   */
  planner_commit?: string;
}

export interface KickoffArtifacts {
  request: Json;
  compiled_mission: Json;
  /** The model's proposal as it arrived, and what the compiler changed in it: read the
   *  interpretation against these, not against a reconstruction (first real-GPT run). */
  gpt_proposal: Json;
  validator_changes: string[];
  interpretation: Verdict[];
  /** Windows the request did not state, for the operator to acknowledge before queueing. */
  disclosures: string[];
  scenario: KickoffScenario;
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
  const scenario: KickoffScenario = i.scenario ?? "a7";
  const ref = (i.project_ref ?? "").trim();
  if (ref && NON_TEST_PROJECT_REFS.includes(ref)) {
    throw new Error(`project ${ref} is not a non-production project; a kickoff is never prepared for it`);
  }
  const funding = FUNDING_SCENARIOS.has(scenario);
  if (funding && !/^[a-z0-9]{20}$/.test(ref)) {
    throw new Error(`${scenario} needs project_ref: the 20-character ref of the isolated TEST project`);
  }
  if (i.paid && scenario !== "canary_funding") throw new Error("only canary_funding authorizes paid starts");
  if (i.paid && !i.paid.approved_by?.trim()) throw new Error("a paid canary names who approved the purchase");
  const p = i.prices;
  const priced = scenario === "demo_funding"
    ? ["jobs_maximum_microusd", "details_maximum_microusd", "atomus_maximum_microusd", "pvalyou_maximum_microusd"] as const
    : scenario === "canary_funding"
    ? ["jobs_maximum_microusd", "details_maximum_microusd", "atomus_maximum_microusd"] as const
    : ["jobs_maximum_microusd", "details_maximum_microusd"] as const;
  for (const k of priced) {
    const n = p[k];
    if (n === undefined || !Number.isSafeInteger(n) || n <= 0) throw new Error(`${k} must be an observed positive integer (µ$); nothing is invented`);
  }
  if (!Number.isFinite(Date.parse(p.observed_at))) throw new Error("observed_at must be an ISO timestamp");
  if (!p.source?.trim()) throw new Error("prices.source must say where the prices were read");
  const mission = i.mission ??
    (scenario === "demo_funding" ? DEMO_FUNDING_MISSION : scenario === "canary_funding" ? CANARY_FUNDING_MISSION : A7_MISSION);
  const requestedCount = scenario === "demo_funding" ? 5 : 1;

  // 1. THE ONE COMPILATION, its model spend captured exactly as production records it.
  const collector = new ModelCallCollector();
  const raw = await i.compile(mission, collector.sink);
  if (!raw) throw new Error("the compiler proposed no mission");
  const c = compileLeadMission({ originalUserQuery: mission, proposal: raw as never, requestedCount });
  if (i.planner_commit !== undefined && !/^[0-9a-f]{40}$/.test(i.planner_commit)) throw new Error("planner_commit must be a 40-character commit sha");
  const planner = runtimeIdentity("planner", "real-gpt-kickoff") as unknown as Json;
  const planner_runtime = i.planner_commit
    // The checkout's commit; `dirty` is not observable without git, so it is unknown, never asserted clean.
    ? { ...planner, git_sha: i.planner_commit, git_short: i.planner_commit.slice(0, 8), build_timestamp: new Date().toISOString(), dirty: null }
    : planner;
  const compiled = { ...c.final_mission, mission_parser_source: c.parser_source,
    lead_intelligence_contract_version: LEAD_INTELLIGENCE_CONTRACT_VERSION, planner_runtime } as Json;
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
  const interpretation = funding
    ? judgeDemoFundingInterpretation(compiled, requestedCount)
    : judgeRealGptRun({ lead_mission: compiled }, A7_EXPECTATIONS).filter((v) => v.question === "I");
  const disclosures = assumedWindowDisclosures(compiled);

  // 3. THE KICKOFF BODY (validateV2KickoffBody's shape; the authorization binds to its hash).
  const request = {
    plan_id: i.plan_id, step_index: 0, agent_slug: "scout", workspace_id: i.workspace_id, user_id: i.user_id, instruction: mission,
    requested_lead_count: requestedCount, workflow_kind: "qualified_lead_sourcing", execution_mode: "company_first", tool_needed: "source_with_apify",
    lead_mission: compiled, tool_input: { lead_mission: compiled, source_type: "jobs" },
    run_budget: { provider_usd: 0.20, max_candidates: scenario === "demo_funding" ? 5 : 3 },
  };

  // 4. THE AUTHORIZATION: the catalog with observed prices, every actor at ZERO starts.
  const evidence = { observed_at: p.observed_at, source: p.source };
  const q = i.catalog;
  const quotes: Json = {
    jobs: { ...q.jobs, ...evidence, maximum_microusd: p.jobs_maximum_microusd },
    details: { ...q.details, ...evidence, maximum_microusd: p.details_maximum_microusd },
    reads: { ...q.reads, ...evidence },
    model: { ...q.luna, ...evidence },
  };
  const actor_limits: Record<string, number> = { [JOBS_ACTOR]: 0, [DETAILS_ACTOR]: 0 };
  if (scenario === "canary_funding") {
    if (!q.atomus) throw new Error("canary_funding needs a catalog with an atomus template");
    if (q.pvalyou) throw new Error("canary_funding's catalog must not carry a Pvalyou template (no unapproved paid fallback)");
    quotes.atomus = { ...q.atomus, ...evidence, maximum_microusd: p.atomus_maximum_microusd };
    actor_limits[ATOMUS_ACTOR] = 0;
    if (i.paid) {
      const want = [JOBS_ACTOR, DETAILS_ACTOR, ATOMUS_ACTOR].sort().join(",");
      const got = Object.keys(i.paid.actor_limits).sort().join(",");
      if (got !== want || !Object.values(i.paid.actor_limits).every((n) => n === 0 || n === 1)) {
        throw new Error(`a paid canary allows at most one start for exactly ${want}`);
      }
      Object.assign(actor_limits, i.paid.actor_limits);
    }
  }
  if (scenario === "demo_funding") {
    if (!q.atomus || !q.pvalyou) throw new Error("demo_funding needs a catalog with atomus and pvalyou templates");
    quotes.atomus = { ...q.atomus, ...evidence, maximum_microusd: p.atomus_maximum_microusd };
    quotes.pvalyou = { ...q.pvalyou, ...evidence, maximum_microusd: p.pvalyou_maximum_microusd };
    actor_limits[ATOMUS_ACTOR] = 0;
    actor_limits[PVALYOU_ACTOR] = 0;
  }

  const assumedLines = disclosures.map((d) => `-- ASSUMED, NOT STATED BY THE USER: ${d}`).join("\n");
  const worst = Object.entries(actor_limits).reduce((sum, [actor, n]) => {
    const t = Object.values(quotes).find((v) => ((v as Json).allowed_actors ?? []).includes(actor) && (v as Json).allowed_kinds?.includes("provider"));
    return sum + n * Number((t as Json | undefined)?.maximum_microusd ?? 0);
  }, 0);
  const header = scenario === "demo_funding"
    ? `-- DEMO (five companies, hiring + funding) for TEST project ${ref}. NEVER run on ${NON_TEST_PROJECT_REFS.join(" or ")}.
${assumedLines}
`
    : scenario === "canary_funding"
    ? `-- FIRST REAL-APIFY CANARY (one company, hiring + funding) for TEST project ${ref}. NEVER run on ${NON_TEST_PROJECT_REFS.join(" or ")}.
${i.paid
    ? `-- PAID: APPROVED BY ${i.paid.approved_by.replace(/[\r\n]/g, " ")}. Starts: ${JSON.stringify(actor_limits)}; worst-case provider ${worst} µ$.`
    : "-- ZERO STARTS: this authorization purchases nothing."}
-- No Pvalyou template: the gate refuses any paid fallback. Needs the read cap of 7 (held 20261029120000).
${assumedLines}
`
    : "";
  const title = i.paid
    ? `-- PAID CANARY KICKOFF for queue ${i.queue_id}. Generated, then REVIEWED, then run once
-- on the TEST project as an administrator. Each approved actor is authorized for at most ONE start.`
    : `-- ZERO-APIFY REAL-GPT KICKOFF for queue ${i.queue_id}. Generated, then REVIEWED, then run once
-- on the TEST project as an administrator. Every actor is authorized for ZERO starts.`;
  const sql = `${title}
${header}begin;
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
    interpretation, disclosures, scenario, compile_ledger_rows: ledgerRows,
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
