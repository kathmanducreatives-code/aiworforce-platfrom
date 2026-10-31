// setup-company-brain: server-only onboarding handler.
// Actions: save_basics | save_sources | analyze | generate_followups | save_followups | finalize
// All AI/tool calls are server-side. Workspace membership enforced.

import { canBrain, normalizeWorkspaceRole } from "../_shared/brainRole.ts";
import { authorizedBrainWrite, brainWriteRefusal, sessionIdFromBearer, type BrainWriteOutcome } from "../_shared/brainWriter.ts";
import { clientBrainRefusal, resolveBrainScope } from "../_shared/clientBrain.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateJson, logProviderCall } from "../_shared/aiProvider.ts";
import { isToolConfigured, runTool } from "../_shared/toolRegistry.ts";
import { readSetupWebsites } from "../_shared/brainSetupWebsiteRead.ts";
import { mergeProfile, type StructuredBrainPatch } from "../_shared/companyBrainSchema.ts";
import { ModelCallCollector, createLedgerWriter } from "../_shared/executionLedger.ts";
import {
  resolveRunBudget, authorizeModelSpend, resolveSpendEnforcement, resolveCeiling, spendRefusalMessage,
  describeSpend, MODEL_SPEND_REFUSED, type SpendDb,
} from "../_shared/modelSpendCeiling.ts";
/**
 * LAYER 1, PER SPENDING BRANCH.
 *
 * Only `analyze` and `generate_followups` reach a model. The other five actions
 * — save_basics, save_structured, save_sources, save_followups, finalize — are
 * pure writes, and refusing a free save because of a MODEL ceiling would strand
 * a user mid-onboarding over spend they are not incurring.
 *
 * Returns a 429 body when refused, and null when the call may proceed.
 */
async function refuseIfOverCeiling(
  admin: unknown,
  workspace_id: string,
  label: string,
): Promise<Response | null> {
  const spend = await authorizeModelSpend({
    db: admin as unknown as SpendDb,
    workspace_id,
    mode: resolveSpendEnforcement(),
    ...resolveCeiling(),
  });
  if (!spend.allowed || spend.reason !== "under_ceiling") {
    console.log("[setup-company-brain][model-spend]", { label, ...describeSpend(spend) });
  }
  if (spend.allowed) return null;
  return json({
    ok: false,
    error: MODEL_SPEND_REFUSED,
    reason: spend.reason,
    message: spendRefusalMessage(spend),
  }, 429);
}


/**
 * Bookkeeping must never fail the onboarding step it only describes.
 *
 * Both call sites here — a 1200-token profile analysis and a 600-token
 * follow-up generation — reported nothing: `generateJson` forwards into
 * `generateText`, which emits telemetry ONLY through `onModelCall`.
 *
 * Drained immediately after each call rather than once at the end, because both
 * branches return straight after their call.
 */
async function drainSetupModelCalls(
  collector: ModelCallCollector,
  admin: unknown,
  workspace_id: string,
  label: string,
): Promise<void> {
  try {
    const rows = await collector.drain(createLedgerWriter(admin as never), {
      workspace_id, task_id: null, plan_id: null,
      logical_call_key: `setup-company-brain:${label}:${workspace_id}:${Date.now()}:model`,
    });
    if (rows > 0) console.log("[setup-company-brain][model-ledger]", { workspace_id, label, rows });
  } catch (e) {
    console.warn("[setup-company-brain][model-ledger] drain failed:", e);
  }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type AnyObj = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: uerr } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
  if (uerr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: AnyObj;
  try { body = await req.json(); } catch { return json({ error: "invalid_json_body" }, 400); }

  const action = String(body.action ?? "");
  const workspace_id = String(body.workspace_id ?? "");
  // One per request. The two model call sites below are mutually exclusive
  // branches on `action`, so a single collector attributes either to this
  // workspace and bounds it the same way.
  const modelCalls = new ModelCallCollector(resolveRunBudget());
  if (!workspace_id) return json({ error: "missing_workspace_id" }, 400);

  // Verify membership, then the caller's ROLE (roadmap Phase 3a) — before any
  // model call or write. Every action here writes or calls a model; `finalize`
  // activates the Brain.
  const { data: member } = await admin
    .from("workspace_members").select("workspace_id, role")
    .eq("workspace_id", workspace_id).eq("user_id", userId).maybeSingle();
  if (!member) return json({ error: "forbidden" }, 403);
  const role = normalizeWorkspaceRole((member as { role?: unknown }).role);
  const required = action === "finalize" ? "activate" : "edit";
  if (!canBrain(role, required)) return json({ error: "brain_role_forbidden", role, required }, 403);
  // Every Brain write re-checks this caller's live session, membership and role
  // in the write's own transaction (_shared/brainWriter.ts, AUTH-06).
  const sessionId = sessionIdFromBearer(authHeader);
  // Phase 3c (held): the setup wizard writes the agency Brain only. A request
  // for a client is refused here — never written to the agency Brain.
  const brainScope = resolveBrainScope(body);
  if (!brainScope.ok) { const r = clientBrainRefusal(brainScope.outcome); return json(r.body, r.status); }
  if (brainScope.scope.kind === "client") return json({ error: "client_scope_not_supported", action }, 400);
  class BrainWriteRefused extends Error {
    constructor(readonly outcome: Exclude<BrainWriteOutcome, "ok" | "stale">) { super(outcome); }
  }

  // Helper: load current profile
  async function loadProfile(): Promise<AnyObj> {
    const { data } = await admin
      .from("company_brain").select("profile").eq("workspace_id", workspace_id).maybeSingle();
    return ((data?.profile as AnyObj) ?? {});
  }
  // COMPARE-AND-SWAP. This writes the whole profile, so a plain read-modify-
  // write could revert an edit saved between the read and the write. The write
  // only lands on the version it read; on a race it re-reads and re-applies the
  // patch (a small top-level merge), and gives up loudly after a few tries.
  // `activate` marks the Brain activated in the same authorized write (finalize).
  async function saveProfile(patch: AnyObj, opts: { activate?: boolean } = {}) {
    return saveProfileWith((current) => ({ ...current, ...patch }), opts);
  }
  async function saveProfileWith(merge: (current: AnyObj) => AnyObj, opts: { activate?: boolean } = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: row } = await admin
        .from("company_brain").select("profile, updated_at").eq("workspace_id", workspace_id).maybeSingle();
      const merged = merge((row?.profile as AnyObj) ?? {});
      const written = await authorizedBrainWrite(admin, {
        workspaceId: workspace_id, actorId: userId, sessionId,
        permission: opts.activate ? "activate" : "edit",
        // No row yet: insert (a concurrent insert wins → retry as an update).
        mode: row ? "cas" : "insert", profile: merged,
        expectedUpdatedAt: row ? (row as { updated_at: string }).updated_at : null,
        activate: opts.activate === true,
      });
      if (written.outcome === "ok") return merged;
      if (written.outcome !== "stale") throw new BrainWriteRefused(written.outcome);
    }
    throw new Error("company_brain changed concurrently; retry");
  }

  try {
    if (action === "save_basics") {
      const fields = ["company_name", "website_url", "linkedin_company_url", "founder_linkedin_url", "short_description", "current_primary_goal"];
      const patch: AnyObj = {};
      for (const k of fields) if (body[k] != null) patch[k] = body[k];
      const merged = await saveProfile(patch);
      return json({ ok: true, profile: merged });
    }

    if (action === "save_structured") {
      // Shallow-merge nested groups. Never invent values; absent keys stay empty.
      // Targeting (`icp`, `competitors`) is NOT writable here: those legacy
      // blocks are mirrors of the structured Brain, maintained by the one edit
      // path (generate-company-brain-draft `update`). Writing them here is how a
      // second, divergent copy of the ICP came to exist.
      const allowed: (keyof StructuredBrainPatch)[] = [
        "founder", "company", "goals", "gtm", "positioning",
        "brand_voice", "approval_rules",
        "workflow_preferences", "integration_status", "onboarding_meta",
      ];
      const patch: StructuredBrainPatch = {};
      for (const k of allowed) {
        const v = (body as AnyObj)[k];
        if (v && typeof v === "object") (patch as AnyObj)[k] = v;
      }
      const merged = await saveProfileWith((current) => mergeProfile(current, patch));
      return json({ ok: true, profile: merged });
    }

    if (action === "save_sources") {
      const sources = Array.isArray(body.sources) ? body.sources : [];
      // Clear and re-insert for simplicity
      await admin.from("workspace_sources").delete().eq("workspace_id", workspace_id);
      const rows = sources
        .filter((s: AnyObj) => s && typeof s.url === "string" && s.url.trim())
        .map((s: AnyObj) => ({
          workspace_id,
          source_type: String(s.source_type ?? "other"),
          url: String(s.url).trim(),
          label: s.label ? String(s.label) : null,
          status: "pending",
        }));
      if (rows.length > 0) {
        const { error } = await admin.from("workspace_sources").insert(rows);
        if (error) throw error;
      }
      return json({ ok: true, count: rows.length });
    }

    if (action === "analyze") {
      const profile = await loadProfile();
      const { data: srcRows } = await admin
        .from("workspace_sources").select("source_type,url,label").eq("workspace_id", workspace_id);
      const sources = srcRows ?? [];

      // Optional enrichment via scrape_url if configured
      const scrapeReady = isToolConfigured("scrape_url").ready;
      const enrichments: { url: string; summary: string }[] = [];
      const warnings: string[] = [];
      const phases: { agent: string; label: string; status: "ok" | "skipped" | "failed" }[] = [];

      if (scrapeReady && sources.length) {
        // As Hawk, one credit per page, keyed to this run (brainSetupWebsiteRead.ts).
        const read = await readSetupWebsites({
          runTool, admin, workspace_id, user_id: userId ?? null,
          run_id: crypto.randomUUID(), sources,
        });
        enrichments.push(...read.enrichments);
        warnings.push(...read.warnings);
        phases.push({ agent: "hawk", label: "Reading your website", status: read.status });
      } else if (sources.length) {
        warnings.push("Live website analysis isn't configured yet. Continuing with manual inputs.");
        phases.push({ agent: "hawk", label: "Reading your website", status: "skipped" });
      } else {
        phases.push({ agent: "hawk", label: "Reading your website", status: "skipped" });
      }

      // LinkedIn analysis is not currently wired — keep it honest.
      phases.push({ agent: "scout", label: "LinkedIn company lookup", status: "skipped" });

      const refused = await refuseIfOverCeiling(admin, workspace_id, "analyze");
      if (refused) return refused;

      const ai = await generateJson({
        taskType: "company_brain_analyze",
        systemPrompt: "You produce a faithful structured company profile. Leave a field empty (null or '') if it is not supported by the user-provided input. NEVER invent facts.",
        messages: [{
          role: "user",
          content: `User-provided company info:\n${JSON.stringify(profile, null, 2)}\n\nSources:\n${JSON.stringify(sources, null, 2)}\n\nEnrichment excerpts (may be empty):\n${JSON.stringify(enrichments, null, 2)}\n\nReturn ONLY JSON:\n{\n  "company_summary": "1-2 sentences about what the company does",\n  "category": "short product category",\n  "target_customer_profile": "who they sell/serve",\n  "target_candidate_profile": "who they typically hire (if applicable)",\n  "offer_summary": "core offer/service",\n  "positioning": "how they position vs competitors",\n  "differentiators": ["..."],\n  "brand_voice": "tone of voice",\n  "outreach_style": "outreach style guidelines",\n  "competitors": ["..."],\n  "icp": { "buyer_roles": ["..."], "industries": ["..."], "company_size": "", "geography": "", "pain_points": ["..."] },\n  "agent_instructions": "short instructions for all agents"\n}`
        }],
        temperature: 0.3,
        maxTokens: 1200,
        functionName: "setup-company-brain",
        workspaceId: workspace_id,
        onModelCall: modelCalls.sink,
        budget: modelCalls,
      });
      await drainSetupModelCalls(modelCalls, admin, workspace_id, "analyze");

      phases.push({ agent: "pilot", label: "Mapping business model", status: ai.ok ? "ok" : "failed" });

      await logProviderCall(admin, {
        workspace_id, function_name: "setup-company-brain", task_type: "company_brain_analyze",
        provider: ai.provider, model: ai.model, success: ai.ok, latency_ms: ai.latencyMs, error_code: ai.errorCode,
      }).catch(() => {});

      const draft = (ai.ok && ai.json ? ai.json : {}) as AnyObj;
      const merged = await saveProfile({ ...draft, enriched: enrichments.length > 0 });
      return json({ ok: true, draft, profile: merged, warnings, phases, enriched: enrichments.length > 0, connectors: { scrape_url: scrapeReady } });
    }

    if (action === "generate_followups") {
      const profile = await loadProfile();
      const refusedFollowups = await refuseIfOverCeiling(admin, workspace_id, "followups");
      if (refusedFollowups) return refusedFollowups;

      const ai = await generateJson({
        taskType: "company_brain_followups",
        systemPrompt: "You generate concise onboarding follow-up questions. Output JSON only.",
        messages: [{
          role: "user",
          content: `Given this company profile:\n${JSON.stringify(profile, null, 2)}\n\nGenerate 4 short follow-up questions to refine the AI workforce's understanding. Focus on ideal customer/candidate, current goals, do-not-targets, brand tone, and top competitors. Return ONLY JSON:\n{ "questions": ["q1","q2","q3","q4"] }`
        }],
        temperature: 0.4,
        maxTokens: 600,
        functionName: "setup-company-brain",
        workspaceId: workspace_id,
        onModelCall: modelCalls.sink,
        budget: modelCalls,
      });
      await drainSetupModelCalls(modelCalls, admin, workspace_id, "followups");
      const qs = (ai.ok && (ai.json as any)?.questions) || [
        "Who is your ideal customer or candidate right now?",
        "What outcome do you want ScreeningPilot to help with this month?",
        "What kind of leads/candidates should we avoid?",
        "Who are your top competitors or reference companies?",
      ];
      return json({ ok: true, questions: qs });
    }

    if (action === "save_followups") {
      const qa = Array.isArray(body.qa) ? body.qa : [];
      const merged = await saveProfile({ pilot_followup_qa: qa });
      return json({ ok: true, profile: merged });
    }

    if (action === "finalize") {
      const patch: AnyObj = {};
      if (body.profile && typeof body.profile === "object") Object.assign(patch, body.profile);
      const merged = await saveProfile(patch, { activate: true });
      // Non-blocking activity log
      admin.from("activity_feed").insert({
        workspace_id,
        event_type: "onboarding_completed",
        title: "Company Brain setup completed",
        body: merged.company_name ? String(merged.company_name) : null,
        metadata: { user_id: userId },
      }).then(() => {}, () => {});
      return json({ ok: true, profile: merged });
    }

    return json({ error: "unknown_action", action }, 400);
  } catch (e) {
    if (e instanceof BrainWriteRefused) { const r = brainWriteRefusal(e.outcome); return json(r.body, r.status); }
    console.error("setup-company-brain error", e);
    return json({ error: "internal_error", details: e instanceof Error ? e.message : String(e) }, 500);
  }
});
