// OPS HEALTH — class OPS: a shared token, aggregates only, fails closed.
//
//   GET /functions/v1/ops-health   with header  x-ops-token: <OPS_HEALTH_TOKEN>
//
// Answers the launch's "is anything broken?" numbers (see _shared/opsHealth.ts)
// with the alerts they trip. Nothing in the response identifies a workspace, a
// user or a query, so the token — the only credential the scheduled checker
// holds — reveals no customer data. Without OPS_HEALTH_TOKEN set (or with one
// shorter than 32 characters) it answers 503 and reads nothing.
//
// Reads with the service role internally; the caller never gets that key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withBuildStamp } from "../_shared/buildStamp.ts";
import {
  evaluateOpsHealth, opsTokenMatches, readOpsSnapshot, resolveOpsThresholds, type OpsDb,
} from "../_shared/opsHealth.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

type Filter = [string, string, unknown];
type Result = { data?: unknown; count?: number | null; error: { message: string } | null };
/** The slice of the PostgREST builder the snapshot uses — nothing wider. */
interface Query extends PromiseLike<Result> {
  eq(column: string, value: unknown): Query;
  lt(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  limit(n: number): Query;
}
function applyFilters(q: Query, filters: Filter[]): Query {
  return filters.reduce((acc, [col, op, val]) => {
    switch (op) {
      case "eq": return acc.eq(col, val);
      case "lt": return acc.lt(col, val);
      case "gte": return acc.gte(col, val);
      case "in": return acc.in(col, val as unknown[]);
      default: throw new Error(`ops-health: unsupported filter ${op}`);
    }
  }, q);
}

/** The service-role adapter. Counts are HEAD requests; sums read bounded rows. */
export function supabaseOpsDb(url: string, serviceKey: string): OpsDb {
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    count: async (table, filters) => {
      const { count, error } = await applyFilters(db.from(table).select("*", { count: "exact", head: true }) as unknown as Query, filters);
      if (error) throw new Error(`${table} count failed: ${error.message}`);
      return count ?? 0;
    },
    rows: async (table, columns, filters, limit) => {
      const { data, error } = await applyFilters(db.from(table).select(columns) as unknown as Query, filters).limit(limit);
      if (error) throw new Error(`${table} read failed: ${error.message}`);
      return (data ?? []) as Array<Record<string, unknown>>;
    },
  };
}

export async function handleOpsHealth(req: Request, deps: {
  read?: (k: string) => string | undefined;
  db?: OpsDb;
  now?: number;
} = {}): Promise<Response> {
  const read = deps.read ?? ((k: string) => Deno.env.get(k));
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const expected = read("OPS_HEALTH_TOKEN");
  // FAIL CLOSED: an unconfigured endpoint reads nothing and says so.
  if (!expected || expected.length < 32) return json({ error: "ops_health_disabled" }, 503);
  if (!opsTokenMatches(req.headers.get("x-ops-token"), expected)) return json({ error: "unauthorized" }, 401);

  try {
    const db = deps.db ?? supabaseOpsDb(read("SUPABASE_URL") ?? "", read("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const snapshot = await readOpsSnapshot(db, deps.now ?? Date.now());
    const alerts = evaluateOpsHealth(snapshot, resolveOpsThresholds(read));
    const status = alerts.some((a) => a.severity === "critical") ? "critical" : alerts.length ? "warn" : "ok";
    return json({ status, alerts, snapshot });
  } catch (e) {
    // A read that fails is itself an alert — never an "ok".
    console.error("[ops-health] read failed", String(e).slice(0, 300));
    return json({ status: "critical", alerts: [{ severity: "critical", code: "ops_read_failed", detail: "the health snapshot could not be read" }] }, 500);
  }
}

if (!Deno.env.get("OPS_HEALTH_IMPORT_ONLY")) Deno.serve(withBuildStamp((req) => handleOpsHealth(req)));
