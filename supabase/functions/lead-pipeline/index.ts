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
import { gptContractGenerate, interpretContract } from "../_shared/missionContract/gptInterpreter.ts";
import { applyCompanyBrain } from "../_shared/missionContract/brain.ts";
import { compileContract } from "../_shared/missionContract/compile.ts";
import { contractHash, type MissionContract } from "../_shared/missionContract/contract.ts";
import { createStrategyAdvisorGenerateJson } from "../_shared/leadPipeline/strategyAdvisorModel.ts";
import { compileWithBrain, loadBrainPlanningContext } from "../_shared/leadPipeline/brainContext.ts";
import { planSigner } from "../_shared/leadPipeline/planToken.ts";
import { supabaseEvidenceCache } from "../_shared/leadPipeline/evidenceCache.ts";
import { supabaseCheckpointStore } from "../_shared/leadPipeline/checkpoint.ts";
import { loadExistingRecords } from "../_shared/leadPipeline/history.ts";
import { pipelineApifyInvoker } from "../_shared/leadPipeline/apifyInvoker.ts";
import type { PipelineRow } from "../_shared/leadPipeline/projection.ts";
import { persistRows, supabaseLeadStore } from "../_shared/leadPipeline/persistRows.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Idempotent per company (leadPipeline/persistRows.ts). With the held migration
// 20261108120000 applied AND LEAD_PIPELINE_PERSIST_TX=enabled, each row is one transaction.
async function persist(admin: SupabaseClient, rows: PipelineRow[], transactional: boolean) {
  return await persistRows(supabaseLeadStore(admin, { transactional }), rows);
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
  // MISSION CONTRACT v4: opt-in per deployment (TEST only until it passes its release gates).
  const contractMode = (env("AGENTORY_MISSION_CONTRACT_V4") ?? "").trim().toLowerCase() === "enabled";
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
    persist: (rows: PipelineRow[]) => persist(admin, rows, (env("LEAD_PIPELINE_PERSIST_TX") ?? "").trim().toLowerCase() === "enabled"),
    // Off unless DISCOVERY_EVIDENCE_CACHE_ENABLED and the held cache migration is applied.
    evidenceCache: ["1", "true", "yes", "on"].includes((env("DISCOVERY_EVIDENCE_CACHE_ENABLED") ?? "").trim().toLowerCase()) ? supabaseEvidenceCache(admin) : null,
  };
  try {
    if (strategyReq) {
      const r = await handleStrategyRequest(strategyReq, {
        ...deps,
        // GPT reads the request (the mission compiler); no deterministic fallback stands in for it.
        interpret: contractMode ? async (query, ws) => {
          // MISSION CONTRACT v4 (TEST, opt-in): one structured reading, validated, compiled.
          // The workspace's Company Brain is applied to the CONTRACT before approval
          // (missionContract/brain.ts): the user's words outrank it, its preferences only
          // rank, its enforced size rule is a visible, attributed requirement — and all of
          // it is inside the approved hash.
          const r = await interpretContract(query, gptContractGenerate());
          if (!r.ok) return { error: r.error };
          const brain = await loadBrainPlanningContext(admin as never, ws);
          const { contract, report } = applyCompanyBrain(r.contract, brain.contractInput ?? null);
          if (contract.ambiguities.length) {
            // A Brain rule that conflicts with the request is a question, never a silent winner.
            return { error: "needs_clarification", clarification: { questions: contract.ambiguities.map((a) => a.question), message: contract.ambiguities.map((a) => a.question).join(" ") } };
          }
          const hash = await contractHash(contract);
          return {
            mission: await compileContract(contract), contract,
            brain: { status: brain.status, fields: brain.fields, applied: report.applied, rejected: report.notApplied },
            // The approval token replays THE CONTRACT ITSELF: a run executes exactly what was approved.
            replay: { proposal: { contract, contractHash: hash }, brain: { status: brain.status, fields: brain.fields, context: null } },
          };
        } : async (query, ws, requestedCount) => {
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
        recompile: contractMode ? async (_query, _count, replay) => {
          const approved = (replay.proposal as { contract?: MissionContract; contractHash?: string } | null);
          if (!approved?.contract) return { error: "the approval carries no mission contract; plan again" };
          if (await contractHash(approved.contract) !== approved.contractHash) return { error: "the approved contract does not match its hash; plan again" };
          return { mission: await compileContract(approved.contract), contract: approved.contract };
        } : (query, requestedCount, replay) => {
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
