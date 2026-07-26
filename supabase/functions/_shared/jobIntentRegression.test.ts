// PART 1 + PART 5 — BROAD OFFLINE INTENT REGRESSION.
//
// One table, ten requests, eleven assertions each. The point is that these are
// answered by COMPOSITION — function × seniority × team stage × vertical — not by
// a conditional per query. Adding an eleventh request should require no new
// branch, and the "unrelated title leakage" column is what proves it.
//
// The suite also PRINTS the matrix so the report is reproducible.
//
// ZERO network, ZERO provider calls, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveJobIntent } from "./jobFamilyRegistry.ts";
import { routeQualifiedLead } from "./qualifiedLeadRouting.ts";
import type { Department, JobFunction, Seniority, TeamStage, CompanyVertical } from "./jobIntentTaxonomy.ts";

interface Expectation {
  q: string;
  fn: JobFunction;
  department: Department;
  seniority: Seniority;
  stage: TeamStage;
  vertical: CompanyVertical | null;
  geography: string[];
  /** The registry family whose titles will actually be searched. */
  family: string;
  /** A title that MUST be searched. */
  wants: string;
  /** Titles that must NOT leak in. */
  forbids: string[];
  workflowKind: "qualified_lead_sourcing" | "account_opportunity_sourcing";
  countEntity: "contact_ready_lead" | "account_opportunity";
  /** Whether a verified decision-maker is required to earn quota credit. */
  requiresDecisionMaker: boolean;
}

const CASES: Expectation[] = [
  {
    q: "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.",
    fn: "sales_operations", department: "revenue", seniority: "c_level", stage: "established",
    vertical: "b2b_saas", geography: ["United States"], family: "sales_operations",
    wants: "Sales Operations", forbids: ["SDR", "BDR", "Account Executive", "Sales Representative"],
    workflowKind: "qualified_lead_sourcing", countEntity: "contact_ready_lead", requiresDecisionMaker: true,
  },
  {
    q: "Find MSSPs hiring sales leadership.",
    fn: "sales_leadership", department: "revenue", seniority: "vp", stage: "established",
    vertical: "cybersecurity", geography: [], family: "cybersecurity_sales",
    wants: "VP Sales", forbids: ["SDR", "BDR", "Sales Development Representative", "Account Executive", "Sales Operations"],
    workflowKind: "account_opportunity_sourcing", countEntity: "account_opportunity", requiresDecisionMaker: false,
  },
  {
    q: "Find automation integrators hiring controls engineers in Texas.",
    fn: "controls_engineering", department: "engineering", seniority: "ic", stage: "established",
    vertical: "industrial_automation", geography: ["Texas"], family: "controls_engineering",
    wants: "Controls Engineer", forbids: ["Software Engineer", "Account Executive", "Sales Operations"],
    workflowKind: "account_opportunity_sourcing", countEntity: "account_opportunity", requiresDecisionMaker: false,
  },
  {
    q: "Find small manufacturers hiring their first salesperson in Ohio.",
    fn: "early_sales", department: "revenue", seniority: "ic", stage: "first_hire",
    vertical: "manufacturing", geography: ["Ohio"], family: "manufacturing_sales",
    wants: "Sales Representative", forbids: ["SDR", "BDR", "Sales Operations", "VP Sales"],
    workflowKind: "account_opportunity_sourcing", countEntity: "account_opportunity", requiresDecisionMaker: false,
  },
  {
    q: "Find companies hiring software engineers.",
    fn: "software_engineering", department: "engineering", seniority: "ic", stage: "established",
    vertical: null, geography: [], family: "software_engineering",
    wants: "Software Engineer", forbids: ["Sales Operations", "Product Manager", "Controls Engineer"],
    workflowKind: "account_opportunity_sourcing", countEntity: "account_opportunity", requiresDecisionMaker: false,
  },
  {
    q: "Find healthcare companies hiring clinical operations leaders.",
    fn: "clinical_operations", department: "clinical", seniority: "director", stage: "established",
    vertical: "healthcare", geography: [], family: "clinical_operations",
    wants: "Clinical Operations Manager", forbids: ["Sales Operations", "Account Executive", "Software Engineer", "Registered Nurse"],
    workflowKind: "account_opportunity_sourcing", countEntity: "account_opportunity", requiresDecisionMaker: false,
  },
  {
    q: "Find logistics companies hiring regional sales directors.",
    fn: "sales_leadership", department: "revenue", seniority: "director", stage: "established",
    vertical: "logistics", geography: [], family: "sales_leadership",
    wants: "Sales Director", forbids: ["SDR", "BDR", "Sales Operations", "Account Executive"],
    workflowKind: "account_opportunity_sourcing", countEntity: "account_opportunity", requiresDecisionMaker: false,
  },
  {
    q: "Find renewable-energy companies hiring grid engineers.",
    fn: "energy_engineering", department: "engineering", seniority: "ic", stage: "established",
    vertical: "energy", geography: [], family: "energy_engineering",
    wants: "Grid Engineer", forbids: ["Software Engineer", "Sales Operations", "Account Executive"],
    workflowKind: "account_opportunity_sourcing", countEntity: "account_opportunity", requiresDecisionMaker: false,
  },
  {
    q: "Find financial-services companies expanding FP&A.",
    fn: "finance_fpa", department: "finance", seniority: "ic", stage: "building",
    vertical: "financial_services", geography: [], family: "finance_operations",
    wants: "FP&A Analyst", forbids: ["Accounts Payable", "Bookkeeper", "Sales Operations"],
    workflowKind: "account_opportunity_sourcing", countEntity: "account_opportunity", requiresDecisionMaker: false,
  },
  {
    q: "Find agencies hiring partnership leaders.",
    fn: "partnerships", department: "partnerships", seniority: "director", stage: "established",
    vertical: "agency_services", geography: [], family: "partnerships",
    wants: "Head of Partnerships", forbids: ["SDR", "BDR", "Sales Operations", "Account Executive"],
    workflowKind: "account_opportunity_sourcing", countEntity: "account_opportunity", requiresDecisionMaker: false,
  },
];

for (const c of CASES) {
  Deno.test(`intent: ${c.q.slice(0, 56)}`, () => {
    const intent = resolveJobIntent(c.q);
    const route = routeQualifiedLead(c.q);

    assertEquals(intent.function, c.fn, "function");
    assertEquals(intent.department, c.department, "department");
    assertEquals(intent.seniority, c.seniority, "seniority");
    assertEquals(intent.team_stage, c.stage, "team stage");
    assertEquals(intent.vertical, c.vertical, "vertical");
    assertEquals(intent.geography, c.geography, "geography");
    assertEquals(intent.family_key, c.family, "title strategy");
    assert(intent.titles.includes(c.wants), `missing "${c.wants}" (got ${intent.titles.join(", ")})`);

    assertEquals(route.workflowKind, c.workflowKind, "workflow kind");
    assertEquals(route.countEntity, c.countEntity, "count entity");
    // A decision-maker is required exactly when the quota counts CONTACT-ready
    // leads; an account-shaped request must not invent a person requirement.
    assertEquals(route.quotaPolicy === "contact_only", c.requiresDecisionMaker, "decision-maker requirement");

    // NO UNRELATED TITLE LEAKAGE — the whole point of the composable taxonomy.
    const searched = intent.titles.map((t) => t.toLowerCase());
    for (const bad of c.forbids) {
      assertFalse(searched.includes(bad.toLowerCase()), `leaked "${bad}" into ${c.q}`);
    }
    // Every forbidden title is either excluded by the family or simply absent.
    for (const bad of c.forbids) {
      const excluded = intent.excluded_titles.map((t) => t.toLowerCase()).includes(bad.toLowerCase());
      assert(excluded || !searched.includes(bad.toLowerCase()), `"${bad}" is neither excluded nor absent`);
    }
  });
}

Deno.test("PART 5: regression matrix", () => {
  for (const c of CASES) {
    const i = resolveJobIntent(c.q);
    const r = routeQualifiedLead(c.q);
    console.log(
      `\n${c.q}\n` +
      `  function=${i.function}  department=${i.department}  seniority=${i.seniority}  stage=${i.team_stage}\n` +
      `  vertical=${i.vertical ?? "null"}  geography=${JSON.stringify(i.geography)}\n` +
      `  title_strategy=${i.family_key} → ${JSON.stringify(i.titles)}\n` +
      `  workflow_kind=${r.workflowKind}  count_entity=${r.countEntity}  decision_maker_required=${r.quotaPolicy === "contact_only"}`,
    );
  }
  assertEquals(CASES.length, 10);
});

// ---- the four named defects ----------------------------------------------

Deno.test("DEFECT: MSSP sales leadership produces NO SDR/BDR titles", () => {
  const i = resolveJobIntent("Find MSSPs hiring sales leadership.");
  assertEquals(i.function, "sales_leadership");
  assertEquals(i.titles, ["VP Sales", "Head of Sales", "Sales Director"]);
  for (const bad of ["SDR", "BDR", "Sales Development Representative", "Business Development Representative", "Account Executive"]) {
    assertFalse(i.titles.includes(bad), `MSSP leadership search leaked ${bad}`);
    assert(i.excluded_titles.includes(bad), `${bad} must be explicitly excluded`);
  }
});

Deno.test("DEFECT: automation integrators are industrial automation, not a generic agency", () => {
  for (const q of [
    "Find automation integrators hiring controls engineers in Texas.",
    "Find systems integrators in Michigan.",
    "Find industrial automation companies hiring PLC programmers.",
  ]) {
    assertEquals(resolveJobIntent(q).vertical, "industrial_automation", q);
  }
  // A genuine services firm still classifies as agency_services.
  assertEquals(resolveJobIntent("Find marketing agencies hiring partnership leaders.").vertical, "agency_services");
});

Deno.test("DEFECT: a first salesperson gets ICP-appropriate commercial titles", () => {
  const i = resolveJobIntent("Find small manufacturers hiring their first salesperson in Ohio.");
  assertEquals(i.function, "early_sales");
  assertEquals(i.team_stage, "first_hire");
  assertEquals(i.titles, ["Sales Representative", "Account Manager", "Territory Sales Manager"]);
  for (const bad of ["SDR", "BDR", "Sales Operations"]) assertFalse(i.titles.includes(bad));
  // The SAME function in a software vertical gets software-shaped titles — this
  // is composition, not a per-query rule.
  const saas = resolveJobIntent("Find SaaS startups hiring their first salesperson.");
  assertEquals(saas.function, "early_sales");
  assertEquals(saas.family_key, "sales_ic");
  assert(saas.titles.includes("Account Executive"));
});

Deno.test("DEFECT: Sales Operations never produces SDR/BDR/AE titles", () => {
  for (const q of [
    "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.",
    "Find companies hiring Revenue Operations managers.",
    "Find startups hiring a RevOps lead.",
  ]) {
    const i = resolveJobIntent(q);
    assertEquals(i.family_key, "sales_operations", q);
    for (const bad of ["SDR", "BDR", "Account Executive", "Sales Representative"]) {
      assertFalse(i.titles.includes(bad), `${q} leaked ${bad}`);
      assert(i.excluded_titles.includes(bad), `${bad} must be excluded for ${q}`);
    }
  }
});

// ---- the discipline separations required by Part 1 ------------------------

Deno.test("PART 1: the four sales disciplines are distinguished from one another", () => {
  const cases: Array<[string, JobFunction, string]> = [
    ["Find companies hiring a Sales Operations manager", "sales_operations", "sales_operations"],
    ["Find companies hiring a VP of Sales", "sales_leadership", "sales_leadership"],
    ["Find startups hiring their first sales hire", "early_sales", "manufacturing_sales"],
    ["Find SaaS companies hiring SDRs", "sales_ic", "sales_ic"],
  ];
  for (const [q, fn, family] of cases) {
    const i = resolveJobIntent(q);
    assertEquals(i.function, fn, q);
    assertEquals(i.family_key, family, q);
  }
  // All four sit in the same department but never share a title strategy.
  const families = new Set(cases.map(([q]) => resolveJobIntent(q).family_key));
  assertEquals(families.size, 4, "two sales disciplines collapsed into one strategy");
  for (const [q] of cases) assertEquals(resolveJobIntent(q).department, "revenue", q);
});

Deno.test("PART 1: the engineering disciplines are distinguished from one another", () => {
  assertEquals(resolveJobIntent("hiring software engineers").function, "software_engineering");
  assertEquals(resolveJobIntent("hiring AI engineers").function, "ai_engineering");
  assertEquals(resolveJobIntent("hiring machine learning engineers").function, "ai_engineering");
  assertEquals(resolveJobIntent("hiring controls engineers").function, "controls_engineering");
  assertEquals(resolveJobIntent("hiring PLC programmers").function, "controls_engineering");
  assertEquals(resolveJobIntent("hiring grid engineers").function, "energy_engineering");
  assertEquals(resolveJobIntent("hiring substation engineers").function, "energy_engineering");
});

Deno.test("PART 1: the remaining functions resolve to their own strategies", () => {
  assertEquals(resolveJobIntent("expanding FP&A").function, "finance_fpa");
  assertEquals(resolveJobIntent("hiring clinical operations leaders").function, "clinical_operations");
  assertEquals(resolveJobIntent("hiring a head of operations").function, "operations");
  assertEquals(resolveJobIntent("hiring a demand generation manager").function, "marketing");
  assertEquals(resolveJobIntent("hiring a head of partnerships").function, "partnerships");
  assertEquals(resolveJobIntent("hiring a Chief Operating Officer").function, "executive");
});

Deno.test("PART 1: the verticals required by the brief are all recognised", () => {
  const pairs: Array<[string, CompanyVertical]> = [
    ["Find MSSPs", "cybersecurity"],
    ["Find automation integrators", "industrial_automation"],
    ["Find manufacturers", "manufacturing"],
    ["Find healthcare companies", "healthcare"],
    ["Find logistics companies", "logistics"],
    ["Find renewable-energy companies", "energy"],
    ["Find financial-services companies", "financial_services"],
    ["Find SaaS companies", "b2b_saas"],
    ["Find agencies", "agency_services"],
  ];
  for (const [q, v] of pairs) assertEquals(resolveJobIntent(q).vertical, v, q);
});

Deno.test("PART 1: an unrecognised request stays conservative rather than inventing a family", () => {
  const i = resolveJobIntent("Find companies hiring Quantum Workflow Architects");
  assertEquals(i.function, null);
  assertEquals(i.family_key, null);
  assertEquals(i.titles, []);
  assertEquals(i.excluded_titles, []);
});
