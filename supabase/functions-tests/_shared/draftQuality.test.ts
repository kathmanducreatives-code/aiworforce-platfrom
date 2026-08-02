// Draft validation + repair. Pure — no network, no providers.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  suggestBuyerPersonas, suggestDisqualifiers, suggestQualificationRules,
  stripUnsupportedClaims, countDisqualifiers, toCleanArray, cleanPersona, draftConfidenceCeiling,
} from "../../functions/_shared/draftQuality.ts";
import { cleanChip, cleanChips, gradeConfidence, capConfidence } from "../../functions/_shared/types.ts";

// ------------------------------------------------------------- sanitizing ---

Deno.test("chips: glued concatenations are split, real compounds are preserved", () => {
  assertEquals(cleanChip("FoundersSales leaders"), "Founders Sales leaders");
  assertEquals(cleanChip("RevOps"), "RevOps", "must not become 'Rev Ops'");
  assertEquals(cleanChip("HubSpot"), "HubSpot");
  assertEquals(cleanChip("SaaS"), "SaaS");
  assertEquals(cleanChip("  • Founder  "), "Founder");
  assertEquals(cleanChip('"Head of Sales"'), "Head of Sales");
});

Deno.test("chips: empties and duplicates are removed, order preserved", () => {
  assertEquals(cleanChips(["Founder", "", "  ", "founder", "CEO", "Founder"]), ["Founder", "CEO"]);
  assertEquals(toCleanArray("Founder"), ["Founder"]);
  assertEquals(toCleanArray(null), []);
  assertEquals(toCleanArray(42), []);
  assertEquals(toCleanArray({ a: 1 }), []);
});

// ------------------------------------------------------------- confidence ----

Deno.test("confidence: 'high' needs multiple strong pages, no conflicts, nothing missing", () => {
  assertEquals(gradeConfidence({ strongPages: 3, hasUserInput: true, conflicts: false, missingEvidence: 0, onlyHomepage: false }), "high");
  // any single disqualifying condition drops it
  assertEquals(gradeConfidence({ strongPages: 3, hasUserInput: true, conflicts: false, missingEvidence: 1, onlyHomepage: false }), "medium");
  assertEquals(gradeConfidence({ strongPages: 3, hasUserInput: true, conflicts: true, missingEvidence: 0, onlyHomepage: false }), "low");
  assertEquals(gradeConfidence({ strongPages: 1, hasUserInput: true, conflicts: false, missingEvidence: 0, onlyHomepage: true }), "medium");
  assertEquals(gradeConfidence({ strongPages: 0, hasUserInput: true, conflicts: false, missingEvidence: 0, onlyHomepage: false }), "low");
  assertEquals(gradeConfidence({ strongPages: 3, hasUserInput: false, conflicts: false, missingEvidence: 0, onlyHomepage: false, noSourceProof: true }), "low");
});

Deno.test("confidence: a caller can never claim more than the ceiling", () => {
  assertEquals(capConfidence("high", "low"), "low");
  assertEquals(capConfidence("high", "medium"), "medium");
  assertEquals(capConfidence("low", "high"), "low");
});

Deno.test("draft ceiling: no evidence → low; ambiguous → at most medium", () => {
  assertEquals(draftConfidenceCeiling(null), "low");
  assertEquals(draftConfidenceCeiling({ evidence: [], ambiguous: false, confidence: "high" } as never), "low");
  assertEquals(draftConfidenceCeiling({ evidence: [{}], ambiguous: true, confidence: "high" } as never), "medium");
  assertEquals(draftConfidenceCeiling({ evidence: [{}], ambiguous: false, confidence: "high" } as never), "high");
});

// --------------------------------------------------------------- personas ----

Deno.test("personas: at least 3 drafted when company context exists, all need confirmation", () => {
  const p = suggestBuyerPersonas({
    product_category: "sales software",
    one_line_summary: "outbound automation for revenue teams",
    primary_users: ["sales teams"], key_features: ["prospecting"],
  });
  assert(p.length >= 3, `expected >=3 personas, got ${p.length}`);
  assert(p.every((x) => x.needs_confirmation), "a persona is always a hypothesis");
  assert(p.every((x) => x.confidence !== "high"), "never high confidence on an inferred persona");
  // shape is complete
  for (const x of p) {
    assert(x.title && x.department && x.seniority);
    assert(Array.isArray(x.role_keywords) && x.role_keywords.length > 0);
    assert(Array.isArray(x.pains) && Array.isArray(x.cares_about));
  }
  assert(p.some((x) => /founder|ceo/i.test(x.title)), "economic buyer always present");
});

Deno.test("personas: no company context → invent nothing", () => {
  assertEquals(suggestBuyerPersonas({ product_category: "", one_line_summary: "", primary_users: [], key_features: [] }), []);
});

Deno.test("personas: relevant families are picked from the product, not hardcoded", () => {
  const dev = suggestBuyerPersonas({ product_category: "developer tools", one_line_summary: "SDK and API platform", primary_users: [], key_features: [] });
  assert(dev.some((p) => /engineering/i.test(p.title)));
  const rec = suggestBuyerPersonas({ product_category: "recruiting software", one_line_summary: "applicant tracking", primary_users: [], key_features: [] });
  assert(rec.some((p) => /talent|recruit/i.test(p.title)));
});

Deno.test("personas: a model-supplied persona is cleaned and capped", () => {
  const p = cleanPersona({ title: " • FoundersCEO ", role_keywords: ["Founder", "", "Founder"], confidence: "high" }, "low")!;
  assertEquals(p.title, "Founders CEO");
  assertEquals(p.role_keywords, ["Founder"]);
  assertEquals(p.confidence, "low", "model cannot claim high confidence above the ceiling");
  assertEquals(p.needs_confirmation, true);
  assertEquals(cleanPersona({ title: "" }, "low"), null);
});

// ----------------------------------------------------------- disqualifiers ---

Deno.test("disqualifiers: at least 5 suggested, derived from the product", () => {
  const d = suggestDisqualifiers({
    product_category: "revenue operations software", business_model: "B2B SaaS",
    target_industries: ["B2B SaaS"], primary_users: ["revops"],
  });
  assert(countDisqualifiers(d) >= 5, `expected >=5, got ${countDisqualifiers(d)}`);
  assert(d.industries.length > 0 && d.company_types.length > 0 && d.titles.length > 0);
  // software seller excludes staffing/recruiting
  assert(d.industries.some((x) => /staffing and recruiting/i.test(x)));
  assert(d.company_types.some((x) => /agenc/i.test(x)));
});

Deno.test("disqualifiers: a recruiting product does NOT exclude recruiting", () => {
  const d = suggestDisqualifiers({
    product_category: "recruiting software", business_model: "B2B SaaS",
    target_industries: ["staffing"], primary_users: ["recruiters"],
  });
  assert(!d.industries.some((x) => /staffing and recruiting/i.test(x)), "never disqualify your own market");
});

Deno.test("disqualifiers: SMB focus excludes enterprise-only", () => {
  const d = suggestDisqualifiers({
    product_category: "sales software", business_model: "B2B SaaS",
    target_industries: [], primary_users: [], user_description: "for startups and founders",
  });
  assert(d.company_types.some((x) => /enterprise-only/i.test(x)));
});

// ------------------------------------------------------ qualification rules --

Deno.test("qualification rules: all three buckets always produced", () => {
  const r = suggestQualificationRules({ hasIndustries: true, hasTriggers: true });
  assert(r.required_evidence.length >= 3);
  assert(r.reject_if.length >= 3);
  assert(r.manual_review_if.length >= 3);
  assert(r.reject_if.some((x) => /disqualifier/i.test(x)));
  assert(r.reject_if.some((x) => /buyer title with no company fit/i.test(x)));
  assert(r.reject_if.some((x) => /staffing or recruiter proxy/i.test(x)));
  assert(r.manual_review_if.some((x) => /lacks a source/i.test(x)));
});

// ------------------------------------------------------- unsupported claims --

Deno.test("claims: funding is always stripped — a website scrape cannot prove it", () => {
  const g = stripUnsupportedClaims({
    proof_points: ["Raised $4M seed round", "3x faster research"],
    positive_examples: [], integrations: [], competitors: [],
    sourceProof: ["3x faster research every week"], sourceIntegrations: [], hasSourcePages: true,
  });
  assertEquals(g.proof_points, ["3x faster research"]);
  assert(g.dropped.some((d) => /funding claim/i.test(d)));
});

Deno.test("claims: unsourced proof and integrations are dropped, not shown", () => {
  const g = stripUnsupportedClaims({
    proof_points: ["10x pipeline growth"], integrations: ["Salesforce", "Slack"],
    positive_examples: [], competitors: [],
    sourceProof: [], sourceIntegrations: ["integrates with Salesforce"], hasSourcePages: true,
  });
  assertEquals(g.proof_points, [], "model-authored proof is not proof");
  assertEquals(g.integrations, ["Salesforce"], "only integrations a page stated");
  assert(g.dropped.some((d) => /unsourced proof/i.test(d)));
  assert(g.dropped.some((d) => /unsourced integration: Slack/i.test(d)));
});

Deno.test("claims: named customers and competitors always need confirmation", () => {
  const g = stripUnsupportedClaims({
    proof_points: [], integrations: [], positive_examples: ["Acme"], competitors: ["Clay"],
    sourceProof: [], sourceIntegrations: [], hasSourcePages: true,
  });
  assert(g.needs_confirmation.includes("positive_examples"));
  assert(g.needs_confirmation.includes("competitors"));
  assertEquals(g.positive_examples, ["Acme"], "kept, but flagged — never silently trusted");
});
