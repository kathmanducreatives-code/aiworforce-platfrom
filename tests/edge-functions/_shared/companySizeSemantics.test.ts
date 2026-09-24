// COMPANY SIZE: TWO LINKEDIN NUMBERS, TWO DIFFERENT FACTS (companySize.ts).
//
//   employeeCountRange → the company's DECLARED size band → `company_size_band`
//   employeeCount      → LinkedIn ASSOCIATED MEMBERS      → `linkedin_associated_member_count`
//
// A size criterion ("11–50 employees") is answered by the band and only the
// band. The member count is informational: it never passes, fails or contests
// a size claim, and is never called a staff count. An exact staff count is
// answered by nothing in the catalogue.
//
// One test per rule, numbered as the approved semantics list them.
//
// Pure. ZERO network, provider or model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bandSatisfies } from "../../../supabase/functions/_shared/companySize.ts";
import {
  jobEmployerToCompany, normalizeLinkedInCompanyCandidate, normalizeLinkedInCompanyEnriched,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { observationFromCompany, type EvidenceItem, type ObservationContext } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { checkCriterion } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { authorityForEvidence } from "../../../supabase/functions/_shared/evidenceAuthority.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { deriveMissionCriteria, type MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildMissionTriageInput, MISSION_TRIAGE_PROMPT } from "../../../supabase/functions/_shared/missionTriage.ts";
import { buildQualificationContext } from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import { projectEvaluationRows } from "../../../supabase/functions/_shared/leadWorkbenchProjection.ts";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const DETAILS = "apify_linkedin_company_details";
const SEARCH = "apify_linkedin_company_search";
const JOBS = "apify_linkedin_job_search";
const ctx = (actor: string): ObservationContext => ({
  capability: actor === DETAILS ? "company_enrichment" : actor === JOBS ? "job_discovery" : "general_company_discovery",
  actor_key: actor, provider: "apify", route_id: null, plan_version: null,
  provider_call_id: "pc_size", mission_id: "m", observed_at: NOW.toISOString(),
});
/** A LinkedIn company record in `full` mode. */
const record = (members: number | null, band: [number, number] | null) => ({
  id: "7", name: "Recode", linkedinUrl: "https://www.linkedin.com/company/recode", website: "https://recode.net",
  description: "Recode covers technology news.",
  ...(members === null ? {} : { employeeCount: members }),
  ...(band === null ? {} : { employeeCountRange: { start: band[0], end: band[1] } }),
  locations: [{ parsed: { text: "San Francisco, CA, United States", countryFull: "United States" }, headquarter: true }],
});
const items = (raw: Record<string, unknown>, actor: string): EvidenceItem[] => observationFromCompany(
  actor === DETAILS ? normalizeLinkedInCompanyEnriched(raw) : normalizeLinkedInCompanyCandidate(raw), ctx(actor)).evidence;
const size = (min: number | null, max: number | null): MissionCriterion => ({
  id: "company_size:x", kind: "hard", dimension: "company_size", value: { min, max }, label: "size",
  source: "user_explicit", user_phrase: "", rationale: "", status: "ok",
}) as unknown as MissionCriterion;
const verdict = (c: MissionCriterion, evidence: EvidenceItem[]) =>
  checkCriterion(c, buildCompanyEvidenceGraph("recode", evidence, { now: NOW }));

Deno.test("1. a search row's declared band is PLAUSIBLE", () => {
  const band = items(record(490, [11, 50]), SEARCH).find((e) => e.dimension === "company_size_band")!;
  assertEquals(band.status, "plausible");
  assertEquals(verdict(size(11, 50), items(record(490, [11, 50]), SEARCH)).result, "unknown",
    "a plausible band does not settle a hard size claim");
});

Deno.test("2. the company record's declared band PROVES the band claim", () => {
  const band = items(record(490, [11, 50]), DETAILS).find((e) => e.dimension === "company_size_band")!;
  assertEquals([band.status, band.authority?.rule], ["proven", "li_record_declared_size_band"]);
  assertEquals(verdict(size(11, 50), items(record(490, [11, 50]), DETAILS)).result, "pass");
});

Deno.test("3. an associated-member count cannot PASS size", () => {
  // 30 members, squarely inside 11–50 — and no declared band.
  const ev = items(record(30, null), DETAILS);
  assert(ev.some((e) => e.dimension === "linkedin_member_count" && e.value === 30));
  assertEquals(verdict(size(11, 50), ev).result, "unknown");
  assertEquals(authorityForEvidence({ claim: "company_size", source: DETAILS, field: "associated_member_count",
    observed_at: NOW.toISOString(), now: NOW }).authority, "insufficient");
});

Deno.test("4. an associated-member count cannot FAIL size", () => {
  for (const members of [490, 2135, 414_811]) {
    assertEquals(verdict(size(11, 50), items(record(members, null), DETAILS)).result, "unknown", `${members} members`);
  }
});

Deno.test("5. the member count creates no artificial conflict", () => {
  // Declared 11-50 with 490 members: one record, two facts, no disagreement.
  const ev = items(record(490, [11, 50]), DETAILS);
  const g = buildCompanyEvidenceGraph("recode", ev, { now: NOW });
  assertEquals(g.conflicts, []);
  assertEquals(verdict(size(11, 50), ev).result, "pass", "490 must not override the declared band");
  // …nor in the evidence record or the registry the model cites from.
  const c = normalizeLinkedInCompanyEnriched(record(490, [11, 50]));
  const rec = buildCompanyEvidence({ company_key: "recode", source_capability: "general_company_discovery",
    company: normalizeLinkedInCompanyCandidate(record(490, [11, 50])), enriched: c, identity_state: "resolved" });
  assertEquals(rec.conflicting_evidence, []);
  const reg = buildEvidenceRegistry({ evidence: rec, jobs: [], now: NOW } as never);
  assertEquals(reg.items.find((i) => i.evidence_type === "company_size_band")!.verification_state, "verified");
});

Deno.test("6. a matching declared band PASSES", () => {
  assertEquals(bandSatisfies({ min: 11, max: 50 }, { min: 11, max: 50 }).verdict, "pass");
  assertEquals(bandSatisfies({ min: 1, max: 200 }, { min: 51, max: 200 }).verdict, "pass");
  assertEquals(bandSatisfies({ min: 11, max: null }, { min: 10001, max: null }).verdict, "pass");
});

Deno.test("7. a fully non-overlapping declared band FAILS", () => {
  assertEquals(bandSatisfies({ min: 11, max: 50 }, { min: 201, max: 500 }).verdict, "fail");
  assertEquals(bandSatisfies({ min: 51, max: 200 }, { min: 2, max: 10 }).verdict, "fail");
  assertEquals(verdict(size(11, 50), items(record(40, [201, 500]), DETAILS)).result, "fail",
    "and a member count inside the range does not rescue it");
});

Deno.test("8. a partially overlapping custom range is PENDING", () => {
  const v = bandSatisfies({ min: 20, max: 80 }, { min: 11, max: 50 });
  assertEquals(v.verdict, "unknown");
  assert(/only partly overlaps/.test(v.reason), v.reason);
  assertEquals(verdict(size(20, 80), items(record(30, [11, 50]), DETAILS)).result, "unknown");
});

Deno.test("9. an exact staff-count claim stays unsupported / PENDING", () => {
  const exact = bandSatisfies({ min: 27, max: 27 }, { min: 11, max: 50 });
  assertEquals(exact.verdict, "unknown");
  assert(/exact staff count \(27\) is not provable/.test(exact.reason), exact.reason);
  // …and the mission says so rather than quietly dropping the requirement.
  const m = parseLeadMissionDeterministic("Find companies with exactly 27 employees");
  const mission = { ...m, company_profile: { ...m.company_profile, employee_range: { min: 27, max: 27 } },
    field_provenance: { ...m.field_provenance, "company_profile.employee_range": "explicit_user_request" as const } };
  const c = deriveMissionCriteria(mission).find((x) => x.dimension === "company_size")!;
  assertEquals([c.kind, c.label], ["hard", "Company size: exactly 27 employees"]);
  assert(/not provable today/.test(c.rationale), c.rationale);
  assertEquals(verdict(c, items(record(27, [11, 50]), DETAILS)).result, "unknown",
    "27 LinkedIn members is not 27 staff");
});

Deno.test("10. a job-search employer's employeeCount never regains staff-count authority", () => {
  const job = { id: "j1", title: "Growth Marketer", linkedinUrl: "https://x/j1",
    company: { name: "Recode", linkedinUrl: "https://www.linkedin.com/company/recode", website: "https://recode.net",
      employeeCount: 490, employeeCountRange: { start: 11, end: 50 } } };
  const employer = jobEmployerToCompany(job)!;
  assertEquals([employer.linkedin_associated_member_count, employer.company_size_band?.min], [490, 11]);
  assertFalse("employee_count" in employer, "no field claims to be an employee count");
  const ev = observationFromCompany(employer, ctx(JOBS)).evidence;
  assertFalse(ev.some((e) => e.dimension === "headcount"), "no staff-count item from a job row");
  assertEquals(ev.find((e) => e.dimension === "company_size_band")!.status, "plausible",
    "a job row's band is a discovery row's band");
  for (const claim of ["company_size", "headcount"] as const) {
    assertFalse(authorityForEvidence({ claim, source: JOBS, field: "associated_member_count",
      observed_at: NOW.toISOString(), now: NOW }).authority === "proven", claim);
  }
});

Deno.test("11. triage says LinkedIn associated members — never employees or headcount — and judges size on the band", () => {
  const prompt = MISSION_TRIAGE_PROMPT;
  assert(prompt.includes("`linkedin_associated_members`"));
  assert(prompt.includes("It is NOT") && /never call it headcount or employee count/.test(prompt));
  assert(/never\s+judge size from it/.test(prompt.replace(/\n/g, " ")));
  assertFalse(/self-reported headcount|verified headcount/.test(prompt));
  const input = buildMissionTriageInput({
    ctx: buildQualificationContext(parseLeadMissionDeterministic("Find 5 US companies with 11-50 employees") as never),
    companies: [{ company_key: "recode", name: "Recode", domain: "recode.net", description: null, industries: [],
      declared_size_band: "11-50", linkedin_associated_members: 490, location: null, open_roles: [] }],
  });
  const row = input.companies[0] as unknown as Record<string, unknown>;
  assertEquals([row.declared_size_band, row.linkedin_associated_members], ["11-50", 490]);
  assertFalse("employee_count" in row);
});

Deno.test("12. the Workbench never presents the member count as verified employees", () => {
  const out = projectEvaluationRows([{
    key: "recode", shortlisted: true, prequalified: null, identityResolved: true, identityAttempted: true,
    enriched: true, hiringVerified: false, verdict: null, contactCount: 0,
    companyName: "Recode", sizeBand: "11-50", linkedinMembers: 490,
  }]);
  const row = out.rows[0] as unknown as Record<string, unknown>;
  assertEquals([row.company_size_band, row.linkedin_associated_members], ["11-50", 490]);
  assertFalse("employee_count" in row, "no row field is named for employees");
  assertFalse(JSON.stringify(row).includes("490 employees"));
});
