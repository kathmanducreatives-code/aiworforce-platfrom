// Q3 — THE CUSTOMER'S INTENT SURVIVES COMPILATION. Reproducible contracts for
// the defects Q3 owns, written BEFORE the fix: each failing case is a visible
// known gap, ignored by default and red with `Q3_ASSERT_GAPS=1` (the same
// convention as the A7 and audit lanes). Remove an id from KNOWN_GAPS when its
// fix lands. Every gap has a positive control that must keep passing.
//
// The compiler contracts for founder-social necessity (C01, L08), cross-signal
// OR (C02), per-clause windows (C04) and sales-team growth (H04) are taken from
// Codex's routing audit (`independentRoutingAudit.test.ts`, aca94e6b) — the
// same requests and proposal shape — so this stack's own CI holds them; the
// full runtime scenarios stay in that harness, which runs unchanged against
// this stack via ROUTING_AUDIT_SOURCE_ROOT.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria, type MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";

/** Ids whose fix has not landed. Each runs only under Q3_ASSERT_GAPS=1. */
const KNOWN_GAPS = new Set([
  "C01-necessity", "L08-necessity", "C02-or", "C04-windows", "H04-growth",
]);
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

// ══════════════════════════════════ recruiting agencies at discovery (H05) ══

import { discoveryAgencyRejection, missionTargetsIntermediaries } from "../../../supabase/functions/_shared/companyAggregatorEvidence.ts";

Deno.test("Q3 H05: discovery admits an agency employer only when the customer asks for intermediaries", () => {
  const asked = missionTargetsIntermediaries({ mission_verticals: ["recruiting agencies"] });
  const notAsked = missionTargetsIntermediaries({ mission_verticals: ["B2B software"] });
  assertEquals(asked.targets, true);
  assertEquals(discoveryAgencyRejection("employer_industry:Staffing and Recruiting", asked), null, "admitted: it is the ICP");
  assertEquals(discoveryAgencyRejection("employer_industry:Staffing and Recruiting", notAsked), "employer_industry:Staffing and Recruiting",
    "every other mission still drops agencies before any paid stage");
  assertEquals(discoveryAgencyRejection(null, notAsked), null);
  // A posting the agency advertises for a client is still never its own hiring
  // proof: `jobEmployerIdentityConflict` → "agency_client_posting" (H06).
});


// ════════════════════════ clause necessity, OR, windows, growth (Codex audit) ══

/** The routing audit's proposal shape (independentRoutingAudit.test.ts `proposal`). */
const routingProposal = (signal: string[], capabilities?: string[], strategies?: string[]) => ({
  requested_opportunity_count: 1, company_types: ["B2B software"], geographies: [], employee_range: { min: null, max: null },
  output_intent: "qualified_companies", preferred_signals: signal, required_signal_terms: signal,
  required_capabilities: capabilities ?? ["general_company_discovery", "embedded_hiring_evidence", "company_semantic_evaluation"],
  strategies: strategies ?? ["hiring"], confidence: 0.95,
});
const FOUNDER_CAPS = ["general_company_discovery", "embedded_hiring_evidence", "offer_founder_unlock"];
const compiledMission = (query: string, proposal: Record<string, unknown>) =>
  compileLeadMission({ originalUserQuery: query, proposal: proposal as never }).final_mission;
const criteriaOf = (query: string, proposal: Record<string, unknown>) => deriveMissionCriteria(compiledMission(query, proposal));
const dim = (cs: MissionCriterion[], d: string) => cs.find((c) => c.dimension === d);

Deno.test("Q3 C01-necessity: 'whose founder MUST have discussed…' compiles the social clause as mandatory", gap("C01-necessity"), () => {
  const q = "Find 1 B2B software company that must be hiring Account Executives AND whose founder must have discussed outbound problems on LinkedIn.";
  const cs = criteriaOf(q, routingProposal(["hiring Account Executives", "founder comments about outbound problems"], FOUNDER_CAPS, ["hiring", "multi_signal"]));
  assertEquals(dim(cs, "social_activity")?.kind, "hard");
});

Deno.test("Q3 L08-necessity: the mandatory founder clause first, hiring second — still mandatory", gap("L08-necessity"), () => {
  const q = "Find 1 B2B software company whose founder must have commented about outbound problems, and which must be hiring Account Executives.";
  const cs = criteriaOf(q, routingProposal(["founder comments on outbound problems", "hiring Account Executives"], FOUNDER_CAPS, ["hiring", "multi_signal"]));
  assertEquals(dim(cs, "social_activity")?.kind, "hard");
});

Deno.test("Q3 necessity control: an 'ideally' founder clause stays a preference", () => {
  const q = "Find 1 B2B software company that should ideally be hiring Account Executives, and whose founder has ideally discussed outbound problems on LinkedIn.";
  const cs = criteriaOf(q, routingProposal(["hiring Account Executives", "founder comments about outbound problems"], FOUNDER_CAPS, ["hiring", "multi_signal"]));
  assertEquals(dim(cs, "social_activity")?.kind, "target");
});

Deno.test("Q3 C02-or: 'hiring … OR having raised funding' is ONE requirement either signal satisfies", gap("C02-or"), () => {
  const q = "Find 1 B2B software company hiring Account Executives OR having raised funding in the last 90 days.";
  const cs = criteriaOf(q, routingProposal(["hiring Account Executives", "recent funding"], undefined, ["hiring", "funding"]));
  assert(cs.filter((c) => ["hiring", "funding"].includes(c.dimension)).some((c) => (c.any_of?.length ?? 0) > 1),
    "the cross-signal alternative survives compilation");
});

Deno.test("Q3 OR control: 'hiring … AND raised funding' stays two mandatory requirements", () => {
  const q = "Find 1 B2B software company hiring Account Executives AND having raised funding in the last 90 days.";
  const cs = criteriaOf(q, routingProposal(["hiring Account Executives", "recent funding"], undefined, ["hiring", "funding"]));
  assertEquals([dim(cs, "hiring")?.kind, dim(cs, "funding")?.kind], ["hard", "hard"]);
  assertEquals([dim(cs, "hiring")?.any_of, dim(cs, "funding")?.any_of], [undefined, undefined]);
});

Deno.test("Q3 C04-windows: each clause keeps its own window — 7 days hiring, 30 days founder comments", gap("C04-windows"), () => {
  const q = "Find 1 B2B software company hiring Account Executives in the last 7 days AND whose founder must have commented on outbound in the last 30 days.";
  const cs = criteriaOf(q, routingProposal(["hiring Account Executives", "founder comments about outbound"], FOUNDER_CAPS, ["hiring", "multi_signal"]));
  assertEquals([dim(cs, "hiring")?.time_window?.days, dim(cs, "social_activity")?.time_window?.days], [7, 30]);
});

Deno.test("Q3 windows control: 7-day hiring and 90-day funding keep their own windows", () => {
  const q = "Find 1 B2B software company hiring Account Executives in the last 7 days AND that raised funding in the last 90 days.";
  const cs = criteriaOf(q, routingProposal(["hiring Account Executives", "recent funding"], undefined, ["hiring", "funding"]));
  assertEquals([dim(cs, "hiring")?.time_window?.days, dim(cs, "funding")?.time_window?.days], [7, 90]);
});

Deno.test("Q3 H04-growth: 'rapidly expanding its sales team' is headcount growth, not expansion", gap("H04-growth"), () => {
  const q = "Find 1 B2B software company that must be rapidly expanding its sales team within the last 30 days.";
  const m = compiledMission(q, routingProposal(["rapidly expanding sales team"]));
  assert(m.required_signals.some((x) => x.type === "headcount_change" || x.type === "headcount_growth"), JSON.stringify(m.required_signals.map((x) => x.type)));
  assert(!m.required_signals.some((x) => x.type === "expansion"), "not geographic expansion");
});

Deno.test("Q3 growth control: 'expanding into Germany' stays expansion", () => {
  const q = "Find 1 B2B software company expanding into Germany within the last 30 days.";
  const m = compiledMission(q, routingProposal(["expanding into Germany"]));
  assert(m.required_signals.some((x) => x.type === "expansion"));
});
