// PHASE 3G — THE CANONICAL ROW, PROJECTED FOR THE FEED.
//
// ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
//
// Pure and import-free, exactly like `signalFeedModel`, so the projection can
// be unit-tested without a Supabase client, a React tree or a network. The data
// access lives in `signalEventsFeed.ts`; everything that DECIDES anything lives
// here.
//
// The FeedSignal shape is unchanged and so is every card that renders it. This
// is a projection, not a redesign: it produces exactly what `normalizeSignalRow`
// produces, from the canonical row instead of the legacy one — and it does so
// BY CALLING that function, so quality classification, badges and why-text
// cannot drift between the two readers.

import {
  normalizeSignalRow, signalTypeLabel,
  type FeedSignal, type RawSignalRow,
} from "./signalFeedModel.ts";

/** A row of the canonical store, as the feed reads it. */
export interface RawSignalEventRow {
  id?: string;
  workspace_id?: string;
  signal_type?: string | null;
  signal_category?: string | null;
  origin?: string | null;
  subject_type?: string | null;
  subject_key?: string | null;
  occurred_at?: string | null;
  occurred_at_basis?: string | null;
  observed_at?: string | null;
  verification_status?: string | null;
  confidence?: string | null;
  provider?: string | null;
  source_url?: string | null;
  legacy_signal_id?: string | null;
  normalized_value?: Record<string, unknown> | null;
}

export const EVENT_COLUMNS =
  "id, workspace_id, signal_type, signal_category, origin, subject_type, subject_key, " +
  "occurred_at, occurred_at_basis, observed_at, verification_status, confidence, " +
  "provider, source_url, legacy_signal_id, normalized_value";

/**
 * How a canonical type reads in the feed.
 *
 * The canonical vocabulary is the store's, not the UI's. Where a row was mapped
 * from a Radar signal it also carries `radar_signal_type`, and that is what the
 * existing cards route on — so it is preferred when present, and the canonical
 * type is the honest fallback for a row no Radar scan produced.
 */
export function feedSignalTypeOf(row: RawSignalEventRow): string {
  const nv = (row.normalized_value ?? {}) as Record<string, unknown>;
  const radar = typeof nv.radar_signal_type === "string" ? nv.radar_signal_type.trim() : "";
  return radar || (row.signal_type ?? "signal");
}

/**
 * Project a canonical row into the shape the feed already renders.
 *
 * It routes through `normalizeSignalRow` rather than rebuilding the projection,
 * so quality classification, badges and the "why" text stay in ONE place. A
 * second copy would drift the first time either changed.
 */
export function normalizeSignalEventRow(row: RawSignalEventRow): FeedSignal {
  const nv = (row.normalized_value ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  const asLegacyShape: RawSignalRow = {
    id: row.id,
    workspace_id: row.workspace_id,
    signal_type: feedSignalTypeOf(row),
    signal_label: null,
    title: str(nv.title) ?? signalTypeLabel(feedSignalTypeOf(row)),
    description: str(nv.description),
    source_url: row.source_url ?? null,
    source: row.provider ?? null,
    // WHEN AGENTORY SAW IT, never when it happened. `occurred_at` is null on
    // any row whose basis is `unknown`, and the feed orders by what it can
    // actually know — which is the observation.
    created_at: row.observed_at ?? null,
    raw: {
      // Everything the cards read, carried by the canonical row itself.
      ...nv,
      // A competitor subject IS the competitor's identity. Nothing is inferred
      // from prose here; the subject model already resolved it.
      ...(row.subject_type === "competitor" && row.subject_key
        ? { competitor_name: str(nv.company_name) ?? row.subject_key }
        : {}),
      ...(str(nv.company_name) ? { company_name: nv.company_name } : {}),
      ...(str(nv.company_location) ? { location: nv.company_location } : {}),
      ...(str(nv.why_it_matters) ? { why_it_matters: nv.why_it_matters } : {}),
      signal_quality: nv.radar_signal_quality ?? null,
      // PROVENANCE, SURFACED. The one thing the v1 row could never say: which
      // workflow collected this.
      origin: row.origin ?? null,
      subject_type: row.subject_type ?? null,
      subject_key: row.subject_key ?? null,
      occurred_at_basis: row.occurred_at_basis ?? null,
      verification_status: row.verification_status ?? null,
    },
  };
  return normalizeSignalRow(asLegacyShape);
}

/**
 * Merge the canonical rows with the legacy rows they do not account for.
 *
 * ── WHY A UNION AND NOT A SWITCH ────────────────────────────────────────────
 *
 * The dual-write began partway through the project's life, so `signal_events`
 * has no row for anything collected before it. Reading only the canonical store
 * would make those signals silently vanish from a feed that showed them
 * yesterday — which is indistinguishable, to the person looking at it, from
 * having lost them.
 *
 * The join is EXACT, not a heuristic: every canonical row mapped from a legacy
 * one carries `legacy_signal_id`, so a legacy row is covered iff some canonical
 * row points at it. Nothing is matched on title, URL or time.
 *
 * The coverage numbers come back with the feed so the switch is a fact somebody
 * can read rather than an assumption.
 */
export function mergeSignalFeed(
  events: readonly RawSignalEventRow[],
  legacy: readonly RawSignalRow[],
): { signals: FeedSignal[]; canonical: number; legacy_only: number } {
  const covered = new Set(
    events.map((r) => r.legacy_signal_id).filter((x): x is string => !!x),
  );
  const uncovered = legacy.filter((r) => r.id && !covered.has(r.id));
  const signals = [
    ...events.map(normalizeSignalEventRow),
    ...uncovered.map(normalizeSignalRow),
  ].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return { signals, canonical: events.length, legacy_only: uncovered.length };
}
