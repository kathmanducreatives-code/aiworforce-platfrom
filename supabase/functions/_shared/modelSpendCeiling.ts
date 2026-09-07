// A WORKSPACE CANNOT SPEND WITHOUT LIMIT ON MODELS.
//
// ── THE HOLE THIS CLOSES ───────────────────────────────────────────────────
//
// `toolRegistry` gates exactly two things: `PAID_TOOLS = {source_with_apify,
// scrape_url}`. Those reserve credits, write a ledger row, and settle. Model
// calls do none of it. The lead engine bounds itself per run — `calls_allowed`,
// `MAX_COMPILATION_ATTEMPTS`, the investigation budget — but chat has no
// ceiling of any kind, so a user in a loop is an unbounded bill.
//
// ── WHY NOT CREDITS ────────────────────────────────────────────────────────
//
// The obvious move is `authorizeProviderCall` with a new `model_call` kind. It
// is the wrong instrument. `CREDITS_PER_PROVIDER_CALL = 1`, and lineage
// `ab06540f` made over a hundred model calls against thirty-nine Apify calls —
// so a credit would stop meaning "a paid provider run" and start meaning
// "either a LinkedIn scrape or one sentence of chat", and every existing
// balance would silently revalue. It also needs the `kind` CHECK widened, and
// this file's neighbours record two separate outages caused by sending a value
// a CHECK did not permit.
//
// Models are priced per token, not per call, and `lead_model_calls` already
// carries `workspace_id`, `estimated_cost_usd`, `actual_cost_usd` and
// `cost_source` for every call the lead engine makes. The ceiling is therefore
// a SUM OVER MONEY ALREADY RECORDED, which is also the shape `monitoring_
// budgets` uses (`period_ceiling` + `period_days`) for the same problem.
//
// ── A CEILING OVER UNRECORDED SPEND IS THEATRE ─────────────────────────────
//
// This only works on calls that reach `lead_model_calls`. 255 of the 256 rows
// there belong to the lead engine; chat writes to `activity_feed` with no token
// counts and no cost at all. So capture comes first and enforcement second, and
// `unpriced_calls` below exists to make the remaining blind spot loud instead
// of letting it read as $0.00 and a clean bill of health.

/** Env knob, mirroring `LEAD_CREDIT_ENFORCEMENT`. */
export const MODEL_SPEND_ENFORCEMENT_ENV = "MODEL_SPEND_ENFORCEMENT";
export const MODEL_SPEND_CEILING_ENV = "MODEL_SPEND_CEILING_USD";
export const MODEL_SPEND_PERIOD_ENV = "MODEL_SPEND_PERIOD_DAYS";

export const MODEL_SPEND_CEILING_VERSION = "model-spend-ceiling-v1" as const;

/**
 * OBSERVE UNTIL PROVEN, which is how credit enforcement was introduced here.
 *
 * A ceiling that refuses on its first day, computed from a meter that has never
 * run in production, would take the one working product down to fix a bill
 * nobody has yet received. `observe` reports the verdict and permits the call;
 * `enforce` acts on it.
 */
export type SpendEnforcementMode = "observe" | "enforce";

export type EnvReader = (key: string) => string | undefined;

export function resolveSpendEnforcement(read?: EnvReader): SpendEnforcementMode {
  const r = read ?? ((k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(k));
  return String(r(MODEL_SPEND_ENFORCEMENT_ENV) ?? "").trim().toLowerCase() === "enforce"
    ? "enforce"
    : "observe";
}

/**
 * Default ceiling, per workspace, per period.
 *
 * This workspace has spent $0.65 on models across its entire history, and the
 * heaviest single lineage — 149 companies, fourteen generations — cost $0.34.
 * $25 a day is therefore roughly seventy of the largest runs this product has
 * ever done: high enough that no honest use meets it, low enough that a runaway
 * loop is caught the same day rather than at the end of the month.
 *
 * It is a BOUND, not a budget. Nothing should ever be tuned against it.
 */
export const DEFAULT_CEILING_USD = 25;
export const DEFAULT_PERIOD_DAYS = 1;

function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function resolveCeiling(read?: EnvReader): { ceiling_usd: number; period_days: number } {
  const r = read ?? ((k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(k));
  return {
    ceiling_usd: positiveNumber(r(MODEL_SPEND_CEILING_ENV), DEFAULT_CEILING_USD),
    period_days: positiveNumber(r(MODEL_SPEND_PERIOD_ENV), DEFAULT_PERIOD_DAYS),
  };
}

export interface SpendVerdict {
  /** May the call proceed? In `observe` this is true even when over. */
  allowed: boolean;
  /** Is the workspace actually over? The honest answer, both modes. */
  over_ceiling: boolean;
  mode: SpendEnforcementMode;
  spent_usd: number;
  ceiling_usd: number;
  period_days: number;
  /**
   * Calls in the period whose cost could not be priced.
   *
   * NOT ZERO-COST. `MODEL_PRICES` covers the `gpt-5.6-*` family and nothing
   * else, so a `claude-haiku-4-5` or `gpt-5-mini` call prices as `unknown` and
   * contributes nothing to `spent_usd`. Surfaced separately so the gap is
   * visible in the log line rather than showing up as a clean bill.
   */
  unpriced_calls: number;
  /** Machine-readable, never prose. */
  reason: "under_ceiling" | "over_ceiling" | "query_failed" | "no_workspace";
  detail: string | null;
}

/** The smallest surface of the database this needs. Injected in tests. */
export interface SpendDb {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): {
        gte(col: string, val: unknown): Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
}

/**
 * Sum the period's model spend and say whether another call is allowed.
 *
 * NEVER THROWS. A ceiling that can fail a run by being unreachable is a new
 * outage surface. An unreadable meter degrades to `query_failed`, which
 * `observe` permits — and which `enforce` ALSO permits, deliberately: refusing
 * on a failed read would let one bad query take chat down, and the credit
 * reservations on Apify and Firecrawl still bound the expensive half of the
 * bill. The failure is reported so it can be alarmed on.
 */
export async function authorizeModelSpend(i: {
  db: SpendDb;
  workspace_id: string | null | undefined;
  mode: SpendEnforcementMode;
  ceiling_usd?: number;
  period_days?: number;
  now?: number;
}): Promise<SpendVerdict> {
  const ceiling_usd = i.ceiling_usd ?? DEFAULT_CEILING_USD;
  const period_days = i.period_days ?? DEFAULT_PERIOD_DAYS;
  const base = {
    mode: i.mode, ceiling_usd, period_days, spent_usd: 0, unpriced_calls: 0,
  };

  // A call with no workspace cannot be attributed, so it cannot be metered.
  // Permitted and reported: refusing here would break taskless internal paths
  // for a reason that is about bookkeeping, not spend.
  if (!i.workspace_id) {
    return { ...base, allowed: true, over_ceiling: false, reason: "no_workspace", detail: null };
  }

  const since = new Date((i.now ?? Date.now()) - period_days * 86_400_000).toISOString();
  let rows: Array<Record<string, unknown>>;
  try {
    const { data, error } = await i.db
      .from("lead_model_calls")
      .select("estimated_cost_usd, actual_cost_usd, cost_source")
      .eq("workspace_id", i.workspace_id)
      .gte("started_at", since);
    if (error) {
      return {
        ...base, allowed: true, over_ceiling: false, reason: "query_failed",
        detail: String((error as { message?: unknown })?.message ?? error).slice(0, 200),
      };
    }
    rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  } catch (e) {
    return {
      ...base, allowed: true, over_ceiling: false, reason: "query_failed",
      detail: String(e).slice(0, 200),
    };
  }

  let spent = 0;
  let unpriced = 0;
  for (const r of rows) {
    // ACTUAL BEFORE ESTIMATED, and an unpriced call is counted, not assumed
    // free — the same distinction `priceModelCall` draws and for the same
    // reason: during a provider outage every row reports no usage, and reading
    // that as $0 would show an untouched bill while nothing worked.
    const actual = Number(r["actual_cost_usd"]);
    const est = Number(r["estimated_cost_usd"]);
    const v = Number.isFinite(actual) ? actual : Number.isFinite(est) ? est : null;
    if (v === null || r["cost_source"] === "unknown") unpriced++;
    if (v !== null) spent += v;
  }
  spent = Math.round(spent * 1e6) / 1e6;

  const over = spent >= ceiling_usd;
  return {
    ...base,
    spent_usd: spent,
    unpriced_calls: unpriced,
    over_ceiling: over,
    // The whole point of `observe`: the verdict is computed and reported, and
    // the call proceeds anyway.
    allowed: over ? i.mode === "observe" : true,
    reason: over ? "over_ceiling" : "under_ceiling",
    detail: null,
  };
}

/** What a caller should log. Never includes a prompt or a key. */
export function describeSpend(v: SpendVerdict): Record<string, unknown> {
  return {
    version: MODEL_SPEND_CEILING_VERSION,
    mode: v.mode,
    allowed: v.allowed,
    over_ceiling: v.over_ceiling,
    spent_usd: v.spent_usd,
    ceiling_usd: v.ceiling_usd,
    period_days: v.period_days,
    unpriced_calls: v.unpriced_calls,
    reason: v.reason,
    detail: v.detail,
  };
}

/** The error a refused call surfaces. */
export const MODEL_SPEND_REFUSED = "model_spend_ceiling_reached" as const;
