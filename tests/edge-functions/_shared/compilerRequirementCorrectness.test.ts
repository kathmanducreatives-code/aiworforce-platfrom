// COMPILER REQUIREMENT CORRECTNESS (phased evaluation, 2026-10-01).
//
// Six phrasings from the evaluation, each compiled the way the chat brain's
// proposal reached the compiler in production (`chat_brain_understood`):
//
//   A  "recent funding" was a target → funding never verified, feasibility
//      reported it unsupported.
//   B  "are actively hiring salespeople" was a target (only a modal hardened).
//   C  "at least one currently open sales role" was a target AND user_inferred
//      (the reader missed "open … role"); "funding in the last 2 years" also
//      became a duplicate stage requirement.
//   D  "recent funding is still uncertain" left funding as the only signal, a
//      target → the whole mission was REFUSED (no_requirement_provable).
//   E  "verify funding recency" → same refusal.
//   F  "explain why each could be relevant" was dropped from the directives.
//
// The rule now: a signal stated as a fact in its own clause is a requirement;
// hedged language ("appears to", "signs", "may") stays a preference. "Recent"
// funding with no stated window runs on the product's canonical default
// (DEFAULT_SIGNAL_WINDOWS.funding, 180 days), labelled system_default.
//
// Every case is pure: `fetch` throws for the whole file.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria, type MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { assessRequestFeasibility } from "../../../supabase/functions/_shared/requestFeasibility.ts";
import { verifiedAfterEligibility } from "../../../supabase/functions/_shared/claimPlan.ts";
import { parseLeadMissionDeterministic, type LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

globalThis.fetch = () => { throw new Error("compiler correctness must not reach the network"); };

const BASE = {
  requested_opportunity_count: null as number | null, requested_contact_ready_count: null as number | null,
  company_types: [] as string[], geographies: [] as string[],
  employee_range: { min: null, max: null } as { min: number | null; max: number | null },
  decision_maker_roles: [], hard_constraints: [] as unknown[], soft_preferences: [],
  preferred_signals: [] as string[], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
  disallowed_broadening: [], required_evidence: [], required_capabilities: [],
  preferred_source_strategy: [], evaluation_instructions: "",
  founder_unlock_recommended: false, confidence: 1, unknowns: [],
  required_signal_terms: [] as string[], geography_is_hard: true, known_companies: [],
};

const QUERY = {
  A: "Find AI SaaS companies in the US with 11–50 employees, recent funding, and signs they are currently hiring.",
  B: "Find companies that sell B2B software, have 11–50 employees, raised funding in the last 24 months, and are actively hiring salespeople.",
  C: "Find 5 US AI SaaS companies with 11–50 employees, funding in the last 2 years, and at least one currently open sales role. Only qualify a company when every required claim has evidence.",
  D: "Find companies matching our ICP where company size and business model are proven, but recent funding is still uncertain. Keep uncertain companies pending rather than rejecting them.",
  E: "Find 5 companies that are AI software businesses with 11–50 employees. Verify company size from LinkedIn, verify business model from the company website, and verify funding recency separately from funding stage.",
  F: "Find US AI companies with 11–50 employees and explain why each could be relevant to Agentory.",
} as const;

const PROPOSAL: Record<keyof typeof QUERY, Partial<typeof BASE>> = {
  A: { company_types: ["AI SaaS"], geographies: ["United States"], employee_range: { min: 11, max: 50 }, preferred_signals: ["funding", "hiring"] },
  B: { company_types: ["B2B software"], employee_range: { min: 11, max: 50 }, preferred_signals: ["funding", "hiring"], required_signal_terms: ["salespeople"] },
  C: {
    requested_opportunity_count: 5, company_types: ["AI SaaS"], geographies: ["United States"], employee_range: { min: 11, max: 50 },
    preferred_signals: ["funding", "hiring"], required_signal_terms: ["sales role"],
    // The model filed the funding window as a stage too.
    hard_constraints: [{ field: "stage", operator: "eq", value: "funded within the last 2 years", reason: "stated in the request" }],
  },
  D: { preferred_signals: ["funding"] },
  E: { requested_opportunity_count: 5, company_types: ["AI software"], employee_range: { min: 11, max: 50 }, preferred_signals: ["funding"] },
  F: { company_types: ["AI"], geographies: ["United States"], employee_range: { min: 11, max: 50 } },
};

function compiled(id: keyof typeof QUERY, extra: Partial<typeof BASE> = {}): LeadMissionV1 {
  return compileLeadMission({
    originalUserQuery: QUERY[id], proposal: { ...BASE, ...PROPOSAL[id], ...extra } as never,
  }).final_mission as LeadMissionV1;
}
const criteria = (m: LeadMissionV1) => deriveMissionCriteria(m, PRODUCTION_READINESS);
const signal = (m: LeadMissionV1, k: "funding" | "hiring"): MissionCriterion => {
  const c = criteria(m).find((x) => x.dimension === k);
  assert(c, `${k} criterion`);
  return c;
};
const shape = (c: MissionCriterion) => [c.kind, c.time_window?.days ?? null, c.time_window?.source ?? null];
function feasibility(m: LeadMissionV1) {
  const plan = buildCapabilityGraph(m, { executability: "enforce", readiness: PRODUCTION_READINESS });
  return assessRequestFeasibility(m, plan, { executability: "enforce", readiness: PRODUCTION_READINESS });
}

// ── A ───────────────────────────────────────────────────────────────────────

Deno.test("A: 'recent funding' is a HARD requirement on the canonical 180-day default; 'signs they are hiring' stays soft", () => {
  const m = compiled("A");
  assertEquals(shape(signal(m, "funding")), ["hard", 180, "system_default"],
    "no window was stated: the canonical default, labelled a default — never the user's");
  assertEquals(signal(m, "hiring").kind, "target", "'signs they are…' is hedged language");
  const f = feasibility(m);
  assert(f.ok, JSON.stringify(f.refusals));
  const funding = f.requirements.find((r) => r.detail?.event === "funding");
  assertEquals([funding?.status, funding?.by_capability], ["satisfied", "funding_verification"],
    "feasibility sees the verifier execution selects for a hard funding claim");
});

// ── B ───────────────────────────────────────────────────────────────────────

Deno.test("B: 'raised funding in the last 24 months' is hard 730 days; 'actively hiring salespeople' is a HARD hiring claim", () => {
  const m = compiled("B");
  assertEquals(shape(signal(m, "funding")), ["hard", 730, "user_explicit"]);
  const hiring = signal(m, "hiring");
  assertEquals([hiring.kind, hiring.source], ["hard", "user_explicit"]);
  assert(feasibility(m).ok);
});

// ── C ───────────────────────────────────────────────────────────────────────

Deno.test("C: 'funding in the last 2 years' is hard 730 days; 'at least one currently open sales role' is a HARD, user-stated hiring claim", () => {
  const m = compiled("C");
  assertEquals(shape(signal(m, "funding")), ["hard", 730, "user_explicit"]);
  const hiring = signal(m, "hiring");
  assertEquals([hiring.kind, hiring.source], ["hard", "user_explicit"],
    "'open sales role' is a hiring cue the user stated, not one the model inferred");
  assert(feasibility(m).ok);
});

Deno.test("C: recency and stage are separate claims — a funding WINDOW is not filed as a stage", () => {
  const m = compiled("C");
  const stageLike = criteria(m).filter((c) =>
    c.dimension === "company_stage" || /funded within|last 2 years/i.test(JSON.stringify(c.value)));
  assertEquals(stageLike.filter((c) => c.dimension !== "funding"), [],
    `no duplicate stage requirement: ${JSON.stringify(stageLike.map((c) => [c.dimension, c.value]))}`);
});

// ── D ───────────────────────────────────────────────────────────────────────

Deno.test("D: uncertain recent funding is a hard claim that can stay PENDING — the mission is NOT refused", () => {
  const m = compiled("D");
  // "still uncertain" describes the evidence, not the requirement: an
  // unresolved hard claim is exactly what makes a company PENDING.
  assertEquals(shape(signal(m, "funding")), ["hard", 180, "system_default"]);
  const f = feasibility(m);
  assert(f.ok, `refused: ${JSON.stringify(f.refusals)}`);
  assertFalse(f.refusals.some((r) => r.code === "no_requirement_provable"));
  assert(verifiedAfterEligibility(m, "general_company_discovery").some((v) => v.claim === "recently_funded"),
    "the funding pair owns the claim after eligibility, so an unresolved company stays pending");
});

// ── E ───────────────────────────────────────────────────────────────────────

Deno.test("E: 'verify funding recency separately from funding stage' — recency is hard, stage is not invented", () => {
  const m = compiled("E");
  assertEquals(shape(signal(m, "funding")), ["hard", 180, "system_default"]);
  assertFalse(criteria(m).some((c) => c.dimension === "company_stage"), "no stage was asked for");
  const f = feasibility(m);
  assert(f.ok, `refused: ${JSON.stringify(f.refusals)}`);
});

// ── F ───────────────────────────────────────────────────────────────────────

Deno.test("F: an explanation request survives compilation into the directives", () => {
  const m = compiled("F") as LeadMissionV1 & { directives?: { evaluation_instructions?: string } };
  assertEquals(m.directives?.evaluation_instructions, "explain why each could be relevant to Agentory");
  // The model's own instruction, when it gives one, still wins.
  const own = compiled("F", { evaluation_instructions: "Rank by Agentory fit." }) as typeof m;
  assertEquals(own.directives?.evaluation_instructions, "Rank by Agentory fit.");
  // No explanation asked for → nothing is invented.
  const plain = compiled("B") as typeof m;
  assertEquals(plain.directives?.evaluation_instructions ?? "", "");
});

// ── the boundaries of the rule ──────────────────────────────────────────────

Deno.test("hedged language stays a preference; a stated window always wins over the default", () => {
  const kind = (q: string, k: "funding" | "hiring") =>
    deriveMissionCriteria(parseLeadMissionDeterministic(q)).find((c) => c.dimension === k)?.kind;
  assertEquals(kind("Find US SaaS companies that appear to be hiring.", "hiring"), "target");
  assertEquals(kind("Find US SaaS companies that may have recently raised funding.", "funding"), "target");
  assertEquals(kind("Find US SaaS companies that are actively hiring.", "hiring"), "hard");
  // A bare round names no recency: unchanged.
  assertEquals(kind("Find US SaaS companies that raised funding.", "funding"), "target");
  // Recency AND a stated window: the stated window, never the 180-day default.
  const windowed = deriveMissionCriteria(parseLeadMissionDeterministic(
    "Find US SaaS companies that raised funding in the last 3 years.")).find((c) => c.dimension === "funding");
  assertFalse(windowed?.time_window?.days === 180 && windowed?.kind === "hard", "a stated window is never replaced by the default");
});

Deno.test("'raised funding within the last 3 years' is hard 1095 days", () => {
  const m = compileLeadMission({
    originalUserQuery: "Find US SaaS companies with 11–50 employees that raised funding within the last 3 years.",
    proposal: { ...BASE, company_types: ["SaaS"], geographies: ["United States"], employee_range: { min: 11, max: 50 },
      preferred_signals: ["funding"] } as never,
  }).final_mission as LeadMissionV1;
  assertEquals(shape(signal(m, "funding")), ["hard", 1095, "user_explicit"]);
});

Deno.test("hedge words are read as hedges, not as dates or nouns", () => {
  const kind = (q: string) =>
    deriveMissionCriteria(parseLeadMissionDeterministic(q)).find((c) => c.dimension === "funding")?.kind;
  assertEquals(kind("Find US SaaS companies that recently raised funding in May."), "hard", "'May' is a month");
  assertEquals(kind("Find US SaaS companies that might have recently raised funding."), "target");
});
