// THE RUN THIS ARCHITECTURE WAS CHANGED FOR.
//
// Production run 25f3ff57-8d1c-435b-b5dc-eae769c1373d, 2026-08-18 11:36Z, on
// build d6022d38. The user asked for:
//
//     "Find 10 qualified AI startups in the United States that are currently
//      hiring software engineers."
//
// What the forensic audit found, in order:
//
//   1. The mission compiler read the request correctly and asked for
//      `startup_company_discovery`.
//   2. The capability gate APPROVED it — `rejected: []`.
//   3. `buildCapabilityGraph` then overrode the entry to
//      `general_company_discovery`, because the mission's `source_strategy`
//      array CONTAINED `job_signal_first`. It tested membership, not order;
//      the mission's own first preference was `startup_cohort_first`.
//   4. That capability declared one provider, so the override was not a route
//      change but a tool change: `apify_linkedin_company_search`.
//   5. `resolveDiscoveryStrategy()` was called from exactly one place — inside
//      `if (cap === "startup_company_discovery")` — so the planner, the closed
//      catalog, `not_for`, the repair round and the Agentory briefing were all
//      bypassed.
//   6. A deterministic compiler wrote the input from two mission fields:
//      `searchQuery: "AI"` and `searchQuery: "startup"`.
//   7. 100 rows: 26 accelerator communities, 22 newsletters, 6 large-company
//      subpages, a podcast. 3 enriched (Leena AI — India, DeepLearning.AI —
//      education, Scale AI — 7,109 people). 0 qualified. Nothing persisted.
//
// Every step below is asserted. If any one of them regresses, this file fails
// with the reason rather than with a count.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  validateDiscoveryStrategy, buildDiscoveryPlannerPayload,
} from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const QUERY =
  "Find 10 qualified AI startups in the United States that are currently hiring software engineers.";

/**
 * The proposal the live mission compiler actually returned, reconstructed from
 * `messages.198b463c` → `metadata.lead_mission.query_interpretation`.
 *
 * `preferred_source_strategy` is the field that mattered: the model ranked
 * `startup_cohort_first` FIRST and `job_signal_first` second, and the router
 * read only membership.
 */
const PROPOSAL = {
  requested_opportunity_count: 10,
  requested_contact_ready_count: null,
  company_types: ["AI", "startup"],
  geographies: ["United States"],
  employee_range: { min: null, max: null },
  decision_maker_roles: [],
  hard_constraints: [
    { field: "geographies", operator: "includes", value: "United States",
      reason: "Request specifies United States." },
    { field: "hiring_role", operator: "includes", value: "software engineers",
      reason: "Request specifies companies hiring software engineers." },
    { field: "company_types", operator: "includes", value: ["AI", "startup"],
      reason: "Request specifies AI startups." },
  ],
  soft_preferences: [],
  preferred_signals: ["hiring"],
  adjacent_signals: [], excluded_signals: [],
  allowed_broadening: {
    role_families: [], company_types: [], geographies: [],
    employee_range: { min: null, max: null },
  },
  disallowed_broadening: [],
  required_evidence: ["embedded_hiring_evidence"],
  required_capabilities: [
    "startup_company_discovery", "embedded_hiring_evidence",
    "company_semantic_evaluation", "portfolio_ranking", "offer_founder_unlock",
  ],
  preferred_source_strategy: ["startup_cohort_first", "job_signal_first"],
  evaluation_instructions:
    "Select AI startups in the United States that are currently hiring software " +
    "engineers, using embedded hiring evidence.",
  founder_unlock_recommended: true,
  confidence: 1,
  unknowns: [],
  known_companies: [],
  required_signal_terms: ["software engineers"],
  geography_is_hard: true,
};

const mission = () =>
  compileLeadMission({ originalUserQuery: QUERY, proposal: PROPOSAL }).final_mission;

interface Recorder { calls: string[]; inputs: unknown[] }
function deps(rows: Record<string, Record<string, unknown>[]>, rec: Recorder): CapabilityEngineDeps {
  return {
    invoke: (call: CompiledActorCall<unknown>) => {
      rec.calls.push(call.actorKey);
      rec.inputs.push(call.input);
      return Promise.resolve(rows[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  };
}

/** One memo23 row, shaped as the live YC scraper returns it. */
function ycRow(name: string, slug: string, jobs: number) {
  return {
    id: slug, name, slug, batch: "Summer 2025", teamSize: 15,
    industry: "B2B", subindustry: "B2B -> Engineering, Product and Design",
    tags: ["Artificial Intelligence", "AI"],
    oneLiner: `${name} builds AI infrastructure.`,
    website: `https://${slug}.com`,
    url: `https://www.ycombinator.com/companies/${slug}`,
    regions: ["United States of America"], allLocations: ["San Francisco, CA"],
    isHiring: true, nonprofit: false, topCompany: false, stage: "Early",
    openJobs: Array.from({ length: jobs }, (_, i) => ({
      title: "Software Engineer", role: "engineering",
      location: "San Francisco, CA", url: `https://x/${slug}/${i}`,
    })),
  };
}

// ═══════════════════════════════════ 1. the mission is read correctly ══

Deno.test("25f3ff57 · the mission still preserves every requirement", () => {
  const m = mission();
  assertEquals(m.company_profile.locations, ["United States"]);
  assert(m.company_profile.verticals.includes("AI"),
    "the AI vertical is the user's own word and must survive");
  assertEquals(m.requested_count, 10);
  assertEquals(m.required_signal_terms, ["software engineers"]);
  assert(m.geography_is_hard);
});

// ═════════════════════════════ 2. the routing override is gone ══

Deno.test("25f3ff57 · job_signal_first no longer discards the approved capability", () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);

  // THE REGRESSION. This was `general_company_discovery` in production, chosen
  // by a branch that matched `job_signal_first` before it ever looked at what
  // the gate had approved.
  assertEquals(plan.entry_capability, "startup_company_discovery",
    "the mission asked for startup-cohort discovery and the gate approved it");
  assert(/startup-cohort/.test(plan.routing_reason),
    `the reason must name what was actually chosen: ${plan.routing_reason}`);

  // The constraint the deleted branch encoded is not lost — it is advisory now.
  assert(plan.routing_advisories.some((a) => /hiring-first/i.test(a)),
    "the hiring-first fact still reaches the planner");
});

Deno.test("25f3ff57 · the mission never records its own approved capability as prohibited", () => {
  const plan = buildCapabilityGraph(mission());
  assertFalse(plan.prohibited.includes("startup_company_discovery"),
    "production recorded the approved capability as PROHIBITED — the router's " +
    "override written back onto the mission as though the model had forbidden it");
});

// ═══════════════════════ 3. a name matcher cannot serve this mission ══

Deno.test("25f3ff57 · not_for now REFUSES the actor that ran in production", () => {
  const m = mission();
  const v = validateDiscoveryStrategy([{
    actor_key: "apify_linkedin_company_search",
    role: "primary",
    // The exact input production sent.
    input: { searchQuery: "AI", locations: ["United States"], scraperMode: "full" },
    rationale: "what the deterministic compiler did",
  }], m);

  assertEquals(v.source, "blocked");
  const codes = v.violations.map((x) => x.code);
  assert(codes.includes("actor_not_for_semantic_discovery"),
    `expected the not_for refusal, got ${codes.join(", ")}`);
  // AND THE REFUSAL EXPLAINS ITSELF, because it is handed back to the planner.
  const msg = v.violations.find((x) => x.code === "actor_not_for_semantic_discovery")!.message;
  assert(/name matcher/i.test(msg), msg);
  assert(/AI/.test(msg), "the refusal names the concept that cannot be searched");
});

Deno.test("25f3ff57 · a startup cohort source IS allowed for this mission", () => {
  const v = validateDiscoveryStrategy([{
    actor_key: "apify_yc_companies_memo23",
    role: "primary",
    input: { mode: "companies", isHiring: true, regions: ["United States of America"] },
    rationale: "startup cohort with embedded hiring evidence",
  }], mission());
  assertEquals(v.source, "model_validated");
  assertEquals(v.selections.map((s) => s.actor_key), ["apify_yc_companies_memo23"]);
});

// ══════════════════════════ 4. the planner is actually consulted ══

Deno.test("25f3ff57 · the discovery planner is reached, and its choice is what runs", async () => {
  const rec: Recorder = { calls: [], inputs: [] };
  const m = mission();
  let plannerSawMission = false;

  const planner = (i: { payload: Record<string, unknown> }) => {
    // THE POINT OF THE WHOLE REFACTOR: this ran at all. In production it did
    // not, because the capability the router chose had its own branch.
    const p = i.payload as { compiled_mission?: { verticals?: string[] } };
    plannerSawMission = !!p.compiled_mission?.verticals?.includes("AI");
    return Promise.resolve([{
      actor_key: "apify_yc_companies_memo23",
      role: "primary",
      input: { mode: "companies", isHiring: true, regions: ["United States of America"] },
      rationale: "the cohort carries embedded hiring evidence",
    }]);
  };

  await runCapabilityPlan(
    { planDiscovery: planner, ...deps({
      apify_yc_companies_memo23: [ycRow("Retell AI", "retell-ai", 26), ycRow("F2", "f2", 3)],
    }, rec) },
    { mission: m, plan: buildCapabilityGraph(m) },
  );

  assert(plannerSawMission, "the planner is given the compiled mission, AI vertical and all");
  assert(rec.calls.includes("apify_yc_companies_memo23"),
    `the planner's choice is what ran; calls were ${rec.calls.join(", ")}`);
  assertFalse(
    rec.inputs.some((i) => {
      const q = (i as { searchQuery?: unknown }).searchQuery;
      return q === "AI" || q === "startup";
    }),
    'no actor is ever handed the bare concept tokens "AI" or "startup" again',
  );
});

Deno.test("25f3ff57 · the planner payload carries the playbook it must read", () => {
  const payload = buildDiscoveryPlannerPayload(mission()) as {
    available_actors: Array<{ actor_key: string; not_for?: string[] }>;
  };
  const card = payload.available_actors
    .find((a) => a.actor_key === "apify_linkedin_company_search");
  assert(card, "the actor that failed in production is in the catalog shown to GPT");
  assert((card!.not_for ?? []).some((n) => /semantic|concept/i.test(n)),
    "and its not_for is what the model is asked to read");
});

// ══════════════════════════════════ 5. the pool is the right shape ══

Deno.test("25f3ff57 · the pool carries embedded hiring evidence, which the mission requires", async () => {
  const rec: Recorder = { calls: [], inputs: [] };
  const m = mission();
  const run = await runCapabilityPlan(
    { planDiscovery: stubDiscoverySelector(), ...deps({
      apify_yc_companies_memo23: [
        ycRow("Retell AI", "retell-ai", 26),
        ycRow("AfterQuery", "afterquery", 11),
        ycRow("AgentMail", "agentmail", 6),
      ],
    }, rec) },
    { mission: m, plan: buildCapabilityGraph(m) },
  );

  assert(run.companies.length > 0, "a pool exists");
  // THE DIFFERENCE FROM PRODUCTION, IN ONE ASSERTION. The 100 rows the name
  // matcher returned carried no hiring field at all; `open_jobs_evaluated` was
  // 0 for a mission whose required evidence was `embedded_hiring_evidence`.
  const withJobs = run.companies.filter((c) => c.yc_open_jobs.length > 0);
  assertEquals(withJobs.length, run.companies.length,
    "every discovered company carries the hiring evidence the mission demands");
});
