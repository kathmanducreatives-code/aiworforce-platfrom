// Q3 — CROSS-SIGNAL OR (Codex routing audit C02).
//
// "Find a company hiring Account Executives OR having raised funding in the
// last 90 days" is ONE requirement that either signal satisfies. It compiled as
// two hard requirements, so a company hiring AEs with no recorded round stayed
// pending forever, and because funding was present the plan entered through
// company search instead of the postings that prove hiring.
//
//   compile   the mandatory signals the request joins by "or" share `any_of`
//   decide    one alternative passing answers the group; a failed alternative
//             cannot reject while another is open; all failing rejects
//   route     the hiring-led entry stays when funding is only an alternative
//
// AND, hedged members and one signal's own alternatives are untouched.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  anyOfGroupKey, crossSignalAlternatives, deriveMissionCriteria, type MissionCriterion,
} from "../../../supabase/functions/_shared/missionCriteria.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { hiringLedMission } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";

const NOW = new Date();
const proposal = (signal: string[]) => ({
  requested_opportunity_count: 1, company_types: ["B2B software"], geographies: [], employee_range: { min: null, max: null },
  output_intent: "qualified_companies", preferred_signals: signal, required_signal_terms: signal,
  required_capabilities: ["general_company_discovery", "embedded_hiring_evidence", "company_semantic_evaluation"],
  strategies: ["hiring", "funding"], confidence: 0.95,
});
const mission = (q: string) => compileLeadMission({ originalUserQuery: q, proposal: proposal(["hiring Account Executives", "recent funding"]) as never }).final_mission;
const OR = "Find 1 B2B software company hiring Account Executives OR having raised funding in the last 90 days.";
const AND = "Find 1 B2B software company hiring Account Executives AND having raised funding in the last 90 days.";
const signals = (cs: MissionCriterion[]) => cs.filter((c) => c.dimension === "hiring" || c.dimension === "funding");

// ══════════════════════════════════════════════════════════════ compile ══

Deno.test("compile: 'hiring … OR raised funding' is one requirement both members name", () => {
  const cs = signals(deriveMissionCriteria(mission(OR)));
  assertEquals(cs.map((c) => [c.dimension, c.kind]), [["hiring", "hard"], ["funding", "hard"]]);
  for (const c of cs) assertEquals(c.any_of, ["signal:funding", "signal:hiring"]);
  assertEquals(new Set(cs.map(anyOfGroupKey)).size, 1, "one group, across dimensions");
});

Deno.test("compile controls: AND stays two requirements; one signal's own OR is not a cross-signal OR", () => {
  for (const c of signals(deriveMissionCriteria(mission(AND)))) assertEquals(c.any_of, undefined, c.dimension);
  assertEquals(crossSignalAlternatives("raised a Series A or Series B round", ["funding"]), []);
  assertEquals(crossSignalAlternatives("hiring AEs and SDRs or raised funding", ["hiring", "funding"]), [],
    "an 'and' between the signals makes it no plain alternative");
  assertEquals(crossSignalAlternatives(OR.toLowerCase(), ["hiring"]), [], "only signals the mission states");
});

Deno.test("compile control: a hedged member is not part of the requirement", () => {
  const cs = signals(deriveMissionCriteria(mission(
    "Find 1 B2B software company that must be hiring Account Executives, or ideally has raised funding in the last 90 days.")));
  const funding = cs.find((c) => c.dimension === "funding");
  assert(!funding || funding.kind !== "hard", JSON.stringify(funding));
  for (const c of cs) assertEquals(c.any_of, undefined, c.dimension);
});

// ══════════════════════════════════════════════════════════════ decide ══

let seq = 0;
const item = (dimension: EvidenceItem["dimension"], value: unknown, status: EvidenceItem["status"] = "proven"): EvidenceItem => ({
  evidence_id: `or_${++seq}`, company_key: "co", dimension, value, status,
  source: { provider: "fixture", actor: "fixture", provider_call_id: null, url: null, excerpt: null },
  method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high",
  derived_from: [], mission_id: null, origin: "lead_mission",
});
const graph = (items: EvidenceItem[]) => buildCompanyEvidenceGraph("co", [item("business_model", "b2b_software"), ...items], { now: NOW });
const CRITERIA = deriveMissionCriteria(mission(OR));
const AND_CRITERIA = deriveMissionCriteria(mission(AND));
const hiring = (status: EvidenceItem["status"] = "proven") => item("hiring", status === "proven", status);
const funding = () => item("funding", { round: "series_a" }, "disproven");

Deno.test("decide: hiring proven answers the group — funding is never bought", () => {
  const e = evaluateEligibility(CRITERIA, graph([hiring()]));
  assertEquals(e.eligibility, "eligible");
  const f = e.checks.find((c) => c.dimension === "funding")!;
  assertEquals(f.result, "pass");
  assert(/answered by the alternative Hiring/.test(f.reason), f.reason);
  assertFalse(e.gaps.includes("funding"));
  // The control: the same evidence under AND still needs the funding.
  const and = evaluateEligibility(AND_CRITERIA, graph([hiring()]));
  assertEquals(and.eligibility, "pending");
  assert(and.gaps.includes("funding"));
});

Deno.test("decide: a failed alternative cannot reject while the other is open; every alternative failing does", () => {
  const open = evaluateEligibility(CRITERIA, graph([hiring("disproven")]));
  assertEquals(open.eligibility, "pending", "no posting, funding still unknown");
  assertEquals(open.gaps, ["funding"], "only the open alternative is worth buying");
  assertEquals(evaluateEligibility(CRITERIA, graph([hiring("disproven"), funding()])).eligibility, "ineligible");
  assertEquals(evaluateEligibility(AND_CRITERIA, graph([hiring("disproven")])).eligibility, "ineligible", "AND: one failure rejects");
});

// ═══════════════════════════════════════════════════════════════ route ══

Deno.test("route: the postings stay the entry when funding is only an alternative", () => {
  assertEquals(hiringLedMission(mission(OR)), true);
  assertEquals(hiringLedMission(mission(AND)), false, "a funding REQUIREMENT keeps its own entry");
});

// ═════════════════════════════════════════════════════════ the evaluator ══

import { parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { normalizeLinkedInCompanyEnriched } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";

Deno.test("evaluator: a cited hiring verdict satisfies the OR — funding left unknown is no mandatory gap", () => {
  const company = normalizeLinkedInCompanyEnriched({ id: "co", name: "Co", description: "B2B software for finance teams.",
    linkedinUrl: "https://www.linkedin.com/company/co", website: "https://co.example", employeeCountRange: { start: 11, end: 50 },
    industries: [{ name: "Software Development" }], locations: [{ country: "United States", city: "Boston", isHeadquarter: true }] });
  const r = buildEvidenceRegistry({ now: NOW.getTime(),
    evidence: buildCompanyEvidence({ company_key: "co", company, source_capability: "company_enrichment", identity_state: "resolved" } as never),
    jobs: [{ job_id: "j", job_url: "https://jobs.invalid/j", title: "Account Executive",
    company_name: "Co", company_linkedin_url: "https://www.linkedin.com/company/co", company_source_id: "co", location: "US",
    workplace_mode: null, posted_date: NOW.toISOString(), description: "We are hiring an Account Executive.", source: "job_provider",
    retrieved_at: NOW.toISOString(), missing_fields: [] }] } as never);
  const job = r.items.find((x) => x.evidence_type === "job_posting")!;
  const [h, f] = signals(CRITERIA);
  const parse = (cs: MissionCriterion[]) => parseMissionEvaluationStrict({
    mission_fit: "pass", reasoning: "x", unknown_fields: [], failed_requirements: [],
    matched_requirements: [{ requirement: h.label, evidence_id: job.evidence_id, excerpt: "Account Executive" }],
    criterion_verdicts: [
      { criterion_id: h.id, result: "pass", reason: "open AE role", evidence: [{ evidence_id: job.evidence_id, excerpt: "Account Executive" }] },
      { criterion_id: f.id, result: "unknown", reason: "no round on record", evidence: [] },
    ],
  }, r, cs).evaluation;
  const or = parse([h, f]);
  assertEquals(or.criterion_verdicts!.map((v) => v.result), ["pass", "unknown"]);
  assertFalse(/Mandatory criteria not established/.test(or.reasoning), or.reasoning);
  const and = parse(signals(AND_CRITERIA));
  assert(/Mandatory criteria not established/.test(and.reasoning), "AND: the unknown funding is still a mandatory gap");
});
