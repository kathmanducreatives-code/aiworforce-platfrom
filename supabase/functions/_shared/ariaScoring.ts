// Aria scoring engine — the heart of Lead Intelligence.
//
// Scout finds (wide net); Aria decides (Company-Brain-first). Given an enriched
// candidate + the Company Brain, Aria produces an EXPLAINABLE, configurable score:
// a per-dimension breakdown, an ICP-match checklist, a confidence level, a
// competitor-similarity feature, a star tier, and structured "why accepted"
// reasoning built from the actual data (never generic templates). The Company
// Brain — not query relevance — determines quality; disqualifiers always win.
//
// Pure / import-free (except pure helpers) so it is fully unit-testable. Never
// fabricates data: missing fields lower confidence, they are not invented.

import { parseEmployeeCount, sizeBandToBounds } from "./companyIcpFilter.ts";

export interface AriaWeights {
  industry: number; size: number; buyer: number; hiring: number;
  growth: number; positioning: number; competitor: number; location: number;
}
// Weights sum to 100. Configurable per workspace/experiment.
export const DEFAULT_ARIA_WEIGHTS: AriaWeights = {
  industry: 25, size: 20, buyer: 15, hiring: 15, growth: 10, positioning: 5, competitor: 5, location: 5,
};

export interface AriaBrain {
  icp?: {
    industries?: string[]; company_size?: string; geography?: string;
    buyer_roles?: string[]; funding_stage?: string[]; disqualifiers?: string[];
    negative_industries?: string[]; allow_enterprise?: boolean;
  };
  positioning?: { keywords?: string[]; category?: string; description?: string };
  competitors?: string[];
  pain_points?: string[];
}

export interface AriaCandidate {
  company?: string | null;
  website?: string | null;
  linkedin?: string | null;
  industry?: string | null;
  company_category?: string | null;
  team_size?: string | number | null;
  location?: string | null;
  founder?: string | null;
  funding_stage?: string | null;
  hiring_role?: string | null;
  exact_signal?: string | null;
  growth_signals?: string[] | string | null;
  source_url?: string | null;
  raw?: Record<string, unknown> | null;
}

export interface IcpMatch {
  industry: boolean; size: boolean; buyer: boolean;
  funding: boolean; location: boolean; hiring: boolean;
}
export type StarTier = 1 | 2 | 3 | 4 | 5;
export interface AriaScore {
  overall_fit: number;                       // 0-100
  breakdown: Record<keyof AriaWeights, number>;  // points earned per dimension
  max_breakdown: AriaWeights;                // configured max per dimension
  icp_match: IcpMatch;                        // ✓ checklist
  icp_match_count: number;                    // how many of 6 matched
  confidence: { level: "high" | "medium" | "low"; score: number };
  competitor_similarity: number;             // 0-100
  star_tier: StarTier;
  star_label: string;
  accepted: boolean;                         // star >= 2 (reject at 1)
  why_accepted: string[];                    // structured reasoning
  missing_context: string[];
  disqualified: boolean;
}

function lc(s: unknown): string { return String(s ?? "").toLowerCase().trim(); }
function present(s: unknown): boolean { const v = lc(s); return !!v && v !== "null" && v !== "undefined" && v !== "n/a"; }
function tokens(s: unknown): string[] { return lc(s).match(/[a-z0-9][a-z0-9+.\-]{1,}/g) ?? []; }
function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const hit = a.filter((t) => sb.has(t)).length;
  return hit / Math.min(a.length, b.length);
}
function hay(c: AriaCandidate): string {
  return lc(`${c.company ?? ""} ${c.industry ?? ""} ${c.company_category ?? ""} ${(c.raw?.description as string) ?? ""} ${(c.raw?.headline as string) ?? ""}`);
}

/** 0-100 similarity to the Brain's competitor set (name/industry/keyword overlap). */
export function competitorSimilarity(cand: AriaCandidate, competitors: string[]): number {
  const comps = (competitors ?? []).map(lc).filter(Boolean);
  if (!comps.length) return 0;
  const h = hay(cand);
  // Direct mention of a competitor = strong signal.
  if (comps.some((c) => h.includes(c))) return 90;
  // Token overlap between the candidate's descriptor and the competitor names.
  const ct = tokens(`${cand.industry ?? ""} ${cand.company_category ?? ""} ${(cand.raw?.description as string) ?? ""}`);
  const compTok = comps.flatMap((c) => tokens(c));
  const o = overlap(ct, compTok);
  return Math.round(o * 70);
}

/** Map a 0-100 fit to a star tier. Disqualified companies are forced to ★1 (reject). */
export function starTier(fit: number, disqualified = false): { tier: StarTier; label: string; accepted: boolean } {
  if (disqualified) return { tier: 1, label: "Reject", accepted: false };
  if (fit >= 85) return { tier: 5, label: "Best match", accepted: true };
  if (fit >= 70) return { tier: 4, label: "Strong match", accepted: true };
  if (fit >= 50) return { tier: 3, label: "Worth reviewing", accepted: true };
  if (fit >= 30) return { tier: 2, label: "Weak", accepted: true };
  return { tier: 1, label: "Reject", accepted: false };
}

/**
 * Score a company against the Company Brain. Company-Brain-first: query relevance
 * is not an input here — the Brain determines quality. Returns an explainable
 * breakdown + structured reasoning.
 */
export function scoreCompany(cand: AriaCandidate, brain: AriaBrain, weights: AriaWeights = DEFAULT_ARIA_WEIGHTS): AriaScore {
  const icp = brain.icp ?? {};
  const why: string[] = [];
  const missing: string[] = [];
  const h = hay(cand);

  // --- Disqualifiers always win (query never overrides them). ---
  const disquals = (icp.disqualifiers ?? []).map(lc).filter(Boolean);
  const negInd = (icp.negative_industries ?? []).map(lc).filter(Boolean);
  const disqualified = disquals.some((d) => h.includes(d)) || negInd.some((n) => h.includes(n));

  // --- Industry ---
  const inds = (icp.industries ?? []).filter(Boolean);
  let industryPts = 0, industryMatch = false;
  if (inds.length) {
    if (inds.some((i) => h.includes(lc(i)))) { industryPts = weights.industry; industryMatch = true; why.push(`In your ICP industry (${inds.find((i) => h.includes(lc(i)))})`); }
    else {
      const o = overlap(tokens(`${cand.industry ?? ""} ${cand.company_category ?? ""}`), inds.flatMap(tokens));
      industryPts = Math.round(o * weights.industry);
      if (o > 0) why.push("Related to your target industry");
    }
  } else { industryPts = Math.round(weights.industry * 0.5); }
  if (!present(cand.industry) && !present(cand.company_category)) missing.push("industry");

  // --- Company size ---
  const bounds = sizeBandToBounds(icp.company_size);
  const emp = parseEmployeeCount(cand.team_size);
  let sizePts = 0, sizeMatch = false;
  if (emp == null) { sizePts = Math.round(weights.size * 0.4); missing.push("employee count"); }
  else if ((bounds.min == null || emp >= bounds.min) && (bounds.max == null || emp <= bounds.max)) { sizePts = weights.size; sizeMatch = true; why.push(`${emp} employees — within your ${icp.company_size ?? "target"} band`); }
  else {
    // Near the band → partial; far off → low.
    const dist = bounds.max != null && emp > bounds.max ? emp / bounds.max : (bounds.min != null && emp < bounds.min ? bounds.min / Math.max(emp, 1) : 1);
    sizePts = dist <= 2 ? Math.round(weights.size * 0.5) : Math.round(weights.size * 0.1);
    why.push(`${emp} employees (outside your ${icp.company_size ?? "target"} band)`);
  }

  // --- Buyer / persona ---
  const buyers = (icp.buyer_roles ?? []).map(lc);
  const roleText = lc(`${cand.hiring_role ?? ""} ${cand.exact_signal ?? ""} ${cand.founder ?? ""} ${(cand.raw?.title as string) ?? ""}`);
  let buyerPts = 0, buyerMatch = false;
  const founderLed = present(cand.founder) || /founder|ceo/.test(roleText);
  if (buyers.length && buyers.some((b) => roleText.includes(b))) { buyerPts = weights.buyer; buyerMatch = true; why.push(`Reaches your buyer persona (${buyers.find((b) => roleText.includes(b))})`); }
  else if (founderLed) { buyerPts = Math.round(weights.buyer * 0.8); buyerMatch = true; why.push("Founder-led"); }
  else buyerPts = Math.round(weights.buyer * 0.3);

  // --- Hiring signal ---
  const hasProof = present(cand.source_url);
  const hasHiring = present(cand.hiring_role) || present(cand.exact_signal);
  let hiringPts = 0, hiringMatch = false;
  if (hasHiring && hasProof) { hiringPts = weights.hiring; hiringMatch = true; why.push(`Hiring ${cand.hiring_role ?? cand.exact_signal} — real job posting`); }
  else if (hasHiring) { hiringPts = Math.round(weights.hiring * 0.5); why.push(`Hiring ${cand.hiring_role ?? cand.exact_signal} (unverified)`); }
  else if (!hasProof) missing.push("source proof");

  // --- Growth signal ---
  const growth = Array.isArray(cand.growth_signals) ? cand.growth_signals.join(" ") : (cand.growth_signals ?? "");
  const growthText = lc(`${growth} ${cand.funding_stage ?? ""} ${(cand.raw?.growth as string) ?? ""}`);
  let growthPts = 0;
  if (/series [a-d]|seed|raised|funding|expanding|scaling|growth|hiring spree/.test(growthText)) { growthPts = weights.growth; why.push(cand.funding_stage ? `${cand.funding_stage}` : "Growth signal present"); }
  else if (present(cand.funding_stage)) { growthPts = Math.round(weights.growth * 0.6); why.push(String(cand.funding_stage)); }
  else missing.push("growth/funding");

  // --- Positioning similarity ---
  const posKw = (brain.positioning?.keywords ?? []).flatMap(tokens);
  const posPts = posKw.length ? Math.round(overlap(tokens(h), posKw) * weights.positioning) : 0;
  if (posPts > 0) why.push("Matches your positioning language");

  // --- Competitor similarity ---
  const compSim = competitorSimilarity(cand, brain.competitors ?? []);
  const compPts = Math.round((compSim / 100) * weights.competitor);
  if (compSim >= 70) why.push(`Resembles ${(brain.competitors ?? [])[0] ?? "your competitors"}' customers (${compSim}%)`);

  // --- Location ---
  const geo = lc(icp.geography);
  let locPts = 0, locMatch = false;
  if (!geo) locPts = Math.round(weights.location * 0.5);
  else if (present(cand.location) && (lc(cand.location).includes(geo) || geo.includes(lc(cand.location)))) { locPts = weights.location; locMatch = true; why.push(`Located in ${cand.location}`); }
  else if (!present(cand.location)) { locPts = Math.round(weights.location * 0.4); missing.push("location"); }

  const breakdown = { industry: industryPts, size: sizePts, buyer: buyerPts, hiring: hiringPts, growth: growthPts, positioning: posPts, competitor: compPts, location: locPts };
  let overall_fit = Object.values(breakdown).reduce((a, b) => a + b, 0);
  overall_fit = Math.max(0, Math.min(100, Math.round(overall_fit)));
  if (disqualified) overall_fit = Math.min(overall_fit, 20);

  const icp_match: IcpMatch = { industry: industryMatch, size: sizeMatch, buyer: buyerMatch, funding: present(cand.funding_stage), location: locMatch, hiring: hiringMatch };
  const icp_match_count = Object.values(icp_match).filter(Boolean).length;
  if (icp_match_count >= 4) why.unshift(`Matches ${icp_match_count} of 6 ICP filters`);

  // --- Confidence: never High without source proof + real matches. ---
  const enrichedFields = [cand.website, cand.industry, cand.team_size, cand.location, cand.funding_stage, cand.founder].filter(present).length;
  let confScore = 0;
  if (hasProof) confScore += 40;
  confScore += Math.min(30, icp_match_count * 6);
  confScore += Math.min(30, enrichedFields * 5);
  confScore = Math.min(100, confScore);
  const level: "high" | "medium" | "low" = (hasProof && confScore >= 70) ? "high" : confScore >= 45 ? "medium" : "low";

  const st = starTier(overall_fit, disqualified);
  if (disqualified) why.length = 0, why.push("Rejected: matches a Company-Brain disqualifier");

  return {
    overall_fit, breakdown, max_breakdown: weights,
    icp_match, icp_match_count,
    confidence: { level, score: confScore },
    competitor_similarity: compSim,
    star_tier: st.tier, star_label: st.label, accepted: st.accepted,
    why_accepted: why.slice(0, 8), missing_context: [...new Set(missing)],
    disqualified,
  };
}

/** Score + sort a list of companies by overall_fit (Company Brain always wins). */
export function rankCompanies(cands: AriaCandidate[], brain: AriaBrain, weights: AriaWeights = DEFAULT_ARIA_WEIGHTS): Array<{ candidate: AriaCandidate; score: AriaScore }> {
  return (cands ?? [])
    .map((candidate) => ({ candidate, score: scoreCompany(candidate, brain, weights) }))
    .sort((a, b) => b.score.overall_fit - a.score.overall_fit);
}

/** Normalize configurable weights (fill missing, keep provided). */
export function resolveWeights(partial?: Partial<AriaWeights> | null): AriaWeights {
  return { ...DEFAULT_ARIA_WEIGHTS, ...(partial ?? {}) };
}
