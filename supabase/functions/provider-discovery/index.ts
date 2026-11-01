// provider-discovery: plan (free) and run (approved) a multi-provider lead
// discovery for a mission the compiler already compiled.
//
// Off (404) unless PROVIDER_DISCOVERY_ENABLED and the workspace is in
// PROVIDER_DISCOVERY_WORKSPACES. Needs the HELD migration
// 20261027120000_provider_connections.sql. Logic and rules:
// _shared/discoveryProviders/discoveryService.ts.
//
// Apify verification is NOT wired here yet (verifier: null), so Apify is
// reported "not connected" and any requirement only Apify could check fails
// closed. Wiring it to the existing guarded actor invoker is a separate,
// reviewed change.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateUser, defaultAuthDeps } from "../_shared/requestAuth.ts";
import { handleDiscovery, parseDiscoveryRequest } from "../_shared/discoveryProviders/discoveryService.ts";
import { readFlags } from "../_shared/discoveryProviders/flags.ts";
import { supabaseConnectionStore, supabaseLedger } from "../_shared/discoveryProviders/supabaseStore.ts";
import { leadOceanAdapter } from "../_shared/discoveryProviders/adapters/leadocean.ts";
import { apolloAdapter } from "../_shared/discoveryProviders/adapters/apollo.ts";
import type { ProjectedLead } from "../_shared/discoveryProviders/leadProjection.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function persist(admin: SupabaseClient, rows: ProjectedLead[]) {
  for (const r of rows) {
    let accountId: string | null = null;
    if (r.account.domain) {
      const { data } = await admin.from("accounts").select("id, raw").eq("workspace_id", r.account.workspace_id).eq("domain", r.account.domain).limit(1).maybeSingle();
      if (data) {
        accountId = data.id;
        // Keep everything already known; add this discovery's attribution only.
        await admin.from("accounts").update({ raw: { ...(data.raw ?? {}), agentory_discovery: r.account.raw.agentory_discovery }, updated_at: new Date().toISOString() }).eq("id", data.id);
      }
    }
    if (!accountId) {
      const { data, error } = await admin.from("accounts").insert(r.account).select("id").single();
      if (error) throw new Error(`accounts insert: ${error.message}`);
      accountId = data.id;
    }
    if (r.contacts.length) {
      const { error } = await admin.from("contacts").insert(r.contacts.map((c) => ({ ...c, account_id: accountId })));
      if (error) throw new Error(`contacts insert: ${error.message}`);
    }
    const { error } = await admin.from("lead_candidates").insert({ ...r.lead_candidate, account_id: accountId });
    if (error) throw new Error(`lead_candidates insert: ${error.message}`);
  }
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
  const parsed = parseDiscoveryRequest(body);
  if (!parsed) return json({ error: "invalid request" }, 400);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const f = (u: string, i: RequestInit) => fetch(u, i);
  try {
    const r = await handleDiscovery(parsed, {
      userId: auth.userId, flags,
      store: supabaseConnectionStore(admin),
      async loadMission(workspaceId, messageId) {
        const { data } = await admin.from("messages").select("metadata, conversations!inner(workspace_id)")
          .eq("id", messageId).eq("conversations.workspace_id", workspaceId).maybeSingle();
        const m = (data?.metadata as { lead_mission?: unknown } | null)?.lead_mission;
        return m && typeof m === "object" ? m as Record<string, unknown> : null;
      },
      adapterFor: (p, key) => (p === "leadocean" ? leadOceanAdapter : apolloAdapter)({ apiKey: key, fetch: f }),
      verifier: null,
      ledger: supabaseLedger(admin, parsed.workspaceId),
      persist: (rows) => persist(admin, rows),
    });
    return json(r.body, r.status);
  } catch (e) {
    console.error("[provider-discovery] failed", { action: parsed.action, error: (e as Error)?.message?.slice(0, 200) });
    return json({ error: "discovery service unavailable" }, 503);
  }
});
