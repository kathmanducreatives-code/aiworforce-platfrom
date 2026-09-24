// EVIDENCE THAT CANNOT BE CITED IS NOT EVIDENCE.
//
// ── THE BUG A LIVE RUN FOUND, AND THE UNIT TESTS DID NOT ────────────────────
//
// `buildEvidenceRegistry` wrote the employee count as `String(45)` — the two
// characters "45". `parseMissionEvaluationStrict` checks every citation with
// `containsExcerpt`, which requires an excerpt of at least FOUR characters,
// because a one- or two-character "quote" proves nothing and would match
// almost any source text.
//
// So the employee-count item was STRUCTURALLY IMPOSSIBLE TO CITE for any
// company under 1000 staff:
//
//     model quotes "45"            → 2 chars, below the floor      → dropped
//     model quotes "45 employees"  → not a substring of "45"       → dropped
//
// A controlled end-to-end run against the real evaluator dropped exactly this
// citation on every company, every time, and marked every evaluation
// `repaired`. Nothing failed loudly. The cost was silent:
//
//   * `repaired` on every response, which is noise that would mask a real
//     parse problem
//   * and — the part that changes outcomes — a mission whose satisfiable
//     requirement is headcount could not EVIDENCE a pass, so "an uncited pass
//     is not a pass" downgraded it to review.
//
// SIZE, SINCE 2026-09-24. The size fact is now the company's DECLARED BAND,
// published as "declared company size 11-50 employees"; the LinkedIn
// associated-member count is published separately, as members and explicitly
// not staff, so it cannot be quoted as an employee count (companySize.ts).
//
// These tests assert the property the unit suite was missing: every hard fact
// the registry publishes must be quotable by the model that is required to
// quote it. The two modules are checked against each other rather than each
// against its own assumption.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEvidenceRegistry,
} from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import {
  parseMissionEvaluationStrict,
} from "../../../supabase/functions/_shared/missionEvaluation.ts";

/** The floor `containsExcerpt` enforces. Stated once, asserted below. */
const MIN_EXCERPT_CHARS = 4;

const evidence = (over: Record<string, unknown> = {}) => ({
  version: "company-evidence-v1",
  company_key: "acme.com",
  company_name: "Acme",
  domain: "acme.com",
  linkedin_company_url: "https://www.linkedin.com/company/acme",
  identity_state: "resolved",
  geography_evidence: "San Francisco, CA, USA",
  size_band_evidence: { min: 11, max: 50, source: "linkedin_declared" },
  size_band_from_company_record: true,
  linkedin_member_count_evidence: 45,
  industry_evidence: ["Software Development"],
  description: "B2B SaaS data warehouse sold on subscription.",
  source_query: null,
  source_capability: "startup_company_discovery",
  commercial_job_evidence: [{ title: "Founding Engineer", url: "https://x/1" }],
  strongest_signal: "Founding Engineer",
  evidence_urls: ["https://acme.com"],
  missing_fields: [],
  conflicting_evidence: [],
  ...over,
}) as never;

const registryFor = (over: Record<string, unknown> = {}) =>
  buildEvidenceRegistry({ company_key: "acme.com", evidence: evidence(over) } as never);

// ══════════════════ 1. every published hard fact must be quotable ══════════

Deno.test("1. EVERY item with a source_text is long enough to cite", () => {
  // THE GENERAL PROPERTY, not just the one field that was broken. A future
  // hard fact rendered as a bare number or a two-letter code fails here rather
  // than silently becoming uncitable in production.
  const reg = registryFor();
  const withText = reg.items.filter((i) => i.source_text !== null);
  assert(withText.length > 0, "the registry must publish citable evidence");
  for (const item of withText) {
    assert(
      item.source_text!.trim().length >= MIN_EXCERPT_CHARS,
      `${item.evidence_id} publishes "${item.source_text}" — too short to cite ` +
      `(needs ${MIN_EXCERPT_CHARS}+ chars)`,
    );
  }
});

Deno.test("1b. the declared size band is quotable at every LinkedIn band", () => {
  for (const [min, max] of [[1, 10], [11, 50], [51, 200], [201, 500], [10001, null]] as const) {
    const band = { min, max, source: "linkedin_declared" };
    const label = max === null ? `${min}+` : `${min}-${max}`;
    const item = registryFor({ size_band_evidence: band }).items
      .find((i) => i.evidence_type === "company_size_band")!;
    assert(item, `${label}: a company_size_band item must exist`);
    assert(item.source_text!.length >= MIN_EXCERPT_CHARS, `${label}: "${item.source_text}" is too short to cite`);
    // THE BAND IS STILL THE AUTHORITY, typed — anything reading the value reads this.
    assertEquals(item.structured_value, band, `${label}: structured_value must stay typed`);
    assert(item.source_text!.includes(label), `${label}: the citable text must contain the real band`);
    assertEquals(item.verification_state, "verified", "read from the company record");
  }
  // The member count is published as members — never as staff.
  const members = registryFor().items.find((i) => i.evidence_type === "linkedin_associated_members")!;
  assertEquals(members.structured_value, 45);
  assert(/LinkedIn associated members \(not a staff count\)/.test(members.source_text!), members.source_text!);
  assertEquals(members.verification_state, "reported");
  assertFalse(registryFor().items.some((i) => i.evidence_type === "employee_count"), "nothing writes the legacy type");
});

// ══════════════════ 2. the registry and the parser agree, end to end ══════

const evaluationCiting = (evidence_id: string, excerpt: string) => ({
  mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
  confidence: 0.9, match_score: 90,
  matched_requirements: [{ requirement: "company size within range", evidence_id, excerpt }],
  failed_requirements: [],
  reasoning: "in range", rejection_reasons: [],
  evidence_quality: "strong", unknown_fields: [], next_action: null,
});

Deno.test("2. a citation of the declared band SURVIVES the strict parser", () => {
  // THE TWO MODULES CHECKED AGAINST EACH OTHER. This is the assertion whose
  // absence let the bug ship: each side was internally consistent, and nothing
  // asked whether a citation the registry invited could actually be accepted.
  const reg = registryFor();
  const item = reg.items.find((i) => i.evidence_type === "company_size_band")!;
  // Quoted VERBATIM from what the registry published, which is exactly what
  // the prompt instructs the model to do.
  const parsed = parseMissionEvaluationStrict(evaluationCiting(item.evidence_id, item.source_text!), reg);

  assertEquals(parsed.raw_shape.dropped_citations, [],
    `the registry's own text must be citable, got: ` +
    `${JSON.stringify(parsed.raw_shape.dropped_citations)}`);
  assertEquals(parsed.parse_status, "valid");
  assertEquals(parsed.evaluation.matched_requirements.length, 1);
  // AND IT HOLDS THE PASS. This is the outcome the bug silently changed.
  assertEquals(parsed.evaluation.mission_fit, "pass");
  assertEquals(parsed.evaluation.decision, "qualified");
});

Deno.test("2b. …a bare number is still refused, and the member count cannot be quoted as employees", () => {
  // The regression, stated as a live assertion rather than a comment.
  const reg = registryFor();
  const members = reg.items.find((i) => i.evidence_type === "linkedin_associated_members")!;

  const bare = parseMissionEvaluationStrict(evaluationCiting(members.evidence_id, "45"), reg);
  assert(bare.raw_shape.dropped_citations.length > 0,
    "a two-character quote must still be refused — the floor is the point");
  // AND THE UNCITED PASS IS DOWNGRADED, which is the mechanism that made the
  // original bug change outcomes rather than merely add noise.
  assertEquals(bare.evaluation.mission_fit, "review");
  assert(bare.raw_shape.repaired_fields.includes("mission_fit:pass_without_verified_citation"));

  // "45 employees" is not what the source says: it says 45 LinkedIn members.
  const asStaff = parseMissionEvaluationStrict(evaluationCiting(members.evidence_id, "45 employees"), reg);
  assert(asStaff.raw_shape.dropped_citations.some((d) => d.startsWith("excerpt_not_in_source")),
    "a member count must not be citable as a staff count");
  assertFalse(asStaff.evaluation.mission_fit === "pass");
});

// ══════════════════ 3. the guard still refuses invented evidence ══════════

Deno.test("3. making evidence citable did not make it forgeable", () => {
  const reg = registryFor();
  const item = reg.items.find((i) => i.evidence_type === "company_size_band")!;

  // A plausible-sounding but WRONG band is not in the source text.
  const wrong = parseMissionEvaluationStrict({
    mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
    confidence: 0.9, match_score: 90,
    matched_requirements: [{
      requirement: "employee count within range",
      evidence_id: item.evidence_id,
      excerpt: "declared company size 201-500 employees",
    }],
    failed_requirements: [], reasoning: "", rejection_reasons: [],
    evidence_quality: "strong", unknown_fields: [], next_action: null,
  }, reg);
  assert(wrong.raw_shape.dropped_citations.some((d) => d.startsWith("excerpt_not_in_source")),
    "a band the source does not state must still be dropped");

  // An evidence_id from another company is still refused outright.
  const borrowed = parseMissionEvaluationStrict({
    mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
    confidence: 0.9, match_score: 90,
    matched_requirements: [{
      requirement: "employee count within range",
      evidence_id: "company_size_band:linkedin:deadbeef",
      excerpt: "declared company size 11-50 employees",
    }],
    failed_requirements: [], reasoning: "", rejection_reasons: [],
    evidence_quality: "strong", unknown_fields: [], next_action: null,
  }, reg);
  assert(borrowed.raw_shape.dropped_citations.some((d) => d.startsWith("unknown_evidence_id")),
    "an id outside this company's registry must be dropped");
  assertFalse(borrowed.evaluation.mission_fit === "pass",
    "and the uncited pass must not stand");
});
