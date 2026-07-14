// Hiring role-family classifier + company-exclusion gate. PURE / Deno-testable.
// This is the root-cause fix for "63 hiring signals, mostly irrelevant, 1 verified":
// it decides whether an exact role is a priority buyer signal (exact), a related
// but lower-value role (adjacent), or noise (unrelated) — grounded in the
// workspace's Radar Intelligence Profile, not hardcoded company names.

import type { RadarIntelligenceProfile } from "./radarIntelligenceProfile.ts";

export type RoleFamily = "exact" | "adjacent" | "unrelated";

export interface RoleClassification {
  family: RoleFamily;
  matched_term: string | null;
  reason: string;
}

// Non-GTM role markers that must never count as a buyer signal, even if the word
// "sales" or "operations" appears nearby (e.g. "Commercial Analytics", "Plant Ops").
const HARD_NON_GTM = [
  "intern", "analytics", "data analyst", "financial", "finance", "accountant", "controller",
  "plant", "facilities", "warehouse", "field operations", "manufacturing", "logistics",
  "software engineer", "backend", "frontend", "devops engineer", "qa engineer", "recruiter",
  "customer support", "technical support", "hr ", "human resources", "legal", "product manager",
];

function lc(s: string): string { return (s ?? "").toLowerCase(); }
function anyIn(hay: string, terms: string[]): string | null {
  for (const t of terms) { const n = lc(t); if (n.length >= 2 && hay.includes(n)) return t; }
  return null;
}

/** Classify a job role title against the workspace's buyer profile. */
export function classifyRoleFamily(roleTitle: string, profile: RadarIntelligenceProfile): RoleClassification {
  const role = lc(roleTitle).trim();
  if (!role) return { family: "unrelated", matched_term: null, reason: "No role title." };

  // Explicit brain negatives win first.
  const neg = anyIn(role, profile.buyers.negative_role_terms);
  if (neg) return { family: "unrelated", matched_term: neg, reason: `Role matches a Company Brain negative title ("${neg}").` };

  // Hard non-GTM markers — but a marker like "product" shouldn't kill an exact
  // leadership match, so only reject when there's no exact hit.
  const exact = anyIn(role, profile.buyers.exact_role_terms);
  const nonGtm = anyIn(role, HARD_NON_GTM);
  if (nonGtm && !exact) {
    return { family: "unrelated", matched_term: nonGtm, reason: `Non-GTM role ("${nonGtm}") — not a buyer signal for this ICP.` };
  }

  if (exact) return { family: "exact", matched_term: exact, reason: `Priority buyer role — matches "${exact}".` };

  const adj = anyIn(role, profile.buyers.adjacent_role_terms);
  if (adj) return { family: "adjacent", matched_term: adj, reason: `Adjacent GTM role ("${adj}") — relevant but not a priority buyer; watch.` };

  return { family: "unrelated", matched_term: null, reason: "Role is unrelated to this workspace's buyer profile." };
}

export interface CompanyExclusion {
  excluded: boolean;
  reason: string | null;
  matched_term: string | null;
}

/** Company-level exclusion from the brain's disqualifiers (agencies, nonprofits,
 * excluded industries/keywords, oversized). Generic — reads the profile only. */
export function classifyCompanyExclusion(
  company: { text?: string; domain?: string; employee_count?: number | null },
  profile: RadarIntelligenceProfile,
): CompanyExclusion {
  const text = lc([company.text].filter(Boolean).join(" "));
  const t = profile.target_company;

  const exType = anyIn(text, t.excluded_company_types);
  if (exType) return { excluded: true, reason: `Excluded company type ("${exType}").`, matched_term: exType };
  const exInd = anyIn(text, t.excluded_industries);
  if (exInd) return { excluded: true, reason: `Excluded industry ("${exInd}").`, matched_term: exInd };
  const exKw = anyIn(text, t.excluded_keywords);
  if (exKw) return { excluded: true, reason: `Excluded keyword ("${exKw}").`, matched_term: exKw };
  if (company.domain) {
    const exDom = anyIn(lc(company.domain), t.excluded_domains);
    if (exDom) return { excluded: true, reason: `Excluded domain ("${exDom}").`, matched_term: exDom };
  }
  // Oversized: only when a max is set and the count clearly exceeds it (2x margin).
  const emp = company.employee_count;
  if (emp != null && t.company_size.max != null && emp > t.company_size.max * 2) {
    return { excluded: true, reason: `Company size ${emp} far exceeds ICP max ${t.company_size.max}.`, matched_term: `size:${emp}` };
  }
  return { excluded: false, reason: null, matched_term: null };
}

export interface HiringSignalView {
  headline: string;       // "{Company} is hiring a {Role}."
  why_it_matters: string; // "This matters because…"
  role_family: RoleFamily;
  excluded: boolean;
}

/** Build the honest hiring-card sentences. Role is never buried in company text. */
export function buildHiringSignalView(args: {
  company: string | null; role: string | null; profile: RadarIntelligenceProfile;
  roleClass: RoleClassification; exclusion: CompanyExclusion;
}): HiringSignalView {
  const company = args.company?.trim() || "A company";
  const role = args.role?.trim() || "a role";
  const headline = `${company} is hiring a ${role}.`;
  let why: string;
  if (args.exclusion.excluded) why = `This is outside your ICP — ${args.exclusion.reason}`;
  else if (args.roleClass.family === "exact") why = `This matters because ${role} is a priority buyer role for your ICP (${args.roleClass.matched_term}).`;
  else if (args.roleClass.family === "adjacent") why = `This is an adjacent GTM role — worth watching, but not a priority buyer.`;
  else why = `This role is unrelated to your buyer profile, so it is unlikely to be a useful signal.`;
  return { headline, why_it_matters: why, role_family: args.roleClass.family, excluded: args.exclusion.excluded };
}
