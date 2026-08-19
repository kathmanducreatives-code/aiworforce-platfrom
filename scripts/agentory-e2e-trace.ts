// REAL GPT, END TO END, WITH RECORDED ACTOR ROWS.
//
// Every DECISION in this run is made by a live OpenAI call against the real
// prompts, the real schemas and the real catalog:
//
//   mission compilation          gptMissionModel
//   execution plan (the chain)   gptExecutionPlanner
//   discovery actor selection    gptDiscoveryPlanner
//   plan amendment after pool    gptExecutionPlanner (results-aware)
//
// Every ACTOR call is served from recorded rows. The Apify token lives only in
// the Supabase edge-function environment, so a fully-live run needs either that
// token or a deploy — and this repo is explicitly not deploying yet.
//
// The rows below are REAL data, copied from the audited production run on
// 2026-08-15 (task 9e9f4346, actor memo23/y-combinator-scraper). They are not
// invented to make the run succeed.
//
//   deno run --allow-read --allow-env --allow-net scripts/agentory-e2e-trace.ts

import { compileLeadMission } from "../supabase/functions/_shared/leadMissionCompiler.ts";
import { buildMissionCompilerPayload } from "../supabase/functions/_shared/leadMissionCompiler.ts";
import { createGptMissionGenerateJson } from "../supabase/functions/_shared/gptMissionModel.ts";
import { buildCapabilityGraph } from "../supabase/functions/_shared/leadCapabilityGraph.ts";
import { runCapabilityPlan } from "../supabase/functions/_shared/leadCapabilityEngine.ts";
import { makeGptExecutionPlanner } from "../supabase/functions/_shared/gptExecutionPlanner.ts";
import { makeGptDiscoveryPlanner } from "../supabase/functions/_shared/gptDiscoveryPlanner.ts";
import { ModelRoutingLedger } from "../supabase/functions/_shared/gptModelRouter.ts";
import { buildLeadRunTrace, describeLeadRunTrace } from "../supabase/functions/_shared/leadRunTrace.ts";
import { DiscoveryStrategyBlockedError } from "../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import { ExecutionPlanBlockedError } from "../supabase/functions/_shared/leadExecutionPlan.ts";
import { buildMissionEvaluationBinding } from "../supabase/functions/_shared/missionEvaluationBinding.ts";
import { buildMissionTriageBinding } from "../supabase/functions/_shared/missionTriageBinding.ts";
import { parseMissionEvaluationStrict } from "../supabase/functions/_shared/missionEvaluation.ts";
import { hiringActorCard } from "../supabase/functions/_shared/hiringActorCatalog.ts";
import type { CompiledActorCall } from "../supabase/functions/_shared/hiringActorInputs.ts";

// ── LIVE APIFY, WHEN A TOKEN IS PRESENT ─────────────────────────────────────
//
// A direct, minimal client: start the run, poll it, read the dataset. It is
// deliberately not `runTool` — that carries Supabase persistence, idempotency
// ledgers and task rows this script has no business writing. What it must be
// faithful about is the ACTOR and the INPUT, and both are exactly what the
// engine compiled.
const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN") ?? "";
const LIVE = APIFY_TOKEN.length > 0;
/** Hard ceiling on paid runs, whatever the plan asks for. */
const MAX_LIVE_RUNS = 12;
let liveRuns = 0;

async function runApifyActor(
  actorKey: string, input: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const card = hiringActorCard(actorKey);
  if (!card) throw new Error(`no catalog card for ${actorKey}`);
  if (++liveRuns > MAX_LIVE_RUNS) {
    throw new Error(`live-run ceiling of ${MAX_LIVE_RUNS} reached — refusing to spend more`);
  }
  const path = card.actor_id.replace("/", "~");
  const base = "https://api.apify.com/v2";

  const started = await fetch(`${base}/acts/${path}/runs?token=${APIFY_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!started.ok) {
    throw new Error(`Apify start ${started.status}: ${(await started.text()).slice(0, 300)}`);
  }
  const runId = (await started.json()).data?.id as string;

  // Poll. Bounded, because an actor that never finishes must not hang the trace.
  const deadline = Date.now() + 180_000;
  let datasetId = "";
  for (;;) {
    if (Date.now() > deadline) throw new Error(`Apify run ${runId} did not finish in 180s`);
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(`${base}/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const d = (await poll.json()).data ?? {};
    if (d.status === "SUCCEEDED") { datasetId = d.defaultDatasetId; break; }
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(d.status)) {
      throw new Error(`Apify run ${runId} ended ${d.status}`);
    }
  }
  const items = await fetch(
    `${base}/datasets/${datasetId}/items?clean=true&limit=100&token=${APIFY_TOKEN}`);
  return await items.json() as Record<string, unknown>[];
}

const QUERY =
  "Find 2 qualified AI/startup companies in the US that are currently hiring, " +
  "then find the relevant founder/contact.";

const REQUESTED = 2;

// ── RECORDED ROWS ───────────────────────────────────────────────────────────
// From the 2026-08-15 production dataset. Team sizes, batches, tags and open-job
// counts are as observed.
const YC_ROWS: Record<string, unknown>[] = [
  { id: "retell-ai", name: "Retell AI", slug: "retell-ai", batch: "Winter 2024",
    teamSize: 50, industry: "B2B", subindustry: "B2B -> Engineering, Product and Design",
    tags: ["Artificial Intelligence", "AI"], oneLiner: "Conversational voice AI agents for enterprises.",
    website: "https://retellai.com", url: "https://www.ycombinator.com/companies/retell-ai",
    regions: ["United States of America"], allLocations: ["San Francisco, CA"],
    isHiring: true, nonprofit: false, topCompany: false, stage: "Early",
    openJobs: [
      { title: "Software Engineer", role: "engineering", location: "San Francisco, CA" },
      { title: "Founding Engineer", role: "engineering", location: "San Francisco, CA" },
    ] },
  { id: "afterquery", name: "AfterQuery", slug: "afterquery", batch: "Winter 2025",
    teamSize: 30, industry: "B2B", subindustry: "B2B -> Engineering, Product and Design",
    tags: ["Artificial Intelligence", "B2B", "Data Labeling", "AI"],
    oneLiner: "Frontier data for AI research labs.",
    website: "https://afterquery.com", url: "https://www.ycombinator.com/companies/afterquery",
    regions: ["United States of America"], allLocations: ["San Francisco, CA"],
    isHiring: true, nonprofit: false, topCompany: false, stage: "Early",
    openJobs: [
      { title: "Senior Software Engineer, Infrastructure & Platform", role: "engineering",
        location: "San Francisco, CA" },
    ] },
  { id: "agentmail", name: "AgentMail", slug: "agentmail", batch: "Summer 2025",
    teamSize: 10, industry: "B2B", subindustry: "B2B -> Infrastructure",
    tags: ["Developer Tools", "API", "Email"],
    oneLiner: "Email infrastructure for AI agents.",
    website: "https://agentmail.to", url: "https://www.ycombinator.com/companies/agentmail",
    regions: ["United States of America"], allLocations: ["San Francisco, CA"],
    isHiring: true, nonprofit: false, topCompany: false, stage: "Early",
    openJobs: [{ title: "Agent Experience Engineer", role: "engineering", location: "SF" }] },
  { id: "ctgt", name: "CTGT", slug: "ctgt", batch: "Fall 2024",
    teamSize: 10, industry: "B2B", tags: ["B2B", "Enterprise", "AI"],
    oneLiner: "Making AI models trustworthy for the enterprise.",
    website: "https://ctgt.ai", url: "https://www.ycombinator.com/companies/ctgt",
    regions: ["United States of America"], allLocations: ["San Diego, CA"],
    isHiring: true, nonprofit: false, topCompany: false, stage: "Early",
    openJobs: [{ title: "Software Engineer", role: "engineering", location: "San Diego, CA" }] },
  { id: "f2", name: "F2", slug: "f2", batch: "Summer 2025",
    teamSize: 15, industry: "B2B", tags: ["AI"],
    oneLiner: "AI-native financial operations.",
    website: "https://f2.ai", url: "https://www.ycombinator.com/companies/f2",
    regions: ["United States of America"], allLocations: ["New York, NY"],
    isHiring: true, nonprofit: false, topCompany: false, stage: "Early",
    openJobs: [{ title: "Staff Software Engineer, Frontend", role: "engineering",
      location: "New York, NY" }] },
];

const LINKEDIN_SEARCH: Record<string, Record<string, unknown>[]> = {
  "Retell AI": [{ id: "retellai", name: "Retell AI", universalName: "retell-ai",
    linkedinUrl: "https://www.linkedin.com/company/retell-ai",
    website: "https://retellai.com", description: "Conversational voice AI agents." }],
  AfterQuery: [{ id: "afterquery", name: "AfterQuery", universalName: "afterquery",
    linkedinUrl: "https://www.linkedin.com/company/afterquery",
    website: "https://afterquery.com", description: "Frontier data for AI labs." }],
  AgentMail: [{ id: "agentmailto", name: "AgentMail (YC S25)", universalName: "agentmailto",
    linkedinUrl: "https://www.linkedin.com/company/agentmailto",
    website: "https://agentmail.to", description: "Email infrastructure for AI agents." }],
  CTGT: [{ id: "ctgt", name: "CTGT", universalName: "ctgt",
    linkedinUrl: "https://www.linkedin.com/company/ctgt",
    website: "https://ctgt.ai", description: "Trustworthy enterprise AI." }],
  F2: [{ id: "f2aihq", name: "F2", universalName: "f2aihq",
    linkedinUrl: "https://www.linkedin.com/company/f2aihq",
    website: "https://f2.ai", description: "AI-native financial operations." }],
};

const ENRICH_ROWS: Record<string, Record<string, unknown>> = {
  "https://www.linkedin.com/company/retell-ai": {
    id: "retellai", name: "Retell AI", linkedinUrl: "https://www.linkedin.com/company/retell-ai",
    website: "https://retellai.com", employeeCount: 50,
    description: "Conversational voice AI agents for enterprises.",
    industries: [{ id: "4", name: "Software Development" }],
    locations: [{ linkedinText: "San Francisco, California, United States" }] },
  "https://www.linkedin.com/company/afterquery": {
    id: "afterquery", name: "AfterQuery", linkedinUrl: "https://www.linkedin.com/company/afterquery",
    website: "https://afterquery.com", employeeCount: 30,
    description: "Frontier data for AI research labs.",
    industries: [{ id: "4", name: "Software Development" }],
    locations: [{ linkedinText: "San Francisco, California, United States" }] },
  "https://www.linkedin.com/company/agentmailto": {
    id: "agentmailto", name: "AgentMail (YC S25)",
    linkedinUrl: "https://www.linkedin.com/company/agentmailto",
    website: "https://agentmail.to", employeeCount: 10,
    description: "Email infrastructure for AI agents.",
    industries: [{ id: "4", name: "Software Development" }],
    locations: [{ linkedinText: "San Francisco, California, United States" }] },
  "https://www.linkedin.com/company/ctgt": {
    id: "ctgt", name: "CTGT", linkedinUrl: "https://www.linkedin.com/company/ctgt",
    website: "https://ctgt.ai", employeeCount: 10,
    description: "Making AI models trustworthy for the enterprise.",
    industries: [{ id: "4", name: "Software Development" }],
    locations: [{ linkedinText: "San Diego, California, United States" }] },
  "https://www.linkedin.com/company/f2aihq": {
    id: "f2aihq", name: "F2", linkedinUrl: "https://www.linkedin.com/company/f2aihq",
    website: "https://f2.ai", employeeCount: 15,
    description: "AI-native financial operations.",
    industries: [{ id: "4", name: "Software Development" }],
    locations: [{ linkedinText: "New York, New York, United States" }] },
};

const H = (s: string) => console.log(`\n${"═".repeat(78)}\n  ${s}\n${"═".repeat(78)}`);
const J = (v: unknown) => console.log(JSON.stringify(v, null, 2));

const actorCalls: Array<{ actor: string; input: unknown; rows: number }> = [];

async function main() {
  const routing = new ModelRoutingLedger();

  console.log(LIVE
    ? "APIFY: LIVE — actors will really run and really cost money"
    : "APIFY: recorded rows (no APIFY_API_TOKEN in env)");

  H("1. USER REQUEST");
  console.log(QUERY);
  console.log(`requested: ${REQUESTED}`);

  // ── MISSION, BY REAL GPT ─────────────────────────────────────────────────
  H("2. GPT MISSION COMPILATION  (live model)");
  const generate = createGptMissionGenerateJson();
  const ctx = { originalUserQuery: QUERY, requestedCount: REQUESTED, companyBrain: null };
  const proposalResult = await generate({
    systemPrompt: (await import("../supabase/functions/_shared/leadMissionCompiler.ts"))
      .MISSION_COMPILER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(buildMissionCompilerPayload(ctx)) }],
  } as never) as { ok?: boolean; json?: unknown; model?: string };

  console.log(`model: ${proposalResult.model ?? "?"}  ok: ${proposalResult.ok}`);
  if (!proposalResult.ok) {
    console.error("mission compilation FAILED — no deterministic fallback is used here");
    Deno.exit(1);
  }
  const compiled = compileLeadMission({
    originalUserQuery: QUERY, proposal: proposalResult.json, requestedCount: REQUESTED,
  });
  const mission = compiled.final_mission;
  console.log(`parser_source: ${compiled.parser_source}`);
  J({
    verticals: mission.company_profile.verticals,
    stages: mission.company_profile.stages,
    locations: mission.company_profile.locations,
    required_signals: mission.required_signals,
    required_evidence: mission.directives?.required_evidence,
    requested_count: mission.requested_count,
    requested_output: mission.requested_output,
    required_capabilities: compiled.capability_decision.requested,
    approved: compiled.capability_decision.approved,
    rejected: compiled.capability_decision.rejected,
  });

  const graph = buildCapabilityGraph(mission);
  H("3. CAPABILITY GRAPH  (code — containment only)");
  J({
    entry: graph.entry_capability,
    reason: graph.routing_reason,
    steps: graph.steps.map((s) => `${s.capability} [${s.providers.join(", ") || "no actor"}]`),
    advisories: graph.routing_advisories,
  });

  // ── THE RUN ──────────────────────────────────────────────────────────────
  // ── THE QUALIFICATION STAGES, ALSO LIVE ──────────────────────────────────
  const evalBinding = buildMissionEvaluationBinding({
    workspaceId: "e2e", shortlistSize: 10, requestedCount: REQUESTED,
  });
  const triageBinding = buildMissionTriageBinding({
    workspaceId: "e2e", poolSize: 20, requestedCount: REQUESTED,
  });
  console.log(`evaluator: enabled=${evalBinding.diagnostics.enabled} ` +
    `calls=${evalBinding.diagnostics.calls_allowed}`);
  console.log(`triage:    enabled=${triageBinding.diagnostics.enabled} ` +
    `batches=${triageBinding.diagnostics.batches_allowed}`);

  H("4. EXECUTION  (GPT plans · code executes · GPT observes · GPT replans)");
  let evaluations = 0;
  let run;
  try {
    run = await runCapabilityPlan({
      planExecution: makeGptExecutionPlanner({
        log: (m, meta) => console.log(`   [execution-planner] ${m}`, meta ?? ""),
      }, { requestedCount: REQUESTED, onRoute: (r) => routing.record(r) }),
      planDiscovery: makeGptDiscoveryPlanner({
        log: (m, meta) => console.log(`   [discovery-planner] ${m}`, meta ?? ""),
      }, { requestedCount: REQUESTED, onRoute: (r) => routing.record(r) }),
      invoke: async (call: CompiledActorCall<unknown>) => {
        const input = call.input as Record<string, unknown>;
        let rows: Record<string, unknown>[] = [];
        if (LIVE) {
          const t0 = Date.now();
          rows = await runApifyActor(call.actorKey, input);
          console.log(`   → ACTOR ${call.actorKey} [LIVE ${Date.now() - t0}ms]  ` +
            `input=${JSON.stringify(input)}  rows=${rows.length}`);
        } else {
          if (call.actorKey === "apify_yc_companies_memo23") rows = YC_ROWS;
          else if (call.actorKey === "apify_linkedin_company_search") {
            const q = String(input.searchQuery ?? "");
            rows = LINKEDIN_SEARCH[q] ?? [];
          } else if (call.actorKey === "apify_linkedin_company_details") {
            const urls = (input.companies as string[] | undefined) ?? [];
            rows = urls.map((u) => ENRICH_ROWS[u]).filter(Boolean);
          }
          console.log(`   → ACTOR ${call.actorKey} [recorded]  ` +
            `input=${JSON.stringify(input)}  rows=${rows.length}`);
        }
        actorCalls.push({ actor: call.actorKey, input, rows: rows.length });
        return rows;
      },
      verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
      triageCompanies: triageBinding.triageCompanies
        ? async ({ input }: { input: unknown }) =>
          await triageBinding.triageCompanies!(input as Record<string, unknown>)
        : undefined,
      triageBatchesAllowed: triageBinding.batchesRemaining,
      triageBatchSize: triageBinding.batchSize,
      evaluateMission: evalBinding.evaluateMission
        ? async ({ input, registry, company_key }: {
          input: unknown; registry: unknown; company_key: string;
        }) => {
          evaluations++;
          const raw = await evalBinding.evaluateMission!(input as Record<string, unknown>);
          const parsed = parseMissionEvaluationStrict(raw, registry as never);
          console.log(`   → QUALIFY ${company_key}: ${parsed.evaluation.decision} ` +
            `(fit=${parsed.evaluation.mission_fit}, score=${parsed.evaluation.match_score})`);
          return parsed;
        }
        : undefined,
    } as never, {
      mission, plan: graph, maxCandidates: Math.max(10, REQUESTED * 10),
    } as never);
  } catch (e) {
    H("RUN BLOCKED — this is an ANSWER, not a crash");
    if (e instanceof DiscoveryStrategyBlockedError || e instanceof ExecutionPlanBlockedError) {
      console.log(e.userMessage);
      J((e as { violations: unknown }).violations);
      console.log("\nactor calls made:", actorCalls.length, "(a refusal spends nothing)");
      Deno.exit(2);
    }
    throw e;
  }

  H("5. THE PLAN GPT ACTUALLY MADE");
  J(run.state.execution_plan);

  H("6. DISCOVERY STRATEGY");
  J(run.state.discovery_strategy);

  H("7. EVERY ACTOR CALL");
  J(actorCalls);

  H("7b. PROVIDER ATTEMPTS (including refusals)");
  J((run.state as { provider_attempts?: unknown }).provider_attempts);

  H("8. FUNNEL");
  J(run.funnel);

  H("9. PER-STAGE OUTCOME");
  J(run.capability_outcomes);

  H("10. COMPANIES");
  J(run.companies.map((c) => ({
    name: (c.enriched ?? c.company).company_name,
    domain: c.company.canonical_domain,
    linkedin: c.identity?.linkedin_company_url ?? c.company.linkedin_company_url,
    open_roles: c.yc_open_jobs.map((j) => j.title),
    employees: c.enriched?.employee_count ?? null,
    shortlisted: c.shortlisted,
    verdict: c.verdict,
    investigation_state: c.investigation_state,
  })));

  H("11. MODEL ROUTING");
  J(routing.summary());

  H("12. THE TRACE  (one object — 'why did Agentory do this?')");
  const trace = buildLeadRunTrace({
    mission, graph, state: run.state as never,
    capability_outcomes: run.capability_outcomes,
    model_routing: routing.summary(),
    funnel: run.funnel as unknown as Record<string, unknown>,
    qualified: run.companies.filter((c) => c.verdict === "pass").length,
    requested: REQUESTED,
  });
  for (const line of describeLeadRunTrace(trace)) console.log("  " + line);

  H("13. VERDICT");
  const qualified = run.companies.filter((c) => c.verdict === "pass").length;
  console.log(`qualified: ${qualified} of ${REQUESTED} requested`);
  console.log(`actor calls: ${actorCalls.length}`);
  console.log(`terminal_reason: ${run.state.terminal_reason ?? "(none)"}`);
  console.log(`gpt qualification calls: ${evaluations}`);
}

await main();
