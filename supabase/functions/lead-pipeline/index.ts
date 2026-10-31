// lead-pipeline: plan (free dry run) and run (approved) an ICP walk —
// LeadOcean discovery → canonical company records → shared qualification →
// optional Apify signals → ranking → optional phone lookups → Leads tables.
//
// Off (404) unless LEAD_PIPELINE_ENABLED and the workspace is in
// LEAD_PIPELINE_WORKSPACES. Signals and phones have their own switches
// (LEAD_PIPELINE_SIGNALS_ENABLED, LEAD_PIPELINE_PHONES_ENABLED), off by default.
// Needs the HELD migrations 20261027120000_provider_connections.sql and
// 20261031120000_lead_pipeline_checkpoints.sql. Logic: _shared/leadPipeline/service.ts.
// Nothing here sends a message or places a call.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateUser, defaultAuthDeps } from "../_shared/requestAuth.ts";
import { readFlags } from "../_shared/discoveryProviders/flags.ts";
import { supabaseConnectionStore, supabaseLedger } from "../_shared/discoveryProviders/supabaseStore.ts";
import { leadOceanAdapter } from "../_shared/discoveryProviders/adapters/leadocean.ts";
import { handleLeadPipeline, parsePipelineRequest, readPipelineFlags } from "../_shared/leadPipeline/service.ts";
import { supabaseCheckpointStore } from "../_shared/leadPipeline/checkpoint.ts";
import { loadExistingRecords } from "../_shared/leadPipeline/history.ts";
import { pipelineApifyInvoker } from "../_shared/leadPipeline/apifyInvoker.ts";
import type { PipelineRow } from "../_shared/leadPipeline/projection.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function persist(admin: SupabaseClient, rows: PipelineRow[]) {
  const now = new Date().toISOString();
  for (const r of rows) {
    if (r.existingLeadId) {
      // An existing Lead keeps its id, status and stage: only the attribution is added.
      const { data } = await admin.from("lead_candidates").select("id, raw").eq("id", r.existingLeadId).eq("workspace_id", r.lead_candidate.workspace_id).maybeSingle();
      if (data) { await admin.from("lead_candidates").update({ raw: { ...(data.raw ?? {}), agentory_pipeline: r.lead_candidate.raw.agentory_pipeline }, updated_at: now }).eq("id", data.id); continue; }
    }
    let accountId: string | null = null;
    if (r.account.domain) {
      const { data } = await admin.from("accounts").select("id, raw").eq("workspace_id", r.account.workspace_id).eq("domain", r.account.domain).limit(1).maybeSingle();
      if (data) { accountId = data.id; await admin.from("accounts").update({ raw: { ...(data.raw ?? {}), agentory_pipeline: r.account.raw.agentory_pipeline }, updated_at: now }).eq("id", data.id); }
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
  const flags = readPipelineFlags(env);
  if (!flags.enabled) return json({ error: "disabled" }, 404);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const auth = await authenticateUser(req, defaultAuthDeps);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid body" }, 400); }
  const parsed = parsePipelineRequest(body);
  if (!parsed) return json({ error: "invalid request" }, 400);
  const admin = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const f = (u: string, i: RequestInit) => fetch(u, i);
  const apifyToken = env("APIFY_API_TOKEN");
  try {
    const r = await handleLeadPipeline(parsed, {
      userId: auth.userId, flags, discoveryFlags: readFlags(env),
      store: supabaseConnectionStore(admin), ledger: supabaseLedger(admin, parsed.workspaceId), checkpoints: supabaseCheckpointStore(admin),
      loadExisting: (ws) => loadExistingRecords(admin, ws, new Date()),
      leadoceanFor: (apiKey) => { const deps = { apiKey, fetch: f }; return { adapter: leadOceanAdapter(deps), deps }; },
      apify: apifyToken ? pipelineApifyInvoker({ token: apifyToken, fetch: f }) : null,
      persist: (rows) => persist(admin, rows),
    });
    return json(r.body, r.status);
  } catch (e) {
    console.error("[lead-pipeline] failed", { name: (e as Error)?.name });
    return json({ error: "lead pipeline failed" }, 500);
  }
});
