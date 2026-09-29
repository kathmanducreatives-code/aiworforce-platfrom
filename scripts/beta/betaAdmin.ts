// SHARED BY THE OPERATOR BETA SCRIPTS: the service-role connection and the grant.
//
// The service role key is read from the environment and used only in request
// headers. Nothing here prints it, returns it, or writes it anywhere.

export interface ServiceEnv { url: string; key: string }

/** SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or null with the reason. */
export function serviceEnv(read: (k: string) => string | undefined = (k) => Deno.env.get(k)):
  { env: ServiceEnv | null; error: string | null } {
  const url = (read("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const key = read("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return { env: null, error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment" };
  return { env: { url, key }, error: null };
}

const headers = (e: ServiceEnv, extra: Record<string, string> = {}) => ({
  apikey: e.key, Authorization: `Bearer ${e.key}`, "content-type": "application/json", ...extra,
});

/** PostgREST call as the service role. Returns status and parsed body; never throws on HTTP errors. */
export async function rest(e: ServiceEnv, path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const res = await fetch(`${e.url}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: headers(e, init.prefer ? { Prefer: init.prefer } : {}),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

export interface GrantOutcome { ok: boolean; replayed: boolean; balance_after: number | null; error: string | null }

/**
 * Grant credits through the service-role-only `credits_grant`. Idempotent on
 * `key`: the same key never grants twice (the RPC replays the first).
 */
export async function grantCredits(e: ServiceEnv, i: {
  workspace: string; credits: number; key: string; reason: string;
}): Promise<GrantOutcome> {
  const r = await rest(e, "rpc/credits_grant", {
    method: "POST",
    body: { p_workspace: i.workspace, p_amount: i.credits, p_idempotency_key: i.key, p_reason: i.reason, p_plan_id: "beta" },
  });
  const b = (r.body ?? {}) as Record<string, unknown>;
  if (!r.ok || b.ok !== true) {
    return { ok: false, replayed: false, balance_after: null, error: `HTTP ${r.status}: ${JSON.stringify(b.error ?? b.message ?? b)}` };
  }
  return { ok: true, replayed: b.replayed === true, balance_after: typeof b.balance_after === "number" ? b.balance_after : null, error: null };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_GRANT = 1000;
