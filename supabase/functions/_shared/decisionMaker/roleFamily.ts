// Decision-maker role families. Pure + dependency-free.
//
// Distinct from _shared/roleFamilies.ts, which classifies the role a company is
// HIRING for. This classifies the role of a person we might approach — the buyer.
//
// The previous classifier tested /\bfounder\b/ against the whole title, so
// "Founder Relations Manager", "Former Founder" and "Investor / ex-Founder" all
// classified as founder. Disqualifiers are therefore checked BEFORE any positive
// match, and matches are anchored rather than free-floating substrings.

export type DecisionMakerRoleFamily =
  | "founder"
  | "executive_revenue"
  | "sales_leadership"
  | "growth_leadership"
  | "revenue_operations"
  | "sales_operations"
  | "other";

export interface RoleClassification {
  role_family: DecisionMakerRoleFamily;
  /** Seniority band, used by ranking. */
  seniority: "founder" | "c_level" | "vp" | "head" | "director" | "manager" | "ic" | "unknown";
  matched_on: string | null;
  disqualified_by: string | null;
}

function norm(title: unknown): string {
  return typeof title === "string" ? title.toLowerCase().replace(/\s+/g, " ").trim() : "";
}

/**
 * Phrases that mean "this person is NOT a current operating decision-maker here",
 * even when a senior keyword appears. Checked first — a disqualifier always wins.
 */
const DISQUALIFIERS: Array<{ re: RegExp; label: string }> = [
  // Past-tense / non-operating affiliations.
  { re: /\b(former|ex|previous|retired|outgoing|interim\s+ex)\b[\s\-–—]*\b(founder|ceo|cro|vp|head|director|chief)\b/, label: "former_role" },
  { re: /\bex-(founder|ceo|cro|vp|head|director)\b/, label: "former_role" },
  { re: /\b(investor|angel investor|board member|board observer|advisor|advisory board|mentor|shareholder|limited partner|lp)\b/, label: "non_operating" },
  // Support/adjacent roles that merely CONTAIN a senior keyword.
  { re: /\bfounder\s+(relations|relationship|success|community|experience|support|associate)\b/, label: "founder_adjacent" },
  { re: /\b(assistant|associate|coordinator|intern|internship|apprentice|trainee|student|volunteer)\b/, label: "junior_role" },
  { re: /\b(executive assistant|ea to|chief of staff to the|assistant to the)\b/, label: "support_role" },
  // Service providers who sell TO companies rather than buy.
  { re: /\b(recruit(er|ing)|talent acquisition|headhunter|staffing|sourcer)\b/, label: "recruiter" },
  { re: /\b(consultant|consulting|freelance|freelancer|contractor|agency owner|fractional)\b/, label: "service_provider" },
];

/**
 * Positive matches. Order matters: the most senior/specific family wins, so
 * "Founder & CEO" resolves to founder rather than executive_revenue.
 */
const FAMILY_RULES: Array<{
  family: DecisionMakerRoleFamily;
  seniority: RoleClassification["seniority"];
  re: RegExp;
}> = [
  { family: "founder", seniority: "founder", re: /\b(co[\s-]?founder|founder|founding partner|owner|proprietor)\b/ },
  { family: "founder", seniority: "c_level", re: /\b(ceo|chief executive officer|chief executive|managing director|managing partner)\b/ },
  { family: "executive_revenue", seniority: "c_level", re: /\b(cro|chief revenue officer|chief commercial officer|cco|chief sales officer|chief growth officer)\b/ },
  { family: "revenue_operations", seniority: "unknown", re: /\b(revenue operations|revops|rev ops)\b/ },
  { family: "sales_operations", seniority: "unknown", re: /\b(sales operations|salesops|sales ops)\b/ },
  { family: "sales_leadership", seniority: "unknown", re: /\b(sales|business development|bizdev|commercial)\b/ },
  { family: "growth_leadership", seniority: "unknown", re: /\b(growth|demand generation|demand gen|go[\s-]to[\s-]market|gtm)\b/ },
];

/** Leadership qualifiers that must accompany a functional keyword. */
const LEADERSHIP_RE = /\b(vp|v\.p|vice president|svp|evp|head|director|chief|lead|leader|president|global head|group head)\b/;
const MANAGER_RE = /\b(manager|management)\b/;

function seniorityOf(t: string): RoleClassification["seniority"] {
  if (/\b(co[\s-]?founder|founder|founding partner)\b/.test(t)) return "founder";
  if (/\b(ceo|chief|cro|cco|coo|cfo|cto|c-level)\b/.test(t)) return "c_level";
  if (/\b(svp|evp|vp|v\.p|vice president)\b/.test(t)) return "vp";
  if (/\b(head|global head|group head)\b/.test(t)) return "head";
  if (/\bdirector\b/.test(t)) return "director";
  if (MANAGER_RE.test(t)) return "manager";
  if (/\b(specialist|analyst|executive|representative|rep|associate|engineer|designer)\b/.test(t)) return "ic";
  return "unknown";
}

/**
 * Classify a title into a buyer role family.
 *
 * Functional families (sales/growth/ops) additionally require a leadership
 * qualifier: "VP, Global Sales" is sales_leadership, but "Account Executive"
 * and "Sales Assistant" are other. Founder/C-level titles are senior by
 * construction and need no qualifier.
 */
export function classifyDecisionMakerRole(title: unknown): RoleClassification {
  const t = norm(title);
  if (!t) return { role_family: "other", seniority: "unknown", matched_on: null, disqualified_by: null };

  for (const d of DISQUALIFIERS) {
    if (d.re.test(t)) {
      return { role_family: "other", seniority: seniorityOf(t), matched_on: null, disqualified_by: d.label };
    }
  }

  for (const rule of FAMILY_RULES) {
    if (!rule.re.test(t)) continue;

    const isSeniorByConstruction = rule.family === "founder" || rule.family === "executive_revenue";
    if (!isSeniorByConstruction && !LEADERSHIP_RE.test(t)) {
      // e.g. "Sales Operations Manager" — functional but not leadership.
      continue;
    }

    return {
      role_family: rule.family,
      seniority: rule.seniority === "unknown" ? seniorityOf(t) : rule.seniority,
      matched_on: rule.family,
      disqualified_by: null,
    };
  }

  return { role_family: "other", seniority: seniorityOf(t), matched_on: null, disqualified_by: null };
}

/** Families we are willing to approach. `other` is never a target. */
export const TARGET_ROLE_FAMILIES: readonly DecisionMakerRoleFamily[] = [
  "founder",
  "executive_revenue",
  "sales_leadership",
  "growth_leadership",
  "revenue_operations",
  "sales_operations",
] as const;

export function isTargetRoleFamily(family: DecisionMakerRoleFamily): boolean {
  return TARGET_ROLE_FAMILIES.includes(family);
}
