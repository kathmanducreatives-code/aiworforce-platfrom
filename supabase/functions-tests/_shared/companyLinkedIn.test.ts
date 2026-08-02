// Company LinkedIn adapter — fixture tests. No provider runs.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeCompanyLinkedIn, enrichCompanyFromLinkedIn, isLinkedInCompanyUrl } from "../../functions/_shared/companyLinkedIn.ts";

const URL_ = "https://www.linkedin.com/company/cekura";

const fixture = {
  description: "AI SaaS for revenue teams",
  industry: "Software Development",
  website: "https://cekura.ai",
  employeeCount: "11-50",
  specialties: ["RevOps", "Outbound", "Pipeline"],
  followers: 4200,
  location: "San Francisco, CA",
};

Deno.test("1. fixture normalizes into CompanyLinkedInResearch", () => {
  const r = normalizeCompanyLinkedIn(fixture, URL_);
  assertEquals(r.linkedin_url, URL_);
  assertEquals(r.industry, "Software Development");
  assertEquals(r.employee_count, "11-50");
  assertEquals(r.website, "https://cekura.ai");
  assertEquals(r.followers, "4200");
  assert(r.specialties.includes("RevOps"));
  assert(r.locations.includes("San Francisco, CA"));
});

Deno.test("2. sparse row → low confidence + missing_evidence, nothing invented", () => {
  const r = normalizeCompanyLinkedIn({ description: "" }, URL_);
  assertEquals(r.confidence, "low");
  assert(r.missing_evidence.includes("industry"));
  assert(r.missing_evidence.includes("employee count"));
  assertEquals(r.industry, "");
  assertEquals(r.employee_count, "");
});

Deno.test("3. only linkedin.com/company/ URLs accepted", () => {
  assert(isLinkedInCompanyUrl(URL_));
  assert(!isLinkedInCompanyUrl("https://linkedin.com/in/jane"));
  assert(!isLinkedInCompanyUrl("https://example.com/company/x"));
});

Deno.test("4. LinkedIn is optional — absent URL skips without a provider call", async () => {
  let called = false;
  const r = await enrichCompanyFromLinkedIn({ companyUrl: "" }, { runApifyActor: async () => { called = true; return []; } });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "no_company_linkedin_url");
  assertEquals(called, false);
});

Deno.test("5. stub actor → one company max, configurable actor id", async () => {
  let usedActor = "", input: any = null;
  const r = await enrichCompanyFromLinkedIn({ companyUrl: URL_ }, {
    actorId: (env, fb) => (env === "APIFY_ACTOR_LINKEDIN_COMPANY_SCRAPER" ? "custom/company-actor" : fb),
    runApifyActor: async (a, i) => { usedActor = a; input = i; return [fixture]; },
  });
  assertEquals(r.ok, true);
  assertEquals(usedActor, "custom/company-actor");
  assertEquals(input.companyUrls.length, 1);
  assertEquals(input.maxItems, 1);
});

Deno.test("6. unconfigured provider → honest skip", async () => {
  const r = await enrichCompanyFromLinkedIn({ companyUrl: URL_ }, {});
  assertEquals(r.reason, "apify_not_configured");
});
