// A LINKEDIN LABEL IS NOT A BUSINESS MODEL.
//
// `evaluateCompanyFit` rejected a company outright when its enriched industry
// names did not literally contain an ICP phrase:
//
//     else if (!positive_industries.some((x) => names.includes(x.toLowerCase())))
//       failed.push("industry_not_in_icp");
//
// LinkedIn's own vocabulary has no "B2B SaaS". It has "Software Development",
// "Technology, Information and Internet", "IT Services and IT Consulting". Every
// company in the audited run would have hard-FAILED that gate on wording alone —
// including SnapMagic, whose YC one-liner is "AI-assisted electronics design"
// sold to engineering organisations.
//
// So the LABEL becomes weak metadata and the DECISION moves to a structured
// semantic assessment over combined evidence. That is not a loosening: a label
// alone can no longer pass a company either. "Software Development" with no
// other evidence is UNKNOWN, and unknown is REVIEW — never a silent accept and
// never a silent reject.
//
// WHAT STAYS DETERMINISTIC. Facts that are checkable stay checkable: identity
// mismatch, inactive company, geography, a verified headcount clearly over the
// ceiling, consumer-only evidence, absent commercial signal. The model is asked
// to interpret ambiguity, never to overrule a fact.
//
// PURE. The classifier is INJECTED, so the whole decision is testable with no
// model call and no network.

export const SEMANTIC_FIT_VERSION = "company-brain-semantic-fit-v1" as const;

export type BusinessModel =
  | "b2b_saas" | "ai_saas" | "b2b_software" | "b2b_service" | "consumer" | "unknown";

export type CompanyFitVerdict = "pass" | "review" | "fail";
export type AgentoryUseCase = "strong" | "plausible" | "weak" | "none";

/** The structured answer the classifier must return. */
export interface SemanticFitAssessment {
  business_model: BusinessModel;
  company_fit: CompanyFitVerdict;
  confidence: number;
  agentory_use_case: AgentoryUseCase;
  supporting_evidence: string[];
  conflicting_evidence: string[];
  unknown_fields: string[];
  reason: string;
  /**
   * DOES THE COMPANY SATISFY THE USER'S MISSION?
   *
   * ADDITIVE AND OPTIONAL, on purpose. Absent, every path below behaves exactly
   * as it did — five test files and roughly twenty-five assertions depend on
   * that, and a rewrite would have made this change unreviewable as a diff.
   * Present, it OUTRANKS `company_fit`.
   *
   * The two answer different questions. `company_fit` asks whether the company
   * looks like Agentory's buyer; `mission_fit` asks whether it is what the user
   * requested. For "AI startups hiring software engineers" those come apart
   * completely, and the second is the one the run was commissioned to answer.
   */
  mission_fit?: "pass" | "review" | "fail";
  /** Workspace preference strength. RANKING ONLY — may never cause a reject. */
  icp_fit?: "strong" | "plausible" | "weak";
  /** 0-100, for ordering qualified results. Never a threshold. */
  match_score?: number;
}

/** Everything the assessment may look at. Nothing is privileged over the rest. */
export interface SemanticFitInput {
  /** The user's own words. Highest precedence. */
  original_user_query: string | null;
  /** The compiled mission. Second. */
  mission_verticals: string[];
  mission_geography: string | null;
  /** Workspace context. Third, and only where relevant to THIS mission. */
  workspace_industries: string[];
  company_name: string | null;
  yc_description: string | null;
  website_description: string | null;
  linkedin_description: string | null;
  /** WEAK METADATA. Never decisive on its own, in either direction. */
  linkedin_industry: string | null;
  linkedin_industry_ids: string[];
  employee_count: number | null;
  employee_advisory: string | null;
  geography: string | null;
  /** The commercial signal already proven by the hiring policy. */
  commercial_signal: string | null;
  commercial_tier: "A" | "B" | "C" | null;
}

/** Labels that describe an industry sector, not a business model. */
export const WEAK_INDUSTRY_LABELS: readonly string[] = [
  "software development", "technology, information and internet",
  "it services and it consulting", "internet publishing", "computer software",
  "information technology", "technology", "internet", "computer and network security",
];

export function isWeakIndustryLabel(label: unknown): boolean {
  const l = String(label ?? "").trim().toLowerCase();
  return !!l && WEAK_INDUSTRY_LABELS.some((w) => l.includes(w));
}

// -------------------------------------------------- mission precedence ----

export interface AppliedPolicy {
  mission_verticals: string[];
  /** Workspace categories kept because the mission is about them. */
  workspace_context_applied: string[];
  /** Workspace categories DROPPED as unrelated to this mission. */
  workspace_categories_ignored: string[];
  geography: string | null;
  precedence: readonly ["user_query", "lead_mission", "workspace_brain", "defaults"];
}

/**
 * Decide which context actually governs THIS mission.
 *
 * The workspace Brain lists "B2B SaaS, AI SaaS, Recruiting Agencies". A query
 * about SaaS startups must not be broadened to recruiting agencies merely
 * because the workspace sells to them as well — that is how a mission stops
 * answering the question that was asked.
 *
 * A workspace category is kept only when it overlaps the mission's own
 * verticals or the user's own words.
 */
export function applyMissionPrecedence(i: {
  original_user_query: string | null;
  mission_verticals: string[];
  mission_geography: string | null;
  workspace_industries: string[];
}): AppliedPolicy {
  const q = String(i.original_user_query ?? "").toLowerCase();
  const verticals = i.mission_verticals.map((v) => v.toLowerCase().trim()).filter(Boolean);
  const kept: string[] = [];
  const ignored: string[] = [];

  for (const w of i.workspace_industries) {
    const wl = w.toLowerCase().trim();
    if (!wl) continue;
    const tokens = wl.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const overlapsMission = verticals.some((v) => wl.includes(v) || v.includes(wl)) ||
      tokens.some((t) => verticals.some((v) => v.includes(t)));
    const inUserWords = tokens.length > 0 && tokens.every((t) => q.includes(t));
    if (overlapsMission || inUserWords) kept.push(w);
    else ignored.push(w);
  }

  return {
    mission_verticals: i.mission_verticals,
    workspace_context_applied: kept,
    workspace_categories_ignored: ignored,
    geography: i.mission_geography,
    precedence: ["user_query", "lead_mission", "workspace_brain", "defaults"] as const,
  };
}

// ------------------------------------------------------ deterministic gates ----

export type HardGate =
  | "identity_mismatch" | "inactive_company" | "unsupported_geography"
  | "employee_count_far_above_ceiling" | "consumer_only" | "no_commercial_signal"
  | "no_agentory_use_case";

export interface HardGateInput {
  identity_status: "verified_match" | "unresolved" | "rejected_mismatch";
  active: boolean;
  geography: string | null;
  required_geography: string | null;
  employee_count: number | null;
  /**
   * The ceiling, or NULL when nobody stated one.
   *
   * NULL IS NOT A DEFAULT CEILING. This used to be a required number, and the
   * engine passed `?? 200` when the Mission set no size range — so a Mission
   * that never mentioned company size still rejected every verified count above
   * 400 (the ceiling plus `CEILING_TOLERANCE`), including companies the Mission
   * evaluator had explicitly passed. A bound nobody asked for is not a
   * falsifiable fact about the company; it is a preference, and preferences
   * rank rather than reject.
   */
  employee_ceiling: number | null;
  commercial_tier: "A" | "B" | "C" | null;
  semantic: SemanticFitAssessment | null;
  /**
   * Did the MISSION decide which roles qualify?
   *
   * True when `role_vocabulary.source === "mission"`. It changes one thing: an
   * absent commercial tier stops being a hard rejection, because "commercial"
   * is then a question about Agentory's buyer that the user did not ask.
   * Omitted, behaviour is exactly as before.
   */
  mission_owns_hiring_role?: boolean;
}

/** How far above the ceiling counts as "clearly" above. */
export const CEILING_TOLERANCE = 1.0;

/**
 * The facts that reject on their own.
 *
 * Deliberately short. Everything absent from this list is a scoring or review
 * signal, because a company rejected on an uncertain fact is a company nobody
 * can appeal for.
 */
export function failedHardGates(i: HardGateInput): HardGate[] {
  const failed: HardGate[] = [];
  if (i.identity_status === "rejected_mismatch") failed.push("identity_mismatch");
  if (!i.active) failed.push("inactive_company");
  // GEOGRAPHY REJECTS ONLY ON A KNOWN MISMATCH. Unknown geography is a REVIEW
  // question, not a rejection.
  if (i.required_geography && i.geography &&
      !i.geography.toLowerCase().includes(i.required_geography.toLowerCase())) {
    failed.push("unsupported_geography");
  }
  // A VERIFIED count clearly above a STATED ceiling. An unverified or
  // borderline count is REVIEW — the audited data had YC self-reports off by up
  // to 23x — and an ABSENT ceiling is no gate at all.
  if (i.employee_count != null && i.employee_ceiling != null &&
      i.employee_count > i.employee_ceiling * (1 + CEILING_TOLERANCE)) {
    failed.push("employee_count_far_above_ceiling");
  }
  if (i.semantic?.business_model === "consumer") failed.push("consumer_only");
  // AN ABSENT COMMERCIAL TIER IS NOT A FALSIFIABLE FACT WHEN THE MISSION NAMED
  // ITS OWN ROLES.
  //
  // "Commercial" here means Agentory's buyer — a company standing up a GTM
  // motion. That is the right default and the wrong question to ask of a
  // Mission whose required signal is software engineers: `commercial_tier`
  // comes from `hiring_assessment.tier`, so a Mission-scoped run that found
  // four Senior Software Engineer openings and a Mission-scoped run that found
  // nothing at all were both rejected here, identically, before any model was
  // consulted. Whether an opening satisfies the Mission is a JUDGEMENT, and it
  // belongs to the evaluator.
  //
  // Where the Mission is silent the gate stands: a GTM mission with no
  // commercial role genuinely has no signal.
  if (i.commercial_tier === null && !i.mission_owns_hiring_role) {
    failed.push("no_commercial_signal");
  }
  if (i.semantic?.agentory_use_case === "none") failed.push("no_agentory_use_case");
  return failed;
}

// ─────────────────────── who may still speak after the evaluator has spoken ──
//
// THE AUTHORITY BOUNDARY, AS TWO SETS.
//
// `failedHardGates` predates the Mission evaluator. It ran FIRST and returned
// REJECT before `mission_fit` was ever read, so the Company Brain — which exists
// to ASSEMBLE evidence for the evaluator — was quietly the final authority over
// it. Two of its gates rejected companies the evaluator had explicitly passed:
//
//   unsupported_geography             `geography.includes(required_geography)`,
//                                     so "San Francisco, CA, USA" does not
//                                     contain "united states" and the check
//                                     rejected the very companies it was meant
//                                     to keep.
//   employee_count_far_above_ceiling  against a ceiling the Mission never set.
//
// Both are SEMANTIC judgements wearing a deterministic costume. Whether a
// location satisfies "the United States", and whether a company's size suits a
// request that never mentioned size, are exactly the questions the evaluator
// reads the Mission to answer. So after it has answered, only two kinds of fact
// may still speak.

/**
 * Facts that make the EVIDENCE UNTRUSTWORTHY rather than the company unsuitable.
 *
 * A mismatched identity means the evidence describes a DIFFERENT COMPANY, so the
 * evaluator's verdict is void — it answered about something else. That is a
 * REVIEW: nothing was learned about this company, and "we resolved the wrong
 * LinkedIn page" is not a reason to tell a user their prospect was rejected.
 */
const INTEGRITY_GATES: ReadonlySet<HardGate> = new Set<HardGate>(["identity_mismatch"]);

/**
 * Verified facts the MISSION ITSELF made disqualifying.
 *
 * These may still reject after the evaluator passes, because the user stated the
 * constraint and the fact is checkable. `employee_count_far_above_ceiling` is
 * here ONLY because its ceiling is now nullable: it can fire only when the
 * Mission set a bound, so a workspace preference can never reach this set.
 *
 * Everything NOT in either set — `unsupported_geography`, `consumer_only`,
 * `no_commercial_signal`, `no_agentory_use_case` — is about Agentory's own buyer
 * or is a judgement the evaluator is better placed to make. Those remain
 * computed and REPORTED on every decision, so the Brain still shows its work;
 * they simply no longer carry a veto.
 */
const MISSION_STATED_GATES: ReadonlySet<HardGate> = new Set<HardGate>([
  "inactive_company", "employee_count_far_above_ceiling",
]);

// ───────────────────────── grounding: a verifier, not a second authority ────
//
// THE DEFECT THIS ENCODES AGAINST.
//
// The Brain used to downgrade on `final_grounded_decision !== "pass"`. That
// treats "grounding did not say pass" as "grounding said no" — and those are
// different claims. TEST run ea2d02f2 is the proof: the grounded classifier ran
// in `enforce` for all five companies that reached qualification and returned,
// every time,
//
//     grounding_score: 0, validated_claims: [], rejected_claims: [],
//     downgrade_reasons: [], decision: "review"
//
// It refuted nothing. It produced NOTHING. Yet `"review" !== "pass"` was true,
// so every company was downgraded — including Deepgram, which the Mission
// evaluator passed at match_score 91 with five verified citations and zero
// failed gates, and whose own Brain record reads "All mission requirements are
// supported by cited evidence." QUALIFIED was unreachable for any company in
// any run, whatever the budget.
//
// AN EMPTY VERIFICATION IS THE ABSENCE OF VERIFICATION, NOT A FAILED ONE.
//
// ── WHY THIS DOES NOT REOPEN THE UNGROUNDED-PASS HOLE ───────────────────────
//
// The Mission evaluator does its OWN grounding, and that is the grounding that
// governs the mission verdict: `parseMissionEvaluationStrict` checks every
// citation against this company's registry, drops any evidence_id it does not
// contain, drops any excerpt that is not verbatim in the source, and downgrades
// an uncited pass to review. A `mission_fit: pass` has therefore ALREADY been
// paid for in verified evidence before it reaches this function.
//
// The grounded classifier is a separate, older layer verifying different claims
// (business model, use case). It remains free to REFUTE — with evidence. What
// it may no longer do is veto by silence.

export interface GroundingSummary {
  final_grounded_decision: "pass" | "review" | "fail";
  grounding_score: number;
  validated_claim_types: string[];
  downgrade_reasons: string[];
  /** Claims checked and VERIFIED against the registry. */
  validated_claims: number;
  /** Claims checked and REFUTED. */
  rejected_claims: number;
  /** Material registry conflicts the model did not address. */
  unacknowledged_conflicts: number;
}

/**
 * Did grounding actually examine anything?
 *
 * Reported for observability. A run where this is false for every company is a
 * broken grounder, and that should be visible rather than silently absorbed as
 * a pile of held companies.
 *
 * ── MEASURED IN CLAIMS CHECKED, NOT IN COMPLAINTS MADE ────────────────────
 *
 * `downgrade_reasons.length > 0` used to count, and that is exactly why the
 * grounder being structurally unable to check anything went unnoticed for the
 * whole life of the feature: it emitted `pass_without_any_validated_claim` —
 * a reason whose CONTENT is "I checked nothing" — and this function read the
 * existence of the string as proof that it had. The one diagnostic built to
 * catch a dead verifier was satisfied by the verifier's own report of being
 * dead.
 *
 * Claims checked, or a conflict found. Nothing else is examination.
 */
export function groundingWasPerformed(g: GroundingSummary): boolean {
  return g.validated_claims + g.rejected_claims > 0 ||
    g.unacknowledged_conflicts > 0;
}

/**
 * Downgrade reasons that are a POSITIVE FINDING about the company.
 *
 * Everything else the verifier emits is a statement about ITSELF — it validated
 * nothing, it scored below a threshold, a provider it wanted did not answer.
 * Those are absences, and an absence may not overturn a Mission verdict.
 */
const REFUTING_DOWNGRADES: readonly string[] = ["material_conflict_unacknowledged"];

/**
 * Does grounding hold EVIDENCE that contradicts a pass?
 *
 * The only question the Brain may ask of grounding, and it must be answerable
 * with a POSITIVE FINDING:
 *
 *   rejected_claims          a claim was checked and did not survive
 *   unacknowledged_conflicts the registry contradicts itself and the model
 *                            did not address it
 *   a refuting downgrade     the verifier named a defect IN THE COMPANY'S
 *                            EVIDENCE, not in its own coverage
 *
 * ── WHY `downgrade_reasons.length > 0` IS NOT ON THAT LIST ─────────────────
 *
 * It used to be, and it is how run bab6da1e qualified nobody. `godela.ai`,
 * `afterquery.com` and `ctgt.ai` were each passed by the Mission evaluator
 * (scores 84, 92, 92, zero failed requirements) and each held, on:
 *
 *     downgrade_reasons: ["pass_without_any_validated_claim",
 *                         "grounding_score_0_below_0.6"]
 *
 * Both of those reasons ARE the silence. They say the verifier validated
 * nothing — with `rejected_claims: 0`, so it refuted nothing either. Reading
 * them as a refutation is precisely the veto-by-silence this function exists to
 * prevent, laundered through a string.
 *
 * The inversion it produced is the proof: `groundedClaims` only emits these
 * reasons on the `pass` branch, so a verifier that AGREED with the Mission
 * vetoed it, while one that returned a bare `review` left it standing. Runs
 * 23462bc6 and dc0c76a4 qualified two companies each with identical zero-claim
 * grounding and an empty `downgrade_reasons`. Confidence was inverted.
 *
 * An unrecognised reason is treated as non-refuting. A verifier must say what
 * it found, not merely that it is unhappy.
 */
export function groundingRefutes(g: GroundingSummary): boolean {
  if (g.final_grounded_decision === "pass") return false;
  if (g.rejected_claims > 0 || g.unacknowledged_conflicts > 0) return true;
  return g.downgrade_reasons.some((r) =>
    REFUTING_DOWNGRADES.some((prefix) => r.startsWith(prefix)));
}

/** Gates that may still overturn a Mission verdict, split by what they mean. */
export function gatesThatOutrankTheMission(failed: readonly HardGate[]): {
  integrity: HardGate[];
  mission_stated: HardGate[];
  context_only: HardGate[];
} {
  return {
    integrity: failed.filter((g) => INTEGRITY_GATES.has(g)),
    mission_stated: failed.filter((g) => MISSION_STATED_GATES.has(g)),
    context_only: failed.filter(
      (g) => !INTEGRITY_GATES.has(g) && !MISSION_STATED_GATES.has(g)),
  };
}

// --------------------------------------------------------- the decision ----

export type BrainOutcome = "QUALIFIED" | "REVIEW" | "REJECT";

export interface BrainDecision {
  version: typeof SEMANTIC_FIT_VERSION;
  outcome: BrainOutcome;
  business_model: BusinessModel;
  confidence: number;
  agentory_use_case: AgentoryUseCase;
  failed_hard_gates: HardGate[];
  unknown_fields: string[];
  supporting_evidence: string[];
  conflicting_evidence: string[];
  reason: string;
  policy: AppliedPolicy;
}

/**
 * Decide one company. TOTAL — every input yields exactly one outcome.
 *
 * There is no path that returns nothing. A silent NOT_EVALUATED after the
 * prerequisites pass is what produced "0 passed, 0 held as unknown" for seven
 * enriched companies.
 */
export function decideCompanyBrain(i: {
  gates: HardGateInput;
  semantic: SemanticFitAssessment | null;
  policy: AppliedPolicy;
  /** Tier B with no supporting signal is a REVIEW, never a pass. */
  hiring_verified: boolean;
  /**
   * THE VERIFIED GROUNDING, when the grounded classifier ran.
   *
   * Supplied, it OUTRANKS `semantic.company_fit`: the model's own verdict is an
   * opinion, and this is what survived being checked against the evidence it
   * cited. Absent, the behaviour is exactly as before — an ungrounded run still
   * works, it simply cannot reach QUALIFIED on confidence alone.
   */
  /**
   * The verifier's findings. See `groundingRefutes` — only a POSITIVE finding
   * may downgrade. The claim counts default to 0 so an older caller that omits
   * them is treated as "grounding examined nothing", which is the safe reading.
   */
  grounding?:
    | (Omit<GroundingSummary, "validated_claims" | "rejected_claims" | "unacknowledged_conflicts">
      & Partial<Pick<GroundingSummary,
        "validated_claims" | "rejected_claims" | "unacknowledged_conflicts">>)
    | null;
}): BrainDecision {
  const failed = failedHardGates({ ...i.gates, semantic: i.semantic });
  const s = i.semantic;
  // NORMALISED ONCE, with the absent counts read as zero — see `groundingRefutes`.
  const grounding: GroundingSummary | null = i.grounding
    ? {
      ...i.grounding,
      validated_claims: i.grounding.validated_claims ?? 0,
      rejected_claims: i.grounding.rejected_claims ?? 0,
      unacknowledged_conflicts: i.grounding.unacknowledged_conflicts ?? 0,
    }
    : null;
  const base = {
    version: SEMANTIC_FIT_VERSION,
    business_model: s?.business_model ?? "unknown",
    confidence: s?.confidence ?? 0,
    agentory_use_case: s?.agentory_use_case ?? "weak",
    failed_hard_gates: failed,
    unknown_fields: s?.unknown_fields ?? ["semantic_assessment_absent"],
    supporting_evidence: s?.supporting_evidence ?? [],
    conflicting_evidence: s?.conflicting_evidence ?? [],
    policy: i.policy,
  };

  // ── THE MISSION VERDICT IS CONSULTED BEFORE ANY GATE MAY REJECT ──────────
  //
  // THE ORDER IS THE AUTHORITY BOUNDARY. This block used to sit BELOW an
  // unconditional `if (failed.length > 0) return REJECT`, which meant the
  // evaluator's answer was read only for companies no gate had already
  // disposed of — and the gates included two semantic judgements the evaluator
  // exists to make. Hoisting it is the fix: a Mission verdict is now overturned
  // only by a fact that is either an integrity problem or something the Mission
  // itself made disqualifying, and never silently.
  if (s?.mission_fit) {
    const { integrity, mission_stated, context_only } = gatesThatOutrankTheMission(failed);

    // THE EVIDENCE IS ABOUT ANOTHER COMPANY. The verdict is void, not negative.
    if (integrity.length > 0) {
      return {
        ...base, outcome: "REVIEW",
        reason: `mission verdict not applicable — ${integrity.join(", ")}; ` +
          `the collected evidence may not describe this company`,
      };
    }
    // THE MISSION SAID SO, AND THE FACT IS VERIFIED. A rejection here names both
    // the gate and the authority, so it can be argued with.
    if (mission_stated.length > 0) {
      return {
        ...base, outcome: "REJECT",
        reason: `mission-stated constraint failed on a verified fact: ` +
          `${mission_stated.join(", ")}`,
      };
    }

    const g = grounding;
    if (s.mission_fit === "fail") {
      return {
        ...base, outcome: "REJECT",
        reason: s.reason || "the company does not satisfy the mission",
      };
    }
    // ── GROUNDING MAY REFUTE, BUT MAY NOT VETO BY SILENCE ─────────────────
    //
    // Was `g.final_grounded_decision !== "pass"`, which made an empty verifier
    // indistinguishable from a refuting one and put QUALIFIED permanently out
    // of reach. It now takes an actual finding — see `groundingRefutes`.
    const groundedDown = g !== null && groundingRefutes(g);
    if (s.mission_fit === "review" || groundedDown) {
      return {
        ...base, outcome: "REVIEW",
        reason: groundedDown && g!.downgrade_reasons.length > 0
          ? `held for review: ${g!.downgrade_reasons.join("; ")}`
          : s.reason || "the mission is not yet settled on the available evidence",
      };
    }
    // A PASS. `context_only` gates are recorded on `failed_hard_gates` for the
    // reviewer and are deliberately not consulted here — they are questions
    // about Agentory's buyer, or judgements the evaluator already made.
    return {
      ...base, outcome: "QUALIFIED",
      reason: [
        s.reason || "satisfies the mission",
        g ? `(grounding ${g.grounding_score}, validated: ${g.validated_claim_types.join(", ")})` : "",
        context_only.length > 0 ? `[advisory, not disqualifying: ${context_only.join(", ")}]` : "",
      ].filter(Boolean).join(" "),
    };
  }

  // ── NO MISSION VERDICT: THE DETERMINISTIC PATH, UNCHANGED ────────────────
  //
  // Reached when the evaluator did not run. The gates keep their full force
  // here because nothing better has spoken — but note that the engine no longer
  // lets this path QUALIFY anything either; it records `unknown`.
  if (failed.length > 0) {
    return { ...base, outcome: "REJECT", reason: `hard gate failed: ${failed.join(", ")}` };
  }
  // NO ASSESSMENT IS NOT A REJECTION. An absent classifier means the question
  // was never asked, which is precisely what REVIEW is for.
  if (!s) {
    return { ...base, outcome: "REVIEW",
      reason: "no semantic assessment available — held for review, not rejected" };
  }
  // ── THE GROUNDED VERDICT OUTRANKS THE MODEL'S OWN ────────────────────────
  //
  // `s.company_fit` is what the classifier said. `grounding` is what survived
  // being checked against the evidence it cited. Where they disagree the
  // verified one wins, because the whole failure this replaces was a confident
  // claim nobody could substantiate reaching a salesperson as a fact.
  const g = grounding;

  // THE SAME RULE ON THIS PATH. A verifier that examined nothing may not
  // replace the classifier's own verdict; it would be substituting silence for
  // an answer, which is what `groundingWasPerformed` exists to detect.
  const effectiveFit = g && groundingWasPerformed(g)
    ? g.final_grounded_decision
    : s.company_fit;

  if (effectiveFit === "fail") {
    // A REJECT MUST BE EARNED. The verifier already refuses to let an
    // unsupported "fail" stand, so reaching here means the model was explicit
    // and at least one of its claims held up.
    return { ...base, outcome: "REJECT", reason: s.reason || "semantic assessment: not a fit" };
  }
  if (effectiveFit === "review" || s.business_model === "unknown" ||
      s.unknown_fields.length > 0 || !i.hiring_verified ||
      s.agentory_use_case === "weak") {
    return {
      ...base, outcome: "REVIEW",
      reason: g && g.downgrade_reasons.length > 0
        // THE DOWNGRADE IS THE REASON. "likely fit, facts uncertain" told a
        // reviewer nothing; "grounding_score_0.33_below_0.6" tells them exactly
        // what to go and check.
        ? `held for review: ${g.downgrade_reasons.join("; ")}`
        : s.reason || "likely fit, with one or more facts still uncertain",
    };
  }
  return {
    ...base, outcome: "QUALIFIED",
    reason: g
      ? `${s.reason || "strong fit with a current signal"} ` +
        `(grounding ${g.grounding_score}, validated: ${g.validated_claim_types.join(", ")})`
      : s.reason || "strong fit with a current signal",
  };
}

// ------------------------------------------------------------- the prompt ----

/**
 * The instruction handed to the classifier.
 *
 * Kept here so the contract is versioned with the code that consumes it, and so
 * a test can assert what the model is actually asked.
 */
export function buildSemanticFitPrompt(i: SemanticFitInput, policy: AppliedPolicy): string {
  return [
    "Assess whether this company fits the buyer profile for THIS mission.",
    "",
    `MISSION (highest precedence): ${i.original_user_query ?? "(none)"}`,
    `Mission verticals: ${policy.mission_verticals.join(", ") || "(none)"}`,
    `Mission geography: ${policy.geography ?? "(none)"}`,
    policy.workspace_context_applied.length
      ? `Relevant workspace context: ${policy.workspace_context_applied.join(", ")}`
      : "Relevant workspace context: (none)",
    policy.workspace_categories_ignored.length
      ? `IGNORE these unrelated workspace categories: ${policy.workspace_categories_ignored.join(", ")}`
      : "",
    "",
    "EVIDENCE",
    `Company: ${i.company_name ?? "(unknown)"}`,
    `YC description: ${i.yc_description ?? "(none)"}`,
    `Website description: ${i.website_description ?? "(none)"}`,
    `LinkedIn description: ${i.linkedin_description ?? "(none)"}`,
    `LinkedIn industry (WEAK METADATA — never decisive alone): ${i.linkedin_industry ?? "(none)"}`,
    `Employees: ${i.employee_count ?? "(unknown)"}${i.employee_advisory ? ` (advisory: ${i.employee_advisory})` : ""}`,
    `Location: ${i.geography ?? "(unknown)"}`,
    `Current commercial signal: ${i.commercial_signal ?? "(none)"} (tier ${i.commercial_tier ?? "none"})`,
    "",
    "RULES",
    "- A LinkedIn industry label such as 'Software Development' is NOT a business model.",
    "  Do not reject for the absence of the exact words 'B2B SaaS', and do not accept",
    "  on the label alone.",
    "- Judge who the company SELLS TO from the product and customer evidence.",
    "- If evidence is genuinely missing, say so in unknown_fields and answer 'review'.",
    "- Answer 'fail' only for clear evidence against: consumer-only, or no credible",
    "  use case for an AI GTM/recruiting workforce.",
    "",
    "Return ONLY this JSON:",
    '{"business_model":"b2b_saas|ai_saas|b2b_software|b2b_service|consumer|unknown",',
    '"company_fit":"pass|review|fail","confidence":0.0,',
    '"agentory_use_case":"strong|plausible|weak|none","supporting_evidence":[],',
    '"conflicting_evidence":[],"unknown_fields":[],"reason":""}',
  ].filter(Boolean).join("\n");
}

/** Parse and clamp a classifier response. Anything malformed becomes UNKNOWN. */
export function parseSemanticFit(raw: unknown): SemanticFitAssessment | null {
  const o = typeof raw === "string" ? safeJson(raw) : raw;
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const model = String(r.business_model ?? "unknown") as BusinessModel;
  const fit = String(r.company_fit ?? "review") as CompanyFitVerdict;
  const use = String(r.agentory_use_case ?? "weak") as AgentoryUseCase;
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    business_model: ["b2b_saas", "ai_saas", "b2b_software", "b2b_service", "consumer", "unknown"]
      .includes(model) ? model : "unknown",
    company_fit: ["pass", "review", "fail"].includes(fit) ? fit : "review",
    confidence: Math.max(0, Math.min(1, Number(r.confidence ?? 0) || 0)),
    agentory_use_case: ["strong", "plausible", "weak", "none"].includes(use) ? use : "weak",
    supporting_evidence: arr(r.supporting_evidence),
    conflicting_evidence: arr(r.conflicting_evidence),
    unknown_fields: arr(r.unknown_fields),
    reason: String(r.reason ?? ""),
  };
}

function safeJson(s: string): unknown {
  try {
    const m = s.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

// ------------------------------------------------------- strict parsing ----

/** How much of the classifier's answer survived validation. */
export type ParseStatus = "valid" | "repaired" | "invalid_fallback_review";

export interface ParsedSemanticFit {
  assessment: SemanticFitAssessment;
  parse_status: ParseStatus;
  /** Safe diagnostics only — never the prompt, the key or the raw model text. */
  raw_shape: {
    received_keys: string[];
    repaired_fields: string[];
    rejected_values: string[];
  };
}

const MODELS: readonly string[] =
  ["b2b_saas", "ai_saas", "b2b_software", "b2b_service", "consumer", "unknown"];
const FITS: readonly string[] = ["pass", "review", "fail"];
const USES: readonly string[] = ["strong", "plausible", "weak", "none"];

/** What an unusable answer becomes. Never a pass, never a rejection. */
export const FALLBACK_REVIEW: SemanticFitAssessment = Object.freeze({
  business_model: "unknown",
  company_fit: "review",
  confidence: 0,
  agentory_use_case: "weak",
  supporting_evidence: [],
  conflicting_evidence: [],
  unknown_fields: ["classifier_response_unusable"],
  reason: "the classifier response could not be validated — held for review",
});

/**
 * Parse a live classifier response, FAIL CLOSED.
 *
 * A malformed answer can only ever become REVIEW. Three rules make an
 * unexplained pass impossible, because "pass" is the one verdict that spends
 * money downstream:
 *
 *   * a pass must cite at least one supporting evidence item;
 *   * a pass must carry a credible Agentory use case;
 *   * an unrecognised enum value is a rejection of the FIELD, not of the company.
 *
 * The raw model text is never returned — only which keys arrived and which
 * values were repaired, so a failure is diagnosable without leaking the prompt.
 */
export function parseSemanticFitStrict(raw: unknown): ParsedSemanticFit {
  const o = typeof raw === "string" ? safeJson(raw) : raw;
  if (!o || typeof o !== "object") {
    return {
      assessment: { ...FALLBACK_REVIEW },
      parse_status: "invalid_fallback_review",
      raw_shape: { received_keys: [], repaired_fields: [], rejected_values: ["not_an_object"] },
    };
  }
  const r = o as Record<string, unknown>;
  const received_keys = Object.keys(r);
  const repaired: string[] = [];
  const rejected: string[] = [];

  const enumOr = (v: unknown, allowed: readonly string[], fallback: string, field: string) => {
    const s = String(v ?? "").trim().toLowerCase();
    if (allowed.includes(s)) return s;
    if (v !== undefined) rejected.push(`${field}=${JSON.stringify(v)}`);
    repaired.push(field);
    return fallback;
  };
  const strArr = (v: unknown, field: string) => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (v !== undefined) { repaired.push(field); rejected.push(`${field}=not_an_array`); }
    return [];
  };

  const business_model = enumOr(r.business_model, MODELS, "unknown", "business_model") as BusinessModel;
  let company_fit = enumOr(r.company_fit, FITS, "review", "company_fit") as CompanyFitVerdict;
  const agentory_use_case = enumOr(r.agentory_use_case, USES, "weak", "agentory_use_case") as AgentoryUseCase;

  const rawConf = Number(r.confidence);
  const confidence = Number.isFinite(rawConf) ? Math.max(0, Math.min(1, rawConf)) : 0;
  if (!Number.isFinite(rawConf) || rawConf < 0 || rawConf > 1) repaired.push("confidence");

  const supporting_evidence = strArr(r.supporting_evidence, "supporting_evidence");
  const conflicting_evidence = strArr(r.conflicting_evidence, "conflicting_evidence");
  const unknown_fields = strArr(r.unknown_fields, "unknown_fields");
  const reason = typeof r.reason === "string" ? r.reason : "";

  // AN UNEXPLAINED PASS IS NOT A PASS. These two downgrades are the whole point
  // of a fail-closed parser: `pass` is the verdict that authorises spending.
  if (company_fit === "pass" && supporting_evidence.length === 0) {
    company_fit = "review";
    repaired.push("company_fit:pass_without_supporting_evidence");
  }
  if (company_fit === "pass" && agentory_use_case === "none") {
    company_fit = "review";
    repaired.push("company_fit:pass_without_use_case");
  }

  // A completely unrecognisable payload — nothing we asked for arrived.
  const gotAnything = ["business_model", "company_fit", "confidence", "reason"]
    .some((k) => k in r);
  if (!gotAnything) {
    return {
      assessment: { ...FALLBACK_REVIEW },
      parse_status: "invalid_fallback_review",
      raw_shape: { received_keys, repaired_fields: repaired, rejected_values: rejected },
    };
  }

  return {
    assessment: {
      business_model, company_fit, confidence, agentory_use_case,
      supporting_evidence, conflicting_evidence, unknown_fields, reason,
    },
    parse_status: repaired.length === 0 ? "valid" : "repaired",
    raw_shape: { received_keys, repaired_fields: repaired, rejected_values: rejected },
  };
}

/** The evidence payload handed to the live classifier. Versioned. */
export const SEMANTIC_INPUT_SCHEMA_VERSION = "semantic-fit-input-v1" as const;

/**
 * The compiled mission's directives, as the classifier receives them.
 *
 * Structurally identical to `MissionDirectives` but declared locally so this
 * module keeps its "no upward imports" shape — it is imported BY the mission
 * layer, not the other way round.
 */
export interface ClassifierMissionDirectives {
  hard_constraints?: Record<string, unknown>;
  soft_preferences?: Record<string, unknown>;
  preferred_signals?: string[];
  adjacent_signals?: string[];
  excluded_signals?: string[];
  required_evidence?: string[];
  allowed_broadening?: unknown;
  disallowed_broadening?: string[];
  evaluation_instructions?: string;
}

export function buildClassifierPayload(
  i: SemanticFitInput, policy: AppliedPolicy,
  /**
   * THE SAME MISSION THE PLANNER COMPILED.
   *
   * Optional so the deterministic path is unchanged. Supplied, it is what stops
   * the classifier inventing its own idea of what the query wanted: the query is
   * interpreted ONCE, and every later stage reads that interpretation rather
   * than re-deriving a conflicting one from the same sentence.
   */
  directives?: ClassifierMissionDirectives | null,
): Record<string, unknown> {
  return {
    schema_version: SEMANTIC_INPUT_SCHEMA_VERSION,
    instruction: buildSemanticFitPrompt(i, policy),
    mission: {
      original_user_query: i.original_user_query,
      verticals: policy.mission_verticals,
      geography: policy.geography,
      workspace_context_applied: policy.workspace_context_applied,
      workspace_categories_ignored: policy.workspace_categories_ignored,
      ...(directives
        ? {
          hard_constraints: directives.hard_constraints ?? {},
          soft_preferences: directives.soft_preferences ?? {},
          preferred_signals: directives.preferred_signals ?? [],
          adjacent_signals: directives.adjacent_signals ?? [],
          excluded_signals: directives.excluded_signals ?? [],
          required_evidence: directives.required_evidence ?? [],
          allowed_broadening: directives.allowed_broadening ?? null,
          disallowed_broadening: directives.disallowed_broadening ?? [],
          evaluation_instructions: directives.evaluation_instructions ?? "",
        }
        : {}),
    },
    company: {
      name: i.company_name, linkedin_industry: i.linkedin_industry,
      linkedin_industry_ids: i.linkedin_industry_ids,
      yc_description: i.yc_description,
      website_description: i.website_description,
      linkedin_description: i.linkedin_description,
      employee_count: i.employee_count, employee_advisory: i.employee_advisory,
      geography: i.geography,
    },
    signal: { strongest: i.commercial_signal, tier: i.commercial_tier },
  };
}
