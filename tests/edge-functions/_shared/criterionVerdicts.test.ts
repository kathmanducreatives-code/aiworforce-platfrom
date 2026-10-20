import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { normalizeLinkedInCompanyEnriched, requestedHiringFromSignals, jobProvesRequestedHiring } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { candidateDecision } from "../../../supabase/functions/_shared/workbenchMissionView.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";

const hiring: MissionCriterion = { id: "hiring:specified_role", dimension: "hiring", kind: "hard", value: "Account Executive", label: "AE hiring",
  source: "user_explicit", user_phrase: "Account Executive", rationale: "user stated", status: "ok" };
const company = normalizeLinkedInCompanyEnriched({ id: "co", name: "Example", description: "software for business teams",
  linkedinUrl: "https://www.linkedin.com/company/example" });
const registry = buildEvidenceRegistry({ evidence: buildCompanyEvidence({ company_key: "co", company, source_capability: "job_discovery", identity_state: "resolved" }),
  jobs: [{ job_id: "j", job_url: "https://example.invalid/job", title: "Sales Development Representative", company_name: "Example", company_linkedin_url: company.linkedin_company_url,
    company_source_id: "co", location: "US", workplace_mode: null, posted_date: new Date().toISOString(), description: "Book meetings", source: "mock", retrieved_at: null, missing_fields: [] }] });
const job = registry.items.find((x) => x.evidence_type === "job_posting")!;
const receipt = { evidence_id: job.evidence_id, excerpt: "Sales Development Representative" };
const raw = { mission_fit: "pass", hiring_fit: "verified", matched_requirements: [{ requirement: "Account Executive", ...receipt }],
  reasoning: "Everything is a perfect fit", criterion_verdicts: [{ criterion_id: hiring.id, result: "pass", reason: "role fits", evidence: [receipt] }] };
const item: EvidenceItem = { evidence_id: "hiring-fact", company_key: "co", dimension: "hiring", value: true, status: "proven",
  source: { provider: "mock", actor: "job_board", provider_call_id: null, url: null, excerpt: null }, method: "provider_field", observed_at: new Date().toISOString(),
  valid_until: null, confidence: "high", derived_from: [], mission_id: null, origin: "lead_mission" };
const graph = buildCompanyEvidenceGraph("co", [item]);
Deno.test("mandatory model FAIL overrides prose PASS and broad hiring proof through canonical persistence decision", () => {
  const parsed = parseMissionEvaluationStrict({ ...raw, criterion_verdicts: [{ ...raw.criterion_verdicts[0], result: "fail" }] }, registry, [hiring]);
  assertEquals(parsed.evaluation.mission_fit, "fail");
  assertEquals(evaluateEligibility([hiring], graph, parsed.evaluation.criterion_verdicts).eligibility, "ineligible");
  const candidate = { company_key: "co", name: "Example", domain: null, linkedin_url: company.linkedin_company_url, found_by: [], screened_out: null,
    identity_resolved: true, investigated: true, graph, criterion_verdicts: parsed.evaluation.criterion_verdicts };
  assertEquals(candidateDecision({ candidate, criteria: [hiring], anchor: "hiring" }).label, null);
});
for (const variants of [undefined, [], [raw.criterion_verdicts[0], raw.criterion_verdicts[0]],
  [{ ...raw.criterion_verdicts[0], evidence: [] }], [{ ...raw.criterion_verdicts[0], evidence: [{ evidence_id: "invented", excerpt: "AE" }] }],
  [{ ...raw.criterion_verdicts[0], evidence: [{ ...receipt, excerpt: "Account Executive" }] }]]) {
  Deno.test(`mandatory malformed/missing verdict stays UNKNOWN: ${JSON.stringify(variants)}`, () => {
    const p = parseMissionEvaluationStrict({ ...raw, criterion_verdicts: variants }, registry, [hiring]);
    assertEquals(p.evaluation.decision, "insufficient_evidence");
    assertEquals(evaluateEligibility([hiring], graph, p.evaluation.criterion_verdicts).eligibility, "pending");
  });
}
Deno.test("a failed preference cannot veto a proven mandatory criterion", () => {
  const target = { ...hiring, id: "hiring:preferred", kind: "target" as const };
  const p = parseMissionEvaluationStrict({ ...raw, criterion_verdicts: [...raw.criterion_verdicts,
    { ...raw.criterion_verdicts[0], criterion_id: target.id, result: "fail" }] }, registry, [hiring, target]);
  assertEquals(p.evaluation.mission_fit, "pass");
  assertEquals(evaluateEligibility([hiring, target], graph, p.evaluation.criterion_verdicts).eligibility, "eligible");
});
Deno.test("explicit no-role-broadening retains terms, permits modifiers and rejects a related family member", () => {
  const sig = [{ role_families: ["gtm_sales"], qualifier: { role_terms: ["account executive"] } }];
  const exact = requestedHiringFromSignals(sig, true);
  const flexible = requestedHiringFromSignals(sig);
  assertEquals(jobProvesRequestedHiring({ title: "Enterprise Account Executive", posted_date: null }, exact), true);
  assertEquals(jobProvesRequestedHiring({ title: "Sales Development Representative", posted_date: null }, exact), false);
  assertEquals(jobProvesRequestedHiring({ title: "Sales Development Representative", posted_date: null }, flexible), true);
});
Deno.test("unparseable evaluator output retains UNKNOWN mandatory verdicts", () => {
  const p = parseMissionEvaluationStrict("not JSON", registry, [hiring]);
  assertEquals(p.evaluation.criterion_verdicts?.[0].result, "unknown");
  assertEquals(evaluateEligibility([hiring], graph, p.evaluation.criterion_verdicts).eligibility, "pending");
});
Deno.test("OR alternatives remain one mandatory requirement", () => {
  const a = { ...hiring, id: "hiring:a", value: "a", any_of: ["a", "b"] };
  const b = { ...hiring, id: "hiring:b", value: "b", any_of: ["a", "b"] };
  const p = parseMissionEvaluationStrict({ ...raw, criterion_verdicts: [
    { ...raw.criterion_verdicts[0], criterion_id: a.id, result: "pass" },
    { ...raw.criterion_verdicts[0], criterion_id: b.id, result: "fail" },
  ] }, registry, [a, b]);
  assertEquals(p.evaluation.mission_fit, "pass");
  assertEquals(evaluateEligibility([a, b], graph, p.evaluation.criterion_verdicts).eligibility, "eligible");
});
