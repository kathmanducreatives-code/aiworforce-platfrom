// FIRMOGRAPHIC MISSIONS THROUGH THE REAL ENGINE (Q4 acceptance harness):
// company search → identity → company details → shared qualification.
//
// The blocker this pins: the evaluator gate admitted only companies carrying a
// SIGNAL (hiring, a funding round, signal evidence), so a mission that asks for
// none — "US manufacturers under 100 employees", "US marketing agencies with
// 5–200 employees" — never reached the evaluator, and an industry outside the
// controlled business-model vocabulary (which only the evaluator, citing the
// company's own words, can answer) stayed unknown: nobody ever qualified.
//
// Every outcome is one of three: QUALIFIED (a label), INELIGIBLE (a proven
// contradiction) or PENDING (needs verification). A missing fact is never a
// pass and never a fail.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type AcceptanceCase, runAcceptanceCase } from "./q4/acceptanceHarness.ts";

const CAPS = { signal: [], capabilities: ["general_company_discovery", "company_details_enrichment", "company_semantic_evaluation"], strategies: [] };
const US = { geographies: ["United States"], geography_is_hard: true };
const band = (start: number, end: number | null, count: number) => ({ employeeCountRange: { start, end }, employeeCount: count });
const MFG = { name: "Keystone Pumps", description: "We manufacture industrial pumps and valves for factories.", industries: ["Industrial Machinery Manufacturing"] };
const SAAS = { name: "Ledgerly", description: "Ledgerly is B2B SaaS accounting software sold to finance teams at mid-size companies.", industries: ["Software Development"] };
const AGENCY = { name: "Brightside Creative", description: "Brightside is a marketing agency running paid media and brand campaigns for B2B clients.", industries: ["Marketing Services"] };
const MFG_Q = "Find 1 US manufacturing company with fewer than 100 employees.";
const SAAS_Q = "Find 1 US B2B SaaS company with 11-200 employees.";
const AGENCY_Q = "Find 1 US marketing agency with 5-200 employees.";

const run = (id: string, c: Partial<AcceptanceCase>) => runAcceptanceCase({ id, request: "", ...CAPS, ...c } as AcceptanceCase);
const decision = (f: Awaited<ReturnType<typeof run>>) => {
  const d = f.canonical[0] as { bucket: string; label: string | null; hard_checks: Record<string, string> } | undefined;
  return d ? (d.label ? "qualified" : d.bucket === "ineligible" ? "rejected" : d.bucket === "pending" ? "needs_verification" : d.bucket) : "none";
};
const mfg = (over: Partial<AcceptanceCase> = {}) => run(over.id ?? "mfg", {
  request: MFG_Q, companyTypes: ["manufacturing"], proposal: { ...US, employee_range: { min: null, max: 99 } },
  company: { ...MFG, ...band(11, 50, 40) }, businessModel: "unknown", ...over,
});
const saas = (over: Partial<AcceptanceCase> = {}) => run(over.id ?? "saas", {
  request: SAAS_Q, companyTypes: ["B2B SaaS"], proposal: { ...US, employee_range: { min: 11, max: 200 } },
  company: { ...SAAS, ...band(51, 200, 120) }, businessModel: "b2b_saas", ...over,
});

Deno.test("1 US manufacturing, fewer than 100 employees: the evaluator is reached and the company QUALIFIES on its own words", async () => {
  const f = await mfg();
  assertEquals(decision(f), "qualified");
  assertEquals((f.canonical[0] as { hard_checks: Record<string, string> }).hard_checks, { industry: "pass", geography: "pass", company_size: "pass" });
  assertEquals(f.evaluator.length, 1, "exactly one evaluator call for the one company");
});

Deno.test("2 US B2B SaaS, 11–200 employees: QUALIFIED on structured grounding, size band and HQ", async () => {
  assertEquals(decision(await saas()), "qualified");
});

Deno.test("3 US marketing agency, 5–200 employees: QUALIFIED; a SaaS company for the same mission is REJECTED on proven evidence", async () => {
  const agency = await run("agency", { request: AGENCY_Q, companyTypes: ["marketing agency"], proposal: { ...US, employee_range: { min: 5, max: 200 } },
    company: { ...AGENCY, ...band(11, 50, 25) }, businessModel: "b2b_service" });
  assertEquals(decision(agency), "qualified");
  const notAgency = await run("agency-saas", { request: AGENCY_Q, companyTypes: ["marketing agency"], proposal: { ...US, employee_range: { min: 5, max: 200 } },
    company: { ...SAAS, ...band(11, 50, 25) }, businessModel: "b2b_saas" });
  assertEquals(decision(notAgency), "rejected", "a verified SaaS business model rules out an agency — whatever the evaluator says");
});

Deno.test("4 no headquarters flagged: NEEDS VERIFICATION, never a pass on an office list and never a rejection", async () => {
  const f = await saas({ id: "no-hq", company: { ...SAAS, ...band(51, 200, 120),
    locations: [{ country: "United States", city: "Austin", isHeadquarter: false }, { country: "Canada", city: "Toronto", isHeadquarter: false }] } });
  assertEquals(decision(f), "needs_verification");
  assertEquals((f.canonical[0] as { hard_checks: Record<string, string> }).hard_checks.geography, "unknown");
});

Deno.test("5 conflicting size: the company record's proven band outranks the discovery row's — REJECTED; agreement QUALIFIES", async () => {
  const outside = await saas({ id: "size-conflict", company: { ...SAAS, ...band(51, 200, 90) }, detailsCompany: band(201, 500, 90) });
  assertEquals(decision(outside), "rejected");
  const inside = await saas({ id: "size-agree", company: { ...SAAS, ...band(201, 500, 90) }, detailsCompany: band(51, 200, 90) });
  assert(decision(inside) !== "rejected", "a stale discovery band never rejects what the company record proves");
});

Deno.test("6 a restated size limit decides exactly as the size stated once", async () => {
  const once = await mfg({ id: "size-once" });
  const twice = await mfg({ id: "size-twice", proposal: { ...US, employee_range: { min: null, max: 99 },
    hard_constraints: [{ field: "employee_max", operator: "lte", value: 99, reason: "fewer than 100" }] } });
  assertEquals(decision(twice), decision(once));
  assert(!twice.criteria.some((c) => (c as { dimension: string; kind: string }).dimension === "constraint" && (c as { kind: string }).kind === "hard"));
});

Deno.test("7 genuinely contradictory requirements are refused AS a contradiction, before any provider", async () => {
  const f = await mfg({ id: "contradiction", request: "Find 1 US manufacturing company with more than 500 employees and fewer than 50 employees.",
    proposal: { ...US, employee_range: { min: 500, max: 50 } } });
  assertEquals(f.refused, "feasibility");
  assertEquals(f.providerCalls.length, 0);
  const codes = (f.feasibility.refusals as Array<{ code: string; message: string }>).map((r) => r.code);
  assertEquals(codes, ["contradictory_requirements"], "never offered a 'closest band' as if it were a range");
});

Deno.test("signal missions are unchanged: a hiring mission still admits only companies with hiring evidence", async () => {
  const f = await run("hiring", { request: "Find 1 B2B software company hiring Account Executives within the last 30 days.", signal: ["hiring Account Executives"],
    capabilities: ["general_company_discovery", "embedded_hiring_evidence", "company_semantic_evaluation"], strategies: ["hiring"], jobs: [] });
  assert(decision(f) !== "qualified", "no job, no hiring evidence — not qualified");
});
