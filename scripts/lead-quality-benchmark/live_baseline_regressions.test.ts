// Regression tests from the live TEST baseline (run lead-quality-sales-ops-us-*,
// 2026-07-24). The real Agentory run surfaced founders of advisory/search firms
// with no hiring signal for a "SaaS startups hiring Sales Operations" query.
// These assert the strengthened services-firm detection rejects that class, and
// that a genuinely ambiguous person-lead is never promoted to CONTACT.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateFixture, FIXTURES } from "./fixtures.ts";
import { detectRecruiterProxy } from "../../supabase/functions/_shared/leadMatchTier.ts";

const only = (k: keyof typeof FIXTURES) => evaluateFixture(FIXTURES[k])[0];

Deno.test("live-regression: advisory-firm founder is REJECTed as not_saas", () => {
  const e = only("F21_advisory_firm_founder");
  assertEquals(e.verdict, "REJECT");
  assert(e.gates.gates.find((g) => g.id === "company_type")?.reasonCode === "not_saas");
});

Deno.test("live-regression: search/recruiting-firm founder is REJECTed as not_saas", () => {
  const e = only("F22_search_firm_founder");
  assertEquals(e.verdict, "REJECT");
  assert(e.gates.gates.find((g) => g.id === "company_type")?.reasonCode === "not_saas");
});

Deno.test("live-regression: ambiguous person-lead is never CONTACT", () => {
  const e = only("F23_person_lead_no_hiring_signal");
  assert(e.verdict !== "CONTACT");
});

Deno.test("real leadMatchTier.detectRecruiterProxy now flags services firms by name/title", () => {
  // Company name reveals it (no software-product evidence).
  assert(detectRecruiterProxy({ company: "Optivas Advisors" }).isProxy);
  // Title reveals it even when the company name is generic.
  assert(detectRecruiterProxy({ company: "Netsoft", job_title: "Principal Search Consultant" }).isProxy);
});

// Over-rejection guards: a services-firm TOKEN must not reject a real software
// firm — rejection requires the token AND no software-product evidence.
Deno.test("guard: SaaS with a search PRODUCT is NOT rejected (search platform/API)", () => {
  assertEquals(detectRecruiterProxy({ company: "SearchStax", job_title: "Sales Operations Manager", company_description: "managed search software platform and API" }).isProxy, false);
  assertEquals(detectRecruiterProxy({ company: "Algolia", company_description: "hosted search platform API" }).isProxy, false);
});

Deno.test("guard: fintech robo-advisory SaaS is NOT rejected on the 'advisors' token", () => {
  assertEquals(detectRecruiterProxy({ company: "WealthGrid Advisors", company_description: "robo-advisory investment platform (SaaS) with an API", job_title: "Revenue Operations Manager" }).isProxy, false);
});

Deno.test("guard: 'advisors' WITHOUT software evidence is still rejected (multi-signal)", () => {
  assert(detectRecruiterProxy({ company: "Meridian Advisors", company_description: "boutique management advisory for SMB leaders" }).isProxy);
});
