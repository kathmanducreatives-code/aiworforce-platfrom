// Q3 — THE CUSTOMER'S INTENT SURVIVES COMPILATION. Reproducible contracts for
// the defects Q3 owns, written BEFORE the fix: each failing case is a visible
// known gap, ignored by default and red with `Q3_ASSERT_GAPS=1` (the same
// convention as the A7 and audit lanes). Remove an id from KNOWN_GAPS when its
// fix lands. Every gap has a positive control that must keep passing.
//
// The runtime and compiler contracts for founder-social necessity (C01, L08),
// cross-signal OR (C02), per-clause windows (C04), sales-team growth (H04) and
// recruiting-agency discovery (H05) live in Codex's routing audit
// (`independentRoutingAudit.test.ts`, commit aca94e6b), which runs unchanged
// against this stack via ROUTING_AUDIT_SOURCE_ROOT — they are not duplicated.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria, type MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";

/** Ids whose fix has not landed. Each runs only under Q3_ASSERT_GAPS=1. */
const KNOWN_GAPS = new Set(["S02-scope", "G08-unsupported", "G08b-exact-size", "PHANTOM-startup"]);
const gap = (id: string) => ({ ignore: KNOWN_GAPS.has(id) && Deno.env.get("Q3_ASSERT_GAPS") !== "1" });

/** The reviewed A7 proposal (tests/db-contract/lib/discoveryScenario.ts), inlined: that module needs a database. */
const A7 = "Find 1 US B2B software company with a current declared 11–50 employee band and an open Account Executive posting dated within 30 days.";
const PROPOSAL = {
  requested_opportunity_count: 1, requested_contact_ready_count: null,
  company_types: ["B2B software"], geographies: ["United States"], geography_is_hard: true,
  employee_range: { min: 11, max: 50 }, decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
  preferred_signals: ["hiring Account Executive"], required_signal_terms: ["Account Executive"], signal_recency_days: 30,
  adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
  disallowed_broadening: ["geography", "role", "size"], required_evidence: [],
  required_capabilities: ["general_company_discovery", "embedded_hiring_evidence", "company_semantic_evaluation"],
  preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.99, unknowns: [],
};
const compiled = (query: string, proposal: Record<string, unknown> = PROPOSAL) =>
  deriveMissionCriteria(compileLeadMission({ originalUserQuery: query, proposal: proposal as never }).final_mission);
const hard = (cs: MissionCriterion[], dim: string) => cs.filter((c) => c.kind === "hard" && c.dimension === dim);

// ═══════════════════════════════════════════════════ S02 / S03b — scope ══
//
// The A7 request says "US B2B software company" and names no scope. Today the
// compiled criterion carries none, so the RUNTIME evaluator's own scope answer
// decides it (#113 adopts it), and a model answering "presence" qualifies a
// Canadian-HQ company with a US office (A7 S02). Scope must be frozen at
// compile time, where the customer's words are, never chosen later.

Deno.test("Q3 S02-scope: an unscoped hard geography is frozen as HEADQUARTERS at compile time", gap("S02-scope"), () => {
  const geo = hard(compiled(A7), "geography");
  assertEquals(geo.length, 1);
  assertEquals(geo[0].geography_scope, "headquarters", "the evaluator must not be the one to choose");
});

Deno.test("Q3 S02 control: explicit office presence compiles as PRESENCE, explicit HQ as HEADQUARTERS", () => {
  const office = hard(compiled("Find 1 B2B software company with an office in the US, 11–50 employees, hiring Account Executives in the last 30 days.",
    { ...PROPOSAL, geography_scope: "presence" }), "geography");
  assertEquals(office[0]?.geography_scope, "presence");
  const hq = hard(compiled("Find 1 US-headquartered B2B software company hiring Account Executives.", { ...PROPOSAL, geography_scope: "headquarters" }), "geography");
  assertEquals(hq[0]?.geography_scope, "headquarters");
});

// ═══════════════════════════════════════ phantom requirements (G08 root) ══
//
// "Must be seed-stage" says nothing about being a "startup", yet the
// deterministic parser's startup vocabulary includes stage words, so it compiles
// a MANDATORY, user_explicit "Company kind: startup" that nothing can prove.
// Enforcing unsupported mandatory criteria (G08) before this is fixed would
// block every seed-stage mission over a requirement the customer never made.

Deno.test("Q3 PHANTOM-startup: 'seed-stage' never compiles a mandatory company kind the user did not say", gap("PHANTOM-startup"), () => {
  for (const q of ["Find 1 B2B SaaS company that must be seed-stage", "Find seed-stage fintech companies"]) {
    const kind = deriveMissionCriteria(parseLeadMissionDeterministic(q)).filter((c) => c.id === "company_stage:startup" && c.kind === "hard");
    assertEquals(kind, [], q);
  }
});

Deno.test("Q3 PHANTOM control: a request that SAYS 'startups' keeps the company kind it stated", () => {
  const cs = deriveMissionCriteria(parseLeadMissionDeterministic("Find B2B SaaS startups in the US"));
  const kind = cs.find((c) => c.id === "company_stage:startup");
  assert(kind, "the user's own word is kept");
  assertEquals(kind!.source, "user_explicit");
});

// ════════════════════════════════════ unsupported mandatory (G08, G08b) ══

const NOW = new Date();
let seq = 0;
const item = (dimension: EvidenceItem["dimension"], value: unknown): EvidenceItem => ({
  evidence_id: `q3_${++seq}`, company_key: "co", dimension, value, status: "proven",
  source: { provider: "fixture", actor: "fixture", provider_call_id: null, url: null, excerpt: null },
  method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high",
  derived_from: [], mission_id: null, origin: "lead_mission",
});
const criterion = (dimension: MissionCriterion["dimension"], value: unknown, over: Partial<MissionCriterion> = {}): MissionCriterion => ({
  id: `${dimension}:q3`, dimension, kind: "hard", value, label: String(value), source: "user_explicit",
  user_phrase: String(value), rationale: "customer requirement", status: "ok", ...over,
});

Deno.test("Q3 G08-unsupported: a mandatory requirement no source can establish keeps the company pending", gap("G08-unsupported"), () => {
  const business = criterion("business_model", "b2b_software");
  const unsupported = criterion("expansion", "facility in Germany", { status: "unprovable_today" });
  const g = buildCompanyEvidenceGraph("co", [item("business_model", "b2b_software")], { now: NOW });
  assertEquals(evaluateEligibility([business, unsupported], g).eligibility, "pending");
});

Deno.test("Q3 G08 control: an unsupported PREFERENCE never blocks", () => {
  const business = criterion("business_model", "b2b_software");
  const preference = criterion("expansion", "facility in Germany", { status: "unprovable_today", kind: "target" });
  const g = buildCompanyEvidenceGraph("co", [item("business_model", "b2b_software")], { now: NOW });
  assertEquals(evaluateEligibility([business, preference], g).eligibility, "eligible");
});

Deno.test("Q3 G08b-exact-size: 'exactly 23 employees' is a requirement, never dropped or passed on unrelated proof", gap("G08b-exact-size"), () => {
  const cs = compiled("Find 1 B2B software company with exactly 23 employees", { ...PROPOSAL, employee_range: { min: 23, max: 23 } });
  const size = hard(cs, "company_size");
  assertEquals(size.length, 1, "the size the customer stated is a mandatory criterion");
  const g = buildCompanyEvidenceGraph("co", [item("business_model", "b2b_software"), item("geography", "Boston, United States")], { now: NOW });
  assertEquals(evaluateEligibility(cs, g).eligibility === "eligible", false, "not eligible without any size evidence");
});
