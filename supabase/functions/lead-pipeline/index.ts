// lead-pipeline: plan (free dry run) and run (approved) an ICP walk, or
// (strategy_plan / strategy_run) any request: GPT interprets it and the
// strategy planner chooses LeadOcean, Apify or both (_shared/leadPipeline/strategy.ts) —
// LeadOcean discovery → canonical company records → shared qualification →
// optional Apify signals → ranking → optional phone lookups → Leads tables.
//
// Off (404) unless LEAD_PIPELINE_ENABLED and the workspace is in
// LEAD_PIPELINE_WORKSPACES. Signals and phones have their own switches
// (LEAD_PIPELINE_SIGNALS_ENABLED, LEAD_PIPELINE_PHONES_ENABLED), off by default.
// Needs the HELD migrations 20261027120000_provider_connections.sql and
// 20261031120000_lead_pipeline_checkpoints.sql. Logic: _shared/leadPipeline/service.ts.
// Nothing here sends a message or places a call.

import { withBuildStamp } from "../_shared/buildStamp.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateUser, defaultAuthDeps } from "../_shared/requestAuth.ts";
import { readFlags } from "../_shared/discoveryProviders/flags.ts";
import { supabaseConnectionStore, supabaseLedger } from "../_shared/discoveryProviders/supabaseStore.ts";
import { leadOceanAdapter } from "../_shared/discoveryProviders/adapters/leadocean.ts";
import { handleLeadPipeline, handleStrategyRequest, parsePipelineRequest, parseStrategyRequest, readPipelineFlags } from "../_shared/leadPipeline/service.ts";
import { buildMissionCompilerBinding } from "../_shared/leadMissionCompilerBinding.ts";
import { MissionNeedsClarificationError } from "../_shared/leadMissionCompiler.ts";
import { createStrategyAdvisorGenerateJson } from "../_shared/leadPipeline/strategyAdvisorModel.ts";
import { compileWithBrain, loadBrainPlanningContext } from "../_shared/leadPipeline/brainContext.ts";
import { planSigner } from "../_shared/leadPipeline/planToken.ts";
import { supabaseEvidenceCache } from "../_shared/leadPipeline/evidenceCache.ts";
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

// Every response (an unauthenticated OPTIONS too) names the build: x-agentory-build.
Deno.serve(withBuildStamp(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const env = (k: string) => Deno.env.get(k);
  const flags = readPipelineFlags(env);
  if (!flags.enabled) return json({ error: "disabled" }, 404);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const auth = await authenticateUser(req, defaultAuthDeps);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid body" }, 400); }
  const strategyReq = parseStrategyRequest(body);
  const parsed = strategyReq ? null : parsePipelineRequest(body);
  if (!parsed && !strategyReq) return json({ error: "invalid request" }, 400);
  const workspaceId = (strategyReq ?? parsed)!.workspaceId;
  const admin = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const f = (u: string, i: RequestInit) => fetch(u, i);
  const apifyToken = env("APIFY_API_TOKEN");
  const deps = {
    userId: auth.userId, flags, discoveryFlags: readFlags(env),
    store: supabaseConnectionStore(admin), ledger: supabaseLedger(admin, workspaceId), checkpoints: supabaseCheckpointStore(admin),
    loadExisting: (ws: string) => loadExistingRecords(admin, ws, new Date()),
    leadoceanFor: (apiKey: string) => { const d = { apiKey, fetch: f }; return { adapter: leadOceanAdapter(d), deps: d }; },
    apify: apifyToken ? pipelineApifyInvoker({ token: apifyToken, fetch: f }) : null,
    persist: (rows: PipelineRow[]) => persist(admin, rows),
    // Off unless DISCOVERY_EVIDENCE_CACHE_ENABLED and the held cache migration is applied.
    evidenceCache: ["1", "true", "yes", "on"].includes((env("DISCOVERY_EVIDENCE_CACHE_ENABLED") ?? "").trim().toLowerCase()) ? supabaseEvidenceCache(admin) : null,
  };
  try {
    if (strategyReq) {
      const r = await handleStrategyRequest(strategyReq, {
        ...deps,
        // GPT reads the request (the mission compiler); no deterministic fallback stands in for it.
        interpret: async (query, ws, requestedCount) => {
          // The workspace's own Company Brain as context (read-only, this workspace only,
          // after the membership check in handleStrategyRequest): same path as the chat agent.
          const brain = await loadBrainPlanningContext(admin as never, ws);
          const binding = buildMissionCompilerBinding({ workspaceId: ws });
          const proposal = await binding.proposeMission!({ originalUserQuery: query, requestedCount, companyBrain: brain.context });
          if (!proposal) return { error: binding.lastModelFailure()?.code ?? "the model returned no usable interpretation" };
          let c: ReturnType<typeof compileWithBrain>;
          try {
            c = compileWithBrain({ query, proposal, requestedCount, brain });
          } catch (e) {
            // A genuine ambiguity is a question for the user (422), never a server failure.
            if (e instanceof MissionNeedsClarificationError) {
              return { error: "needs_clarification", clarification: { questions: e.questions, message: (e as { userMessage?: string }).userMessage ?? e.message } };
            }
            throw e;
          }
          return {
            mission: c.mission, brain: { status: brain.status, fields: brain.fields, applied: c.brainApplied, rejected: c.brainRejected },
            // Signed into the approval token: a run rebuilds exactly this, with no model call.
            replay: { proposal, brain: { status: brain.status, fields: brain.fields, context: brain.context } },
          };
        },
        // strategy_run: the signed proposal and Brain context, compiled again (deterministic).
        recompile: (query, requestedCount, replay) => {
          const brain = { status: replay.brain.status as never, fields: replay.brain.fields, context: replay.brain.context as never };
          const c = compileWithBrain({ query, proposal: replay.proposal, requestedCount, brain });
          return Promise.resolve({ mission: c.mission, brain: { status: brain.status, fields: brain.fields, applied: c.brainApplied, rejected: c.brainRejected } });
        },
        // Approval tokens are MAC'd with a key derived from the service-role key (no new secret).
        signer: await planSigner(env("SUPABASE_SERVICE_ROLE_KEY") ?? ""),
        advisor: createStrategyAdvisorGenerateJson(),
      });
      return json(r.body, r.status);
    }
    const r = await handleLeadPipeline(parsed!, deps);
    return json(r.body, r.status);
  } catch (e) {
    console.error("[lead-pipeline] failed", { name: (e as Error)?.name });
    return json({ error: "lead pipeline failed" }, 500);
  }
}));
