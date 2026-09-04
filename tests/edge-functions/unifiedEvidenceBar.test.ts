// PHASE 1 — ONE EVIDENCE BAR, BOTH PASSES.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage 8cfdfd10 qualified DiligenceVault with this receipt:
//
//     requirement  "Company operates in B2B SaaS / software"
//     citation     company_industry:linkedin:d12930f7
//     excerpt      "Software Development"
//
// Two failures in one line. A provider's industry label was accepted as proof
// of a business model, and the Mission's requirement — "B2B SaaS" — was widened
// to "B2B SaaS / software", a claim the label does satisfy. A requirement that
// can be broadened until the evidence fits is not a requirement.
//
// The rules that forbid both lived only in the RE-evaluation prompt. The first
// pass runs on every company; the second runs on a handful. The weaker bar was
// the one doing almost all the work.
//
// ZERO network, ZERO DB, ZERO model, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseMissionEvaluationStrict, enforceReceiptSufficiency,
  EVIDENCE_POLICY, MISSION_EVALUATION_PROMPT, MISSION_REEVALUATION_PROMPT,
  type RequirementMatch,
} from "../../supabase/functions/_shared/missionEvaluation.ts";
import {
  buildEvidenceRegistry,
} from "../../supabase/functions/_shared/leadEvidenceRegistry.ts";

const B2B = "Company is a B2B SaaS company";

/** A registry holding an industry label and two real pages. */
function registry() {
  return buildEvidenceRegistry({
    evidence: {
      version: "company-evidence-v1", company_key: "acme", company_name: "Acme",
      domain: "acme.com", linkedin_company_url: null, identity_state: "verified_match",
      geography_evidence: null, employee_evidence: null,
      industry_evidence: ["Software Development"],
      description: null, source_query: null,
      source_capability: "general_company_discovery",
      commercial_job_evidence: [], strongest_signal: null, evidence_urls: [],
      missing_fields: [], conflicting_evidence: [],
    } as never,
    web_pages: [
      { source_url: "https://acme.com/pricing", page_intent: "pricing",
        source_text: "Team plan: $80 per user per month, billed annually.",
        fetched_at: "2026-09-04T00:00:00Z" },
      { source_url: "https://acme.com/customers", page_intent: "customers",
        source_text: "Trusted by procurement teams at 400 enterprises.",
        fetched_at: "2026-09-04T00:00:00Z" },
    ],
  });
}

const idFor = (reg: ReturnType<typeof registry>, type: string, contains?: string) =>
  reg.items.find((i) =>
    i.evidence_type === type &&
    (!contains || (i.source_text ?? "").includes(contains)))!.evidence_id;

// ───────────────────── the weak inference, both passes ──────────────────────

Deno.test("INDUSTRY LABEL ALONE cannot establish a business model", () => {
  const reg = registry();
  const industryId = idFor(reg, "company_industry");
  // Exactly what DiligenceVault's receipt looked like, minus the broadening.
  const parsed = parseMissionEvaluationStrict({
    mission_fit: "pass", confidence: 0.9, match_score: 90,
    matched_requirements: [{
      requirement: B2B, evidence_id: industryId,
      excerpt: "Software Development", support: "supported",
    }],
    failed_requirements: [], reasoning: "", rejection_reasons: [],
    evidence_quality: "moderate", unknown_fields: [], next_action: null,
  }, reg);
  // The citation is verbatim and the id is real, so the OLD parser kept it.
  // It is now refused as a receipt: one corroborating citation is not two.
  assertEquals(parsed.evaluation.matched_requirements.length, 0,
    "a lone industry label must not satisfy a business-model requirement");
  assert(parsed.raw_shape.dropped_citations.some((d) => d.includes("insufficient_receipt")));
});

Deno.test("industry label PLUS real corroboration may satisfy it", () => {
  const reg = registry();
  const parsed = parseMissionEvaluationStrict({
    mission_fit: "pass", confidence: 0.9, match_score: 90,
    matched_requirements: [
      { requirement: B2B, evidence_id: idFor(reg, "web_page", "$80 per user"),
        excerpt: "$80 per user per month", support: "supported" },
      { requirement: B2B, evidence_id: idFor(reg, "web_page", "procurement teams"),
        excerpt: "Trusted by procurement teams at 400 enterprises", support: "supported" },
    ],
    failed_requirements: [], reasoning: "", rejection_reasons: [],
    evidence_quality: "strong", unknown_fields: [], next_action: null,
  }, reg);
  // Recurring per-seat pricing + business customers, from two different pages.
  assertEquals(parsed.evaluation.matched_requirements.length, 2);
});

Deno.test("a single DIRECT citation still satisfies when marked verified", () => {
  const reg = registry();
  const parsed = parseMissionEvaluationStrict({
    mission_fit: "pass", confidence: 0.9, match_score: 90,
    matched_requirements: [{
      requirement: B2B, evidence_id: idFor(reg, "web_page", "$80 per user"),
      excerpt: "$80 per user per month", support: "verified",
    }],
    failed_requirements: [], reasoning: "", rejection_reasons: [],
    evidence_quality: "strong", unknown_fields: [], next_action: null,
  }, reg);
  assertEquals(parsed.evaluation.matched_requirements.length, 1,
    "the bar is corroboration for hedged claims, not two citations for everything");
});

// ────────────────── the two passes agree on the same evidence ───────────────

Deno.test("FIRST PASS and RE-EVALUATION reach the same verdict on the same receipt", () => {
  const reg = registry();
  const answer = (support: "verified" | "supported") => ({
    mission_fit: "pass", confidence: 0.9, match_score: 90,
    matched_requirements: [{
      requirement: B2B, evidence_id: idFor(reg, "company_industry"),
      excerpt: "Software Development", support,
    }],
    failed_requirements: [], reasoning: "", rejection_reasons: [],
    evidence_quality: "moderate", unknown_fields: [], next_action: null,
  });
  // Both passes run through the SAME parser, which is the point: there is one
  // enforcement site, so they cannot diverge.
  for (const support of ["verified", "supported"] as const) {
    const a = parseMissionEvaluationStrict(answer(support), reg);
    const b = parseMissionEvaluationStrict(answer(support), reg);
    assertEquals(
      a.evaluation.matched_requirements.length,
      b.evaluation.matched_requirements.length,
      `the two passes must agree for support=${support}`,
    );
  }
});

Deno.test("both prompts embed the SAME policy text, not a paraphrase", () => {
  const n = (x: string) => x.toLowerCase().replace(/\s+/g, " ");
  const policy = n(EVIDENCE_POLICY);
  assert(n(MISSION_EVALUATION_PROMPT).includes(policy), "first pass");
  assert(n(MISSION_REEVALUATION_PROMPT).includes(policy), "re-evaluation");
});

Deno.test("the policy is generic across categories, not a phrase list", () => {
  const p = EVIDENCE_POLICY.toLowerCase().replace(/\s+/g, " ");
  // Named as EXAMPLES of a rule about evidence kinds. The rule must be stated
  // generally — a list of banned phrases would not generalise to the next one.
  assert(p.includes("never establishes, on its own"));
  assert(p.includes("who the customers are"));
  for (const example of ["software development", "financial services", "it services"]) {
    assert(p.includes(example), `${example} should appear as an example`);
  }
  assert(p.includes("for every category and"), "stated as a general rule");
});

Deno.test("requirement broadening is forbidden in the shared policy", () => {
  const p = EVIDENCE_POLICY.toLowerCase().replace(/\s+/g, " ");
  assert(p.includes("never widen one so the evidence fits"));
  assert(p.includes("answering an easier question than the user asked"));
});

// ─────────────────────────── receipt rule, directly ─────────────────────────

Deno.test("two receipts from the SAME source do not corroborate", () => {
  const pages: Record<string, string> = { a: "pricing", b: "pricing", c: "customers" };
  const cite = (id: string): RequirementMatch =>
    ({ requirement: B2B, evidence_id: id, excerpt: "x", support: "supported" });
  const same = enforceReceiptSufficiency([cite("a"), cite("b")], (id) => pages[id] ?? null);
  assertEquals(same.satisfied.length, 0);
  const diff = enforceReceiptSufficiency([cite("a"), cite("c")], (id) => pages[id] ?? null);
  assertEquals(diff.satisfied.length, 2);
});
