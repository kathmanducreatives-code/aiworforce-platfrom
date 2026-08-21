// SCORING A COMPILED MISSION WITHOUT A GOLDEN ANSWER.
//
// ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
//
// The obvious eval is "compare the cheap model's mission to gpt-4.1's". That
// makes gpt-4.1 the definition of correct, which it is not — it is the
// incumbent, and the audit found it dropping `locations` and needing a repair
// call on its discovery proposal. An eval that scores agreement with the
// incumbent cannot ever discover that the incumbent is wrong, and will reject a
// cheaper model for the disagreements that were improvements.
//
// The alternative is a hand-written golden mission per case. That makes MY
// opinion the definition of correct, which is worse, because it looks objective.
//
// ── WHAT IS ACTUALLY CHECKABLE ──────────────────────────────────────────────
//
// A compiled mission has properties that follow from the REQUEST TEXT, and hold
// for any correct compilation no matter who wrote it. "The user said 10, so
// `requested_count` is 10" needs no golden answer — it is a relation between
// input and output. So does "the mission must not claim the user explicitly
// asked for something the request does not mention".
//
// These are the checks below. Every one names the request text it is derived
// from, and every one is a property a wrong answer VIOLATES rather than merely
// differs from. That is the difference between an eval and a similarity score.
//
// ── THE ONE THAT MATTERS MOST ───────────────────────────────────────────────
//
// `field_provenance` is the mission's own claim about which fields came from the
// user and which the model inferred. It is checkable by string containment
// against the request. A model that marks its own inference as
// `explicit_user_request` is not merely wrong about one field — it has produced
// a mission whose audit trail lies, and every downstream explanation inherits
// the lie. A cheap model that fails only this check is disqualified regardless
// of what it saves.
//
// PURE. No network, model or database access.

import { gradeOf, type ImpactGrade } from "./missionImpact.ts";

export const MISSION_INVARIANTS_VERSION = "mission-invariants-v1" as const;

export type Severity = "fatal" | "major" | "minor";

export interface InvariantViolation {
  check: string;
  severity: Severity;
  /** Cost grade of the field this violation lands on. */
  grade: ImpactGrade;
  message: string;
}

export interface InvariantReport {
  version: typeof MISSION_INVARIANTS_VERSION;
  checks_run: number;
  violations: InvariantViolation[];
  /**
   * Provenance claims this harness cannot test, because the field's value is a
   * controlled enum rather than the user's words. Reported so their absence
   * from `violations` is not misread as having been checked and cleared.
   */
  provenance_paths_not_testable: string[];
  /** True when nothing fatal or major fired. Minor issues do not fail a model. */
  passed: boolean;
}

type Mission = Record<string, unknown>;

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const low = (s: string) => s.toLowerCase();

/**
 * The count the request literally asks for, or null if it names none.
 *
 * Deliberately narrow: the first bare integer, or a number word. A request that
 * says "find 10 ... over 50 employees" would trap a greedy reader, so the
 * pattern requires the number to be followed by a noun phrase rather than a
 * comparator, and anything ambiguous returns null and skips the check rather
 * than inventing a expectation.
 */
export function requestedCountIn(request: string): number | null {
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  const m = low(request).match(
    /\b(?:find|get|give me|source|need|want)\s+(?:me\s+)?(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\b/,
  );
  if (!m) return null;
  const raw = m[1];
  return /^\d+$/.test(raw) ? Number(raw) : words[raw] ?? null;
}

/**
 * Does the request text support this value being called explicit?
 *
 * Containment, not semantics. "United States" is supported by "the US" only if
 * one of its recognised surface forms appears. This is deliberately generous —
 * it is trying to catch a model asserting `explicit_user_request` for something
 * with NO textual basis at all, not to adjudicate paraphrase.
 */
function textuallySupported(request: string, value: unknown): boolean {
  const r = low(request);
  const surfaces: Record<string, string[]> = {
    "united states": ["united states", "the us", " us ", "u.s.", "usa", "america"],
    "united states of america": ["united states", "the us", " us ", "u.s.", "usa", "america"],
    "startup": ["startup", "start-up", "early stage", "seed"],
    "ai": ["ai", "artificial intelligence", "machine learning", " ml "],
  };
  const check = (s: string): boolean => {
    const k = low(String(s)).trim();
    if (!k) return true;
    if ((surfaces[k] ?? []).some((f) => ` ${r} `.includes(f))) return true;
    return r.includes(k);
  };
  // Flatten to the SCALAR LEAVES the model actually wrote.
  //
  // The first version stringified whole elements, so `required_signals` —
  // `[{ type: "hiring" }]` — was tested by asking whether the request contains
  // "[object Object]". It does not, so a signal the user had literally named in
  // the words "currently hiring" was reported as an unsupported provenance
  // claim. The bug flagged the incumbent for its one honest label.
  const leaves = (v: unknown): string[] => {
    if (v == null || typeof v === "boolean") return [];
    if (Array.isArray(v)) return v.flatMap(leaves);
    if (typeof v === "object") return Object.values(v as Record<string, unknown>).flatMap(leaves);
    return [String(v)];
  };
  const ls = leaves(value);
  return ls.length === 0 || ls.some(check);
}

/**
 * Paths whose value is a CONTROLLED ENUM rather than the user's own words.
 *
 * Containment is a fair test only where the value is drawn from the user's
 * vocabulary. `target_entity` is one of `company | contact | person` and
 * `requested_output` is likewise a fixed token — a request saying "find 10 AI
 * startups" supports `target_entity: "company"` perfectly well, and no string
 * search over the request will ever show it, because the model is not quoting
 * the user, it is classifying them.
 *
 * Testing those with containment does not find dishonest provenance; it finds
 * the enum. So they are excluded, and the exclusion is reported rather than
 * silent.
 */
const ENUM_VALUED_PATHS = new Set([
  "target_entity", "requested_output", "mission_type",
  "directives.execution_preference",
]);

/** Read a dotted path out of a mission. */
function at(m: Mission, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    m,
  );
}

/**
 * Score one compiled mission against the request it was compiled from.
 *
 * No golden mission, no incumbent, no model. Every violation is a property the
 * output breaks with respect to its own input.
 */
export function checkMissionInvariants(
  request: string, mission: Mission,
): InvariantReport {
  const v: InvariantViolation[] = [];
  const push = (check: string, severity: Severity, path: string, message: string) =>
    v.push({ check, severity, grade: gradeOf(path), message });
  let checks = 0;

  // ── 1. THE COUNT IS THE USER'S, NOT THE MODEL'S ───────────────────────
  checks++;
  const want = requestedCountIn(request);
  if (want != null) {
    const got = at(mission, "requested_count");
    if (Number(got) !== want) {
      push(
        "requested_count_matches_request", "fatal", "requested_count",
        `the request asks for ${want}; the mission compiled ${JSON.stringify(got)}. ` +
        "This sizes every downstream purchase.",
      );
    }
  }

  // ── 2. THE USER'S WORDS ARE CARRIED, NOT REWRITTEN ────────────────────
  checks++;
  const carried = at(mission, "original_user_query");
  if (carried != null && String(carried).trim() !== request.trim()) {
    push(
      "user_query_carried_verbatim", "fatal", "original_user_query",
      "the mission's `original_user_query` is not the request it was compiled " +
      `from. Compiled: ${JSON.stringify(String(carried).slice(0, 80))}`,
    );
  }

  // ── 3. THE PROVENANCE CLAIM IS HONEST ─────────────────────────────────
  //
  // The check the whole harness exists for. A mission that marks an inference
  // as explicit has produced an audit trail that lies.
  checks++;
  const skippedEnumPaths: string[] = [];
  for (const [path, source] of Object.entries(rec(at(mission, "field_provenance")))) {
    if (String(source) !== "explicit_user_request") continue;
    if (ENUM_VALUED_PATHS.has(path)) {
      skippedEnumPaths.push(path);
      continue;
    }
    const value = at(mission, path);
    if (value === undefined) continue;
    if (!textuallySupported(request, value)) {
      push(
        "provenance_claim_is_honest", "major", path,
        `\`${path}\` is marked \`explicit_user_request\` but its value ` +
        `${JSON.stringify(value)} has no textual basis in the request. ` +
        "An inference labelled explicit makes every downstream explanation wrong.",
      );
    }
  }

  // ── 4. NO CONSTRAINT THE USER DID NOT STATE ───────────────────────────
  //
  // Over-constraining is the failure mode that looks like caution and costs
  // recall. Every hard constraint must be traceable to the request text.
  checks++;
  for (const [key, body] of Object.entries(rec(at(mission, "hard_constraints")))) {
    const value = rec(body).value;
    if (!textuallySupported(request, value)) {
      push(
        "no_invented_hard_constraint", "major", "hard_constraints",
        `hard constraint \`${key}\` = ${JSON.stringify(value)} has no basis in ` +
        "the request. It will silently exclude companies the user never excluded.",
      );
    }
  }

  // ── 5. SIGNALS ARE IN THE CANONICAL VOCABULARY ────────────────────────
  //
  // Free-text signal types were compared with `===` in six places. A signal
  // outside the vocabulary matches no actor and no predicate — it is not a
  // stricter mission, it is an inert one.
  checks++;
  const VOCAB = new Set([
    "hiring", "funding", "expansion", "leadership_change", "technology", "product_launch",
  ]);
  for (const s of arr(at(mission, "required_signals"))) {
    const t = String(rec(s).type ?? "");
    if (t && !VOCAB.has(t)) {
      push(
        "signal_type_is_canonical", "fatal", "required_signals",
        `required signal \`${t}\` is outside the canonical vocabulary. ` +
        "It will match no actor and no prequalification predicate.",
      );
    }
  }

  // ── 6. A REQUEST THAT NAMES A SIGNAL PRODUCES ONE ─────────────────────
  checks++;
  if (/\bhiring\b|\brecruit/i.test(request)) {
    const has = arr(at(mission, "required_signals"))
      .some((s) => String(rec(s).type ?? "") === "hiring");
    if (!has) {
      push(
        "stated_signal_is_required", "fatal", "required_signals",
        "the request names hiring but the mission requires no hiring signal; " +
        "the run would qualify companies on no evidence of the thing asked for.",
      );
    }
  }

  // ── 7. THE ENTITY THE USER ASKED ABOUT ────────────────────────────────
  checks++;
  const entity = String(at(mission, "target_entity") ?? "");
  if (entity && !["company", "contact", "person"].includes(entity)) {
    push(
      "target_entity_is_known", "fatal", "target_entity",
      `\`target_entity\` = ${JSON.stringify(entity)} selects no known route.`,
    );
  }

  // ── 8. A BROADENING BAN NEEDS A CONSTRAINT TO PROTECT ─────────────────
  //
  // An INTERNAL consistency check, not a containment one. The first version
  // asked whether the request text contains the words "company types", which it
  // never will, so it flagged the incumbent for forbidding exactly the
  // broadenings it should forbid — the request DOES say "AI startups in the US
  // currently hiring", and widening any of those three would break it.
  //
  // The real failure is a ban with nothing behind it: forbidding the run to
  // widen a dimension the mission holds no constraint on. That costs a short run
  // a legal route to its quota and protects nothing, and it is visible from the
  // mission alone.
  checks++;
  const DIMENSION_EVIDENCE: Record<string, string[]> = {
    geographies: ["company_profile.locations"],
    company_types: ["company_profile.verticals", "company_profile.stages", "company_profile.business_models"],
    employee_range: ["company_profile.employee_range"],
    role_families: ["decision_makers.roles"],
  };
  const hardKeys = new Set(Object.keys(rec(at(mission, "hard_constraints"))));
  const signalTypes = new Set(arr(at(mission, "required_signals")).map((x) => String(rec(x).type ?? "")));

  for (const d of arr(at(mission, "directives.disallowed_broadening")).map(String)) {
    // A signal name is constrained by requiring that signal.
    if (signalTypes.has(d)) continue;
    if (hardKeys.has(d)) continue;
    const backed = (DIMENSION_EVIDENCE[d] ?? []).some((path) => {
      const val = at(mission, path);
      if (Array.isArray(val)) return val.length > 0;
      return val != null && Object.keys(rec(val)).some((k) => rec(val)[k] != null);
    });
    if (!backed) {
      push(
        "broadening_ban_has_a_constraint", "minor", "directives.disallowed_broadening",
        `broadening \`${d}\` is forbidden but the mission holds no constraint on ` +
        "that dimension, so the ban protects nothing and costs a short run one " +
        "legal route to the requested count.",
      );
    }
  }

  return {
    version: MISSION_INVARIANTS_VERSION,
    checks_run: checks,
    violations: v,
    // Named, so a reader can see which claims went untested rather than
    // reading their absence as a pass.
    provenance_paths_not_testable: skippedEnumPaths,
    passed: !v.some((x) => x.severity === "fatal" || x.severity === "major"),
  };
}
