// EXPLICIT INTENT OUTRANKS A GENERIC DEFAULT.
//
// ── WHAT THIS COST, IN PRODUCTION ──────────────────────────────────────────
//
// Lineage 862e81be, 2026-08-30 acceptance run. The mission asked for "5
// recruiting or staffing companies"; the workspace ICP lists BOTH
// "B2B SaaS (founder-led or small teams)" AND "Recruiting / Talent Acquisition /
// Staffing Agencies". The SaaS half tripped `hasSaasContext`, which folds
// `SOFTWARE_ICP_DISQUALIFIERS` — "staffing", "recruiting agency", "staffing and
// recruiting" — into the exclusion list unconditionally:
//
//     ...(hasSaasContext ? SOFTWARE_ICP_DISQUALIFIERS : [])   // "always fold in"
//
// So the workspace simultaneously TARGETED and EXCLUDED staffing, and Storm4,
// Talentoma and Storm3 were rejected `excluded_industry` before the Company
// Brain ran — the same shape as the `staffing_or_aggregator` defect fixed in
// 55177564, one gate later.
//
// ── THE CONTRACT ───────────────────────────────────────────────────────────
//
//   1. mission verticals          explicit, live, highest
//   2. workspace target industries explicit, standing
//   3. workspace disqualifiers     explicit, standing — NEVER suppressed
//   4. generic defaults            inferred — suppressed by 1 or 2
//
// Only 4 is suppressible. A workspace that explicitly disqualifies staffing
// keeps that rejection even while a mission asks for staffing: a contradiction
// between two EXPLICIT statements fails closed, because silently overriding a
// standing business rule is a worse failure than refusing a run.
//
// ── WHY MISSION VERTICALS AND NOT THE USER'S WORDS ─────────────────────────
//
// Identical reasoning to `missionTargetsIntermediaries`, and it must stay
// identical: "recruiting" is also how a request names the SIGNAL it wants.
// "SaaS companies recruiting engineers" targets no intermediary, and reading the
// raw query here would disable a workspace's industry constraints on the
// strength of a hiring verb.
//
// Pure. No I/O.

/** Words that qualify a category without naming one. */
const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  "and", "the", "for", "with", "our", "its",
  "services", "service", "solutions", "solution", "systems", "system",
  "agency", "agencies", "company", "companies", "firm", "firms", "group",
  "groups", "business", "businesses", "industry", "industries", "sector",
  "products", "product", "platform", "platforms", "technologies", "technology",
  "consulting", "consultancy", "partners", "providers", "provider",
]);

/**
 * Reduce a word to the stem that names its category.
 *
 * "recruiting", "recruitment" and "recruiter" are one category and must compare
 * equal — without this, SOFTWARE_ICP_DISQUALIFIERS' "recruitment agency"
 * survived a mission whose vertical was "recruiting", which is the same defect
 * one spelling later.
 *
 * DELIBERATELY CONSERVATIVE: it strips a short list of inflections and never
 * shortens below four characters, so it cannot collapse two real categories into
 * one. It is not a linguistic stemmer and does not need to be.
 */
function stem(token: string): string {
  for (const suffix of ["ings", "ing", "ments", "ment", "ers", "er", "ies", "es", "s"]) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      const base = token.slice(0, -suffix.length);
      return suffix === "ies" ? `${base}y` : base;
    }
  }
  return token;
}

/** Tokens that actually name a category, stemmed. */
export function categoryTokens(term: unknown): string[] {
  return String(term ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t))
    .map(stem);
}

/**
 * Do these two phrases name the same category?
 *
 * One shared significant token is enough — "recruiting agency" and "recruiting"
 * are the same category, and so are "staffing and recruiting" and "staffing".
 * The generic-token filter is what stops "analytical services" and "financial
 * services" matching on the word they share and nothing else.
 */
export function namesSameCategory(a: unknown, b: unknown): boolean {
  const at = categoryTokens(a);
  if (at.length === 0) return false;
  const bt = new Set(categoryTokens(b));
  return at.some((t) => bt.has(t));
}

export type ExclusionProvenance = "workspace_explicit" | "generic_default";

export interface SuppressedExclusion {
  term: string;
  /** Which explicit statement claimed this category. */
  claimed_by: string;
  source: "mission_verticals" | "workspace_target_industries";
}

export interface IndustryExclusionResolution {
  /** The exclusions that survive, in their original wording. */
  exclusions: string[];
  /** Generic defaults dropped because explicit intent named the category. */
  suppressed: SuppressedExclusion[];
  /** Explicit exclusions are reported so a refusal can cite the standing rule. */
  explicit_kept: string[];
}

/**
 * Decide which industry exclusions actually govern this run.
 *
 * `explicit_exclusions` pass through untouched. `generic_exclusions` are dropped
 * where the mission's verticals or the workspace's own target industries name
 * the same category.
 */
export function resolveIndustryExclusions(i: {
  mission_verticals?: readonly string[] | null;
  workspace_target_industries?: readonly string[] | null;
  workspace_explicit_exclusions?: readonly string[] | null;
  generic_exclusions?: readonly string[] | null;
}): IndustryExclusionResolution {
  const explicit = (i.workspace_explicit_exclusions ?? []).filter(Boolean).map(String);
  const generic = (i.generic_exclusions ?? []).filter(Boolean).map(String);

  const claims: Array<{ value: string; source: SuppressedExclusion["source"] }> = [
    ...(i.mission_verticals ?? []).filter(Boolean)
      .map((v) => ({ value: String(v), source: "mission_verticals" as const })),
    ...(i.workspace_target_industries ?? []).filter(Boolean)
      .map((v) => ({ value: String(v), source: "workspace_target_industries" as const })),
  ];

  const suppressed: SuppressedExclusion[] = [];
  const kept: string[] = [];
  for (const term of generic) {
    const claim = claims.find((c) => namesSameCategory(term, c.value));
    if (claim) {
      suppressed.push({ term, claimed_by: claim.value, source: claim.source });
    } else {
      kept.push(term);
    }
  }

  // EXPLICIT FIRST, and de-duplicated against the generic survivors so a term
  // stated by the workspace is never reported twice.
  const seen = new Set(explicit.map((e) => e.toLowerCase()));
  return {
    exclusions: [...explicit, ...kept.filter((k) => !seen.has(k.toLowerCase()))],
    suppressed,
    explicit_kept: explicit,
  };
}
