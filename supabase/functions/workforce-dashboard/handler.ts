// workforce-dashboard — the live Workforce V2 dashboard. READ ONLY. DISABLED BY DEFAULT.
//
// Answers 409 unless WORKFORCE_DASHBOARD_ENABLED=true. Any workspace member may
// read; nothing here writes, calls a model, or calls a provider. Every table is
// read with the service client but filtered to the caller's workspace AFTER the
// membership check; a table that cannot be read is reported `unavailable`.

import { loadCompanyBrainContext, type LoaderDb } from "../_shared/companyBrainContextLoader.ts";
import { buildWorkforceDashboard, type DashboardInputs } from "../_shared/workforceDashboard.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DashAdmin = { from(table: string): any };
export interface DashDeps {
  env(key: string): string | undefined;
  admin: DashAdmin;
  userIdFor(token: string): Promise<string | null>;
  now?: () => Date;
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Row = Record<string, unknown>;
async function rows(admin: DashAdmin, table: string, cols: string, ws: string, orderBy: string, limit: number): Promise<Row[] | null> {
  try {
    const { data, error } = await admin.from(table).select(cols).eq("workspace_id", ws).order(orderBy, { ascending: false }).limit(limit);
    if (error) return null;
    // Isolation enforced on the output too.
    return ((data ?? []) as Row[]).filter((r) => r.workspace_id === undefined || r.workspace_id === ws);
  } catch { return null; }
}

export async function handleDashboard(req: Request, deps: DashDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (deps.env("WORKFORCE_DASHBOARD_ENABLED") !== "true") return json({ error: "workforce_dashboard_disabled" }, 409);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  let body: Row;
  try { body = await req.json(); } catch { return json({ error: "invalid_json_body" }, 400); }
  const ws = typeof body?.workspace_id === "string" && UUID.test(body.workspace_id) ? body.workspace_id : null;
  if (!ws) return json({ error: "invalid_request", reason: "workspace_id must be a uuid" }, 400);

  const userId = await deps.userIdFor(auth.slice(7).trim());
  if (!userId) return json({ error: "Unauthorized" }, 401);
  const { data: member } = await deps.admin.from("workspace_members").select("role").eq("workspace_id", ws).eq("user_id", userId).maybeSingle();
  if (!member) return json({ error: "forbidden", reason: "not_member" }, 403);

  const now = deps.now?.() ?? new Date();
  let brainStatus: DashboardInputs["brainStatus"] = "unavailable";
  try {
    const b = await loadCompanyBrainContext(deps.admin as unknown as LoaderDb, ws, { userId, now });
    if (!b.ok) return json({ error: "forbidden", reason: b.error }, 403);
    brainStatus = b.context.status;
  } catch { /* stays unavailable */ }

  const a = deps.admin;
  const [tasks, approvals, modelCalls, handoffs, signals, proposals] = await Promise.all([
    rows(a, "tasks", "id, workspace_id, agent_slug, status, description, input, error_message, lineage_id, created_at, updated_at, started_at, finished_at, completed_at", ws, "created_at", 200),
    rows(a, "approvals", "id, workspace_id, title, summary, type, status, created_at", ws, "created_at", 100),
    rows(a, "lead_model_calls", "workspace_id, model, actual_cost_usd, estimated_cost_usd, cost_source, attempt_number, started_at, finished_at, status", ws, "started_at", 1000),
    rows(a, "agent_handoffs", "id, workspace_id, kind, status, created_at", ws, "created_at", 200),
    rows(a, "signal_events", "id, workspace_id, lifecycle_status, verification_status, observed_at, normalized_value", ws, "observed_at", 300),
    rows(a, "company_brain_memory", "id, workspace_id, approval_status, updated_at", ws, "updated_at", 300),
  ]);
  return json({ ok: true, dashboard: buildWorkforceDashboard({ now, brainStatus, tasks, approvals, modelCalls, handoffs, signals, proposals }) });
}
