// ONE GATE EVERY PROVIDER REQUEST PASSES THROUGH.
//
// ── WHAT THIS FIXES ─────────────────────────────────────────────────────────
//
// `run-radar-scan` ran three categories under `Promise.all`, each firing its
// queries in a bare loop. Measured on the 2026-08-23 scan: 21 × HTTP 429 in
// 3.4 seconds — 6.2 requests/second, ~371/minute. Firecrawl's free tier is
// ~10/min and Hobby ~100/min, so the scan was rate-limiting ITSELF and would
// have done so on any key.
//
// That looked exactly like an exhausted account, which is why the first
// instinct was to replace the key. It was never a balance problem.
//
// ── WHY A SERIALISING GATE AND NOT A CONCURRENCY CAP ────────────────────────
//
// A concurrency cap of 1 still permits unlimited requests per minute — it only
// stops them overlapping. What a provider actually meters is RATE, so the gate
// enforces a minimum interval between request STARTS and lets the callers stay
// as concurrent as they like. Three parallel categories still work; they simply
// take their turns.
//
// ── AND WHY IT ALSO BOUNDS THE SCAN ─────────────────────────────────────────
//
// Spacing requests makes them slower, and an edge invocation has a wall clock.
// At 10 req/min a 30-search scan needs three minutes and would be killed
// mid-flight, losing everything it had collected. So the limiter can also say
// how many requests actually FIT in the time available, which the budget uses
// as a third ceiling beside the scan cap and the balance.
//
// PURE apart from the clock and the sleep, both injectable.

export const PROVIDER_RATE_LIMIT_VERSION = "provider-rate-limit-v1" as const;

/**
 * Requests per minute the radar assumes it may make.
 *
 * Deliberately conservative. 60/min is safe for Firecrawl Hobby and above and
 * still bursty enough to be useful; a Free-tier key needs `RADAR_PROVIDER_RPM`
 * set to 10 or the provider will refuse regardless of spacing.
 *
 * NOT auto-detected: guessing a tier from a 429 is how a scan silently halves
 * its own throughput after one bad minute.
 */
export const DEFAULT_PROVIDER_RPM = 60;

/** How long one scan may spend waiting on the gate before it must return. */
export const DEFAULT_SCAN_WALL_CLOCK_MS = 90_000;

export interface RateLimiterDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class ProviderRateLimiter {
  private nextFreeAt = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    /** Minimum milliseconds between request starts. */
    readonly minIntervalMs: number,
    deps: RateLimiterDeps = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  static fromRpm(rpm: number, deps: RateLimiterDeps = {}): ProviderRateLimiter {
    const safe = Number.isFinite(rpm) && rpm > 0 ? rpm : DEFAULT_PROVIDER_RPM;
    return new ProviderRateLimiter(Math.ceil(60_000 / safe), deps);
  }

  /**
   * Wait until this caller may issue its request.
   *
   * The slot is claimed BEFORE the wait, so concurrent callers queue behind one
   * another instead of all reading the same `nextFreeAt` and waking together —
   * which is the bug that turns a rate limiter into a delay that changes
   * nothing.
   */
  async acquire(): Promise<void> {
    const t = this.now();
    const slot = Math.max(t, this.nextFreeAt);
    this.nextFreeAt = slot + this.minIntervalMs;
    const wait = slot - t;
    if (wait > 0) await this.sleep(wait);
  }

  /**
   * A provider told us to wait. Push every queued caller back.
   *
   * Applied to the SHARED gate rather than to one request, because a 429 is a
   * statement about the account, not about the query that happened to hit it.
   * Retrying just that one while the others carry on at full speed is how a
   * rate limit becomes permanent.
   */
  backOff(ms: number): void {
    const t = this.now();
    this.nextFreeAt = Math.max(this.nextFreeAt, t + Math.max(0, ms));
  }

  /** How many requests fit in `budgetMs` at this spacing. Never negative. */
  capacityWithin(budgetMs: number): number {
    if (this.minIntervalMs <= 0) return Number.MAX_SAFE_INTEGER;
    return Math.max(0, Math.floor(budgetMs / this.minIntervalMs));
  }
}

/**
 * Seconds a provider asked us to wait, from a `Retry-After` header.
 *
 * Accepts the numeric form only. The HTTP-date form is legal and no provider
 * this codebase talks to sends it; parsing a date badly and waiting until 1970
 * is worse than falling back to a known default.
 *
 * Capped, because a provider replying `Retry-After: 3600` must not park an edge
 * invocation for an hour — the scan should give up and say why.
 */
export function parseRetryAfterMs(
  header: string | null | undefined, capMs = 15_000,
): number | null {
  if (!header) return null;
  const secs = Number(String(header).trim());
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.min(secs * 1000, capMs);
}

/**
 * Why a 429 happened, from the provider's own body.
 *
 * `http_429` alone cannot distinguish "you are going too fast" from "your
 * account is empty" — and those have opposite remedies. The first is ours to
 * fix by slowing down; the second needs a human to top up.
 *
 * Bounded and matched on a small vocabulary rather than echoed wholesale: a
 * provider error body can contain the request, and this string is logged.
 */
export function classifyRateLimitBody(body: string): "rate_limited" | "out_of_credits" | "unknown" {
  const b = body.toLowerCase();
  if (/insufficient|out of credit|no credits|quota exceeded|payment|billing|upgrade your plan/.test(b)) {
    return "out_of_credits";
  }
  if (/rate limit|too many requests|slow down|requests per/.test(b)) return "rate_limited";
  return "unknown";
}
