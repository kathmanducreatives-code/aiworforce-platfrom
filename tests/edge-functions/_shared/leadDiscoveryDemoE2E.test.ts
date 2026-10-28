// THE DEMO REQUEST, END TO END, OFFLINE.
//
//   "Find 100 US companies hiring Account Executives that raised funding
//    within the last six months."
//
//   GPT proposal (canned) → compileLeadMission → capability graph (production
//   readiness) → paid preflight → runCapabilityPlan → claim verification phase
//   (funding: atomus/pvalyou) → canonical qualified set → Lead Library writer →
//   the Leads UI row reader.
//
// REAL: the compiler, the graph and readiness, the preflight, the engine, the
// guarded invoker and spec compiler, the verifiers, eligibility, the
// persistence projection and the canonical writer, the frontend row reader.
// FAKED: the Apify HTTP boundary (rows in each actor's real shape), the SQL
// engine (a stateful in-memory store, so dedup is exercised), the model calls
// (the discovery selector and the mission evaluator).
//
// ZERO network, ZERO model calls, ZERO real database writes, ZERO spend.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  applyVerifierFinding, canonicalQualifiedKeys, missionCandidatesFrom, runCapabilityPlan, compileFirstProviderCall,
  type EngineCompany,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic, type LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { runClaimVerificationPhase } from "../../../supabase/functions/_shared/claimVerificationPhase.ts";
import { fundingStageVerifier } from "../../../supabase/functions/_shared/fundingStageVerifier.ts";
import { ledgerBoundCall, type PendingVerifierRun } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import { verifierSpecCompiler } from "../../../supabase/functions/_shared/verifierCallSpec.ts";
import { criteriaExecutionPolicy } from "../../../supabase/functions/_shared/criteriaExecutionPolicy.ts";
import { guardedInvoker } from "../../../supabase/functions/_shared/leadMissionRuntime.ts";
import { hashInput } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { buildClaimPlan } from "../../../supabase/functions/_shared/claimPlan.ts";
import { selectResearchPlaybooks } from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";
import { authorizePlaybookExecution } from "../../../supabase/functions/_shared/leadPlaybookExecution.ts";
import { buildPaidExecutionPreflight } from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import { parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { projectMissionCompanyRows } from "../../../supabase/functions/_shared/leadMissionPersistenceProjection.ts";
import { createPersistPlan } from "../../../supabase/functions/_shared/qualifiedLeadPersistence.ts";
import { companyIsTheDeliverable } from "../../../supabase/functions/_shared/leadMission.ts";
import { canonicalDecisions, canonicalHardEvidence } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { parseRunBudget, type RunBudget } from "../../../supabase/functions/_shared/runBudget.ts";
import { requirementEvidenceLines } from "../../../src/lib/leadLibrary/requirementEvidence.ts";
import { baseProposal } from "../../../scripts/model-routing-eval/interpretationCorpus.ts";

globalThis.fetch = () => { throw new Error("the demo E2E must not reach the network"); };

type Row = Record<string, unknown>;
export const DEMO_REQUEST = "Find 100 US companies hiring Account Executives that raised funding within the last six months.";

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);

/** What a correct GPT proposal for the demo request looks like (v1 contract; flags off). */
export function demoProposal(): Row {
  const p = baseProposal();
  Object.assign(p, {
    requested_opportunity_count: 100, geographies: ["United States"], geography_is_hard: true,
    preferred_signals: ["hiring Account Executives", "raised funding within the last six months"],
    required_signal_terms: ["Account Executive"], signal_recency_days: 180,
    disallowed_broadening: ["geography", "role", "recency"],
  });
  return p;
}

export function demoMission(): LeadMissionV1 {
  return compileLeadMission({ originalUserQuery: DEMO_REQUEST, proposal: demoProposal(), requestedCount: 100 }).final_mission;
}

// ── the SQL engine, replaced (same stateful store as hiringLeadLibraryE2E) ───

export function memoryDb(opts: { failTable?: string } = {}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    accounts: [], lead_candidates: [], contacts: [],
  };
  let n = 0;
  return {
    tables,
    rows: (t: string) => tables[t] ?? [],
    client: {
      from(table: string) {
        tables[table] ??= [];
        return {
          select(_c: string) {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(c: string, v: unknown) { filters[c] = v; return chain; },
              // An absent column IS null, as it is in Postgres — a row inserted
              // without `contact_id` must satisfy `is("contact_id", null)`.
              is(c: string, v: null) { filters[c] = v; return chain; },
              maybeSingle() {
                const hit = tables[table].find((r) =>
                  Object.entries(filters).every(([k, v]) =>
                    v === null ? (r[k] ?? null) === null : r[k] === v));
                return Promise.resolve({ data: hit ?? null });
              },
            };
            return chain;
          },
          update(patch: Record<string, unknown>) {
            return {
              eq: (c: string, v: unknown) => {
                for (const r of tables[table]) {
                  if (r[c] === v) Object.assign(r, patch);
                }
                return Promise.resolve({ data: null });
              },
            };
          },
          insert(row: Record<string, unknown>) {
            if (opts.failTable === table) {
              return {
                select: (_c: string) => ({
                  maybeSingle: () => Promise.reject(new Error(`${table} insert failed`)),
                }),
              };
            }
            const stored = { id: `${table}_${++n}`, ...row };
            tables[table].push(stored);
            return {
              select: (_c: string) => ({
                maybeSingle: () => Promise.resolve({ data: { id: stored.id } }),
              }),
            };
          },
        };
      },
    },
  };
}

// ── fixtures ────────────────────────────────────────────────────────────────

interface Co { name: string; slug: string; domain: string; title: string; posted: number; rounds: Array<[string, number]> }
export const COMPANIES: Record<string, Co> = {
  // Qualifies: an AE posting 10 days old, a Series A 60 days ago.
  acme: { name: "Acmely", slug: "acmely", domain: "acmely.com", title: "Account Executive", posted: 10, rounds: [["series_a", 60]] },
  // Funding too old (300 days).
  beta: { name: "Betaworks Cloud", slug: "betaworks-cloud", domain: "betaworks.cloud", title: "Senior Account Executive", posted: 5, rounds: [["seed", 300]] },
  // Hiring the wrong role.
  gamma: { name: "Gammaflow", slug: "gammaflow", domain: "gammaflow.io", title: "Sales Development Representative", posted: 3, rounds: [["seed", 30]] },
  // No funding record at all: unknown, never qualified.
  delta: { name: "Deltaform", slug: "deltaform", domain: "deltaform.io", title: "Account Executive", posted: 7, rounds: [] },
};
const li = (c: Co) => `https://www.linkedin.com/company/${c.slug}`;
const byLi = (u: string) => Object.values(COMPANIES).find((c) => li(c) === u.replace(/\/$/, "").toLowerCase());

const jobRow = (c: Co): Row => ({
  id: `job-${c.slug}`, title: c.title, linkedinUrl: `https://www.linkedin.com/jobs/view/${c.slug}/`,
  descriptionText: `${c.name} is hiring a ${c.title}.`, postedDate: ago(c.posted), location: { linkedinText: "New York, NY" },
  company: { id: c.slug, universalName: c.slug, name: c.name, linkedinUrl: li(c), website: `https://${c.domain}`,
    employeeCount: 40, description: `${c.name} is a B2B software company.`, industries: ["Software Development"],
    locations: [{ city: "New York", country: "US" }] },
});
const detailsRow = (c: Co): Row => ({
  id: c.slug, name: c.name, linkedinUrl: li(c), website: `https://${c.domain}`, employeeCount: 40,
  employeeCountRange: { start: 11, end: 50 }, description: `${c.name} is a B2B software company.`,
  industries: ["Software Development"], locations: [{ city: "New York", country: "US", headquarter: true }],
});
const searchRow = (c: Co): Row => ({
  id: c.slug, name: c.name, linkedinUrl: li(c), website: `https://${c.domain}`,
  description: `${c.name} is a B2B software company.`, location: "New York, NY", employeeCount: 40,
});
const atomusRow = (c: Co): Row => ({
  input: li(c), status: "success",
  summary: { linkedin_url: li(c), domain: c.domain, last_updated: ago(1) },
  company: { financial: { funding: {
    num_funding_rounds: c.rounds.length,
    rounds: c.rounds.map(([type, d]) => ({ type, announced_at: ago(d), raised_amount: 5_000_000, investors: ["Fund I"] })),
  } } },
});

export function demoRows(): Record<string, (input: Row) => Row[]> {
  return {
    apify_linkedin_job_search: (i) => {
      const company = String((i as { company?: unknown }).company ?? "");
      const all = Object.values(COMPANIES);
      return company ? all.filter((c) => company.includes(c.slug) || company.includes(c.name)).map(jobRow) : all.map(jobRow);
    },
    apify_linkedin_company_search: () => Object.values(COMPANIES).map(searchRow),
    apify_linkedin_company_details: (i) => ((i.companies as string[]) ?? []).map((u) => byLi(u)).filter((c): c is Co => !!c).map(detailsRow),
    apify_funding_atomus: (i) => {
      const urls = ((i as { linkedin_urls?: string[]; urls?: string[]; companies?: string[] }).linkedin_urls ??
        (i as { urls?: string[] }).urls ?? (i as { companies?: string[] }).companies ?? []) as string[];
      return urls.map((u) => byLi(String(u))).filter((c): c is Co => !!c).map(atomusRow);
    },
    apify_funding_pvalyou: () => [],
  };
}

// ── the run, as run-agent sequences it ──────────────────────────────────────

export interface Call { actor: string; capability: string | null; input: Row }

export async function runDemo(o: {
  mission?: LeadMissionV1; rows?: Record<string, (i: Row) => Row[]>; db?: ReturnType<typeof memoryDb>; workspaceId?: string;
  runBudget?: RunBudget | null;
} = {}) {
  const workspaceId = o.workspaceId ?? "ws-demo";
  const db = o.db ?? memoryDb();
  const mission = o.mission ?? demoMission();
  const rows = o.rows ?? demoRows();
  const readiness = PRODUCTION_READINESS;
  const calls: Call[] = [];
  const record = (actor: string, capability: string | null, input: Row) => calls.push({ actor, capability, input });
  const plan = buildCapabilityGraph(mission, { executability: "enforce", readiness });
  const selection = selectResearchPlaybooks(mission);
  const authorization = authorizePlaybookExecution(selection, plan, mission);
  const first = compileFirstProviderCall(plan);
  const preflight = buildPaidExecutionPreflight({
    mission, plan, firstProvider: first.provider,
    firstProviderCompileOk: first.compiled ? first.compiled.ok : undefined, playbook: authorization,
  });
  const entrySelection: Row[] = plan.entry_capability === "job_discovery"
    ? [{ actor_key: "apify_linkedin_job_search", role: "primary",
      input: { jobTitles: ["Account Executive"], locations: ["United States"], postedLimit: "month", maxItems: 25 } }]
    : [{ actor_key: "apify_linkedin_company_search", role: "primary",
      input: { locations: ["United States"], maxItems: 25, scraperMode: "full" } }];
  const evaluator = ({ registry }: { registry: { items: Array<{ evidence_type?: string; evidence_id: string; source_text?: unknown }> } }) => {
    const job = registry.items.find((x) => x.evidence_type === "job_posting");
    return Promise.resolve(parseMissionEvaluationStrict({
      mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified", confidence: 0.9, match_score: 85,
      matched_requirements: job ? [{ requirement: "hiring Account Executives", evidence_id: job.evidence_id,
        excerpt: String(job.source_text ?? "").slice(0, 20) }] : [],
      reasoning: "fits", evidence_quality: "strong",
    }, registry as never));
  };
  const logs: Array<[string, Row]> = [];
  const result = await runCapabilityPlan({
    log: (m: string, meta?: Row) => logs.push([m, meta ?? {}]),
    planDiscovery: () => Promise.resolve(entrySelection),
    invoke: (call: { actorKey: string; input: unknown; providerCallSpec?: { capability?: string };
      onProviderRun?: (r: { run_id: string; dataset_id: null }) => void }) => {
      record(call.actorKey, call.providerCallSpec?.capability ?? null, call.input as Row);
      call.onProviderRun?.({ run_id: `run-${calls.length}`, dataset_id: null });
      return Promise.resolve(rows[call.actorKey]?.(call.input as Row) ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    evaluateMission: evaluator,
  } as never, {
    mission, plan, maxCandidates: 10, readiness, runBudget: o.runBudget ?? null,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "ws-demo", lineage_id: "lineage-demo" },
  } as never) as unknown as { companies: EngineCompany[]; state: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

  const missionId = "task-demo";
  const criteria = deriveMissionCriteria(mission);
  const byKey = (k: string) => result.companies.find((c) => c.key === k)!;
  const candidates = () => missionCandidatesFrom(result as never, { missionId }).map((cand) => {
    const e = evaluateEligibility(criteria, cand.graph);
    return {
      company_key: cand.company_key, name: cand.name, domain: cand.domain, linkedin_url: cand.linkedin_url,
      graph: cand.graph, eligibility: e.eligibility, hard_checks: e.checks.filter((x) => x.kind === "hard"),
      attempted_routes: cand.attempted_routes ?? [],
    };
  });
  const qualified = () => canonicalQualifiedKeys(result.companies, {
    mission, plan: { entry_capability: plan.entry_capability }, identity: { task_id: missionId },
  });
  const phase = await runClaimVerificationPhase({
    mission_id: missionId,
    claim_plan: buildClaimPlan(criteria, plan.entry_capability, readiness),
    requested_count: Math.max(1, Number(mission.requested_count ?? 1)),
    candidates, qualified: () => qualified().length,
    criteriaValue: (id) => criteria.find((c) => c.id === id)?.value ?? null,
    verifiers: [fundingStageVerifier()],
    readiness,
    pending: (result.state.verifier_pending_runs ?? []) as PendingVerifierRun[],
    deps: {
      call: ledgerBoundCall({
        ledger: result.state.spend_ledger,
        spec: verifierSpecCompiler({
          scope: { workspace_id: "ws-demo", lineage_id: "lineage-demo" }, mission_hash: "mh-demo",
          policy: criteriaExecutionPolicy(mission), ceilings: () => result.state.spend_ledger.ceilings, readiness,
        }),
        actorIdFor: (actor) => hiringActorCard(actor)?.actor_id ?? null,
        invoke: guardedInvoker(null, (call) => {
          record(call.actorKey, call.providerCallSpec.capability, call.input);
          return Promise.resolve(rows[call.actorKey]?.(call.input) ?? []);
        }, undefined, readiness),
        hash: (input, actor) => hashInput(input, actor),
      }),
      now: () => new Date().toISOString(),
      log: () => {},
    },
    apply: (f, v) => applyVerifierFinding(byKey(f.company_key), f, v),
  });
  // ── the Lead Library, exactly as run-agent writes it ──────────────────────
  const persistence = projectMissionCompanyRows(result.companies, workspaceId,
    companyIsTheDeliverable(mission) ? "company" : "contact",
    canonicalDecisions(result.companies, { mission, plan, identity: { task_id: missionId }, readiness } as never),
    canonicalHardEvidence(result.companies, { mission, plan, identity: { task_id: missionId }, readiness } as never));
  const persistPlan = createPersistPlan({ db: db.client as never, workspaceId, planId: "plan-demo",
    writeContact: (() => Promise.resolve({ ok: true })) as never });
  const persisted: Array<{ key: string; ok: boolean; reason?: string }> = [];
  for (const row of persistence.rows) {
    const w = await persistPlan(row.plan);
    persisted.push({ key: row.key, ok: w.ok, ...(w.reason ? { reason: w.reason } : {}) });
  }
  return { db, persistence, persisted, logs, mission, plan, preflight, authorization, calls, result, phase, qualified: qualified(), candidates: candidates() };
}

// ── 1. INTERPRETATION: every requirement survives, each with its own window ──

Deno.test("DEMO 1: the request compiles to companies, US, hiring AEs (30-day default) and funding within 180 days", () => {
  const r = compileLeadMission({ originalUserQuery: DEMO_REQUEST, proposal: demoProposal(), requestedCount: 100 });
  const m = r.final_mission;
  assertEquals(m.target_entity, "company", "companies were asked for, not founders (fixed: 'Account Executives that' read as people)");
  assertEquals(m.requested_output, "qualified_companies");
  assertEquals(m.decision_makers.roles, []);
  assertEquals(m.requested_count, 100);
  const sig = (e: string) => m.required_signals.find((x) => (x.event ?? x.type) === e)!;
  assertEquals(sig("hiring").timeframe_days, 30);
  assertEquals((sig("hiring").qualifier as { role_terms?: string[] }).role_terms, ["account executives"]);
  assertEquals(sig("funding").timeframe_days, 180);
  const hard = Object.fromEntries((m.criteria ?? []).filter((c) => c.kind === "hard")
    .map((c) => [c.dimension, `${c.time_window?.days ?? "-"}/${c.time_window?.source ?? "-"}`]));
  assertEquals(hard, { geography: "-/-", hiring: "30/system_default", funding: "180/user_explicit" });
  // The 30-day hiring default is a recorded product rule, never silent.
  assert(r.validator_changes.includes("window_belongs_to_another_signal:hiring:30d"));
});

// ── 2. PROVIDER SELECTION: ready providers only, the selective route first ──

Deno.test("DEMO 2: job-first discovery, funding proven per company; only READY production routes are called", async () => {
  const r = await runDemo();
  assertEquals(r.plan.entry_capability, "job_discovery", "fixed: an unfiltered company search refused to run and found nothing");
  assert(r.preflight.ok, JSON.stringify(r.preflight));
  for (const c of r.calls) {
    assert(c.capability, `${c.actor} called without a capability`);
    assert(PRODUCTION_READINESS.decide(c.actor, c.capability as never).executable, `${c.actor}/${c.capability} is not READY`);
  }
  const actors = new Set(r.calls.map((c) => c.actor));
  assertEquals([...actors].sort(), ["apify_funding_atomus", "apify_funding_pvalyou", "apify_linkedin_company_details", "apify_linkedin_job_search"]);
  assertFalse(r.calls.some((c) => /employees|people|contact/.test(c.actor)), "no person or contact purchase on a company mission");
});

// ── 3. SPEND: every paid call reserved; a budget that cannot cover a call buys nothing ──

Deno.test("DEMO 3: every provider call holds a spend reservation; a too-small run budget stops before the first purchase", async () => {
  const r = await runDemo();
  const reservations = (r.result.state.spend_ledger?.reservations ?? []) as Array<{ status: string }>;
  assert(reservations.length >= r.calls.length, `${reservations.length} reservations for ${r.calls.length} calls`);
  const starved = await runDemo({ runBudget: parseRunBudget({ provider_usd: 0.000001, max_candidates: 2 }) });
  assertEquals(starved.calls.length, 0, JSON.stringify(starved.calls));
  assertEquals(starved.db.rows("lead_candidates").length, 0);
});

// ── 4. QUALIFICATION: every hard requirement checked against evidence ───────

Deno.test("DEMO 4: only the company meeting every requirement qualifies; the rest say why", async () => {
  const r = await runDemo();
  const li = (slug: string) => `https://www.linkedin.com/company/${slug}`;
  assertEquals(r.qualified, [li("acmely")]);
  const check = (slug: string, dim: string) =>
    (r.candidates.find((c) => c.company_key === li(slug))!.hard_checks as Array<{ dimension: string; result: string }>)
      .find((h) => h.dimension === dim)!.result;
  assertEquals(r.candidates.find((c) => c.company_key === li("betaworks-cloud"))!.eligibility, "ineligible");
  assertEquals(check("betaworks-cloud", "funding"), "fail", "a round 300 days old is outside 180 days");
  assertEquals(check("gammaflow", "hiring"), "unknown", "an SDR opening is not an Account Executive opening");
  assertEquals(check("deltaform", "funding"), "unknown", "no funding record: missing, never assumed");
  // No funding bought for a company whose hiring already failed.
  assertFalse(r.calls.some((c) => c.actor === "apify_funding_atomus" && JSON.stringify(c.input).includes("gammaflow")));
});

// ── 5. LEADS: one row per company, with its evidence; reruns never duplicate ─

Deno.test("DEMO 5: the qualified company becomes one Lead Library row carrying its evidence and standing", async () => {
  const r = await runDemo();
  assertEquals(r.persisted, [{ key: "domain:acmely.com", ok: true }]);
  const [lead] = r.db.rows("lead_candidates");
  const raw = lead.raw as Row;
  assertEquals(raw.verdict, "QUALIFIED");
  assertEquals(raw.contact_eligible, false, "no person was verified: nothing is contactable");
  const lines = requirementEvidenceLines(raw);
  const by = (d: string) => lines.find((l) => l.dimension === d)!;
  assertEquals(by("hiring").standing, "verified");
  assertEquals(by("hiring").url, "https://www.linkedin.com/jobs/view/acmely");
  // A funding round reported by a provider is that provider's record — never "independently verified".
  assertEquals(by("funding").standing, "provider_record");
  assertEquals(by("funding").source, "apify_funding_atomus");
  assert(/series_a/.test(by("funding").detail) && /60 day/.test(by("funding").detail), by("funding").detail);
  assertEquals(by("geography").standing, "provider_record");
});

Deno.test("DEMO 6: re-running the same mission, and duplicate rows within a run, create no duplicate leads", async () => {
  const db = memoryDb();
  await runDemo({ db });
  await runDemo({ db });
  const rows = demoRows();
  const doubled = { ...rows, apify_linkedin_job_search: (i: Row) => [...rows.apify_linkedin_job_search(i), ...rows.apify_linkedin_job_search(i)] };
  await runDemo({ db, rows: doubled });
  assertEquals(db.rows("accounts").length, 1);
  assertEquals(db.rows("lead_candidates").length, 1);
});

Deno.test("DEMO 7: workspace isolation — the same company in another workspace is that workspace's own row", async () => {
  const db = memoryDb();
  await runDemo({ db, workspaceId: "ws-a" });
  await runDemo({ db, workspaceId: "ws-b" });
  const acc = db.rows("accounts");
  assertEquals(acc.map((a) => a.workspace_id).sort(), ["ws-a", "ws-b"]);
  for (const lc of db.rows("lead_candidates")) {
    assertEquals(acc.find((a) => a.id === lc.account_id)!.workspace_id, lc.workspace_id, "a lead never binds another workspace's account");
  }
});

Deno.test("DEMO 8: missing evidence is marked missing on the Leads page, never shown as met", () => {
  const raw = { canonical_decision: { hard_evidence: [
    { dimension: "funding", result: "unknown", reason: "no funding record was retrieved", source: "apify_funding_atomus",
      method: "provider_field", status: "plausible", confidence: "medium", url: null, excerpt: null },
    { dimension: "hiring", result: "fail", reason: "posting older than 30 days", source: "deterministic_verdict",
      method: "deterministic_derivation", status: "proven", confidence: "high", url: null, excerpt: null },
  ] } };
  assertEquals(requirementEvidenceLines(raw).map((l) => l.standing), ["missing", "failed"]);
});

Deno.test("DEMO 9: a role being HIRED is not a request for people; real person requests are unchanged", () => {
  const target = (q: string) => parseLeadMissionDeterministic(q).target_entity;
  for (const q of [
    DEMO_REQUEST,
    "Find 1 B2B software company hiring Account Executives in the last 7 days.",
    "Find 1 recruiting agency hiring Account Executives in the last 30 days.",
    "Find companies hiring sales executives who can travel",
    "find companies hiring people",
  ]) assertEquals(target(q), "company", q);
  for (const q of [
    "Find 5 executives at fintech startups", "Find people who work at Stripe", "Find 10 leads at B2B SaaS companies",
    "Find hiring contacts at Anthropic and Figma.", "Find exactly 5 SDR hiring leads in London",
    "Find founders of companies hiring Account Executives",
  ]) assertEquals(target(q), "person", q);
  assertEquals(target("Find companies with 500 people hiring AEs"), "company", "headcount is still a size");
});

Deno.test("DEMO 10: a funding mission with a stated size keeps the funding pool screen's company-search route", () => {
  const sized = compileLeadMission({
    originalUserQuery: "Find 1 US company with 11–50 employees that raised funding in the last 24 months and is currently hiring sales.",
    proposal: { ...demoProposal(), requested_opportunity_count: 1, employee_range: { min: 11, max: 50 } }, requestedCount: 1,
  }).final_mission;
  assertEquals(buildCapabilityGraph(sized, { executability: "enforce", readiness: PRODUCTION_READINESS }).entry_capability,
    "general_company_discovery");
});
