// Q4 ACCEPTANCE HARNESS — one customer request through every reducer that
// decides or reports qualification, offline: the real compiler, capability
// graph, feasibility, execution validator, capability engine, claim
// verification phase, evaluator parser, canonical decision, Workbench view,
// persistence projection, run notice, terminal settlement and a resume from
// the checkpoint. Only the EXTERNAL answers are synthetic: the planner's
// steps, the vendor rows each Actor returns, and the model's raw evaluation.
// No network, no database, no hosted task.
//
// The wiring follows Codex's routing audit (`codex/discovery-routing-audit`,
// aca94e6b), parameterised per case instead of by variant names, and it
// returns every downstream flag so a case can assert each one — not just a
// mission count.
//
// The engine's result shapes are wide and internal; this harness reads them
// structurally, so `any` is used on purpose, here only.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { compileLeadMission } from "../../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria } from "../../../../supabase/functions/_shared/missionCriteria.ts";
import { buildCapabilityGraph } from "../../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { validateExecutionPlan } from "../../../../supabase/functions/_shared/leadExecutionPlan.ts";
import { validateDiscoveryStrategy } from "../../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import { PRODUCTION_READINESS, readinessPolicy } from "../../../../supabase/functions/_shared/routeReadiness.ts";
import { hiringActorCard } from "../../../../supabase/functions/_shared/hiringActorCatalog.ts";
import { assessRequestFeasibility } from "../../../../supabase/functions/_shared/requestFeasibility.ts";
import * as engine from "../../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { parseMissionEvaluationStrict } from "../../../../supabase/functions/_shared/missionEvaluation.ts";
import { parseGroundedResult, verifyGroundedResult } from "../../../../supabase/functions/_shared/groundedClaims.ts";
import { buildWorkbenchMissionView, decisionSummary } from "../../../../supabase/functions/_shared/workbenchMissionView.ts";
import { projectMissionCompanyRows } from "../../../../supabase/functions/_shared/leadMissionPersistenceProjection.ts";
import { buildRunOutcome, readFactsFromResult, renderRunOutcome } from "../../../../supabase/functions/_shared/runOutcome.ts";
import { settleV2Outcome } from "../../../../supabase/functions/_shared/leadAutoContinuation.ts";
import { evaluateEligibility } from "../../../../supabase/functions/_shared/candidateEligibility.ts";
import { runClaimVerificationPhase } from "../../../../supabase/functions/_shared/claimVerificationPhase.ts";
import { buildClaimPlan } from "../../../../supabase/functions/_shared/claimPlan.ts";
import { hiringClaimVerifier } from "../../../../supabase/functions/_shared/hiringClaimVerifier.ts";
import { fundingStageVerifier } from "../../../../supabase/functions/_shared/fundingStageVerifier.ts";
import { ledgerBoundCall } from "../../../../supabase/functions/_shared/claimVerifier.ts";
import { verifierSpecCompiler } from "../../../../supabase/functions/_shared/verifierCallSpec.ts";
import { criteriaExecutionPolicy } from "../../../../supabase/functions/_shared/criteriaExecutionPolicy.ts";
import { guardedInvoker } from "../../../../supabase/functions/_shared/leadMissionRuntime.ts";
import { hashInput } from "../../../../supabase/functions/_shared/hiringActorInputs.ts";
import { buildQualificationContext } from "../../../../supabase/functions/_shared/missionQualificationContext.ts";
import { businessModelVerifier } from "../../../../supabase/functions/_shared/businessModelVerifier.ts";
import { regroundPendingClaims } from "../../../../supabase/functions/_shared/webEvidenceRegrounding.ts";
import { createExecutionDeadline } from "../../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import { hiringSearchTitles } from "../../../../supabase/functions/_shared/hiringSearchVocabulary.ts";
import { roleMatchesFamily } from "../../../../supabase/functions/_shared/roleFamilies.ts";

type Json = Record<string, any>;

export const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
export const KEY = "https://www.linkedin.com/company/acceptance-co";

const probe = JSON.parse(Deno.readTextFileSync(new URL("../../../fixtures/lead-v2/p3-job-discovery-probe.json", import.meta.url)));
const VENDOR_JOB = probe.probes["harvestapi~linkedin-job-search"].items[0];

export interface JobSpec {
  title: string;
  /** Days since posting; null = an undated posting. */
  postedDaysAgo: number | null;
  closed?: boolean;
  description?: string;
  /** The posting's own employer page, when it is someone else's. */
  employerUrl?: string;
}
export interface RoundSpec { type: string; daysAgo: number; nonEquity?: boolean; amountM?: number }

export interface AcceptanceCase {
  id: string;
  request: string;
  signal: string[];
  capabilities?: string[];
  strategies?: string[];
  companyTypes?: string[];
  proposal?: Json;
  company?: Json;
  jobs?: JobSpec[];
  /** What the company-details Actor returns. */
  details?: "same" | "empty" | "foreign" | "hq_conflict";
  /** Funding rounds the funding pair reports; undefined = no record at all. */
  rounds?: RoundSpec[];
  /** Actors that are not available to this run. */
  unavailable?: string[];
  /** The model's aggregate verdict (the parser and canonical rules still decide). */
  /**
   * `http_error`: the call failed (an HTTP error or the spend gate's refusal)
   * and run-agent's wrapper hands the engine the strict parser's reading of a
   * `null` response — canary session 2's fifth call, exactly.
   */
  evaluator?: "pass" | "fail" | "timeout" | "http_error" | "http_error_once";
  /** Extra environment the engine reads (`opts.readEnv`). */
  env?: Record<string, string>;
  /**
   * The first slice's execution deadline closes right after discovery, as a
   * slice running out of wall clock does; the next slice resumes from the
   * checkpoint and must finish the work.
   */
  interrupt?: boolean;
  /**
   * The company's own product page, as the business-model verifier would buy
   * it (Firecrawl). Null: the site yields no usable page.
   */
  productPage?: string | null;
}

const COMPANY = {
  id: "acceptance-co", name: "Acceptance Co", linkedinUrl: KEY, website: "https://acceptance.example",
  description: "We build sales software for revenue teams at mid-size companies.",
  employeeCount: 30, employeeCountRange: { start: 11, end: 50 }, industries: ["Software Development"],
  locations: [{ country: "United States", city: "Boston", isHeadquarter: true }],
};

function proposalOf(c: AcceptanceCase): Json {
  return {
    requested_opportunity_count: 1, company_types: c.companyTypes ?? ["B2B software"], geographies: [],
    employee_range: { min: null, max: null }, output_intent: "qualified_companies",
    preferred_signals: c.signal, required_signal_terms: c.signal,
    required_capabilities: c.capabilities ?? ["general_company_discovery", "embedded_hiring_evidence", "company_semantic_evaluation"],
    strategies: c.strategies ?? (c.signal.some((s) => /hiring/i.test(s)) ? ["hiring"] : []),
    confidence: 0.95, ...c.proposal,
  };
}

function plannedSteps(graph: Json, c: AcceptanceCase): Json[] {
  const entry = graph.entry_capability;
  const title = c.jobs?.[0]?.title ?? "Account Executive";
  const steps: Json[] = [entry === "job_discovery"
    ? { capability: entry, actor_key: "apify_linkedin_job_search", purpose: "employer discovery for the customer's open role",
      input: { jobTitles: [title], maxItems: 3, postedLimit: "month" }, depends_on: [] }
    : { capability: entry, actor_key: "apify_linkedin_company_search", purpose: "structured company-profile discovery",
      input: { industryIds: ["4"], scraperMode: "full", maxItems: 1 }, depends_on: [] }];
  for (const cap of ["job_deduplication", "company_identity_resolution", "company_enrichment", "hiring_verification",
    "expansion_signal_verification", "product_launch_verification", "company_post_verification", "technology_verification",
    "company_brain_qualification", "persistence"]) {
    const step = graph.steps.find((x: Json) => x.capability === cap);
    if (!step) continue;
    steps.push({
      capability: cap,
      actor_key: cap === "company_identity_resolution" ? "apify_linkedin_company_search"
        : cap === "company_enrichment" ? "apify_linkedin_company_details"
        : cap === "hiring_verification" ? "apify_linkedin_job_search"
        : cap.endsWith("signal_verification") || cap === "product_launch_verification" ? "apify_google_news" : null,
      purpose: step.reason, input: cap === "company_enrichment" ? { companies: [KEY] } : {}, depends_on: [steps.length],
    });
  }
  return steps;
}

function vendor(c: AcceptanceCase) {
  const company = { ...structuredClone(COMPANY), ...c.company };
  const jobs = (c.jobs ?? [{ title: "Account Executive", postedDaysAgo: 2 }]).map((j, i) => ({
    ...structuredClone(VENDOR_JOB), id: `acceptance-job-${i}`, title: j.title, company,
    jobState: j.closed ? "CLOSED" : "LISTED", closedAt: j.closed ? ago(1) : null,
    postedDate: j.postedDaysAgo == null ? null : ago(j.postedDaysAgo), expireAt: ago(-30),
    linkedinUrl: `https://www.linkedin.com/jobs/view/acceptance-job-${i}`,
    descriptionText: j.description ?? `${company.name} is hiring an internal ${j.title} to sell our software to business teams.`,
    ...(j.employerUrl ? { companyLinkedinUrl: j.employerUrl } : {}),
  }));
  return { company, jobs };
}

function details(c: AcceptanceCase, company: Json): Json[] {
  const foreign = { ...company, id: "foreign", linkedinUrl: "https://www.linkedin.com/company/foreign-employer", website: "https://foreign.example" };
  switch (c.details ?? "same") {
    case "empty": return [];
    case "foreign": return [foreign];
    case "hq_conflict": return [{ ...company, locations: [{ country: "Canada", city: "Toronto", isHeadquarter: true }] }];
    default: return [company];
  }
}

function fundingRows(actor: string, c: AcceptanceCase): Json[] {
  const rounds = c.rounds ?? [];
  if (actor === "apify_funding_atomus") {
    return [{ input: KEY, status: "success", summary: { linkedin_url: KEY, domain: "acceptance.example", last_updated: ago(0) },
      company: { financial: { funding: { num_funding_rounds: rounds.length, rounds: rounds.map((r) => ({
        type: r.type, announced_at: ago(r.daysAgo).slice(0, 10), raised_amount: (r.amountM ?? 3) * 1e6, investors: ["Synthetic Fund"],
      })) } } } }];
  }
  return c.rounds === undefined ? [] : [{ query: "acceptance.example", status: "active", domain: "acceptance.example", record_as_of: ago(0),
    record: { funding: { rounds_count: rounds.length, rounds: rounds.map((r, i) => ({
      round_index: i + 1, round_type: r.type, round_date: ago(r.daysAgo).slice(0, 10), round_date_precision: "day",
      round_amount_m_usd: r.amountM ?? 3, is_non_equity: !!r.nonEquity, source_urls: [`https://news.example/acceptance-${i}`],
      investors: [{ name: "Synthetic Fund" }],
    })) } } }];
}

/** The model's raw answer: cites what the registry holds, says UNKNOWN for the rest, optimistic in aggregate. */
function evaluatorRaw(input: Json, registry: Json, c: AcceptanceCase): Json {
  const find = (t: string) => registry.items.find((x: Json) => x.evidence_type === t);
  const desc = find("company_description"), job = find("job_posting"), loc = find("company_location");
  const byDim = (d: string) => d === "hiring" ? job : d === "industry" || d === "business_model" || d === "exclusion" ? desc : d === "geography" ? loc : null;
  const cite = (e: Json | null | undefined) => e ? [{ evidence_id: e.evidence_id, excerpt: e.source_text }] : [];
  const criteria = input.mission.criteria ?? [];
  return {
    mission_fit: c.evaluator === "fail" ? "fail" : "pass", hiring_fit: job ? "verified" : "absent", confidence: 0.99, match_score: 99,
    reasoning: "Synthetic evaluator: cites what it was given; deliberately optimistic in aggregate.",
    matched_requirements: desc ? [{ requirement: "B2B software", ...cite(desc)[0] }] : [],
    failed_requirements: c.evaluator === "fail" ? [{ requirement: "customer condition", evidence_id: desc?.evidence_id, why: "model says excluded" }] : [],
    unknown_fields: criteria.filter((x: Json) => !byDim(x.dimension)).map((x: Json) => x.id),
    criterion_verdicts: criteria.map((x: Json) => ({
      criterion_id: x.id, result: byDim(x.dimension) ? "pass" : "unknown",
      geography_scope: x.dimension === "geography" ? (x.geography_scope ?? "headquarters") : undefined,
      reason: byDim(x.dimension) ? "the supplied source says so" : "required source not supplied",
      evidence: cite(byDim(x.dimension)),
    })),
  };
}

/** Every flag a downstream consumer reads, for one case. */
export interface AcceptanceFlags {
  id: string;
  criteria: Json[];
  feasibility: Json;
  /** Set when feasibility or the execution validator stopped the run before any provider. */
  refused: "feasibility" | "validator" | null;
  entry: string | null;
  providerCalls: Array<{ actor: string; input: Json }>;
  evaluator: Array<{ company_key: string; decision: string | null; verdicts: Json[] }>;
  eligibility: Array<{ company_key: string; eligibility: string; checks: Json[]; gaps: string[] }>;
  canonical: Json[];
  qualifiedKeys: string[];
  workbench: { qualified: number; counts: Json };
  persisted: Json[];
  notice: { qualified: number; text: string };
  terminal: Json;
  resume: { keys: string[]; providerCallsAdded: number; evaluatorCallsAdded: number } | null;
  /** Each company's `evaluation_path` after the final slice. */
  evaluation_paths: Record<string, string>;
  /** Each company's stored mission evaluation after the final slice (what a resume restores). */
  mission_evaluations: Record<string, Json | null>;
  /** The engine's own account of the first slice and the resumed one. */
  execution: { terminal_reason: unknown; completed: unknown; slices: number; resumed_terminal_reason: unknown };
}

export async function runAcceptanceCase(c: AcceptanceCase): Promise<AcceptanceFlags> {
  const mission = compileLeadMission({ originalUserQuery: c.request, proposal: proposalOf(c) as never }).final_mission as Json;
  const policy = c.unavailable?.length
    ? readinessPolicy({ unavailable: (actor: string) => c.unavailable!.includes(actor) } as never)
    : PRODUCTION_READINESS;
  const graph = buildCapabilityGraph(mission as never, { executability: "enforce", readiness: policy }) as Json;
  const criteria = deriveMissionCriteria(mission as never, policy) as Json[];
  const feasibility = assessRequestFeasibility(mission as never, graph as never, { executability: "enforce", readiness: policy }) as Json;
  const flags: AcceptanceFlags = {
    id: c.id, criteria, feasibility, refused: null, entry: graph.entry_capability ?? null, providerCalls: [], evaluator: [],
    eligibility: [], canonical: [], qualifiedKeys: [], workbench: { qualified: 0, counts: {} }, persisted: [], evaluation_paths: {}, mission_evaluations: {},
    notice: { qualified: 0, text: "" }, terminal: {}, resume: null,
    execution: { terminal_reason: null, completed: null, slices: 0, resumed_terminal_reason: null },
  };
  if (!feasibility.ok) { flags.refused = "feasibility"; return flags; }

  const steps = plannedSteps(graph, c);
  const validation = validateExecutionPlan(steps as never, mission as never, graph as never, { readiness: policy } as never) as Json;
  if (validation.source === "blocked") { flags.refused = "validator"; return flags; }
  const selection = validateDiscoveryStrategy([{
    actor_key: graph.entry_capability === "job_discovery" ? "apify_linkedin_job_search" : "apify_linkedin_company_search",
    role: "primary", input: steps[0]?.input ?? {}, rationale: "synthetic selector proposes the graph entry's provider",
  }] as never, mission as never) as Json;

  const v = vendor(c);
  let clock = 0;
  let evaluatorCalls = 0;
  const deps: Json = {
    planDiscovery: async () => selection.selections,
    planExecution: async () => ({ reasoning: "synthetic planner over the real graph", steps }),
    controlRoutes: async () => ({ action: "continue" }),
    invoke: async (call: Json) => {
      flags.providerCalls.push({ actor: call.actorKey, input: call.input });
      // The slice's wall clock runs out once discovery has answered.
      if (c.interrupt && flags.providerCalls.length === 1) clock += 1e9;
      call.onProviderRun?.({ run_id: `acceptance-${flags.providerCalls.length}`, dataset_id: null });
      switch (call.actorKey) {
        case "apify_linkedin_job_search": return v.jobs;
        case "apify_linkedin_company_search": return [v.company];
        case "apify_linkedin_company_details": return details(c, v.company);
        case "apify_funding_atomus": case "apify_funding_pvalyou": return fundingRows(call.actorKey, c);
        default: throw new Error(`ACCEPTANCE: unexpected provider ${call.actorKey}`);
      }
    },
    evaluateBatch: async (batch: Json[]) => ({
      version: "fixture", evaluated: batch.length, failed: 0, foreign_results: [],
      outcomes: batch.map((m: Json) => {
        const desc = m.registry.items.find((e: Json) => e.evidence_type === "company_description");
        const raw = {
          business_model: { value: "b2b_software", confidence: 0.95 }, decision: "pass", confidence: 0.95,
          supporting_claims: desc ? [{ claim: "sells software to business teams", claim_type: "business_model",
            evidence_ids: [desc.evidence_id], evidence_excerpts: [{ evidence_id: desc.evidence_id, excerpt: desc.source_text }] }] : [],
        };
        return { company_key: m.company_key, failure: null, detail: null,
          verification: verifyGroundedResult({ registry: m.registry, result: parseGroundedResult(raw) } as never) };
      }),
    }),
    evaluateMission: async (i: Json) => {
      evaluatorCalls++;
      if (c.evaluator === "timeout") return null;
      if (c.evaluator === "http_error" || (c.evaluator === "http_error_once" && evaluatorCalls === 1)) {
        return parseMissionEvaluationStrict(null, i.registry, criteria as never) as Json;
      }
      const parsed = parseMissionEvaluationStrict(evaluatorRaw(i.input, i.registry, c), i.registry, criteria as never) as Json;
      flags.evaluator.push({ company_key: i.company_key, decision: parsed.evaluation?.decision ?? null,
        verdicts: parsed.evaluation?.criterion_verdicts ?? [] });
      return parsed;
    },
    log: () => {},
  };
  const opts: Json = {
    mission, plan: graph, maxCandidates: 1, readEnv: (k: string) => k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : c.env?.[k],
    readiness: policy, specMode: "enforce", specScope: { workspace_id: "q4-acceptance", lineage_id: c.id },
    identity: { task_id: c.id, workspace_id: "q4-acceptance" }, log: deps.log,
  };

  const slice = async (run: Json) => {
    const after = deriveMissionCriteria(mission as never, policy) as Json[];
    const hiring = after.find((x) => x.dimension === "hiring" && x.kind === "hard" && x.status === "ok");
    const vocab = (buildQualificationContext(mission as never, { criteriaAuthority: true } as never) as Json).role_vocabulary;
    const families: string[] = hiring?.value?.qualifier?.role_families ?? [];
    const hiringVerifier = hiring ? hiringClaimVerifier({
      titles: hiringSearchTitles(vocab), role_families: families, window_days: hiring.time_window?.days ?? null,
      matchesRole: (t: string) => families.length ? families.some((f) => roleMatchesFamily(t, f as never))
        : vocab.required_titles.some((x: string) => t.toLowerCase().includes(x.toLowerCase())),
    } as never) : null;
    const candidates = () => (engine.missionCandidatesFrom(run as never) as Json[]).map((x) => {
      const e = evaluateEligibility(after as never, x.graph) as Json;
      return { ...x, eligibility: e.eligibility, hard_checks: e.checks.filter((h: Json) => h.kind === "hard") };
    });
    // THE BUSINESS-MODEL VERIFIER, as run-agent wires it: buy the company's
    // first-party pages, then re-ground the claim on them through the engine's
    // own registry rebuild and write-back. Only the page text and the grounding
    // model's reply are synthetic.
    const pages = new Map<string, Json[]>();
    const businessModel = businessModelVerifier({
      collect: async (targets: Json[]) => Object.fromEntries(targets.map((t) => {
        flags.providerCalls.push({ actor: "firecrawl", input: { domain: t.domain } });
        const text = c.productPage === undefined ? "Acceptance Co is a B2B software company: we sell our sales software to businesses." : c.productPage;
        if (text) pages.set(t.company_key, [{ source_url: `https://${t.domain}/product`, page_intent: "product", source_text: text, fetched_at: ago(0) }]);
        return [t.company_key, { pages_ok: text ? 1 : 0, outcome: text ? "collected" : "no_useful_pages" }];
      })),
      reground: async (key: string) => {
        const r = await regroundPendingClaims({
          requiresCommercialSignal: (mission.required_signals ?? []).some((x: Json) => String(x.type) === "hiring"),
          candidates: [{ company_key: key, business_model_pending: true, grounded_source_urls: [] }], limit: 1,
          deps: {
            pagesFor: async (k: string) => pages.get(k) ?? [],
            rebuildRegistry: (k: string, ps: Json[]) => run.rebuild_registry(k, ps),
            ground: async ({ registry }: Json) => {
              const page = registry.items.find((e: Json) => e.evidence_type === "web_page");
              if (!page) return null;
              return verifyGroundedResult({ registry, result: parseGroundedResult({
                business_model: { value: "b2b_software", confidence: 0.95 }, company_fit: "pass", decision: "pass", confidence: 0.95,
                supporting_claims: [{ claim: "sells software to business customers", claim_type: "business_model",
                  evidence_ids: [page.evidence_id], evidence_excerpts: [{ evidence_id: page.evidence_id, excerpt: page.source_text }] }],
              }) } as never);
            },
            apply: (k: string, verification: Json, registry: Json) => {
              const co = run.companies.find((x: Json) => x.key === k);
              return co ? engine.applyRegroundedVerification(co, verification as never, c.id, new Date().toISOString(), registry as never) as Json
                : { item: null, decision: null };
            },
          } as never,
        });
        const o = r.outcomes[0];
        return { status: o?.status ?? null, decision: o?.decision ?? null, skipped: o?.skipped ?? null };
      },
    } as never);
    const phase = await runClaimVerificationPhase({
      mission_id: c.id, claim_plan: buildClaimPlan(after as never, graph.entry_capability, policy), requested_count: 1,
      candidates, qualified: () => engine.canonicalQualifiedKeys(run.companies, opts as never).length,
      criteriaValue: (id: string) => after.find((x) => x.id === id)?.value,
      criteriaWindow: (id: string) => after.find((x) => x.id === id)?.time_window?.days ?? null,
      verifiers: [fundingStageVerifier(), businessModel, ...(hiringVerifier ? [hiringVerifier] : [])], readiness: policy,
      pending: run.state.verifier_pending_runs ?? [],
      deps: {
        now: () => new Date().toISOString(), log: deps.log,
        call: ledgerBoundCall({
          ledger: run.state.spend_ledger,
          spec: verifierSpecCompiler({ scope: opts.specScope, mission_hash: run.state.mission_hash ?? "q4-acceptance",
            policy: criteriaExecutionPolicy(mission as never), ceilings: () => run.state.spend_ledger.ceilings, readiness: policy } as never),
          actorIdFor: (actor: string) => hiringActorCard(actor)?.actor_id ?? null,
          invoke: guardedInvoker(null, deps.invoke, undefined, policy), hash: hashInput,
        } as never),
      },
      apply: (finding: Json, verifier: Json) => {
        const co = run.companies.find((x: Json) => x.key === finding.company_key);
        return co ? engine.applyVerifierFinding(co, finding, verifier) : false;
      },
    } as never) as Json;
    run.state.verifier_pending_runs = phase.pending;
    if (phase.changed > 0) run.resume_records = run.companies.map(engine.toResumeRecord);
  };

  const report = (r: Json) => {
    const decisions = engine.canonicalDecisions(r.companies, opts as never) as Map<string, Json>;
    const keys = engine.canonicalQualifiedKeys(r.companies, opts as never) as string[];
    const cands = engine.missionCandidatesFrom(r as never) as Json[];
    const view = buildWorkbenchMissionView({
      mission: { requested_count: 1, execution_limit: 1, anchor: graph.entry_capability === "job_discovery" ? "hiring" : null },
      criteria, candidates: cands, stage: "complete", unsupported: feasibility.declared_gaps,
    } as never) as Json;
    const summary = decisionSummary(view.counts) as Json;
    const outcome = buildRunOutcome(readFactsFromResult({ workbench_mission_view: view, lead_library_persistence: { persisted: 0 } }, 1) as never) as Json;
    return {
      decisions: [...decisions.values()], keys, cands, view, summary, outcome,
      persisted: (projectMissionCompanyRows(r.companies, "q4-acceptance", "company", decisions as never) as Json).rows as Json[],
      terminal: settleV2Outcome({ continuing: false, stopReason: summary.qualified ? "quota_met" : "frontier_exhausted",
        legacyStatus: "search_exhausted", legacyQuota: { eligible_leads: 0, requested_leads: 1 },
        canonicalQualified: summary.qualified, requestedCount: 1, companyIsDeliverable: true } as never) as Json,
    };
  };

  // SLICES, AS PRODUCTION RUNS THEM: each slice runs the engine (resuming
  // from the previous checkpoint) and then the claim-verification phase. Up to
  // MAX_SLICES, stopping once a slice buys nothing new and changes no decision.
  const MAX_SLICES = 4;
  const resumeFrom = (r: Json) => {
    const snap = engine.checkpointSnapshot(r.state, r.companies) as Json;
    return engine.runCapabilityPlan({
      ...deps, restoredGroundedResults: new Map(r.companies.filter((x: Json) => x.grounded).map((x: Json) => [x.key, x.grounded])),
    } as never, {
      ...opts, state: JSON.parse(JSON.stringify(snap.state)),
      resume: { workspace_id: "q4-acceptance", lineage_root_task_id: c.id, records: JSON.parse(JSON.stringify(snap.resume_records)) },
    } as never) as Promise<Json>;
  };
  const firstSlice = c.interrupt
    ? { ...deps, deadline: createExecutionDeadline({ budgetMs: 600_000, now: () => clock }) }
    : deps;
  let run: Json = await engine.runCapabilityPlan(firstSlice as never, opts as never) as Json;
  const firstState = { terminal_reason: run.state?.terminal_reason ?? null, completed: run.state?.completed_capabilities ?? null };
  let slices = 1;
  for (;;) {
    const calls = flags.providerCalls.length;
    const keys = JSON.stringify(engine.canonicalQualifiedKeys(run.companies, opts as never));
    await slice(run);
    if (slices >= MAX_SLICES) break;
    const next = await resumeFrom(run);
    slices++;
    const settled = flags.providerCalls.length === calls &&
      JSON.stringify(engine.canonicalQualifiedKeys(next.companies, opts as never)) === keys;
    run = next;
    if (settled) break;
  }

  const r = report(run);
  Object.assign(flags, {
    canonical: r.decisions, qualifiedKeys: r.keys, workbench: { qualified: r.summary.qualified, counts: r.view.counts },
    persisted: r.persisted, notice: { qualified: r.outcome.qualification.qualified, text: renderRunOutcome(r.outcome) },
    terminal: r.terminal,
    evaluation_paths: Object.fromEntries(run.companies.map((co: Json) => [co.key, co.evaluation_path])),
    mission_evaluations: Object.fromEntries(run.companies.map((co: Json) => [co.key, co.mission_evaluation ?? null])),
    eligibility: r.cands.map((x: Json) => {
      const e = evaluateEligibility(criteria as never, x.graph) as Json;
      return { company_key: x.company_key, eligibility: e.eligibility, checks: e.checks, gaps: e.gaps };
    }),
  });

  // ONE MORE RESUME from the final checkpoint: it must buy nothing, evaluate
  // nothing and reach the same decision.
  const before = { providers: flags.providerCalls.length, evaluators: evaluatorCalls };
  const resumed = await resumeFrom(run);
  flags.execution = { ...firstState, slices, resumed_terminal_reason: resumed.state?.terminal_reason ?? null };
  flags.resume = {
    keys: engine.canonicalQualifiedKeys(resumed.companies, opts as never) as string[],
    providerCallsAdded: flags.providerCalls.length - before.providers,
    evaluatorCallsAdded: evaluatorCalls - before.evaluators,
  };
  return flags;
}
