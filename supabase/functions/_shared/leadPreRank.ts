// Pre-rank the fetched Apify jobs pool BEFORE the process/persist limit.
//
// The jobs actor returns ~10 rows even when we process 1. Processing the first
// returned row makes quality random. This pure ranker scores every already-
// fetched candidate against the derived Company Brain ICP (using ONLY data Apify
// already returned — no new provider calls) so the BEST candidate is processed,
// not the first. Rewards ICP/SaaS/revenue-role/proof evidence; penalizes off-ICP
// size/industry/generic-ops/no-proof. Never fabricates.
//
// Pure / import-free so it is fully unit-testable.

import type { DerivedCompanyIcp } from "./companyBrainIcp.ts";

export interface PreRankCandidate {
  company?: string | null;
  jobTitle?: string | null;
  title?: string | null;
  website?: string | null;
  domain?: string | null;
  linkedinUrl?: string | null;
  jobUrl?: string | null;
  source_url?: string | null;
  industries?: string[] | string | null;
  companyDescription?: string | null;
  jobDescription?: string | null;
  employeeCount?: number | null;
  raw?: Record<string, unknown> | null;
}
export interface PreRankResult<T> {
  candidate: T;
  scoutRank: number;
  scoutPreRankScore: number;
  scoutRankReasons: string[];
  scoutPenalties: string[];
}
export interface PreRankOutcome<T> {
  ranked: Array<PreRankResult<T>>;
  poolSize: number;
  weakPool: boolean;   // even the best candidate is weak (< 40)
}

function lc(s: unknown): string { return String(s ?? "").toLowerCase(); }
function inds(c: PreRankCandidate): string { return lc(Array.isArray(c.industries) ? c.industries.join(" ") : (c.industries ?? "")); }
function text(c: PreRankCandidate): string { return lc(`${c.company ?? ""} ${inds(c)} ${c.companyDescription ?? ""} ${c.jobDescription ?? ""}`); }
function title(c: PreRankCandidate): string { return lc(c.jobTitle ?? c.title ?? ""); }

const SAAS_EVIDENCE = /\b(b2b|saas|software|ai|platform|api|cloud|app|analytics|crm|sales tech|martech|fintech|data)\b/i;
const REVENUE_ROLE = /\b(revops|revenue operations|sales operations|sales ops|gtm operations|growth operations|head of growth|founding account executive|first sales|customer acquisition|founding ae|growth marketer|demand gen)\b/i;
const GROWTH_EVIDENCE = /\b(pipeline|outbound|revenue|sales process|go-to-market|customer acquisition|automation|data enrichment|sales tools|prospect|lead gen|crm|hubspot|salesforce|clay|apollo|instantly)\b/i;
const FUNDING_EVIDENCE = /\b(series [a-d]\b|seed round|raised|funding|newly funded|just raised|backed by)\b/i;
const GENERIC_OPS = /\b(operations manager|general manager|office manager|plant operations?|production operations?|warehouse operations?|field operations?|facilities|branch operations|store operations|retail operations|hospital operations|university operations|bank operations)\b/i;
const BIZDEV_ONLY = /\b(business development|bizdev|bd manager|partnerships?)\b/i;
const OFF_ICP_INDUSTRY = /\b(manufacturing|construction|retail|restaurant|hospitality|university|school|hospital|bank|government|logistics|local services|plant|refinery|oil|mining)\b/i;

/** Score one candidate 0-100 against the derived ICP (already-fetched data only). */
export function scoreCandidate(c: PreRankCandidate, icp: DerivedCompanyIcp): { score: number; reasons: string[]; penalties: string[] } {
  const reasons: string[] = [];
  const penalties: string[] = [];
  let score = 0;
  const t = text(c);
  const jt = title(c);

  // --- rewards ---
  const posInd = (icp.targetIndustries ?? []).map(lc).filter(Boolean);
  if (posInd.length && posInd.some((i) => t.includes(i))) { score += 22; reasons.push("in ICP industry"); }
  else if (SAAS_EVIDENCE.test(t)) { score += 16; reasons.push("B2B/SaaS/software evidence"); }

  const emp = typeof c.employeeCount === "number" ? c.employeeCount : null;
  const { min, max } = icp.targetCompanySize;
  if (emp != null) {
    if ((min == null || emp >= min) && (max == null || emp <= max)) { score += 18; reasons.push(`${emp} employees — within ICP size`); }
    else if (max != null && emp > max) { score -= 14; penalties.push(`too large (${emp} > ${max})`); }
    else if (min != null && emp < min) { score -= 4; penalties.push(`very small (${emp} < ${min})`); }
  } else { score -= 6; penalties.push("missing employee count"); }

  if (REVENUE_ROLE.test(jt)) { score += 20; reasons.push(`revenue/growth role: ${c.jobTitle ?? c.title}`); }
  else if (BIZDEV_ONLY.test(jt) && !REVENUE_ROLE.test(jt)) { score -= 8; penalties.push("generic BizDev without RevOps/growth context"); }
  if (GENERIC_OPS.test(jt)) { score -= 18; penalties.push(`generic operations role: ${c.jobTitle ?? c.title}`); }

  if (GROWTH_EVIDENCE.test(t)) { score += 10; reasons.push("pipeline/revenue/growth evidence in description"); }
  if (FUNDING_EVIDENCE.test(t)) { score += 12; reasons.push("recent funding / growth momentum evidence"); }

  // proof quality
  const hasJobUrl = !!(c.jobUrl ?? c.source_url);
  if (hasJobUrl) { score += 8; reasons.push("job URL proof"); } else { score -= 12; penalties.push("no job URL"); }
  if (c.website ?? c.domain) { score += 6; reasons.push("company website/domain"); } else { score -= 8; penalties.push("no company website/domain"); }
  if (c.linkedinUrl) { score += 4; reasons.push("LinkedIn company URL"); }

  // --- hard penalties for off-ICP ---
  const disq = (icp.disqualifiers ?? []).map(lc).filter(Boolean);
  const disqHit = disq.find((d) => t.includes(d)) ?? (OFF_ICP_INDUSTRY.test(t) ? (t.match(OFF_ICP_INDUSTRY)?.[0] ?? null) : null);
  if (disqHit) { score -= 40; penalties.push(`off-ICP / disqualifier: ${disqHit}`); }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, penalties };
}

/**
 * Rank the fetched pool; best first. Marks weakPool when even the top candidate
 * scores below 40 (so the caller can flag "best available from a weak pool").
 */
export function preRankCandidates<T extends PreRankCandidate>(candidates: T[], icp: DerivedCompanyIcp): PreRankOutcome<T> {
  const scored = (candidates ?? []).map((candidate) => {
    const s = scoreCandidate(candidate, icp);
    return { candidate, scoutPreRankScore: s.score, scoutRankReasons: s.reasons, scoutPenalties: s.penalties, scoutRank: 0 };
  });
  scored.sort((a, b) => b.scoutPreRankScore - a.scoutPreRankScore);
  scored.forEach((r, i) => { r.scoutRank = i + 1; });
  const weakPool = scored.length === 0 || (scored[0]?.scoutPreRankScore ?? 0) < 40;
  return { ranked: scored, poolSize: scored.length, weakPool };
}
