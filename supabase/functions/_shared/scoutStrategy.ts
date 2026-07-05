// Scout query strategy + QA cost reporting (Phase 4).
//
// Two small, evidence-first concerns:
//  1) buildScoutJobsKeywords — turn the Company-Brain ICP + role intent into an
//     ICP-aware LinkedIn-Jobs keyword string that PREFERS revenue/growth/RevOps
//     roles + SaaS context and AVOIDS generic operations terms (which the proof
//     gate would reject anyway). If the structured ICP is missing it reports weak
//     context instead of pretending — it never fabricates ICP.
//  2) computeQaLimit — surface requestedMaxResults vs the provider's actorCount
//     (the jobs actor floors at 10) vs processedCount, so a $5-capped QA run is
//     never silently a 10-result run.
//
// Pure / import-free so it is fully unit-testable. Weakens no gate.

export interface ScoutIcp {
  industries?: string[]; target_industries?: string[];
  buyer_roles?: string[]; target_buyers?: string[];
  target_signals?: string[];
  negative_role_terms?: string[];
  disqualifiers?: string[];
  company_size?: string; target_company_size?: string;
  geography?: string;
}
export interface ScoutJobsQuery {
  keywords: string;
  usedTerms: string[];
  avoidedTerms: string[];
  weakIcpContext: boolean;
  saasContextApplied: boolean;
}

// Generic operations titles that are NOT a RevOps/GTM signal (dropped from the
// primary query when the intent is GTM and no explicit ICP asks for them).
const GENERIC_OPS_TERMS = [
  "operations manager", "general manager", "office manager", "plant manager",
  "production manager", "warehouse operations", "field operations", "facilities manager",
  "plant operations", "production operations", "retail operations", "hospital operations",
  "university operations", "bank operations", "branch operations", "store operations",
];
// Preferred revenue/growth/GTM role terms.
const REVOPS_TERMS = [
  "RevOps", "Revenue Operations", "GTM Operations", "Growth Operations",
  "Sales Operations", "Sales Ops", "Founding Account Executive", "Head of Growth",
  "first sales hire", "SDR Manager", "BDR Manager",
];
// SaaS/GTM context terms (added when the ICP indicates B2B/AI SaaS).
const SAAS_CONTEXT_TERMS = ["SaaS", "software", "B2B"];

function lc(s: unknown): string { return String(s ?? "").toLowerCase(); }
const GTM_INTENT_RE = /\b(revops|revenue operations|gtm|go-to-market|growth operations?|sales operations?|sales ops|founding account executive|head of growth|first sales|sdr|bdr)\b/i;
const SAAS_ICP_RE = /\b(saas|software|b2b|ai|sales software|revenue operations|workflow automation|data enrichment|martech|sales tech|fintech)\b/i;

function icpList(icp: ScoutIcp | null | undefined, ...keys: (keyof ScoutIcp)[]): string[] {
  const out: string[] = [];
  for (const k of keys) { const v = icp?.[k]; if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string")); else if (typeof v === "string" && v.trim()) out.push(v); }
  return out;
}

/**
 * Build an ICP-aware LinkedIn-Jobs keyword string. The prompt supplies the role
 * intent; the Company-Brain ICP shapes the query toward SaaS revenue/growth work
 * and away from generic operations. Never invents ICP.
 */
export function buildScoutJobsKeywords(args: { roleKeywords?: string[]; query?: string | null; icp?: ScoutIcp | null }): ScoutJobsQuery {
  const icp = args.icp ?? null;
  const roleKw = (args.roleKeywords ?? []).filter((s) => typeof s === "string" && s.trim());
  const query = args.query ?? "";

  const industries = icpList(icp, "industries", "target_industries");
  const buyers = icpList(icp, "buyer_roles", "target_buyers");
  const signals = icpList(icp, "target_signals");
  const weakIcpContext = industries.length === 0 && buyers.length === 0 && signals.length === 0;

  const isSaasIcp = industries.some((i) => SAAS_ICP_RE.test(i)) || signals.some((s) => SAAS_ICP_RE.test(s));
  const isGtmIntent = GTM_INTENT_RE.test(query) || roleKw.some((r) => GTM_INTENT_RE.test(r)) || signals.some((s) => GTM_INTENT_RE.test(s));

  const usedTerms: string[] = [];
  const avoidedTerms: string[] = [];

  // Drop generic operations terms from the role keywords (they're not GTM signals
  // and the proof gate would cap/reject them). Record what was avoided.
  const nonGeneric = roleKw.filter((r) => {
    const hit = GENERIC_OPS_TERMS.find((g) => lc(r).includes(g));
    if (hit) { avoidedTerms.push(r); return false; }
    return true;
  });
  usedTerms.push(...nonGeneric);

  // For a GTM/RevOps intent, prefer the RevOps role family; if the caller gave no
  // non-generic role terms (e.g. they only said "operations"), seed RevOps terms.
  if (isGtmIntent && nonGeneric.length === 0) usedTerms.push(...REVOPS_TERMS.slice(0, 4));

  // Add SaaS context when the ICP is B2B/AI SaaS (helps the search skew to software).
  let saasContextApplied = false;
  if (isSaasIcp) { usedTerms.push(...SAAS_CONTEXT_TERMS.slice(0, 2)); saasContextApplied = true; }

  // Fallback: if we still have nothing, use the original query (never empty-invent).
  const finalTerms = usedTerms.length ? usedTerms : (query.trim() ? [query.trim()] : roleKw);
  // De-dupe (case-insensitive) preserving order.
  const seen = new Set<string>();
  const dedup = finalTerms.filter((t) => { const k = lc(t); if (!k || seen.has(k)) return false; seen.add(k); return true; });

  return {
    keywords: dedup.join(" "),
    usedTerms: dedup,
    avoidedTerms: [...new Set(avoidedTerms)],
    weakIcpContext,
    saasContextApplied,
  };
}

// ---------- QA cost reporting ----------
export interface QaLimitReport {
  requestedMaxResults: number;
  actorCount: number;      // what the provider actually ran (jobs floors at 10)
  processedCount: number;  // rows actually processed/persisted
  qaLimitApplied: boolean; // true when we processed fewer than the actor fetched
}
/** The jobs actor floors at 10; this reports the gap so QA spend is never hidden. */
export function computeQaLimit(requestedMaxResults: number, actorCount: number, processedCount: number): QaLimitReport {
  const req = Math.max(0, Math.floor(requestedMaxResults || 0));
  const capped = Math.min(processedCount, req > 0 ? req : processedCount);
  return {
    requestedMaxResults: req,
    actorCount,
    processedCount: capped,
    qaLimitApplied: actorCount > capped,
  };
}

/** Cap a processed list to the requested QA limit (defensive; provider already sliced). */
export function applyQaResultLimit<T>(items: T[], requestedMaxResults: number): T[] {
  const n = Math.max(0, Math.floor(requestedMaxResults || 0));
  return n > 0 ? (items ?? []).slice(0, n) : (items ?? []);
}
