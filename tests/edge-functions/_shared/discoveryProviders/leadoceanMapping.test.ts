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
  assertEquals(FIELD_BASIS[FIELDS.title[0]], "documented");
});

Deno.test("M2 the headline is kept apart and NEVER read as a title", async () => {
  const fixture = await read(PEOPLE);
  const row = structuredClone(fixture.data[0]);
  delete row.contact_data.contact_current_experiences[0].job_title;
  const [p] = normalizeLeadOceanPage({ ...fixture, data: [row] }, await peopleStep(), AT).people;
  assertEquals(p.title, null, "the headline 'Helping teams sell better | VP of Sales at …' would otherwise pass a role check");
  assertEquals(p.headline, "Helping teams sell better | VP of Sales at Northwind Analytics");
});

Deno.test("M3 person LinkedIn is profile_data.profile_url and freshness is meta.fetched_at (both were wrong keys)", async () => {
  const [p] = normalizeLeadOceanPage(await read(PEOPLE), await peopleStep(), AT).people;
  assertEquals(p.linkedinUrl, "https://www.linkedin.com/in/robin-vale-example");
  assertEquals(p.providerUpdatedAt, "2026-10-20");
  assertEquals(p.company!.providerUpdatedAt, "2026-10-20");
});

Deno.test("M4 a people row's employer comes from contact_current_experiences[0]; a thin row has NO employer HQ or headcount", async () => {
  const [p] = normalizeLeadOceanPage(await read(PEOPLE), await peopleStep(), AT).people;
  assertEquals([p.company!.name, p.company!.domain, p.company!.industry], ["Northwind Analytics", "northwind.example", ["Software Development"]]);
  assertEquals([p.company!.hqCountry ?? null, p.company!.employeeCount ?? null], [null, null]);
  assertEquals(p.employerIsCurrent, true);
});

Deno.test("M5 NAICS is never an industry: '54' stays a sector code (Test L reported industry ['54'])", async () => {
  const page = normalizeLeadOceanPage(await read(COMPANIES), await companyStep(), AT);
  const c = page.companies[0];
  assertEquals([c.industry, c.naicsSector, c.naicsPrimary, c.employeeCount], [["Software Development"], "54", "541511", 140]);
  // A record carrying ONLY the NAICS code has no industry at all.
  const fixture = await read(COMPANIES);
  const row = structuredClone(fixture.data[0]);
  delete row.company_data.company_industry;
  const only = normalizeLeadOceanPage({ ...fixture, data: [row] }, await companyStep(), AT).companies[0];
  assertEquals(only.industry, null);
  const merged = mergeRecords([only], []).companies[0];
  assertFalse(evidenceFromCompany(merged, [], null, new Date(AT)).some((e) => e.dimension === "industry"), "no industry evidence from a NAICS code");
  const lead = verifyLeads({ ...(await missionC()), criteria: [] }, mergeRecords([only], []), [])[0];
  assertEquals(leadEvidence(lead, []).company.naics.claims[0].value, { sector: "54", primary: "541511" });
  assertEquals(leadEvidence(lead, []).company.industry.status, "unknown");
});

Deno.test("M6 the headquarters key is unknown: it stays ABSENT, never guessed from a neighbouring field", async () => {
  const c = normalizeLeadOceanPage(await read(COMPANIES), await companyStep(), AT).companies[0];
  assertEquals([c.hqCountry ?? null, c.hqRegion ?? null, c.hqCity ?? null], [null, null, null]);
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
  // The size filter LeadOcean did apply is reported as applied — but still not trusted to qualify.
  assertEquals(lead.checks.find((c) => c.key === "employee_range")!.outcome, "provider_filter");
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
