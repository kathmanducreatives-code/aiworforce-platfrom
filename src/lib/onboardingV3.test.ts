// Onboarding v3 pure flow model. No React, no network, no providers.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  STEPS, stepIndexOf, stepAt,
  emptyFounderForm, emptyCompanyForm,
  canEnrichFounder, canAnalyzeCompany, canContinue,
  isLinkedInProfileUrl, isLinkedInCompanyUrl,
  buildDraftInput, buildSavePatch, previewBrain, applyQuickAction,
} from "./onboardingV3.ts";

Deno.test("1. the flow is exactly 5 steps, in order", () => {
  assertEquals(STEPS.length, 5);
  assertEquals(STEPS.map((s) => s.id), ["founder", "company", "research", "review", "activate"]);
  assertEquals(stepIndexOf("review"), 3);
  assertEquals(stepAt(99).id, "activate", "index is clamped");
  assert(STEPS.every((s) => s.powers.length > 0), "every step explains what it powers");
});

Deno.test("2. founder enrichment needs BOTH consent and a valid /in/ URL", () => {
  const f = { ...emptyFounderForm(), linkedin_url: "https://linkedin.com/in/jane" };
  assertEquals(canEnrichFounder(f), false, "no consent → no enrichment");
  assertEquals(canEnrichFounder({ ...f, enrichment_consent: true }), true);
  assertEquals(canEnrichFounder({ ...f, enrichment_consent: true, linkedin_url: "https://linkedin.com/company/x" }), false);
  assert(isLinkedInProfileUrl("https://linkedin.com/in/jane"));
  assert(isLinkedInCompanyUrl("https://linkedin.com/company/cekura"));
});

Deno.test("3. company analysis needs only a website (LinkedIn optional)", () => {
  assertEquals(canAnalyzeCompany({ ...emptyCompanyForm(), website_url: "https://cekura.ai" }), true);
  assertEquals(canAnalyzeCompany(emptyCompanyForm()), false);
});

Deno.test("4. step gating: founder needs a name, company needs name + website", () => {
  const founder = { ...emptyFounderForm(), name: "Jane" };
  const company = { ...emptyCompanyForm(), name: "Cekura", website_url: "https://cekura.ai" };
  assertEquals(canContinue("founder", { founder: emptyFounderForm(), company }), false);
  assertEquals(canContinue("founder", { founder, company }), true);
  assertEquals(canContinue("company", { founder, company: { ...company, website_url: "" } }), false);
  assertEquals(canContinue("company", { founder, company }), true);
  assertEquals(canContinue("research", { founder, company }), true, "AI research is skippable");
});

Deno.test("5. buildDraftInput carries research and never leaks the consent flag", () => {
  const founder = { ...emptyFounderForm(), name: "Jane", role: "CEO", enrichment_consent: true, linkedin_url: "https://linkedin.com/in/jane" };
  const company = { ...emptyCompanyForm(), name: "Cekura", website_url: "https://cekura.ai" };
  const input = buildDraftInput({ founder, company, founderResearch: { name: "Jane" }, companyResearch: { website: "https://cekura.ai" } });
  assertEquals(input.founder_input.name, "Jane");
  assertEquals(input.company_input.website_url, "https://cekura.ai");
  assertEquals((input.founder_input as any).enrichment_consent, undefined);
  assertEquals((input.founder_input as any).linkedin_url, undefined);
  assert(input.founder_research);
  assert(input.company_research);
});

Deno.test("6. previewBrain completeness rises as the Brain fills in", () => {
  const empty = previewBrain({});
  assertEquals(empty.completeness.complete, false);
  assertEquals(empty.completeness.required_met, 0);

  const full = previewBrain({
    company: { name: "Cekura", website_url: "https://cekura.ai", business_model: "B2B SaaS" },
    target_customer: { industries: ["B2B SaaS"], disqualifiers: { industries: ["pharma"] } },
    buyer_personas: ["Founder"], triggers: ["recently funded"], pain_points: ["manual outbound"],
  });
  assertEquals(full.completeness.complete, true);
  assert(full.completeness.percent > empty.completeness.percent);
});

Deno.test("7. an empty brain never fabricates targeting in the preview", () => {
  const { brain } = previewBrain({});
  assertEquals(brain.target_customer.industries, []);
  assertEquals(brain.buyer_personas, []);
  assertEquals(brain.is_draft, false);
});

Deno.test("8. buildSavePatch: user-typed values win, derived flags are never sent", () => {
  const founder = { ...emptyFounderForm(), name: "Jane", role: "CEO" };
  const company = { ...emptyCompanyForm(), name: "Typed Co", website_url: "https://typed.ai" };
  const { brain } = previewBrain({ company: { name: "AI Guessed Co", description: "from research" } });
  const patch = buildSavePatch({ founder, company, brain }) as any;

  assertEquals(patch.company.name, "Typed Co", "user input beats the AI draft");
  assertEquals(patch.company.description, "from research", "research fills what the user left blank");
  assertEquals(patch.founder.name, "Jane");
  assertEquals(patch.setup_status, undefined);
  assertEquals(patch.brain_confidence, undefined);
  assertEquals(patch.missing_fields, undefined);
});

Deno.test("9. 'never target' writes a disqualifier; 'add bad-fit' writes a negative example", () => {
  const { brain } = previewBrain({});
  const a = applyQuickAction(brain, "never_target", "lab testing");
  assert(a.target_customer.disqualifiers.industries.includes("lab testing"));

  const b = applyQuickAction(brain, "add_bad_fit", "Pace Analytical");
  assert(b.negative_examples.includes("Pace Analytical"));

  const c = applyQuickAction(brain, "require_proof", "job_url");
  assert(c.qualification_rules.required_evidence.includes("job_url"));

  const d = applyQuickAction(brain, "too_broad", "B2B SaaS");
  assert(d.qualification_rules.manual_review_if.includes("B2B SaaS"));
});

Deno.test("10. quick actions never mutate the original brain", () => {
  const { brain } = previewBrain({});
  applyQuickAction(brain, "never_target", "pharma");
  assertEquals(brain.target_customer.disqualifiers.industries, [], "original untouched");
});

Deno.test("11. 'this is correct' is a review signal, not a targeting change", () => {
  const { brain } = previewBrain({ buyer_personas: ["Founder"] });
  const after = applyQuickAction(brain, "correct");
  assertEquals(after.buyer_personas, ["Founder"]);
  assertEquals(after.target_customer.disqualifiers.industries, []);
});
