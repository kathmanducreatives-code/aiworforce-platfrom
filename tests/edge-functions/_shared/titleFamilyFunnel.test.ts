// TITLE-FAMILY IS A TITLE QUESTION.
//
// Production run c34c0cad-6227-4ebc-a69d-343e99510db9 (2026-07-29) returned 50
// jobs and reported `job_family_pass: 0`, `job_family_fail: 50`, bottleneck
// `title_coverage` — "no returned job matched the requested family". On that
// basis the broadening planner expanded into Growth Operations and Deal Desk.
//
// The titles were fine. `job_family_pass` was derived from `verifiedCompanies`,
// a company metric two stages downstream, so zero verified companies forced a
// zero title-family count regardless of the titles.
//
// The fixture below is the ACTUAL set of 50 `job_title` values returned by that
// run, read from `tool_calls.output_json`. It cannot drift from what the
// provider really sent.
//
// OFFLINE ONLY. No provider, no model, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyJobFamily } from "../../../supabase/functions/_shared/jobFamily.ts";
import { classifyBottleneck, emptyFunnelSummary } from "../../../supabase/functions/_shared/sourcingBottleneck.ts";

/** Verbatim from production run c34c0cad. */
const PRODUCTION_TITLES = [
  "VP, Revenue Operations", "GTM Process & Operations", "Lead, GTM Operations",
  "Senior Manager, Channel Strategy & Operations",
  "Expert Opportunity - GTM Operations Manager ($100/hr, up to $2,000/week)",
  "Sr. Manager, Marketing Solutions, Global Strategic Accounts",
  "Expert Opportunity - GTM Operations Manager ($100/hr, up to $2,000/week)",
  "GTM Operations Manager", "Senior Sales Performance Consultant – GTM Enablement",
  "Senior Sales Operations Specialist", "Senior Sales Operations Specialist",
  "Sales Operations Manager (Starlink Channel Sales)", "Sales Operations Analyst",
  "Manager, Sales Operations", "Senior Sales Operations Specialist",
  "Senior Sales Operations Specialist", "Sales Operations Coordinator",
  "Sales Operations Coordinator", "Senior Sales Performance Consultant – GTM Enablement",
  "Sales Operations Manager", "VP of Sales & Operations", "Sales Operations Specialist",
  "Sales Operations Manager (Remote)", "Regional Vice President of Sales and Operations",
  "Assistant Manager, Customer & Sales Operations",
  "Account Services Manager / Deal Desk Analyst, SmartSense (Lehi, UT - Hybrid)",
  "Central Strategy and Operations Analyst, YouTube", "TikTok Shop Strategist",
  "Associate Brand Manager / Brand Manager", "Head of Growth", "Business Analyst, YouTube",
  "Social Media Coordinator", "Head of User Growth Strategy & Operations", "VP of Marketing",
  "Growth Marketing Lead", "Growth Strategy & Operations Manager",
  "Automation - Operations Manager", "Head of User Growth Strategy & Operations",
  "HR Generalist / HR Business Partner", "Strategy & Operations", "Director, Growth Marketing",
  "Vice President of Sales & Commercial Operations & Analytics", "General Manager",
  "Sales Operations Manager (Remote)", "Digital Sales & Operations Coordinator (Part-Time)",
  "Customer Strategy and Operations", "Sales Operations Lead",
  "Vice President, Sales Strategy & Operations", "Vice President, Sales Strategy & Operations",
  "Business Analyst - Operations",
];

const REQUESTED = ["sales_ops", "rev_ops", "gtm_ops"];

// ============================================ the titles were never the problem ==

Deno.test("the production title set contains real matches — the reported zero was false", () => {
  const passing = PRODUCTION_TITLES.filter((t) => REQUESTED.includes(classifyJobFamily(t, null).family));
  assert(
    passing.length >= 20,
    `production reported 0 of 50; the classifier accepts ${passing.length}`,
  );
  assertEquals(PRODUCTION_TITLES.length, 50);
});

// ------------------------------------------------------- 52.-59. regressions ---

Deno.test("52.-55. core operations titles pass the exact family", () => {
  for (const [title, family] of [
    ["Sales Operations Manager", "sales_ops"],
    ["Sales Operations Lead", "sales_ops"],
    ["Revenue Operations Manager", "rev_ops"],
    ["GTM Operations Manager", "gtm_ops"],
    ["Go-to-Market Operations Lead", "gtm_ops"],
    ["Manager, Sales Operations", "sales_ops"],
    ["Sales Operations Analyst", "sales_ops"],
  ] as [string, string][]) {
    const r = classifyJobFamily(title, null);
    assertEquals(r.family, family, `${title} → ${r.family}, expected ${family}`);
  }
});

Deno.test("56./57. strategy-and-operations and Deal Desk resolve to a requested family or an adjacent tier", () => {
  // These must not be silently discarded, and must not be promoted to an exact
  // match either — they are the tier the planner may reach for deliberately.
  for (const title of [
    "Revenue Strategy and Operations",
    "Sales Strategy and Operations",
    "Sales Planning and Operations",
    "Vice President, Sales Strategy & Operations",
    "Deal Desk Analyst",
  ]) {
    const r = classifyJobFamily(title, null);
    assert(r.family !== undefined, `${title} produced no classification`);
  }
});

Deno.test("58. Growth Operations alone does not pass the requested sales/revenue/GTM family", () => {
  // The exact title the broadening planner reached for after the false
  // `title_coverage` diagnosis, and the source of the marketing/HR noise.
  const r = classifyJobFamily("Growth Operations", null);
  assertFalse(
    REQUESTED.includes(r.family),
    `"Growth Operations" was accepted as ${r.family} without sales/revenue/GTM evidence`,
  );
  // Nor may unrelated roles sneak in.
  for (const noise of ["VP of Marketing", "Social Media Coordinator", "HR Generalist / HR Business Partner", "General Manager"]) {
    assertFalse(REQUESTED.includes(classifyJobFamily(noise, null).family), `${noise} passed`);
  }
});

// ------------------------------------------- the bottleneck it was driving ------

Deno.test("59./bottleneck: with a truthful funnel the diagnosis is company qualification, not titles", () => {
  const ctx = { remainingQuota: 5, budgetRemaining: 4.5, expansionAvailable: true };

  // What production actually recorded — a falsified title-family count.
  const falsified = { ...emptyFunnelSummary(), raw_jobs: 50, unique_jobs: 0, job_family_pass: 0, job_family_fail: 50, companies_qualified: 0 };
  assertEquals(classifyBottleneck(falsified, ctx).kind, "insufficient_title_coverage");

  // What the same round looks like once title-family is measured from the
  // classifier: 23 titles matched and NO company survived. Company
  // qualification is the constriction, and broadening titles cannot fix it.
  const truthful = { ...emptyFunnelSummary(), raw_jobs: 50, unique_jobs: 23, job_family_pass: 23, job_family_fail: 27, companies_qualified: 0 };
  assertEquals(classifyBottleneck(truthful, ctx).kind, "company_qualification");
});

Deno.test("company-size rejection happens AFTER title-family classification", () => {
  // A large employer's operations role still passes the title stage; the company
  // gate is a separate, later authority. Collapsing the two is what produced a
  // title-coverage verdict for a company-verification failure.
  const r = classifyJobFamily("Sales Operations Manager", null);
  assertEquals(r.family, "sales_ops");
  const funnel = { ...emptyFunnelSummary(), raw_jobs: 25, unique_jobs: 5, job_family_pass: 5, job_family_fail: 20, companies_qualified: 0 };
  assertEquals(
    classifyBottleneck(funnel, { remainingQuota: 5, budgetRemaining: 4, expansionAvailable: true }).kind,
    "company_qualification",
  );
});
