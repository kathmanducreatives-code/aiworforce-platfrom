// provider-connections: connect / verify / list / usage / disconnect a
// workspace's own Apollo, LeadOcean or Apify account.
//
// Off (404) unless PROVIDER_DISCOVERY_ENABLED and the workspace is in
// PROVIDER_DISCOVERY_WORKSPACES. Needs the HELD migration
// 20261027120000_provider_connections.sql. All rules live in
// _shared/discoveryProviders/connections.ts; the key goes to Vault and is never
// returned.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateUser, defaultAuthDeps } from "../_shared/requestAuth.ts";
import { handleConnections, type ConnectionRequest, type Verifier } from "../_shared/discoveryProviders/connections.ts";
import { readFlags } from "../_shared/discoveryProviders/flags.ts";
import { supabaseConnectionStore } from "../_shared/discoveryProviders/supabaseStore.ts";
import { leadOceanAdapter } from "../_shared/discoveryProviders/adapters/leadocean.ts";
import { apolloAdapter } from "../_shared/discoveryProviders/adapters/apollo.ts";
import { apifyVerifyToken } from "../_shared/discoveryProviders/adapters/apify.ts";
import { PROVIDER_IDS, type ProviderId } from "../_shared/discoveryProviders/types.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const verify: Verifier = (p, key) => {
  const f = (u: string, i: RequestInit) => fetch(u, i);
  if (p === "leadocean") return leadOceanAdapter({ apiKey: key, fetch: f }).verifyKey();
  if (p === "apollo") return apolloAdapter({ apiKey: key, fetch: f }).verifyKey();
  return apifyVerifyToken(f, key);
};

function parse(b: Record<string, unknown>): ConnectionRequest | null {
  const ws = typeof b.workspace_id === "string" ? b.workspace_id : null;
  if (!ws) return null;
  if (b.action === "list") return { action: "list", workspaceId: ws };
  const provider = PROVIDER_IDS.includes(b.provider as ProviderId) ? b.provider as ProviderId : null;
  if (!provider) return null;
  if (b.action === "connect") return { action: "connect", workspaceId: ws, provider, apiKey: String(b.api_key ?? "") };
  if (b.action === "verify" || b.action === "usage" || b.action === "disconnect") return { action: b.action, workspaceId: ws, provider };
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const flags = readFlags((k) => Deno.env.get(k));
  if (!flags.enabled) return json({ error: "disabled" }, 404);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const auth = await authenticateUser(req, defaultAuthDeps);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid body" }, 400); }
  const parsed = parse(body);
  if (!parsed) return json({ error: "invalid request" }, 400);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const r = await handleConnections(parsed, { userId: auth.userId, flags, store: supabaseConnectionStore(admin), verify });
    return json(r.body, r.status);
  } catch (e) {
    // Never echo the request (it may hold a key).
    console.error("[provider-connections] failed", { action: parsed.action, error: (e as Error)?.message?.slice(0, 200) });
    return json({ error: "connection service unavailable" }, 503);
  }
});
