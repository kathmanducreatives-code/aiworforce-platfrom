// WHAT THE PORTFOLIO ACTUALLY DELIVERED — read, never re-derived.
//
// The Workbench used to show a single "results" number that meant whichever
// count happened to be nearest. A portfolio has several genuinely different
// numbers and collapsing them is how "0 qualified" got read as "the Brain
// rejected everything" when the Brain had never run.
//
// PURE. No React, no network, no client.

export type PortfolioState =
  | 'qualified' | 'review' | 'identity_unresolved_watch' | 'watch';

export interface PortfolioEntryView {
  rank: number;
  company_key: string;
  company_name: string;
  domain: string | null;
  tier: 'A' | 'B' | 'C' | null;
  state: PortfolioState;
  actionable: boolean;
  reason: string;
  source_url: string | null;
  round: number | null;
}

export interface PortfolioCounts {
  delivered: number;
  tier_a: number; tier_b: number; tier_c: number;
  qualified: number; review: number; watch: number;
  contact_ready: number; rejected_by_floor: number;
}

export interface PortfolioView {
  requested_opportunities: number;
  requested_contact_ready: number | null;
  counts: PortfolioCounts;
  opportunity_shortfall: number;
  opportunity_shortfall_reason: string | null;
  contact_ready_shortfall: number;
  contact_ready_shortfall_reason: string | null;
  entries: PortfolioEntryView[];
}

export function readPortfolio(result: unknown): PortfolioView | null {
  if (!result || typeof result !== 'object') return null;
  const p = (result as { workbench_portfolio?: unknown }).workbench_portfolio;
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, any>;
  if (!o.counts || typeof o.counts !== 'object') return null;
  return {
    requested_opportunities: Number(o.targets?.requested_opportunity_count ?? 0),
    requested_contact_ready: o.targets?.requested_contact_ready_count ?? null,
    counts: {
      delivered: Number(o.counts.delivered ?? 0),
      tier_a: Number(o.counts.tier_a ?? 0),
      tier_b: Number(o.counts.tier_b ?? 0),
      tier_c: Number(o.counts.tier_c ?? 0),
      qualified: Number(o.counts.qualified ?? 0),
      review: Number(o.counts.review ?? 0),
      watch: Number(o.counts.watch ?? 0),
      contact_ready: Number(o.counts.contact_ready ?? 0),
      rejected_by_floor: Number(o.counts.rejected_by_floor ?? 0),
    },
    opportunity_shortfall: Number(o.shortfall?.opportunities ?? 0),
    opportunity_shortfall_reason: o.shortfall?.opportunity_reason ?? null,
    contact_ready_shortfall: Number(o.shortfall?.contact_ready ?? 0),
    contact_ready_shortfall_reason: o.shortfall?.contact_ready_reason ?? null,
    entries: Array.isArray(o.entries) ? o.entries.map((e: any) => ({
      rank: Number(e?.rank ?? 0),
      company_key: String(e?.company_key ?? ''),
      company_name: String(e?.company_name ?? ''),
      domain: e?.domain ?? null,
      tier: (e?.tier === 'A' || e?.tier === 'B' || e?.tier === 'C') ? e.tier : null,
      state: String(e?.state ?? 'watch') as PortfolioState,
      actionable: e?.actionable === true,
      reason: String(e?.reason ?? ''),
      source_url: e?.source_url ?? null,
      round: e?.round ?? null,
    })) : [],
  };
}

/**
 * Is the Workbench genuinely empty?
 *
 * FALSE whenever a portfolio entry or an evaluation row exists. Showing "No
 * results for this workflow yet" beside real evaluated companies is the claim
 * this guards against.
 */
export function workbenchIsEmpty(
  leadRows: number, evaluationRows: number, portfolio: PortfolioView | null,
): boolean {
  return leadRows === 0 && evaluationRows === 0 && (portfolio?.entries.length ?? 0) === 0;
}

/**
 * May the UI say the Company Brain rejected these companies?
 *
 * ONLY when it actually evaluated some. The audited run said "none passed
 * Company Brain" for seven companies it never looked at.
 */
export function brainActuallyEvaluated(p: PortfolioView | null): boolean {
  if (!p) return false;
  return p.counts.qualified + p.counts.review > 0;
}

export const STATE_LABEL: Readonly<Record<PortfolioState, string>> = Object.freeze({
  qualified: 'Qualified',
  review: 'Review',
  identity_unresolved_watch: 'Identity unresolved',
  watch: 'Watch',
});
