// discovery-engine: GPT-planned, multi-provider lead discovery.
//
//   plan  — interpret the request, return the explainable provider plan and its worst case (no provider call)
//   run   — execute the approved plan (owner/admin; approval names the plan hash and caps)
//
// Off (404) unless DISCOVERY_ENGINE_ENABLED and the workspace is in
// DISCOVERY_ENGINE_WORKSPACES. Apify needs DISCOVERY_ENGINE_APIFY_ENABLED and
// APIFY_API_TOKEN; LeadOcean follows the provider-discovery flags and the workspace
// connection; Apollo is registered and disabled. Workspace spend limits come from
// DISCOVERY_ENGINE_MAX_LEADOCEAN_RECORDS / DISCOVERY_ENGINE_MAX_APIFY_USD (default 0:
// nothing can be bought until an operator sets them). Needs the HELD migrations
// 20261027120000_provider_connections.sql and 20261101120000_discovery_evidence_cache.sql.
// Never requests phone numbers; never contacts anyone.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateUser, defaultAuthDeps } from "../_shared/requestAuth.ts";
import { generateJson } from "../_shared/aiProvider.ts";
import { readFlags } from "../_shared/discoveryProviders/flags.ts";
import { supabaseConnectionStore, supabaseLedger } from "../_shared/discoveryProviders/supabaseStore.ts";
import { leadOceanAdapter } from "../_shared/discoveryProviders/adapters/leadocean.ts";
import { pipelineApifyInvoker } from "../_shared/leadPipeline/apifyInvoker.ts";
import { loadExistingRecords } from "../_shared/leadPipeline/history.ts";
import { supabaseEvidenceCache } from "../_shared/discoveryEngine/cache.ts";
import { handleEngine, parseEngineRequest, readEngineFlags } from "../_shared/discoveryEngine/service.ts";
import type { EngineRow } from "../_shared/discoveryEngine/projection.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function persist(admin: any, rows: EngineRow[]) {
  const now = new Date().toISOString();
  for (const r of rows) {
    if (r.existingLeadId) {
      const { data } = await admin.from("lead_candidates").select("id, raw").eq("id", r.existingLeadId).eq("workspace_id", r.lead_candidate.workspace_id).maybeSingle();
      if (data) { await admin.from("lead_candidates").update({ raw: { ...(data.raw ?? {}), ...r.lead_candidate.raw }, updated_at: now }).eq("id", data.id); continue; }
    }
    let accountId: string | null = null;
    if (r.account.domain) {
      const { data } = await admin.from("accounts").select("id, raw").eq("workspace_id", r.account.workspace_id).eq("domain", r.account.domain).limit(1).maybeSingle();
      if (data) { accountId = data.id; await admin.from("accounts").update({ raw: { ...(data.raw ?? {}), ...r.account.raw }, updated_at: now }).eq("id", data.id); }
    }
    if (!accountId) {
      const { data, error } = await admin.from("accounts").insert(r.account).select("id").single();
      if (error) throw new Error(`accounts insert: ${error.message}`);
      accountId = data.id;
    }
    let contactId: string | null = null;
    if (r.contact) {
      const { data, error } = await admin.from("contacts").insert({ ...r.contact, account_id: accountId }).select("id").single();
      if (error) throw new Error(`contacts insert: ${error.message}`);
      contactId = data.id;
    }
    const { error } = await admin.from("lead_candidates").insert({ ...r.lead_candidate, account_id: accountId, contact_id: contactId });
    if (error) throw new Error(`lead_candidates insert: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const env = (k: string) => Deno.env.get(k);
  const flags = readEngineFlags(env);
  if (!flags.enabled) return json({ error: "disabled" }, 404);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const auth = await authenticateUser(req, defaultAuthDeps);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid body" }, 400); }
  const parsed = parseEngineRequest(body);
  if (!parsed) return json({ error: "invalid request" }, 400);
  const admin = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const f = (u: string, i: RequestInit) => fetch(u, i);
  const token = env("APIFY_API_TOKEN");
  const num = (k: string) => { const v = Number(env(k) ?? "0"); return Number.isFinite(v) && v > 0 ? v : 0; };
  try {
    const r = await handleEngine(parsed, {
      userId: auth.userId, flags, discoveryFlags: readFlags(env), store: supabaseConnectionStore(admin),
      model: async (system, user) => {
        const g = await generateJson({ taskType: "tool_input_planning", systemPrompt: system, messages: [{ role: "user", content: user }], temperature: 0, functionName: "discovery-engine", workspaceId: parsed.workspaceId });
        if (!g.ok) throw new Error(g.errorCode ?? "model_failed");
        return g.json;
      },
      ledger: supabaseLedger(admin, parsed.workspaceId), cache: supabaseEvidenceCache(admin),
      caps: { leadoceanRecords: num("DISCOVERY_ENGINE_MAX_LEADOCEAN_RECORDS"), apifyUsd: num("DISCOVERY_ENGINE_MAX_APIFY_USD") },
      loadExisting: (ws) => loadExistingRecords(admin, ws, new Date()),
      leadoceanFor: (apiKey) => leadOceanAdapter({ apiKey, fetch: f }),
      apify: token ? pipelineApifyInvoker({ token, fetch: f }) : null,
      persist: (rows) => persist(admin, rows),
    });
    return json(r.body, r.status);
  } catch (e) {
    console.error("[discovery-engine] failed", { name: (e as Error)?.name });
    return json({ error: "discovery engine failed" }, 500);
  }
});
