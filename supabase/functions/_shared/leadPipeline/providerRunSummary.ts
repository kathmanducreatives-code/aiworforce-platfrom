// WHAT EACH PROVIDER CONTRIBUTED TO ONE DISCOVERY RUN — the auditable numbers a dashboard
// shows (provider evaluation, Phase 7). Pure: computed from the run itself, never re-derived
// or estimated. A company found by several providers counts ONCE in the totals and once in
// each provider's own "discovered"; "unique" is what no other provider found.
import type { StrategyRun } from "./multiProvider.ts";

export const PROVIDER_RUN_SUMMARY_VERSION = "provider-run-summary-v1" as const;

type Lead = StrategyRun["queue"][number];
export interface ProviderSummary {
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
  providers: ProviderSummary[];
  /** Evidence sources the qualification decisions cite, with how many companies cite each. */
  evidenceSources: Record<string, number>;
  /** Evidence a source offered and the identity rule refused. */
  evidenceRefused: number;
  /** Companies whose providers disagree on a field (kept for verification), by field. */
  conflicts: Record<string, number>;
}

export function summarizeProviderRun(run: StrategyRun): ProviderRunSummary {
  const leads: { l: Lead; verdict: "qualified" | "pending" | "rejected" }[] = [
    ...run.queue.map((l) => ({ l, verdict: l.statuses.qualification === "eligible" ? "qualified" as const : "pending" as const })),
    ...run.review.map((l) => ({ l, verdict: l.statuses.qualification === "ineligible" ? "rejected" as const : "pending" as const })),
    ...run.excluded.map((l) => ({ l, verdict: "rejected" as const })),
  ];
  const providersOf = (l: Lead) => [...new Set(l.provenance.providers)];
  const names = [...new Set([...run.steps.map((s) => s.provider), ...leads.flatMap((x) => providersOf(x.l))])].sort();
  const count = (pred: (x: typeof leads[number]) => boolean) => leads.filter(pred).length;
  const qualified = count((x) => x.verdict === "qualified");
  const sources: Record<string, number> = {};
  for (const { l } of leads) {
    const es = (l.qualification?.evidence_sources ?? {}) as unknown;
    const names = Array.isArray(es) ? es.map(String) : Object.keys(es as Record<string, unknown>);
    for (const s of new Set(names)) sources[s] = (sources[s] ?? 0) + 1;
  }
  const totalUsd = run.spend.apifyUsd;
  return {
    version: PROVIDER_RUN_SUMMARY_VERSION, strategy: run.strategy,
    totals: {
      companies: leads.length, qualified, pending: count((x) => x.verdict === "pending"), rejected: count((x) => x.verdict === "rejected"),
      foundByMultiple: count((x) => providersOf(x.l).length > 1),
      costPerQualifiedUsd: qualified ? Math.round((totalUsd / qualified) * 1e6) / 1e6 : null,
    },
    providers: names.map((p) => {
      const mine = leads.filter((x) => providersOf(x.l).includes(p));
      const steps = run.steps.filter((s) => s.provider === p);
      return {
        provider: p, discovered: mine.length, unique: mine.filter((x) => providersOf(x.l).length === 1).length,
        qualified: mine.filter((x) => x.verdict === "qualified").length, pending: mine.filter((x) => x.verdict === "pending").length,
        rejected: mine.filter((x) => x.verdict === "rejected").length,
        steps: steps.map((s) => ({ capability: s.capability, status: s.status, reason: s.reason })),
        failed: steps.some((s) => s.status === "failed"),
        spend: steps.reduce((a, s) => ({ leadoceanRecords: a.leadoceanRecords + s.spend.leadoceanRecords, apifyUsd: Math.round((a.apifyUsd + s.spend.apifyUsd) * 1e6) / 1e6 }), { leadoceanRecords: 0, apifyUsd: 0 }),
      };
    }),
    evidenceSources: sources, evidenceRefused: run.evidenceRefused.length,
    conflicts: leads.flatMap(({ l }) => (l.provenance.conflicts ?? []).map((c) => c.field))
      .reduce((a, f) => ({ ...a, [f]: (a[f] ?? 0) + 1 }), {} as Record<string, number>),
  };
}
