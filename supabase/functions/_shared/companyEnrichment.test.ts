import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isEnrichmentEligible,
  planEnrichmentCrawl,
  extractCompanyEnrichment,
  extractFoundersFromText,
  extractPeopleFromTeamPage,
  resolveBaseUrl,
  cleanEvidenceText,
  type CrawledPage,
} from "./companyEnrichment.ts";

// ---- Bug #3: Firecrawl markdown/text cleaning ----
Deno.test("Bug3 #13: markdown link text is unwrapped in summary", () => {
  assertEquals(cleanEvidenceText("[Cekura raised $2.4M](https://cekura.ai/blog)"), "Cekura raised $2.4M");
});

Deno.test("Bug3 #14: bare URLs are stripped from prose", () => {
  const out = cleanEvidenceText("Great product see https://cekura.ai/x for more");
  assert(!/https?:\/\//.test(out));
  assert(/Great product see/.test(out));
});

Deno.test("Bug3 #15: duplicated render artifacts collapse (reliablereliable → reliable)", () => {
  assertEquals(cleanEvidenceText("agents reliablereliable now"), "agents reliable now");
  assertEquals(cleanEvidenceText("the the team"), "the team");
});

Deno.test("Bug3 #16: extraction still keeps evidence_urls separate + clean summary", () => {
  const pages: CrawledPage[] = [
    { url: "https://acme.com", kind: "homepage", markdown: "[Acme has raised $2.4M to make agents reliablereliable Learn more](https://acme.com/blog) and helps teams scale." },
    { url: "https://acme.com/contact", kind: "contact", markdown: "Email hello@acme.com" },
  ];
  const e = extractCompanyEnrichment(pages);
  assert(e.company_summary && !/\]\(|https?:\/\//.test(e.company_summary), "summary has no markdown/url");
  assert(!/reliablereliable/.test(e.company_summary ?? ""));
  assertEquals(e.evidence_urls.includes("https://acme.com"), true);   // evidence URLs preserved
  assert(e.growth_signals.every((g) => !/\]\(|https?:\/\//.test(g)));  // growth cleaned
});

Deno.test("cleanEvidenceText preserves quoted factual content, no fabrication", () => {
  const out = cleanEvidenceText("**Backed by** Y Combinator");
  assertEquals(out, "Backed by Y Combinator");
});

// ---- Eligibility gate ----

Deno.test("eligible: accept + proof + real website → eligible with https base", () => {
  const e = isEnrichmentEligible({ gate_decision: "accept", source_quality: "verified", website: "https://www.acme.com", domain: "acme.com" });
  assert(e.eligible);
  assertEquals(e.base_url, "https://acme.com");
});

Deno.test("Test 5: company without website does not run Firecrawl (enrichment blocked)", () => {
  const e = isEnrichmentEligible({ gate_decision: "accept", source_quality: "verified", website: null, domain: null });
  assert(!e.eligible);
  assertEquals(e.base_url, null);
  assert(/website/i.test(e.reason));
  // a job-board-only link is not a company website
  const jb = isEnrichmentEligible({ gate_decision: "accept", source_quality: "verified", website: "https://www.linkedin.com/jobs/view/1" });
  assert(!jb.eligible);
});

Deno.test("Test 6: hard-rejected company never enriches", () => {
  const e = isEnrichmentEligible({ gate_decision: "reject", source_quality: "verified", website: "https://acme.com" });
  assert(!e.eligible);
  assert(/reject/i.test(e.reason));
});

Deno.test("eligibility requires real proof — no proof → blocked", () => {
  const e = isEnrichmentEligible({ gate_decision: "needs_verification", source_quality: "incomplete", source_proof: [], website: "https://acme.com" });
  assert(!e.eligible);
  assert(/proof/i.test(e.reason));
});

// ---- Crawl planning ----

Deno.test("planEnrichmentCrawl builds a small capped targeted page set", () => {
  const plan = planEnrichmentCrawl({ website: "https://www.acme.com/careers" }, { maxPages: 6 })!;
  assertEquals(plan.base_url, "https://acme.com");
  assertEquals(plan.pages.length, 6);
  assertEquals(plan.estimated_credits, 6);
  assert(plan.pages.some((p) => p.kind === "homepage"));
  assert(plan.pages.some((p) => p.kind === "team"));
  // never crawls the whole site
  assert(plan.pages.length <= plan.max_pages);
});

Deno.test("planEnrichmentCrawl returns null for a job-board-only lead", () => {
  assertEquals(planEnrichmentCrawl({ website: "https://www.linkedin.com/jobs/view/1" }), null);
  assertEquals(resolveBaseUrl("https://indeed.com/x"), null);
});

// ---- Extraction ----

Deno.test("Test 3-adjacent: 'Founded by X and Y' extracts both founders with evidence url", () => {
  const founders = extractFoundersFromText(
    "Acme was founded by Jane Doe and John Smith in 2021.",
    "https://acme.com/about",
  );
  assertEquals(founders.map((f) => f.name).sort(), ["Jane Doe", "John Smith"]);
  assert(founders.every((f) => f.evidence_url === "https://acme.com/about"));
  assert(founders.every((f) => f.title === "Founder"));
});

Deno.test("Test 4: Firecrawl team-page → founder/CEO decision-maker with evidence URL", () => {
  const team = extractPeopleFromTeamPage(
    ["Jane Doe — Co-Founder & CEO", "John Smith, CTO", "Sara Lee - Marketing Intern"].join("\n"),
    "https://acme.com/team",
  );
  const jane = team.find((p) => p.name === "Jane Doe")!;
  assertEquals(jane.source, "firecrawl_team_page");
  assertEquals(jane.evidence_url, "https://acme.com/team");
  assertEquals(jane.confidence, "high"); // founder title → high
  assert(team.some((p) => p.name === "John Smith" && /CTO/.test(p.title ?? "")));
  // interns/non-leadership are not decision-makers
  assert(!team.some((p) => p.name === "Sara Lee"));
});

Deno.test("extractCompanyEnrichment: full multi-page → founders + email + evidence, honest missing", () => {
  const pages: CrawledPage[] = [
    { url: "https://acme.com", kind: "homepage", markdown: "Acme builds warehouse robots.\n\nWe help fast-growing 3PLs automate picking." },
    { url: "https://acme.com/about", kind: "about", markdown: "Acme was founded by Jane Doe. We raised a seed round last year." },
    { url: "https://acme.com/team", kind: "team", markdown: "Jane Doe — CEO & Co-Founder\nJohn Smith, Head of Sales" },
    { url: "https://acme.com/contact", kind: "contact", markdown: "Reach us at hello@acme.com." },
  ];
  const e = extractCompanyEnrichment(pages);
  assertEquals(e.status, "enriched");
  assertEquals(e.pages_crawled, 4);
  assert(e.founders.some((f) => f.name === "Jane Doe"));
  assert(e.executives.some((x) => x.name === "John Smith"));
  assertEquals(e.public_contact_emails[0].value, "hello@acme.com");
  assertEquals(e.public_contact_emails[0].source_url, "https://acme.com/contact");
  assertEquals(e.contact_page_url, "https://acme.com/contact");
  assert(e.growth_signals.some((g) => /seed round/i.test(g)));
  assert(e.company_summary && e.company_summary.length > 0);
  assert(e.confidence === "high");
  assert(e.evidence_urls.length >= 2);
});

Deno.test("Test 9: no emails on site → public_contact_email marked missing, none fabricated", () => {
  const pages: CrawledPage[] = [
    { url: "https://ghost.co", kind: "homepage", markdown: "Ghost Co is a stealth startup." },
    { url: "https://ghost.co/about", kind: "about", markdown: "We are building something new." },
  ];
  const e = extractCompanyEnrichment(pages);
  assertEquals(e.public_contact_emails.length, 0);
  assert(e.missing_evidence.includes("public_contact_email"));
  assert(e.missing_evidence.includes("founders"));
  assert(e.missing_evidence.includes("team_page"));
});

Deno.test("personal inboxes are not treated as public business contact emails", () => {
  const pages: CrawledPage[] = [
    { url: "https://acme.com/contact", kind: "contact", markdown: "Email jane.doe@gmail.com or team@acme.com" },
  ];
  const e = extractCompanyEnrichment(pages);
  assertEquals(e.public_contact_emails.map((x) => x.value), ["team@acme.com"]);
});

Deno.test("empty crawl → failed status, no invented data", () => {
  const e = extractCompanyEnrichment([{ url: "https://acme.com", markdown: "" }]);
  assertEquals(e.status, "failed");
  assertEquals(e.founders.length, 0);
  assertEquals(e.public_contact_emails.length, 0);
});
