// firecrawl-scrape — THE ONLY PLACE THE BROWSER MAY REACH FIRECRAWL.
//
// `src/lib/firecrawl.ts` used to hold a Firecrawl client that read
// `import.meta.env.VITE_FIRECRAWL_API_KEY`. Vite INLINES every `VITE_*` value
// into the bundle it ships, so the key moved here, server side.
//
// SCOPE, deliberately narrow: one URL, one scrape. No crawl, no search.
//
// ── WHO MAY SPEND, AND HOW MUCH (launch hardening) ──────────────────────────
//
// Signing in used to be enough — and signup is open — so any account could
// spend Agentory's Firecrawl credits with no limit. A scrape now needs, in order:
//
//   1. a real signed-in user;
//   2. a workspace the user is a MEMBER of (the workspace pays);
//   3. room under a durable DAILY CAP, per workspace and per user, counted from
//      the credit ledger — so it holds across isolates and restarts;
//   4. one CREDIT RESERVED from that workspace's balance, ALWAYS enforced here
//      whatever the global LEAD_CREDIT_ENFORCEMENT mode: a browser-initiated
//      scrape is never allowed to spend on "observe". A new workspace has no
//      balance, so a new account cannot spend at all until credits are granted.
//
// The reservation is settled after the call (charged if it was dispatched).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { allowedScrapeUrl, boundedPrompt } from "../_shared/firecrawlRequestGuard.ts";
import { authenticateUser, defaultAuthDeps, type AuthDeps } from "../_shared/requestAuth.ts";
import { authorizeProviderCall, settleProviderCall, type CreditDb } from "../_shared/creditAuthorization.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
/** A scrape is a paid page read; the browser does not get to pick a bigger one. */
const TIMEOUT_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Browser scrapes per workspace per UTC day. */
export const BROWSER_SCRAPE_DAILY_LIMIT_WORKSPACE = 25;
/** Browser scrapes per user per UTC day (within a workspace). */
export const BROWSER_SCRAPE_DAILY_LIMIT_USER = 15;
/** The ledger tag for browser scrapes; `:<user id>` is appended. */
export const BROWSER_SCRAPE_TAG = "browser:firecrawl-scrape";

export function utcDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export interface ScrapeDeps extends AuthDeps {
  now?: () => Date;
  newId?: () => string;
}
const defaultDeps: ScrapeDeps = { ...defaultAuthDeps };

export async function handleFirecrawlScrape(req: Request, deps: ScrapeDeps = defaultDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // 1. A real user.
  const auth = await authenticateUser(req, deps);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const userId = auth.userId;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json_body" }, 400); }

  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
  if (!UUID_RE.test(workspaceId)) return json({ ok: false, error: "workspace_id_required" }, 400);
  const url = allowedScrapeUrl(body.url);
  if (!url) return json({ ok: false, error: "invalid_url" }, 400);

  const key = deps.env("FIRECRAWL_API_KEY");
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!key || !serviceKey) return json({ ok: false, error: "firecrawl_not_configured" }, 503);

  const admin = createClient(deps.env("SUPABASE_URL")!, serviceKey, {
    global: { fetch: deps.fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 2. The workspace that pays must be the caller's.
  const { data: member } = await admin.from("workspace_members").select("workspace_id")
    .eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (!member) return json({ ok: false, error: "forbidden_workspace" }, 403);

  // 3. The daily caps, from the ledger itself.
  const since = utcDayStart((deps.now ?? (() => new Date()))());
  const userTag = `${BROWSER_SCRAPE_TAG}:${userId}`;
  const count = async (column: "like" | "eq") => {
    const q = admin.from("credit_transactions").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).gte("created_at", since);
    const { count: n, error } = column === "like"
      ? await q.like("company_key", `${BROWSER_SCRAPE_TAG}:%`)
      : await q.eq("company_key", userTag);
    return error ? null : (n ?? 0);
  };
  const [wsUsed, userUsed] = [await count("like"), await count("eq")];
  // An unanswerable cap is a refusal, never an open door.
  if (wsUsed === null || userUsed === null) return json({ ok: false, error: "budget_unavailable" }, 503);
  if (wsUsed >= BROWSER_SCRAPE_DAILY_LIMIT_WORKSPACE || userUsed >= BROWSER_SCRAPE_DAILY_LIMIT_USER) {
    return json({ ok: false, error: "daily_scrape_limit_reached" }, 429);
  }

  // 4. One credit, always enforced.
  const db: CreditDb = { rpc: async (fn, args) => await admin.rpc(fn, args) };
  const reservation = await authorizeProviderCall({
    db, workspace_id: workspaceId, mode: "enforce",
    logical_call_key: `${BROWSER_SCRAPE_TAG}:${(deps.newId ?? (() => crypto.randomUUID()))()}`,
    capability: userTag,
  });
  if (!reservation.reserved) {
    return json({ ok: false, error: reservation.reason === "insufficient_credits" ? "insufficient_credits" : "credit_authorization_refused" }, 402);
  }

  const prompt = boundedPrompt(body.prompt);
  const formats: unknown[] = ["markdown"];
  if (prompt) formats.push({ type: "json", prompt });

  let dispatched = false;
  try {
    dispatched = true;
    const res = await deps.fetch(`${FIRECRAWL_V2}/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.toString(), formats, onlyMainContent: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await res.json().catch(() => null) as
      | { success?: boolean; data?: Record<string, unknown>; error?: string }
      | null;
    if (!res.ok || !payload || payload.success === false) {
      return json({ ok: false, error: "firecrawl_failed", status: res.status, detail: String(payload?.error ?? "").slice(0, 300) }, 502);
    }
    const data = payload.data ?? {};
    return json({
      ok: true,
      data: { url: url.toString(), markdown: data.markdown ?? null, json: data.json ?? null, metadata: data.metadata ?? null },
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "TimeoutError";
    return json({ ok: false, error: aborted ? "firecrawl_timeout" : "firecrawl_unreachable" }, 504);
  } finally {
    await settleProviderCall({ db, transaction_id: reservation.transaction_id, started: dispatched, reason: "browser firecrawl scrape" });
  }
}

if (!Deno.env.get("FIRECRAWL_SCRAPE_IMPORT_ONLY")) Deno.serve((req) => handleFirecrawlScrape(req));
