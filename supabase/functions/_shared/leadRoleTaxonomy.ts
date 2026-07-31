// DETERMINISTIC ROLE TAXONOMY + QUERY PACKS for qualified-lead sourcing.
//
// The strategy model may CHOOSE from this taxonomy. It may never invent a title
// family, and it may never widen into generic "operations" work — that widening
// is exactly what produced dental-clinic and warehouse "Operations Manager"
// noise on a Sales/Revenue/GTM Operations mission.
//
// Pure module: no I/O, no model, fully unit-testable.

export interface RoleFamilyDef {
  key: string;
  label: string;
  /** Titles that ARE the family. Always allowed. */
  exact: string[];
  /** Same job, different naming. Allowed at round >= 2. */
  synonyms: string[];
  /** Genuinely adjacent owners of the same work. Allowed at round >= 3. */
  adjacent: string[];
  /** Substrings that DISQUALIFY a title even if it matched above. */
  negatives: string[];
}

const GENERIC_OPS_NEGATIVES = [
  "warehouse",
  "clinical",
  "restaurant",
  "retail store",
  "manufacturing",
  "logistics",
  "supply chain",
  "field operations",
  "people operations",
  "hr operations",
  "security operations",
  "network operations",
  "flight operations",
  "store operations",
  "kitchen",
  "facility",
  "facilities",
  "operations associate",
  "operations assistant",
  "operations intern",
];

export const REVENUE_OPS_FAMILY: RoleFamilyDef = {
  key: "revenue_operations",
  label: "Sales / Revenue / GTM Operations",
  exact: [
    "Sales Operations",
    "Revenue Operations",
    "GTM Operations",
    "Go-To-Market Operations",
    "RevOps",
    "Sales Ops",
  ],
  synonyms: [
    "Sales Operations Manager",
    "Revenue Operations Manager",
    "GTM Operations Manager",
    "Sales Operations Analyst",
    "Revenue Operations Analyst",
    "Head of Revenue Operations",
    "Director of Sales Operations",
    "Director of Revenue Operations",
  ],
  adjacent: [
    "Sales Enablement",
    "Revenue Enablement",
    "Sales Systems",
    "CRM Operations",
    "Deal Desk",
    "Sales Strategy and Operations",
    "Business Operations (GTM)",
  ],
  negatives: GENERIC_OPS_NEGATIVES,
};

export const MARKETING_OPS_FAMILY: RoleFamilyDef = {
  key: "marketing_operations",
  label: "Marketing Operations",
  exact: ["Marketing Operations", "Marketing Ops", "MOps"],
  synonyms: ["Marketing Operations Manager", "Demand Generation Operations", "Marketing Automation Manager"],
  adjacent: ["Lifecycle Marketing Operations", "Campaign Operations"],
  negatives: GENERIC_OPS_NEGATIVES,
};

export const CUSTOMER_OPS_FAMILY: RoleFamilyDef = {
  key: "customer_operations",
  label: "Customer / CS Operations",
  exact: ["Customer Operations", "Customer Success Operations", "CS Ops"],
  synonyms: ["Customer Success Operations Manager", "Support Operations Manager"],
  adjacent: ["Renewals Operations", "Post-Sales Operations"],
  negatives: GENERIC_OPS_NEGATIVES,
};

export const LEAD_ROLE_FAMILIES: RoleFamilyDef[] = [
  REVENUE_OPS_FAMILY,
  MARKETING_OPS_FAMILY,
  CUSTOMER_OPS_FAMILY,
];

export function getRoleFamily(key: string | null | undefined): RoleFamilyDef | null {
  if (!key) return null;
  const k = key.trim().toLowerCase();
  return LEAD_ROLE_FAMILIES.find((f) => f.key === k) ?? null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Infer the family from free-text requested titles. Null when nothing matches. */
export function inferRoleFamily(titles: string[]): RoleFamilyDef | null {
  const hay = titles.map(norm).join(" | ");
  if (!hay) return null;
  let best: { fam: RoleFamilyDef; hits: number } | null = null;
  for (const fam of LEAD_ROLE_FAMILIES) {
    const hits = [...fam.exact, ...fam.synonyms].filter((t) => hay.includes(norm(t))).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { fam, hits };
  }
  return best?.fam ?? null;
}

/** Everything a strategist may legally propose for this family and round depth. */
export function approvedTitleUniverse(fam: RoleFamilyDef, allowAdjacent: boolean): string[] {
  const all = [...fam.exact, ...fam.synonyms, ...(allowAdjacent ? fam.adjacent : [])];
  return [...new Set(all)];
}

/** Is this title inside the family (and not disqualified by a negative)? */
export function titleIsApproved(fam: RoleFamilyDef, title: string, allowAdjacent: boolean): boolean {
  const t = norm(title);
  if (!t) return false;
  if (fam.negatives.some((n) => t.includes(norm(n)))) return false;
  return approvedTitleUniverse(fam, allowAdjacent).some((approved) => {
    const a = norm(approved);
    return t === a || t.includes(a) || a.includes(t);
  });
}

// ------------------------------------------------------------ query packs ---
//
// A pack is ONE coherent search intent. Packs are executed SEPARATELY — never
// merged into a single query string — because a merged query returns whatever
// the provider ranks highest, which is systematically the biggest, least
// early-stage company in the set.

export type QueryPackId =
  | "exact_titles"
  | "family_synonyms"
  | "seniority_variants"
  | "adjacent_owners"
  | "yc_early_stage"
  | "funded_startup"
  | "tooling_signals";

export interface QueryPackDef {
  id: QueryPackId;
  label: string;
  /** Round at which this pack becomes eligible. */
  minRound: number;
  /** Packs that must have been attempted before this one is worth spending on. */
  requiresAdjacent: boolean;
}

export const QUERY_PACKS: QueryPackDef[] = [
  { id: "exact_titles", label: "Exact requested titles", minRound: 1, requiresAdjacent: false },
  { id: "family_synonyms", label: "Same-family synonyms", minRound: 2, requiresAdjacent: false },
  { id: "seniority_variants", label: "Seniority variants (Manager/Head/Director/Lead)", minRound: 2, requiresAdjacent: false },
  { id: "yc_early_stage", label: "YC and early-stage startup employers", minRound: 1, requiresAdjacent: false },
  { id: "funded_startup", label: "Recently funded startup employers", minRound: 2, requiresAdjacent: false },
  { id: "adjacent_owners", label: "Adjacent owners of the same work", minRound: 3, requiresAdjacent: true },
  { id: "tooling_signals", label: "GTM tooling signals (CRM / RevOps stack)", minRound: 3, requiresAdjacent: false },
];

export const QUERY_PACK_IDS: QueryPackId[] = QUERY_PACKS.map((p) => p.id);

export function eligiblePackIds(round: number, allowAdjacent: boolean): QueryPackId[] {
  return QUERY_PACKS
    .filter((p) => round >= p.minRound && (!p.requiresAdjacent || allowAdjacent))
    .map((p) => p.id);
}

const SENIORITY_PREFIXES = ["Manager", "Head of", "Director of", "Lead", "Senior"];

/** Deterministic pack contents. The model may reorder/subset; it cannot invent. */
export function buildQueryPack(
  packId: QueryPackId,
  fam: RoleFamilyDef,
  allowAdjacent: boolean,
): string[] {
  switch (packId) {
    case "exact_titles":
      return [...fam.exact];
    case "family_synonyms":
      return [...fam.synonyms];
    case "seniority_variants":
      return SENIORITY_PREFIXES.flatMap((p) =>
        fam.exact.slice(0, 3).map((t) => (p.endsWith("of") ? `${p} ${t}` : `${p} ${t}`))
      );
    case "adjacent_owners":
      return allowAdjacent ? [...fam.adjacent] : [];
    case "yc_early_stage":
    case "funded_startup":
    case "tooling_signals":
      // Employer-shaped packs reuse the exact titles; the DIFFERENCE is the
      // source/company filter the step applies, not the title list.
      return [...fam.exact];
    default:
      return [];
  }
}

// ---------------------------------------------------------------- sources ---

/** Discovery sources a strategy may schedule. */
export const APPROVED_DISCOVERY_SOURCES = [
  "yc_jobs",
  "linkedin_jobs",
  "indeed_jobs",
  "glassdoor_jobs",
] as const;
export type DiscoverySource = typeof APPROVED_DISCOVERY_SOURCES[number];

/**
 * ATS is a VERIFICATION capability, not a discovery source. Scheduling it as a
 * discovery step burns budget re-finding jobs we already have.
 */
export const NON_DISCOVERY_SOURCES = ["ats_verification", "ats", "greenhouse", "lever", "ashby"];

/** Startup-first default order — YC before the big boards. */
export const DEFAULT_SOURCE_ORDER: DiscoverySource[] = [
  "yc_jobs",
  "linkedin_jobs",
  "indeed_jobs",
  "glassdoor_jobs",
];

export function isDiscoverySource(key: string): key is DiscoverySource {
  return (APPROVED_DISCOVERY_SOURCES as readonly string[]).includes(key.trim().toLowerCase());
}
