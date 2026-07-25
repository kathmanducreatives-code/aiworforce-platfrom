import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cleanMarkdownLeakage,
  hasReadableMessage,
  humanizeContactStatus,
  humanizePropertyName,
  humanizeSource,
  scopeDecisionMakersToCompany,
  summarizeLeadStatus,
} from "./leadDetail.ts";

// ---------- Markdown cleanup (the reported "![Harmonic Security Company Logo Kryptonite Green]()" case) ----------

Deno.test("cleanMarkdownLeakage strips markdown image alt-text entirely", () => {
  const s = "![Harmonic Security Company Logo Kryptonite Green]()\nHarmonic Security builds continuous security validation.";
  const out = cleanMarkdownLeakage(s);
  assertEquals(out.includes("Harmonic Security Company Logo"), false);
  assertEquals(out.includes("Kryptonite"), false);
  assert(out.includes("Harmonic Security builds continuous"));
});

Deno.test("cleanMarkdownLeakage keeps real link labels, drops empty-link syntax", () => {
  assertEquals(cleanMarkdownLeakage("See [Acme](https://acme.com) for more."), "See Acme for more.");
  // Empty-link syntax + empty parens both removed; whitespace collapsed.
  assertEquals(cleanMarkdownLeakage("See []() nothing."), "See nothing.");
  assertEquals(cleanMarkdownLeakage("Plain text with no markdown."), "Plain text with no markdown.");
});

Deno.test("cleanMarkdownLeakage normalizes escaped newlines + collapses whitespace", () => {
  const out = cleanMarkdownLeakage("Line one.\\n\\n   Line two.   ");
  assertEquals(out, "Line one.\n\nLine two.");
});

Deno.test("cleanMarkdownLeakage strips raw HTML + leftover emphasis", () => {
  assertEquals(cleanMarkdownLeakage("<b>Bold</b> and *italic* and `code`"), "Bold and italic and code");
});

Deno.test("cleanMarkdownLeakage tolerates non-string input", () => {
  assertEquals(cleanMarkdownLeakage(null as unknown), "");
  assertEquals(cleanMarkdownLeakage(undefined as unknown), "");
  assertEquals(cleanMarkdownLeakage(42 as unknown), "");
});

// ---------- humanizeSource / humanizeContactStatus / humanizePropertyName ----------

Deno.test("humanizeSource maps the four known sources to readable copy; unknown → null", () => {
  assertEquals(humanizeSource("job_poster"), "From the job post");
  assertEquals(humanizeSource("firecrawl_team_page"), "From the company website");
  assertEquals(humanizeSource("linkedin_people_search"), "Verified from LinkedIn profile");
  assertEquals(humanizeSource("website_contact_page"), "From the company website");
  assertEquals(humanizeSource("unknown_source"), null);
  assertEquals(humanizeSource(null), null);
});

Deno.test("humanizeContactStatus maps internal codes to readable copy", () => {
  assertEquals(humanizeContactStatus("profile_only"), "Profile found · Company match pending");
  assertEquals(humanizeContactStatus("public_email_found"), "Public email found");
  assertEquals(humanizeContactStatus("needs_contact_enrichment"), "Needs contact enrichment");
  assertEquals(humanizeContactStatus("unknown"), null);
});

Deno.test("humanizePropertyName turns snake_case into readable text", () => {
  assertEquals(humanizePropertyName("public_contact_email"), "Public Contact Email");
  assertEquals(humanizePropertyName("founder"), "Founder");
  assertEquals(humanizePropertyName("why_now"), "Why Now");
  assertEquals(humanizePropertyName(""), "");
  assertEquals(humanizePropertyName(null as unknown), "");
});

// ---------- scopeDecisionMakersToCompany (defensive client-side scoping) ----------

Deno.test("scopeDecisionMakersToCompany keeps verified + likely; routes weak / no_match to unverified", () => {
  const list = [
    { name: "Amy Zhu", title: "CRO", company_match: { status: "verified" } },
    { name: "Bob Lee", title: "VP Sales", company_match: { status: "likely" } },
    { name: "Carol Ng", title: "Head of Talent", company_match: { status: "weak" } },
    { name: "Dan Wu", title: "Recruiter", company_match: { status: "no_match" } },
  ];
  const { verified, unverified } = scopeDecisionMakersToCompany(list);
  assertEquals(verified.map((d) => d.name), ["Amy Zhu", "Bob Lee"]);
  assertEquals(unverified.map((d) => d.name), ["Carol Ng", "Dan Wu"]);
});

Deno.test("scopeDecisionMakersToCompany: missing company_match is treated as unverified, never recommended", () => {
  const { verified, unverified } = scopeDecisionMakersToCompany([
    { name: "Amy Zhu" }, // no company_match at all
    { name: "Bob Lee", company_match: {} }, // missing status
  ]);
  assertEquals(verified.length, 0);
  assertEquals(unverified.length, 2);
});

Deno.test("scopeDecisionMakersToCompany tolerates non-array input", () => {
  const empty = scopeDecisionMakersToCompany(null);
  assertEquals(empty.verified.length, 0);
  assertEquals(empty.unverified.length, 0);
});

// ---------- summarizeLeadStatus (contradictory-state fix) ----------

Deno.test("summarizeLeadStatus: 20/100 weak-verdict + deprioritize next step → rejected, never contact-ready", () => {
  const s = summarizeLeadStatus({
    verdict: "weak",
    final_overall_fit: 20,
    confidence_level: "low",
    gate_decision: "soft_reject",
    recommended_next_action: "Deprioritize — do not contact",
  });
  assertEquals(s.bucket, "rejected");
  assertEquals(s.contact_ready, false);
});

Deno.test("summarizeLeadStatus: hard reject gate → rejected regardless of fit", () => {
  const s = summarizeLeadStatus({
    verdict: "weak",
    final_overall_fit: 15,
    gate_decision: "hard_rejected",
    recommended_next_action: "Dismiss",
  });
  assertEquals(s.bucket, "rejected");
  assertEquals(s.contact_ready, false);
});

Deno.test("summarizeLeadStatus: weak fit + watch/monitor next step → weak_signal (valid signal, not contact-ready)", () => {
  const s = summarizeLeadStatus({
    verdict: "weak",
    final_overall_fit: 25,
    confidence_level: "low",
    gate_decision: "retain_for_signal",
    recommended_next_action: "Watch — re-evaluate next quarter",
  });
  assertEquals(s.bucket, "weak_signal");
  assertEquals(s.contact_ready, false);
  assert(/valid signal/i.test(s.label));
});

Deno.test("summarizeLeadStatus: strong verdict + high fit → high_fit contact-ready", () => {
  const s = summarizeLeadStatus({
    verdict: "strong",
    final_overall_fit: 86,
    confidence_level: "high",
    gate_decision: "contact",
    recommended_next_action: "Find decision-makers and draft outreach",
  });
  assertEquals(s.bucket, "high_fit");
  assertEquals(s.contact_ready, true);
});

Deno.test("summarizeLeadStatus: ambiguous inputs default to needs-review, never contact-ready", () => {
  const s = summarizeLeadStatus({});
  assertEquals(s.bucket, "watch");
  assertEquals(s.contact_ready, false);
  assertEquals(s.label, "Needs review");
});

// ---------- hasReadableMessage ----------

Deno.test("hasReadableMessage: false for empty / withheld / non-string", () => {
  assertEquals(hasReadableMessage(null), false);
  assertEquals(hasReadableMessage(""), false);
  assertEquals(hasReadableMessage("   "), false);
  assertEquals(hasReadableMessage("Draft withheld: voice guardrail tripped."), false);
});

Deno.test("hasReadableMessage: true for a real message body", () => {
  assertEquals(hasReadableMessage("Hi Amy,\n\nHarmonic Security's search for a RevOps leader…"), true);
});
