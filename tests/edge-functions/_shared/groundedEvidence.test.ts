// A CLAIM MUST POINT AT SOMETHING, AND CODE GOES AND LOOKS.
//
// The regression suite for evidence grounding. Its job is to prove that the
// system can no longer be CONFIDENTLY WRONG: a classifier statement that cites
// nothing, cites something that does not exist, cites another company, quotes
// text that is not there, or restates a hard fact differently, is removed from
// the decision and from the Workbench — without failing the company or the run.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEvidenceRegistry, evidenceId, findEvidence, freshnessOf,
  type EvidenceRegistry,
} from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import {
  buildGroundedClassifierPayload, buildWorkbenchExplanation, excerptIsPresent,
  parseGroundedResult, verifyGroundedResult, GROUNDED_CLASSIFIER_PROMPT,
  type GroundedClaim, type GroundedClassifierResult,
} from "../../../supabase/functions/_shared/groundedClaims.ts";
import {
  buildCompanyEvidence,
} from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import {
  decideCompanyBrain,
} from "../../../supabase/functions/_shared/companyBrainSemanticFit.ts";
import { normalizeLinkedInJob } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";

// ───────────────────────────────────────────────────────────── fixtures ──

const DESCRIPTION =
  "SnapMagic sells electronic-design software to engineering teams on a subscription.";
const NOW = Date.parse("2026-08-06T00:00:00Z");

function company(over: Record<string, unknown> = {}) {
  return {
    external_source_id: "snapmagic", company_name: "SnapMagic",
    canonical_domain: "snapmagic.com",
    linkedin_company_url: "https://www.linkedin.com/company/snapmagic",
    website: "https://snapmagic.com", description: DESCRIPTION,
    provider_industry: "Software Development",
    industry_ids: [{ id: "4", name: "Software Development", hierarchy: "Tech" }],
    employee_count: 75, employee_range_advisory: null,
    geography: "United States", company_type: null, startup_evidence: null,
    hiring_status: true, source_provenance: "harvestapi/linkedin-company",
    field_trust: {}, missing_fields: [],
    raw_ref: { actor_key: "apify_linkedin_company_details", source_id: "snapmagic" },
    ...over,
  } as never;
}

const HEAD_OF_SALES = normalizeLinkedInJob({
  id: "j1", title: "Head of Sales", linkedinUrl: "https://x/j1",
  postedDate: "2026-08-01",
  company: { id: 1, name: "SnapMagic",
    linkedinUrl: "https://www.linkedin.com/company/snapmagic" },
});
const OLD_ENGINEER = normalizeLinkedInJob({
  id: "j2", title: "Senior Software Engineer", linkedinUrl: "https://x/j2",
  postedDate: "2024-01-01",
  company: { id: 1, name: "SnapMagic",
    linkedinUrl: "https://www.linkedin.com/company/snapmagic" },
});
const UNDATED = normalizeLinkedInJob({
  id: "j3", title: "Account Executive", linkedinUrl: "https://x/j3",
  company: { id: 1, name: "SnapMagic",
    linkedinUrl: "https://www.linkedin.com/company/snapmagic" },
});

function registry(over: Parameters<typeof buildEvidenceRegistry>[0] | null = null): EvidenceRegistry {
  const evidence = buildCompanyEvidence({
    company_key: "snapmagic", source_capability: "startup_company_discovery",
    company: company(), identity_state: "resolved",
    linkedin_company_url: "https://www.linkedin.com/company/snapmagic",
  });
  return buildEvidenceRegistry({
    evidence, jobs: [HEAD_OF_SALES], now: NOW, ...(over ?? {}),
  });
}

const R = registry();
const descId = R.items.find((x) => x.evidence_type === "company_description")!.evidence_id;
const jobId = R.items.find((x) => x.evidence_type === "job_posting")!.evidence_id;
const industryId = R.items.find((x) => x.evidence_type === "company_industry")!.evidence_id;
const empId = R.items.find((x) => x.evidence_type === "employee_count")!.evidence_id;

function claim(over: Partial<GroundedClaim> = {}): GroundedClaim {
  return {
    claim: "SnapMagic sells electronic-design software to engineering teams.",
    claim_type: "business_model",
    evidence_ids: [descId],
    evidence_excerpts: [{ evidence_id: descId, excerpt: "electronic-design software" }],
    ...over,
  };
}

function result(over: Partial<GroundedClassifierResult> = {}): GroundedClassifierResult {
  return {
    business_model: { value: "b2b_software", confidence: 0.9, claims: [claim()] },
    company_fit: "pass",
    agentory_use_case: "strong",
    mission_signal_assessment: {
      strongest_signal: "Head of Sales", signal_strength: "strong",
      evidence_ids: [jobId], reason: "current commercial opening",
    },
    supporting_claims: [claim({
      claim: "Hiring Head of Sales.", claim_type: "commercial_signal",
      evidence_ids: [jobId],
      evidence_excerpts: [{ evidence_id: jobId, excerpt: "Head of Sales" }],
    })],
    conflicting_evidence_ids: [],
    missing_evidence: [],
    unknown_fields: [],
    confidence: 0.9,
    reason: "B2B design software with a current commercial opening",
    ...over,
  };
}

const verify = (r: GroundedClassifierResult, reg = R, requiresSignal = false) =>
  verifyGroundedResult({ registry: reg, result: r, requiresCommercialSignal: requiresSignal });

// ══════════════════════════════════════════════ 1-5. evidence registry ══

Deno.test("1. evidence ids are stable and deterministic", () => {
  const a = registry(), b = registry();
  assertEquals(a.items.map((x) => x.evidence_id), b.items.map((x) => x.evidence_id));
  assertEquals(
    evidenceId("snapmagic", "company_description", "linkedin", DESCRIPTION),
    evidenceId("snapmagic", "company_description", "linkedin", DESCRIPTION));
});

Deno.test("2. evidence belongs to exactly one company", () => {
  // The COMPANY is part of the hash, so identical text under two companies
  // yields two different ids — which is what makes a cross-company citation
  // detectable rather than a coincidence.
  assert(evidenceId("snapmagic", "company_description", "linkedin", DESCRIPTION) !==
    evidenceId("otherco", "company_description", "linkedin", DESCRIPTION));
  for (const item of R.items) assertEquals(item.company_key, "snapmagic");
});

Deno.test("3. a provider failure is not a negative company fact", () => {
  const withFailure = registry({
    evidence: buildCompanyEvidence({
      company_key: "snapmagic", source_capability: "startup_company_discovery",
      company: company(), identity_state: "resolved",
    }),
    jobs: [], now: NOW,
    provider_failures: [{
      provider: "apify_linkedin_job_search", capability: "hiring_verification",
      reason: "actor run failed",
    }],
  });
  const f = withFailure.items.find((x) => x.evidence_type === "provider_failure")!;
  assertEquals(f.verification_state, "invalid");
  assertEquals(f.metadata.supports_negative_claim, false);
  assert(withFailure.hard_facts.provider_failed);
  // And it is NOT recorded as "no jobs found".
  assertEquals(withFailure.hard_facts.job_titles, []);
});

Deno.test("4. conflicting employee evidence stays explicit", () => {
  const conflicted = registry({
    evidence: buildCompanyEvidence({
      company_key: "snapmagic", source_capability: "startup_company_discovery",
      company: company({ employee_count: 20 }),
      enriched: company({ employee_count: 75 }),
      identity_state: "resolved",
    }),
    jobs: [], now: NOW,
    employee_count_alternatives: [{ source: "yc", value: 20 }],
  });
  const emp = conflicted.items.filter((x) => x.evidence_type === "employee_count");
  assert(emp.length >= 2, "both readings are kept");
  assert(emp.some((x) => x.verification_state === "conflicting"),
    "the disagreement is marked, not reconciled");
});

Deno.test("5. original source text is preserved verbatim", () => {
  const d = findEvidence(R, descId)!;
  assertEquals(d.source_text, DESCRIPTION, "provider words are never rewritten");
  assertEquals(d.structured_value, null);
  const e = findEvidence(R, empId)!;
  assertEquals(e.structured_value, 75, "a typed fact stays typed");
});

// ═══════════════════════════════════════════════ 6-18. claim verification ══

Deno.test("6. a valid evidence id with an exact excerpt passes", () => {
  const v = verify(result());
  assertEquals(v.rejected_claims, []);
  assertEquals(v.validated_claims.length, 2);
  assertEquals(v.grounding_score, 1);
  assertEquals(v.final_grounded_decision, "pass");
});

Deno.test("7. an unknown evidence id fails", () => {
  const v = verify(result({
    business_model: { value: "b2b_saas", confidence: 0.9, claims: [claim({
      evidence_ids: ["company_description:linkedin:deadbeef"],
      evidence_excerpts: [],
    })] },
  }));
  assert(v.rejected_claims.some((r) => r.reason === "unknown_evidence_id"));
});

Deno.test("8. another company's evidence fails", () => {
  const foreign = evidenceId("otherco", "company_description", "linkedin", DESCRIPTION);
  const v = verify(result({
    business_model: { value: "b2b_saas", confidence: 0.9, claims: [claim({
      evidence_ids: [foreign], evidence_excerpts: [],
    })] },
  }));
  // It is not in THIS registry, so it cannot be cited at all.
  assert(v.rejected_claims.some((r) =>
    r.reason === "unknown_evidence_id" || r.reason === "wrong_company"));
});

Deno.test("9. an invented excerpt fails", () => {
  const v = verify(result({
    business_model: { value: "b2b_saas", confidence: 0.95, claims: [claim({
      claim: "SnapMagic sells B2B API subscriptions.",
      evidence_excerpts: [{ evidence_id: descId, excerpt: "API subscriptions" }],
    })] },
  }));
  const r = v.rejected_claims.find((x) => x.reason === "excerpt_not_found");
  assert(r, "text that is not in the source must be refused");
  assert(r!.detail.includes("API subscriptions"));
  // Whitespace and case are forgiven; content is not.
  assert(excerptIsPresent("ELECTRONIC-DESIGN   software", DESCRIPTION));
  assertFalse(excerptIsPresent("API subscriptions", DESCRIPTION));
});

Deno.test("10. an unsupported evidence type fails", () => {
  // A job posting cannot establish a business model.
  const v = verify(result({
    business_model: { value: "b2b_saas", confidence: 0.9, claims: [claim({
      evidence_ids: [jobId],
      evidence_excerpts: [{ evidence_id: jobId, excerpt: "Head of Sales" }],
    })] },
  }));
  assert(v.rejected_claims.some((r) => r.reason === "unsupported_evidence_type"));
});

Deno.test("11. a hard employee mismatch fails", () => {
  const v = verify(result({
    supporting_claims: [claim({
      claim: "SnapMagic has 23 employees.", claim_type: "company_fit",
      evidence_ids: [empId], evidence_excerpts: [],
    })],
  }));
  const r = v.rejected_claims.find((x) => x.reason === "hard_fact_mismatch");
  assert(r, "the model may cite a count; it may not restate it");
  assert(r!.detail.includes("75"));
});

Deno.test("12. a hard geography mismatch fails", () => {
  const v = verify(result({
    supporting_claims: [claim({
      claim: "SnapMagic is headquartered in Germany.", claim_type: "company_fit",
      evidence_ids: [descId],
      evidence_excerpts: [{ evidence_id: descId, excerpt: "SnapMagic sells" }],
    })],
  }));
  assert(v.rejected_claims.some((r) => r.reason === "hard_fact_mismatch"));
});

Deno.test("13. an invented job title fails", () => {
  const v = verify(result({
    supporting_claims: [claim({
      claim: "Hiring VP of Marketing.", claim_type: "commercial_signal",
      evidence_ids: [jobId],
      evidence_excerpts: [{ evidence_id: jobId, excerpt: "Head of Sales" }],
    })],
  }));
  const r = v.rejected_claims.find((x) => x.reason === "hard_fact_mismatch");
  assert(r, "a quoted role must be one that was actually posted");
  assert(r!.detail.includes("Head of Sales"));
});

Deno.test("14. a stale job cannot be called current", () => {
  const staleReg = registry({
    evidence: buildCompanyEvidence({
      company_key: "snapmagic", source_capability: "startup_company_discovery",
      company: company(), identity_state: "resolved",
    }),
    jobs: [OLD_ENGINEER], now: NOW,
  });
  const staleJob = staleReg.items.find((x) => x.evidence_type === "job_posting")!;
  assertEquals(staleJob.freshness, "stale");
  const v = verifyGroundedResult({
    registry: staleReg,
    result: result({
      supporting_claims: [claim({
        claim: "Currently hiring Senior Software Engineer.", claim_type: "commercial_signal",
        evidence_ids: [staleJob.evidence_id],
        evidence_excerpts: [{ evidence_id: staleJob.evidence_id, excerpt: "Senior Software Engineer" }],
      })],
    }),
  });
  assert(v.rejected_claims.some((r) => r.reason === "hard_fact_mismatch"),
    "a 2024 posting is not a current signal");
});

Deno.test("15. a missing posting date stays unknown, never current", () => {
  const undatedReg = registry({
    evidence: buildCompanyEvidence({
      company_key: "snapmagic", source_capability: "startup_company_discovery",
      company: company(), identity_state: "resolved",
    }),
    jobs: [UNDATED], now: NOW,
  });
  const j = undatedReg.items.find((x) => x.evidence_type === "job_posting")!;
  assertEquals(j.freshness, "unknown");
  assertEquals(freshnessOf(null), "unknown");
  const v = verifyGroundedResult({
    registry: undatedReg,
    result: result({
      supporting_claims: [claim({
        claim: "Actively hiring Account Executive now.", claim_type: "commercial_signal",
        evidence_ids: [j.evidence_id],
        evidence_excerpts: [{ evidence_id: j.evidence_id, excerpt: "Account Executive" }],
      })],
    }),
  });
  assert(v.rejected_claims.some((r) => r.reason === "hard_fact_mismatch"),
    "undated is not current");
});

Deno.test("16. a generic industry label alone cannot prove B2B SaaS", () => {
  const v = verify(result({
    business_model: { value: "b2b_saas", confidence: 0.9, claims: [claim({
      claim: "SnapMagic is a B2B SaaS company.",
      evidence_ids: [industryId],
      evidence_excerpts: [{ evidence_id: industryId, excerpt: "Software Development" }],
    })] },
  }));
  const r = v.rejected_claims.find((x) => x.reason === "unsupported_evidence_type");
  assert(r, "'LinkedIn says Software' has never established a business model");
  assert(r!.detail.includes("contextual"));
});

Deno.test("17. a company description CAN support a business-model inference", () => {
  const v = verify(result());
  const bm = v.validated_claims.find((c) => c.claim_type === "business_model");
  assert(bm, "the model may still interpret what a company says about itself");
  assertEquals(bm!.evidence_ids, [descId]);
});

Deno.test("18. a provider failure cannot support 'the company is not hiring'", () => {
  const failReg = registry({
    evidence: buildCompanyEvidence({
      company_key: "snapmagic", source_capability: "startup_company_discovery",
      company: company(), identity_state: "resolved",
    }),
    jobs: [], now: NOW,
    provider_failures: [{
      provider: "apify_linkedin_job_search", capability: "hiring_verification",
      reason: "actor run failed",
    }],
  });
  const fid = failReg.items.find((x) => x.evidence_type === "provider_failure")!.evidence_id;
  const v = verifyGroundedResult({
    registry: failReg,
    result: result({
      company_fit: "fail",
      supporting_claims: [claim({
        claim: "The company is not hiring.", claim_type: "commercial_signal",
        evidence_ids: [fid],
        evidence_excerpts: [{ evidence_id: fid, excerpt: "actor run failed" }],
      })],
      business_model: { value: "unknown", confidence: 0.2, claims: [] },
    }),
  });
  const r = v.rejected_claims.find((x) => x.reason === "invalid_evidence_state");
  assert(r, "a failure is why we do not know, not evidence that the answer is no");
  assert(r!.detail.includes("provider failure"));
  // …and the unsupported FAIL does not stand either.
  assertEquals(v.final_grounded_decision, "review");
});

// ═══════════════════════════════════════════════ 19-25. decision handling ══

Deno.test("19. a fully grounded pass can become QUALIFIED", () => {
  const v = verify(result());
  const d = decideCompanyBrain({
    gates: {
      identity_status: "verified_match", active: true,
      geography: "United States", required_geography: null,
      employee_count: 75, employee_ceiling: 150, commercial_tier: "A",
    } as never,
    semantic: {
      business_model: "b2b_software", company_fit: "pass", confidence: 0.9,
      agentory_use_case: "strong", supporting_evidence: ["desc"],
      conflicting_evidence: [], unknown_fields: [], reason: "fits",
    },
    policy: { mission_verticals: [], geography: null,
      workspace_context_applied: [], workspace_categories_ignored: [] } as never,
    hiring_verified: true,
    grounding: {
      final_grounded_decision: v.final_grounded_decision,
      grounding_score: v.grounding_score,
      validated_claim_types: v.validated_claims.map((c) => c.claim_type),
      downgrade_reasons: v.downgrade_reasons,
    },
  });
  assertEquals(d.outcome, "QUALIFIED");
  assert(d.reason.includes("grounding"), "the decision states its grounding");
});

Deno.test("20. a pass with no valid supporting claims becomes REVIEW", () => {
  const v = verify(result({
    business_model: { value: "b2b_saas", confidence: 0.95, claims: [claim({
      evidence_ids: ["nope:nope:nope"], evidence_excerpts: [],
    })] },
    supporting_claims: [],
  }));
  assertEquals(v.validated_claims.length, 0);
  assertEquals(v.grounding_score, 0);
  assertEquals(v.final_grounded_decision, "review");
  assert(v.downgrade_reasons.includes("pass_without_any_validated_claim"));
});

Deno.test("21. invalid claims are removed from the Workbench output", () => {
  const v = verify(result({
    supporting_claims: [
      claim({
        claim: "Hiring Head of Sales.", claim_type: "commercial_signal",
        evidence_ids: [jobId],
        evidence_excerpts: [{ evidence_id: jobId, excerpt: "Head of Sales" }],
      }),
      claim({
        claim: "SnapMagic sells B2B API subscriptions.", claim_type: "business_model",
        evidence_excerpts: [{ evidence_id: descId, excerpt: "API subscriptions" }],
      }),
    ],
  }));
  const ui = buildWorkbenchExplanation(v, R);
  const shown = JSON.stringify(ui);
  assertFalse(shown.includes("API subscriptions"),
    "an invented claim must never reach the user");
  assert(shown.includes("Head of Sales"), "a grounded claim does");
  // The rejection is still visible internally.
  assert(v.rejected_claims.some((r) => r.claim.includes("API subscriptions")));
});

Deno.test("22. conflicting material evidence prevents confident qualification", () => {
  const conflicted = registry({
    evidence: buildCompanyEvidence({
      company_key: "snapmagic", source_capability: "startup_company_discovery",
      company: company({ employee_count: 20 }),
      enriched: company({ employee_count: 75 }),
      identity_state: "resolved",
    }),
    jobs: [HEAD_OF_SALES], now: NOW,
    employee_count_alternatives: [{ source: "yc", value: 20 }],
  });
  const cDesc = conflicted.items.find((x) => x.evidence_type === "company_description")!;
  const cJob = conflicted.items.find((x) => x.evidence_type === "job_posting")!;
  const v = verifyGroundedResult({
    registry: conflicted,
    result: result({
      business_model: { value: "b2b_software", confidence: 0.9, claims: [claim({
        evidence_ids: [cDesc.evidence_id],
        evidence_excerpts: [{ evidence_id: cDesc.evidence_id, excerpt: "electronic-design software" }],
      })] },
      supporting_claims: [claim({
        claim: "Hiring Head of Sales.", claim_type: "commercial_signal",
        evidence_ids: [cJob.evidence_id],
        evidence_excerpts: [{ evidence_id: cJob.evidence_id, excerpt: "Head of Sales" }],
      })],
      conflicting_evidence_ids: [],
    }),
  });
  assertEquals(v.final_grounded_decision, "review",
    "an unacknowledged size conflict cannot leave a confident pass");
  assert(v.unacknowledged_conflicts.length > 0);
  const ui = buildWorkbenchExplanation(v, conflicted);
  assert(ui.uncertainty.some((u) => /employee count|differs/i.test(u)),
    "the user is told what is uncertain");
});

Deno.test("23. missing evidence does not become REJECT", () => {
  const bare = buildEvidenceRegistry({
    evidence: buildCompanyEvidence({
      company_key: "snapmagic", source_capability: "general_company_discovery",
      company: company({ description: null, employee_count: null, geography: null }),
    }),
    jobs: [], now: NOW,
  });
  const v = verifyGroundedResult({
    registry: bare,
    result: result({
      business_model: { value: "unknown", confidence: 0.2, claims: [] },
      supporting_claims: [], company_fit: "review",
      missing_evidence: ["company_description", "employee_count"],
    }),
  });
  assertEquals(v.final_grounded_decision, "review");
  assertFalse(v.final_grounded_decision === "fail",
    "an absence of evidence is never a verified negative");
});

Deno.test("24. a required hiring signal needs grounded hiring evidence", () => {
  // Business model grounded, but nothing grounds a current opening.
  const v = verifyGroundedResult({
    registry: R,
    result: result({ supporting_claims: [] }),
    requiresCommercialSignal: true,
  });
  assertEquals(v.final_grounded_decision, "review");
  assert(v.downgrade_reasons.some((d) => /current_signal/.test(d)));

  // With the grounded job claim present, the same mission passes.
  const ok = verifyGroundedResult({
    registry: R, result: result(), requiresCommercialSignal: true,
  });
  assertEquals(ok.final_grounded_decision, "pass");
});

Deno.test("25. an explicit hard mismatch can still REJECT", () => {
  const v = verify(result({
    company_fit: "fail",
    business_model: { value: "consumer", confidence: 0.9, claims: [claim({
      claim: "SnapMagic sells electronic-design software to engineering teams.",
      claim_type: "business_model",
    })] },
    supporting_claims: [],
    reason: "consumer product; the mission requires B2B",
  }));
  // The fail survives because its claim is grounded.
  assertEquals(v.final_grounded_decision, "fail");
  const d = decideCompanyBrain({
    gates: {
      identity_status: "verified_match", active: true,
      geography: "United States", required_geography: null,
      employee_count: 75, employee_ceiling: 150, commercial_tier: "A",
    } as never,
    semantic: {
      business_model: "consumer", company_fit: "fail", confidence: 0.9,
      agentory_use_case: "none", supporting_evidence: ["desc"],
      conflicting_evidence: [], unknown_fields: [], reason: "consumer",
    },
    policy: { mission_verticals: [], geography: null,
      workspace_context_applied: [], workspace_categories_ignored: [] } as never,
    hiring_verified: true,
    grounding: {
      final_grounded_decision: v.final_grounded_decision,
      grounding_score: v.grounding_score,
      validated_claim_types: v.validated_claims.map((c) => c.claim_type),
      downgrade_reasons: v.downgrade_reasons,
    },
  });
  assertEquals(d.outcome, "REJECT");
});

// ═══════════════════════════════════════ 26-28. security and containment ══

Deno.test("26-27. the classifier cannot reference credentials or schedule Actors", () => {
  const payload = JSON.stringify(buildGroundedClassifierPayload({
    registry: R, originalUserQuery: "Find B2B SaaS founders",
  }));
  for (const leak of [
    "service_role", "apikey", "api_key", "authorization", "bearer",
    "memo23", "harvestapi", "solidcode", "crawlworks", "apify_",
  ]) {
    assertFalse(payload.toLowerCase().includes(leak.toLowerCase()),
      `the classifier payload must not contain ${leak}`);
  }
  // And it is told, explicitly, that routing and unlocks are not its business.
  assert(GROUNDED_CLASSIFIER_PROMPT.includes("never name one"));
  assert(GROUNDED_CLASSIFIER_PROMPT.includes("contact details are unlocked"));
  assert(GROUNDED_CLASSIFIER_PROMPT.includes("Do not explain your reasoning process"),
    "no chain-of-thought is requested");
});

Deno.test("28. a grounded verdict cannot schedule people work", () => {
  const v = verify(result());
  const ui = JSON.stringify(buildWorkbenchExplanation(v, R));
  for (const actor of [
    "apify_linkedin_company_employees", "apify_people_search",
    "apify_linkedin_profile_search",
  ]) {
    assertFalse(ui.includes(actor));
  }
});

// ══════════════════════════════════════════════════ parser robustness ══

Deno.test("P1. a malformed classifier answer is REVIEW, never a pass", () => {
  for (const bad of [null, undefined, "", "not json", 42, [], {}]) {
    const parsed = parseGroundedResult(bad);
    assertEquals(parsed.company_fit, "review", `${JSON.stringify(bad)} must be review`);
    assertEquals(parsed.business_model.value, "unknown");
    const v = verify(parsed);
    assertFalse(v.final_grounded_decision === "pass");
  }
});
