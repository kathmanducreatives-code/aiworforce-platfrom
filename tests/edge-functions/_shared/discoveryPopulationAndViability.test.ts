// SOFT INDUSTRIES SELECT A DISCOVERY POPULATION; FAILED CANDIDATES BUY NOTHING MORE.
//
// 1. A Company Brain industry is a TARGET: it ranks, never rejects, never
//    proves. On company-search discovery it may still say WHICH companies to
//    look at — geography and headcount alone select no population — so its
//    LinkedIn industry ids survive into the ProviderCallSpec, and only those.
//
// 2. After enrichment the cheap hard claims (country, size) are grounded
//    first. A candidate that fails one is ineligible and receives no further
//    paid verification; one whose cheap claims are still unread, or with a
//    hard claim no route can answer, is not handed to a verifier either.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mergeCompanyBrainIntoMission, parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { criteriaExecutionPolicy } from "../../../supabase/functions/_shared/criteriaExecutionPolicy.ts";
import { compileProviderCallSpec } from "../../../supabase/functions/_shared/providerCallSpec.ts";
import { ACTOR_INPUT_CONTRACTS } from "../../../supabase/functions/_shared/actorInputContracts.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import { DEFAULT_CEILINGS } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { verificationTargets } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { normalizeLinkedInCompanyCandidate, normalizeLinkedInCompanyEnriched } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { observationFromCompany } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";

const PROBE = readinessPolicy({ mode: "provider_probe", probe_routes: ["apify_linkedin_company_search|general_company_discovery"] });
const SEARCH = "apify_linkedin_company_search";
// "in the last 6 months" is read identically by both parsers, so the funding window is hard.
const QUERY = "Find 1 US company with 11-50 employees that raised funding in the last 6 months";
/** The mission as Pilot compiles it: the stated 11–50 range carried (the deterministic parser drops it). */
const stated = () => {
  const m = parseLeadMissionDeterministic(QUERY);
  return {
    ...m, company_profile: { ...m.company_profile, employee_range: { min: 11, max: 50 } },
    field_provenance: { ...m.field_provenance, "company_profile.employee_range": "explicit_user_request" as const },
  };
};
const withBrain = () => mergeCompanyBrainIntoMission(stated(), { industries: ["b2b saas", "fintech"] } as never).mission;

function discoverySpec(mission: ReturnType<typeof withBrain>, input: Record<string, unknown>, actorKey = SEARCH, purpose = "discovery") {
  const card = hiringActorCard(actorKey)!;
  return compileProviderCallSpec({
    actorKey, capability: "general_company_discovery", purpose, proposed: input, engine: input,
    policy: criteriaExecutionPolicy(mission),
    plan: { plan_id: "p", version: 1, route_id: "r", route_anchor: "company_profile", route_refused: null },
    candidate_keys: [], scope: { workspace_id: "ws", lineage_id: "ln" }, mission_hash: "mh",
    ceilings: DEFAULT_CEILINGS, cost_model: card.cost_model, contract_fields: ACTOR_INPUT_CONTRACTS[actorKey]?.fields ?? null,
    card_enums: card.verified_enums, card_limits: card.input_limits,
    count_bounds: [{ value: 2, changed_by: "budget_policy", reason: "candidates left" }], size_ceiling: null, readiness: PROBE,
  } as never) as { status: string; serialized_input: Record<string, unknown>; provenance: Array<{ field: string; changed_by: string; reason: string }> };
}

// ═══════════════════════════════════════════════ 1. discovery population ══

Deno.test("POPULATION: Brain industries stay SOFT — targets, never hard, never a proving source", () => {
  const m = withBrain();
  const industries = deriveMissionCriteria(m, PROBE).filter((c) => c.dimension === "industry");
  assert(industries.length > 0);
  assert(industries.every((c) => c.kind === "target" && c.source === "company_brain_preference"), JSON.stringify(industries));
  assertEquals(criteriaExecutionPolicy(m).dimensions.industry.may_reject, false);
  assertEquals(criteriaExecutionPolicy(m).dimensions.industry.may_filter, false);
});

Deno.test("POPULATION: their LinkedIn industry ids survive into the company-search ProviderCallSpec", () => {
  const spec = discoverySpec(withBrain(), {
    industryIds: ["4", "6", "43"], locations: ["United States"], companySize: ["11-50"], maxItems: 20, scraperMode: "full",
  });
  assertEquals(spec.status, "intended");
  assertEquals(spec.serialized_input.industryIds, ["4", "6", "43"]);
  const p = spec.provenance.find((x) => x.field === "industryIds")!;
  assertEquals(p.changed_by, "discovery_population");
  assert(p.reason.includes("never filters eligibility"));
});

Deno.test("POPULATION: only ids the target industries map to — a planner cannot widen or swap the population", () => {
  const spec = discoverySpec(withBrain(), { industryIds: ["4", "104", "96"], locations: ["United States"], maxItems: 20, scraperMode: "full" });
  assertEquals(spec.serialized_input.industryIds, ["4"], "104 (staffing) and 96 (IT services) are no Brain industry");
  const none = discoverySpec(withBrain(), { industryIds: ["104"], locations: ["United States"], maxItems: 20, scraperMode: "full" });
  assertEquals(none.serialized_input.industryIds, undefined);
});

Deno.test("POPULATION: no soft industry, no industry filter; and no other actor gains the exception", () => {
  const plain = stated();
  assertEquals(discoverySpec(plain, { industryIds: ["4"], locations: ["United States"], maxItems: 20, scraperMode: "full" })
    .serialized_input.industryIds, undefined);
  // The job search's industryIds is the JOB's industry — not a company population.
  const job = discoverySpec(withBrain(), { jobTitles: ["engineer"], industryIds: ["4"], maxItems: 20 }, "apify_linkedin_job_search");
  assertEquals(job.serialized_input.industryIds, undefined);
});

Deno.test("POPULATION: a search row's industry is still only PLAUSIBLE — the filter proves nothing", () => {
  const row = { id: 1, name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme", industries: [{ id: 4, name: "Software Development" }], employeeCount: 20 };
  const items = observationFromCompany(normalizeLinkedInCompanyCandidate(row), {
    capability: "general_company_discovery", actor_key: SEARCH, provider: "apify", route_id: null, plan_version: null,
    provider_call_id: "pc", mission_id: "t", observed_at: new Date().toISOString(),
  }).evidence;
  assert(items.filter((i) => i.dimension !== "identity").every((i) => i.status === "plausible"));
});

// ═══════════════════════════════════════════ 2. failed candidates stop ══

const RUNS = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/run-1e52d43c/apify_runs.json", import.meta.url)));
const li = (name: string, count?: number): Record<string, unknown> => {
  for (const run of Object.values(RUNS) as Array<{ dataset_items?: Record<string, unknown>[] }>) {
    const h = (run.dataset_items ?? []).find((r) => r.name === name && typeof r.employeeCount === "number" &&
      Array.isArray(r.locations) && (count === undefined || r.employeeCount === count));
    if (h) return structuredClone(h);
  }
  throw new Error(name);
};
const NOW = new Date();
const ctx = (actor: string) => ({
  capability: actor.includes("details") ? "company_enrichment" : "general_company_discovery", actor_key: actor,
  provider: "apify", route_id: null, plan_version: null, provider_call_id: "pc", mission_id: "t", observed_at: NOW.toISOString(),
});
const CRITERIA = deriveMissionCriteria(withBrain(), PROBE);
function candidate(key: string, row: Record<string, unknown>, enriched: boolean) {
  const items = [
    ...observationFromCompany(normalizeLinkedInCompanyCandidate(row), ctx(SEARCH)).evidence,
    ...(enriched ? observationFromCompany(normalizeLinkedInCompanyEnriched(row), ctx("apify_linkedin_company_details")).evidence : []),
  ];
  const graph = buildCompanyEvidenceGraph(key, items, { now: NOW });
  const e = evaluateEligibility(CRITERIA, graph);
  return {
    company_key: key, name: String(row.name), domain: null, linkedin_url: String(row.linkedinUrl), graph,
    eligibility: e.eligibility, hard_checks: (e.checks ?? []).filter((c) => c.kind === "hard"), attempted_routes: [],
  };
}
const atomusTargets = (pool: ReturnType<typeof candidate>[]) =>
  verificationTargets({ route_actor: "apify_funding_atomus", max_targets: 6 }, pool as never,
    (id) => CRITERIA.find((c) => c.id === id)?.value, undefined, PROBE).map((t) => t.company_key);

Deno.test("VIABILITY: enriched, country and size PASS, funding open → the only Atomus target", () => {
  const tara = candidate("tara", li("Tara AI"), true); // US, 27 employees
  assertEquals(tara.eligibility, "pending");
  assertEquals(tara.hard_checks.map((h) => [h.dimension, h.result]),
    [["geography", "pass"], ["company_size", "pass"], ["funding", "unknown"]]);
  assertEquals(atomusTargets([tara]), ["tara"]);
});

Deno.test("VIABILITY: a size FAIL after enrichment rejects the candidate — no Atomus is bought for it", () => {
  const further = candidate("further", li("FurtherAI"), true); // 64 employees
  assertEquals(further.eligibility, "ineligible");
  assert(further.hard_checks.some((h) => h.dimension === "company_size" && h.result === "fail"));
  assertEquals(atomusTargets([further]), []);
});

Deno.test("VIABILITY: cheap claims not yet read (no enrichment) → enrichment first, no Atomus", () => {
  // Canary 6e4a93b9 bought atomus for a candidate screened out before enrichment.
  const unread = candidate("uplane", li("Uplane", 19), false);
  assertEquals(unread.eligibility, "pending");
  assertEquals(atomusTargets([unread]), []);
  // The same company, once enriched and viable, is a target.
  assertEquals(atomusTargets([candidate("uplane", li("Uplane", 19), true)]), ["uplane"]);
});

Deno.test("VIABILITY: a pool keeps only the viable candidates for the verifier", () => {
  const pool = [candidate("tara", li("Tara AI"), true), candidate("further", li("FurtherAI"), true), candidate("uplane", li("Uplane", 19), false)];
  assertEquals(atomusTargets(pool), ["tara"]);
});
