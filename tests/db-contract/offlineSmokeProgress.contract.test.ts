// The offline smoke rehearsal carried past the execution planner. Derived from
// Codex's independent harness (PR #95, tests/db-contract/offlineSmokeMission
// .contract.test.ts at 2f48cb0f): actual compiler, worker, handler, SQL
// admission and PostgREST; only vendor responses and Supabase's gateway path
// are substituted. Three changes, each matching the runbook rather than the
// harness: the mission is compiled OFFLINE before authorization (Phase 4) and
// the authorization is over the FINAL kickoff body (Phase 5; the request may
// not change after it); and the fixture row's `postedDate` (the field the
// normalizer reads) is inside the 30-day window. It asserts the limits and
// records where the mission stops today, and must be extended when that moves.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintJwt, REST_URL, sql, uuid } from "./lib/harness.ts";
import { authorizeSmoke, seedSmokeMission } from "./lib/smokeMission.ts";
import {
  createAdmissionFetch,
  missionAdmission,
} from "../../supabase/functions/_shared/smokeAdmission.ts";
import { createLeadMissionRunner } from "../../worker/leadMissionRunner.ts";
import { isTerminalQueueStatus, releaseQueuedMission } from "../../supabase/functions/_shared/leadMissionTerminal.ts";
import { reconcileTerminalRows } from "../../supabase/functions/_shared/leadMissionCancellation.ts";
import { createExecutionDeadline } from "../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import { buildMissionCompilerBinding } from "../../supabase/functions/_shared/leadMissionCompilerBinding.ts";
import { compileLeadMission } from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  LEAD_INTELLIGENCE_CONTRACT_VERSION,
  runtimeIdentity,
} from "../../supabase/functions/_shared/leadRuntimeIdentity.ts";
import {
  createLedgerWriter,
  ModelCallCollector,
} from "../../supabase/functions/_shared/executionLedger.ts";
import { terminalStatusOf } from "../../supabase/functions/_shared/leadMissionV2Request.ts";

const MISSION =
  "Find 1 US B2B software company with a current declared 11–50 employee band and an open Account Executive posting dated within 30 days.";
const JOBS = "apify:harvestapi~linkedin-job-search";
const LUNA = "openai:gpt-5.6-luna";
const proposal = {
  requested_opportunity_count: 1,
  requested_contact_ready_count: null,
  company_types: ["B2B software"],
  geographies: ["United States"],
  geography_is_hard: true,
  employee_range: { min: 11, max: 50 },
  decision_maker_roles: [],
  hard_constraints: [],
  soft_preferences: [],
  preferred_signals: ["hiring Account Executive"],
  required_signal_terms: ["Account Executive"],
  signal_recency_days: 30,
  adjacent_signals: [],
  excluded_signals: [],
  allowed_broadening: {
    role_families: [],
    company_types: [],
    geographies: [],
    employee_range: { min: null, max: null },
  },
  disallowed_broadening: ["geography", "role", "size"],
  required_evidence: [],
  required_capabilities: [
    "general_company_discovery",
    "embedded_hiring_evidence",
    "company_semantic_evaluation",
  ],
  preferred_source_strategy: [],
  evaluation_instructions:
    "All requirements must be verified; unknown is never match.",
  founder_unlock_recommended: false,
  confidence: 0.99,
  unknowns: [],
};
const jobInput = {
  jobTitles: ["Account Executive"],
  locations: ["United States"],
  maxItems: 3,
  postedLimit: "month",
  sortBy: "date",
};
const executionPlan = {
  reasoning:
    "One hiring-led discovery; employer identity and declared company band come from the posting. No paid enrichment or contact unlock.",
  steps: [
    {
      capability: "job_discovery",
      actor_key: "apify_linkedin_job_search",
      purpose: "find the specified open role",
      input: jobInput,
      depends_on: [],
    },
    {
      capability: "company_brain_qualification",
      actor_key: null,
      purpose: "verify every stated company requirement",
      input: {},
      depends_on: [1],
    },
    {
      capability: "persistence",
      actor_key: null,
      purpose: "persist evidence-backed results",
      input: {},
      depends_on: [2],
    },
  ],
};
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

const DETAILS = "apify:harvestapi~linkedin-company";

// ── AN HONEST STAND-IN FOR THE MODEL ─────────────────────────────────────────
// Each stage gets the answer its schema asks for, built only from the evidence
// the request itself carries: every excerpt is copied verbatim from a supplied
// `source_text`, and a requirement with nothing citable is `review`, never a
// pass. Nothing here can qualify a company the evidence does not support.
type Ev = { evidence_id: string; evidence_type?: string; source_text?: string | null };
function evidenceIn(x: unknown, out: Ev[] = []): Ev[] {
  if (Array.isArray(x)) for (const y of x) evidenceIn(y, out);
  else if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (typeof o.evidence_id === "string" && typeof o.source_text === "string") out.push(o as Ev);
    else for (const v of Object.values(o)) evidenceIn(v, out);
  }
  return out;
}
const cite = (ev: Ev[], test: (e: Ev) => boolean, phrase: string) => {
  const e = ev.find((x) => test(x) && (x.source_text ?? "").includes(phrase));
  return e ? { evidence_id: e.evidence_id, excerpt: phrase } : null;
};
function citations(ev: Ev[]) {
  return {
    business: cite(ev, (e) => e.evidence_type === "company_description", selfDescription),
    location: cite(ev, (e) => /location|headquarter/.test(e.evidence_type ?? ""), "United States"),
    size: cite(ev, (e) => e.evidence_type === "company_size_band", "11-50 employees"),
    hiring: cite(ev, (e) => /job|posting|hiring/.test(e.evidence_type ?? ""), "Account Executive"),
  };
}
function evaluatorAnswer(input: unknown) {
  const c = citations(evidenceIn(input));
  const req: Array<[string, { evidence_id: string; excerpt: string } | null]> = [
    ["B2B software company", c.business], ["located in the United States", c.location],
    ["declared 11–50 employee band", c.size], ["open Account Executive posting within 30 days", c.hiring],
  ];
  const missing = req.filter(([, x]) => !x).map(([r]) => r);
  return {
    mission_fit: missing.length === 0 ? "pass" : "review", icp_fit: "plausible",
    hiring_fit: c.hiring ? "verified" : "absent", confidence: 0.8, match_score: missing.length === 0 ? 80 : 0,
    matched_requirements: req.filter(([, x]) => x).map(([requirement, x]) => ({ requirement, ...x!, support: "verified" })),
    failed_requirements: [], reasoning: missing.length ? `not established: ${missing.join("; ")}` : "every requirement cited",
    rejection_reasons: [], evidence_quality: missing.length ? "weak" : "moderate", unknown_fields: missing, next_action: null,
  };
}
function groundedResult(company_key: string, ev: Ev[]) {
  const c = citations(ev);
  const claim = (claim: string, claim_type: string, x: { evidence_id: string; excerpt: string }) =>
    ({ claim, claim_type, evidence_ids: [x.evidence_id], evidence_excerpts: [x] });
  const supporting = [
    ...(c.business ? [claim(`sells ${selfDescription}`, "business_model", c.business)] : []),
    ...(c.hiring ? [claim("has an open Account Executive posting", "commercial_signal", c.hiring)] : []),
  ];
  return {
    company_key,
    business_model: { value: c.business ? "b2b_software" : "unknown", confidence: c.business ? 0.7 : 0,
      claims: c.business ? [supporting[0]] : [] },
    company_fit: c.business && c.hiring ? "pass" : "review", agentory_use_case: "plausible",
    mission_signal_assessment: { strongest_signal: c.hiring ? "Account Executive" : null,
      signal_strength: c.hiring ? "strong" : "none", evidence_ids: c.hiring ? [c.hiring.evidence_id] : [], reason: "cited" },
    supporting_claims: supporting, conflicting_evidence_ids: [], missing_evidence: [], unknown_fields: [],
    confidence: 0.7, reason: "from the supplied evidence only",
  };
}
function batchAnswer(input: { companies?: Array<{ company_key: string; evidence?: unknown }> }) {
  return { results: (input.companies ?? []).map((co) => groundedResult(co.company_key, evidenceIn(co.evidence))) };
}

interface Variant {
  /** Audit the stricter request without changing the approved live package. */
  goal?: string;
  auditCompany?: "us_hq" | "foreign_hq" | "no_hq" | "missing_description";
  auditJobDate?: "future" | "expired";
  /** LEAD_V2_SMOKE_ORCHESTRATION; absent = the customer orchestration. */
  orchestration?: "minimal";
  /** The proposed two-actor catalog (job search + company details) instead of the job search alone. */
  companyDetails?: boolean;
  /** The negative control: a company description that names no buyer ("to business customers"). */
  weakEvidence?: boolean;
  /** The job search's first long poll returns RUNNING (independent review, PR #96). */
  slowJobSearch?: boolean;
  /** Apify refuses the job search's start with this HTTP status (e.g. a restricted account). */
  jobsStartStatus?: number;
  /** Apify refuses the company-details start with this HTTP status. */
  detailsStartStatus?: number;
  /** The job search succeeds with an empty dataset. */
  jobsEmpty?: boolean;
  /** Three postings: two from the same employer, one from a large non-US employer. */
  duplicateEmployer?: boolean;
  /** The company record comes back without its size band or description. */
  detailsIncomplete?: boolean;
  label: string;
}

const PROPOSAL = JSON.parse(Deno.readTextFileSync(
  new URL("../../docs/launch/proposals/smoke-catalog-two-actor.json", import.meta.url)));
/** NOT A VENDOR PRICE: the proposal's company-details maximum is unobserved (null); offline only. */
const SYNTHETIC_DETAILS_MAXIMUM = 5000;
/** What the company's own description says it sells, and to whom (cited verbatim by the stand-in model). */
const STRONG_SELF_DESCRIPTION = "sales software for revenue teams at mid-size companies";
const WEAK_SELF_DESCRIPTION = "business software platform to business customers";
let selfDescription = STRONG_SELF_DESCRIPTION;
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- trace rows and SQL results, read field by field
type Rehearsal = Record<string, any>;

async function rehearse(v: Variant, check: (r: Rehearsal) => void | Promise<void>) {
  const missionGoal = v.goal ?? MISSION;
  selfDescription = v.weakEvidence ? WEAK_SELF_DESCRIPTION : STRONG_SELF_DESCRIPTION;
  {
    const originalFetch = globalThis.fetch;
    const key = await mintJwt("service_role");
    const localFetch: typeof fetch = (u, i) => {
      const url = u instanceof Request ? u.url : String(u);
      assertEquals(
        new URL(url).origin,
        new URL(REST_URL).origin,
        "database transport must remain localhost",
      );
      return originalFetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), i);
    };
    const client = createClient(REST_URL, key, {
      auth: { persistSession: false },
      global: { fetch: localFetch },
    });
    const env = {
      RUN_AGENT_IMPORT_ONLY: "1",
      SUPABASE_URL: REST_URL,
      SUPABASE_SERVICE_ROLE_KEY: key,
      SUPABASE_ANON_KEY: key,
      OPENAI_API_KEY: "fake-openai-no-network",
      APIFY_API_TOKEN: "fake-apify-no-network",
      DISCOVERY_SMOKE_ADMISSION: "enforce",
      LEAD_V2_SMOKE_WALL_CLOCK: "enforce",
      LEAD_STRATEGIST_PROVIDER: "openai",
      LEAD_CREDIT_ENFORCEMENT: "enforce",
      LINEAGE_LEASE_ENFORCED: "true",
      MODEL_SPEND_ENFORCEMENT: "enforce",
      MODEL_SPEND_CEILING_USD: "0.05",
      MODEL_SPEND_PERIOD_DAYS: "1",
      MODEL_RUN_MAX_CALLS: "2",
      LEAD_V2_MISSION_PROVIDER_USD_CAP: "0.20",
      LEAD_V2_MISSION_CREDIT_CAP: "5",
      LEAD_WORKER_MAX_RUNTIME_MS: "150000",
      LEAD_MAX_AUTO_CONTINUATIONS: "1",
      ...(v.orchestration ? { LEAD_V2_SMOKE_ORCHESTRATION: v.orchestration } : {}),
    };
    const saved = new Map(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
    for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
    for (
      const k of [
        "ANTHROPIC_API_KEY",
        "FIRECRAWL_API_KEY",
        "FIRECRAWL_USD_PER_CREDIT",
        ...(v.orchestration ? [] : ["LEAD_V2_SMOKE_ORCHESTRATION"]),
      ]
    ) {
      saved.set(k, Deno.env.get(k));
      Deno.env.delete(k);
    }
    const at = new Date(Date.now() - 60_000).toISOString();
    const evidence = {
      observed_at: at,
      source: "synthetic offline fixture; not an approved vendor quote",
      liability_bound_ref: "offline rehearsal",
    };
    // THE PROPOSED CATALOG, as written (docs/launch/proposals/smoke-catalog-two-actor.json):
    // its templates and request bounds, with the evidence fields synthetic and
    // the ONE unobserved price filled for this offline rehearsal only.
    const p = PROPOSAL.approved_quotes as Record<string, Record<string, unknown>>;
    const fill = (t: Record<string, unknown>) => ({ ...t, ...evidence });
    const quotes: Record<string, unknown> = {
      jobs: fill(p.jobs),
      model: fill(p.luna),
      // One actor: its own share of the proposal's allocation (an allocation names exactly the allowed actors).
      reads: v.companyDetails ? fill(p.reads) : { ...fill(p.reads), allowed_actors: [JOBS],
        request_limits: { max_reads_per_actor: { [JOBS]: (p.reads.request_limits as Rehearsal).max_reads_per_actor[JOBS] } } },
      ...(v.companyDetails ? { details: { ...fill(p.details), maximum_microusd: SYNTHETIC_DETAILS_MAXIMUM } } : {}),
    };
    const actorLimits = { [JOBS]: 1, ...(v.companyDetails ? { [DETAILS]: 1 } : {}) };
    const m = await seedSmokeMission({ authorize: false });
    const user = uuid(), plan = uuid();
    await sql`insert into auth.users (id, email) values (${user}, ${
      "offline-" + user + "@example.invalid"
    })`;
    await sql`insert into public.agents (workspace_id, slug, name, role_prompt, department) values (${m.ws}, 'scout', 'Offline Scout', 'Find and verify the requested company using source evidence.', 'research')`;
    await sql`insert into public.task_plans (id, workspace_id, user_id, user_instruction, status) values (${plan}, ${m.ws}, ${user}, ${missionGoal}, 'running')`;
    const conversation = uuid();
    await sql`insert into public.conversations (id,user_id,workspace_id,title) values (${conversation},${user},${m.ws},'Offline A7 audit')`;
    await sql`insert into public.messages (conversation_id,role,content,metadata) values
      (${conversation},'assistant','Approved offline fixture plan',${sql.json({ plan_id: plan })})`;
    await sql`insert into public.workspace_credit_balances (workspace_id, balance_credits) values (${m.ws}, 10)`;

    type HandlerCall = { status: number; body: Record<string, unknown> };
    type Trace = Record<string, unknown> & {
      requests: Array<
        { method: string; url: string; bytes: number; body: unknown }
      >;
      attempted_requests: Array<
        { host: string; path: string; bytes: number; body: unknown }
      >;
      admissions: Array<{ message: string; data: unknown }>;
      errors: string[];
      stages: unknown[];
      handler_calls: HandlerCall[];
      handler?: HandlerCall;
      task_id?: string;
    };
    const trace: Trace = {
      variant: v.label,
      proposed_spec_sha: "0fb6312c1b78bf0282401140e62e903b31567930",
      mission: missionGoal,
      requests: [],
      attempted_requests: [],
      admissions: [],
      errors: [],
      stages: [],
      handler_calls: [],
      model_stages: [],
    };
    const finishedAt = new Map<string, string>();
    const statusReads = new Map<string, number>();
    const fixture = JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../fixtures/lead-v2/p3-job-discovery-probe.json",
          import.meta.url,
        ),
      ),
    );
    const row = structuredClone(
      fixture.probes["harvestapi~linkedin-job-search"].items[0],
    );
    Object.assign(row, {
      id: "offline-ae",
      title: "Account Executive",
      linkedinUrl: "https://www.linkedin.com/jobs/view/offline-ae",
      postedAt: new Date(Date.now() - 86400_000).toISOString(),
      postedDate: new Date(Date.now() - 86400_000).toISOString(),
      descriptionText:
        "Example Software is a US B2B software company. We are hiring an Account Executive for our business software platform.",
    });
    Object.assign(row.company, {
      id: "offline-company",
      name: "Example Software",
      linkedinUrl: "https://www.linkedin.com/company/offline-software",
      website: "https://offline-software.example",
      description:
        // The company's own words name its buyers and its product, as the
        // business-model rule requires (a plural buyer noun; "business
        // customers" names none and correctly stays unverified).
        v.weakEvidence ? `We sell a ${WEAK_SELF_DESCRIPTION}.` : `Example Software builds ${STRONG_SELF_DESCRIPTION}.`,
      employeeCountRange: { start: 11, end: 50 },
      locations: [{
        country: "United States",
        city: "Boston",
        isHeadquarter: true,
      }],
    });
    if (v.auditCompany) row.company.locations = [
      { country: "US", city: "Boston", headquarter: v.auditCompany !== "foreign_hq", parsed: { text: "Boston, United States", countryFull: "United States" } },
      ...(v.auditCompany === "foreign_hq" ? [{ country: "CA", city: "Toronto", headquarter: true, parsed: { text: "Toronto, Canada", countryFull: "Canada" } }] : []),
    ];
    if (v.auditCompany) row.company.employeeCount = 27;
    if (v.auditJobDate) {
      const date = new Date(Date.now() + (v.auditJobDate === "future" ? 45 : -45) * 86400_000).toISOString();
      row.postedAt = date; row.postedDate = date;
    }
    // Three postings for the dedupe case: the same employer twice, plus one the
    // mission's own hard limits exclude (5001-10000 employees, Germany).
    const jobRows = () => {
      const dup = structuredClone(row);
      Object.assign(dup, { id: "offline-ae-2", title: "Senior Account Executive",
        linkedinUrl: "https://www.linkedin.com/jobs/view/offline-ae-2" });
      const other = structuredClone(row);
      Object.assign(other, { id: "offline-ae-3", linkedinUrl: "https://www.linkedin.com/jobs/view/offline-ae-3",
        descriptionText: "Large Enterprise GmbH is hiring an Account Executive in Berlin." });
      other.company = { ...structuredClone(row.company), id: "offline-large", name: "Large Enterprise GmbH",
        linkedinUrl: "https://www.linkedin.com/company/offline-large", website: "https://offline-large.example",
        employeeCountRange: { start: 5001, end: 10000 },
        locations: [{ country: "Germany", city: "Berlin", isHeadquarter: true }] };
      return [row, dup, other];
    };
    let models = 0;
    const fakeTransport: typeof fetch = (u, init) => {
      const url = new URL(u instanceof Request ? u.url : String(u));
      if (url.origin === new URL(REST_URL).origin) return localFetch(u, init);
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body)
        : null;
      const request = {
        method: init?.method ?? "GET",
        url: url.origin + url.pathname +
          (url.hostname === "api.apify.com"
            ? "?" +
              new URLSearchParams(
                [...url.searchParams].filter(([k]) => k !== "token"),
              )
            : ""),
        bytes: new TextEncoder().encode(String(init?.body ?? "")).length,
        body,
      };
      trace.requests.push(request);
      if (url.hostname === "api.openai.com") {
        models++;
        const system = String(body.messages?.[0]?.content ?? "");
        const name = body.response_format?.json_schema?.name ?? null;
        const user = (() => { try { return JSON.parse(String(body.messages?.at(-1)?.content ?? "")); } catch { return null; } })();
        const answer = name === "lead_mission_proposal" ? proposal
          : name === "lead_execution_plan" ? executionPlan
          : system.startsWith("You assess several companies") ? batchAnswer(user ?? {})
          : system.startsWith("Decide whether this company satisfies") ? evaluatorAnswer(user)
          : system.startsWith("You interpret supplied company evidence")
            ? groundedResult(String(user?.company_key ?? ""), evidenceIn(user))
          : {};
        (trace.model_stages as string[]).push(name ?? system.slice(0, 40));
        return json({
          id: `fake-${models}`,
          model: body.model,
          choices: [{
            message: { content: JSON.stringify(answer) },
            finish_reason: "stop",
          }],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 400,
            total_tokens: 1400,
          },
        });
      }
      assertEquals(
        url.hostname,
        "api.apify.com",
        "unexpected vendor path must fail the rehearsal",
      );
      // One run per actor: `run-jobs` / `run-details`, each with its dataset.
      const kind = url.pathname.includes("linkedin-company") || url.pathname.includes("details") ? "details" : "jobs";
      if (request.method === "POST") {
        const refused = kind === "jobs" ? v.jobsStartStatus : v.detailsStartStatus;
        if (refused) {
          return json({ error: { type: "user-or-token-limited", message: "offline: Apify refused the run" } }, refused);
        }
        return json({
          data: { id: `run-${kind}`, defaultDatasetId: `dataset-${kind}`, status: "RUNNING" },
        }, 201);
      }
      if (url.pathname.includes("/actor-runs/")) {
        const run = url.pathname.split("/").at(-1)!;
        statusReads.set(run, (statusReads.get(run) ?? 0) + 1);
        if (v.slowJobSearch && run === "run-jobs" && statusReads.get(run) === 1) {
          return json({ data: { id: run, defaultDatasetId: "dataset-jobs", status: "RUNNING" } });
        }
        if (!finishedAt.has(run)) finishedAt.set(run, new Date().toISOString());
        return json({
          data: {
            id: run, defaultDatasetId: run.replace("run-", "dataset-"), status: "SUCCEEDED",
            finishedAt: finishedAt.get(run), usageTotalUsd: run === "run-jobs" ? 0.002 : 0.004,
          },
        });
      }
      assert(url.pathname.includes("/datasets/"));
      if (url.pathname.includes("dataset-details")) {
        const company = structuredClone(row.company);
        if (v.detailsIncomplete) { delete company.employeeCountRange; delete company.description; }
        if (v.auditCompany === "no_hq") for (const location of company.locations) location.headquarter = false;
        if (v.auditCompany === "missing_description") delete company.description;
        return json([company]);
      }
      if (v.jobsEmpty) return json([]);
      return json(v.duplicateEmployer ? jobRows() : [row]);
    };
    const gate = createAdmissionFetch({
      db: client as never,
      ownApi: REST_URL,
      baseFetch: fakeTransport,
      log: (message, data) => trace.admissions.push({ message, data }),
    });
    const observedGate: typeof fetch = (u, init) => {
      const url = new URL(u instanceof Request ? u.url : String(u));
      if (url.origin !== new URL(REST_URL).origin) {
        trace.attempted_requests.push({
          host: url.hostname,
          path: url.pathname,
          bytes: new TextEncoder().encode(String(init?.body ?? "")).length,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        });
      }
      return gate(u, init);
    };
    for (const symbol of Object.getOwnPropertySymbols(gate)) {
      Object.defineProperty(
        observedGate,
        symbol,
        Object.getOwnPropertyDescriptor(gate, symbol)!,
      );
    }
    const started = Date.now();
    // Runbook Phase 4: the kickoff body (and its mission) is compiled OFFLINE,
    // before authorization; it is not a live attempt of the smoke.
    globalThis.fetch = fakeTransport;
    try {
      const compilerCalls = new ModelCallCollector();
      const binding = buildMissionCompilerBinding({
        workspaceId: m.ws,
        onModelCall: compilerCalls.sink,
      });
      const raw = await missionAdmission.run({
        queueId: m.queueId,
        workerId: m.workerId,
        taskId: m.taskId,
        generation: m.generation,
      }, () =>
        binding.proposeMission!({
          originalUserQuery: missionGoal,
          requestedCount: 1,
        }));
      assert(
        raw,
        JSON.stringify({
          compiler_failure: binding.lastModelFailure(),
          admissions: trace.admissions,
        }),
      );
      trace.compiler_ledger_rows = await compilerCalls.drain(
        createLedgerWriter(client as never),
        {
          workspace_id: m.ws,
          task_id: m.taskId,
          plan_id: plan,
          logical_call_key: "offline:mission_compilation",
        },
      );
      const compiled = compileLeadMission({
        originalUserQuery: missionGoal,
        proposal: raw,
        requestedCount: 1,
      });
      const mission = {
        ...compiled.final_mission,
        mission_parser_source: compiled.parser_source,
        lead_intelligence_contract_version: LEAD_INTELLIGENCE_CONTRACT_VERSION,
        planner_runtime: runtimeIdentity("planner", "offline-rehearsal"),
      };
      trace.stages.push({ stage: "compile", mission });
      globalThis.fetch = observedGate;
      const compiledOffline = trace.requests.length;
      const request = {
        plan_id: plan,
        step_index: 0,
        agent_slug: "scout",
        workspace_id: m.ws,
        user_id: user,
        instruction: missionGoal,
        requested_lead_count: 1,
        workflow_kind: "qualified_lead_sourcing",
        execution_mode: "company_first",
        tool_needed: "source_with_apify",
        lead_mission: mission,
        tool_input: { lead_mission: mission, source_type: "jobs" },
        run_budget: { provider_usd: 0.20, max_candidates: 3 },
      };
      // The contract helper starts bound so compilation can be metered too.
      // Prepare the worker's fresh queued kickoff after compilation, preserving
      // the original creation time. Authorize the FINAL request through the
      // real administrator RPC, then claim it through the worker's real RPC.
      // No runtime decision or qualification state is synthesized here.
      await sql`update public.tasks set status = 'complete' where id = ${m.taskId}`;
      await sql`update public.lead_mission_queue set task_id = null, lineage_id = null, status='queued', claimed_by=null, lease_expires_at=null, request = ${
        sql.json(request as never)
      } where id = ${m.queueId}`;
      // Runbook Phase 5 order: the authorization is over the FINAL kickoff body
      // (the queue row's request cannot change after authorization).
      m.authorizationId = await authorizeSmoke(m.queueId, { quotes, actorLimits });
      const { data: claims, error: claimError } = await client.rpc("claim_next_lead_mission", {
        p_worker_id: m.workerId, p_lease_seconds: 180,
      });
      assertEquals(claimError, null);
      assertEquals(claims[0].queue_id, m.queueId);
      trace.claim = claims[0];
      const { handleRunAgent } = await import(
        "../../supabase/functions/run-agent/index.ts"
      );
      const runner = createLeadMissionRunner({
        handler: async (req, opts) => {
          const response = await handleRunAgent(req, opts);
          const call = {
            status: response.status,
            body: await response.clone().json(),
          };
          trace.handler_calls.push(call);
          trace.handler ??= call;
          return response;
        },
        enforceMissionWallClock: true,
        serviceRoleKey: key,
        functionsBaseUrl: `${REST_URL}/functions/v1/`,
        admission: { workerId: m.workerId },
        createDeadline: (budgetMs) => createExecutionDeadline({ budgetMs }),
        bind: async (queueId, taskId, lineageId) => {
          const { data, error } = await client.rpc(
            "bind_lead_mission_execution",
            {
              p_queue_id: queueId,
              p_worker_id: m.workerId,
              p_task_id: taskId,
              p_lineage_id: lineageId,
            },
          );
          assertEquals(error, null);
          const row = Array.isArray(data) ? data[0] : data;
          trace.worker_binding = row;
          trace.task_id = taskId;
          return row?.bound === true;
        },
        readTaskOutcome: async (taskId) => {
          const { data, error } = await client.from("tasks").select(
            "status,result",
          ).eq("id", taskId).single();
          assertEquals(error, null);
          assert(data);
          return {
            status: data.status,
            terminal_status: terminalStatusOf(data.result),
          };
        },
        readLineageOutcome: async (lineageId) => {
          const { data } = await client.from("lead_lineages").select(
            "status,terminal_reason,current_state",
          ).eq("lineage_id", lineageId).maybeSingle();
          return data
            ? {
              status: data.status,
              terminal_reason: data.terminal_reason,
              terminal_status: terminalStatusOf(data.current_state),
            }
            : null;
        },
      });
      const [q] =
        await sql`select created_at from public.lead_mission_queue where id = ${m.queueId}`;
      const queued = {
        queueId: m.queueId,
        workspaceId: m.ws,
        request,
        taskId: null,
        lineageId: null,
        attempts: 1,
        isResume: false,
        heldUntil: null,
        enqueuedAt: new Date(q.created_at).toISOString(),
      };
      const missionOutcome = await runner.run(queued, {
        executionBudgetMs: 150000,
        signal: new AbortController().signal,
      });
      trace.outcome = missionOutcome;
      const release = await releaseQueuedMission((fn, args) => client.rpc(fn, args), {
        queueId: m.queueId, workerId: m.workerId, attempts: claims[0].attempts,
        outcome: missionOutcome, outcomeDoc: { ...missionOutcome },
      });
      assertEquals(release.released, true, JSON.stringify(release));
      trace.release = release;
      if (isTerminalQueueStatus(release.finalStatus)) {
        await reconcileTerminalRows({
          readTask: async (id) => {
            const { data, error } = await client.from("tasks").select("status,result").eq("id", id).maybeSingle();
            assertEquals(error, null); return data;
          },
          readLineage: async (id) => {
            const { data, error } = await client.from("lead_lineages").select("status").eq("lineage_id", id).maybeSingle();
            assertEquals(error, null); return data;
          },
          readPlan: async (id) => {
            const { data, error } = await client.from("task_plans").select("status").eq("id", id).maybeSingle();
            assertEquals(error, null); return data;
          },
          writeTask: async (id, patch) => { const { error } = await client.from("tasks").update(patch).eq("id", id); assertEquals(error, null); },
          writeLineage: async (id, patch) => { const { error } = await client.from("lead_lineages").update(patch).eq("lineage_id", id); assertEquals(error, null); },
          writePlan: async (id, patch) => { const { error } = await client.from("task_plans").update(patch).eq("id", id); assertEquals(error, null); },
        }, release.finalStatus, release.terminalReason ?? release.finalStatus, {
          taskId: trace.task_id ?? null, lineageId: trace.task_id ?? null, planId: plan,
        }, new Date().toISOString());
      }
      trace.queue = await sql`select status,attempts,claimed_by,lease_expires_at from public.lead_mission_queue where id=${m.queueId}`;
      assert(trace.task_id, "the worker bound the task it actually executed");
      trace.lineage = await sql`select status,terminal_reason,lease_holder from public.lead_lineages where lineage_id=${trace.task_id}`;
      trace.plan = await sql`select status from public.task_plans where id=${plan}`;
      trace.messages = await sql`select role,content,metadata from public.messages where conversation_id=${conversation} order by created_at`;
      trace.accounts = await sql`select id,name,domain,linkedin_url,location,employee_count from public.accounts where workspace_id=${m.ws}`;
      trace.brain = await sql`select count(*)::int as rows from public.company_brain where workspace_id=${m.ws}`;
      const operations =
        await sql`select kind, actor, committed_microusd, reported_microusd, report_source, provider_run_id from public.discovery_smoke_operations where authorization_id = ${m.authorizationId} order by admitted_at`;
      trace.operations = operations;
      trace.unreconciled_purchases = await unreconciled(m.queueId);
      trace.tasks =
        await sql`select id,status,result from public.tasks where workspace_id = ${m.ws}`;
      const dashboard = await client.from("lead_candidates").select("*").eq(
        "workspace_id",
        m.ws,
      );
      trace.dashboard = dashboard;
      const credits =
        await sql`select * from public.credit_transactions where workspace_id = ${m.ws}`;
      trace.credits = credits;
      trace.model_ledger =
        await sql`select model, estimated_cost_usd, actual_cost_usd, cost_source from public.lead_model_calls where workspace_id = ${m.ws}`;
      trace.authorization =
        await sql`select status, total_microusd, provider_microusd, model_microusd, provider_purchases, model_attempts, provider_polls, deadline_at from public.discovery_smoke_authorizations where id = ${m.authorizationId}`;
      const of = (k: string) => operations.filter((o) => o.kind === k);
      const sentByGate = trace.admissions.filter((a) => a.message === "[smoke-admission] sent").length;
      const refused = trace.admissions.filter((a) => a.message === "[smoke-admission] refused")
        .map((a) => (a.data as { decision: string }).decision);
      trace.candidates = (dashboard.data ?? []).map((c: Record<string, unknown>) => ({
        company_name: c.company_name, status: c.status, qualification_status: c.qualification_status,
      }));
      await check({ trace, operations, dashboard, credits, compiledOffline, sentByGate, refused, of, m, runner, queued, client });
    } catch (e) {
      trace.errors.push(String(e));
      throw e;
    } finally {
      trace.elapsed_ms = Date.now() - started;
      console.log("OFFLINE_SMOKE_TRACE", JSON.stringify(trace));
      const output = Deno.env.get("OFFLINE_SMOKE_TRACE_PATH");
      if (output) {
        await Deno.writeTextFile(`${output}.${v.label}.json`, JSON.stringify(trace, null, 2) + "\n");
      }
      globalThis.fetch = originalFetch;
      for (const [k, v] of saved) {
        if (v === undefined) Deno.env.delete(k);
        else Deno.env.set(k, v);
      }
    }
  }
}

/** Every variant: the limits hold and nothing the gate refused reached a vendor. */
function limitsHeld(r: Rehearsal) {
  const { trace, operations, of } = r;
  assertEquals(trace.requests.length - r.compiledOffline, r.sentByGate, "only admitted requests are sent");
  assert(of("model").length <= 4, "four model attempts");
  assert(of("model").reduce((a: number, o: Rehearsal) => a + Number(o.committed_microusd), 0) <= 50000, "$0.05 model");
  assert(of("provider").length <= 5, "five purchases");
  assert(of("poll").length <= 5, "five reads");
  assert(operations.reduce((a: number, o: Rehearsal) => a + Number(o.committed_microusd), 0) <= 250000, "$0.25 total");
  for (const q of trace.requests) {
    if (q.url.includes("api.openai.com")) assert(q.bytes <= PLANNER_BOUND, `model request ${q.bytes} bytes was sent`);
    if (q.method === "POST" && q.url.includes("api.apify.com")) {
      assert(/maxTotalChargeUsd=0\.00[0-5]\d*(&|$)/.test(q.url), `vendor cap on ${q.url}`);
    }
  }
  assert(!r.refused.includes("stale_generation"), JSON.stringify(r.refused));
  // One purchase per actor, never repeated.
  const actors = of("provider").map((o: Rehearsal) => o.actor);
  assertEquals(actors.length, new Set(actors).size, "no duplicate paid purchase");
}

const opts = { sanitizeOps: false, sanitizeResources: false };
const SKIPPED_STAGES = ["research_route_control", "discovery_actor_strategy", "You triage companies", "You compare prospect companies"];
const stageRan = (r: Rehearsal, prefix: string) => (r.trace.model_stages as string[]).some((s) => s.startsWith(prefix.slice(0, 40)));
const taskJson = (r: Rehearsal) => JSON.stringify(r.trace.tasks);
/** The Luna template's byte bound, read from the proposed catalog (30,720 since input is priced at the cache-write rate). */
const PLANNER_BOUND: number = PROPOSAL.approved_quotes.luna.request_limits.max_request_bytes;
// The full mission's planner request, with no Company Brain configured. The
// smoke's test workspace has none (runbook, Phase 2), so for the reviewed
// kickoff this request is fixed; a Brain would add bytes and must be measured.
// The smaller unit mission keeps 2 KiB (smokePlannerRequestSize.test.ts).
const PLANNER_MARGIN = 1024;
const reconciliation = Deno.readTextFileSync(new URL("../../scripts/test-project/smoke-reconciliation.sql", import.meta.url));
const unreconciled = (queueId: string) => sql.unsafe(reconciliation.replace(":'queue_id'", `'${queueId}'`));

/** Minimal orchestration: the real planner once, the real evaluators; the skipped stages never call a model. */
function minimalShape(r: Rehearsal) {
  for (const s of SKIPPED_STAGES) assert(!stageRan(r, s), `${s} ran under the minimal orchestration`);
  assertEquals((r.trace.model_stages as string[]).filter((s) => s === "lead_execution_plan").length, 1, "the real planner, once");
  assert(stageRan(r, "You assess several companies") && stageRan(r, "Decide whether this company satisfies"),
    "qualification uses the real evaluators");
  // No terminal receipt re-reads: every Apify read is one of the runs' own.
  const apifyReads = r.trace.requests.filter((q: Rehearsal) => q.method === "GET" && q.url.includes("api.apify.com")).length;
  assertEquals(apifyReads, r.of("poll").length);
  // The planner fits the template with margin.
  const plan = r.trace.attempted_requests.find((q: Rehearsal) =>
    (q.body as Rehearsal)?.response_format?.json_schema?.name === "lead_execution_plan");
  r.trace.planner_bytes = plan.bytes;
  assert(plan.bytes <= PLANNER_BOUND - PLANNER_MARGIN, `planner ${plan.bytes} bytes: margin ${PLANNER_BOUND - plan.bytes} < ${PLANNER_MARGIN}`);
}

const compiledEvents = (r: Rehearsal) =>
  ((r.trace.stages as Rehearsal[])[0].mission.required_signals as Rehearsal[]).map((x) => x.event);

Deno.test("offline smoke, two actors: one evidence-backed lead is qualified and persisted within every limit", opts, () =>
  rehearse({ orchestration: "minimal", companyDetails: true, label: "two-actor" }, async (r) => {
    limitsHeld(r);
    minimalShape(r);
    assertEquals(compiledEvents(r), ["hiring"], "the request asks for one opening, nothing social");
    // ── MODEL: four attempts, each reserved at the template's maximum ──
    assertEquals(r.of("model").length, 4, "plan, batch evaluation, mission evaluation, opportunity reasoning");
    const luna = PROPOSAL.approved_quotes.luna.maximum_microusd;
    assertEquals(r.of("model").map((o: Rehearsal) => Number(o.committed_microusd)), [luna, luna, luna, luna]);
    assert(4 * luna <= 50_000, "four attempts at the template maximum fit the $0.05 model allocation");
    assertEquals((r.trace.model_stages as string[]).slice(1),
      ["lead_execution_plan", "You assess several companies in one requ", "Decide whether this company satisfies th", "opportunity_reasoning"]);
    // ── PROVIDERS: two purchases, vendor-capped, one settled and one deferred ──
    const [jobs, details] = r.of("provider");
    assertEquals([jobs.actor, details.actor], [JOBS, DETAILS]);
    assertEquals([jobs.committed_microusd, jobs.reported_microusd, jobs.report_source], ["5000", "2000", "apify_run(settled).receipt"]);
    assertEquals([details.committed_microusd, details.reported_microusd, details.report_source],
      [String(SYNTHETIC_DETAILS_MAXIMUM), "4000", "apify_run(status).receipt"], "held at its maximum; the preliminary figure is labelled");
    const posts = r.trace.requests.filter((q: Rehearsal) => q.method === "POST" && q.url.includes("api.apify.com"));
    assertEquals(posts.map((q: Rehearsal) => new URL(q.url).searchParams.get("maxTotalChargeUsd")), ["0.005", "0.005"]);
    assertEquals(posts[1].body, { companies: ["https://www.linkedin.com/company/offline-software"] }, "one company, bounded");
    // ── READS: exactly five, 3 + 2 ──
    const reads = r.trace.requests.filter((q: Rehearsal) => q.method === "GET" && q.url.includes("api.apify.com"))
      .map((q: Rehearsal) => new URL(q.url).pathname.replace(/^\/v2\//, "") + (new URL(q.url).searchParams.has("waitForFinish") ? " (long poll)" : ""));
    assertEquals(reads, [
      "actor-runs/run-jobs (long poll)", "actor-runs/run-jobs", "datasets/dataset-jobs/items",
      "actor-runs/run-details (long poll)", "datasets/dataset-details/items",
    ]);
    // ── MONEY ──
    const sum = (k: string) => r.of(k).reduce((a: number, o: Rehearsal) => a + Number(o.committed_microusd), 0);
    assertEquals([sum("model"), sum("provider"), sum("model") + sum("provider")], [4 * luna, 10000, 4 * luna + 10000]);
    // ── THE LEAD ──
    assertEquals(r.dashboard.error, null);
    assertEquals(r.dashboard.data?.length, 1, "one lead persisted");
    // The caller and panel must describe the same canonical company outcome
    // that the task row and real worker already read.
    assertEquals(r.trace.handler.body.success, true, "persisted qualified company must not be reported as failed");
    assertEquals(r.trace.handler.body.terminal_status, r.trace.outcome.status);
    assertEquals(r.trace.handler.body.eligible_leads, 1);
    assertEquals(r.trace.handler.body.remaining_leads, 0);
    assertEquals(r.trace.handler.body.count_entity, "qualified_company");
    assertEquals(r.trace.handler.body.counts.persisted, 1);
    assertEquals(r.trace.handler.body.ui_panel.lead_count, 1);
    assertEquals(r.trace.handler.body.ui_panel.lead_candidate_ids, [r.dashboard.data[0].id]);
    assertEquals(r.trace.handler.body.run_context.eligible_leads, 1);
    const raw = r.dashboard.data[0].raw as Rehearsal;
    assertEquals(raw.qualification_basis, "p5_canonical_eligibility");
    assertEquals(raw.canonical_decision.qualified, true);
    assertEquals(raw.canonical_decision.hard_checks, { hiring: "pass", industry: "pass", geography: "pass", company_size: "pass" });
    assertEquals(raw.company_resolution_status, "verified");
    assertEquals(raw.job_evidence.url, "https://www.linkedin.com/jobs/view/offline-ae");
    assertEquals(r.credits.filter((c: Rehearsal) => c.status === "charged").length, 2, "one credit per purchase, none refunded");
    // ── THE DEFERRED RECEIPT IS LIABILITY UNTIL A PERSON CLOSES IT ──
    // Both purchases wait for a person; only the company details needs its figure looked up.
    assertEquals((await unreconciled(r.m.queueId)).map((o) => [o.actor, o.receipt]),
      [[JOBS, "settled"], [DETAILS, "unsettled"]]);
    const next = await seedSmokeMission({ authorize: false });
    await assertRejects(() => authorizeSmoke(next.queueId, { keepPriorLiability: true }), Error, "unreconciled");
    // ── RECOVERY CONTROLS (Codex's harness): no restart renews the mission; a stop is final ──
    const expired = await r.runner.run({ ...r.queued, enqueuedAt: new Date(Date.now() - 300_001).toISOString() },
      { executionBudgetMs: 150000, signal: new AbortController().signal });
    assertEquals(expired.error, "mission_deadline_expired");
    const before = r.trace.requests.length;
    await sql`select public.stop_discovery_smoke(${r.m.queueId}, 'offline operator stop')`;
    const refused = await missionAdmission.run({ queueId: r.m.queueId, workerId: r.m.workerId, taskId: r.m.taskId, generation: r.m.generation },
      () => globalThis.fetch("https://api.openai.com/v1/chat/completions", { method: "POST",
        body: JSON.stringify({ model: "gpt-5.6-luna", messages: [{ role: "user", content: "post-stop" }], max_completion_tokens: 16 }) }));
    assertEquals(refused.status, 409);
    await refused.body?.cancel();
    assertEquals(r.trace.requests.length, before, "nothing is sent after the stop");
    r.trace.verdict = "PASS: 1 qualified, 1 persisted";
  }));

Deno.test("offline smoke, two actors, SLOW job search: the 3 + 2 allocation holds and the lead is still persisted", opts, () =>
  rehearse({ orchestration: "minimal", companyDetails: true, slowJobSearch: true, label: "two-actor-slow" }, async (r) => {
    limitsHeld(r);
    minimalShape(r);
    const reads = r.trace.requests.filter((q: Rehearsal) => q.method === "GET" && q.url.includes("api.apify.com"))
      .map((q: Rehearsal) => new URL(q.url).pathname.replace(/^\/v2\//, "") + (new URL(q.url).searchParams.has("waitForFinish") ? " (long poll)" : ""));
    assertEquals(reads, [
      "actor-runs/run-jobs (long poll)", "actor-runs/run-jobs (long poll)", "datasets/dataset-jobs/items",
      "actor-runs/run-details (long poll)", "datasets/dataset-details/items",
    ], "job search: its three; company details: its two");
    const [jobs, details] = r.of("provider");
    assertEquals([jobs.committed_microusd, jobs.report_source], ["5000", "apify_run(status).receipt"],
      "the job search's receipt is the one deferred: held at its maximum, never called settled");
    assertEquals([details.committed_microusd, details.report_source], [String(SYNTHETIC_DETAILS_MAXIMUM), "apify_run(status).receipt"]);
    assertEquals((await unreconciled(r.m.queueId)).map((o) => [o.actor, o.receipt]), [[JOBS, "unsettled"], [DETAILS, "unsettled"]]);
    assertEquals(r.of("model").length, 4);
    assertEquals(r.dashboard.data?.length, 1, "one lead persisted");
    assertEquals((r.dashboard.data[0].raw as Rehearsal).canonical_decision.hard_checks,
      { hiring: "pass", industry: "pass", geography: "pass", company_size: "pass" });
    r.trace.verdict = "PASS (slow job search): 1 qualified, 1 persisted";
  }));

Deno.test("offline smoke, negative control: a description naming no buyer is not qualified, whatever the evaluator says", opts, () =>
  rehearse({ orchestration: "minimal", companyDetails: true, weakEvidence: true, label: "weak-evidence" }, (r) => {
    limitsHeld(r);
    minimalShape(r);
    assert(taskJson(r).includes("does not state business customer"), "the business-model rule refuses the quote");
    assertEquals(r.dashboard.data?.length, 0, "nothing persisted");
  }));

Deno.test("offline smoke, approved one-actor catalog: held without the company record, never passed", opts, () =>
  rehearse({ orchestration: "minimal", label: "one-actor" }, (r) => {
    limitsHeld(r);
    minimalShape(r);
    assertEquals(r.of("model").length, 3, "plan, batch evaluation, mission evaluation");
    assertEquals(r.of("provider").length, 1);
    assertEquals(r.of("poll").length, 3, "status, settled receipt, dataset");
    assert(r.refused.includes("unknown_quote"), "company details is outside the one-actor catalog");
    assert(/"enrichment_outcome": ?"provider_error"/.test(taskJson(r)), "held: no company record");
    assertEquals(r.dashboard.data?.length, 0);
  }));

Deno.test("offline smoke, customer orchestration: the stages the smoke skips still run outside it", opts, () =>
  rehearse({ label: "customer" }, (r) => {
    limitsHeld(r);
    assert(stageRan(r, "research_route_control") && stageRan(r, "You triage companies"),
      JSON.stringify(r.trace.model_stages));
  }));

// ── A7 OFFLINE SUCCESS AND FAILURE PATHS ────────────────────────────────────
// The same rehearsal, with the vendor answering differently. Each asserts the
// limits, what was bought, what was persisted, and what a person must close.

/** What a run left behind, for the trace and for a failing assertion's message. */
function outcome(r: Rehearsal) {
  const o = {
    provider: r.of("provider").map((x: Rehearsal) => [x.actor, x.committed_microusd, x.provider_run_id ?? null, x.report_source ?? null]),
    polls: r.of("poll").length,
    models: r.of("model").length,
    leads: (r.dashboard.data ?? []).map((c: Rehearsal) => [c.raw?.company_name ?? null, c.raw?.canonical_decision?.qualified ?? null]),
    // Credit per purchase, by capability: `<task>:<actor key>:v2:<hash>` -> status.
    credits: Object.fromEntries(r.credits.map((c: Rehearsal) => [String(c.idempotency_key).split(":")[1], c.status])),
    // Why each provider attempt ended, as the run records it for the operator.
    attempts: ((r.trace.tasks as Rehearsal[]).map((t) => t.result).find((x) => x?.capability_execution_state)
      ?.capability_execution_state?.provider_attempts ?? []).map((a: Rehearsal) => a.reason ?? a.outcome ?? null),
    refused: r.refused,
    task: (r.trace.tasks as Rehearsal[]).map((t) => [t.status, t.result?.terminal_status ?? t.result?.status ?? null]),
  };
  r.trace.a7_outcome = o;
  return o;
}
/** A refused start: a purchase admitted at its maximum, no run, closed only as NO_RUN at zero. */
async function refusedStartCloses(r: Rehearsal, actor: string) {
  const open = (await unreconciled(r.m.queueId)).filter((o) => o.actor === actor);
  assertEquals(open.length, 1, `the refused ${actor} start is listed for a person`);
  assertEquals(open[0].provider_run_id, null, "no run id: Apify created no run");
  await sql`select public.stop_discovery_smoke(${r.m.queueId}, 'offline: closing a refused start')`;
  const key = r.of("provider").find((x: Rehearsal) => x.actor === actor) && (await sql`
    select operation_key from public.discovery_smoke_operations
     where authorization_id = ${r.m.authorizationId} and kind = 'provider' and actor = ${actor}`)[0].operation_key;
  await sql`select public.reconcile_discovery_smoke_operation(${r.m.queueId}, ${key}, 0, 'apify run history: none (offline)', 'NO_RUN')`;
  assertEquals((await unreconciled(r.m.queueId)).filter((o) => o.actor === actor).length, 0, "NO_RUN at zero closes it");
}

Deno.test("A7 offline: three postings, one employer twice — one company lookup, one lead, no duplicate", opts, () =>
  rehearse({ orchestration: "minimal", companyDetails: true, duplicateEmployer: true, label: "a7-dedupe" }, (r) => {
    limitsHeld(r);
    minimalShape(r);
    const o = outcome(r);
    const details = r.trace.requests.filter((q: Rehearsal) => q.method === "POST" && q.url.includes("linkedin-company"));
    assertEquals(details.length, 1, `one company-details purchase: ${JSON.stringify(o)}`);
    assertEquals(details[0].body, { companies: ["https://www.linkedin.com/company/offline-software"] },
      "the in-band US employer is the one looked up, not the excluded one");
    assertEquals(o.leads, [["Example Software", true]], `one lead, the qualifying employer, once: ${JSON.stringify(o)}`);
    assertEquals(o.credits, { apify_linkedin_job_search: "charged", apify_linkedin_company_details: "charged" });
  }));

for (const status of [403, 402]) {
  Deno.test(`A7 offline: Apify refuses the job search (${status}) — nothing else is bought, nothing persisted, a person closes it at zero`, opts, () =>
    rehearse({ orchestration: "minimal", companyDetails: true, jobsStartStatus: status, label: `a7-jobs-${status}` }, async (r) => {
      limitsHeld(r);
      const o = outcome(r);
      assertEquals(o.provider.length, 1, `only the refused job search was admitted: ${JSON.stringify(o)}`);
      assertEquals(o.provider[0][0], JOBS);
      assertEquals(o.polls, 0, "no run, so nothing is read");
      assertEquals(o.leads, [], "nothing persisted");
      assertEquals(o.models, 1, "only the execution plan: nothing to evaluate");
      assertEquals(o.credits, { apify_linkedin_job_search: "not_charged" }, "a refused start costs the workspace no credit");
      assertEquals(o.attempts, [`Error: ${status === 403 ? "apify_unauthorized" : "apify_insufficient_credits"}`],
        "the run records why the vendor refused");
      await refusedStartCloses(r, JOBS);
    }));
}

Deno.test("A7 offline: Apify refuses the company details (403) — the posting alone never qualifies", opts, () =>
  rehearse({ orchestration: "minimal", companyDetails: true, detailsStartStatus: 403, label: "a7-details-403" }, async (r) => {
    limitsHeld(r);
    const o = outcome(r);
    assertEquals(o.provider.map((p: unknown[]) => p[0]), [JOBS, DETAILS], JSON.stringify(o));
    assertEquals(o.leads.filter((l: unknown[]) => l[1] === true), [], `no qualified lead without the company record: ${JSON.stringify(o)}`);
    assertEquals(o.credits, { apify_linkedin_job_search: "charged", apify_linkedin_company_details: "not_charged" });
    assert(/"enrichment_outcome": ?"provider_error"/.test(taskJson(r)), "held: the company record was refused");
    await refusedStartCloses(r, DETAILS);
  }));

Deno.test("A7 offline: the job search finds nothing — no company lookup, nothing persisted", opts, () =>
  rehearse({ orchestration: "minimal", companyDetails: true, jobsEmpty: true, label: "a7-jobs-empty" }, (r) => {
    limitsHeld(r);
    const o = outcome(r);
    assertEquals(o.provider.map((p: unknown[]) => p[0]), [JOBS], `nothing to look up: ${JSON.stringify(o)}`);
    assertEquals(o.leads, []);
    assertEquals(o.models, 1, "nothing to evaluate");
    assertEquals(o.attempts, ["empty"], "recorded as an empty search, not a failure");
    assertEquals(o.credits, { apify_linkedin_job_search: "charged" }, "the run did happen");
  }));

Deno.test("A7 offline: the company record lacks its size band and description — not qualified", opts, () =>
  rehearse({ orchestration: "minimal", companyDetails: true, detailsIncomplete: true, label: "a7-details-incomplete" }, (r) => {
    limitsHeld(r);
    const o = outcome(r);
    assertEquals(o.provider.map((p: unknown[]) => p[0]), [JOBS, DETAILS], JSON.stringify(o));
    assertEquals(o.leads.filter((l: unknown[]) => l[1] === true), [], `missing evidence never qualifies: ${JSON.stringify(o)}`);
    assertEquals(o.credits, { apify_linkedin_job_search: "charged", apify_linkedin_company_details: "charged" });
  }));

const HQ_AUDIT_GOAL = "Find 1 US-headquartered B2B software company with a declared 11–50 employee band and an open Account Executive posting dated within 30 days.";
function auditLifecycle(r: Rehearsal, qualified: number) {
  limitsHeld(r);
  assertEquals(r.trace.unreconciled_purchases.length, 2,
    "terminal execution does not close either provider purchase without administrator reconciliation");
  assertEquals(r.trace.queue[0].status, "complete", "execution ended even when the requested quota was not met");
  assertEquals(r.trace.queue[0].claimed_by, null);
  assertEquals(r.trace.queue[0].lease_expires_at, null);
  assertEquals(r.trace.lineage[0].status, "terminal");
  assertEquals(r.trace.lineage[0].lease_holder, null);
  assertEquals(r.trace.plan[0].status, qualified ? "complete" : "partial");
  assertEquals(r.dashboard.data.length, qualified);
  assertEquals(r.trace.handler.body.eligible_leads, qualified);
  assertEquals(r.trace.handler.body.ui_panel.lead_count, qualified);
  assertEquals(r.trace.handler.body.counts.persisted, qualified);
  assertEquals(r.trace.handler.body.count_entity, "qualified_company");
  assertEquals(r.trace.handler.body.success, qualified > 0);
  assertEquals(r.trace.handler.body.terminal_status, r.trace.outcome.status);
  assertEquals(r.trace.brain[0].rows, 0, "the no-Brain smoke never creates Company Brain content");
  const notices = r.trace.messages.filter((m: Rehearsal) => m.metadata.ui_panel);
  assertEquals(notices.length, 1, "one persistent final result, not just a worker exit");
  assertEquals(notices[0].metadata.ui_panel.lead_count, qualified);
  assert(notices[0].content.includes(`${qualified} of 1 qualified company`));
}

Deno.test("A7 output audit: three postings, verified US headquarters, one fully persisted answer", opts, () =>
  rehearse({ orchestration: "minimal", companyDetails: true, slowJobSearch: true, duplicateEmployer: true,
    goal: HQ_AUDIT_GOAL, auditCompany: "us_hq", label: "a7-output-valid" }, (r) => {
    auditLifecycle(r, 1);
    const lead = r.dashboard.data[0];
    assertEquals(lead.raw.company_name, "Example Software");
    assertEquals(lead.raw.company_linkedin_url, "https://www.linkedin.com/company/offline-software");
    assertEquals(r.trace.accounts[0].linkedin_url, "https://www.linkedin.com/company/offline-software");
    assertEquals(lead.raw.job_evidence.title, "Account Executive");
    assertEquals(lead.raw.job_evidence.url, "https://www.linkedin.com/jobs/view/offline-ae");
    const age = Date.now() - Date.parse(lead.raw.job_evidence.posted);
    assert(age >= 0 && age <= 30 * 86400_000);
    const task = r.trace.tasks.find((t: Rehearsal) => t.id === r.trace.task_id);
    const facts = task.result.research_fabric.companies[0].evidence.dimensions;
    assertEquals(facts.find((f: Rehearsal) => f.dimension === "company_size_band").value,
      { min: 11, max: 50, source: "linkedin_declared" });
    assertEquals(facts.find((f: Rehearsal) => f.dimension === "geography").value, "Boston, United States");
    assert(task.result.workbench_grounded_explanations[0].why_it_matched.length > 0);
    assertEquals(r.trace.handler.body.ui_panel.lead_candidate_ids, [lead.id]);
    assertEquals(r.trace.handler.body.provider_calls, 2);
  }));

Deno.test("A7 output audit: a Canadian headquarters with a US office produces zero qualified companies", opts, () =>
  rehearse({ orchestration: "minimal", companyDetails: true, slowJobSearch: true,
    goal: HQ_AUDIT_GOAL, auditCompany: "foreign_hq", label: "a7-output-none" }, (r) => {
    auditLifecycle(r, 0);
    const task = r.trace.tasks.find((t: Rehearsal) => t.id === r.trace.task_id);
    assertEquals(task.result.task_status, "partial");
    assert(r.trace.messages.some((m: Rehearsal) => m.content.includes("0 qualified")));
  }));

Deno.test("A7 output audit: a future-dated posting cannot prove hiring within the last 30 days", opts, () =>
  rehearse({ orchestration: "minimal", companyDetails: true, slowJobSearch: true,
    goal: HQ_AUDIT_GOAL, auditCompany: "us_hq", auditJobDate: "future", label: "a7-output-future" }, (r) => {
    auditLifecycle(r, 0);
  }));

// Explicit diagnostics for known missing contracts, excluded from ordinary CI
// rather than recording a false-positive qualification as a passing test. Run
// with A7_AUDIT_KNOWN_GAPS=1 and --filter 'A7 known gap' to reproduce the blocks.
if (Deno.env.get("A7_AUDIT_KNOWN_GAPS") === "1") {
  for (const [kind, label] of [["no_hq", "headquarters evidence is missing"],
    ["missing_description", "company-record description is missing"]] as const) {
    Deno.test(`A7 known gap: ${label} must not be silently verified`, opts, () =>
      rehearse({ orchestration: "minimal", companyDetails: true, slowJobSearch: true,
        goal: HQ_AUDIT_GOAL, auditCompany: kind, label: `a7-gap-${kind}` }, (r) => {
        limitsHeld(r);
        assertEquals(r.dashboard.data.length, 0, `${label}: source gaps must remain gaps`);
      }));
  }
}
