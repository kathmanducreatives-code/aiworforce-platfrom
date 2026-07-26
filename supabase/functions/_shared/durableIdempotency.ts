// RESTART-SAFE PAID-CALL IDEMPOTENCY — implemented on EXISTING storage.
//
// The in-process ledger dies with the isolate, so an Edge Function retry could
// re-charge a paid round. `tool_calls` already persists everything needed, with no
// migration:
//
//   workspace_id  → tenant isolation
//   task_id       → run scoping
//   input_json    → jsonb the CALLER controls; we stamp the durable key into it
//   output_json   → the reusable result
//   status        → succeeded | failed | unavailable
//   completed_at  → staleness
//
// Durable key: workspace_id + task_id + round_number + strategy_hash + actor_key.

export const IDEMPOTENCY_KEY_FIELD = "_idempotency_key";

export type DurableLookupKind = "new" | "cached" | "prior_failed" | "stale_incomplete";

export interface DurableLookupResult {
  kind: DurableLookupKind;
  /** Present only for `cached`. */
  output: unknown | null;
  /** Cost metadata from the ORIGINAL call — never re-charged, never re-estimated. */
  originalCost: { completed_at: string | null; created_at: string | null } | null;
  reason: string;
}

/** Minimal read surface, so tests can pass a fake instead of a live client. */
export interface ToolCallReader {
  findByIdempotencyKey(args: { workspaceId: string; key: string }): Promise<Array<{
    status: string | null; output_json: unknown; completed_at: string | null; created_at: string | null;
    workspace_id: string;
  }>>;
}

/** Stamp the durable key onto the provider envelope so it lands in input_json. */
export function stampIdempotencyKey<T extends Record<string, unknown>>(envelope: T, key: string): T & Record<string, unknown> {
  return { ...envelope, [IDEMPOTENCY_KEY_FIELD]: key };
}

export function readIdempotencyKey(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== "object") return null;
  const v = (envelope as Record<string, unknown>)[IDEMPOTENCY_KEY_FIELD];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** A completed call older than this is not reused (evidence goes stale). */
export const DEFAULT_MAX_REUSE_AGE_MS = 6 * 60 * 60 * 1000;   // 6h

/**
 * Decide whether a paid call may be skipped. Tenant isolation is enforced twice:
 * in the query and again on every returned row.
 */
export async function lookupDurableCall(
  reader: ToolCallReader,
  args: { workspaceId: string; key: string; now?: string; maxAgeMs?: number },
): Promise<DurableLookupResult> {
  const none: DurableLookupResult = { kind: "new", output: null, originalCost: null, reason: "no prior call for this key" };
  if (!args.workspaceId || !args.key) return none;

  let rows: Awaited<ReturnType<ToolCallReader["findByIdempotencyKey"]>>;
  try {
    rows = await reader.findByIdempotencyKey({ workspaceId: args.workspaceId, key: args.key });
  } catch {
    // A lookup failure must never block sourcing; fall back to a fresh call.
    return { ...none, reason: "idempotency lookup failed — treating as a new call" };
  }
  // Defence in depth: never accept a row from another workspace.
  const scoped = (rows ?? []).filter((r) => r.workspace_id === args.workspaceId);
  if (scoped.length === 0) return none;

  const succeeded = scoped.find((r) => (r.status ?? "").toLowerCase() === "succeeded");
  if (succeeded) {
    const nowMs = Date.parse(args.now ?? new Date().toISOString());
    const stamp = Date.parse(succeeded.completed_at ?? succeeded.created_at ?? "");
    const maxAge = args.maxAgeMs ?? DEFAULT_MAX_REUSE_AGE_MS;
    if (Number.isFinite(stamp) && nowMs - stamp > maxAge) {
      return { kind: "stale_incomplete", output: null, originalCost: null, reason: "prior successful call is too old to reuse" };
    }
    if (succeeded.output_json == null) {
      return { kind: "stale_incomplete", output: null, originalCost: null, reason: "prior call succeeded but stored no output" };
    }
    return {
      kind: "cached", output: succeeded.output_json,
      originalCost: { completed_at: succeeded.completed_at, created_at: succeeded.created_at },
      reason: "reusing the result of an identical completed paid call",
    };
  }

  // A prior FAILED attempt must never masquerade as completed — retrying is correct.
  const failed = scoped.find((r) => ["failed", "unavailable"].includes((r.status ?? "").toLowerCase()));
  if (failed) return { kind: "prior_failed", output: null, originalCost: null, reason: "prior attempt failed — a new call is allowed" };

  return { kind: "stale_incomplete", output: null, originalCost: null, reason: "prior attempt never completed" };
}

/** Build a reader over the real Supabase client (used by run-agent). */
export function supabaseToolCallReader(db: {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => {
          order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown }> };
        };
      };
    };
  };
}): ToolCallReader {
  return {
    async findByIdempotencyKey({ workspaceId, key }) {
      const { data } = await db.from("tool_calls")
        .select("status, output_json, completed_at, created_at, workspace_id")
        .eq("workspace_id", workspaceId)
        .eq(`input_json->>${IDEMPOTENCY_KEY_FIELD}`, key)
        .order("created_at", { ascending: false })
        .limit(5);
      return (data ?? []) as Array<{ status: string | null; output_json: unknown; completed_at: string | null; created_at: string | null; workspace_id: string }>;
    },
  };
}
