// What a radar scan actually did, in words (Signals recovery, Phase 4). A scan whose every source
// was "setup needed" or "skipped" RAN NOTHING — it must not read as "LISA added 0 new signals".
export interface RadarCategoryStatus { found?: number; accepted?: number; status?: string; reason?: string }
export interface RadarRunLike { inserted?: number; per_category?: Record<string, RadarCategoryStatus> | null; setup_required?: boolean }
export type RadarScanOutcome =
  | { kind: "added"; inserted: number; message: string }
  | { kind: "ran_empty"; message: string }
  | { kind: "nothing_ran"; reasons: string[]; message: string };

export function radarScanOutcome(r: RadarRunLike | null | undefined, agent = "LISA"): RadarScanOutcome {
  const cats = Object.entries(r?.per_category ?? {});
  const ran = cats.filter(([, c]) => c?.status === "ready");
  const inserted = Number(r?.inserted ?? 0);
  if (inserted > 0) return { kind: "added", inserted, message: `${agent} added ${inserted} new ${inserted === 1 ? "signal" : "signals"}.` };
  if (!ran.length) {
    const reasons = [...new Set(cats.map(([k, c]) => c?.reason ? `${k.replace(/_/g, " ")}: ${c.reason}` : `${k.replace(/_/g, " ")}: not available`))];
    return { kind: "nothing_ran", reasons,
      message: `Nothing ran — no signal source is configured for this workspace${reasons.length ? ` (${reasons.slice(0, 3).join("; ")})` : ""}. No credits were used.` };
  }
  return { kind: "ran_empty", message: `${agent} scanned ${ran.length} ${ran.length === 1 ? "source" : "sources"} and found no new signals that pass your Company Brain's rules.` };
}
