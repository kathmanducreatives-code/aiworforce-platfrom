// FREE PREQUALIFICATION — decide who is worth paying for, before paying.
//
// TEST task c8a6e53d-c227-4405-9fcc-e0791b03a4ec discovered 25 YC companies for
// one memo23 run, then issued ONE paid Actor start per company to resolve a
// LinkedIn identity — 16 runs, every one returning zero rows, until the edge
// function hit its wall clock and the plan hung in Running forever.
//
// Two things were wrong. The lookup used an ENRICHMENT actor as a search index
// (`harvestapi/linkedin-company` with `searches: ["Scale AI"]` returns nothing).
// And it paid to identify companies nobody had yet decided were worth
// identifying.
//
// memo23 already returns everything needed to make that decision for free:
// every company's FULL `openJobs` array, team size, batch, industries and
// one-liner. This module reads that payload and ranks companies by COMMERCIAL
// EXPANSION strength, so the paid LinkedIn stage only ever runs for a bounded
// shortlist.
//
// WHY TIERS RATHER THAN A KEYWORD MATCH. "Senior Software Engineer" and "Head of
// Sales" are both hiring. Only one of them means a company is building a
// go-to-market motion, which is what this mission is actually looking for. A
// flat keyword list cannot express that, and the previous code did not try —
// it displayed `openJobs[0]`, which for a YC startup is almost always an
// engineer.
//
// PURE. No network, provider, model or database access.

export const PREQUALIFICATION_VERSION = "commercial-prequalification-v1" as const;

export type SignalTier = "A" | "B" | "C";

/** Strongest commercial-expansion evidence. A founding/leadership GTM hire. */
const TIER_A: readonly string[] = [
  "sales operations", "revenue operations", "gtm operations",
  "revenue strategy and operations", "sales strategy and operations",
  "sales strategy & operations", "revenue strategy & operations",
  "founding account executive", "founding sdr", "founding bdr",
  "head of sales", "vp of sales", "vp sales", "gtm lead", "gtm engineer",
  "deal desk", "sales enablement operations",
];

/** Real commercial hiring, but not necessarily a new GTM motion. */
const TIER_B: readonly string[] = [
  "account executive", "sdr", "bdr", "sales development representative",
  "business development representative", "sales director", "director of sales",
  "head of growth", "growth lead", "demand generation", "marketing operations",
  "growth marketing", "partnerships", "sales enablement", "enterprise sales",
];

/** Ambiguous. Commercial only alongside a second supporting signal. */
const TIER_C: readonly string[] = [
  "business operations", "strategy and operations", "strategy & operations",
  "customer operations", "head of operations", "chief of staff",
  "customer success",
];

/** Never commercial evidence on their own. */
const TECHNICAL: readonly string[] = [
  "software engineer", "full stack", "fullstack", "backend", "back-end",
  "frontend", "front-end", "ml engineer", "machine learning", "infrastructure",
  "product engineer", "designer", "devops", "platform engineer", "data engineer",
  "computer vision", "deep learning", "security engineer", "qa engineer",
  "founding engineer", "forward deployed engineer",
];

/**
 * Directory and platform artifacts that are not prospects.
 *
 * Y Combinator's own page appeared as a "company" on an earlier run and was
 * counted as a qualified lead.
 */
const ARTIFACT_DOMAINS: readonly string[] = [
  "ycombinator.com", "workatastartup.com", "news.ycombinator.com",
];

const lc = (v: unknown) => typeof v === "string" ? v.trim().toLowerCase() : "";

/** Strip protocol, `www.`, path and trailing dot. The canonical internal key. */
export function normalizeDomain(website: unknown): string | null {
  const raw = lc(website).replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "").replace(/\.$/, "");
  return raw && raw.includes(".") ? raw : null;
}

export function normalizeCompanyName(name: unknown): string {
  return lc(name).replace(/[.,]/g, "").replace(/\s+(inc|llc|ltd|corp|co)$/i, "").replace(/\s+/g, " ").trim();
}

/** Which tier a single job title belongs to, if any. */
export function classifyJobTitle(title: unknown): SignalTier | "technical" | "other" {
  const t = lc(title);
  if (!t) return "other";
  // Commercial tiers are checked BEFORE technical, so "Sales Engineer" is not
  // discarded as engineering and "Founding Account Executive" is not discarded
  // for containing "founding".
  if (TIER_A.some((k) => t.includes(k))) return "A";
  if (TIER_B.some((k) => t.includes(k))) return "B";
  if (TIER_C.some((k) => t.includes(k))) return "C";
  if (TECHNICAL.some((k) => t.includes(k))) return "technical";
  return "other";
}

export interface YcCompanyInput {
  name?: string | null;
  website?: string | null;
  teamSize?: number | null;
  batch?: string | null;
  industries?: string[] | null;
  oneLiner?: string | null;
  allLocations?: string | null;
  url?: string | null;
  id?: number | string | null;
  openJobs?: Array<{ title?: string | null; url?: string | null }> | null;
}

export type ExclusionKind =
  | "artifact" | "duplicate" | "technical_only" | "employee_size" | "insufficient_commercial";

export interface PrequalifiedCompany {
  company_key: string;
  name: string;
  canonical_domain: string | null;
  yc_url: string | null;
  yc_id: string | null;
  team_size: number | null;
  batch: string | null;
  one_liner: string | null;
  locations: string | null;
  /** Every job, classified. The FULL array — never just the first. */
  jobs: Array<{ title: string; tier: SignalTier | "technical" | "other" }>;
  tier_a: number;
  tier_b: number;
  tier_c: number;
  technical: number;
  /** Highest tier with real evidence. C alone requires a second signal. */
  best_tier: SignalTier | null;
  score: number;
  /** The single strongest commercial role, for display. Never `openJobs[0]`. */
  strongest_signal: string | null;
  size_fit: boolean;
  /**
   * HARD ELIGIBILITY, decided before any paid call.
   *
   * `size_unverified` is NOT a pass. It ranks below every verified in-range
   * company and is only reachable when more candidates are genuinely needed.
   */
  size_status: "in_range" | "below_min" | "above_max" | "size_unverified";
  eligible: boolean;
  exclusion: ExclusionKind | null;
  reasons: string[];
  /** Domain is sufficient internal identity; LinkedIn is resolved later. */
  linkedin_identity_status: "unresolved";
  identity_confidence: "domain_exact" | "name_only";
}

/** Excluded before any scoring. Returned so the dry run can show them. */
export interface ExcludedArtifact { name: string; domain: string | null; reason: string; }

export interface PrequalificationResult {
  version: typeof PREQUALIFICATION_VERSION;
  total_rows: number;
  unique_companies: number;
  excluded: ExcludedArtifact[];
  companies: PrequalifiedCompany[];
  tier_a_companies: number;
  tier_b_companies: number;
  tier_c_only_companies: number;
  technical_only_companies: number;
  /** Real commercial signal but a KNOWN out-of-range headcount. */
  employee_size_excluded: number;
  eligible_companies: number;
}

interface SizeBounds { min?: number | null; max?: number | null }

/**
 * Score and rank YC rows without spending anything.
 *
 * Deduplicated on domain first, then normalized name — the same precedence the
 * internal identity uses, so two rows for one company cannot become two
 * shortlist slots.
 */
export function prequalifyYcCompanies(
  rows: readonly YcCompanyInput[], size: SizeBounds = {},
): PrequalificationResult {
  const excluded: ExcludedArtifact[] = [];
  const byKey = new Map<string, PrequalifiedCompany>();

  for (const r of rows) {
    const name = String(r?.name ?? "").trim();
    const domain = normalizeDomain(r?.website);
    if (!name && !domain) {
      excluded.push({ name: name || "(unnamed)", domain, reason: "no name and no website — not a company row" });
      continue;
    }
    if (domain && ARTIFACT_DOMAINS.includes(domain)) {
      excluded.push({ name, domain, reason: "directory/platform artifact, not a prospect" });
      continue;
    }
    const key = domain ?? `name:${normalizeCompanyName(name)}`;
    if (byKey.has(key)) continue;

    const jobs = (r.openJobs ?? [])
      .map((j) => ({ title: String(j?.title ?? "").trim(), tier: classifyJobTitle(j?.title) }))
      .filter((j) => j.title.length > 0);

    const tier_a = jobs.filter((j) => j.tier === "A").length;
    const tier_b = jobs.filter((j) => j.tier === "B").length;
    const tier_c = jobs.filter((j) => j.tier === "C").length;
    const technical = jobs.filter((j) => j.tier === "technical").length;

    // TIER C ALONE IS NOT EVIDENCE. "Head of Operations" at a startup may be an
    // office manager; it counts only beside another commercial opening.
    const commercial = tier_a + tier_b;
    const best_tier: SignalTier | null =
      tier_a > 0 ? "A" : tier_b > 0 ? "B" : (tier_c > 1 ? "C" : null);

    const team = typeof r.teamSize === "number" ? r.teamSize : null;
    const size_status: PrequalifiedCompany["size_status"] =
      team === null ? "size_unverified"
      : (size.min != null && team < size.min) ? "below_min"
      : (size.max != null && team > size.max) ? "above_max"
      : "in_range";
    const size_fit = size_status === "in_range";

    const reasons: string[] = [];
    let score = 0;
    if (tier_a > 0) { score += 100 + (tier_a - 1) * 20; reasons.push(`${tier_a} Tier-A commercial role(s)`); }
    if (tier_b > 0) { score += 40 * Math.min(tier_b, 3); reasons.push(`${tier_b} Tier-B commercial role(s)`); }
    if (best_tier === "C") { score += 15; reasons.push(`${tier_c} Tier-C roles with mutual support`); }
    if (commercial >= 2) { score += 25; reasons.push("multiple commercial openings"); }
    if (size_fit) { score += 30; reasons.push(`team size ${team} inside the target range`); }
    else if (size_status === "above_max") reasons.push(`team size ${team} exceeds the maximum — excluded before any paid call`);
    else if (size_status === "below_min") reasons.push(`team size ${team} is below the minimum — excluded before any paid call`);
    else reasons.push("team size unverified — ranks below every verified in-range company");
    if ((r.industries ?? []).some((i) => lc(i) === "b2b")) { score += 10; reasons.push("YC industry B2B"); }
    if (technical > 0 && commercial === 0) reasons.push(`${technical} technical role(s) only — not commercial evidence`);

    const strongest = jobs.find((j) => j.tier === "A") ?? jobs.find((j) => j.tier === "B")
      ?? (best_tier === "C" ? jobs.find((j) => j.tier === "C") : undefined);

    byKey.set(key, {
      company_key: key,
      name: name || key,
      canonical_domain: domain,
      yc_url: r.url ?? null,
      yc_id: r.id != null ? String(r.id) : null,
      team_size: team,
      batch: r.batch ?? null,
      one_liner: r.oneLiner ?? null,
      locations: r.allLocations ?? null,
      jobs, tier_a, tier_b, tier_c, technical, best_tier, score,
      strongest_signal: strongest?.title ?? null,
      size_fit, size_status,
      // A KNOWN out-of-range size is disqualifying on its own. Apollo (200) and
      // Magic (350) each have a real commercial opening and are still wrong for
      // a 10-150 mission; paying to resolve them buys a lead that can never
      // pass the Brain gate.
      eligible: best_tier !== null && size_status !== "above_max" && size_status !== "below_min",
      exclusion: (size_status === "above_max" || size_status === "below_min")
        ? "employee_size"
        : best_tier === null
        ? (technical > 0 ? "technical_only" : "insufficient_commercial")
        : null,
      reasons,
      linkedin_identity_status: "unresolved",
      identity_confidence: domain ? "domain_exact" : "name_only",
    });
  }

  const rank = (c: PrequalifiedCompany) => c.size_status === "in_range" ? 0 : 1;
  const companies = [...byKey.values()].sort((a, b) =>
    rank(a) - rank(b) || b.score - a.score || a.name.localeCompare(b.name));

  return {
    version: PREQUALIFICATION_VERSION,
    total_rows: rows.length,
    unique_companies: companies.length,
    excluded,
    companies,
    tier_a_companies: companies.filter((c) => c.best_tier === "A").length,
    tier_b_companies: companies.filter((c) => c.best_tier === "B").length,
    tier_c_only_companies: companies.filter((c) => c.best_tier === "C").length,
    technical_only_companies: companies.filter((c) => c.exclusion === "technical_only").length,
    employee_size_excluded: companies.filter((c) => c.exclusion === "employee_size").length,
    eligible_companies: companies.filter((c) => c.eligible).length,
  };
}

// ------------------------------------------------------------- shortlist ----

/** `min(10, max(5, requested × 2))` — bounded above AND below. */
export function shortlistSize(requestedLeadCount: number): number {
  const n = Math.max(0, Math.trunc(requestedLeadCount));
  return Math.min(10, Math.max(5, n * 2));
}

/** Maximum simultaneous paid Actor starts in the resolution stage. */
export const LINKEDIN_RESOLUTION_CONCURRENCY = 2;

/**
 * The companies worth paying to resolve.
 *
 * A company with no commercial signal at all is NEVER shortlisted, however good
 * its size or batch — paying to identify a company that is only hiring
 * engineers cannot produce a lead for a GTM-hiring mission.
 */
export function shortlistForLinkedInResolution(
  result: PrequalificationResult, requestedLeadCount: number,
): PrequalifiedCompany[] {
  // The cap is a CEILING, not a quota. Filling it with known out-of-range
  // companies would spend the budget on leads that cannot qualify.
  return result.companies
    .filter((c) => c.eligible)
    .slice(0, shortlistSize(requestedLeadCount));
}

/** The search query for one shortlisted company. Name + domain evidence. */
export function linkedInSearchQueryFor(c: PrequalifiedCompany): string {
  return c.canonical_domain ? `${c.name} ${c.canonical_domain}` : c.name;
}

// ------------------------------------------------------- match acceptance ----

export interface CandidateMatch {
  name?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  description?: string | null;
  location?: string | null;
}

export type MatchStrength = "domain_exact" | "name_plus_evidence" | "rejected_weak";

/**
 * Accept a LinkedIn search result for a company — or refuse it.
 *
 * A name-only match is REFUSED. "Apollo", "Hub", "Magic" and "Streak" are real
 * YC companies and also extremely common words; accepting a bare name match
 * would attach a founder from the wrong company, which is worse than returning
 * nothing.
 */
export function acceptLinkedInMatch(
  company: PrequalifiedCompany, candidate: CandidateMatch,
): { accepted: boolean; strength: MatchStrength; reason: string } {
  const candDomain = normalizeDomain(candidate.website);
  if (company.canonical_domain && candDomain && candDomain === company.canonical_domain) {
    return { accepted: true, strength: "domain_exact", reason: `domain ${candDomain} matches exactly` };
  }
  const sameName = normalizeCompanyName(candidate.name) === normalizeCompanyName(company.name);
  if (sameName) {
    const hay = `${lc(candidate.description)} ${lc(candidate.location)}`;
    const token = company.canonical_domain?.split(".")[0] ?? "";
    const supported = (token.length > 3 && hay.includes(token)) ||
      (!!company.one_liner && hay.includes(lc(company.one_liner).slice(0, 24)));
    if (supported) {
      return { accepted: true, strength: "name_plus_evidence", reason: "name matches and description/location corroborates" };
    }
    return {
      accepted: false, strength: "rejected_weak",
      reason: "name matches but nothing corroborates it — a bare name match is not an identity",
    };
  }
  return { accepted: false, strength: "rejected_weak", reason: "neither domain nor name matches" };
}
