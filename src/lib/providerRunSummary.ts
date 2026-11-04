// What each data provider contributed to ONE discovery run — the view of the
// backend's `providerSummary` (strategy_run response, provider-run-summary-v1).
//
// Every figure shown comes from the backend summary as-is: this module only
// checks the shape and formats. It never counts leads, adds spend or derives a
// rate itself, so the dashboard can never disagree with the run it reports.
// A response without a valid summary yields null (nothing is shown) — never a
// guessed or zero-filled one.

export const PROVIDER_RUN_SUMMARY_VERSION = 'provider-run-summary-v1' as const;

export interface ProviderContribution {
  provider: string;
  discovered: number; unique: number; qualified: number; pending: number; rejected: number;
  steps: { capability: string; status: string; reason: string | null }[];
  failed: boolean;
  spend: { leadoceanRecords: number; apifyUsd: number };
}
export interface ProviderRunSummary {
  version: typeof PROVIDER_RUN_SUMMARY_VERSION;
  strategy: string | null;
  totals: { companies: number; qualified: number; pending: number; rejected: number; foundByMultiple: number; costPerQualifiedUsd: number | null };
  providers: ProviderContribution[];
  evidenceSources: Record<string, number>;
  evidenceRefused: number;
  conflicts: Record<string, number>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isCounts = (v: unknown): v is Record<string, number> => isObj(v) && Object.values(v).every(isCount);

/** The backend summary, if the response carries a valid one; otherwise null. */
export function readProviderRunSummary(response: unknown): ProviderRunSummary | null {
  const s = isObj(response) ? response.providerSummary : null;
  if (!isObj(s) || s.version !== PROVIDER_RUN_SUMMARY_VERSION) return null;
  const t = s.totals;
  if (!isObj(t) || !['companies', 'qualified', 'pending', 'rejected', 'foundByMultiple'].every((k) => isCount(t[k]))) return null;
  if (!(t.costPerQualifiedUsd === null || isAmount(t.costPerQualifiedUsd))) return null;
  if (!(s.strategy === null || typeof s.strategy === 'string')) return null;
  if (!Array.isArray(s.providers) || !isCounts(s.evidenceSources) || !isCount(s.evidenceRefused) || !isCounts(s.conflicts)) return null;
  for (const p of s.providers as unknown[]) {
    if (!isObj(p) || typeof p.provider !== 'string' || typeof p.failed !== 'boolean') return null;
    if (!['discovered', 'unique', 'qualified', 'pending', 'rejected'].every((k) => isCount(p[k]))) return null;
    if (!isObj(p.spend) || !isCount(p.spend.leadoceanRecords) || !isAmount(p.spend.apifyUsd)) return null;
    if (!Array.isArray(p.steps) || !(p.steps as unknown[]).every((x) => isObj(x) && typeof x.capability === 'string' && typeof x.status === 'string' && (x.reason === null || typeof x.reason === 'string'))) return null;
  }
  return s as unknown as ProviderRunSummary;
}

export const PROVIDER_LABEL: Record<string, string> = { apify: 'Apify', leadocean: 'LeadOcean', apollo: 'Apollo' };
const nameOf = (p: string) => PROVIDER_LABEL[p] ?? p;

/** "$0.0311": four decimals under a dollar (these runs cost cents), two above. */
export const usd = (n: number) => `$${n.toFixed(n >= 1 ? 2 : 4)}`;

export function spendLine(spend: { leadoceanRecords: number; apifyUsd: number }): string {
  const parts = [spend.apifyUsd > 0 ? `${usd(spend.apifyUsd)} Apify` : null, spend.leadoceanRecords > 0 ? `${spend.leadoceanRecords} LeadOcean record${spend.leadoceanRecords === 1 ? '' : 's'}` : null].filter(Boolean);
  return parts.length ? parts.join(' + ') : 'no spend';
}

/** One row per provider, in the backend's order. */
export function contributionRows(s: ProviderRunSummary) {
  return s.providers.map((p) => ({
    provider: p.provider, label: nameOf(p.provider),
    discovered: p.discovered, unique: p.unique, qualified: p.qualified, pending: p.pending, rejected: p.rejected,
    spend: spendLine(p.spend), failed: p.failed,
    failures: p.steps.filter((x) => x.status === 'failed').map((x) => `${x.capability}: ${x.reason ?? 'failed'}`),
    partial: p.steps.filter((x) => x.status === 'partial' || x.status === 'skipped').map((x) => `${x.capability}: ${x.reason ?? x.status}`),
  }));
}

export function totalsLine(s: ProviderRunSummary): string {
  const t = s.totals;
  return `${t.companies} compan${t.companies === 1 ? 'y' : 'ies'} · ${t.qualified} qualified · ${t.pending} pending · ${t.rejected} rejected`
    + (t.foundByMultiple ? ` · ${t.foundByMultiple} found by more than one provider` : '');
}

/** Disagreements kept for verification ("industry ×1"); empty when the providers agreed. */
export function conflictsLine(s: ProviderRunSummary): string | null {
  const e = Object.entries(s.conflicts).filter(([, n]) => n > 0);
  return e.length ? `Providers disagree on ${e.map(([f, n]) => `${f.replace(/_/g, ' ')} ×${n}`).join(', ')} (both values kept)` : null;
}
