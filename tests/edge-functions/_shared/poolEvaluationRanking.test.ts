// EVALUATE EVERYONE ELIGIBLE, COMPARE THE POOL, AND LET CODE DECIDE WHAT SHIPS.
//
// Three separate guarantees are under test here:
//
//   * a FREE gate removes only companies a verified fact contradicts, so a
//     model call is never spent proving what was already known — and never
//     withheld from a company merely because something was unknown;
//   * batching is a transport optimisation and NOT a unit of correctness: one
//     company's evidence can never support another, a missing or duplicated
//     result is detected, and one malformed row does not discard nine good ones;
//   * a persuasive sentence cannot move a REJECT above a QUALIFIED, invent a
//     company, or smuggle a provider name into what the user reads.
//
// ZERO network, ZERO Actor runs, ZERO real model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEligiblePool, geographyContradicts,
} from "../../../supabase/functions/_shared/leadEligiblePool.ts";
import {
  buildBatchPayload, evaluateBatchResponse, planBatches, resolveBatchLimits,
  MAX_BATCH_SIZE, DEFAULT_MAX_EVALUATED,
} from "../../../supabase/functions/_shared/groundedBatchEvaluation.ts";
import {
  applyPortfolioPolicy, buildCandidateSummary, buildPoolRankingPayload,
  deterministicOrder, validatePoolRanking,
  type GroundedCandidateSummary,
} from "../../../supabase/functions/_shared/poolRanking.ts";
import {
  isFullPoolEvaluationEnabled, isPoolRankingEnabled,
  FULL_POOL_FLAG, FULL_POOL_WORKSPACES_ENV,
  POOL_RANKING_FLAG, POOL_RANKING_WORKSPACES_ENV, POOL_RANKING_MODE_ENV,
} from "../../../supabase/functions/_shared/poolEvaluationBinding.ts";
import {
  buildEvidenceRegistry,
} from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import {
  buildCompanyEvidence,
} from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { normalizeLinkedInJob } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";

const NOW = Date.parse("2026-08-06T00:00:00Z");
const MISSION = parseLeadMissionDeterministic(
  "Find founders of US B2B SaaS startups hiring Sales Operations. Return 25 qualified leads.");

const env = (o: Record<string, string>) => (k: string) => o[k];
const WS = "11111111-2222-4333-8444-555555555555";

function company(over: Record<string, unknown> = {}) {
  return {
    external_source_id: "x", company_name: "Acme", canonical_domain: "acme.com",
    linkedin_company_url: "https://www.linkedin.com/company/acme",
    website: "https://acme.com",
    description: "Acme sells electronic-design software to engineering teams.",
    provider_industry: "Software Development",
    industry_ids: [{ id: "4", name: "B2B SaaS", hierarchy: "Tech" }],
    employee_count: 60, employee_range_advisory: null, geography: "United States",
    company_type: null, startup_evidence: null, hiring_status: true,
    source_provenance: "harvestapi/linkedin-company", field_trust: {},
    missing_fields: [], raw_ref: { actor_key: "x", source_id: "x" },
    ...over,
  } as never;
}

const job = (title: string, date: string | null) => normalizeLinkedInJob({
  id: title, title, linkedinUrl: `https://x/${encodeURIComponent(title)}`,
  ...(date ? { postedDate: date } : {}),
  company: { id: 1, name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme" },
});

function registryFor(key: string, over: Record<string, unknown> = {}, jobs = [job("Head of Sales", "2026-08-01")]) {
  return buildEvidenceRegistry({
    evidence: buildCompanyEvidence({
      company_key: key, source_capability: "startup_company_discovery",
      company: company({ company_name: key, ...over }),
      identity_state: (over.identity_state as never) ?? "resolved",
      linkedin_company_url: `https://www.linkedin.com/company/${key}`,
    }),
    jobs, now: NOW,
  });
}

const candidate = (key: string, over: Record<string, unknown> = {}, extra = {}) => ({
  company_key: key, company_name: key, registry: registryFor(key, over), ...extra,
});

// ══════════════════════════════════════════════════ 1-5. eligible pool ══

Deno.test("1. a verified geography mismatch is removed before any model call", () => {
  const pool = buildEligiblePool([
    candidate("in-us", { geography: "United States" }),
    candidate("in-de", { geography: "Berlin, Germany" }),
  ], { mission: MISSION });
  assertEquals(pool.eligible.map((c) => c.company_key), ["in-us"]);
  assertEquals(pool.excluded[0].reason, "verified_geography_mismatch");
  // …and an UNKNOWN geography is not a mismatch.
  const unknown = buildEligiblePool(
    [candidate("no-geo", { geography: null })], { mission: MISSION });
  assertEquals(unknown.eligible.length, 1, "unknown is a REVIEW question, not an exclusion");
  assertFalse(geographyContradicts(null, ["United States"]));
  assertFalse(geographyContradicts("San Francisco, CA, USA", ["United States"]));
  assert(geographyContradicts("Berlin, Germany", ["United States"]));
});

Deno.test("2. a verified employee-size mismatch is removed; an unknown one is not", () => {
  const pool = buildEligiblePool([
    candidate("right-size", { employee_count: 60 }),
    candidate("far-too-big", { employee_count: 5000 }),
    candidate("size-unknown", { employee_count: null }),
  ], { mission: MISSION, employee_max: 150 });
  const keys = pool.eligible.map((c) => c.company_key);
  assert(keys.includes("right-size"));
  assert(keys.includes("size-unknown"), "an unknown headcount must not gate");
  assertFalse(keys.includes("far-too-big"));
});

Deno.test("3. duplicates are evaluated once", () => {
  const pool = buildEligiblePool([
    candidate("acme"), candidate("acme"), candidate("beta"),
  ], { mission: MISSION });
  assertEquals(pool.eligible.length, 2);
  assertEquals(pool.metrics.exclusion_reasons.duplicate_company, 1);
});

Deno.test("4. a provider failure is never a hard negative", () => {
  const reg = buildEvidenceRegistry({
    evidence: buildCompanyEvidence({
      company_key: "failed-lookup", source_capability: "startup_company_discovery",
      company: company({ company_name: "failed-lookup" }), identity_state: "resolved",
    }),
    jobs: [], now: NOW,
    provider_failures: [{
      provider: "apify_linkedin_job_search", capability: "hiring_verification",
      reason: "actor run failed",
    }],
  });
  const pool = buildEligiblePool(
    [{ company_key: "failed-lookup", company_name: "failed-lookup", registry: reg }],
    { mission: MISSION });
  assertEquals(pool.eligible.length, 1,
    "an outage must not remove a company from evaluation");
});

Deno.test("5. pool metrics are honest and every exclusion carries a reason", () => {
  const pool = buildEligiblePool([
    candidate("ok-1"), candidate("ok-2"),
    candidate("wrong-country", { geography: "Berlin, Germany" }),
    candidate("ok-1"),
  ], { mission: MISSION });
  assertEquals(pool.metrics.discovered, 4);
  assertEquals(pool.metrics.eligible, 2);
  assertEquals(pool.metrics.hard_gated, 2);
  assertEquals(pool.metrics.eligible + pool.metrics.hard_gated, pool.metrics.discovered);
  for (const e of pool.excluded) assert(e.detail.length > 0, "every exclusion explains itself");
});

// ═══════════════════════════════════════════════ 6-15. batch evaluation ══

Deno.test("6-7. more than ten companies are evaluated, in bounded batches", () => {
  const many = Array.from({ length: 37 }, (_, i) => candidate(`c${i}`));
  const pool = buildEligiblePool(many, { mission: MISSION });
  assertEquals(pool.eligible.length, 37, "the ten-company ceiling is gone");

  const limits = resolveBatchLimits({ batch_size: 8, max_evaluated: 100 });
  const { batches, evaluated_cap } = planBatches(pool.eligible, limits);
  assertEquals(evaluated_cap, 37);
  assertEquals(batches.length, 5);
  for (const b of batches) assert(b.length <= limits.batch_size);

  // The browser cannot widen either bound.
  assertEquals(resolveBatchLimits({ batch_size: 9999 }).batch_size, MAX_BATCH_SIZE);
  assertEquals(resolveBatchLimits({ max_evaluated: 100000 }).max_evaluated,
    DEFAULT_MAX_EVALUATED);
  // And the ceiling is applied, with the remainder reported rather than hidden.
  const capped = planBatches(
    Array.from({ length: 130 }, (_, i) => i), resolveBatchLimits({}));
  assertEquals(capped.evaluated_cap, 100);
  assertEquals(capped.beyond_cap, 30);
});

const member = (key: string) => ({
  company_key: key, company_name: key, registry: registryFor(key),
  requiresCommercialSignal: false,
});

function goodResult(key: string) {
  const reg = registryFor(key);
  const d = reg.items.find((x) => x.evidence_type === "company_description")!.evidence_id;
  return {
    company_key: key,
    business_model: {
      value: "b2b_software", confidence: 0.9,
      claims: [{
        claim: `${key} sells electronic-design software.`, claim_type: "business_model",
        evidence_ids: [d],
        evidence_excerpts: [{ evidence_id: d, excerpt: "electronic-design software" }],
      }],
    },
    company_fit: "pass", agentory_use_case: "strong",
    supporting_claims: [], confidence: 0.9, reason: "fits",
  };
}

Deno.test("8. one company's evidence can never support another", () => {
  const batch = [member("alpha"), member("beta")];
  // beta's result cites ALPHA's description id.
  const alphaReg = registryFor("alpha");
  const alphaDesc = alphaReg.items
    .find((x) => x.evidence_type === "company_description")!.evidence_id;
  const res = evaluateBatchResponse({
    batch,
    raw: {
      results: [
        goodResult("alpha"),
        {
          company_key: "beta",
          business_model: {
            value: "b2b_saas", confidence: 0.9,
            claims: [{
              claim: "beta sells software", claim_type: "business_model",
              evidence_ids: [alphaDesc], evidence_excerpts: [],
            }],
          },
          company_fit: "pass", agentory_use_case: "strong",
          supporting_claims: [], confidence: 0.9, reason: "",
        },
      ],
    },
  });
  const beta = res.outcomes.find((o) => o.company_key === "beta")!;
  assertEquals(beta.verification!.validated_claims.length, 0,
    "a borrowed evidence id must validate nothing");
  assertEquals(beta.verification!.final_grounded_decision, "review");
  // alpha is unaffected.
  const alpha = res.outcomes.find((o) => o.company_key === "alpha")!;
  assertEquals(alpha.verification!.final_grounded_decision, "pass");
});

Deno.test("9-10. a missing result is detected and a duplicate is refused", () => {
  const batch = [member("alpha"), member("beta"), member("gamma")];
  const res = evaluateBatchResponse({
    batch,
    raw: { results: [goodResult("alpha"), goodResult("beta"), goodResult("beta")] },
  });
  const gamma = res.outcomes.find((o) => o.company_key === "gamma")!;
  assertEquals(gamma.failure, "missing_from_response");
  assertEquals(gamma.verification, null);

  const beta = res.outcomes.find((o) => o.company_key === "beta")!;
  assertEquals(beta.failure, "duplicate_in_response");
  assertEquals(beta.verification, null, "two answers is not more information");

  // A result for a company outside the batch is recorded, never matched.
  const foreign = evaluateBatchResponse({
    batch: [member("alpha")],
    raw: { results: [goodResult("alpha"), goodResult("not-in-batch")] },
  });
  assertEquals(foreign.foreign_results, ["not-in-batch"]);
  assertEquals(foreign.outcomes.length, 1);
});

Deno.test("11-13. one bad row does not discard the batch, and cannot qualify", () => {
  const batch = [member("alpha"), member("beta")];
  const res = evaluateBatchResponse({
    batch,
    raw: {
      results: [
        goodResult("alpha"),
        // beta claims something the evidence does not say.
        {
          company_key: "beta",
          business_model: {
            value: "b2b_saas", confidence: 0.99,
            claims: [{
              claim: "beta sells API subscriptions.", claim_type: "business_model",
              evidence_ids: [], evidence_excerpts: [],
            }],
          },
          company_fit: "pass", agentory_use_case: "strong",
          supporting_claims: [], confidence: 0.99, reason: "",
        },
      ],
    },
  });
  assertEquals(res.evaluated, 2, "both companies were assessed");
  const alpha = res.outcomes.find((o) => o.company_key === "alpha")!;
  assertEquals(alpha.verification!.final_grounded_decision, "pass",
    "a good result survives a neighbour's bad one");
  const beta = res.outcomes.find((o) => o.company_key === "beta")!;
  assertEquals(beta.verification!.final_grounded_decision, "review",
    "an unsupported claim cannot qualify");
  assert(beta.verification!.rejected_claims.length > 0, "and it went through the verifier");
});

Deno.test("14. the batch payload keeps every company's evidence in its own section", () => {
  const payload = buildBatchPayload({
    batch: [member("alpha"), member("beta")], originalUserQuery: "q",
  }) as Record<string, unknown>;
  const companies = payload.companies as Array<Record<string, unknown>>;
  assertEquals(companies.length, 2);
  // No shared evidence pool exists at all — there is nowhere to borrow from
  // that would look legitimate.
  assertFalse("evidence" in payload);
  for (const c of companies) {
    assert(Array.isArray(c.evidence));
    assert(c.established_facts);
  }
  // And no vendor name reaches the model.
  const text = JSON.stringify(payload).toLowerCase();
  for (const v of ["harvestapi", "memo23", "apify_", "solidcode"]) {
    assertFalse(text.includes(v), `payload leaks ${v}`);
  }
});

// ═════════════════════════════════════════════════ 16-28. pool ranking ══

function summary(
  key: string, decision: "qualified" | "review" | "reject",
  tier: "A" | "B" | "C" | null, grounding = 0.9,
): GroundedCandidateSummary {
  return {
    company_key: key, company_name: key, brain_decision: decision,
    opportunity_tier: tier, grounding_score: grounding,
    confidence_after_grounding: grounding * 0.9,
    business_model: "b2b_saas", agentory_use_case: "strong",
    strongest_signal: decision === "qualified" ? "Hiring Head of Sales." : null,
    signal_strength: decision === "qualified" ? "strong" : "none",
    validated_claim_ids: ["business_model"], validated_evidence_ids: ["e1"],
    missing_evidence: [], material_conflicts: [],
    mission_match_summary: `${key} fits`, reason_to_contact_now: null,
  };
}

const POOL: GroundedCandidateSummary[] = [
  summary("q1", "qualified", "A", 1.0), summary("q2", "qualified", "A", 0.9),
  summary("q3", "qualified", "B", 0.8), summary("r1", "review", "B", 0.6),
  summary("r2", "review", null, 0.5), summary("w1", "review", "C", 0.4),
  summary("x1", "reject", null, 0.9),
];

Deno.test("16-17. the ranking payload carries summaries only, never raw evidence", () => {
  const p = buildPoolRankingPayload({
    originalUserQuery: "q", requestedCount: 25, summaries: POOL, unevaluatedCount: 3,
  }) as Record<string, unknown>;
  assertEquals((p.candidates as unknown[]).length, POOL.length);
  assertEquals((p.coverage as Record<string, number>).unevaluated, 3,
    "coverage is stated honestly");
  const text = JSON.stringify(p);
  // No registries, no rejected claims, no provider payloads, no people.
  for (const forbidden of [
    "source_text", "rejected_claims", "harvestapi", "apify_", "linkedin.com/in/",
  ]) {
    assertFalse(text.includes(forbidden), `ranking payload leaks ${forbidden}`);
  }
});

Deno.test("18-21. every company appears once, with unique sequential ranks", () => {
  const v = validatePoolRanking({
    raw: {
      ranked_candidates: [
        { company_key: "q2", rank: 1, relative_strength: "strong", ranking_reason: "best fit", comparison_basis: ["mission_fit"], recommended_action: "offer_founder_unlock" },
        { company_key: "q1", rank: 1, relative_strength: "strong", ranking_reason: "also strong", comparison_basis: ["signal_strength"], recommended_action: "offer_founder_unlock" },
        { company_key: "q2", rank: 7, relative_strength: "weak", ranking_reason: "dup", comparison_basis: [], recommended_action: "review" },
      ],
      portfolio_summary: { ranking_confidence: 0.8, pool_explanation: "compared" },
    },
    summaries: POOL, requestedCount: 25,
  });
  const keys = v.ranked.map((r) => r.company_key);
  assertEquals(keys.length, new Set(keys).size, "no company appears twice");
  assertEquals(v.ranked.map((r) => r.rank), v.ranked.map((_, i) => i + 1),
    "ranks are unique and sequential");
  assert(v.rejected_entries.some((r) => r.reason === "duplicate_company_key"));
  // Every candidate is accounted for, including ones the model omitted.
  assertEquals(new Set(keys).size, POOL.length);
  assert(v.validator_changes.some((c) => /appended/.test(c)));
});

Deno.test("19b. an invented company is rejected, not ranked", () => {
  const v = validatePoolRanking({
    raw: {
      ranked_candidates: [
        { company_key: "ghost-corp", rank: 1, relative_strength: "strong", ranking_reason: "invented", comparison_basis: [], recommended_action: "offer_founder_unlock" },
        { company_key: "q1", rank: 2, relative_strength: "strong", ranking_reason: "real", comparison_basis: [], recommended_action: "offer_founder_unlock" },
      ],
    },
    summaries: POOL, requestedCount: 25,
  });
  assertFalse(v.ranked.some((r) => r.company_key === "ghost-corp"));
  assert(v.rejected_entries.some((r) =>
    r.company_key === "ghost-corp" && r.reason === "unknown_company_key"));
});

Deno.test("22. a REJECT can never outrank a QUALIFIED, however persuasive", () => {
  const v = validatePoolRanking({
    raw: {
      ranked_candidates: [
        { company_key: "x1", rank: 1, relative_strength: "strong", ranking_reason: "looks great to me", comparison_basis: ["mission_fit"], recommended_action: "offer_founder_unlock" },
        { company_key: "q1", rank: 2, relative_strength: "strong", ranking_reason: "solid", comparison_basis: ["mission_fit"], recommended_action: "offer_founder_unlock" },
      ],
    },
    summaries: POOL, requestedCount: 25,
  });
  const rejectRank = v.ranked.find((r) => r.company_key === "x1")!.rank;
  const qualRank = v.ranked.find((r) => r.company_key === "q1")!.rank;
  assert(qualRank < rejectRank, "code owns the decision-class boundary");
});

Deno.test("23-26. ranking cannot smuggle providers, people or new facts", () => {
  const v = validatePoolRanking({
    raw: {
      ranked_candidates: [
        { company_key: "q1", rank: 1, relative_strength: "strong", ranking_reason: "harvestapi says they are hiring", comparison_basis: ["mission_fit"], recommended_action: "offer_founder_unlock" },
        { company_key: "q2", rank: 2, relative_strength: "strong", ranking_reason: "contact founder at jane@acme.com", comparison_basis: ["mission_fit"], recommended_action: "offer_founder_unlock" },
        { company_key: "q3", rank: 3, relative_strength: "moderate", ranking_reason: "clean comparison on mission fit", comparison_basis: ["mission_fit", "not_a_real_basis"], recommended_action: "offer_founder_unlock" },
      ],
    },
    summaries: POOL, requestedCount: 25,
  });
  for (const bad of ["q1", "q2"]) {
    assert(v.rejected_entries.some((r) =>
      r.company_key === bad && r.reason === "forbidden_vocabulary"),
      `${bad} must be refused for forbidden vocabulary`);
  }
  const q3 = v.ranked.find((r) => r.company_key === "q3")!;
  assertEquals(q3.comparison_basis, ["mission_fit"], "the vocabulary is closed");
  const text = JSON.stringify(v.ranked);
  assertFalse(text.includes("harvestapi"));
  assertFalse(text.includes("@acme.com"));
});

Deno.test("27-28. a malformed or absent ranking falls back deterministically", () => {
  for (const junk of [null, undefined, "not json", 42, [], {}, { ranked_candidates: [] }]) {
    const v = validatePoolRanking({ raw: junk, summaries: POOL, requestedCount: 25 });
    assertEquals(v.ranking_source, "deterministic_fallback",
      `${JSON.stringify(junk)} must fall back`);
    assert(v.fallback_reason, "and say why");
    // THE WORKFLOW SURVIVES. Every candidate still has a place.
    assertEquals(v.ranked.length, POOL.length);
    assertEquals(v.ranked.map((r) => r.rank), v.ranked.map((_, i) => i + 1));
  }
  // The deterministic order is total and stable.
  const a = deterministicOrder(POOL).map((s) => s.company_key);
  const b = deterministicOrder([...POOL].reverse()).map((s) => s.company_key);
  assertEquals(a, b, "same pool, same order, every time");
  assertEquals(a[0], "q1", "qualified, tier A, highest grounding leads");
  assertEquals(a[a.length - 1], "x1", "reject is last");
});

// ══════════════════════════════════════════════════ 29-35. portfolio ══

Deno.test("31-35. code caps honestly and never pads to reach the request", () => {
  const ranking = validatePoolRanking({ raw: null, summaries: POOL, requestedCount: 25 });
  const d = applyPortfolioPolicy({
    ranking, summaries: POOL, requestedCount: 25,
    eligibleCount: 10, unevaluatedCount: 3,
  });
  // Six non-reject candidates exist; twenty-five were asked for.
  assertEquals(d.metrics.delivered, 6);
  assertEquals(d.metrics.shortfall, 19, "the gap is reported, not filled");
  assertFalse(d.delivered.some((x) => x.summary.brain_decision === "reject"),
    "a reject never ships");
  // DELIVERED IS NOT QUALIFIED.
  assertEquals(d.metrics.qualified, 3);
  assert(d.metrics.delivered > d.metrics.qualified,
    "delivered must not be reported as qualified");
  assertEquals(d.metrics.unevaluated, 3, "coverage stays visible");
  assertEquals(d.metrics.contact_ready, 0);
  assertEquals(d.metrics.founder_unlocked, 0);

  // A smaller request caps without changing the order.
  const five = applyPortfolioPolicy({
    ranking, summaries: POOL, requestedCount: 5, eligibleCount: 10, unevaluatedCount: 0,
  });
  assertEquals(five.metrics.delivered, 5);
  assertEquals(five.metrics.shortfall, 0);
  assertEquals(five.delivered[0].summary.company_key, "q1");
});

Deno.test("31b. review and watch can be excluded by policy", () => {
  const ranking = validatePoolRanking({ raw: null, summaries: POOL, requestedCount: 25 });
  const strict = applyPortfolioPolicy({
    ranking, summaries: POOL, requestedCount: 25, eligibleCount: 10,
    unevaluatedCount: 0, allowReview: false, allowWatch: false,
  });
  for (const x of strict.delivered) {
    assertEquals(x.summary.brain_decision, "qualified");
  }
});

// ═══════════════════════════════════════════════ 41-45. flags & safety ══

Deno.test("41-44. both features are off by default and QA-only when on", () => {
  assertEquals(isFullPoolEvaluationEnabled(WS, env({})).reason, "flag_off");
  assertEquals(
    isFullPoolEvaluationEnabled(WS, env({ [FULL_POOL_FLAG]: "true" })).reason,
    "no_workspace_allowlist");
  assertEquals(
    isFullPoolEvaluationEnabled("other-ws", env({
      [FULL_POOL_FLAG]: "true", [FULL_POOL_WORKSPACES_ENV]: WS,
    })).reason, "workspace_not_allowed");
  assert(isFullPoolEvaluationEnabled(WS, env({
    [FULL_POOL_FLAG]: "true", [FULL_POOL_WORKSPACES_ENV]: WS,
  })).enabled);

  // Ranking mode must be spelled exactly to enforce.
  const on = { [POOL_RANKING_FLAG]: "true", [POOL_RANKING_WORKSPACES_ENV]: WS };
  assertEquals(isPoolRankingEnabled(WS, env(on)).mode, "shadow");
  assertEquals(
    isPoolRankingEnabled(WS, env({ ...on, [POOL_RANKING_MODE_ENV]: "ENFORCED" })).mode,
    "shadow", "a misspelled mode must not enforce");
  assertEquals(
    isPoolRankingEnabled(WS, env({ ...on, [POOL_RANKING_MODE_ENV]: "enforce" })).mode,
    "enforce");
});

Deno.test("45. nothing in this stage can reach a person", () => {
  const ranking = validatePoolRanking({ raw: null, summaries: POOL, requestedCount: 25 });
  const d = applyPortfolioPolicy({
    ranking, summaries: POOL, requestedCount: 25, eligibleCount: 10, unevaluatedCount: 0,
  });
  const text = JSON.stringify(d);
  for (const actor of [
    "apify_linkedin_company_employees", "apify_people_search",
    "apify_linkedin_profile_search", "linkedin.com/in/",
  ]) {
    assertFalse(text.includes(actor));
  }
  // The recommended action is an OFFER, never an execution.
  for (const x of d.delivered) {
    assert(["offer_founder_unlock", "review", "watch"].includes(x.recommended_action));
  }
});

Deno.test("S1. the compact summary carries validated claims only", () => {
  const reg = registryFor("acme");
  const d = reg.items.find((x) => x.evidence_type === "company_description")!.evidence_id;
  const s = buildCandidateSummary({
    company_key: "acme", company_name: "Acme", brain_outcome: "QUALIFIED", tier: "A",
    grounded: {
      version: "grounded-claims-v1",
      classifier_result: {
        business_model: { value: "b2b_software", confidence: 0.9, claims: [] },
        company_fit: "pass", agentory_use_case: "strong",
        mission_signal_assessment: {
          strongest_signal: "x", signal_strength: "strong", evidence_ids: [], reason: "",
        },
        supporting_claims: [], conflicting_evidence_ids: [],
        missing_evidence: ["employee_count"], unknown_fields: [],
        confidence: 0.9, reason: "",
      },
      validated_claims: [{
        claim: "Acme sells electronic-design software.", claim_type: "business_model",
        evidence_ids: [d], evidence_excerpts: [],
      }],
      rejected_claims: [{
        claim: "Acme sells API subscriptions.", claim_type: "business_model",
        reason: "excerpt_not_found", detail: "x",
      }],
      grounding_score: 0.5, final_grounded_decision: "review",
      downgrade_reasons: [], unacknowledged_conflicts: [],
    } as never,
  });
  const text = JSON.stringify(s);
  assertFalse(text.includes("API subscriptions"),
    "a rejected claim must never reach the ranker");
  assert(text.includes("electronic-design software"));
  assertEquals(s.confidence_after_grounding, 0.45);
  assertEquals(s.missing_evidence, ["employee_count"]);
});
