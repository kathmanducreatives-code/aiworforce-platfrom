// A7 ADVERSARIAL SCENARIOS — the real Discovery Engine V1 path with only the
// vendors substituted. Generalised from the offline smoke rehearsal
// (offlineSmokeProgress.contract.test.ts): the same offline compile, the same
// authorization over the final kickoff, the real worker runner, run-agent
// handler, SQL admission gate and PostgREST. What a scenario controls:
//   * the job-search dataset (rows built from the reviewed probe fixture);
//   * the company-details record served for each requested company URL;
//   * vendor faults (start refused, status unreadable, slow, malformed);
//   * the model stand-in: HONEST (cites only evidence that supports a
//     requirement) or CREDULOUS (passes every requirement, citing real but
//     possibly irrelevant excerpts) — the worst plausible model, which tests
//     whether the deterministic checks alone prevent a false qualification.
// All prices are synthetic. No real vendor is reachable: every non-localhost
// request is answered here or fails the scenario.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintJwt, REST_URL, sql, uuid } from "./harness.ts";
import { seedSmokeMission } from "./smokeMission.ts";
import { mockCriterionVerdicts } from "./criterionFixture.ts";
import { createAdmissionFetch, missionAdmission } from "../../../supabase/functions/_shared/smokeAdmission.ts";
import { createLeadMissionRunner } from "../../../worker/leadMissionRunner.ts";
import { createExecutionDeadline } from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import { buildMissionCompilerBinding } from "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { LEAD_INTELLIGENCE_CONTRACT_VERSION, runtimeIdentity } from "../../../supabase/functions/_shared/leadRuntimeIdentity.ts";
import { createLedgerWriter, ModelCallCollector } from "../../../supabase/functions/_shared/executionLedger.ts";
import { terminalStatusOf } from "../../../supabase/functions/_shared/leadMissionV2Request.ts";

export const MISSION =
  "Find 1 US B2B software company with a current declared 11–50 employee band and an open Account Executive posting dated within 30 days.";
export const JOBS = "apify:harvestapi~linkedin-job-search";
export const DETAILS = "apify:harvestapi~linkedin-company";
const DAY = 86_400_000;

/** The reviewed proposal (offline compile, runbook Phase 4). */
export const PROPOSAL = {
  requested_opportunity_count: 1, requested_contact_ready_count: null,
  company_types: ["B2B software"], geographies: ["United States"], geography_is_hard: true,
  employee_range: { min: 11, max: 50 }, decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
  preferred_signals: ["hiring Account Executive"], required_signal_terms: ["Account Executive"], signal_recency_days: 30,
  adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
  disallowed_broadening: ["geography", "role", "size"], required_evidence: [],
  required_capabilities: ["general_company_discovery", "embedded_hiring_evidence", "company_semantic_evaluation"],
  preferred_source_strategy: [], evaluation_instructions: "All requirements must be verified; unknown is never match.",
  founder_unlock_recommended: false, confidence: 0.99, unknowns: [],
};
const JOB_INPUT = { jobTitles: ["Account Executive"], locations: ["United States"], maxItems: 3, postedLimit: "month", sortBy: "date" };
const EXECUTION_PLAN = {
  reasoning: "One hiring-led discovery; employer identity and declared company band come from the posting. No paid enrichment or contact unlock.",
  steps: [
    { capability: "job_discovery", actor_key: "apify_linkedin_job_search", purpose: "find the specified open role", input: JOB_INPUT, depends_on: [] },
    { capability: "company_brain_qualification", actor_key: null, purpose: "verify every stated company requirement", input: {}, depends_on: [1] },
    { capability: "persistence", actor_key: null, purpose: "persist evidence-backed results", input: {}, depends_on: [2] },
  ],
};
const CATALOG = JSON.parse(Deno.readTextFileSync(new URL("../../../docs/launch/proposals/smoke-catalog-two-actor.json", import.meta.url)));
/** NOT A VENDOR PRICE: the company-details maximum used offline. */
export const SYNTHETIC_DETAILS_MAXIMUM = 5000;
export const PLANNER_BOUND: number = CATALOG.approved_quotes.luna.request_limits.max_request_bytes;
const FIXTURE = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/p3-job-discovery-probe.json", import.meta.url)));
const PROBE_ROW = FIXTURE.probes["harvestapi~linkedin-job-search"].items[0];

// ── FIXTURE BUILDERS ─────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- vendor rows and SQL results in their own shapes, read field by field
type Json = Record<string, any>;
export const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();

/** A company record in the actor's own shape: US-HQ, 11–50, B2B software, unless overridden. */
export function company(slug: string, over: Json = {}): Json {
  const base = structuredClone(PROBE_ROW.company);
  return Object.assign(base, {
    id: `offline-${slug}`, universalName: slug, name: over.name ?? `${slug} Software`,
    linkedinUrl: `https://www.linkedin.com/company/offline-${slug}`, website: `https://${slug}.example`,
    description: `${over.name ?? slug + " Software"} builds sales software for revenue teams at mid-size companies.`,
    employeeCount: 30, employeeCountRange: { start: 11, end: 50 },
    locations: [{ country: "United States", city: "Boston", isHeadquarter: true }],
    industries: ["Software Development"],
  }, over);
}
/** A job row in the actor's own shape, posted `posted` days ago (fractional allowed), employer `co`. */
export function job(slug: string, co: Json, over: Json = {}, posted = 1): Json {
  const row = structuredClone(PROBE_ROW);
  return Object.assign(row, {
    id: `offline-${slug}`, title: "Account Executive", jobState: "LISTED", closedAt: null,
    linkedinUrl: `https://www.linkedin.com/jobs/view/offline-${slug}`,
    postedDate: daysAgo(posted), expireAt: new Date(Date.now() + 120 * DAY).toISOString(),
    descriptionText: `${co.name} is hiring an Account Executive to sell our software platform to revenue teams.`,
    company: structuredClone(co),
  }, over);
}

// ── MODEL STAND-INS ──────────────────────────────────────────────────────────
type Ev = { evidence_id: string; evidence_type?: string; source_text?: string | null };
function evidenceIn(x: unknown, out: Ev[] = []): Ev[] {
  if (Array.isArray(x)) for (const y of x) evidenceIn(y, out);
  else if (x && typeof x === "object") {
    const o = x as Json;
    if (typeof o.evidence_id === "string" && typeof o.source_text === "string") out.push(o as Ev);
    else for (const v of Object.values(o)) evidenceIn(v, out);
  }
  return out;
}
/** A verbatim excerpt: the first 60 characters of the source (always a true substring). */
const excerptOf = (e: Ev) => (e.source_text ?? "").slice(0, 60);
const find = (ev: Ev[], type: RegExp, phrase?: RegExp) =>
  ev.find((e) => type.test(e.evidence_type ?? "") && (!phrase || phrase.test(e.source_text ?? "")));
const cite = (e: Ev | undefined, phrase?: RegExp) => {
  if (!e) return null;
  const m = phrase ? (e.source_text ?? "").match(phrase) : null;
  return { evidence_id: e.evidence_id, excerpt: m ? m[0] : excerptOf(e) };
};

export type Model = "honest" | "credulous";
function citations(ev: Ev[], model: Model) {
  if (model === "credulous") {
    // Cites SOMETHING real for every requirement, relevant or not.
    const any = ev.find((e) => (e.source_text ?? "").length > 0);
    const pick = (t: RegExp) => cite(find(ev, t) ?? any);
    return {
      business: pick(/company_description|description/), location: pick(/location|headquarter/),
      size: pick(/size|employee/), hiring: pick(/job|posting|hiring/),
    };
  }
  return {
    business: cite(find(ev, /^company_description$/, /\b(software|platform)\b.*\b(teams|companies|businesses|customers)\b/i)),
    // The registry files a company's location as `company_location` (#113 cites it
    // per criterion); a `headquarter` type alone never matched, so this cited nothing.
    location: cite(find(ev, /headquarter|^company_location$/, /United States/), /United States/),
    size: cite(find(ev, /^company_size_band$/, /11-50 employees/), /11-50 employees/),
    hiring: cite(find(ev, /job|posting|hiring/, /Account Executive/), /Account Executive/),
  };
}
/**
 * `aggregate` (Q1): the evaluator's OVERALL answer, independent of its
 * per-criterion rows. "fail" / "review" keep every row PASS with real receipts
 * and contradict them in `mission_fit` — the audit's G09 shape.
 */
function evaluatorAnswer(input: unknown, model: Model, aggregate?: "fail" | "review") {
  const c = citations(evidenceIn(input), model);
  const req: Array<[string, { evidence_id: string; excerpt: string } | null]> = [
    ["B2B software company", c.business], ["located in the United States", c.location],
    ["declared 11–50 employee band", c.size], ["open Account Executive posting within 30 days", c.hiring],
  ];
  const missing = req.filter(([, x]) => !x).map(([r]) => r);
  return {
    mission_fit: aggregate ?? (missing.length === 0 ? "pass" : "review"), icp_fit: "plausible",
    hiring_fit: c.hiring ? "verified" : "absent", confidence: 0.8, match_score: missing.length === 0 ? 80 : 0,
    // One verdict per compiled criterion, citing the SAME receipts as above (#113's
    // evaluator contract). The credulous model's receipts stay irrelevant on purpose:
    // production must refuse them; nothing here decides eligibility.
    criterion_verdicts: mockCriterionVerdicts(input, c),
    matched_requirements: req.filter(([, x]) => x).map(([requirement, x]) => ({ requirement, ...x!, support: "verified" })),
    failed_requirements: [], reasoning: missing.length ? `not established: ${missing.join("; ")}` : "every requirement cited",
    rejection_reasons: aggregate === "fail" ? ["the overall fit is wrong for this mission"] : [],
    evidence_quality: missing.length ? "weak" : "moderate", unknown_fields: missing, next_action: null,
    ...(aggregate ? { reasoning: `overall ${aggregate}, although every requirement is cited` } : {}),
  };
}
function groundedResult(company_key: string, ev: Ev[], model: Model) {
  const c = citations(ev, model);
  const claim = (text: string, claim_type: string, x: { evidence_id: string; excerpt: string }) =>
    ({ claim: text, claim_type, evidence_ids: [x.evidence_id], evidence_excerpts: [x] });
  const supporting = [
    ...(c.business ? [claim("sells software to business teams", "business_model", c.business)] : []),
    ...(c.hiring ? [claim("has an open Account Executive posting", "commercial_signal", c.hiring)] : []),
  ];
  return {
    company_key,
    business_model: { value: c.business ? "b2b_software" : "unknown", confidence: c.business ? 0.7 : 0, claims: c.business ? [supporting[0]] : [] },
    company_fit: c.business && c.hiring ? "pass" : "review", agentory_use_case: "plausible",
    mission_signal_assessment: { strongest_signal: c.hiring ? "Account Executive" : null, signal_strength: c.hiring ? "strong" : "none",
      evidence_ids: c.hiring ? [c.hiring.evidence_id] : [], reason: "cited" },
    supporting_claims: supporting, conflicting_evidence_ids: [], missing_evidence: [], unknown_fields: [],
    confidence: 0.7, reason: "from the supplied evidence only",
  };
}

// ── THE SCENARIO ─────────────────────────────────────────────────────────────
export interface Scenario {
  label: string;
  /** Job-search dataset rows (default: one qualifying posting). */
  jobs?: Json[];
  /** The company-details record for a requested LinkedIn URL (default: the posting's own company). */
  details?: (url: string) => Json | null;
  model?: Model;
  /** The evaluator's overall answer, contradicting its PASS rows (Q1, audit G09). */
  aggregate?: "fail" | "review";
  /** Override the compiler's proposal (S22: semantically wrong criteria). */
  proposal?: Json;
  jobsStartStatus?: number;
  detailsStartStatus?: number;
  /** Job-search status reads: `ok`, `unreadable` (HTTP 500), `running` (never finishes). */
  jobsStatus?: "ok" | "unreadable" | "running";
  /** Raw job-search dataset body (S18: malformed). */
  jobsDatasetRaw?: string;
  /** Every runtime model request after compilation times out (S21). */
  modelTimeout?: boolean;
}
export interface Run {
  trace: Json; operations: Json[]; leads: Json[]; credits: Json[]; tasks: Json[]; refused: string[];
  of: (k: string) => Json[]; m: Awaited<ReturnType<typeof seedSmokeMission>>; plan: string; outcome: Json;
  vendorRequests: Array<{ method: string; path: string; body: unknown }>; modelStages: string[];
}

export async function runScenario(s: Scenario): Promise<Run> {
  const model = s.model ?? "honest";
  const originalFetch = globalThis.fetch;
  const key = await mintJwt("service_role");
  const localFetch: typeof fetch = (u, i) => {
    const url = u instanceof Request ? u.url : String(u);
    assertEquals(new URL(url).origin, new URL(REST_URL).origin, "database transport must remain localhost");
    return originalFetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), i);
  };
  const client = createClient(REST_URL, key, { auth: { persistSession: false }, global: { fetch: localFetch } });
  const env: Record<string, string> = {
    RUN_AGENT_IMPORT_ONLY: "1", SUPABASE_URL: REST_URL, SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_ANON_KEY: key,
    OPENAI_API_KEY: "fake-openai-no-network", APIFY_API_TOKEN: "fake-apify-no-network",
    DISCOVERY_SMOKE_ADMISSION: "enforce", LEAD_V2_SMOKE_WALL_CLOCK: "enforce", LEAD_STRATEGIST_PROVIDER: "openai",
    LEAD_CREDIT_ENFORCEMENT: "enforce", LINEAGE_LEASE_ENFORCED: "true", MODEL_SPEND_ENFORCEMENT: "enforce",
    MODEL_SPEND_CEILING_USD: "0.05", MODEL_SPEND_PERIOD_DAYS: "1", MODEL_RUN_MAX_CALLS: "2",
    LEAD_V2_MISSION_PROVIDER_USD_CAP: "0.20", LEAD_V2_MISSION_CREDIT_CAP: "5", LEAD_WORKER_MAX_RUNTIME_MS: "150000",
    LEAD_MAX_AUTO_CONTINUATIONS: "1", LEAD_V2_SMOKE_ORCHESTRATION: "minimal",
  };
  const saved = new Map(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  for (const k of ["ANTHROPIC_API_KEY", "FIRECRAWL_API_KEY", "FIRECRAWL_USD_PER_CREDIT"]) { saved.set(k, Deno.env.get(k)); Deno.env.delete(k); }

  const evidence = { observed_at: new Date(Date.now() - 60_000).toISOString(), source: "synthetic offline fixture; not an approved vendor quote", liability_bound_ref: "offline rehearsal" };
  const p = CATALOG.approved_quotes as Json;
  const fill = (t: Json) => ({ ...t, ...evidence });
  const quotes = { jobs: fill(p.jobs), model: fill(p.luna), reads: fill(p.reads), details: { ...fill(p.details), maximum_microusd: SYNTHETIC_DETAILS_MAXIMUM } };
  const m = await seedSmokeMission({ quotes, actorLimits: { [JOBS]: 1, [DETAILS]: 1 } });
  const user = uuid(), plan = uuid();
  await sql`insert into auth.users (id, email) values (${user}, ${"scenario-" + user + "@example.invalid"})`;
  await sql`insert into public.agents (workspace_id, slug, name, role_prompt, department) values (${m.ws}, 'scout', 'Offline Scout', 'Find and verify the requested company using source evidence.', 'research')`;
  await sql`insert into public.task_plans (id, workspace_id, user_id, user_instruction, status) values (${plan}, ${m.ws}, ${user}, ${MISSION}, 'running')`;
  await sql`insert into public.workspace_credit_balances (workspace_id, balance_credits) values (${m.ws}, 10)`;

  const base = company("qualified");
  const jobs = s.jobs ?? [job("ae", base)];
  const detailsFor = s.details ?? ((url: string) => jobs.map((j) => j.company).find((c) => c.linkedinUrl === url) ?? null);
  const trace: Json = { label: s.label, model, requests: [], admissions: [], model_stages: [], errors: [] };
  const vendorRequests: Run["vendorRequests"] = [];
  let detailsUrl: string | null = null;
  let compiled = false;
  let models = 0;
  const fakeTransport: typeof fetch = (u, init) => {
    const url = new URL(u instanceof Request ? u.url : String(u));
    if (url.origin === new URL(REST_URL).origin) return localFetch(u, init);
    const body = typeof init?.body === "string" ? (() => { try { return JSON.parse(init.body as string); } catch { return init.body; } })() : null;
    trace.requests.push({ method: init?.method ?? "GET", host: url.hostname, path: url.pathname, query: [...url.searchParams].filter(([k]) => k !== "token"),
      bytes: new TextEncoder().encode(String(init?.body ?? "")).length });
    if (url.hostname === "api.openai.com") {
      models++;
      const name = body?.response_format?.json_schema?.name ?? null;
      const system = String(body?.messages?.[0]?.content ?? "");
      trace.model_stages.push(name ?? system.slice(0, 40));
      if (compiled && s.modelTimeout) {
        return Promise.reject(new DOMException("offline model timeout", "TimeoutError"));
      }
      const userMsg = (() => { try { return JSON.parse(String(body?.messages?.at(-1)?.content ?? "")); } catch { return null; } })();
      const answer = name === "lead_mission_proposal" ? (s.proposal ?? PROPOSAL)
        : name === "lead_execution_plan" ? EXECUTION_PLAN
        : system.startsWith("You assess several companies") ? { results: (userMsg?.companies ?? []).map((co: Json) => groundedResult(co.company_key, evidenceIn(co.evidence), model)) }
        : system.startsWith("Decide whether this company satisfies") ? evaluatorAnswer(userMsg, model, s.aggregate)
        : system.startsWith("You interpret supplied company evidence") ? groundedResult(String(userMsg?.company_key ?? ""), evidenceIn(userMsg), model)
        : {};
      return Promise.resolve(new Response(JSON.stringify({
        id: `fake-${models}`, model: body?.model, choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 400, total_tokens: 1400 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    assertEquals(url.hostname, "api.apify.com", `unexpected vendor ${url.hostname}`);
    vendorRequests.push({ method: init?.method ?? "GET", path: url.pathname.replace(/^\/v2\//, ""), body });
    const kind = url.pathname.includes("linkedin-company") || url.pathname.includes("details") ? "details" : "jobs";
    const json = (b: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } }));
    if ((init?.method ?? "GET") === "POST") {
      const refused = kind === "jobs" ? s.jobsStartStatus : s.detailsStartStatus;
      if (refused) return json({ error: { type: "offline", message: "offline: Apify refused the run" } }, refused);
      if (kind === "details") detailsUrl = (body as Json)?.companies?.[0] ?? null;
      return json({ data: { id: `run-${kind}`, defaultDatasetId: `dataset-${kind}`, status: "RUNNING" } }, 201);
    }
    if (url.pathname.includes("/actor-runs/")) {
      const run = url.pathname.split("/").at(-1)!;
      if (run === "run-jobs" && s.jobsStatus === "unreadable") return json({ error: "offline status unavailable" }, 500);
      if (run === "run-jobs" && s.jobsStatus === "running") return json({ data: { id: run, defaultDatasetId: "dataset-jobs", status: "RUNNING" } });
      return json({ data: { id: run, defaultDatasetId: run.replace("run-", "dataset-"), status: "SUCCEEDED",
        finishedAt: new Date(Date.now() - 1000).toISOString(), usageTotalUsd: run === "run-jobs" ? 0.004 : 0.00405 } });
    }
    assert(url.pathname.includes("/datasets/"), url.pathname);
    if (url.pathname.includes("dataset-details")) {
      const rec = detailsUrl ? detailsFor(detailsUrl) : null;
      return json(rec ? [structuredClone(rec)] : []);
    }
    if (s.jobsDatasetRaw !== undefined) return Promise.resolve(new Response(s.jobsDatasetRaw, { status: 200, headers: { "content-type": "application/json" } }));
    return json(structuredClone(jobs));
  };
  const gate = createAdmissionFetch({ db: client as never, ownApi: REST_URL, baseFetch: fakeTransport,
    log: (message, data) => trace.admissions.push({ message, data }) });

  globalThis.fetch = fakeTransport;
  try {
    const compilerCalls = new ModelCallCollector();
    const binding = buildMissionCompilerBinding({ workspaceId: m.ws, onModelCall: compilerCalls.sink });
    const raw = await missionAdmission.run({ queueId: m.queueId, workerId: m.workerId, taskId: m.taskId, generation: m.generation },
      () => binding.proposeMission!({ originalUserQuery: MISSION, requestedCount: 1 }));
    assert(raw, JSON.stringify({ compiler_failure: binding.lastModelFailure() }));
    await compilerCalls.drain(createLedgerWriter(client as never), { workspace_id: m.ws, task_id: m.taskId, plan_id: plan, logical_call_key: "offline:mission_compilation" });
    const c = compileLeadMission({ originalUserQuery: MISSION, proposal: raw, requestedCount: 1 });
    const mission = { ...c.final_mission, mission_parser_source: c.parser_source,
      lead_intelligence_contract_version: LEAD_INTELLIGENCE_CONTRACT_VERSION, planner_runtime: runtimeIdentity("planner", "offline-rehearsal") };
    trace.compiled_mission = mission;
    compiled = true;
    globalThis.fetch = gate;
    const request = { plan_id: plan, step_index: 0, agent_slug: "scout", workspace_id: m.ws, user_id: user, instruction: MISSION,
      requested_lead_count: 1, workflow_kind: "qualified_lead_sourcing", execution_mode: "company_first", tool_needed: "source_with_apify",
      lead_mission: mission, tool_input: { lead_mission: mission, source_type: "jobs" }, run_budget: { provider_usd: 0.20, max_candidates: 3 } };
    await sql`update public.tasks set status = 'complete' where id = ${m.taskId}`;
    await sql`update public.lead_mission_queue set task_id = null, lineage_id = null, request = ${sql.json(request as never)} where id = ${m.queueId}`;
    await sql`update public.discovery_smoke_authorizations a set criteria_hash = encode(sha256(convert_to(q.request::text, 'UTF8')), 'hex')
                from public.lead_mission_queue q where q.id = a.queue_id and a.id = ${m.authorizationId}`;
    const { handleRunAgent } = await import("../../../supabase/functions/run-agent/index.ts");
    const runner = createLeadMissionRunner({
      handler: async (req, opts) => {
        const r = await handleRunAgent(req, opts);
        trace.handler ??= { status: r.status, body: await r.clone().json() };
        return r;
      },
      enforceMissionWallClock: true, serviceRoleKey: key, functionsBaseUrl: `${REST_URL}/functions/v1/`,
      admission: { workerId: m.workerId }, createDeadline: (budgetMs) => createExecutionDeadline({ budgetMs }),
      bind: async (queueId, taskId, lineageId) => {
        const { data, error } = await client.rpc("bind_lead_mission_execution", { p_queue_id: queueId, p_worker_id: m.workerId, p_task_id: taskId, p_lineage_id: lineageId });
        assertEquals(error, null);
        trace.task_id = taskId;
        return (Array.isArray(data) ? data[0] : data)?.bound === true;
      },
      readTaskOutcome: async (taskId) => {
        const { data } = await client.from("tasks").select("status,result").eq("id", taskId).single();
        return { status: data!.status, terminal_status: terminalStatusOf(data!.result) };
      },
      readLineageOutcome: async (lineageId) => {
        const { data } = await client.from("lead_lineages").select("status,terminal_reason,current_state").eq("lineage_id", lineageId).maybeSingle();
        return data ? { status: data.status, terminal_reason: data.terminal_reason, terminal_status: terminalStatusOf(data.current_state) } : null;
      },
    });
    const [q] = await sql`select created_at from public.lead_mission_queue where id = ${m.queueId}`;
    trace.runner = await runner.run({ queueId: m.queueId, workspaceId: m.ws, request, taskId: null, lineageId: null, attempts: 1, isResume: false,
      heldUntil: null, enqueuedAt: new Date(q.created_at).toISOString() }, { executionBudgetMs: 150000, signal: new AbortController().signal });

    const operations = await sql`select kind, actor, committed_microusd, reported_microusd, report_source, provider_run_id, operation_key
      from public.discovery_smoke_operations where authorization_id = ${m.authorizationId} order by admitted_at`;
    const leads = (await client.from("lead_candidates").select("*").eq("workspace_id", m.ws)).data ?? [];
    const credits = await sql`select status, idempotency_key from public.credit_transactions where workspace_id = ${m.ws}`;
    const tasks = await sql`select id, status, result from public.tasks where workspace_id = ${m.ws}`;
    const refused = trace.admissions.filter((a: Json) => a.message === "[smoke-admission] refused").map((a: Json) => a.data?.decision);
    const of = (k: string) => (operations as Json[]).filter((o) => o.kind === k);
    const live = (tasks as Json[]).map((t) => t.result).find((r) => r?.capability_execution_state) ?? {};
    const outcome = {
      leads: (leads as Json[]).map((l) => ({ company: l.raw?.company_name ?? null, qualified: l.raw?.canonical_decision?.qualified ?? null,
        hard_checks: l.raw?.canonical_decision?.hard_checks ?? null })),
      qualified: (leads as Json[]).filter((l) => l.raw?.canonical_decision?.qualified === true).map((l) => l.raw?.company_name),
      provider: of("provider").map((o) => [o.actor, o.committed_microusd, o.provider_run_id]),
      polls: of("poll").length, models: of("model").length,
      committed: (operations as Json[]).reduce((a, o) => a + Number(o.committed_microusd), 0),
      credits: Object.fromEntries((credits as Json[]).map((c) => [String(c.idempotency_key).split(":")[1], c.status])),
      attempts: (live.capability_execution_state?.provider_attempts ?? []).map((a: Json) => a.reason ?? a.outcome ?? null),
      terminal: (tasks as Json[]).map((t) => t.result?.terminal_status).filter(Boolean),
      runner: trace.runner?.status ?? null, refused,
      details_requested: vendorRequests.filter((v) => v.method === "POST" && v.path.includes("linkedin-company")).map((v) => (v.body as Json)?.companies),
    };
    trace.outcome = outcome;
    return { trace, operations: operations as Json[], leads: leads as Json[], credits: credits as Json[], tasks: tasks as Json[], refused, of, m, plan,
      outcome, vendorRequests, modelStages: trace.model_stages };
  } catch (e) {
    trace.errors.push(String(e));
    throw e;
  } finally {
    // The contract runner grants no write access: the trace goes to the log.
    console.log("A7_SCENARIO_TRACE", JSON.stringify(trace));
    // END THIS SCENARIO'S QUEUE ROW. The runner does not release it, so it would
    // stay `running` with a three-minute lease and, once that lapsed, become
    // claimable by any later test that claims the next mission in this shared
    // database (offlineSmokeProgress claims and asserts its own row).
    await sql`update public.lead_mission_queue set status = 'complete'
                where id = ${m.queueId} and status in ('queued', 'running', 'resumable')`;
    globalThis.fetch = originalFetch;
    for (const [k, v] of saved) { if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v); }
  }
}

/** The A7 bounds every scenario must hold, whatever its outcome. */
export function boundsHeld(r: Run) {
  const o = r.outcome;
  assert(o.models <= 4, `at most four model attempts (${o.models})`);
  assert(r.of("model").reduce((a, x) => a + Number(x.committed_microusd), 0) <= 50_000, "$0.05 model");
  assert(r.of("provider").reduce((a, x) => a + Number(x.committed_microusd), 0) <= 200_000, "$0.20 provider");
  assert(o.committed <= 250_000, "$0.25 total");
  assert(o.polls <= 5, `at most five reads (${o.polls})`);
  const actors = r.of("provider").map((x) => x.actor);
  assertEquals(actors.length, new Set(actors).size, "one start per approved actor");
  for (const q of r.trace.requests as Json[]) {
    if (q.method === "POST" && q.host === "api.apify.com") {
      const cap = Number(new Map(q.query as [string, string][]).get("maxTotalChargeUsd"));
      assert(cap > 0 && cap <= 0.005, `vendor cap on every start (${cap})`);
    }
  }
}
