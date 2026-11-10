// daily-brief: ORION — Executive Intelligence. The workspace's executive brief.
//
// Reads what the other agents produced (signal_events, lead_candidates,
// content_item), what is waiting on the user (approvals, content drafts), what
// is running or failed (task_plans, tasks) and the Company Brain — through
// `_shared/executiveBriefContext.ts` — and synthesizes a structured brief with
// at most three priorities and evidence-backed recommendations
// (`_shared/executiveBrief.ts`). Ranking is deterministic; the model may only
// re-word it, and that wording is validated against the facts.
//
// Two callers:
//   - chat (pilot-chat's brief route): persists the markdown as an assistant
//     message in the conversation, as before;
//   - the dashboard (`surface: "dashboard"`): no conversation is created.
// Every brief is also stored in `saved_outputs` (type `executive_brief`, the
// structured brief in `raw`), which is the briefing history.
//
// Auth: validates JWT in code (verify_jwt=false at platform). Membership check
// via workspace_members BEFORE any workspace read. All reads are scoped to the
// workspace. No provider other than the one optional model call is reached.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateText } from "../_shared/aiProvider.ts";
import { createTerraRunLimiter } from "../_shared/terraPolicy.ts";
import { isToolConfigured } from "../_shared/toolRegistry.ts";
import { getAgentorySystemPrompt } from "../_shared/agentorySystemPrompt.ts";
import { ModelCallCollector, createLedgerWriter } from "../_shared/executionLedger.ts";
import {
  resolveRunBudget, authorizeModelSpend, resolveSpendEnforcement, resolveCeiling,
  describeSpend, type SpendDb,
} from "../_shared/modelSpendCeiling.ts";
import { collectExecutiveContext, type BriefDb } from "../_shared/executiveBriefContext.ts";
import {
  applyModelWording, EXECUTIVE_BRIEF_OUTPUT_TYPE, MODEL_INSTRUCTIONS, modelFacts,
  renderExecutiveBriefMarkdown, synthesizeExecutiveBrief, type ExecutiveBrief,
} from "../_shared/executiveBrief.ts";
import { renderCompanyBrainBlock } from "../_shared/companyBrainContext.ts";
import { renderBrainMemoryBlock } from "../_shared/companyBrainAgentViews.ts";

/**
 * Skips the AI wording without pretending the provider failed.
 *
 * The wording sits inside a try/catch that degrades to the deterministic
 * brief, which is exactly the behaviour a refused call wants — so the ceiling
 * reuses that path rather than duplicating it, and this marker keeps the log
 * honest about which of the two happened.
 */
class SkipPolish extends Error {}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

/** The public identity the brief is written as (agentRegistry: `orion`). */
const ORION_SLUG = "orion";

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
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown> | null;
  try { body = await req.json(); } catch { return json({ error: "invalid json body" }, 400); }
  const workspaceId = typeof body?.workspace_id === "string" ? body.workspace_id : "";
  let conversationId: string | null = typeof body?.conversation_id === "string" ? body.conversation_id : null;
  const surface: "chat" | "dashboard" = body?.surface === "dashboard" ? "dashboard" : "chat";
  if (!workspaceId) return json({ error: "workspace_id required" }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // membership — before any workspace read
  const { data: member } = await admin
    .from("workspace_members").select("workspace_id")
    .eq("user_id", userId).eq("workspace_id", workspaceId).maybeSingle();
  if (!member) return json({ error: "Forbidden — not a member of this workspace" }, 403);

  // ensure conversation (chat surface only)
  if (surface === "chat") {
    if (conversationId) {
      const { data: existing } = await admin.from("conversations")
        .select("id, user_id").eq("id", conversationId).maybeSingle();
      if (!existing || existing.user_id !== userId) {
        return json({ error: "Conversation not found or not yours" }, 404);
      }
    } else {
      const { data: created } = await admin.from("conversations").insert({
        user_id: userId, agent_slug: "pilot", channel: "dashboard",
        title: "Executive Brief", status: "active",
      }).select("id").single();
      conversationId = created?.id ?? null;
    }
  } else {
    conversationId = null;
  }

  // ---- Collect and synthesize (reads only; workspace-scoped; bounded) ----
  const ctx = await collectExecutiveContext(admin as unknown as BriefDb, workspaceId);
  const deterministic = synthesizeExecutiveBrief(ctx);
  let brief: ExecutiveBrief = deterministic;

  // ---- Optional AI wording (no new facts; validated) ----
  // Bounds and reports this function's one model call. `generateText` emits
  // telemetry ONLY through `onModelCall`, so without this the brief spent on
  // every request and appeared in no ledger.
  const modelCalls = new ModelCallCollector(resolveRunBudget());

  // ── LAYER 1: THE WORKSPACE USD CEILING ───────────────────────────────────
  //
  // IT DEGRADES, IT DOES NOT REFUSE — deliberately. The model call here only
  // RE-WORDS a brief that is already complete from real rows. A 429 would
  // delete a working brief to save half a cent, and a report that vanishes is
  // how a ceiling gets switched off. An over-ceiling workspace still gets its
  // brief, in the deterministic form, and spends nothing.
  const spend = await authorizeModelSpend({
    db: admin as unknown as SpendDb,
    workspace_id: workspaceId,
    mode: resolveSpendEnforcement(),
    ...resolveCeiling(),
  });
  if (spend.over_ceiling || spend.reason === "query_failed") {
    console.log("[daily-brief][model-spend]", describeSpend(spend));
  }
  if (!spend.allowed) {
    console.log("[daily-brief] polish skipped — model spend ceiling reached", {
      workspaceId, spent_usd: spend.spent_usd, ceiling_usd: spend.ceiling_usd,
    });
  }

  // Nothing to word when there is nothing to brief on: skip the call entirely.
  const worthWording = deterministic.priorities.length > 0;

  try {
    if (!spend.allowed) throw new SkipPolish();
    if (!worthWording) throw new SkipPolish();
    // The SAME shared context ORION ranked with (profile + approved memory) —
    // no second read, so the wording cannot see a different Brain than the ranking.
    const shared = ctx.shared_brain ?? null;
    const profile = (shared?.effective_profile ?? {}) as Record<string, unknown>;
    const brainBlock = renderCompanyBrainBlock(profile, !!shared?.onboarding_completed) +
      (shared ? "\n\n" + renderBrainMemoryBlock(shared, "orion") : "");
    const facts = modelFacts(deterministic, brainBlock);
    const ai = await generateText({
      taskType: "helper",
      systemPrompt:
        getAgentorySystemPrompt({
          taskType: "reporting",
          currentAgent: "orion",
          companyBrain: profile,
        }) + "\n\n" + MODEL_INSTRUCTIONS,
      messages: [{ role: "user", content: "FACTS:\n" + facts }],
      temperature: 0.2,
      maxTokens: 900,
      jsonMode: true,
      functionName: "daily-brief",
      workspaceId,
      onModelCall: modelCalls.sink,
      workforceTask: "orion_reasoning",
      terraLimiter: createTerraRunLimiter(),
      budget: modelCalls,
    });
    if (ai.ok && ai.content) {
      let parsed: unknown = null;
      try {
        const raw = ai.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
        parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      } catch { parsed = null; }
      brief = applyModelWording(deterministic, parsed, facts, ai.model || "unknown");
      if (brief.synthesis.rejected_reason) {
        console.warn("[daily-brief] model wording rejected:", brief.synthesis.rejected_reason);
      }
    } else {
      brief = { ...deterministic, synthesis: { mode: "deterministic", model: null, rejected_reason: ai.errorCode ?? "model_failed" } };
    }
  } catch (e) {
    // A skipped polish is already logged above with its reason; only a real
    // provider failure is a warning.
    if (!(e instanceof SkipPolish)) {
      console.warn("[daily-brief] AI polish failed, using deterministic brief:", e);
      brief = { ...deterministic, synthesis: { mode: "deterministic", model: null, rejected_reason: "model_error" } };
    }
  }

  // ── AND INTO THE LEDGER ──────────────────────────────────────────────────
  //
  // Outside the try/catch above: the call may have reached the provider and
  // been billed before it failed. No task or plan — a brief is a report, not a
  // run — so the workspace alone attributes the spend.
  try {
    const rows = await modelCalls.drain(createLedgerWriter(admin as never), {
      workspace_id: workspaceId, task_id: null, plan_id: null,
      logical_call_key: `daily-brief:${conversationId ?? `dashboard:${brief.generated_at}`}:model`,
    });
    if (rows > 0) console.log("[daily-brief][model-ledger]", { workspaceId, rows });
  } catch (e) {
    console.warn("[daily-brief][model-ledger] drain failed:", e);
  }

  const markdown = renderExecutiveBriefMarkdown(brief);

  // ---- Persist: the briefing history (append-only) ----
  const { data: savedOutput, error: saveErr } = await admin.from("saved_outputs").insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    type: EXECUTIVE_BRIEF_OUTPUT_TYPE,
    title: `Executive brief · ${brief.generated_at.slice(0, 10)}`,
    body: markdown,
    raw: brief,
  }).select("id, created_at").single();
  if (saveErr) console.warn("[daily-brief] could not store brief history:", saveErr.message);

  // ---- Persist assistant message (chat surface) ----
  let saved: unknown = null;
  if (conversationId) {
    const { data } = await admin.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: markdown,
      agent_slug: ORION_SLUG,
      model_used: brief.synthesis.model ?? "deterministic",
    }).select("*").single();
    saved = data;
  }

  const connectors = {
    source_with_apify: isToolConfigured("source_with_apify").ready,
    scrape_url: isToolConfigured("scrape_url").ready,
  };
  const connectorsMissing = Object.entries(connectors).filter(([, v]) => !v).map(([k]) => k);

  return json({
    type: "reply",
    intent: "daily_brief",
    conversation_id: conversationId,
    message: saved,
    brief,
    saved_output_id: savedOutput?.id ?? null,
    stored: !saveErr,
    connectors_missing: connectorsMissing,
  });
});
