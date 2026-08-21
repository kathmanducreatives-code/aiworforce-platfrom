// WHICH PARTS OF A COMPILED MISSION COST MONEY IF THE MODEL GETS THEM WRONG.
//
// ── WHY THIS PARTITION EXISTS ───────────────────────────────────────────────
//
// The routing question is "can a cheaper model compile this mission". Answering
// it by diffing two missions field-by-field gives a number that is mostly
// noise: two compilations of the same request will always disagree about the
// wording of `evaluation_instructions` and the order of a list read as a set,
// and neither disagreement costs anything.
//
// The user's rule for this work was explicit — optimise for total system
// economics, not model price. So a difference matters in proportion to the PAID
// WORK it changes, and the only honest way to say which differences those are
// is to trace the field into the code and see where it lands.
//
// ── THE THREE GRADES, AND WHERE EACH COMES FROM ─────────────────────────────
//
// DIRECT — reaches `buildDiscoveryPlannerPayload`
//   (`leadDiscoveryStrategy.ts:754`). This function builds the payload the
//   discovery selector sees, and its output decides WHICH PAID ACTORS RUN AND
//   WHAT EACH IS ASKED FOR. The list below is not a judgement; it is the literal
//   set of mission fields that function reads. A difference here changes the
//   purchase itself.
//
// GATING — reaches the qualification context
//   (`missionQualificationContext.ts:192`, which reads `hard_constraints`) or
//   the prequalification predicate. These decide which discovered companies are
//   AUTHORISED for paid investigation. A difference here does not change what is
//   bought first, but it changes HOW MANY per-company purchases follow — which
//   on the audited runs is the larger half of the bill.
//
// INERT — everything else. Prose, provenance, confidence, and fields read only
//   by explanation surfaces. A model that words `evaluation_instructions`
//   differently has not made a cheaper or more expensive run.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
//
// Not a claim that INERT fields do not matter. `evaluation_instructions` is read
// by the evaluator and shapes verdicts; it is inert in the COST sense only, and
// the scorer says so rather than dropping it. The grade answers exactly one
// question: if these two missions differ here, does the run buy anything
// different?
//
// PURE. No network, model or database access.

export const MISSION_IMPACT_VERSION = "mission-impact-v1" as const;

export type ImpactGrade = "direct" | "gating" | "inert";

export interface FieldImpact {
  /** Dotted path into the compiled mission. */
  path: string;
  grade: ImpactGrade;
  /** The call site that makes it so. Checked by a test, not decoration. */
  evidence: string;
  /** What a wrong value buys. */
  consequence: string;
}

/**
 * THE PARTITION.
 *
 * `direct` entries are exactly the mission fields read by
 * `buildDiscoveryPlannerPayload`. If that function changes, this list is wrong,
 * and `missionImpact.test.ts` reads the real source to catch it.
 */
export const MISSION_FIELD_IMPACT: readonly FieldImpact[] = Object.freeze([
  // ── DIRECT: decides what is bought ──────────────────────────────────────
  {
    path: "requested_count",
    grade: "direct",
    evidence: "buildDiscoveryPlannerPayload → request.requested_count, limits.requested_lead_count",
    consequence:
      "sizes the whole run: how many rows are asked for and how many companies " +
      "are authorised for investigation. Compiling 10 as 100 buys ten times the work.",
  },
  {
    path: "company_profile.verticals",
    grade: "direct",
    evidence: "buildDiscoveryPlannerPayload → compiled_mission.verticals",
    consequence: "becomes the actor's search terms; wrong terms buy the wrong pool.",
  },
  {
    path: "company_profile.locations",
    grade: "direct",
    evidence: "buildDiscoveryPlannerPayload → compiled_mission.locations",
    consequence:
      "becomes the actor's region filter. Dropping it was the defect that " +
      "caused identity resolution to search worldwide for US companies.",
  },
  {
    path: "company_profile.stages",
    grade: "direct",
    evidence: "buildDiscoveryPlannerPayload → compiled_mission.stages",
    consequence: "selects the cohort actor; a wrong stage can make a cohort unserveable.",
  },
  {
    path: "company_profile.business_models",
    grade: "direct",
    evidence: "buildDiscoveryPlannerPayload → compiled_mission.business_models",
    consequence: "narrows or widens the discovery query.",
  },
  {
    path: "company_profile.employee_range",
    grade: "direct",
    evidence: "buildDiscoveryPlannerPayload → compiled_mission.employee_range",
    consequence: "becomes min/max employee filters on the actor input.",
  },
  {
    path: "required_signals",
    grade: "direct",
    evidence:
      "buildDiscoveryPlannerPayload → compiled_mission.required_signals AND " +
      "coverMissionSignals(mission) → signal_coverage",
    consequence:
      "decides which actors can serve the request at all. An uncanonical signal " +
      "type matches no actor and no prequalification predicate.",
  },
  {
    path: "directives.source_strategy",
    grade: "direct",
    evidence: "buildDiscoveryPlannerPayload → compiled_mission.source_strategy",
    consequence: "orders the actor families the selector considers first.",
  },
  {
    path: "original_user_query",
    grade: "direct",
    evidence: "buildDiscoveryPlannerPayload → request.original_user_query",
    consequence:
      "carried verbatim to the selector as DATA. Not model-authored — a " +
      "compilation that alters it has rewritten the user's request.",
  },

  // ── GATING: decides how many per-company purchases follow ───────────────
  {
    path: "hard_constraints",
    grade: "gating",
    evidence: "missionQualificationContext.ts:192 → ctx.hard_constraints",
    consequence:
      "every constraint is a filter on the discovered pool. An INVENTED " +
      "constraint silently excludes companies the user never excluded; a " +
      "DROPPED one pays to investigate companies that cannot qualify.",
  },
  {
    path: "directives.required_evidence",
    grade: "gating",
    evidence: "read by the prequalification predicate to decide eligibility",
    consequence: "decides which companies are authorised for paid investigation.",
  },
  {
    path: "directives.disallowed_broadening",
    grade: "gating",
    evidence: "read when a run is short of its quota and considers widening",
    consequence:
      "forbidding a broadening the user never forbade strands a short run with " +
      "no legal way to reach the requested count.",
  },
  {
    path: "target_entity",
    grade: "gating",
    evidence: "leadEntityIntent — selects the company-first or contact-first route",
    consequence: "picks an entirely different execution route and cost profile.",
  },

  // ── INERT: costs nothing to disagree about ──────────────────────────────
  {
    path: "directives.evaluation_instructions",
    grade: "inert",
    evidence: "read by the evaluator prompt only",
    consequence:
      "shapes verdict WORDING and reasoning, and is genuinely load-bearing for " +
      "quality — but two phrasings buy identical provider work.",
  },
  {
    path: "field_provenance",
    grade: "inert",
    evidence: "explanation surfaces and this harness's honesty check",
    consequence: "no execution path reads it to decide anything paid.",
  },
  { path: "confidence", grade: "inert", evidence: "diagnostics", consequence: "recorded, never branched on." },
  { path: "planner_runtime", grade: "inert", evidence: "build stamp", consequence: "not model-authored." },
  { path: "version", grade: "inert", evidence: "schema tag", consequence: "not model-authored." },
  { path: "strategies", grade: "inert", evidence: "diagnostics mirror of required_signals", consequence: "derived, not independently read." },
  { path: "mission_type", grade: "inert", evidence: "diagnostics", consequence: "recorded alongside target_entity, which is the field actually branched on." },
]);

const BY_PATH = new Map(MISSION_FIELD_IMPACT.map((f) => [f.path, f]));

/**
 * Leaf names that are always prose, wherever they appear.
 *
 * `hard_constraints.geographies.reason` is a sentence explaining a constraint,
 * not the constraint. Verified: `missionQualificationContext.ts:228` passes
 * `hard_constraints` through as a whole record and line 481 diagnoses its KEYS;
 * nothing anywhere branches on a constraint's reason string. Grading it as
 * `gating` because its parent is gating made two identical missions look like
 * they differed in something that costs money — which is exactly the noise this
 * partition exists to suppress.
 */
const PROSE_LEAVES = new Set(["reason", "rationale", "note", "explanation", "why"]);

/**
 * Grade one dotted path.
 *
 * Longest-prefix, so `company_profile.locations[0]` grades as its parent. An
 * UNKNOWN path grades `gating`, not `inert`: a field nobody has traced is a
 * field nobody has cleared, and the conservative direction for a cost question
 * is to assume it costs. A new mission field showing up as an ungraded
 * difference should be loud.
 */
export function gradeOf(path: string): ImpactGrade {
  const exact = BY_PATH.get(path);
  if (exact) return exact.grade;
  // A prose leaf is inert no matter whose child it is.
  const leaf = path.split(".").pop() ?? "";
  if (PROSE_LEAVES.has(leaf)) return "inert";
  const parents = [...BY_PATH.keys()]
    .filter((p) => path.startsWith(`${p}.`) || path.startsWith(`${p}[`))
    .sort((a, b) => b.length - a.length);
  return parents.length ? BY_PATH.get(parents[0])!.grade : "gating";
}

/** True when this path is one nobody has traced. Reported, never hidden. */
export function isUngraded(path: string): boolean {
  if (BY_PATH.has(path)) return false;
  if (PROSE_LEAVES.has(path.split(".").pop() ?? "")) return false;
  return ![...BY_PATH.keys()].some((p) => path.startsWith(`${p}.`) || path.startsWith(`${p}[`));
}
