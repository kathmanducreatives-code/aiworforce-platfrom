// Provider query builder (Part 2). Turns a structured LeadSearchIntent into a
// SMALL set of PRECISE Apify-jobs queries — never one giant keyword string, and
// never an ambiguous "US + EU" location. Pure / import-free (testable).

import type { LeadSearchIntent } from "./leadSearchIntent.ts";

export interface ProviderQuery {
  provider: "apify_jobs";
  keywords: string;
  location: string;
  intent_tier: "strict" | "relaxed" | "broad";
  reason: string;
  required_evidence: string[];
  max_results: number;
}

// Location group → concrete LinkedIn-resolvable locations. NEVER a combined or
// ambiguous string; "EU" is split into named countries so LinkedIn can't resolve
// "Eu" as a French town.
const GROUP_LOCATIONS: Record<string, string[]> = {
  US: ["United States", "Remote United States"],
  USA: ["United States", "Remote United States"],
  EU: ["United Kingdom", "Germany", "Netherlands", "France"],
  EUROPE: ["United Kingdom", "Germany", "Netherlands", "France"],
};

/** Expand groups + explicit locations into concrete, deduped LinkedIn locations. */
export function expandLocations(intent: LeadSearchIntent): string[] {
  const out: string[] = [];
  for (const g of intent.location_groups) {
    for (const loc of GROUP_LOCATIONS[g.toUpperCase()] ?? []) if (!out.includes(loc)) out.push(loc);
  }
  for (const l of intent.locations) {
    const v = l.trim();
    if (!v) continue;
    // never let a raw group/ambiguous token through as a location
    if (/^(us|usa|eu|europe|us\s*\+\s*eu)$/i.test(v)) continue;
    const mapped = v.toLowerCase() === "remote" ? "Remote United States" : v;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out.length ? out : ["United States"]; // safe default, never empty/ambiguous
}

const shortCategory = (c: string): string => c.replace(/\bB2B\b/i, "B2B").replace(/\s+/g, " ").trim();

/**
 * Build targeted provider queries: strict (must-have category × must-have role ×
 * motion) first, then relaxed (broader category × adjacent roles), then a small
 * broad fallback. Each query carries ONE location, an intent_tier, a reason, and
 * the evidence a result must satisfy to be accepted at that tier.
 */
export function buildProviderQueries(intent: LeadSearchIntent, opts: { maxQueries?: number } = {}): ProviderQuery[] {
  const maxQueries = Math.max(2, Math.min(12, opts.maxQueries ?? 8));
  const locations = expandLocations(intent);
  const perQuery = Math.max(3, Math.min(25, intent.requested_count));
  const motion = intent.motion_terms.find((m) => /outbound|pipeline|founder-led/i.test(m)) ?? "";

  const cats = intent.must_have_categories.length ? intent.must_have_categories : (intent.company_categories.slice(0, 1));
  const broaderCats = intent.company_categories.filter((c) => !cats.includes(c)).slice(0, 2);
  const strictRoles = (intent.must_have_roles.length ? intent.must_have_roles : intent.role_terms).slice(0, 3);
  const adjacentRoles = intent.role_terms.filter((r) => !strictRoles.includes(r)).slice(0, 3);

  const fundingEvidence = intent.funding_required ? ["recent_funding_proof"] : [];
  const combos: Array<Omit<ProviderQuery, "provider" | "location" | "max_results">> = [];

  // Strict tier — the user's precise intent.
  for (const cat of cats) {
    for (const role of strictRoles) {
      combos.push({
        keywords: [shortCategory(cat), role, motion].filter(Boolean).join(" "),
        intent_tier: "strict",
        reason: `Strict: ${cat} hiring ${role}${motion ? ` for ${motion}` : ""}`,
        required_evidence: ["company_category_match", "exact_role_match", "source_url", ...fundingEvidence],
      });
    }
  }
  // Relaxed tier — broader category and/or adjacent GTM roles (secondary if accepted).
  for (const cat of [...cats, ...broaderCats]) {
    for (const role of adjacentRoles) {
      combos.push({
        keywords: [shortCategory(cat), role].filter(Boolean).join(" "),
        intent_tier: "relaxed",
        reason: `Relaxed: ${cat} hiring adjacent GTM role ${role} — secondary match, verify funding/motion`,
        required_evidence: ["company_category_match", "adjacent_role_match", "source_url"],
      });
    }
  }
  // Broad tier — one minimal category-level fallback so we never come back empty.
  if (cats[0]) {
    combos.push({
      keywords: [shortCategory(cats[0]), strictRoles[0] ?? "Sales", motion].filter(Boolean).join(" "),
      intent_tier: "broad",
      reason: `Broad fallback: ${cats[0]} sales/GTM hiring signal — needs SaaS + outbound/revenue evidence to accept`,
      required_evidence: ["company_category_or_gtm_signal", "source_url"],
    });
  }

  // Dedupe by keywords, cap, and rotate locations so both US + EU are covered
  // without a keyword×location explosion.
  const seen = new Set<string>();
  const out: ProviderQuery[] = [];
  for (const c of combos) {
    const key = c.keywords.toLowerCase();
    if (!c.keywords || seen.has(key)) continue;
    seen.add(key);
    out.push({
      provider: "apify_jobs",
      location: locations[out.length % locations.length],
      max_results: perQuery,
      ...c,
    });
    if (out.length >= maxQueries) break;
  }
  return out;
}
