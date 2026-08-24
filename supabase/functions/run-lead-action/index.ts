// WORKBENCH LEAD ACTIONS — the per-row unlock path, in its own deployment.
//
// ── WHY THIS IS A SEPARATE FUNCTION ─────────────────────────────────────────
//
// It lived inside `run-agent` as an early-return branch. Two facts made that a
// deployment problem rather than a stylistic one:
//
//   1. `run-agent` reached 5.33 MB against a 5 MB platform limit and could no
//      longer deploy at all. Every module in its graph is live — there was no
//      dead architecture to delete.
//
//   2. The two workloads share NOTHING. `leadActionExecutor` pulls 24 modules
//      (the `workbench` opener generation, the `decisionMaker` people search,
//      contact enrichment) that the sourcing engine never touches, and the
//      sourcing engine pulls a capability graph this path never touches. The
//      dependency sets are disjoint.
//
// Two entry points with disjoint graphs sharing one deployment unit is the
// boundary that was wrong. It was already half-recognised: `run-agent` imported
// the executor DYNAMICALLY, which signals separability but saves nothing,
// because the platform bundles everything reachable either way.
//
// ── WHAT IS DELIBERATELY IDENTICAL ──────────────────────────────────────────
//
// The request contract, the response shape, every guard and every failure code
// are carried over unchanged. This is a move, not a redesign: the auth check,
// the workspace-membership gate, the workspace-scoped agent lookup, the
// task-user attribution rule and the row-ownership guard are all the same code
// doing the same job in a new file. A caller cannot tell the difference except
// by the URL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runTool } from "../_shared/toolRegistry.ts";
import { decideWorkspaceAccess } from "../_shared/workspaceAccessGuard.ts";
import {
  isDirectLeadActionAttempt,
  validateDirectLeadActionRequest,
  resolveTaskUserId,
  type DirectLeadActionRequest,
} from "../_shared/leadActionRequestContract.ts";
import { summarizeDirectAction } from "../_shared/leadActionOutcome.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }

  const workspace_id = String(body.workspace_id ?? "");
  const tool_input_body = body.tool_input as Record<string, unknown> | undefined;
  const user_id = typeof body.user_id === "string" ? body.user_id : undefined;

  if (!workspace_id) return json({ error: "invalid_workspace_id" }, 400);

  // THIS FUNCTION SERVES EXACTLY ONE SHAPE. `run-agent` had to recognise a
  // direct action before its plan-step gate because it also served orchestrated
  // steps; here anything else is simply the wrong endpoint, and saying so is
  // better than half-running an orchestration this function cannot complete.
  if (!isDirectLeadActionAttempt(tool_input_body)) {
    return json({
      success: false,
      error: "not_a_lead_action",
      message: "This endpoint serves Workbench lead actions only.",
    }, 400);
  }

  const validated = validateDirectLeadActionRequest({ workspace_id, tool_input: tool_input_body });
  if (!validated.ok) {
    return json({ success: false, error: validated.error_code, message: validated.message }, validated.status);
  }
  const directRequest: DirectLeadActionRequest = validated.request;
  // Derived internally — never trusted from the browser.
  const agent_slug = directRequest.agent_slug;

  // ── AUTH: SERVICE ROLE, OR A MEMBER OF THIS WORKSPACE ───────────────────
  //
  // A browser call carries a user JWT and MUST belong to `workspace_id`, so a
  // frontend-supplied id cannot reach another workspace's rows.
  let authenticatedUserId: string | null = null;
  let bearerIsServiceRole = false;
  {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    bearerIsServiceRole = !!bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let isMember = false;
    if (!bearerIsServiceRole) {
      try {
        const userClient = createClient(
          Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: userData } = await userClient.auth.getUser(bearer);
        authenticatedUserId = userData?.user?.id ?? null;
        if (authenticatedUserId) {
          const { data: member } = await supabase
            .from("workspace_members").select("workspace_id")
            .eq("workspace_id", workspace_id).eq("user_id", authenticatedUserId).maybeSingle();
          isMember = !!member;
        }
      } catch (_e) { /* treated as unauthenticated below */ }
    }

    const access = decideWorkspaceAccess({ bearerIsServiceRole, authenticatedUserId, isMember });
    if (!access.ok) return json({ error: access.error }, access.status);
  }

  // AGENT, SCOPED TO THE WORKSPACE. Unscoped, `scout` can resolve to another
  // workspace's row and run the action under it.
  const { data: agent, error: agentErr } = await supabase.from("agents")
    .select("id, slug, name, model, role_prompt, department")
    .eq("workspace_id", workspace_id).eq("slug", agent_slug).maybeSingle();
  if (agentErr || !agent) {
    return json({ error: "agent_not_found", details: agentErr?.message }, 404);
  }

  // `tasks.user_id` is NOT NULL. A direct action carries only a JWT, so it falls
  // back to the user the workspace guard authenticated; `body.user_id` is
  // honoured ONLY for a verified service-role caller, so a spoofed one has no
  // effect. Passing null here is what produced the task_insert_failed incident.
  const taskUserId = resolveTaskUserId({ bearerIsServiceRole, bodyUserId: user_id, authenticatedUserId });
  if (!taskUserId) {
    return json({ success: false, error: "unidentified_user", message: "Sign in again to run this action." }, 401);
  }

  const { data: inserted, error: taskErr } = await supabase.from("tasks").insert({
    plan_id: null,
    agent_slug: agent.slug ?? agent_slug,
    user_id: taskUserId,
    workspace_id,
    status: "running",
    payload: { instruction: directRequest.instruction, lead_action: directRequest.action },
  }).select("id").single();
  if (taskErr || !inserted) {
    return json({ error: "task_insert_failed", details: taskErr?.message }, 500);
  }
  const task = inserted as { id: string };

  const leadAction = directRequest.action;
  const leadIds = directRequest.lead_candidate_ids;

  // OWNERSHIP. Workspace membership is not enough — the caller must own every
  // row it named. Without this a member of workspace A could pass workspace B's
  // ids and have the service-role client happily enrich against them.
  const { data: ownedRows, error: ownErr } = await supabase
    .from("lead_candidates").select("id").eq("workspace_id", workspace_id).in("id", leadIds);
  if (ownErr) {
    await supabase.from("tasks").update({ status: "failed", error_message: "lead_ownership_check_failed" }).eq("id", task.id);
    return json({ success: false, task_id: task.id, error: "lead_ownership_check_failed", message: "Could not verify the selected rows." }, 500);
  }
  const ownedIds = new Set((ownedRows ?? []).map((r: { id: string }) => r.id));
  if (leadIds.some((id: string) => !ownedIds.has(id))) {
    await supabase.from("tasks").update({ status: "failed", error_message: "lead_not_in_workspace" }).eq("id", task.id);
    return json({ success: false, task_id: task.id, error: "lead_not_in_workspace", message: "Those rows aren't in this workspace." }, 403);
  }

  const toolCtx = {
    admin: supabase, workspace_id, agent_slug: agent.slug ?? agent_slug,
    agent_id: agent.id, agent_name: agent.name, plan_id: null,
    task_id: task.id, user_id: taskUserId,
  };

  try {
    const { executeLeadAction } = await import("../_shared/leadActionExecutor.ts");
    const outcome = await executeLeadAction(leadAction, leadIds, {
      admin: supabase, workspace_id, plan_id: null, task_id: task.id,
      agent_id: agent.id, agent_slug: agent.slug ?? agent_slug, agent_name: agent.name,
      user_id: taskUserId, runTool, toolCtx,
      output_mode: directRequest.output_mode,
    });

    await supabase.from("tasks").update({
      status: outcome.needs_approval ? "awaiting_approval" : "complete",
      result: { output: outcome.summary, lead_action: leadAction, per_lead: outcome.per_lead },
    }).eq("id", task.id);

    return json({
      success: true,
      action: leadAction,
      task_id: task.id,
      status: outcome.needs_approval ? "awaiting_approval" : "complete",
      summary: outcome.summary,
      per_lead: outcome.per_lead,
      needs_approval: outcome.needs_approval,
    });
  } catch (e) {
    // A THROWN BATCH IS NOT "0 SUCCEEDED". Every row is reported as failed with
    // a reason, so the batch never silently reports nothing with no explanation.
    console.error("[run-lead-action] failed:", e);
    await supabase.from("tasks").update({ status: "failed", error_message: String(e) }).eq("id", task.id);
    const failed = leadIds.map((id: string) => ({
      lead_candidate_id: id, status: "failed" as const,
      reason_code: "provider_failed", retryable: true,
    }));
    return json({
      success: false, action: leadAction, task_id: task.id, status: "failed",
      error: "lead_action_failed",
      summary: summarizeDirectAction(failed, leadIds.length),
      per_lead: failed,
    }, 500);
  }
});
