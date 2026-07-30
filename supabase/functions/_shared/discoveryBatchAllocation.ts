// SPLITTING ONE DISCOVERY BATCH ACROSS QUERY PACKS.
//
// A future Claude strategy will carry several bounded query packs instead of one
// Boolean query. This module makes the EXECUTION layer able to consume them
// safely; it does not generate them.
//
// The hazard it exists to prevent is specific. Providers differ in what their
// result limit means: Indeed's `maxItems` and Glassdoor's `limit` cap the RUN,
// while Crawlworks' `jobsToFetch` applies per search URL (up to three). Handing
// three packs a per-URL limit of 24 each would request 72 rows while the accounting
// believed it had asked for 24 — an unbounded multiplication of both volume and
// cost. So the interpretation is an explicit input here, never an assumption.
//
// PURE. No network, model, provider or environment access.

/** What the provider's result limit actually bounds. */
export type ProviderLimitScope =
  /** One cap for the whole run — Indeed `maxItems`, Glassdoor `limit`, YC `maxResults`. */
  | "per_run"
  /** Applied to each search URL or query — Crawlworks `jobsToFetch`. */
  | "per_query";

/** Below this a pack cannot clear a funnel, so it is not worth issuing. */
export const MINIMUM_PACK_ALLOCATION = 4;

export interface PackAllocationInput {
  /** The total the batch authority approved for this source. */
  totalBatch: number;
  /** Eligible pack ids, highest priority first. */
  packIds: string[];
  scope: ProviderLimitScope;
  /** The capability's own ceiling, applied to whatever the provider limit bounds. */
  providerMaximum: number;
  /** Crawlworks accepts at most 3 search URLs; absent means no separate cap. */
  maximumQueries?: number | null;
}

export interface PackAllocation {
  packId: string;
  allocatedResults: number;
}

export interface PackAllocationDecision {
  allocations: PackAllocation[];
  /** Packs dropped because the batch could not fund them meaningfully. */
  droppedPackIds: string[];
  /**
   * Rows the provider will actually be asked for across every pack.
   *
   * For `per_query` this is allocation × packs — the number that matters for cost,
   * and the one a per-run reading would have understated.
   */
  effectiveTotalRequested: number;
  scope: ProviderLimitScope;
  reason: "single_pack" | "even_split" | "floored_and_trimmed" | "no_packs" | "empty_batch";
}

/**
 * Distribute a batch across packs deterministically.
 *
 * Even split, remainder to the highest-priority packs, then a floor: a pack that
 * cannot be funded to `MINIMUM_PACK_ALLOCATION` is dropped rather than issued as a
 * token query that costs a call and returns nothing useful. Dropping is recorded.
 */
export function allocateBatchAcrossPacks(input: PackAllocationInput): PackAllocationDecision {
  const scope = input.scope;
  const providerMaximum = Math.max(1, Math.trunc(input.providerMaximum));
  const total = Math.max(0, Math.trunc(input.totalBatch));
  const packIds = input.packIds.filter((p) => typeof p === "string" && p.length > 0);

  if (total === 0) {
    return { allocations: [], droppedPackIds: packIds, effectiveTotalRequested: 0, scope, reason: "empty_batch" };
  }
  if (packIds.length === 0) {
    return { allocations: [], droppedPackIds: [], effectiveTotalRequested: 0, scope, reason: "no_packs" };
  }

  // A per-query limit is also bounded by how many queries the actor accepts.
  const maxPacks = scope === "per_query" && Number.isFinite(input.maximumQueries) && (input.maximumQueries as number) > 0
    ? Math.min(packIds.length, Math.trunc(input.maximumQueries as number))
    : packIds.length;
  const kept = packIds.slice(0, maxPacks);
  const droppedForQueryCap = packIds.slice(maxPacks);

  if (kept.length === 1) {
    const only = Math.min(total, providerMaximum);
    return {
      allocations: [{ packId: kept[0], allocatedResults: only }],
      droppedPackIds: droppedForQueryCap,
      effectiveTotalRequested: only,
      scope,
      reason: "single_pack",
    };
  }

  // PER-QUERY: the total is what we want IN AGGREGATE, so each pack gets a share.
  // PER-RUN: the same arithmetic, and the shares sum back to the total.
  const share = Math.floor(total / kept.length);
  let remainder = total - share * kept.length;

  const funded: PackAllocation[] = [];
  const dropped: string[] = [...droppedForQueryCap];
  for (const packId of kept) {
    let allocated = share + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    allocated = Math.min(allocated, providerMaximum);
    if (allocated < MINIMUM_PACK_ALLOCATION) { dropped.push(packId); continue; }
    funded.push({ packId, allocatedResults: allocated });
  }

  // Everything was below the floor: fund the single highest-priority pack rather
  // than issuing nothing at all.
  if (funded.length === 0) {
    const only = Math.min(Math.max(total, MINIMUM_PACK_ALLOCATION), providerMaximum);
    return {
      allocations: [{ packId: kept[0], allocatedResults: only }],
      droppedPackIds: [...kept.slice(1), ...droppedForQueryCap],
      effectiveTotalRequested: only,
      scope,
      reason: "floored_and_trimmed",
    };
  }

  const effective = funded.reduce((n, a) => n + a.allocatedResults, 0);
  return {
    allocations: funded,
    droppedPackIds: dropped,
    effectiveTotalRequested: effective,
    scope,
    reason: dropped.length > 0 ? "floored_and_trimmed" : "even_split",
  };
}

/** The safe record of one allocation. Ids and integers only. */
export function packAllocationDiagnostics(d: PackAllocationDecision): Record<string, unknown> {
  return {
    provider_limit_scope: d.scope,
    query_pack_count: d.allocations.length,
    allocations: d.allocations.map((a) => ({ pack_id: a.packId, allocated_results: a.allocatedResults })),
    dropped_pack_ids: d.droppedPackIds,
    effective_total_requested: d.effectiveTotalRequested,
    allocation_reason: d.reason,
  };
}
