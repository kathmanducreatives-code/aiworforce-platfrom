// A COMPANY BRAIN INDUSTRY THAT CHOOSES THE SEARCH SAYS SO ON THE CARD.
//
// The production smoke of 2026-10-08 (task ea562324) asked for "1 US company
// with 11–50 employees …" and named no industry. The Company Brain filled two
// (B2B SaaS; recruiting / staffing), the card listed them under "Target
// criteria" — which reads as ranking only — and the LinkedIn company search ran
// with industryIds 4, 6, 104 and 137 taken from them. These tests run the same
// chain pilot-chat runs (compile → Brain merge → graph → preview → card) and
// pin that the card now says so, only when it is true.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { mergeCompanyBrainIntoMission } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { assessRequestFeasibility } from "../../../supabase/functions/_shared/requestFeasibility.ts";
import { buildMissionPreview, type MissionPreview } from "../../../supabase/functions/_shared/missionPreview.ts";
import { buildMissionConfirmation } from "../../../supabase/functions/_shared/missionConfirmationCard.ts";
import { icpDiscoveryConstraints } from "../../../supabase/functions/_shared/icpDiscoveryConstraints.ts";
import { POPULATION_FILTER_ACTORS } from "../../../supabase/functions/_shared/providerCallSpec.ts";
import { readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";

globalThis.fetch = () => { throw new Error("the card must not reach the network"); };

const SMOKE = "Find 1 US company with 11–50 employees that raised funding in the last 24 months and is currently hiring sales.";
// The smoke workspace's Brain industries, as the smoke's card showed them.
const BRAIN = {
  industries: ["b2b saas (founder-led or small teams)", "recruiting / talent acquisition / staffing agencies"],
};
const NOTE = "also chooses which companies are searched";

function proposal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requested_opportunity_count: 1, requested_contact_ready_count: null,
    company_types: [], geographies: ["United States"], geography_is_hard: true,
    employee_range: { min: 11, max: 50 }, decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
    preferred_signals: ["raised funding in the last 24 months", "currently hiring sales"],
    adjacent_signals: [], excluded_signals: [],
    allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
    disallowed_broadening: [], required_evidence: [], required_capabilities: [], preferred_source_strategy: [],
    evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.8, unknowns: [], ...over,
  };
}

/** pilot-chat's chain: compile, merge the Brain, plan, assess, preview, card. */
function pilotCard(query: string, over: Record<string, unknown> = {}, brain: Record<string, unknown> | null = BRAIN) {
  const compiled = compileLeadMission({
    originalUserQuery: query, proposal: proposal(over), ...(brain ? { companyBrain: brain } : {}),
  });
  const mission = brain ? mergeCompanyBrainIntoMission(compiled.final_mission, brain as never).mission : compiled.final_mission;
  const readiness = readinessPolicy({ mode: "production" } as never);
  const plan = buildCapabilityGraph(mission as never, { readiness } as never);
  const feasibility = assessRequestFeasibility(mission, plan, { readiness } as never);
  const preview = buildMissionPreview(mission, plan, feasibility);
  return { mission, preview, card: buildMissionConfirmation(mission, preview, query) };
}

const searchesLinkedIn = (p: MissionPreview) =>
  p.steps.some((s) => s.providers.some((a) => POPULATION_FILTER_ACTORS.has(a)));

Deno.test("smoke sentence + Brain industries: the card names the LinkedIn industries the search uses", () => {
  const { mission, preview, card } = pilotCard(SMOKE);
  assertEquals(mission.field_provenance?.["company_profile.verticals"], "company_brain");
  assert(searchesLinkedIn(preview), JSON.stringify(preview.steps.map((s) => s.providers)));

  const target = card.criteria_sections.target;
  const saas = target.find((l) => l.startsWith("Industry: b2b saas"));
  const staffing = target.find((l) => l.startsWith("Industry: recruiting"));
  assertEquals(saas,
    "Industry: b2b saas (founder-led or small teams) · from your Company Brain · " +
    `${NOTE} (LinkedIn: Software Development; Technology, Information and Internet)`);
  assertEquals(staffing,
    "Industry: recruiting / talent acquisition / staffing agencies · from your Company Brain · " +
    `${NOTE} (LinkedIn: Staffing and Recruiting; Human Resources Services)`);

  // The card names exactly the population discovery would search — the smoke's
  // industryIds 4, 6, 104, 137 — no more, no less.
  assertEquals(new Set(icpDiscoveryConstraints(mission).industryIds), new Set(["4", "6", "104", "137"]));
});

Deno.test("the note is added to the target line only; nothing else on the card changes", () => {
  const withBrain = pilotCard(SMOKE).card.criteria_sections;
  for (const k of ["hard", "opportunity_signals", "hypotheses", "time_windows", "unsupported"] as const) {
    assertFalse(withBrain[k].some((l) => l.includes(NOTE)), `${k}: ${withBrain[k].join(" | ")}`);
  }
  assert(withBrain.hard.some((l) => l.startsWith("Geography: United States")));
  assert(withBrain.time_windows.some((l) => l.startsWith("Funding: last 730 days")));
});

Deno.test("an industry the user names is never annotated as the Brain's search", () => {
  const { mission, card } = pilotCard(
    "Find 1 US B2B SaaS company with 11–50 employees that raised funding in the last 24 months and is currently hiring sales.",
    { company_types: ["B2B SaaS"] },
  );
  assert(mission.field_provenance?.["company_profile.verticals"] !== "company_brain");
  const all = Object.values(card.criteria_sections).flat().filter((x): x is string => typeof x === "string");
  assertFalse(all.some((l) => l.includes(NOTE)), all.join(" | "));
});

Deno.test("no LinkedIn company search in the plan → no note, even for Brain industries", () => {
  const { mission, preview } = pilotCard(SMOKE);
  const noSearch: MissionPreview = {
    ...preview,
    steps: preview.steps.map((s) => ({ ...s, providers: s.providers.filter((a) => !POPULATION_FILTER_ACTORS.has(a)) })),
  };
  const card = buildMissionConfirmation(mission, noSearch, SMOKE);
  assert(card.criteria_sections.target.some((l) => l.startsWith("Industry: b2b saas")));
  assertFalse(card.criteria_sections.target.some((l) => l.includes(NOTE)), card.criteria_sections.target.join(" | "));
});

// Only what the Brain WROTE INTO the searched field chooses the population. A
// Brain refinement of a field the user closed ("Industry preference: …") is a
// target too, but discovery searches the user's value — and a criterion whose
// source disagrees with its field's provenance (a stale `criteria` array from
// before a later merge) is not the Brain's fill either.
Deno.test("only values the Brain filled into the searched field are annotated", () => {
  const named = pilotCard(
    "Find 1 US B2B SaaS company with 11–50 employees that raised funding in the last 24 months and is currently hiring sales.",
    { company_types: ["B2B SaaS"] },
  );
  const refinement = {
    id: "industry:staffing-agencies", kind: "target", dimension: "industry", value: "staffing agencies",
    label: "Industry preference: staffing agencies", source: "company_brain_preference",
    user_phrase: "", rationale: "your Company Brain narrows \"b2b saas\"", status: "ok",
  };
  const withRefinement = { ...named.mission, criteria: [...(named.mission.criteria ?? []), refinement] } as never;
  const a = buildMissionConfirmation(withRefinement, named.preview, SMOKE).criteria_sections.target;
  assert(a.some((l) => l.startsWith("Industry preference: staffing agencies")), a.join(" | "));
  assertFalse(a.some((l) => l.includes(NOTE)), a.join(" | "));

  const smoke = pilotCard(SMOKE);
  const stale = (smoke.mission.criteria ?? []).map((c) =>
    c.dimension === "industry" ? { ...c, source: "user_inferred" as const } : c);
  const b = buildMissionConfirmation({ ...smoke.mission, criteria: stale }, smoke.preview, SMOKE).criteria_sections.target;
  assert(b.some((l) => l.startsWith("Industry: b2b saas")), b.join(" | "));
  assertFalse(b.some((l) => l.includes(NOTE)), b.join(" | "));
});

Deno.test("a Brain industry that maps to no LinkedIn industry gets no note", () => {
  const { card } = pilotCard(SMOKE, {}, { industries: ["artisanal cheese cooperatives"] });
  const line = card.criteria_sections.target.find((l) => l.startsWith("Industry: artisanal"));
  assert(line, card.criteria_sections.target.join(" | "));
  assertFalse(line!.includes(NOTE), line);
});
