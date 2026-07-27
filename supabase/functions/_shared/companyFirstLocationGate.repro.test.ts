// PRODUCTION REPRODUCTION — task bb1ce7fe, the run that returned nothing.
//
// "Find founders of SaaS startups hiring Sales Operations in the United States.
// Return 5 qualified leads."
//
// Routing was correct, company-first was correct, the titles were correct, and
// the jobs actor returned 20 real US jobs. Every one was rejected at the source
// location gate as `missing location evidence (strict)`, because their locations
// were city/state strings the country detector could not read. Zero companies
// reached enrichment, so no decision-maker search ever ran and the run reported
// "0 matched" without ever having looked for a founder.
//
// Replayed through the PRODUCTION classifier (`classifyResults`) — the same
// function that produced the reject reason shown in the UI.
//
// OFFLINE. `classifyResults` is pure; no provider, model or database is touched.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyResults } from "./sourceQuality.ts";

const STRICT = { location: true, industry: false, stage: false, count_exact: false };
/** role is null so this isolates the LOCATION gate, which is what failed. */
const crit = (location: string) => ({ requested: 5, role: null, location, source_type: "job_signal" });

/** A job result shaped as the production actor returned it. */
const jobItem = (title: string, company: string, location: string) => ({
  name: title, title, company, location,
  source_url: `https://www.linkedin.com/jobs/view/${company.toLowerCase()}-${location.replace(/\W+/g, "-")}`,
});

const PRODUCTION_JOBS = [
  jobItem("Revenue Operations Lead", "Ramp", "Dallas, TX"),
  jobItem("GTM Operations Lead", "Vanta", "San Francisco Bay Area"),
  jobItem("Sales Operations Lead", "LanceDB", "San Francisco, CA"),
  jobItem("Revenue Operations", "Asana", "Remote, US"),
  // Negative control: a real job, wrong country.
  jobItem("Revenue Operations Lead", "Shopify", "Toronto, ON"),
];

const US = "United States";

Deno.test("R1 the four US jobs now PASS the source location gate", () => {
  const res = classifyResults(PRODUCTION_JOBS, crit(US), STRICT);
  const passed = res.accepted.map((c) => String(c.location)).sort();
  assertEquals(
    passed,
    ["Dallas, TX", "Remote, US", "San Francisco Bay Area", "San Francisco, CA"],
    "every US city/state job must survive the gate",
  );
});

Deno.test("R2 the Canadian job is still rejected as WRONG COUNTRY", () => {
  const res = classifyResults(PRODUCTION_JOBS, crit(US), STRICT);
  const toronto = res.rejected.find((r) => String((r.item as { location?: string }).location) === "Toronto, ON");
  assert(toronto, "the Toronto job must be rejected");
  assertEquals(toronto.reason, "wrong country (strict)");
});

Deno.test("R3 the production failure mode does not reproduce", () => {
  const res = classifyResults(PRODUCTION_JOBS, crit(US), STRICT);
  const missing = res.rejected.filter((r) => String(r.reason).includes("missing location evidence"));
  assertEquals(missing.length, 0, "no US job may be rejected for missing location evidence");
  assertEquals(res.reject_reason_counts["missing location evidence (strict)"] ?? 0, 0);
});

Deno.test("R4 companies become reachable — the funnel no longer dies at the gate", () => {
  const res = classifyResults(PRODUCTION_JOBS, crit(US), STRICT);

  // companies_planned > 0: enrichment now has something to work on. In production
  // this was zero, which is why no founder was ever searched for.
  const companiesPlanned = [...new Set(res.accepted.map((c) => String(c.company)))].sort();
  assert(companiesPlanned.length > 0, "company enrichment must be reachable");
  assertEquals(companiesPlanned, ["Asana", "LanceDB", "Ramp", "Vanta"]);

  // Decision-maker planning is gated on qualified companies existing, so a
  // non-zero company count is exactly what makes the founder stage reachable.
  assert(companiesPlanned.length >= 1, "decision-maker planning must be reachable");
  assert(!companiesPlanned.includes("Shopify"), "a wrong-country company must not be enriched");
});

Deno.test("R5 the gate did not become permissive — an all-foreign batch still yields nothing", () => {
  const foreign = [
    jobItem("Revenue Operations", "Shopify", "Toronto, ON"),
    jobItem("Revenue Operations", "Xero", "Sydney, NSW"),
    jobItem("Revenue Operations", "Monzo", "London, England"),
  ];
  const res = classifyResults(foreign, crit(US), STRICT);
  assertEquals(res.accepted.length, 0, "no foreign job may satisfy a United States requirement");
  for (const r of res.rejected) assertEquals(r.reason, "wrong country (strict)");
});

Deno.test("R6 a genuinely unknown location is still honestly 'missing location evidence'", () => {
  const res = classifyResults([jobItem("Revenue Operations", "Mystery", "Remote")], crit(US), STRICT);
  assertEquals(res.accepted.length, 0);
  assertEquals(res.rejected[0]?.reason, "missing location evidence (strict)");
});

Deno.test("R7 CONTACT quota semantics are untouched — rejects never count", () => {
  const res = classifyResults(PRODUCTION_JOBS, crit(US), STRICT);
  assertEquals(res.accepted.length + res.rejected.length + res.duplicates.length, PRODUCTION_JOBS.length);
  // The rejected Canadian job contributes nothing to the accepted pool.
  assertEquals(res.accepted.filter((c) => String(c.company) === "Shopify").length, 0);
});
