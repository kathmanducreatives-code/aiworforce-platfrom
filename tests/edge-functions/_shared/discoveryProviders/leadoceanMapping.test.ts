// Regression tests for the LeadOcean field-mapping defects Test L exposed
// (2026-10-31), against sanitized fixtures in LeadOcean's documented shapes.
// Each test names the root cause it pins. ZERO network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FIELDS, FIELD_BASIS, normalizeLeadOceanPage, buildLeadOceanSearch, redactLeadOceanRow } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { compileLeadMission } from "../../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { companyIdentityOutcome, scoreProvider, type Cohort } from "../../../../supabase/functions/_shared/discoveryProviders/benchmark.ts";
import { leadEvidence } from "../../../../supabase/functions/_shared/discoveryProviders/evidenceContract.ts";
import { mergeRecords } from "../../../../supabase/functions/_shared/discoveryProviders/normalize.ts";
import { requirementsFromMission } from "../../../../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { planDiscovery, type PlanStep } from "../../../../supabase/functions/_shared/discoveryProviders/routing.ts";
import { evidenceFromCompany } from "../../../../supabase/functions/_shared/discoveryProviders/sharedQualification.ts";
import { titleMatchesRole, verifyLeads } from "../../../../supabase/functions/_shared/discoveryProviders/verify.ts";
import { conn } from "./fixtures.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = async (p: string) => JSON.parse(await Deno.readTextFile(new URL(p, ROOT)));
const PEOPLE = "tests/edge-functions/_shared/discoveryProviders/fixtures/leadocean/people-search.thin.json";
const COMPANIES = "tests/edge-functions/_shared/discoveryProviders/fixtures/leadocean/company-search.json";
const AT = "2026-10-31T00:00:00Z";

async function missionC() {
  const f = await read("benchmarks/provider-discovery/mission-c-proposal.json");
  return requirementsFromMission(compileLeadMission({ originalUserQuery: f.query, proposal: f.proposal, requestedCount: 10 }).final_mission as never);
}
async function peopleStep(): Promise<PlanStep> {
  const r = await missionC();
  return planDiscovery({ requirements: r, connections: [conn("leadocean")], selection: ["leadocean"], limits: { maxRecordsPerStep: 10, overfetch: 1 } }).steps[0];
}
const companyStep = async (): Promise<PlanStep> => ({ ...(await peopleStep()), kind: "company_search", requirements: [] });

Deno.test("M1 title is the CURRENT role's job_title (was read from .title — every Test L title came back empty)", async () => {
  const page = normalizeLeadOceanPage(await read(PEOPLE), await peopleStep(), AT);
  assertEquals(page.people.map((p) => p.title), ["VP of Sales", "Vice President, Sales Operations"]);
  assertEquals(FIELDS.title[0], "contact_data.contact_current_experiences.0.job_title");
  assertEquals(FIELD_BASIS[FIELDS.title[0]], "observed", "seen in a real row in validation test V");
});

Deno.test("M2 the headline is kept apart and NEVER read as a title", async () => {
  const fixture = await read(PEOPLE);
  const row = structuredClone(fixture.data[0]);
  delete row.contact_data.contact_current_experiences[0].job_title;
  const [p] = normalizeLeadOceanPage({ ...fixture, data: [row] }, await peopleStep(), AT).people;
  assertEquals(p.title, null, "the headline 'Helping teams sell better | VP of Sales at …' would otherwise pass a role check");
  assertEquals(p.headline, "Helping teams sell better | VP of Sales at Northwind Analytics");
});

Deno.test("M3 person LinkedIn is profile_data.profile_url; meta.fetched_at is the SERVE time, never read as freshness (V)", async () => {
  const [p] = normalizeLeadOceanPage(await read(PEOPLE), await peopleStep(), AT).people;
  assertEquals(p.linkedinUrl, "https://www.linkedin.com/in/robin-vale-example");
  // V: LangChain's fetched_at was the second of the request. LeadOcean publishes no data-update stamp.
  assertEquals(p.providerUpdatedAt, null);
  assertEquals(p.company!.providerUpdatedAt, null);
  const c = normalizeLeadOceanPage(await read(COMPANIES), await companyStep(), AT).companies[0];
  assertEquals(c.providerUpdatedAt, null, "a company record's fetched_at is not freshness either");
});

Deno.test("M4 a people row's employer comes from contact_current_experiences[0]: headcount and LinkedIn yes, headquarters never (V)", async () => {
  const [p] = normalizeLeadOceanPage(await read(PEOPLE), await peopleStep(), AT).people;
  assertEquals([p.company!.name, p.company!.domain, p.company!.industry], ["Northwind Analytics", "northwind.example", ["Software Development"]]);
  assertEquals([p.company!.employeeCount, p.company!.employeeRange], [140, { min: 51, max: 200 }]);
  assertEquals(p.company!.linkedinUrl, "https://www.linkedin.com/company/northwind-example");
  assertEquals(p.company!.recordId, "lo-company-77", "the people row names the employer's LeadOcean company_id");
  assertEquals(p.company!.hqCountry ?? null, null);
  // `current` is LeadOcean's explicit flag, and the job level is kept as seniority.
  assertEquals([p.employerIsCurrent, p.seniority, p.country], [true, "VP", "US"]);
});

Deno.test("M5 NAICS is never an industry: '54' stays a sector code (Test L reported industry ['54'])", async () => {
  const page = normalizeLeadOceanPage(await read(COMPANIES), await companyStep(), AT);
  const c = page.companies[0];
  assertEquals([c.industry, c.naicsSector, c.naicsPrimary, c.employeeCount], [["Software Development"], "54", "541511", 140]);
  // A record carrying ONLY the NAICS code has no industry at all.
  const fixture = await read(COMPANIES);
  const row = structuredClone(fixture.data[0]);
  row.company_data.company_industries = [];
  const only = normalizeLeadOceanPage({ ...fixture, data: [row] }, await companyStep(), AT).companies[0];
  assertEquals(only.industry, null);
  const merged = mergeRecords([only], []).companies[0];
  assertFalse(evidenceFromCompany(merged, [], null, new Date(AT)).some((e) => e.dimension === "industry"), "no industry evidence from a NAICS code");
  const lead = verifyLeads({ ...(await missionC()), criteria: [] }, mergeRecords([only], []), [])[0];
  assertEquals(leadEvidence(lead, []).company.naics.claims[0].value, { sector: "54", primary: "541511" });
  assertEquals(leadEvidence(lead, []).company.industry.status, "unknown");
});

Deno.test("M6 headquarters is company_primary_address (V); when LeadOcean holds none (LangChain) it stays ABSENT", async () => {
  const fixture = await read(COMPANIES);
  const c = normalizeLeadOceanPage(fixture, await companyStep(), AT).companies[0];
  assertEquals([c.hqCountry, c.hqRegion, c.hqCity], ["US", "Texas", "Austin"]);
  const row = structuredClone(fixture.data[0]);
  row.company_data.company_primary_address = { city: null, state: null, country: null, country_code: null, continent: null, postal_code: null };
  const none = normalizeLeadOceanPage({ ...fixture, data: [row] }, await companyStep(), AT).companies[0];
  assertEquals([none.hqCountry ?? null, none.hqRegion ?? null, none.hqCity ?? null], [null, null, null]);
});

Deno.test("M8 funding is a dated event (company_funding, V): type, full date, year, total — never the canonical funding-pair shape", async () => {
  const c = normalizeLeadOceanPage(await read(COMPANIES), await companyStep(), AT).companies[0];
  assertEquals(c.funding, { lastRoundType: "Series A", lastRoundYear: 2026, roundDate: "2026-09-15", totalUsd: 12000000, lastRoundUsd: null });
  const item = evidenceFromCompany(mergeRecords([c], []).companies[0], [], null, new Date(AT)).find((e) => e.dimension === "funding")!;
  assertEquals([item.status, item.occurred_at], ["plausible", "2026-09-15"]);
});

Deno.test("M7 role check on the real title: 'VP of Sales' matches; 'Vice President, Sales Operations' does not", async () => {
  const [a, b] = normalizeLeadOceanPage(await read(PEOPLE), await peopleStep(), AT).people;
  assert(titleMatchesRole(a.title!, "VP of Sales"));
  assertFalse(titleMatchesRole(b.title!, "VP of Sales"));
});

Deno.test("R1 each paid page keeps a redacted raw copy: replay re-parses it identically, with no contact value or key hash", async () => {
  const fixture = await read(PEOPLE);
  const revealed = structuredClone(fixture);
  revealed.data[0].contact_data.contact_emails = [{ email: "robin@northwind.example", type: "work", status: "verified" }];
  revealed.data[0].contact_data.contact_phones = [{ phone: "+1 555 0142", type: "mobile" }];
  revealed.data[0].profile_data.profile_picture_url = "https://cdn.example/p.jpg";
  const step = await peopleStep();
  const page = normalizeLeadOceanPage(revealed, step, AT);
  const raw = JSON.stringify(page.raw);
  for (const v of ["robin@northwind.example", "555 0142", "cdn.example", "deadbeef"]) assertFalse(raw.includes(v), `${v} must not be kept`);
  assert(raw.includes("Robin Vale") && raw.includes("lo-person-1001"), "what a re-parse needs is kept");
  const replay = normalizeLeadOceanPage(page.raw, step, AT);
  const strip = (x: typeof page) => x.people.map(({ contactPoints: _c, ...p }) => p);
  assertEquals(strip(replay), strip(page));
  assertEquals(redactLeadOceanRow({ contact_data: { contact_emails: [{ email: "a@b.example", type: "work", status: "verified" }] } }),
    { contact_data: { contact_emails: [{ type: "work", status: "verified", redacted: true }] } });
});

Deno.test("F1 the role, HQ country and headcount filters are SENT on the discovery page — and asked in relevance order", async () => {
  const r = await missionC();
  const step = await peopleStep();
  const { path, body } = buildLeadOceanSearch(step, r, null, 10);
  assertEquals(path, "/v1/search");
  assertEquals([body.title, body.hqCountry, body.minEmployees, body.maxEmployees, body.limit, body.order],
    [["VP of Sales"], ["US"], 51, 200, 10, "ranked"]);
});

Deno.test("F2 a filter LeadOcean names in unsupportedFilters is never treated as enforced", async () => {
  const fixture = await read(PEOPLE);
  const r = await missionC();
  const page = normalizeLeadOceanPage({ ...fixture, meta: { ...fixture.meta, unsupportedFilters: ["hqCountry"] } }, await peopleStep(), AT);
  assertEquals(page.ignoredFilters, ["geography_hq"]);
  const lead = verifyLeads(r, mergeRecords([], page.people), [])[0];
  const hq = lead.checks.find((c) => c.key === "geography_hq")!;
  assertEquals(hq.outcome, "unknown");
  assert(hq.note.includes("ignoring"));
  // Size comes back as a VALUE in the people row (V): checked against it, not against the filter claim.
  assertEquals(lead.checks.find((c) => c.key === "employee_range")!.outcome, "matched");
});

Deno.test("S1 missing comparison evidence is UNCONFIRMED, not a wrong match (Test L scored Baseten and Oscilar 'wrong')", () => {
  const row = (o: Record<string, unknown>) => ({ provider: "leadocean" as const, recordId: "r", retrievedAt: AT, ...o });
  // Cohort holds only a LinkedIn URL; the row only a domain: nothing to compare.
  assertEquals(companyIdentityOutcome({ domain: null, linkedin_url: "https://www.linkedin.com/company/acme" }, row({ name: "Acme", domain: "acme.example" })), "unconfirmed");
  assertEquals(companyIdentityOutcome({ domain: "acme.example" }, row({ domain: "www.acme.example" })), "match");
  assertEquals(companyIdentityOutcome({ domain: "acme.example" }, row({ domain: "other.example" })), "mismatch");
  assertEquals(companyIdentityOutcome({ linkedin_url: "https://www.linkedin.com/company/acme" }, row({ linkedinUrl: "https://linkedin.com/company/acme/", domain: "x.example" })), "match");
  const cohort: Cohort = {
    version: "t", discovery: { mission_query: "q", requested_count: 1 }, known_decision_makers: [],
    known_companies: [
      { slot: "A01", status: "selected", name: "Acme", domain: "acme.example", suppression: { existing_lead_id: null, outreach_hold: false, crm_relationship: null } },
      { slot: "A02", status: "selected", name: "Beta Labs", domain: null, linkedin_url: "https://www.linkedin.com/company/beta", suppression: { existing_lead_id: null, outreach_hold: false, crm_relationship: null } },
      { slot: "A03", status: "selected", name: "Gamma", domain: "gamma.example", suppression: { existing_lead_id: null, outreach_hold: false, crm_relationship: null } },
    ],
  };
  const s = scoreProvider(cohort, {
    provider: "leadocean", personMatches: {}, discoveryRows: [], discoveryLeads: [], timings: [], unitsConsumed: 3, unit: "records", costUsd: 0,
    companyMatches: { A01: row({ name: "Acme", domain: "acme.example" }), A02: row({ name: "Beta Labs, Inc", domain: "beta.example" }), A03: row({ name: "Gamma", domain: "elsewhere.example" }) },
  }, null, AT);
  assertEquals(s.companyMatching, { numerator: 1, denominator: 3, value: 1 / 3, wrong: 1, missed: 0, conflicting: 0, unconfirmed: 1, unconfirmedNameAgrees: 1, accuracyWhereComparable: 0.5 });
  assertEquals(companyIdentityOutcome({ domain: "acme.example", linkedin_url: "https://www.linkedin.com/company/acme" }, row({ linkedinUrl: "https://www.linkedin.com/company/acme", domain: "acme-alias.example" })), "conflicting");
});

Deno.test("P1 ISO country codes compare as countries: GB is the United Kingdom, US the United States", async () => {
  const { normCountry } = await import("../../../../supabase/functions/_shared/discoveryProviders/adapter.ts");
  assertEquals([normCountry("GB"), normCountry("US"), normCountry("de")], ["united kingdom", "united states", "germany"]);
  assertEquals(normCountry("United Kingdom"), normCountry("GB"));
});

Deno.test("P1 two LeadOcean records of one human (same person_group_id) merge into one person", async () => {
  const fixture = await read(PEOPLE);
  const a = structuredClone(fixture.data[0]);
  const b = structuredClone(fixture.data[0]);
  b.meta.source_ids.person_id = "lo-person-9999";
  b.profile_data.profile_url = null;
  const people = normalizeLeadOceanPage({ ...fixture, data: [a, b] }, await peopleStep(), AT).people;
  assertEquals(people.map((p) => p.personGroupId), ["g-lo-person-1001", "g-lo-person-1001"]);
  assertEquals(mergeRecords([], people).people.length, 1);
});

Deno.test("P1 narrowing hints: allow-listed only, never override a requirement, and bound into the plan hash", async () => {
  const r = await missionC();
  const withHints = { ...r, providerHints: { leadocean: { industry: ["Software Development"], seniority: ["founder", "c_suite"], hasPhone: true } } };
  const step = planDiscovery({ requirements: withHints, connections: [conn("leadocean")], selection: ["leadocean"], limits: { maxRecordsPerStep: 10, overfetch: 1 } }).steps[0];
  const body = buildLeadOceanSearch(step, withHints, null, 10).body;
  assertEquals([body.industry, body.seniority, body.hasPhone, body.hqCountry], [["Software Development"], ["founder", "c_suite"], true, ["US"]]);
  // A hint cannot replace what a requirement set.
  const clash = { ...r, providerHints: { leadocean: { hqCountry: ["CA"] } } };
  let threw = false;
  try { buildLeadOceanSearch(step, clash, null, 10); } catch { threw = true; }
  assert(threw, "hqCountry is not a narrowing hint");
  // An approval for one set of hints does not cover another.
  const p1 = planDiscovery({ requirements: withHints, connections: [conn("leadocean")], selection: ["leadocean"] });
  const p2 = planDiscovery({ requirements: { ...withHints, providerHints: { leadocean: { industry: ["Marketing Services"] } } }, connections: [conn("leadocean")], selection: ["leadocean"] });
  assert(p1.planHash !== p2.planHash);
});
