// Field-level evidence regressions. Pure fixtures; no provider or database calls.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { normalizeLinkedInCompanyEnriched, normalizeLinkedInCompanyCandidate } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { observationFromCompany } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { checkCriterion } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { businessModelDecision, parseGroundedResult, verifyGroundedResult } from "../../../supabase/functions/_shared/groundedClaims.ts";

const DESCRIPTION = "We build sales software for revenue teams at mid-size companies.";
const NOW = new Date("2026-10-19T00:00:00Z");
const row = (locations: unknown[] = [{ country: "US", headquarter: true,
  parsed: { text: "Boston, United States", countryFull: "United States" } }]) => ({
  id: "a7-quality", name: "Example Software", linkedinUrl: "https://www.linkedin.com/company/a7-quality",
  website: "https://a7-quality.example", description: DESCRIPTION, locations,
  employeeCountRange: { start: 11, end: 50 },
});
function criterion(query: string, locations = ["United States"], geography_scope?: "headquarters" | "presence") {
  const mission = compileLeadMission({ originalUserQuery: query, proposal: {
    requested_opportunity_count: 1, company_types: ["B2B software"], geographies: locations,
    geography_is_hard: true, geography_scope, employee_range: { min: null, max: null },
  } }).final_mission;
  return deriveMissionCriteria(mission).filter((c) => c.dimension === "geography");
}
function graph(locations: unknown[], actor = "apify_linkedin_company_details") {
  const company = normalizeLinkedInCompanyEnriched(row(locations));
  const obs = observationFromCompany(company, {
    capability: "company_enrichment", actor_key: actor, provider: "apify", route_id: null,
    plan_version: null, provider_call_id: "mock-call", mission_id: "mock-mission", observed_at: NOW.toISOString(),
  });
  return buildCompanyEvidenceGraph("quality", obs.evidence, { now: NOW });
}
const usOffice = { country: "US", headquarter: false, parsed: { text: "Boston, United States", countryFull: "United States" } };
const usHQ = { ...usOffice, headquarter: true };
const caHQ = { country: "CA", headquarter: true, parsed: { text: "Toronto, Canada", countryFull: "Canada" } };
for (const query of ["Find US-headquartered software companies", "Find companies headquartered in the United States",
  "Find companies with HQ in USA", "Find companies with U.S. headquarters"]) {
  Deno.test(`HQ scope survives compilation: ${query}`, () => {
    const c = criterion(query, ["United States"], "headquarters")[0]; assert(c);
    assertEquals(checkCriterion(c, graph([usOffice])).result, "unknown");
    assertEquals(checkCriterion(c, graph([usHQ])).result, "pass");
    assertEquals(checkCriterion(c, graph([caHQ, usOffice])).result, "fail");
  });
}
Deno.test("HQ: multiple flags, discovery flags, and expired HQ evidence never prove headquarters", () => {
  const c = criterion("Find US-headquartered companies", ["United States"], "headquarters")[0];
  assertEquals(checkCriterion(c, graph([usHQ, { ...usHQ, parsed: { text: "Austin, United States", countryFull: "United States" } }])).result, "unknown");
  assertEquals(checkCriterion(c, graph([usHQ], "apify_linkedin_job_search")).result, "unknown");
  const expired = graph([usHQ]);
  for (const claim of expired.claims) claim.current = null;
  assertEquals(checkCriterion(c, expired).result, "unknown");
});
Deno.test("generic geography keeps structured US office presence", () => {
  const c = criterion("Find US software companies with an office in the US")[0];
  assertEquals(checkCriterion(c, graph([usOffice])).result, "pass");

});

function registry(from: "record" | "discovery" | "blank_enriched" | "unresolved" | "legacy") {
  const base = from === "record" || from === "unresolved"
    ? normalizeLinkedInCompanyEnriched(row()) : normalizeLinkedInCompanyCandidate(row());
  const evidence = buildCompanyEvidence({ company_key: "quality", company: base,
    source_capability: "job_discovery", identity_state: from === "unresolved" ? "unresolved" : "resolved",
    enriched: from === "blank_enriched" ? normalizeLinkedInCompanyEnriched({ ...row(), description: "  " }) : null,
  });
  if (from === "legacy") delete (evidence as unknown as Record<string, unknown>).description_provenance;
  return buildEvidenceRegistry({ evidence, now: NOW.getTime() });
}
function verdict(r: ReturnType<typeof registry>) {
  const e = r.items.find((x) => x.evidence_type === "company_description")!;
  return verifyGroundedResult({ registry: r, result: parseGroundedResult({
    business_model: { value: "b2b_software", confidence: 0.95 }, decision: "pass", confidence: 0.95,
    supporting_claims: [{ claim: "The company builds sales software for revenue teams", claim_type: "business_model",
      evidence_ids: [e.evidence_id], evidence_excerpts: [{ evidence_id: e.evidence_id, excerpt: DESCRIPTION }] }],
  }) });
}
Deno.test("description: the company-record field is verified, carries its source, and supports grounded qualification", () => {
  const r = registry("record"); const desc = r.items.find((x) => x.evidence_type === "company_description")!;
  assertEquals(desc.verification_state, "verified");
  assertEquals(desc.metadata.field_provenance, { actor_key: "apify_linkedin_company_details", source_id: "a7-quality" });
  assertEquals(businessModelDecision(verdict(r)).decision, "accepted");
});
for (const kind of ["discovery", "blank_enriched", "unresolved", "legacy"] as const) {
  Deno.test(`description: ${kind} does not inherit identity verification or prove a business model`, () => {
    const r = registry(kind); const desc = r.items.find((x) => x.evidence_type === "company_description")!;
    assertEquals(desc.verification_state, "reported");
    assertEquals(desc.source_text, DESCRIPTION, "discovery text stays visible with its actual provenance");
    assertEquals(businessModelDecision(verdict(r)).decision, "review");
    assertEquals(verdict(r).validated_claims.length, 0);
  });
}
Deno.test("explicit US presence accepts a US office with Canadian HQ; HQ request still fails on the same record", () => {
  const facts = graph([caHQ, usOffice]);
  assertEquals(checkCriterion(criterion("Find companies operating in the US", ["United States"], "presence")[0], facts).result, "pass");
  assertEquals(checkCriterion(criterion("Find US-headquartered companies", ["United States"], "headquarters")[0], facts).result, "fail");
});
