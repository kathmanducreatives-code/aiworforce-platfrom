import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  sanitizeSummary,
  containsRawMarkup,
  buildCompanyResearchView,
  evidenceLine,
  missingLine,
  outreachBlockCopy,
  RESEARCH_STATUS_COPY,
  APPROVAL_NOTICE,
} from "./companyResearchDisplay.ts";
import { deriveRowAction } from "./leadRowAction.ts";

const OK = { success: true, per_lead: [{}] };

// Structural shapes only — synthetic text, no real company content.
const NEWSLETTER = "The Newsletter Episode 6 is out. Synthetic Co builds warehouse automation software for mid-market logistics teams across Europe.";
const MARKDOWN = "![logo](https://cdn.example/logo.png) Synthetic Co provides an AI data-security platform for enterprise teams, with tooling for risk management.";

// ===========================================================================
// SUMMARY SANITIZATION — the "Company enriched: <raw text>" defect
// ===========================================================================

Deno.test("13. Markdown image syntax is removed", () => {
  const s = sanitizeSummary(MARKDOWN);
  assert(s);
  assert(!s!.includes("!["), s!);
  assert(!s!.includes("](" ), s!);
  assert(!containsRawMarkup(s));
  assert(s!.includes("AI data-security platform"));
});

Deno.test("62. bare URLs never reach the cell", () => {
  const s = sanitizeSummary("Synthetic Co builds automation tooling. See https://example.com/pricing for details.");
  assert(s);
  assert(!/https?:\/\//.test(s!), s!);
});

Deno.test("12. leading newsletter/CTA furniture is dropped, not shown as the summary", () => {
  const s = sanitizeSummary(NEWSLETTER);
  assert(s);
  assert(!/^the newsletter/i.test(s!), s!);
  assert(s!.includes("warehouse automation"));
});

Deno.test("furniture-only text yields no summary rather than nonsense", () => {
  for (const junk of ["Subscribe to our newsletter", "Accept all cookies", "Read more", "", "   ", "###"]) {
    assertEquals(sanitizeSummary(junk), null, junk);
  }
});

Deno.test("61. long summaries are capped and never overflow", () => {
  const long = "Synthetic Co builds warehouse automation. ".repeat(30);
  const s = sanitizeSummary(long);
  assert(s);
  assert(s!.length <= 221, `length ${s!.length}`);
});

Deno.test("non-strings and fragments are rejected", () => {
  assertEquals(sanitizeSummary(null), null);
  assertEquals(sanitizeSummary(42), null);
  assertEquals(sanitizeSummary("Pricing"), null, "a heading fragment is not a summary");
});

// ===========================================================================
// STRUCTURED VIEW
// ===========================================================================

Deno.test("28. summary + sources → succeeded and usable", () => {
  const v = buildCompanyResearchView({
    company_summary: MARKDOWN,
    evidence_urls: ["https://synthetic.example/about", "https://synthetic.example/product"],
    missing_evidence: ["funding"],
    confidence: "medium",
  });
  assertEquals(v.status, "succeeded");
  assertEquals(v.usable, true);
  assertEquals(v.evidence_count, 2);
  assertEquals(evidenceLine(v), "2 verified sources");
  assertEquals(missingLine(v), "funding");
  assert(!containsRawMarkup(v.summary));
});

Deno.test("27 + 29. provider completion without usable output is partial, not succeeded", () => {
  const noSources = buildCompanyResearchView({ company_summary: MARKDOWN, evidence_urls: [] });
  assertEquals(noSources.status, "partial");
  assertEquals(noSources.usable, false);

  const noSummary = buildCompanyResearchView({ company_summary: "Subscribe now", evidence_urls: ["https://x.example/a"] });
  assertEquals(noSummary.status, "partial");
  assertEquals(noSummary.usable, false);
});

Deno.test("missing-evidence line collapses extras", () => {
  const v = buildCompanyResearchView({
    company_summary: MARKDOWN, evidence_urls: ["https://x.example/a"],
    missing_evidence: ["funding", "company_size", "sales_motion"],
  });
  assertEquals(missingLine(v), "funding (+2 more)");
});

Deno.test("31. status copy is truthful for each state", () => {
  assertEquals(RESEARCH_STATUS_COPY.succeeded, "Company researched");
  assertEquals(RESEARCH_STATUS_COPY.partial, "Company research incomplete");
  assert(!RESEARCH_STATUS_COPY.succeeded.startsWith("Company enriched"));
});

// ===========================================================================
// ROW INTEGRATION — no raw prefix, no undefined
// ===========================================================================

Deno.test("69. the row detail no longer carries raw page text", () => {
  const a = deriveRowAction("research_company", OK, {
    status: "succeeded",
    summary_lines: [`Summary: ${MARKDOWN}`, "Confidence: medium"],
  });
  assertEquals(a.status, "succeeded");
  assert(a.detail, "a summary should render");
  assert(!containsRawMarkup(a.detail), a.detail!);
  assert(!a.detail!.includes("undefined"));
});

Deno.test("68. unusable scraped text yields no detail rather than junk", () => {
  const a = deriveRowAction("research_company", OK, {
    status: "succeeded",
    summary_lines: ["Summary: Subscribe to our newsletter", "Confidence: low"],
  });
  assertEquals(a.detail, undefined, "better blank than newsletter copy as a company summary");
});

// ===========================================================================
// OUTREACH BLOCK COPY — must name the specific step
// ===========================================================================

Deno.test("65. a blocked draft names the exact missing prerequisite", () => {
  assertEquals(outreachBlockCopy("blocked_missing_person"), "Find a verified decision-maker first");
  assertEquals(outreachBlockCopy("blocked_missing_company_evidence"), "Complete company research first");
  assertEquals(outreachBlockCopy("blocked_missing_company_brain"), "Complete Company Brain before drafting");
});

Deno.test("the generic sentence only survives when no reason code is supplied", () => {
  assertEquals(outreachBlockCopy(null), "Complete the required previous step first");
  const a = deriveRowAction("generate_outreach", OK, { status: "blocked", reason_code: "blocked_missing_person" });
  assertEquals(a.status, "blocked");
});

Deno.test("70. the approval notice is always available to the UI", () => {
  assertEquals(APPROVAL_NOTICE, "Approval required · Nothing sent");
});

// ===========================================================================
// SAFETY
// ===========================================================================

Deno.test("77-79. fixtures are synthetic and carry no payloads or secrets", () => {
  const v = buildCompanyResearchView({ company_summary: MARKDOWN, evidence_urls: ["https://synthetic.example/a"] });
  const s = JSON.stringify(v);
  assert(!/@[a-z]+\.(com|io|ai)\b/i.test(s));
  assert(!s.includes("apiKey") && !s.includes("Bearer "));
});
