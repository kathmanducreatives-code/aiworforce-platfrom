// GPT IS THE FINAL SEMANTIC AUTHORITY — AND THE BRAIN USED TO OUTRANK IT.
//
// ── THE DEFECT, EXACTLY ──────────────────────────────────────────────────────
//
// `decideCompanyBrain` opened with:
//
//     const failed = failedHardGates({ ...i.gates, semantic: i.semantic });
//     if (failed.length > 0) return { outcome: "REJECT", ... };
//
// and only THEN read `s.mission_fit`. So the Mission evaluator's verdict was
// consulted solely for companies no deterministic gate had already disposed of.
// The Company Brain — whose documented job is to ASSEMBLE evidence for the
// evaluator — was quietly the final authority over it, which is the precise
// inversion the evaluator was built to end.
//
// Two of those gates were semantic judgements wearing a deterministic costume:
//
//   unsupported_geography             `geography.includes(required_geography)`.
//                                     "San Francisco, CA, USA" does not contain
//                                     "united states", so the check rejected the
//                                     very companies it existed to keep. The
//                                     engine had already noticed this and
//                                     excluded geography from its OWN
//                                     pre-evaluator list — and the gate survived
//                                     inside the Brain, where it still fired.
//   employee_count_far_above_ceiling  against `?? 200`, a ceiling the Mission
//                                     never stated. With CEILING_TOLERANCE at
//                                     1.0 that rejected every verified count
//                                     above 400 on a Mission that said nothing
//                                     about size.
//
// ── WHAT REPLACES IT ─────────────────────────────────────────────────────────
//
// After a Mission verdict exists, only two kinds of fact may still speak:
//
//   INTEGRITY        the evidence may not describe this company at all
//                    (`identity_mismatch`) ⇒ REVIEW, never REJECT. Nothing was
//                    learned about the company, so nothing may be claimed.
//   MISSION-STATED   a verified fact the USER's own constraint makes
//                    disqualifying ⇒ REJECT, naming the gate and the authority.
//
// Everything else stays COMPUTED and REPORTED on `failed_hard_gates` — the Brain
// still shows its work — and carries no veto.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyMissionPrecedence, decideCompanyBrain, failedHardGates,
  gatesThatOutrankTheMission, groundingRefutes, CEILING_TOLERANCE,
  type HardGate, type HardGateInput,
} from "../../../supabase/functions/_shared/companyBrainSemanticFit.ts";
import {
  assessHiring, reachesCompanyBrain, needsPaidJobVerification,
} from "../../../supabase/functions/_shared/commercialSignalPolicy.ts";

const POLICY = applyMissionPrecedence({
  original_user_query: "Find AI startups in the United States hiring engineers",
  mission_verticals: ["ai"], mission_geography: null, workspace_industries: [],
});

/** A clean gate input: nothing wrong with this company. */
const gates = (over: Partial<HardGateInput> = {}): HardGateInput => ({
  identity_status: "verified_match",
  active: true,
  geography: "San Francisco, CA, USA",
  required_geography: null,
  employee_count: 120,
  employee_ceiling: null,
  commercial_tier: "A",
  mission_owns_hiring_role: true,
  semantic: null,
  ...over,
});

/** A Mission verdict, as the evaluator produces it. */
const missionVerdict = (
  fit: "pass" | "review" | "fail", over: Record<string, unknown> = {},
) => ({
  mission_fit: fit,
  icp_fit: "strong",
  match_score: 90,
  business_model: "unknown",
  company_fit: fit,
  confidence: 0.9,
  agentory_use_case: "strong",
  supporting_evidence: ["4 open software engineering roles"],
  conflicting_evidence: [],
  unknown_fields: [],
  reason: "AI startup in the US hiring engineers — satisfies the mission",
  ...over,
} as never);

// ═══════════════════ 1. the two gates that used to overrule the evaluator ══

Deno.test("1. GEOGRAPHY never overturns a mission pass — the substring check is gone",
  () => {
    // THE EXACT SHAPE OF THE BUG: a US company in a US mission, rejected because
    // "San Francisco, CA, USA" does not literally contain "united states".
    const d = decideCompanyBrain({
      gates: gates({ required_geography: "united states" }),
      semantic: missionVerdict("pass"),
      policy: POLICY, hiring_verified: true, grounding: null,
    });
    assertEquals(d.outcome, "QUALIFIED",
      "a location the evaluator read correctly may not be re-judged by substring");
    // AND THE GATE IS STILL COMPUTED AND REPORTED — the Brain shows its work.
    assert(d.failed_hard_gates.includes("unsupported_geography"),
      "the gate still fires and is still visible; it simply no longer decides");
    assert(d.reason.includes("advisory, not disqualifying"),
      "and the decision says so out loud");
  });

Deno.test("1b. an UNSTATED size ceiling cannot reject what the evaluator passed", () => {
  // `employee_ceiling: null` is what the engine now passes when the Mission set
  // no range. Previously it passed `?? 200`, so this company was rejected on a
  // bound nobody expressed.
  const d = decideCompanyBrain({
    gates: gates({ employee_count: 5000, employee_ceiling: null }),
    semantic: missionVerdict("pass"),
    policy: POLICY, hiring_verified: true, grounding: null,
  });
  assertEquals(d.outcome, "QUALIFIED");
  assertFalse(d.failed_hard_gates.includes("employee_count_far_above_ceiling"),
    "with no stated ceiling there is no gate to fail");
});

Deno.test("1c. a MISSION-STATED size ceiling still rejects — and names its authority",
  () => {
    // THE OTHER SIDE OF THE BOUNDARY. The user asked for ≤150; this company
    // verifiably has 5000. That is a falsifiable fact about a constraint the
    // user expressed, so it survives the evaluator.
    const d = decideCompanyBrain({
      gates: gates({ employee_count: 5000, employee_ceiling: 150 }),
      semantic: missionVerdict("pass"),
      policy: POLICY, hiring_verified: true, grounding: null,
    });
    assertEquals(d.outcome, "REJECT");
    assert(d.reason.includes("mission-stated constraint failed"),
      `the rejection must name its authority, got: ${d.reason}`);
    assert(d.reason.includes("employee_count_far_above_ceiling"));
  });

Deno.test("1d. the ceiling still has its tolerance — a borderline count is not rejected",
  () => {
    // CEILING_TOLERANCE exists because the audited YC self-reports were off by
    // up to 23x. A stated max of 150 rejects at 300+, not at 151.
    assertEquals(CEILING_TOLERANCE, 1.0);
    const borderline = decideCompanyBrain({
      gates: gates({ employee_count: 220, employee_ceiling: 150 }),
      semantic: missionVerdict("pass"),
      policy: POLICY, hiring_verified: true, grounding: null,
    });
    assertEquals(borderline.outcome, "QUALIFIED",
      "220 against a stated 150 is inside tolerance — this is the AfterQuery case");
  });

// ══════════════════════════════ 2. integrity is a HOLD, never a rejection ══

Deno.test("2. a MISMATCHED identity voids the verdict — REVIEW, not REJECT", () => {
  // The evidence describes a different company, so the evaluator answered about
  // something else. Telling the user their prospect was REJECTED would be a
  // claim about a company nobody actually looked at.
  const d = decideCompanyBrain({
    gates: gates({ identity_status: "rejected_mismatch" }),
    semantic: missionVerdict("pass"),
    policy: POLICY, hiring_verified: true, grounding: null,
  });
  assertEquals(d.outcome, "REVIEW");
  assertFalse(d.outcome === "REJECT",
    "resolving the wrong LinkedIn page is not a fact about this company");
  assert(d.reason.includes("may not describe this company"), d.reason);
});

Deno.test("2b. integrity outranks a mission-stated gate — the weaker claim wins", () => {
  // Both fire. If we cannot trust that the evidence is about this company, we
  // cannot trust the headcount we read from it either, so the honest answer is
  // the one that claims less.
  const d = decideCompanyBrain({
    gates: gates({
      identity_status: "rejected_mismatch",
      employee_count: 5000, employee_ceiling: 150,
    }),
    semantic: missionVerdict("pass"),
    policy: POLICY, hiring_verified: true, grounding: null,
  });
  assertEquals(d.outcome, "REVIEW",
    "an unverifiable fact may not be used to reject");
});

// ══════════════════════════ 3. the evaluator's own verdicts are honoured ══

Deno.test("3. mission_fit fail/review/pass map straight through", () => {
  const at = (fit: "pass" | "review" | "fail") => decideCompanyBrain({
    gates: gates(), semantic: missionVerdict(fit),
    policy: POLICY, hiring_verified: true, grounding: null,
  }).outcome;
  assertEquals(at("pass"), "QUALIFIED");
  assertEquals(at("review"), "REVIEW");
  // A `fail` IS a rejection: the evaluator found evidence against a stated
  // requirement. That is the one rejection this architecture actively wants.
  assertEquals(at("fail"), "REJECT");
});

Deno.test("3b. an ICP PREFERENCE never decides — it only ranks", () => {
  // `icp_fit` is the workspace's taste. A company that satisfies the USER is
  // not disqualified for being an imperfect fit for Agentory's own buyer.
  for (const icp of ["strong", "plausible", "weak"] as const) {
    const d = decideCompanyBrain({
      gates: gates(),
      semantic: missionVerdict("pass", { icp_fit: icp, agentory_use_case: icp }),
      policy: POLICY, hiring_verified: true, grounding: null,
    });
    assertEquals(d.outcome, "QUALIFIED", `icp_fit=${icp} must not change the outcome`);
  }
});

Deno.test("3c. grounding may DOWNGRADE a pass but never rescue a fail", () => {
  // A Mission pass whose cited evidence did not survive verification is REVIEW,
  // never a silent qualify — the model must not invent its receipts.
  //
  // THE COUNTS ARE PART OF THE FIXTURE. A score of 0.33 means one claim of
  // three survived and TWO WERE REFUTED; stating the score without the counts
  // described a verifier that can score without checking anything, and that
  // fiction is what let "I validated nothing" be read as "I found something".
  const downgraded = decideCompanyBrain({
    gates: gates(), semantic: missionVerdict("pass"),
    policy: POLICY, hiring_verified: true,
    grounding: {
      final_grounded_decision: "review", grounding_score: 0.33,
      validated_claim_types: [], downgrade_reasons: ["grounding_score_0.33_below_0.6"],
      validated_claims: 1, rejected_claims: 2, unacknowledged_conflicts: 0,
    },
  });
  assertEquals(downgraded.outcome, "REVIEW");
  assert(downgraded.reason.includes("grounding_score_0.33_below_0.6"),
    "and the downgrade names what to go and check");

  const stillRejected = decideCompanyBrain({
    gates: gates(), semantic: missionVerdict("fail"),
    policy: POLICY, hiring_verified: true,
    grounding: {
      final_grounded_decision: "pass", grounding_score: 1,
      validated_claim_types: ["hiring"], downgrade_reasons: [],
    },
  });
  assertEquals(stillRejected.outcome, "REJECT", "grounding cannot overturn a fail");
});

// ═══════════════════════════════ 4. the boundary itself, as a partition ══

Deno.test("4. every gate is classified, and only two may outrank the mission", () => {
  const ALL: HardGate[] = [
    "identity_mismatch", "inactive_company", "unsupported_geography",
    "employee_count_far_above_ceiling", "consumer_only", "no_commercial_signal",
    "no_agentory_use_case",
  ];
  const split = gatesThatOutrankTheMission(ALL);
  // A PARTITION — nothing is dropped and nothing is double-counted, so a gate
  // added later cannot silently acquire or lose a veto.
  assertEquals(
    [...split.integrity, ...split.mission_stated, ...split.context_only].sort(),
    [...ALL].sort());
  assertEquals(split.integrity, ["identity_mismatch"]);
  assertEquals(split.mission_stated.sort(),
    ["employee_count_far_above_ceiling", "inactive_company"]);
  // THE FOUR THAT LOST THEIR VETO, named. Each is either a question about
  // Agentory's own buyer or a judgement the evaluator is better placed to make.
  assertEquals(split.context_only.sort(), [
    "consumer_only", "no_agentory_use_case", "no_commercial_signal",
    "unsupported_geography",
  ]);
});

Deno.test("4b. with NO mission verdict the gates keep their full force", () => {
  // The deterministic path is unchanged. It is reached only when the evaluator
  // did not run — and the engine separately refuses to let that path QUALIFY
  // anything, recording `unknown` instead.
  const d = decideCompanyBrain({
    gates: gates({ required_geography: "united states" }),
    semantic: null,
    policy: POLICY, hiring_verified: true, grounding: null,
  });
  assertEquals(d.outcome, "REJECT");
  assert(d.reason.startsWith("hard gate failed:"), d.reason);
});

Deno.test("4c. an absent ceiling is no gate, on every path", () => {
  // The nullable ceiling must not accidentally re-arm as `0`, which would
  // reject everything.
  assertEquals(
    failedHardGates({ ...gates(), employee_count: 999_999, employee_ceiling: null }),
    []);
  assert(
    failedHardGates({ ...gates(), employee_count: 999_999, employee_ceiling: 0 })
      .includes("employee_count_far_above_ceiling"),
    "an explicit zero IS a stated bound and still gates");
});

// ══════════ 5. THE OTHER GATE THAT KEPT COMPANIES AWAY FROM THE EVALUATOR ══

Deno.test("5. an UNRECOGNISED role title no longer blocks a company from GPT", () => {
  // THE THIRD PLACE THE SAME SUBSTRING MATCH DECIDED SOMETHING SEMANTIC.
  //
  // `reachesCompanyBrain` accepts verified / verification_needed / watch and
  // refuses `hiring_not_verified`. So `assessHiring` — which classified titles
  // against the vocabulary compiled from the mission sentence — decided whether
  // a company ever reached the Company Brain and the Mission evaluator at all.
  //
  // "software engineers" compiles to a FIXED list that does not contain
  // "Founding Engineer" or "Member of Technical Staff", so companies hiring
  // precisely what the mission asked for were stopped before the only stage
  // capable of noticing.
  const vocab = {
    source: "mission" as const,
    required_titles: ["software engineer", "backend engineer"],
  };
  const unrecognised = assessHiring(
    [{ title: "Founding Engineer" }, { title: "Member of Technical Staff" }],
    [], { vocab: vocab as never },
  );
  assertEquals(unrecognised.verdict, "watch",
    "openings the vocabulary did not recognise are a QUESTION, not an absence");
  assert(reachesCompanyBrain(unrecognised),
    "and the company must reach the evaluator, which judges the real titles");
  // AND IT COSTS NOTHING. `watch` never triggers a paid job search.
  assertFalse(needsPaidJobVerification(unrecognised),
    "holding for judgement must not buy a LinkedIn job search");
  assertEquals(unrecognised.tier, null, "no tier is claimed that was not earned");
});

Deno.test("5b. NO openings at all is still an absence of evidence", () => {
  // The distinction that keeps the fix honest: "we did not recognise the
  // titles" and "there are no titles" are different facts, and only the second
  // is evidence about the company.
  const vocab = { source: "mission" as const, required_titles: ["software engineer"] };
  const none = assessHiring([], [], { vocab: vocab as never });
  assertEquals(none.verdict, "hiring_not_verified");
  assertFalse(reachesCompanyBrain(none));
  assert(none.reason.includes("No open roles at all"), none.reason);
});

Deno.test("5c. a RECOGNISED role still verifies directly — no regression", () => {
  const vocab = {
    source: "mission" as const, required_titles: ["software engineer"],
  };
  const matched = assessHiring(
    [{ title: "Senior Software Engineer" }], [], { vocab: vocab as never });
  assertEquals(matched.verdict, "hiring_verified");
  assertEquals(matched.tier, "A");
  assert(reachesCompanyBrain(matched));
});

Deno.test("5d. a MISSIONLESS run keeps the commercial ladder exactly as it was", () => {
  // The `watch` rescue is scoped to mission vocabularies. Without one, the
  // default GTM ladder answers, and technical-only hiring is still not
  // commercial evidence — which is the correct answer to a question about
  // Agentory's own buyer.
  const technicalOnly = assessHiring([{ title: "Backend Engineer" }], []);
  assertEquals(technicalOnly.verdict, "hiring_not_verified");
  assert(technicalOnly.reason.includes("technical hiring is never commercial evidence"),
    technicalOnly.reason);
});

// ═════════════════════════════════════ 6. the Brain never invents a pass ══

Deno.test("6. the Brain cannot QUALIFY anything the evaluator did not pass", () => {
  // THE AUTHORITY RUNS ONE WAY. Loosening the gates must not have created a
  // path where clean deterministic facts qualify a company on their own.
  const noVerdict = decideCompanyBrain({
    gates: gates(), semantic: null,
    policy: POLICY, hiring_verified: true, grounding: null,
  });
  assertEquals(noVerdict.outcome, "REVIEW",
    "no assessment is a held state, never a qualification");

  for (const fit of ["review", "fail"] as const) {
    const d = decideCompanyBrain({
      gates: gates(), semantic: missionVerdict(fit),
      policy: POLICY, hiring_verified: true, grounding: null,
    });
    assertFalse(d.outcome === "QUALIFIED",
      `mission_fit=${fit} may never become a qualification`);
  }
});

// ═════════ 12-16. THE VETO BY SILENCE, in the exact shape it shipped in ══
//
// Run bab6da1e qualified nobody. Three companies reached the Company Brain,
// the Mission evaluator passed all three, and all three were held:
//
//   godela.ai       mission_fit pass, score 84, failed_requirements []
//   afterquery.com  mission_fit pass, score 92, failed_requirements []
//   ctgt.ai         mission_fit pass, score 92, failed_requirements []
//
// Each carried grounding of exactly this shape — nothing validated, nothing
// REFUTED, and two "reasons" that are restatements of the nothing:
//
//   validated_claims: 0, rejected_claims: 0, unacknowledged_conflicts: 0
//   downgrade_reasons: ["pass_without_any_validated_claim",
//                       "grounding_score_0_below_0.6"]

/** The grounding those three companies actually carried. */
const SILENT_GROUNDING = {
  final_grounded_decision: "review" as const,
  grounding_score: 0,
  validated_claim_types: [] as string[],
  downgrade_reasons: [
    "pass_without_any_validated_claim",
    "grounding_score_0_below_0.6",
  ],
  validated_claims: 0,
  rejected_claims: 0,
  unacknowledged_conflicts: 0,
};

Deno.test("12. a verifier that validated NOTHING does not refute anything", () => {
  assertFalse(groundingRefutes(SILENT_GROUNDING),
    "zero validated AND zero rejected is silence, however many reasons it names");
});

Deno.test("13. THE BUG: three passed companies are no longer held by that silence",
  () => {
    for (const [company, score] of [
      ["godela.ai", 84], ["afterquery.com", 92], ["ctgt.ai", 92],
    ] as const) {
      const d = decideCompanyBrain({
        gates: gates(),
        semantic: missionVerdict("pass", { match_score: score }),
        policy: POLICY, hiring_verified: true,
        grounding: SILENT_GROUNDING,
      });
      assertEquals(d.outcome, "QUALIFIED",
        `${company} was passed by the Mission evaluator on cited evidence and ` +
        `may not be held because the verifier examined nothing`);
    }
  });

Deno.test("14. a POSITIVE finding still downgrades — the guard is not a bypass", () => {
  // Each of the three things that count, on its own, against an otherwise
  // identical silent verifier.
  const refuted = { ...SILENT_GROUNDING, rejected_claims: 1 };
  assert(groundingRefutes(refuted), "a refuted claim is a finding");

  const conflicted = { ...SILENT_GROUNDING, unacknowledged_conflicts: 1 };
  assert(groundingRefutes(conflicted), "an unaddressed registry conflict is a finding");

  const material = {
    ...SILENT_GROUNDING,
    downgrade_reasons: ["material_conflict_unacknowledged:ev-1,ev-2"],
  };
  assert(groundingRefutes(material), "a named material conflict is a finding");

  for (const g of [refuted, conflicted, material]) {
    assertEquals(
      decideCompanyBrain({
        gates: gates(), semantic: missionVerdict("pass"),
        policy: POLICY, hiring_verified: true, grounding: g,
      }).outcome,
      "REVIEW", "and the Brain holds the company for review, never rejects it");
  }
});

Deno.test("15. THE INVERSION: agreeing with the mission cannot cost a company", () => {
  // `groundedClaims` only emits these reasons on its `pass` branch. So the
  // verifier that AGREED with the Mission produced reasons and vetoed it, while
  // one that returned a bare `review` produced none and left it standing — runs
  // 23462bc6 and dc0c76a4 qualified two companies each on exactly that.
  //
  // Same evidence, same silence, two verifiers of differing confidence. They
  // must not disagree about the outcome.
  const agreed = SILENT_GROUNDING;                                  // said pass
  const unsure = { ...SILENT_GROUNDING, downgrade_reasons: [] };     // said review

  const outcomeWith = (g: typeof SILENT_GROUNDING) =>
    decideCompanyBrain({
      gates: gates(), semantic: missionVerdict("pass"),
      policy: POLICY, hiring_verified: true, grounding: g,
    }).outcome;

  assertEquals(outcomeWith(agreed), outcomeWith(unsure),
    "a more confident verifier must never produce a worse outcome");
  assertEquals(outcomeWith(agreed), "QUALIFIED");
});

Deno.test("16. an unrecognised downgrade reason is not a refutation", () => {
  // Fail safe toward the Mission verdict. A verifier must say WHAT it found; a
  // reason nobody classified is the verifier being unhappy, not evidence.
  assertFalse(groundingRefutes({
    ...SILENT_GROUNDING,
    downgrade_reasons: ["some_future_reason_nobody_classified"],
  }));
});

// ═════════ 17-19. WHAT "QUALIFIED" REQUIRES — AND WHAT IT DOES NOT ══
//
// The count the user reads must mean: a US company, an AI startup, a current
// software-engineering hiring signal, and Company Brain evidence that survived
// verification. Nothing weaker may reach it.
//
// There are three cheaper verdicts in the pipeline that could each be mistaken
// for qualification, and every one of them is a different thing:
//
//   triage `relevant`    a ranking hint from a cheap batched read, on discovery
//                        fields. It decides ORDER, never membership.
//   mission_fit `review`  the evaluator looked and could not settle it.
//   grounded `review`     the verifier could not confirm the claims cited.

Deno.test("17. triage RELEVANT is not qualification — it only ranks", () => {
  // A company triage loved, that the evaluator has not passed. It must not
  // qualify, and it must not be rejected either.
  const d = decideCompanyBrain({
    gates: gates(),
    semantic: missionVerdict("review", { match_score: 99, confidence: 0.99 }),
    policy: POLICY, hiring_verified: true, grounding: null,
  });
  assertEquals(d.outcome, "REVIEW",
    "a strong relevance signal is not a Company Brain pass");
  assertFalse(d.outcome === "QUALIFIED");
});

Deno.test("18. QUALIFIED requires an explicit evaluator pass — nothing infers it", () => {
  // With no semantic verdict at all, the deterministic gates cannot qualify
  // anybody however clean they are.
  const noVerdict = decideCompanyBrain({
    gates: gates(), semantic: null,
    policy: POLICY, hiring_verified: true, grounding: null,
  });
  assertFalse(noVerdict.outcome === "QUALIFIED",
    "clean gates plus verified hiring is still not a qualification");

  // And with the pass, it qualifies.
  const passed = decideCompanyBrain({
    gates: gates(), semantic: missionVerdict("pass"),
    policy: POLICY, hiring_verified: true, grounding: null,
  });
  assertEquals(passed.outcome, "QUALIFIED");
});

Deno.test("19. a REFUTED claim keeps a company out of the qualified count", () => {
  // The evaluator passed it; the verifier checked its citations and one did not
  // survive. That is a hold — the company is neither qualified nor rejected.
  const d = decideCompanyBrain({
    gates: gates(), semantic: missionVerdict("pass"),
    policy: POLICY, hiring_verified: true,
    grounding: {
      final_grounded_decision: "review", grounding_score: 0.5,
      validated_claim_types: ["company_fit"],
      downgrade_reasons: ["grounding_score_0.5_below_0.6"],
      validated_claims: 1, rejected_claims: 1, unacknowledged_conflicts: 0,
    },
  });
  assertEquals(d.outcome, "REVIEW",
    "this is the live godela.ai case: passed by GPT, one claim refuted, held");
});
