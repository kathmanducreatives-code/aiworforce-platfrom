// PHASE 5 — SITUATIONS, NOT ROWS.
//
// "Acme raised, and is hiring SDRs, and launched something" is one thing a
// person acts on. The feed showed it as three rows scored separately, so the
// thing worth acting on was the one thing the feed could not say.
//
// ── WHAT THIS SHOWS, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────
//
// Only MULTI-SIGNAL situations. A cluster of one is a row, and the feed below
// already shows rows well; repeating them here would be a second feed rather
// than a summary.
//
// It states how much of a situation is DATED. Every signal event written so far
// carries `occurred_at_basis: unknown`, which means the times are observations
// — when we looked, not when it happened. A strip that showed "3 signals this
// week" without that distinction would be claiming something nobody
// established.
import { Layers, Clock, ShieldCheck, Sparkles } from "lucide-react";
import type { SignalCluster } from "../../../supabase/functions/_shared/signalCluster.ts";
import type { ClusterRelevanceRow } from "@/lib/signalEventsFeed";

/** Canonical type → what a reader calls it. Never invents a label it lacks. */
const SIGNAL_LABEL: Record<string, string> = {
  sales_hiring: "Hiring",
  revops_hiring: "RevOps hiring",
  growth_hiring: "Growth hiring",
  new_revenue_leader: "New revenue leader",
  recent_funding: "Funding",
  employee_growth: "Headcount growth",
  market_expansion: "Expansion",
  geographic_expansion: "Geographic expansion",
  product_launch: "Product launch",
  major_release: "Major release",
  new_integration: "New integration",
  category_expansion: "Category expansion",
  competitor_activity: "Competitor activity",
  market_problem_discussion: "Market conversation",
  positioning_change: "Positioning change",
  outbound_initiative: "Outbound initiative",
};

const label = (t: string) =>
  SIGNAL_LABEL[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** A subject key is a slug. Show it as a name without pretending to resolve it. */
function subjectName(c: SignalCluster): string {
  const k = c.subject_key ?? c.account_id ?? "Unknown";
  return k
    .replace(/^linkedin-com-company-/, "")
    .replace(/-com$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

const KIND_TINT: Record<string, string> = {
  company: "border-emerald-500/25 bg-emerald-500/[0.04]",
  competitor: "border-amber-500/25 bg-amber-500/[0.04]",
  market: "border-sky-500/25 bg-sky-500/[0.04]",
};

/** How a band reads to somebody scanning the feed. */
const BAND_LABEL: Record<string, string> = {
  high: "High priority", medium: "Worth a look", low: "Low relevance", none: "Not relevant",
};
const BAND_TINT: Record<string, string> = {
  high: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  medium: "text-sky-300 border-sky-500/30 bg-sky-500/10",
  low: "text-neutral-400 border-border bg-muted/30",
  none: "text-neutral-500 border-border bg-muted/20",
};

export interface SituationStripProps {
  clusters: SignalCluster[];
  /**
   * Relevance verdicts by cluster key.
   *
   * ABSENT IS THE ORDINARY CASE, not an error: no judge has read this cluster
   * yet, or the model was unavailable. The strip then shows exactly what it
   * showed before Phase 7 — the deterministic situation, unexplained.
   */
  relevance?: Record<string, ClusterRelevanceRow>;
  /** Called with the cluster's subject so the feed can filter to it. */
  onFocus?: (c: SignalCluster) => void;
}

export default function SituationStrip({
  clusters, relevance = {}, onFocus,
}: SituationStripProps) {
  // A CLUSTER OF ONE IS A ROW. Only situations belong here.
  const situations = clusters
    .filter((c) => c.signal_types.length > 1)
    // ORDERED BY THE JUDGED PRIORITY WHERE ONE EXISTS, and by the deterministic
    // one where it does not. A verdict can only lower a cluster, so this can
    // reorder within the evidence's ceiling and never above it.
    .sort((a, b) =>
      (relevance[b.key]?.adjusted_priority ?? b.priority) -
        (relevance[a.key]?.adjusted_priority ?? a.priority) ||
      b.priority - a.priority || a.key.localeCompare(b.key));
  if (situations.length === 0) return null;

  return (
    <section className="mb-5" aria-label="Situations">
      <div className="mb-2 flex items-center gap-2">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">
          {situations.length === 1 ? "1 situation" : `${situations.length} situations`}
        </h2>
        <span className="text-xs text-muted-foreground">
          companies showing more than one signal
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {situations.map((c) => {
          const undated = c.timing.occurred === 0;
          const r = relevance[c.key];
          const judged = r && r.source === "model";
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onFocus?.(c)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-foreground/30 ${
                KIND_TINT[c.subject_type ?? ""] ?? "border-border bg-muted/20"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{subjectName(c)}</span>
                {judged
                  ? (
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${
                        BAND_TINT[r.relevance] ?? BAND_TINT.low
                      }`}
                    >
                      {BAND_LABEL[r.relevance] ?? r.relevance}
                    </span>
                  )
                  : (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {c.subject_type ?? "subject"}
                    </span>
                  )}
              </div>

              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.signal_types.map((t) => (
                  <span
                    key={t}
                    className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[11px]"
                  >
                    {label(t)}
                  </span>
                ))}
              </div>

              {/* ── THE GROUNDED EXPLANATION ─────────────────────────────
                  Shown only for a verdict the validator believed, and every
                  claim in it cites an event this cluster actually contains. A
                  refused verdict shows nothing rather than a hedge. */}
              {judged && (r.why_now || r.why_it_matters) && (
                <div className="mt-2 space-y-1 border-l-2 border-border/60 pl-2">
                  {r.why_now && (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      <span className="font-medium text-foreground/80">Why now: </span>
                      {r.why_now}
                    </p>
                  )}
                  {r.why_it_matters && (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      <span className="font-medium text-foreground/80">Why it matters: </span>
                      {r.why_it_matters}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {/* THE HONEST TIME WORD. Nothing here carries a source date. */}
                  {undated
                    ? `${c.events.length} signals seen`
                    : `${c.timing.occurred} dated · ${c.timing.observed_only} seen`}
                </span>
                {judged && (
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    {r.evidence_event_ids.length} cited
                  </span>
                )}
                {c.events.some((e) => e.verification_status === "provider_verified") && (
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    verified evidence
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
