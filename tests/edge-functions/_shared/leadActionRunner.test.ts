import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCompanyEnrichment,
  runGenerateOutreach,
  type LeadRecord,
  type FirecrawlFn,
} from "../../../supabase/functions/_shared/leadActionRunner.ts";

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
//
// Decision-maker discovery itself (runDecisionMakerDiscovery, the deprecated
// wrapper around buildDecisionMakers) was deleted from leadActionRunner.ts —
// zero live callers (grep-confirmed against supabase/ and tests/). The live
// find_decision_makers action uses runDecisionMakerAction
// (_shared/decisionMaker/pipeline.ts), covered by integration.test.ts and
// decisionMaker/*.test.ts. buildDecisionMakers itself remains live via
// memoryWriter.ts's ingest-time call and is covered by decisionMakers.test.ts.

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
