import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCompanyEnrichment,
  runDecisionMakerDiscovery,
  runGenerateOutreach,
  buildPeopleSearchInput,
  DECISION_MAKER_TITLES,
  type LeadRecord,
  type FirecrawlFn,
} from "../../functions/_shared/leadActionRunner.ts";

const acceptedLead: LeadRecord = {
  lead_candidate_id: "lead-1",
  company_name: "Acme Robotics",
  website: "https://acme.com",
  domain: "acme.com",
  company_linkedin_url: "https://www.linkedin.com/company/acme",
  company_description: "Acme builds warehouse automation.",
  job_title: "Founding Account Executive",
  job_url: "https://linkedin.com/jobs/view/1",
  job_description: "We were founded by Jane Doe. Building our first sales team.",
  gate_decision: "accept",
  source_quality: "verified",
  poster_contact_hint: { name: "Jane Doe", profile_url: "https://www.linkedin.com/in/janedoe", title: "Co-Founder & CEO" },
  why_now: "Hiring their first AE — building revenue before scaling headcount.",
};

// ---- Research company ----

Deno.test("Test 1: research blocks a hard-rejected lead (no crawl)", async () => {
  let calls = 0;
  const fc: FirecrawlFn = async () => { calls++; return { markdown: "x" }; };
  const r = await runCompanyEnrichment({ ...acceptedLead, gate_decision: "reject" }, fc);
  assertEquals(r.status, "blocked");
  assertEquals(calls, 0);
  assert(/reject/i.test(r.blocked_reason ?? ""));
});

Deno.test("Test 2: research blocks a website-less lead (no crawl)", async () => {
  let calls = 0;
  const fc: FirecrawlFn = async () => { calls++; return { markdown: "x" }; };
  const r = await runCompanyEnrichment({ ...acceptedLead, website: null, company_website: null, domain: null }, fc);
  assertEquals(r.status, "blocked");
  assertEquals(calls, 0);
});

Deno.test("Test 3: research plans a capped Firecrawl crawl (never exceeds cap)", async () => {
  const visited: string[] = [];
  const fc: FirecrawlFn = async (url) => { visited.push(url); return { markdown: `content for ${url}` }; };
  const r = await runCompanyEnrichment(acceptedLead, fc, { maxPages: 4 });
  assertEquals(r.pages_planned, 4);
  assertEquals(visited.length, 4);       // exactly the cap, no more
  assert(visited.every((u) => u.startsWith("https://acme.com")));
});

Deno.test("Test 4: research extracts founders + emails with evidence urls", async () => {
  const fc: FirecrawlFn = async (url) => {
    if (url.endsWith("/about")) return { markdown: "Acme was founded by Jane Doe. We raised a seed round." };
    if (url.endsWith("/team")) return { markdown: "Jane Doe — CEO & Co-Founder\nJohn Smith, Head of Sales" };
    if (url.endsWith("/contact")) return { markdown: "Email hello@acme.com" };
    if (url === "https://acme.com") return { markdown: "Acme builds warehouse robots for fast-growing 3PLs and helps them scale." };
    return { markdown: "" };
  };
  const r = await runCompanyEnrichment(acceptedLead, fc);
  assertEquals(r.status, "enriched");
  assert(r.enrichment.founders.some((f) => f.name === "Jane Doe" && f.evidence_url));
  assert(r.enrichment.executives.some((x) => x.name === "John Smith"));
  assertEquals(r.enrichment.public_contact_emails[0]?.value, "hello@acme.com");
  assert(r.summary_lines.some((l) => /Founders:/.test(l)));
});

Deno.test("failed fetch on every page → failed status, nothing invented", async () => {
  const fc: FirecrawlFn = async () => null;
  const r = await runCompanyEnrichment(acceptedLead, fc);
  assertEquals(r.status, "failed");
  assertEquals(r.enrichment.founders.length, 0);
});

// ---- Find decision-makers ----

Deno.test("Test 5: founder job poster is used first (no people search needed)", async () => {
  let searched = 0;
  const r = await runDecisionMakerDiscovery(acceptedLead, { peopleSearch: async () => { searched++; return []; } });
  assertEquals(r.decision_makers[0].name, "Jane Doe");
  assertEquals(r.decision_makers[0].source, "job_poster");
  assertEquals(r.decision_makers[0].confidence, "high");
  assertEquals(r.needs_manual_review, false);
  assertEquals(searched, 0);              // confident already → no live search
  assertEquals(r.used_people_search, false);
});

Deno.test("Test 6: recruiter poster → low-priority hint, needs_manual_review, may search", async () => {
  const recruiterLead: LeadRecord = {
    ...acceptedLead,
    job_description: "Join our team.",
    poster_contact_hint: { name: "Sam Ruiz", profile_url: "https://www.linkedin.com/in/samruiz", title: "Technical Recruiter" },
  };
  let searched = 0;
  const r = await runDecisionMakerDiscovery(recruiterLead, { peopleSearch: async () => { searched++; return []; } });
  assertEquals(r.decision_makers[0].confidence, "low");
  assert(r.used_people_search);           // fell through to per-company search
  assertEquals(searched, 1);
});

Deno.test("Test 7: firecrawl founders become decision-makers with evidence url", async () => {
  const lead: LeadRecord = {
    ...acceptedLead,
    poster_contact_hint: null,
    job_description: "Join us.",
    company_enrichment: {
      status: "enriched", source: "firecrawl", pages_crawled: 2,
      company_summary: "Acme", category: null, target_customer: null,
      founders: [{ name: "Rae Kim", title: "Founder & CEO", source: "firecrawl_team_page", evidence_url: "https://acme.com/team", confidence: "high" }],
      executives: [], growth_signals: [], public_contact_emails: [], contact_page_url: null,
      evidence_urls: ["https://acme.com/team"], missing_evidence: [], confidence: "high",
    },
  };
  const r = await runDecisionMakerDiscovery(lead, {});
  assertEquals(r.decision_makers[0].name, "Rae Kim");
  assertEquals(r.decision_makers[0].source, "firecrawl_team_page");
  assertEquals(r.decision_makers[0].evidence_url, "https://acme.com/team");
});

Deno.test("Test 8/9: people-search input is one company, title-constrained, never batched", () => {
  const input = buildPeopleSearchInput(acceptedLead)!;
  assertEquals(input.one_company, true);
  assertEquals(input.company, "Acme Robotics");
  assertEquals(input.titles, DECISION_MAKER_TITLES);
  assert(typeof input.company === "string" && !Array.isArray(input.company as unknown));
  // unverified identity (no linkedin + no domain) → no live search input
  assertEquals(buildPeopleSearchInput({ ...acceptedLead, company_linkedin_url: null, website: null, company_website: null, domain: null }), null);
});

Deno.test("people search runs one input per company (loop stays per-lead)", async () => {
  const inputs: unknown[] = [];
  const leads = [
    { ...acceptedLead, lead_candidate_id: "a", company_name: "A Co", poster_contact_hint: null, job_description: "x" },
    { ...acceptedLead, lead_candidate_id: "b", company_name: "B Co", poster_contact_hint: null, job_description: "x" },
  ];
  for (const lead of leads) {
    await runDecisionMakerDiscovery(lead, { peopleSearch: async (i) => { inputs.push(i); return []; } });
  }
  assertEquals(inputs.length, 2);
  assertEquals((inputs[0] as any).company, "A Co");
  assertEquals((inputs[1] as any).company, "B Co");
  assert((inputs as any[]).every((i) => i.one_company === true));
});

// ---- Generate outreach ----

Deno.test("Test 10: outreach refuses insufficient context (no fake email)", () => {
  const r = runGenerateOutreach({ lead_candidate_id: "x", company_name: "Mystery Co", gate_decision: "accept", source_quality: "verified" });
  assertEquals(r.ready, false);
  assertEquals(r.draft.status, "insufficient_context");
  assert(r.draft.missing_context.length > 0);
});

Deno.test("Test 11: outreach creates draft_needs_approval when evidence is sufficient", () => {
  const lead: LeadRecord = {
    ...acceptedLead,
    decision_makers: [{ name: "Jane Doe", title: "CEO", linkedinUrl: "https://www.linkedin.com/in/janedoe", source: "job_poster", confidence: "high", why_this_person: "founder", evidence_url: "https://www.linkedin.com/in/janedoe", contact_status: "profile_only", email: null, email_source_url: null, company_match: { status: "verified", reason: "job post", matched_on: ["job_post"] } }],
  };
  const r = runGenerateOutreach(lead);
  assertEquals(r.ready, true);
  assertEquals(r.draft.status, "draft_needs_approval");
  assertEquals(r.draft.recipient_name, "Jane Doe");
  assert(r.draft.body.includes("Acme Robotics"));
  assert(r.draft.evidence_used.includes("https://linkedin.com/jobs/view/1"));
});

Deno.test("Test 12: outreach never sends (status is only draft/insufficient)", () => {
  const r = runGenerateOutreach(acceptedLead);
  assert(r.draft.status === "draft_needs_approval" || r.draft.status === "insufficient_context");
  assert(!/sent|sending|delivered/i.test(r.draft.status));
});
