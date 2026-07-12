// Strict role-family taxonomy for Find Leads. Pure / import-free.
//
// Root cause it fixes: an explicit "hiring RevOps / Sales Operations" request was
// silently satisfied by adjacent sales roles (Account Executive, SDR, BDR,
// Founding AE). This module gives every job title ONE canonical role family and
// an exactness verdict, so a role-family search stays a HARD constraint and
// adjacent roles can only appear under an explicitly labelled watch tier.

export type RoleFamily =
  | "revenue_operations"   // Sales/Revenue/GTM/Commercial Operations & Systems
  | "sales_ic"             // AE, SDR, BDR, Sales Rep — quota-carrying / pipeline IC
  | "sales_leadership"     // Head of Sales, VP Sales, CRO
  | "growth_marketing"
  | "recruiting"
  | "engineering"
  | "founder_exec"         // Founder, Co-Founder, CEO, COO
  | "other";

export type RoleExactness = "exact" | "adjacent" | "unrelated";

/** Ordered, most-specific-first. Each family lists the EXACT titles it owns. */
const FAMILY_PATTERNS: Array<{ family: RoleFamily; re: RegExp }> = [
  {
    family: "revenue_operations",
    // Sales/Revenue/GTM/Commercial Operations (+ Systems, Strategy & Operations).
    re: /\b(revenue|sales|gtm|go[- ]to[- ]market|commercial)\s*(operations?|ops)\b|\brev\s*ops\b|\b(revenue|sales)\s+(systems|strategy(?:\s+and\s+operations)?)\b|\boperations?\s*(?:&|and)\s*(?:revenue|sales)\b/i,
  },
  {
    family: "founder_exec",
    re: /\b(co[- ]?founder|founder|chief executive|chief operating|\bceo\b|\bcoo\b|\bcto\b|\bcfo\b|owner|managing director)\b/i,
  },
  {
    family: "sales_leadership",
    re: /\b(head of (sales|revenue)|vp (of )?(sales|revenue)|\bcro\b|chief revenue|director of (sales|revenue))\b/i,
  },
  {
    family: "sales_ic",
    re: /\b(account executive|\bae\b|sales development|\bsdr\b|business development rep\w*|\bbdr\b|sales rep\w*|founding (account executive|ae|sdr)|fractional sdr)\b/i,
  },
  {
    family: "growth_marketing",
    re: /\b(growth (manager|lead|marketer)?|demand gen\w*|lifecycle (marketing|marketer)|marketing (manager|lead)|head of growth)\b/i,
  },
  {
    family: "recruiting",
    re: /\b(recruiter|talent acquisition|technical recruiter|engineering recruiter|sourcer|head of talent)\b/i,
  },
  {
    family: "engineering",
    re: /\b(software engineer|backend|frontend|full[- ]stack|platform engineer|devops|sre|engineering manager|tech lead)\b/i,
  },
];

/** Canonical family for a job title (first match wins; most-specific first). */
export function classifyRoleFamily(title: string | null | undefined): RoleFamily {
  const t = (title ?? "").toString();
  if (!t.trim()) return "other";
  for (const { family, re } of FAMILY_PATTERNS) if (re.test(t)) return family;
  return "other";
}

/** Adjacency: which families count as "adjacent" (watch tier) to a requested one. */
const ADJACENT: Partial<Record<RoleFamily, RoleFamily[]>> = {
  // A RevOps search may WATCH sales IC / leadership hiring as a soft proxy — but
  // never as an exact match. AE/SDR are adjacent, not equivalent.
  revenue_operations: ["sales_ic", "sales_leadership", "growth_marketing"],
  sales_leadership: ["sales_ic", "revenue_operations"],
  sales_ic: ["sales_leadership", "revenue_operations"],
  growth_marketing: ["revenue_operations", "sales_ic"],
};

/**
 * How exactly a candidate title satisfies a REQUESTED role family.
 *   exact     → same family
 *   adjacent  → an explicitly-adjacent family (watch tier only)
 *   unrelated → neither
 */
export function roleExactness(requested: RoleFamily, candidateTitle: string | null | undefined): RoleExactness {
  const cand = classifyRoleFamily(candidateTitle);
  if (cand === requested) return "exact";
  if ((ADJACENT[requested] ?? []).includes(cand)) return "adjacent";
  return "unrelated";
}

/** Map a free-text requested role phrase → a canonical requested family. */
export function requestedRoleFamily(phrase: string | null | undefined): RoleFamily | null {
  const f = classifyRoleFamily(phrase);
  return f === "other" ? null : f;
}

/** True only for an EXACT family match. Adjacent/unrelated are false. */
export function isExactRoleMatch(requested: RoleFamily, candidateTitle: string | null | undefined): boolean {
  return roleExactness(requested, candidateTitle) === "exact";
}
