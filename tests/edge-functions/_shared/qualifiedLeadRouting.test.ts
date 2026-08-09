// Role taxonomy + qualified-lead routing. Regression for the 2026-07-26 manual run:
// "Sales Operations" became gtm_sales → SDR/BDR/AE → legacy fast account sourcing.
// ZERO network, ZERO model calls.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyRoleFamily, roleFamilyAliases } from "../../../supabase/functions/_shared/roleFamilies.ts";
import { routeQualifiedLead, extractRequestedLeadCount } from "../../../supabase/functions/_shared/qualifiedLeadRouting.ts";
import { getJobFamily } from "../../../supabase/functions/_shared/jobFamilyRegistry.ts";

const TARGET = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const ACCOUNT_ONLY = "Find five SaaS companies with sales hiring signals.";

// ---- PART 1: taxonomy ------------------------------------------------------
Deno.test("Sales-Operations phrases resolve to sales_operations, not gtm_sales", () => {
  for (const t of ["Sales Operations", "Revenue Operations", "RevOps", "GTM Operations", "Sales Ops"]) {
    assertEquals(classifyRoleFamily(t), "sales_operations", `${t} misclassified`);
  }
});
Deno.test("generic quota-carrying sales titles stay in gtm_sales", () => {
  for (const t of ["SDR", "BDR", "Account Executive", "Sales Development Representative"]) {
    assertEquals(classifyRoleFamily(t), "gtm_sales", `${t} misclassified`);
  }
});
Deno.test("sales_operations aliases never contain SDR/BDR/AE", () => {
  const a = roleFamilyAliases("sales_operations").join(" ").toLowerCase();
  for (const bad of ["sdr", "bdr", "account executive", "founding ae", "customer success", "product manager"]) {
    assertFalse(a.includes(bad), `sales_operations leaked "${bad}"`);
  }
  assertEquals(roleFamilyAliases("sales_operations").slice(0, 3), ["Sales Operations", "Revenue Operations", "GTM Operations"]);
});
Deno.test("UI taxonomy agrees with the backend jobFamilyRegistry", () => {
  const backend = getJobFamily("sales_operations")!;
  const ui = roleFamilyAliases("sales_operations");
  for (const t of backend.exact) assert(ui.includes(t), `backend exact title missing from UI aliases: ${t}`);
  for (const bad of backend.excluded.slice(0, 5)) {
    assertFalse(ui.map((x) => x.toLowerCase()).includes(bad.toLowerCase()), `UI aliases include a backend-excluded title: ${bad}`);
  }
});

// ---- PART 2: routing -------------------------------------------------------
Deno.test("the target request routes to qualified_lead_sourcing / company_first", () => {
  const r = routeQualifiedLead(TARGET);
  assertEquals(r.workflowKind, "qualified_lead_sourcing");
  assertEquals(r.executionMode, "company_first");
  assertEquals(r.countEntity, "contact_ready_lead");
  assertEquals(r.quotaPolicy, "contact_only");
  assert(r.reasonCodes.some((c) => c.startsWith("person_target")));
  assert(r.reasonCodes.some((c) => c.startsWith("qualified_lead_phrase")));
  assert(r.reasonCodes.includes("lead_quota:5"));
  assertEquals(extractRequestedLeadCount(TARGET), 5);
});
Deno.test("an account-only request keeps fast account sourcing", () => {
  const r = routeQualifiedLead(ACCOUNT_ONLY);
  assertEquals(r.workflowKind, "account_opportunity_sourcing");
  assertEquals(r.executionMode, "fast");
  assertEquals(r.countEntity, "account_opportunity");
  assertEquals(extractRequestedLeadCount(ACCOUNT_ONLY), null);   // no invented lead quota
});
Deno.test("person-target OR explicit lead quota each independently trigger company-first", () => {
  assertEquals(routeQualifiedLead("Find owners of manufacturers in Ohio").executionMode, "company_first");
  assertEquals(routeQualifiedLead("Give me 10 qualified leads").executionMode, "company_first");
  assertEquals(routeQualifiedLead("Find decision-makers at MSSPs").executionMode, "company_first");
  assertEquals(routeQualifiedLead("Find companies hiring engineers").executionMode, "fast");
});

// ---- PART 2a: LEAD_QUOTA_RE — widened count-to-"leads" window -------------
// 2026-08-09: widened from a fixed vocabulary ("N qualified/contact-ready/
// verified leads") to a 25-char, clause-bounded window so a short descriptive
// phrase between the count and "leads" still matches.
Deno.test("a short descriptive phrase between count and 'leads' still matches (the motivating case)", () => {
  assertEquals(extractRequestedLeadCount("Find 5 SDR hiring leads in London"), 5);
});
Deno.test("a clause break still stops the match — the count does not leak across sentences", () => {
  // The 100 quantifies companies, not leads; a clause break is between them.
  assertEquals(extractRequestedLeadCount("Find 100 companies, then maybe get some leads eventually"), null);
});
Deno.test("KNOWN LIMITATION: an unrelated count within 25 chars of 'leads' can still false-positive", () => {
  // Documented, not fixed: tightening this regex back to a fixed vocabulary
  // reintroduces the original bug ("5 SDR hiring leads" not matching at all).
  // This case is intentionally accepted as a rare, lower-severity tradeoff.
  assertEquals(extractRequestedLeadCount("I need 2 lists of qualified leads"), 2);
});

// ---- PART 2b: explicit lead/contact/prospect/outreach intent --------------
// 2026-08-09: a company-first hiring-signal request is NOT by itself proof the
// user wants a contact — "Find companies hiring GTM roles in London" and
// "Find companies hiring software engineers" compile to the identical
// {target_entity: "company", execution_mode: "company_first",
// hiring_signal_required: true} shape, yet only requests carrying EXPLICIT
// lead/contact/prospect/outreach language should route to
// qualified_lead_sourcing. Hiring signal alone stays evidence/qualification
// context, never proof a contact was requested.
const SHOULD_REROUTE = [
  "Find 5 SDR hiring leads in London",
  "Find companies hiring salespeople and the founders I should contact",
  "Find prospects that are hiring their first salesperson",
  "Give me 20 companies hiring GTM roles that I can reach out to",
];
for (const q of SHOULD_REROUTE) {
  Deno.test(`explicit intent reroutes: ${q}`, () => {
    assertEquals(routeQualifiedLead(q).workflowKind, "qualified_lead_sourcing");
  });
}
const SHOULD_STAY_ACCOUNT_ONLY = [
  "Which companies are hiring engineers in London?",
  "Research companies currently expanding their engineering teams",
  "Show me hiring trends among SaaS companies",
  // The literal phrasing this whole distinction was found from — a company-
  // first hiring-signal request with no lead/contact/prospect word.
  "Find companies hiring GTM roles in London",
];
for (const q of SHOULD_STAY_ACCOUNT_ONLY) {
  Deno.test(`hiring signal alone stays account-only: ${q}`, () => {
    assertEquals(routeQualifiedLead(q).workflowKind, "account_opportunity_sourcing");
  });
}
Deno.test("'prospects' alone is sufficient person-target evidence", () => {
  const r = routeQualifiedLead("Find prospects at companies hiring SDRs");
  assertEquals(r.workflowKind, "qualified_lead_sourcing");
  assert(r.reasonCodes.some((c) => c.startsWith("person_target:prospects")));
});
Deno.test("'who should I contact' phrasing routes as an explicit ask", () => {
  const r = routeQualifiedLead("Who should I contact at companies hiring GTM roles in London?");
  assertEquals(r.workflowKind, "qualified_lead_sourcing");
  assert(r.reasonCodes.includes("who_to_contact"));
});

// ---- BLAST RADIUS ----------------------------------------------------------
const BLAST: Array<[string, string, string]> = [
  ["Find companies hiring software engineers", "engineering", "fast"],
  ["Find US SaaS companies hiring AI engineers", "engineering", "fast"],
  ["Find automation integrators hiring controls engineers in Texas", "engineering", "fast"],
  // Was NULL_KNOWN_GAP: "salesperson" matched no alias set. Closed by the Part 10
  // taxonomy fix — a first revenue-carrying hire is commercial sales.
  ["Find small manufacturers hiring their first salesperson in Ohio", "gtm_sales", "fast"],
  ["Find companies expanding FP&A teams", "finance", "fast"],
  ["Find MSSPs hiring sales leadership", "gtm_sales", "fast"],
];
for (const [q, expectedFamily, expectedMode] of BLAST) {
  Deno.test(`blast radius: ${q.slice(0, 50)}`, () => {
    if (expectedFamily === "NULL_KNOWN_GAP") {
      assertEquals(classifyRoleFamily(q), null, "known gap: 'salesperson' matches no family");
    } else {
      assertEquals(classifyRoleFamily(q), expectedFamily, `family drift for: ${q}`);
    }
    assertEquals(routeQualifiedLead(q).executionMode, expectedMode);
    // No query may silently acquire Sales-Operations titles.
    if (expectedFamily !== "sales_operations" && expectedFamily !== "NULL_KNOWN_GAP") {
      assertFalse(roleFamilyAliases(classifyRoleFamily(q)).includes("Sales Operations"));
    }
  });
}
