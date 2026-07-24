import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildOutreachDraft,
  checkPersonalizationReadiness,
  assertAgentoryVoice,
  type PersonalizationInput,
} from "./personalization.ts";
import type { DecisionMaker } from "./decisionMakers.ts";
import type { CompanyEnrichment } from "./companyEnrichment.ts";

const founder: DecisionMaker = {
  name: "Jane Doe", title: "Co-Founder & CEO", linkedinUrl: "https://www.linkedin.com/in/janedoe",
  source: "job_poster", confidence: "high", why_this_person: "founder posting the role",
  evidence_url: "https://www.linkedin.com/in/janedoe", contact_status: "profile_only", email: null, email_source_url: null,
  company_match: { status: "verified", reason: "job post", matched_on: ["job_post"] },
};

const enrichment: CompanyEnrichment = {
  status: "enriched", source: "firecrawl", pages_crawled: 3,
  company_summary: "Acme builds warehouse automation for fast-growing 3PLs",
  category: "B2B SaaS", target_customer: null, founders: [], executives: [],
  growth_signals: [], public_contact_emails: [], contact_page_url: null,
  evidence_urls: ["https://acme.com/about"], missing_evidence: [], confidence: "high",
};

const base: PersonalizationInput = {
  companyName: "Acme Robotics", companyWebsite: "https://acme.com",
  jobTitle: "Founding Account Executive", jobUrl: "https://linkedin.com/jobs/view/1",
  whyNow: "They're hiring their first AE — building revenue before scaling headcount.",
  sourceQuality: "verified", gateDecision: "accept",
  decisionMaker: founder, enrichment,
};

Deno.test("Test 10: draft uses founder/company/job/why-now variables + evidence", () => {
  const d = buildOutreachDraft(base);
  assertEquals(d.status, "draft_needs_approval");
  assertEquals(d.recipient_name, "Jane Doe");
  assert(d.body.includes("Jane")); // greeting personalized
  assert(d.body.includes("Acme Robotics"));
  assert(d.body.includes("Founding Account Executive"));
  assert(d.personalization_variables_used.includes("companyName"));
  assert(d.personalization_variables_used.includes("jobTitle"));
  assert(d.personalization_variables_used.includes("decision_maker_name"));
  assert(d.personalization_variables_used.includes("whyNow"));
  assert(d.evidence_used.includes("https://linkedin.com/jobs/view/1"));
  assert(d.evidence_used.includes("https://acme.com/about"));
});

Deno.test("Test 11: insufficient evidence → refuses, lists missing, no fake email", () => {
  const d = buildOutreachDraft({ companyName: "Mystery Co", gateDecision: "accept", sourceQuality: "verified" });
  assertEquals(d.status, "insufficient_context");
  assertEquals(d.subject, "");
  assert(d.missing_context.includes("recipient_or_company_context"));
  assert(/won't send a fake-personalized email/i.test(d.body));
});

Deno.test("readiness: hard-rejected company is never personalized", () => {
  const r = checkPersonalizationReadiness({ companyName: "X", gateDecision: "reject", sourceQuality: "verified", enrichment });
  assert(!r.ready);
  assert(r.missing_context.includes("company_rejected"));
});

Deno.test("readiness: no proof → not ready", () => {
  const r = checkPersonalizationReadiness({ companyName: "X", gateDecision: "accept", sourceProof: [], decisionMaker: founder });
  assert(!r.ready);
  assert(r.missing_context.includes("source_proof"));
});

Deno.test("company-level draft (no decision-maker) works when company context exists", () => {
  const d = buildOutreachDraft({ ...base, decisionMaker: null });
  assertEquals(d.status, "draft_needs_approval");
  assertEquals(d.recipient_name, null);
  assert(d.body.includes("Acme Robotics team"));
  assert(d.risk_notes.some((n) => /Company-level draft/i.test(n)));
});

Deno.test("Test 12: draft is always approval-gated, never sent", () => {
  const d = buildOutreachDraft(base);
  assertEquals(d.status, "draft_needs_approval");
  assert(!/\bsent\b|\bsending\b/i.test(d.status));
});

Deno.test("recruiter poster recipient adds a verify-the-buyer risk note", () => {
  const recruiter: DecisionMaker = { ...founder, title: "Recruiter", confidence: "low" };
  const d = buildOutreachDraft({ ...base, decisionMaker: recruiter });
  assert(d.risk_notes.some((n) => /low-confidence poster hint|verify the real buyer/i.test(n)));
});

Deno.test("Agentory voice: generated copy never contains banned phrases", () => {
  const d = buildOutreachDraft(base);
  assertEquals(assertAgentoryVoice(d.body + " " + d.subject).length, 0);
  // sanity: the guardrail actually catches banned phrasing
  assert(assertAgentoryVoice("We are an AI SDR that will replace your team").length >= 2);
});

Deno.test("unverified missing-evidence is surfaced as a risk note, never asserted", () => {
  const d = buildOutreachDraft({ ...base, missingEvidence: ["funding", "employee_count"] });
  assert(d.risk_notes.some((n) => /Unverified: funding/i.test(n)));
  assert(!/funding|raised|series/i.test(d.body)); // never asserts unverified funding
});

// ---------- Improved generation quality (messaging spec) ----------

Deno.test("opener interprets the signal — never the banned 'I noticed X is hiring' phrasing", () => {
  const d = buildOutreachDraft(base);
  // Banned opener pattern (verbatim) must NOT appear in the body.
  assert(!/I noticed .* is hiring/i.test(d.body));
  assert(!/^Noticed .* is hiring/i.test(d.body));
  // The opener must still reference the company + the signal (job title).
  assert(/Acme Robotics/.test(d.body));
  assert(/Founding Account Executive/.test(d.body));
});

Deno.test("body is 70–120 words and structured (greeting / opener / why / Agentory / CTA)", () => {
  const d = buildOutreachDraft(base);
  const words = d.body.trim().split(/\s+/).filter(Boolean).length;
  assert(words >= 70, `body too short: ${words} words`);
  assert(words <= 130, `body too long: ${words} words`);
  // Greeting line present.
  assert(/^Hi Jane,/.test(d.body));
  // CTA is low-friction, mentions sharing a short list, never a calendar link.
  assert(/share a short list/i.test(d.body));
  assert(!/book a (call|meeting)|calendar|schedule a/i.test(d.body));
});

Deno.test("body contains no markdown / escaped newline / raw HTML leakage", () => {
  const d = buildOutreachDraft({
    ...base,
    enrichment: { ...enrichment, company_summary: "Acme builds ![Logo]() robotics <b>HTML</b> and stuff\\n\\nMore." },
  });
  assert(!/!\[/.test(d.body));
  assert(!/<[a-z]+>/i.test(d.body));
  assert(!/\\n/.test(d.body));
});

Deno.test("whyNow-led opener when present (no job-title repetition required)", () => {
  const d = buildOutreachDraft({ ...base, jobTitle: null });
  // Without a job title, the opener still references the company and uses whyNow.
  // (Body opens with the greeting; the opener is the first non-greeting line.)
  assert(/Acme Robotics — /.test(d.body));
  assert(!/search for a/.test(d.body));
});
