// Global top-N signal selection for the radar's default view. Pure, decoupled
// from the FeedSignal shape via accessors so it stays Deno-testable. The default
// radar shows the highest-scored VERIFIED signals across all sources (never
// unverified — enforced by the `verified` accessor at the call site).

export interface SelectTopOptions<T> {
  score: (t: T) => number;
  verified: (t: T) => boolean;
  createdAt?: (t: T) => string | null | undefined;
  limit?: number;
}

function ts(createdAt?: string | null): number {
  if (!createdAt) return 0;
  const t = Date.parse(createdAt);
  return Number.isNaN(t) ? 0 : t;
}

/** Verified only, highest score first, freshness as tie-breaker. */
export function selectTopSignals<T>(items: T[], opts: SelectTopOptions<T>): T[] {
  const limit = opts.limit ?? 10;
  return items
    .filter((t) => opts.verified(t))
    .sort((a, b) => {
      const d = opts.score(b) - opts.score(a);
      if (d !== 0) return d;
      return ts(opts.createdAt?.(b)) - ts(opts.createdAt?.(a));
    })
    .slice(0, limit);
}
