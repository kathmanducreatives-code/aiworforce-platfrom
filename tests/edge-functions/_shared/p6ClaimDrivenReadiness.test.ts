// LEAD V2 P6 — ONE READINESS AUTHORITY, THE CLAIM PLAN, AND THE PHASE'S RULES.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  capabilityRunnable, PRODUCTION_READINESS, readinessPolicy, readinessPolicyFor, withUnavailable,
  ALLOW_EXPERIMENTAL_ENV, PROVIDER_PROBE_ROUTES_ENV, PROVIDER_PROBE_WORKSPACES_ENV,
} from "../../../supabase/functions/_shared/routeReadiness.ts";
import { CLAIM_REGISTRY, evidenceGapsFor, type ClaimDefinition } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { verificationTargets, type ClaimVerifier } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { buildClaimPlan, relevantVerifierActors } from "../../../supabase/functions/_shared/claimPlan.ts";
import { runClaimVerificationPhase } from "../../../supabase/functions/_shared/claimVerificationPhase.ts";
import { businessModelVerifier } from "../../../supabase/functions/_shared/businessModelVerifier.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { validateRetrievalPlan, type RetrievalPlan } from "../../../supabase/functions/_shared/retrievalPlan.ts";
import { criteriaExecutionPolicy } from "../../../supabase/functions/_shared/criteriaExecutionPolicy.ts";

const DATAHYENA = "apify_funding_rounds_datahyena|funding_signal_discovery";
const env = (vars: Record<string, string>) => (k: string) => vars[k];

// ── the decision table ──────────────────────────────────────────────────────

Deno.test("PRODUCTION: READY runs; carded, experimental and needs-work do not", () => {
  const p = PRODUCTION_READINESS;
  assert(p.decide("apify_linkedin_job_search", "job_discovery").executable, "READY");
  const carded = p.decide("apify_funding_rounds_datahyena", "funding_signal_discovery");
  assertEquals([carded.executable, carded.readiness], [false, "CARDED_BUT_NOT_LIVE"]);
  assert(carded.reason.includes("CARDED_BUT_NOT_LIVE") && carded.reason.includes("provider probe"), carded.reason);
  assertFalse(p.decide("apify_linkedin_company_employees", "hiring_verification").executable, "NEEDS_PROVIDER_WORK");
  assertFalse(p.decide("apify_google_news", "expansion_signal_discovery").executable, "the engine cannot execute it");
  const exp = readinessPolicy({ overrides: { [DATAHYENA]: "EXPERIMENTAL" } });
  assertFalse(exp.decide("apify_funding_rounds_datahyena", "funding_signal_discovery").executable, "EXPERIMENTAL, not allowed");
  const allowed = readinessPolicy({ overrides: { [DATAHYENA]: "EXPERIMENTAL" }, allow_experimental: [DATAHYENA] });
  assertEquals(allowed.decide("apify_funding_rounds_datahyena", "funding_signal_discovery").via, "experimental_allowed");
});

Deno.test("PROVIDER PROBE: only the named carded routes open, and only in probe mode", () => {
  const probe = readinessPolicy({ mode: "provider_probe", probe_routes: [DATAHYENA] });
  assertEquals(probe.decide("apify_funding_rounds_datahyena", "funding_signal_discovery").via, "provider_probe");
  // A carded route the probe does not NAME stays shut. (The funding pair, then
  // company-search discovery, used to be the example here; both are READY now.)
  assertFalse(probe.decide("apify_yc_companies_solidcode", "startup_company_discovery").executable, "not named: still shut");
  assertFalse(probe.decide("apify_linkedin_company_employees", "hiring_verification").executable,
    "a probe opens carded routes, never NEEDS_PROVIDER_WORK");
  // The same list in production mode opens nothing.
  const notAProbe = readinessPolicy({ mode: "production", probe_routes: [DATAHYENA] });
  assertFalse(notAProbe.decide("apify_funding_rounds_datahyena", "funding_signal_discovery").executable);
});

Deno.test("UNAVAILABLE: a provider refused this mission may not run, whatever its class", () => {
  const p = withUnavailable(PRODUCTION_READINESS, (a) => a === "apify_linkedin_job_search");
  const d = p.decide("apify_linkedin_job_search", "job_discovery");
  assertEquals([d.executable, d.readiness], [false, "UNAVAILABLE"]);
  assert(p.decide("apify_linkedin_company_details", "company_enrichment").executable);
  assertEquals(readinessPolicy({ unavailable: () => true }).decide("apify_linkedin_job_search", "job_discovery").readiness, "UNAVAILABLE");
});

Deno.test("an engine that cannot execute the capability refuses it even for a READY actor; a provider-less step runs", () => {
  const forced = readinessPolicy({ overrides: { "apify_google_news|expansion_signal_discovery": "READY" } });
  assertFalse(forced.decide("apify_google_news", "expansion_signal_discovery").executable);
  assert(PRODUCTION_READINESS.decide(null, "known_company_resolution").executable);
  assert(PRODUCTION_READINESS.decide("firecrawl", "web_evidence").executable, "claim-verifier capabilities are executed by verifiers");
  assertEquals(capabilityRunnable(PRODUCTION_READINESS, "startup_company_discovery",
    ["apify_yc_companies_memo23", "apify_yc_companies_solidcode"]).providers, ["apify_yc_companies_memo23"]);
});

Deno.test("readinessPolicyFor: production unless the workspace is a NAMED probe AND routes are named", () => {
  assertEquals(readinessPolicyFor("ws-1", env({})), PRODUCTION_READINESS);
  const vars = { [PROVIDER_PROBE_WORKSPACES_ENV]: "ws-probe", [PROVIDER_PROBE_ROUTES_ENV]: DATAHYENA };
  assertEquals(readinessPolicyFor("ws-probe", env(vars)).mode, "provider_probe");
  assert(readinessPolicyFor("ws-probe", env(vars)).decide("apify_funding_rounds_datahyena", "funding_signal_discovery").executable);
  assertEquals(readinessPolicyFor("ws-user", env(vars)), PRODUCTION_READINESS, "any other workspace stays production");
  assertEquals(readinessPolicyFor(null, env(vars)), PRODUCTION_READINESS);
  assertEquals(readinessPolicyFor("ws-probe", env({ [PROVIDER_PROBE_WORKSPACES_ENV]: "ws-probe" })), PRODUCTION_READINESS,
    "a probe workspace with no routes opens nothing");
  const exp = readinessPolicyFor("ws-1", env({ [ALLOW_EXPERIMENTAL_ENV]: DATAHYENA }));
  assertEquals([exp.mode, exp.describe().allow_experimental], ["production", [DATAHYENA]]);
});

// ── every consumer reads the same decision ──────────────────────────────────

const EMPTY = buildCompanyEvidenceGraph("acme", [], { now: new Date("2026-09-19T12:00:00Z") });
const unknownStage = { criterion_id: "company_stage:seed", dimension: "company_stage", result: "unknown", reason: "stage unknown" };
/**
 * THE FUNDING PAIR AS THESE MECHANICS WERE WRITTEN AGAINST: carded, not ready.
 *
 * Every test below uses the funding route as its example of a route production
 * refuses and a named probe opens. Since 2026-09-22 the pair is READY in
 * production (it ran through the spine, task 3f082b22), so production no longer
 * supplies that example. The mechanics — gap router, verifier selection, claim
 * plan and phase all reading ONE decision — are unchanged, and are exercised
 * against the pair in the state they were written for, named here.
 */
const PAIR_CARDED = {
  "apify_funding_atomus|funding_verification": "CARDED_BUT_NOT_LIVE",
  "apify_funding_pvalyou|funding_verification": "CARDED_BUT_NOT_LIVE",
} as const;
const PRE_PROMOTION = readinessPolicy({ overrides: PAIR_CARDED });
const ATOMUS_PROBE = readinessPolicy({
  mode: "provider_probe", probe_routes: ["apify_funding_atomus|funding_verification"], overrides: PAIR_CARDED,
});

Deno.test("GAP ROUTER and VERIFIER SELECTION read the policy: the funding route is blocked in production, open in its probe", () => {
  const [prod] = evidenceGapsFor([unknownStage], EMPTY, undefined, undefined, PRE_PROMOTION);
  assertEquals(prod.next, "blocked");
  const [probe] = evidenceGapsFor([unknownStage], EMPTY, undefined, undefined, ATOMUS_PROBE);
  assertEquals([probe.next, probe.route?.actor], ["verify", "apify_funding_atomus"]);
  const verifier = { route_actor: "apify_funding_atomus", max_targets: 6 };
  const cand = [{ company_key: "acme", name: "Acme", domain: "acme.io", linkedin_url: null, graph: EMPTY,
    eligibility: "pending" as const, hard_checks: [{ ...unknownStage, value: "seed" }], attempted_routes: [] }];
  assertEquals(verificationTargets(verifier, cand, () => "seed", undefined, PRE_PROMOTION).length, 0);
  assertEquals(verificationTargets(verifier, cand, () => "seed", undefined, ATOMUS_PROBE).length, 1);
});

Deno.test("RETRIEVAL PLAN validation reads the policy: a route through a carded actor is refused in production", () => {
  const mission = parseLeadMissionDeterministic("Find recently Seed-funded companies");
  const plan = {
    routes: [{ route_id: "funding_signal_discovery:apify_funding_rounds_datahyena", capability: "funding_signal_discovery",
      provider: "apify_funding_rounds_datahyena", route_ceiling_usd: 1, proposed_input: null, query_families: [{ terms: ["seed"], filters: {} }] }],
    ceilings: { mission_provider_usd: 5 },
  } as unknown as RetrievalPlan;
  const policy = criteriaExecutionPolicy(mission);
  assert(validateRetrievalPlan(plan, policy).some((v) => v.code === "route_not_executable" && v.detail.includes("CARDED_BUT_NOT_LIVE")));
  const probe = readinessPolicy({ mode: "provider_probe", probe_routes: [DATAHYENA] });
  assertFalse(validateRetrievalPlan(plan, policy, probe).some((v) => v.code === "route_not_executable"));
});

// ── the claim plan ──────────────────────────────────────────────────────────

Deno.test("CLAIM PLAN: hard claims carry their READY routes cheapest first; targets buy nothing; no fixed pipeline", () => {
  const combined = parseLeadMissionDeterministic(
    "Find 1 B2B SaaS fintech company that must be seed-stage, recently raised Seed and is hiring growth marketers.");
  const criteria = deriveMissionCriteria(combined, PRE_PROMOTION);
  const prod = buildClaimPlan(criteria, "funding_signal_discovery", PRE_PROMOTION);
  const bm = prod.hard.find((h) => h.claim === "business_model")!;
  assertEquals(bm.routes.map((r) => r.actor), ["apify_linkedin_company_details", "firecrawl"]);
  const stage = prod.hard.find((h) => h.claim === "funding_stage")!;
  assertEquals([stage.status, stage.carried_by_entry, stage.routes], ["carried", true, []],
    "production: the funding entry carries rounds; no verifier is ready to complete them");
  assertEquals(prod.targets.map((t) => t.dimension).sort(), ["funding", "hiring"]);
  const probe = buildClaimPlan(criteria, "funding_signal_discovery", ATOMUS_PROBE);
  assertEquals(probe.hard.find((h) => h.claim === "funding_stage")!.routes.map((r) => r.actor), ["apify_funding_atomus"]);
  assert(relevantVerifierActors(probe).has("apify_funding_atomus"));
  assertFalse(relevantVerifierActors(prod).has("apify_funding_atomus"));
  // A hiring-only mission has no hard claim at all: nothing is relevant to verify.
  const hiring = buildClaimPlan(deriveMissionCriteria(parseLeadMissionDeterministic("Find companies hiring growth marketers")), "job_discovery");
  assertEquals([hiring.hard.length, relevantVerifierActors(hiring).size], [0, 0]);
});

// ── the phase's own rules ───────────────────────────────────────────────────

function fakeVerifier(key: string, actor: string, log: string[]): ClaimVerifier {
  return {
    key, claim: key, route_actor: actor, max_targets: 10,
    verify: (targets, deps) => {
      log.push(`${key}:${targets.map((t) => t.company_key).join(",")}:${deps.ready(actor) ? "ready" : "not_ready"}`);
      return Promise.resolve({ findings: targets.map((t) => ({ company_key: t.company_key, item: null, answered: true, detail: {} })), pending: [] });
    },
  };
}
const industryGap = (key: string) => ({
  company_key: key, name: key, domain: `${key}.io`, linkedin_url: null, graph: buildCompanyEvidenceGraph(key, []),
  eligibility: "pending" as const, attempted_routes: ["apify_linkedin_company_details"],
  hard_checks: [{ criterion_id: "industry:b2b_saas", dimension: "industry", result: "unknown", reason: "?" },
    { criterion_id: "company_stage:seed", dimension: "company_stage", result: "unknown", reason: "?" }],
});
const phaseBase = (log: string[], over: Record<string, unknown> = {}) => ({
  mission_id: "m", requested_count: 5, candidates: () => ["a", "b", "c"].map(industryGap), qualified: () => 0,
  criteriaValue: () => "x", pending: [], apply: () => false,
  verifiers: [fakeVerifier("funding", "apify_funding_atomus", log), fakeVerifier("pages", "firecrawl", log)],
  deps: { call: () => Promise.reject(new Error("unused")), now: () => "t", log: () => {} },
  readiness: ATOMUS_PROBE, ...over,
});

Deno.test("PHASE: cheapest verifier first, at most twice the shortfall each", async () => {
  const log: string[] = [];
  const r = await runClaimVerificationPhase(phaseBase(log, { requested_count: 1 }) as never);
  assertEquals(r.order, ["pages", "funding"], "firecrawl ($0.0192) before atomus ($0.0235)");
  assertEquals(log, ["pages:a,b:ready", "funding:a,b:ready"]);
});

Deno.test("PHASE: once the request is met nothing is bought — a paid run is still adopted", async () => {
  const log: string[] = [];
  const pending = [{ verifier: "funding", stage: "pvalyou", actor_key: "apify_funding_pvalyou", run_id: "r1", input: {},
    candidate_keys: ["a"], started_at: "t" }];
  const r = await runClaimVerificationPhase(phaseBase(log, { qualified: () => 5, pending }) as never);
  assertEquals(r.stopped, "quota_met");
  assertEquals(log, ["funding::ready"], "only the paid run's adoption; no new targets anywhere");
});

Deno.test("PHASE: a verifier answering no HARD claim of the plan is not run", async () => {
  const log: string[] = [];
  const plan = buildClaimPlan(deriveMissionCriteria(parseLeadMissionDeterministic("Find B2B SaaS companies")),
    "general_company_discovery", ATOMUS_PROBE);
  const r = await runClaimVerificationPhase(phaseBase(log, { claim_plan: plan }) as never);
  assertEquals(r.irrelevant, ["funding"]);
  assertEquals(log.map((l) => l.split(":")[0]), ["pages"]);
});

Deno.test("PHASE: readiness and per-mission refusals decide `ready` for each verifier's own capability", async () => {
  const log: string[] = [];
  // Only the industry claim is open: firecrawl is READY but refused this
  // mission, so its verifier is told so; a not-ready funding route has no
  // targets at all.
  const industryOnly = (key: string) => ({ ...industryGap(key), hard_checks: [industryGap(key).hard_checks[0]] });
  await runClaimVerificationPhase(phaseBase(log, {
    readiness: PRE_PROMOTION, unavailable: (a: string) => a === "firecrawl",
    candidates: () => ["a", "b", "c"].map(industryOnly),
  }) as never);
  assertEquals(log, ["pages:a,b,c:not_ready"]);
});

Deno.test("PHASE: a candidate with a hard claim NO route can answer is not viable — nothing is bought for it", async () => {
  // Under PRE_PROMOTION the stage claim has no executable route, so the
  // company can never become eligible and web pages for its industry would be
  // money spent on a foregone PENDING.
  const log: string[] = [];
  await runClaimVerificationPhase(phaseBase(log, { readiness: PRE_PROMOTION }) as never);
  assertEquals(log, [], "neither verifier is handed a candidate that cannot qualify");
});

Deno.test("PHASE: `ready` is the policy's decision for EVERY actor a verifier asks about, not just its route actor", async () => {
  const seen: string[] = [];
  const asks: ClaimVerifier = {
    key: "funding", claim: "funding_stage", route_actor: "apify_funding_atomus", max_targets: 10,
    verify: (_t, deps) => {
      seen.push(`atomus:${deps.ready("apify_funding_atomus")}`, `pvalyou:${deps.ready("apify_funding_pvalyou")}`);
      return Promise.resolve({ findings: [], pending: [] });
    },
  };
  await runClaimVerificationPhase(phaseBase([], { verifiers: [asks] }) as never);
  assertEquals(seen, ["atomus:true", "pvalyou:false"], "the probe opened atomus only");
});

function spiedBusinessVerifier(pages: number) {
  const spy = { collected: 0, regrounded: 0 };
  const v = businessModelVerifier({
    collect: (targets) => {
      spy.collected += targets.length;
      return Promise.resolve(Object.fromEntries(targets.map((t) => [t.company_key, { pages_ok: pages, outcome: "collected" }])));
    },
    reground: () => { spy.regrounded++; return Promise.resolve({ status: "proven", decision: "pass", skipped: null }); },
  });
  return { v, spy };
}

Deno.test("BUSINESS-MODEL VERIFIER: refused this mission → it buys no page and marks nothing", async () => {
  const { v, spy } = spiedBusinessVerifier(3);
  const r = await runClaimVerificationPhase(phaseBase([], {
    verifiers: [v], readiness: PRODUCTION_READINESS, unavailable: (a: string) => a === "firecrawl",
  }) as never);
  assertEquals([spy.collected, spy.regrounded], [0, 0]);
  assertEquals(r.changed, 0, "no finding, so no answered-mark: the gap stays open for a later slice");
});

Deno.test("BUSINESS-MODEL VERIFIER: no usable page → no re-grounding call, and the route is answered", async () => {
  const { v, spy } = spiedBusinessVerifier(0);
  const applied: Array<{ answered: boolean; detail: Record<string, unknown> }> = [];
  await runClaimVerificationPhase(phaseBase([], {
    verifiers: [v], readiness: PRODUCTION_READINESS,
    apply: (f: { answered: boolean; detail: Record<string, unknown> }) => { applied.push(f); return false; },
  }) as never);
  assertEquals(spy.regrounded, 0, "nothing to re-read, so no model call is spent");
  assert(spy.collected > 0);
  assert(applied.length > 0 && applied.every((f) => f.answered && f.detail.skipped === "no_pages"));
});

Deno.test("GAP ROUTER: a READY route whose result cannot move the claim is never taken", () => {
  // The same stage claim routed to a READY actor — once as a canonical
  // executor, once not. Readiness alone does not make a route worth buying.
  const via = (canonical_executor: boolean): ClaimDefinition[] => CLAIM_REGISTRY.map((c) => c.claim !== "funding_stage" ? c : {
    ...c, routes: [{ ...c.routes[0], actor: "apify_linkedin_job_search", capability: "hiring_verification", canonical_executor }],
  });
  assertEquals(evidenceGapsFor([unknownStage], EMPTY, via(true))[0].next, "verify");
  const [g] = evidenceGapsFor([unknownStage], EMPTY, via(false));
  assertEquals([g.next, g.considered[0].executable], ["blocked", false]);
});
