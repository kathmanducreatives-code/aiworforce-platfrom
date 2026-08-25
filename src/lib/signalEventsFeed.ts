// PHASE 3G — THE FEED READS THE CANONICAL STORE.
//
// ── WHAT CHANGED, AND WHAT DELIBERATELY DID NOT ─────────────────────────────
//
// The feed read `signals`, the v1 table Radar writes. It now reads
// `signal_events`, the shared canonical store that Radar, Lead missions and
// monitoring all write to — which is what makes a Signals feed show
// intelligence the workspace collected, whatever collected it.
//
// The FeedSignal shape is unchanged, and so is every card that renders it. This
// module is a projection, not a redesign: `normalizeSignalEventRow` produces
// exactly what `normalizeSignalRow` produces, from the canonical row instead of
// the legacy one.
//
// ── WHY THE LEGACY ROWS ARE STILL READ ──────────────────────────────────────
//
// The dual-write began partway through the project's life, so `signal_events`
// has no row for anything collected before it. Switching outright would make
// those signals silently vanish from a feed that showed them yesterday.
//
// So the read is a UNION with an exact join, not a guess: every v2 row carries
// `legacy_signal_id`, so a v1 row is covered iff some v2 row points at it. The
// uncovered ones are carried through as legacy — a state the feed model already
// has a name and a badge for — and `signalFeedParity` reports the split so the
// coverage is a number somebody can look at rather than an assumption.

import { supabase } from "@/integrations/supabase/client";
import { normalizeSignalRow, type RawSignalRow } from "@/lib/signalFeedModel";
import {
  mergeSignalFeed, EVENT_COLUMNS, type RawSignalEventRow,
} from "@/lib/signalEventProjection";
// ── IMPORTED, NOT MIRRORED ────────────────────────────────────────────────
//
// `signalCluster` is pure and import-free, so the browser can use the SAME file
// the edge runtime does. The codebase's other cross-runtime modules are
// mirrored into `src/`, and a mirror is a second copy that drifts — which is
// the failure this phase's own join key exists to avoid. Phase 9's Content
// consumer reads this exact structure, so there must be exactly one of it.
import {
  clusterSignalEvents, type SignalCluster,
} from "../../supabase/functions/_shared/signalCluster.ts";

export interface SignalFeedResult {
  signals: FeedSignal[];
  /**
   * The same intelligence, grouped into situations.
   *
   * Built from the CANONICAL rows, not from the projected feed shape: a cluster
   * groups on `account_id` or the subject pair, and the projection keeps
   * neither. Legacy rows do not participate — they carry no subject model, so
   * there is nothing to correlate them on, and inventing one would merge
   * companies.
   */
  clusters: SignalCluster[];
  /** What the feed is actually made of, so the switch is inspectable. */
  coverage: {
    canonical: number;
    /** v1 rows with no canonical counterpart — collected before the dual-write. */
    legacy_only: number;
    source: "signal_events" | "signals";
  };
}

/**
 * The feed, canonical-first.
 *
 * Falls back to `signals` ONLY when the canonical read fails — a table that is
 * missing or refused by RLS must not empty a working feed. A canonical read
 * that legitimately returns zero rows is NOT a failure and does not fall back:
 * a workspace that has collected nothing has an empty feed, and saying
 * otherwise by silently showing stale legacy rows would be worse.
 */
export async function fetchSignalFeed(
  workspaceId: string, limit = 100,
): Promise<SignalFeedResult> {
  const { data: events, error } = await supabase
    .from("signal_events" as never)
    .select(EVENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("lifecycle_status", "active")
    .order("observed_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("fetchSignalFeed: canonical read failed, falling back", error);
    const legacy = await fetchLegacySignals(workspaceId, limit);
    return {
      signals: legacy.map(normalizeSignalRow),
      // NO CANONICAL ROWS, NO SITUATIONS. A legacy row carries no subject
      // model, so correlating one would mean inventing an identity for it.
      clusters: [],
      coverage: { canonical: 0, legacy_only: legacy.length, source: "signals" },
    };
  }

  const rows = (events ?? []) as unknown as RawSignalEventRow[];
  const legacy = await fetchLegacySignals(workspaceId, limit);
  const merged = mergeSignalFeed(rows, legacy);

  return {
    signals: merged.signals.slice(0, limit),
    clusters: clusterSignalEvents(rows as never, { window_days: 90 }).clusters,
    coverage: {
      canonical: merged.canonical,
      legacy_only: merged.legacy_only,
      source: "signal_events",
    },
  };
}

async function fetchLegacySignals(
  workspaceId: string, limit: number,
): Promise<RawSignalRow[]> {
  const { data, error } = await supabase
    .from("signals" as never)
    .select("id, workspace_id, signal_type, signal_label, title, description, source_url, source, created_at, conversation_id, plan_id, raw")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("fetchLegacySignals", error);
    return [];
  }
  return (data ?? []) as unknown as RawSignalRow[];
}
