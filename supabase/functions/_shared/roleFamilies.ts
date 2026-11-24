// Role-family library — single source of truth for hiring/people role families,
// their alias sets, and the negative (profile/equity) titles that must never be
// accepted as a hiring signal. Pure / import-free except the shared support set.
//
// Used by LeadIntentExtractor (classify the requested role family), the
// ActorInputPlanner (role_keywords + exclude_keywords), and the filter/quality
// layers (accept only titles that match the requested family).

import { SUPPORT_ROLE_ALIASES, SUPPORT_ROLE_RE } from "./broaden.ts";

export type RoleFamily =
  | "assistant_founder_support"
  | "sales_operations"
  | "gtm_sales"
  | "marketing_growth"
  | "growth"
  | "engineering"
  | "ops"
  | "finance"
  | "customer_success"
  | "custom"
  | null;

export const ROLE_FAMILY_ALIASES: Record<Exclude<RoleFamily, null | "custom">, string[]> = {
  assistant_founder_support: SUPPORT_ROLE_ALIASES,
  // Sales/Revenue OPERATIONS is its own discipline. It is deliberately NOT part of
  // gtm_sales: a "Sales Operations" request must never be widened into SDR/BDR/AE
  // quota-carrying roles. Aligned with the backend jobFamilyRegistry
  // (sales_operations) so the UI and the sourcing runtime agree.
  sales_operations: [
    "Sales Operations", "Revenue Operations", "GTM Operations",
    "Revenue Strategy and Operations", "Sales Strategy and Operations",
  ],
  // Quota-carrying commercial sales. "First salesperson" / "first sales hire"
  // requests belong HERE — they are a company's first revenue-carrying hire, not
  // a Sales-Operations discipline hire.
  gtm_sales: [
    "SDR", "BDR", "Sales Development Representative", "Account Executive",
    // NOT "Growth" (2026-09-24). A bare "growth" alias here made "hiring a
    // growth role" resolve to THIS family, so an ordinary Account Executive or
    // SDR opening satisfied it and the search asked for 20 sales titles. Growth
    // is its own family below.
    "Founding SDR", "Founding AE", "Head of Sales", "GTM",
    "Go-to-Market", "Business Development", "Demand Generation", "Revenue",
    "Salesperson", "Sales Representative", "Territory Sales Manager",
    // COLLOQUIAL FORMS THE LIST WAS MISSING. A request for "enterprise sellers"
    // or "enterprise AEs" is a quota-carrying commercial hire and belongs to
    // exactly this family — but neither word appeared here, so the flagship
    // mission's role requirement resolved to no family at all and the run was
    // free to qualify a Software Engineer posting against it.
    //
    // Added to the ONE alias table rather than to a second reader, so the role
    // gate, the actor input planner and the title filter all learn them at once.
    "AE", "Enterprise AE", "Seller", "Enterprise Seller", "Enterprise Sales",
  ],
  marketing_growth: [
    "Growth Marketer", "Product Marketing", "Content Marketing", "Demand Gen",
    "Lifecycle Marketing", "Performance Marketing", "Growth Marketing", "Brand Marketing",
    // ── THE PEOPLE WHO DO THOSE JOBS, NOT ONLY THE DISCIPLINES ──────────────
    //
    // Titles are matched by substring, so "Product Marketing" never matched a
    // "Founding Product Marketer" and "Growth Marketing" never matched a
    // "Growth Lead". Lead V2 run 4250f181 asked for companies hiring their
    // first growth marketer and marked Lab0 (Founding Product Marketer) and
    // SafetyKit (Growth Lead) as having no qualifying role. These are the
    // marketer and growth-leadership forms of the same family — nothing outside
    // marketing/growth is added, so SDR/AE and engineering titles stay out.
    "Product Marketer", "Content Marketer", "Lifecycle Marketer", "Performance Marketer",
    "Founding Marketer", "Marketing Generalist", "Demand Generation",
    "Growth Lead", "Head of Growth", "Growth Manager",
    "Head of Marketing", "Marketing Lead",
  ],
  // ── GROWTH: THE FUNCTION, NARROWLY ────────────────────────────────────────
  //
  // "A growth role" names the growth function and nothing wider: it is not a
  // sales request (AE/SDR stay out) and not the whole marketing discipline.
  // Titles here are the growth-function forms NOT already in `marketing_growth`
  // (so "growth marketer" / "head of growth" keep resolving to that family by
  // the reader's longest-alias rule), and "Growth" itself, which as a title
  // keyword covers every "…Growth…" title (`hiringSearchTitles` searches the
  // covering keyword once rather than every longer form).
  growth: [
    "Growth", "VP of Growth", "Director of Growth", "Growth Product Manager",
    "Growth Operations", "Growth Analyst",
  ],
  engineering: [
    "Software Engineer", "Backend Engineer", "Frontend Engineer", "Full Stack Engineer",
    "AI Engineer", "ML Engineer", "Developer", "Staff Engineer",
  ],
  ops: [
    "Operations Manager", "Head of Operations", "RevOps", "Revenue Operations",
    "Business Operations", "Operations Lead",
  ],
  finance: [
    "Finance Manager", "Controller", "FP&A", "Accountant", "Head of Finance", "CFO",
  ],
  customer_success: [
    "Customer Success Manager", "CSM", "Account Manager", "Customer Support",
    "Onboarding Specialist", "Support Engineer",
  ],
};

// Profile / equity titles — valid people targets in people_sourcing, but NEVER a
// hiring signal unless the user explicitly requested those roles as job postings.
export const PROFILE_OR_EQUITY_TITLES = [
  "Founder", "Co-Founder", "CEO", "CTO", "CFO", "COO",
  "Entrepreneur in Residence", "Future Founder", "Advisor", "Investor",
];

const PROFILE_OR_EQUITY_RE =
  /\b(co-?founder|ceo|cto|cfo|coo|chief (?:executive|technology|operating|financial) officer|entrepreneur in residence|\beir\b|future (?:ai )?founder|advisor|investor|board member)\b/i;

// Detection order matters: the most specific family (support) is checked first so
// "Operations Associate" / "Chief of Staff" land in assistant, not gtm/ops.
const FAMILY_DETECT: Array<[Exclude<RoleFamily, null | "custom">, RegExp]> = [
  ["assistant_founder_support", SUPPORT_ROLE_RE],
  // MUST precede gtm_sales: its \bsales\b / revenue alternatives would otherwise
  // capture "Sales Operations" and produce SDR/BDR/AE aliases (the 2026-07-26
  // manual-run corruption).
  ["sales_operations", /\b(sales op(?:s|erations)|revenue op(?:s|erations)|rev ?ops|gtm op(?:s|erations)|revenue strategy (?:and|&) operations|sales strategy (?:and|&) operations)\b/i],
  // "first salesperson" / "founding salesperson" / "first sales hire" — a first
  // revenue-carrying hire. Matched here (AFTER sales_operations, so a "Sales
  // Operations" request can never be captured by it) because `\bsales\b` does not
  // reach inside "salesperson"/"salespeople", which is why these resolved to null.
  ["gtm_sales", /\b(sdrs?|bdrs?|account executives?|\baes?\b|sales development|founding (?:sdr|ae)|head of sales|gtm|go-?to-?market|business development|demand gen(?:eration)?|sales ?(?:person|people)|salesperson|salespeople|\bsales\b|revenue)\b/i],
  ["marketing_growth", /\b(growth marketers?|product marketing|content marketing|lifecycle marketing|performance marketing|growth marketing|brand marketing|\bmarketing\b)\b/i],
  // AFTER marketing_growth, so "growth marketing" / "growth marketer" stay
  // marketing; a bare "growth" names the growth function.
  ["growth", /\bgrowth\b/i],
  ["engineering", /\b(software engineers?|backend engineers?|frontend engineers?|full ?stack|ai engineers?|ml engineers?|\bengineers?\b|developers?|\bswe\b)\b/i],
  ["customer_success", /\b(customer success|\bcsm\b|account managers?|customer support|onboarding specialists?|support engineers?)\b/i],
  ["finance", /\b(fp&a|controllers?|accountants?|finance managers?|head of finance|\bcfo\b)\b/i],
  ["ops", /\b(operations managers?|head of operations|revops|revenue operations|business operations|operations leads?|\boperations\b)\b/i],
];

/** The role family a free-text role/query refers to, or null if none. */
export function classifyRoleFamily(text: string | null | undefined): RoleFamily {
  const t = String(text ?? "");
  if (!t.trim()) return null;
  for (const [fam, re] of FAMILY_DETECT) if (re.test(t)) return fam;
  return null;
}

/** Alias keyword set for a family (for actor role_keywords + query OR-expansion). */
export function roleFamilyAliases(fam: RoleFamily): string[] {
  return fam && fam !== "custom" ? (ROLE_FAMILY_ALIASES[fam] ?? []) : [];
}

/** A title that is a founder/equity/advisor profile, not an operational hire. */
export function isProfileOrEquityTitle(title: string | null | undefined): boolean {
  const t = String(title ?? "");
  // Support roles that happen to contain "founder" (Founder's Office, Founder
  // Associate) are NOT equity titles.
  if (SUPPORT_ROLE_RE.test(t)) return false;
  return PROFILE_OR_EQUITY_RE.test(t);
}

/**
 * Titles that carry a sales word without being a quota-carrying sales hire.
 * Query B (task 255c333f): a PR agency's "Account Executive" (client service),
 * "Global Sales & Operations Planning Leader" (supply/demand planning) and a
 * "Customer Service Sales Representative" all matched gtm_sales by the word
 * "account executive" or "sales". Only TITLE matching reads this; classifying a
 * request's own wording (`classifyRoleFamily`) is unchanged.
 * Query B a9a6791a added "Inside Sales Support Specialist": it supports the
 * sellers and carries no quota.
 */
const NOT_A_SALES_HIRE_RE =
  /\b(?:public relations|pr)\b[^,]*\baccount executives?\b|\baccount executives?\b[^,]*,\s*(?:public relations|pr)\b|\bsales\s*(?:&|and)\s*operations planning\b|\bs&op\b|\bcustomer service\b|\bsales support\b/i;

/** Does a job title belong to the requested role family? */
export function roleMatchesFamily(title: string | null | undefined, fam: RoleFamily): boolean {
  if (!fam || fam === "custom") return false;
  const t = String(title ?? "");
  if (!t.trim()) return false;
  if (fam === "assistant_founder_support") return SUPPORT_ROLE_RE.test(t);
  if (fam === "gtm_sales" && NOT_A_SALES_HIRE_RE.test(t)) return false;
  // Title matches if it classifies to this family, or contains one of its aliases.
  if (classifyRoleFamily(t) === fam) return true;
  const lc = t.toLowerCase();
  return roleFamilyAliases(fam).some((a) => lc.includes(a.toLowerCase()));
}

/**
 * Titles to EXCLUDE from a hiring search for a given family: the profile/equity
 * titles plus "Intern", so a jobs actor doesn't return founder listings or
 * unpaid roles for e.g. an assistant-support search.
 */
export function hiringExcludeTitles(fam: RoleFamily): string[] {
  const base = [...PROFILE_OR_EQUITY_TITLES, "Intern"];
  // For assistant/support, also exclude unrelated senior IC families that the
  // jobs actor tends to over-return.
  if (fam === "assistant_founder_support") base.push("Engineer", "Software Engineer");
  return base;
}

// ── NAMED TITLES: EXACT, NOT BY FAMILY (ATLAS review Stage 2, D1) ───────────
//
// "Hiring Account Executives" was matched by FAMILY (gtm_sales) everywhere a
// posting was judged, so an SDR, BDR or Sales Representative opening proved it
// (offline benchmark A1: precision 0.40). Owner policy (2026-11-03):
//   * a title the user NAMES is matched as that title: its own spellings, plus
//     seniority / segment / level modifiers on the SAME role (Senior, Enterprise,
//     Founding, Mid-Market, Commercial, II, ", Commercial") — never a neighbouring
//     role (SDR, BDR, Sales Representative, Account Manager are not an AE);
//   * a BROAD word ("salespeople", "sales roles") keeps the family;
//   * every OR alternative is kept (any listed title satisfies).
// A role word not registered here keeps the existing family behaviour unchanged.

export const ROLE_TITLES_VERSION = "role-titles-v1" as const;

/**
 * The titles a request may name, each with its own spellings (singular, lower case).
 * Only titles the owner's policy names as SPECIFIC roles are registered; a generic word
 * ("sales representatives", "salespeople") keeps the family. Extended by reviewed change
 * only — the corpus (tests/fixtures/atlas-eval) labels every addition.
 */
export const CANONICAL_TITLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  account_executive: ["account executive", "account exec", "ae"],
  sales_development_representative: ["sales development representative", "sales development rep", "sdr"],
  business_development_representative: ["business development representative", "business development rep", "bdr"],
});

/** Words that qualify the SAME role (seniority, segment, territory, stage) — never change it. */
const TITLE_MODIFIERS = [
  "senior", "sr", "junior", "jr", "associate", "lead", "principal", "staff", "founding", "remote",
  "enterprise", "mid market", "midmarket", "mid-market", "commercial", "smb", "small business", "strategic", "corporate",
  "majors", "major", "named", "global", "regional", "territory", "field", "new business", "growth",
];
const LEVEL_RE = /^(?:i{1,3}|iv|v|[1-5])$/;

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
const singular = (w: string) => w.replace(/(?:ies)$/, "y").replace(/(?<![s])s$/, "");

/** The registered title a request's role word names ("Account Executives" → account_executive), or null. */
export function canonicalTitleOf(term: string | null | undefined): string | null {
  const words = norm(String(term ?? "")).split(" ").filter(Boolean);
  if (!words.length) return null;
  const t = [...words.slice(0, -1), singular(words[words.length - 1])].join(" ");
  for (const [key, names] of Object.entries(CANONICAL_TITLES)) if (names.includes(t)) return key;
  return null;
}

/** Does a posting's title name the registered title — the role itself, with only same-role modifiers? */
export function titleIsCanonical(title: string | null | undefined, key: string): boolean {
  const names = CANONICAL_TITLES[key];
  if (!names) return false;
  const raw = String(title ?? "");
  if (!raw.trim()) return false;
  if (key === "account_executive" && NOT_A_SALES_HIRE_RE.test(raw)) return false;
  // The role is the head of the title: what follows a separator qualifies it ("…, Commercial").
  const head = norm(raw.split(/\s[-–—|/]\s|[,(|–—]/)[0] ?? "");
  let rest = head;
  for (let changed = true; changed;) {
    changed = false;
    for (const m of TITLE_MODIFIERS) {
      if (rest.startsWith(`${m} `)) { rest = rest.slice(m.length + 1); changed = true; }
    }
  }
  const words = rest.split(" ").filter(Boolean);
  while (words.length > 1 && LEVEL_RE.test(words[words.length - 1])) words.pop();
  return names.includes(words.join(" "));
}

export interface RoleRequirement { roleTerms?: readonly string[]; roleFamilies?: readonly string[]; excludedRoleTerms?: readonly string[] }

/** The requested role words that name a registered title. Empty: the request names a family or unregistered role. */
export function namedTitles(r: RoleRequirement): string[] {
  return [...new Set((r.roleTerms ?? []).map(canonicalTitleOf).filter((k): k is string => !!k))];
}

/**
 * Does a posting's title satisfy the role requirement? Applies ONLY when the request
 * names a registered title (`namedTitles` non-empty); callers keep their existing
 * family rule otherwise. Any named title satisfies (OR); an unregistered word in the
 * same request is judged by its own family; an excluded role never satisfies.
 */
export function titleSatisfiesNamedRole(title: string | null | undefined, r: RoleRequirement): boolean {
  if (excludedByRole(title, r)) return false;
  const keys = namedTitles(r);
  if (keys.some((k) => titleIsCanonical(title, k))) return true;
  const others = (r.roleTerms ?? []).filter((t) => !canonicalTitleOf(t));
  return others.some((t) => { const f = classifyRoleFamily(t); return !!f && f !== "custom" && roleMatchesFamily(title, f); });
}

/** An excluded role ("not SDRs") names this posting: by its registered title, or by its words. */
export function excludedByRole(title: string | null | undefined, r: RoleRequirement): boolean {
  const t = ` ${norm(String(title ?? ""))} `;
  return (r.excludedRoleTerms ?? []).some((x) => {
    const k = canonicalTitleOf(x);
    if (k) return titleIsCanonical(title, k);
    const w = norm(x);
    return !!w && (t.includes(` ${w} `) || t.includes(` ${singular(w)} `));
  });
}
