// THE SEARCHABLE PART OF AN ICP.
//
// ── DISCOVERY IS NOT QUALIFICATION ─────────────────────────────────────────
//
// An ICP like "Founder-led B2B SaaS recruiting agencies in the US, 10-50
// people" contains two different kinds of constraint, and conflating them cost
// this architecture a week:
//
//   SEARCHABLE   industry, geography, headcount band
//                -> LinkedIn structured filters, narrowing the candidate pool
//
//   QUALIFYING   "founder-led", the exact business model, real ICP fit
//                -> enrichment + Company Brain, deciding on evidence
//
// Discovery only has to return a plausible population. It does not have to
// prove the ICP, and requiring it to was what made
// `apify_linkedin_company_search` look unusable for concept missions.
//
// ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
//
// The repo asserted that a query-less company search "returns nothing at full
// price", and `not_for: "semantic/concept search"` was enforced at ACTOR level,
// so a concept mission had no non-YC discovery source and died as
// `no_valid_step`. A probe settled it: `industryIds:["104"] +
// locations:["United States"] + companySize:["11-50"]`, no `searchQuery`,
// returned 5/5 genuine US staffing agencies out of ~11k matches in 4.5s. The
// structured path works; nothing was translating an ICP into it.
//
// `searchQuery` remains a NAME index — that finding stands, and
// `invalidCompanyNameQueryReason` still guards it. This module never writes
// one.
//
// ── THE RULE THAT MATTERS ──────────────────────────────────────────────────
//
// If an ICP yields no expressible constraint, callers must NOT run an
// unfiltered search. `expressible` is false and the run refuses or picks
// another source. An unfiltered LinkedIn search returns arbitrary companies,
// which is worse than an honest refusal because the junk survives to
// qualification and looks like work.
//
// Pure. No network, no provider, no model call.

import type { LeadMissionV1 } from "./leadMission.ts";
import { LINKEDIN_INDUSTRY_BY_LABEL, LINKEDIN_INDUSTRIES } from "./linkedinIndustryTaxonomy.ts";

/** Verified enum from the Actor's input schema. */
export const LINKEDIN_COMPANY_SIZE_BANDS = [
  "1-10", "11-50", "51-200", "201-500", "501-1000",
  "1001-5000", "5001-10000", "10001+",
] as const;

export interface IcpDiscoveryConstraints {
  industryIds: string[];
  locations: string[];
  companySize: string[];
  /**
   * At least one structured filter was derived, so a search is not unfiltered.
   * Guards against arbitrary results; does NOT mean the concept was expressed.
   */
  expressible: boolean;
  /**
   * The CONCEPT itself is expressible as a filter — i.e. industry ids.
   *
   * The distinction is load-bearing. "AI startups in the United States" yields
   * `locations: ["United States"]` and no industry, so it is `expressible` but
   * the concept "AI startups" is nowhere in the search: the Actor would return
   * arbitrary US companies, which is the junk pool that produced `AI Central`
   * and `Startup San Diego`. Geography and headcount REFINE a population; only
   * an industry filter SELECTS one. Only this flag may lift the name-matcher
   * refusal.
   */
  expresses_concept: boolean;
  /** ICP terms no industry code could be found for — reported, never guessed. */
  unmapped_verticals: string[];
  /**
   * The numeric headcount window the bands were derived from, and who set it.
   *
   * Reported rather than inferred from `companySize`, because the bands are
   * lossy: `max: 150` and `max: 200` both yield `51-200`, and only this says
   * which one the run will actually enforce.
   */
  employee_window: {
    min: number | null;
    max: number | null;
    /**
     * `mission` — the user's stated range only.
     * `company_brain_policy` — the standing workspace policy only.
     * `intersection` — both, narrowed to the part they agree on.
     * `none` — neither supplied one.
     */
    source: "mission" | "company_brain_policy" | "intersection" | "none";
    /**
     * The two ranges do not overlap. The Brain's window is used, because the
     * Brain is what rejects downstream — searching the mission's window would
     * buy a pool the gate is guaranteed to reject in full.
     */
    conflict: boolean;
  };
  /** Which ICP field produced each filter, for the preview and the trace. */
  provenance: Array<{ filter: string; from: string; value: string }>;
}

/**
 * GTM vocabulary that is not a LinkedIn industry label.
 *
 * A bridge, not an exception list: these are the words buyers actually write in
 * an ICP, mapped to the taxonomy's own labels. Each entry names LABELS, and the
 * ids are resolved from the source table — so a relabelled code cannot silently
 * point somewhere wrong, it simply stops resolving and is reported unmapped.
 *
 * Deliberately small and general. Anything not here falls through to token
 * matching, and anything that fails that is reported rather than approximated.
 */
const VOCABULARY_TO_LABELS: ReadonlyArray<readonly [RegExp, readonly string[]]> = Object.freeze([
  [/\b(recruit|staffing|talent acquisition|headhunt)\w*/i,
    ["Staffing and Recruiting", "Human Resources Services"]],
  [/\b(saas|b2b software|software|platform)\b/i,
    ["Software Development", "Technology, Information and Internet"]],
  [/\b(it services|managed services|systems integrat\w*)\b/i,
    ["IT Services and IT Consulting"]],
  [/\b(consultanc\w*|consulting)\b/i,
    ["Business Consulting and Services"]],
  [/\b(marketing|demand gen\w*)\b/i, ["Marketing Services"]],
  // "agency" alone is NOT advertising — a recruiting agency, a staffing agency
  // and a creative agency share the word and share no industry. Matching it
  // put `80 Advertising Services` on a recruiting ICP, which would have
  // searched the wrong market under a correct-looking filter.
  [/\b(advertising|ad agenc\w*|creative agenc\w*)\b/i, ["Advertising Services"]],
  [/\b(fintech|financial services)\b/i, ["Financial Services"]],
  [/\b(health ?care|healthtech)\b/i, ["Hospitals and Health Care"]],
  [/\b(e-?commerce|retail)\b/i, ["Retail"]],
  // "industrial" alone is too coarse to be a filter — the taxonomy has precise
  // codes, and using them is the difference between searching automation
  // integrators and searching all of manufacturing.
  [/\bindustrial automation\b/i,
    ["Automation Machinery Manufacturing", "Industrial Machinery Manufacturing"]],
  [/\brobotics?\b/i, ["Robotics Engineering"]],
  [/\bmanufactur\w*/i, ["Manufacturing"]],
]);

const STOPWORDS = new Set([
  "and", "or", "the", "a", "an", "of", "for", "with", "in", "to", "small",
  "large", "led", "founder", "team", "teams", "companies", "company", "b2b",
  "b2c", "early", "stage", "startup", "startups",
]);

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9+]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Industry ids for one ICP vertical phrase.
 *
 * Three passes, most trustworthy first: the taxonomy's own label, then the GTM
 * vocabulary bridge, then conservative token containment. A phrase that clears
 * none of them returns nothing and is reported — never rounded to the nearest
 * industry, because a wrong filter silently searches the wrong market.
 */
export function industryIdsForVertical(vertical: string): string[] {
  const v = vertical.trim();
  if (!v) return [];

  const exact = LINKEDIN_INDUSTRY_BY_LABEL.get(v.toLowerCase());
  if (exact) return [exact];

  const out = new Set<string>();
  for (const [re, labels] of VOCABULARY_TO_LABELS) {
    if (!re.test(v)) continue;
    for (const label of labels) {
      const id = LINKEDIN_INDUSTRY_BY_LABEL.get(label.toLowerCase());
      if (id) out.add(id);
    }
  }
  if (out.size > 0) return [...out];

  // Containment, and only when the label's every significant token appears in
  // the phrase. "Staffing and Recruiting" matches "recruiting and staffing
  // agencies"; "Software Development" does not match "software" alone, which is
  // the direction that produces junk.
  const vt = new Set(tokens(v));
  if (vt.size === 0) return [];
  for (const [id, label] of LINKEDIN_INDUSTRIES) {
    const lt = tokens(label);
    if (lt.length === 0) continue;
    if (lt.every((t) => vt.has(t))) out.add(id);
  }
  return [...out];
}

/** The Actor's size bands that overlap the mission's employee range. */
export function companySizeBandsFor(
  range: { min?: number | null; max?: number | null } | null | undefined,
): string[] {
  const min = range?.min ?? null;
  const max = range?.max ?? null;
  if (min == null && max == null) return [];
  return LINKEDIN_COMPANY_SIZE_BANDS.filter((band) => {
    const [lo, hi] = band.endsWith("+")
      ? [Number(band.slice(0, -1)), Number.POSITIVE_INFINITY]
      : band.split("-").map(Number);
    if (max != null && lo > max) return false;
    if (min != null && hi < min) return false;
    return true;
  });
}

/**
 * The workspace's standing headcount policy, as the Company Brain compiled it.
 *
 * This is `effectiveCompanyPolicy.constraints`, the SAME object the Brain gate
 * rejects with. Passing it here and rejecting with it there is the point: one
 * number, enforced in one place, spent against in the other.
 */
export interface DiscoveryPolicySize {
  employee_min?: number | null;
  employee_max?: number | null;
}

/**
 * The headcount window a search should actually cover.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Run 783fa163 discovered 29 companies and qualified none. Every filter it
 * sent was correct; what it never sent was the size limit. The workspace's
 * Brain carried `size: { min: 1, max: 150, source: "explicit_numeric" }` with
 * `employee_count` among its HARD constraints — known before the first call —
 * while `company_profile.employee_range` was absent, so the only field this
 * module read was empty and `companySize` went unsent. LinkedIn answered
 * `industryIds:["4","6","104","137"]` with the most prominent of 2,752,712
 * matches: Amazon at 769,019 employees, Google at 307,615, Microsoft at
 * 232,851. Twenty-eight of twenty-nine were then rejected by the very policy
 * that could have excluded them for free, each after two paid calls. The
 * engine's own rejection text said so: "excluded before identity resolution
 * and enrichment, which is two paid calls this row already answered".
 *
 * ── THE MERGE RULE ─────────────────────────────────────────────────────────
 *
 * Both windows are enforced downstream, so a search should cover only where
 * they agree — the intersection, not either alone. A mission asking for 10-50
 * inside a 1-150 policy searches 10-50; the policy alone searches 1-150.
 *
 * When they do NOT overlap, the Brain wins. Not because it outranks the user —
 * it does not — but because it is the window that REJECTS. Searching the
 * mission's window in that case buys a pool the gate discards in full, which
 * is the failure this function exists to prevent. `conflict` records it so the
 * run can say so rather than quietly substituting.
 */
export function resolveEmployeeWindow(
  range: { min?: number | null; max?: number | null } | null | undefined,
  policy: DiscoveryPolicySize | null | undefined,
): IcpDiscoveryConstraints["employee_window"] {
  const mMin = range?.min ?? null, mMax = range?.max ?? null;
  const pMin = policy?.employee_min ?? null, pMax = policy?.employee_max ?? null;
  const hasMission = mMin != null || mMax != null;
  const hasPolicy = pMin != null || pMax != null;

  if (!hasMission && !hasPolicy) {
    return { min: null, max: null, source: "none", conflict: false };
  }
  if (!hasPolicy) return { min: mMin, max: mMax, source: "mission", conflict: false };
  if (!hasMission) {
    return { min: pMin, max: pMax, source: "company_brain_policy", conflict: false };
  }

  const min = mMin == null ? pMin : pMin == null ? mMin : Math.max(mMin, pMin);
  const max = mMax == null ? pMax : pMax == null ? mMax : Math.min(mMax, pMax);
  // An inverted window is not a narrow search, it is an impossible one.
  if (min != null && max != null && min > max) {
    return { min: pMin, max: pMax, source: "company_brain_policy", conflict: true };
  }
  return { min, max, source: "intersection", conflict: false };
}

/**
 * Translate a mission's ICP into LinkedIn discovery filters.
 *
 * Geography is read from `company_profile.locations` WITHOUT requiring
 * `geography_is_hard`. That flag governs whether a location may REJECT a
 * company — a qualification question. Narrowing a search is not rejection, and
 * conflating the two is why a mission with a stated geography still searched
 * everywhere.
 *
 * `policy` is the workspace's compiled Company Brain constraints. Optional, and
 * omitting it reproduces this function's behaviour exactly as it was before the
 * parameter existed — so a caller with no policy in scope is unchanged, not
 * silently degraded. Supplying it is what stops a run paying to discover
 * companies its own gate will reject; see `resolveEmployeeWindow`.
 */
export function icpDiscoveryConstraints(
  mission: LeadMissionV1,
  policy?: DiscoveryPolicySize | null,
): IcpDiscoveryConstraints {
  const profile = mission.company_profile ?? ({} as LeadMissionV1["company_profile"]);
  const provenance: IcpDiscoveryConstraints["provenance"] = [];
  const industryIds = new Set<string>();
  const unmapped: string[] = [];

  const verticals = [
    ...(profile.verticals ?? []),
    ...(profile.business_models ?? []),
  ].map(String).filter((s) => s.trim());

  for (const v of verticals) {
    const ids = industryIdsForVertical(v);
    if (ids.length === 0) { unmapped.push(v); continue; }
    for (const id of ids) {
      industryIds.add(id);
      provenance.push({ filter: "industryIds", from: v, value: id });
    }
  }

  const locations = [...new Set((profile.locations ?? []).map(String)
    .map((l) => l.trim()).filter(Boolean))].slice(0, 20);
  for (const l of locations) provenance.push({ filter: "locations", from: "company_profile.locations", value: l });

  // THE BRAIN'S WINDOW IS PART OF THE SEARCH, not only part of the verdict.
  const employeeWindow = resolveEmployeeWindow(profile.employee_range, policy);
  const companySize = companySizeBandsFor(employeeWindow);
  // ── NAMED FOR WHAT IT ACTUALLY CONSTRAINS ────────────────────────────────
  //
  // `companySize` filters LinkedIn's SELF-REPORTED band (`employeeCountRange`),
  // not the exact figure the Company Brain gates on (`employeeCount`). Run
  // fafd9912 proved they are different quantities, not noisy versions of one:
  // every row it returned was inside the requested bands, and
  //
  //     Freelance | Self-Employed   band 2-10    employeeCount 414,811
  //     Confidential Careers        band 2-10    employeeCount  29,946
  //     Stealth Startup             band 11-50   employeeCount  37,306
  //
  // So the provenance says `→employeeCountRange`. Discovery NARROWS on the
  // advisory band because that is the only size lever a search has; nothing
  // downstream may read that as a headcount, and nothing does —
  // `prequalifyGenericCompany` gates on `employee_count` via `mayGateOn` and
  // refuses the advisory band by name.
  const sizeFrom = employeeWindow.source === "mission"
    ? "company_profile.employee_range→employeeCountRange"
    : employeeWindow.source === "company_brain_policy"
    ? "company_brain_policy.size→employeeCountRange"
    : "company_profile.employee_range + company_brain_policy.size→employeeCountRange";
  for (const b of companySize) {
    provenance.push({ filter: "companySize", from: sizeFrom, value: b });
  }

  // The Actor caps industryIds at 20.
  const ids = [...industryIds].slice(0, 20);
  return {
    industryIds: ids,
    locations,
    companySize,
    expressible: ids.length > 0 || locations.length > 0 || companySize.length > 0,
    expresses_concept: ids.length > 0,
    unmapped_verticals: unmapped,
    employee_window: employeeWindow,
    provenance,
  };
}
