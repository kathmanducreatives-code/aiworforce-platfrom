// A HEDGED SIZE RANKS AND NEVER REJECTS (TEST planning, 2026-11-01).
//
// "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees,
// but include strong opportunities outside that range and explain why." compiled
// to a HARD company_size 20–500 even when the model marked the size soft: the
// deterministic reading of the sentence made any stated range user_explicit, hence
// hard. A company whose declared band lay outside it was disproven. The sentence
// that states the range is now read with the compiler's HEDGE_RE (as for stage and
// location); an unhedged range is still a requirement.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { sizeClauseHedged } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { requirementsFromMission } from "../../../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { sharedCriteria } from "../../../supabase/functions/_shared/discoveryProviders/sharedQualification.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { specFromMission } from "../../../supabase/functions/_shared/leadPipeline/strategy.ts";

const QUERY = "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees, but include strong opportunities outside that range and explain why.";
const proposal = (over: Record<string, unknown> = {}) => ({
  requested_opportunity_count: 5, requested_contact_ready_count: null, company_types: [], geographies: ["United States"], employee_range: { min: null, max: null },
  decision_maker_roles: [], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }],
  soft_preferences: [{ field: "employee_range", value: { min: 20, max: 500 }, reason: "preferred" }], preferred_signals: ["hiring"], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } }, disallowed_broadening: [], required_evidence: [],
  required_capabilities: [], preferred_source_strategy: ["job_signal_first"], evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.85, unknowns: [],
  known_companies: [], signal_recency_days: 30, required_signal_terms: ["salespeople"], no_broadening_requested: false, geography_is_hard: true, prohibitions: [],
  output_intent: "companies", strategies: ["hiring"], ...over,
});
const sizeCriteria = (q: string, p = proposal()) =>
  ((compileLeadMission({ originalUserQuery: q, proposal: p, requestedCount: 5 }).final_mission as { criteria: { kind: string; dimension: string }[] }).criteria)
    .filter((c) => c.dimension === "company_size");

Deno.test("hedged size: the planning query's 20–500 is a preference, not a requirement", () => {
  assertEquals(sizeCriteria(QUERY).map((c) => c.kind), ["target"]);
  // Even when the model also fills employee_range, the user's hedge wins.
  assertEquals(sizeCriteria(QUERY, proposal({ employee_range: { min: 20, max: 500 } })).map((c) => c.kind), ["target"]);
  const m = compileLeadMission({ originalUserQuery: QUERY, proposal: proposal(), requestedCount: 5 }).final_mission;
  const spec = specFromMission(m as never, { defaultCount: 5 });
  assertEquals([spec.employees, spec.preferredEmployees], [null, { min: 20, max: 500 }]);
  assert(!requirementsFromMission(m as never).hard.some((h) => h.key === "employee_range"));
});

Deno.test("hedged size: an unhedged stated range is still a requirement", () => {
  assertEquals(sizeCriteria("Find 5 US companies with 20-500 employees currently hiring salespeople.").map((c) => c.kind), ["hard"]);
  assertEquals(sizeCriteria("Find 5 US companies with 20-500 employees hiring salespeople. Prefer fintech.").map((c) => c.kind), ["hard"], "a hedge in ANOTHER sentence does not soften the size");
});

Deno.test("hedged size: clause detection", () => {
  const r = { min: 20, max: 500 };
  assert(sizeClauseHedged("Prefer 20–500 employees.", r));
  assert(sizeClauseHedged("Ideally 20 to 500 employees.", r));
  assert(sizeClauseHedged("Companies of 20–500 people, but include ones outside that range.", r));
  assert(!sizeClauseHedged("Companies with 20–500 employees only.", r));
  assert(!sizeClauseHedged("Exactly 200 employees. Prefer SaaS.", { min: 200, max: 200 }));
});

Deno.test("hedged size: a company whose declared band is outside 20–500 is never disproven on size", () => {
  const m = compileLeadMission({ originalUserQuery: QUERY, proposal: proposal(), requestedCount: 5 }).final_mission;
  const criteria = sharedCriteria(m as { criteria?: unknown[] });
  const band = (min: number, max: number | null) => ({
    evidence_id: `b${min}`, company_key: "c", dimension: "company_size_band", value: { min, max }, status: "proven",
    source: { provider: "apify", actor: "apify_linkedin_company_details", provider_call_id: null, url: null, excerpt: null },
    method: "provider_field", observed_at: "2026-11-01T00:00:00Z", valid_until: null, confidence: "high", derived_from: [], mission_id: null, origin: "lead_mission",
  });
  for (const b of [band(1001, 5000), band(2, 10), band(10001, null)]) {
    const r = evaluateEligibility(criteria, buildCompanyEvidenceGraph("c", [b as never], { now: new Date("2026-11-01T12:00:00Z") }));
    assert(!r.disproven.some((d) => d.startsWith("company_size")), `band ${JSON.stringify(b.value)} must not disprove: ${JSON.stringify(r.disproven)}`);
  }
});
