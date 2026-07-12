// Collapsible "Scan details" panel — per-source diagnostics with honest readiness.
// Explains every zero (never an unexplained blank).
import { useState } from "react";
import { ChevronDown, ChevronRight, Activity } from "lucide-react";
import type { SourceDiagnostic } from "@/hooks/useSignalFeed";
import { readinessLabel, sourceLabel, type ReadinessTone } from "@/lib/radarDiagnosticsView";

const TONE: Record<ReadinessTone, string> = {
  good: "border-emerald-500/30 text-emerald-300",
  warn: "border-amber-500/30 text-amber-300",
  bad: "border-rose-500/30 text-rose-300",
  neutral: "border-white/10 text-neutral-400",
};

export default function ScanDetailsPanel({ diagnostics, scanRunId, ranAt }: { diagnostics?: SourceDiagnostic[]; scanRunId?: string; ranAt?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!diagnostics || diagnostics.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card/40">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-foreground">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Activity className="h-4 w-4 text-primary" /> Scan details
        {scanRunId && <span className="ml-2 text-[11px] font-normal text-muted-foreground">run {scanRunId.slice(0, 8)}{ranAt ? ` · ${new Date(ranAt).toLocaleString()}` : ""}</span>}
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2">
          {diagnostics.map((d) => {
            const r = readinessLabel(d.readiness);
            const reasons = Object.entries(d.rejection_reasons ?? {});
            return (
              <div key={d.source} className="rounded-lg border border-border/60 bg-background/30 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground">{sourceLabel(d.source)}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${TONE[r.tone]}`}>{r.label}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                    {(d.accepted_count ?? 0)} accepted · {(d.verified_count ?? 0)} verified · {(d.rejected_count ?? 0)} rejected
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                  <span>raw {d.raw_count ?? 0}</span>
                  <span>needs review {d.needs_review_count ?? 0}</span>
                  {typeof d.elapsed_ms === "number" && <span>{d.elapsed_ms}ms</span>}
                  {typeof d.provider_items_consumed === "number" && d.provider_items_consumed > 0 && <span>{d.provider_items_consumed} items</span>}
                </div>
                {d.provider_error && <p className="mt-1 text-[11px] text-rose-300">{d.provider_error}</p>}
                {reasons.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">Rejections: {reasons.map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}</p>
                )}
                {(d.queries_attempted?.length ?? 0) > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground/70 truncate">Queries: {d.queries_attempted!.slice(0, 3).join(" · ")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
