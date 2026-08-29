// CONTINUE A TERMINAL WORKFLOW — authorized as the signed-in user.
//
// The browser calls this with its OWN Supabase session token. There is no
// service-role key in the frontend, and this function refuses one: a browser
// presenting a service-role token is either a leak or an attack, and either way
// it must not be honoured.
//
// The request carries three ids and a reason. Everything that matters —
// workspace, Apify run, dataset, mission, capability state — is DERIVED from
// records the caller has been proven to own. A caller-supplied `dataset_id`
// would be a way to read any Apify dataset in the account.
//
// The paid work is invoked by calling `run-agent` server-to-server with the
// service role, which never leaves this function's environment.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideWorkspaceAccess } from "../_shared/workspaceAccessGuard.ts";
import {
  CONTINUATION_VERSION, REFUSAL_MESSAGE, REFUSAL_STATUS, decideContinuation,
  parseContinuationRequest, wouldStartNewDiscoveryRun,
} from "../_shared/workflowContinuation.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json_body" }, 400); }

  const parsed = parseContinuationRequest(body);
  if (!parsed.ok) {
    return json({ error: parsed.refusal, message: REFUSAL_MESSAGE[parsed.refusal] },
      REFUSAL_STATUS[parsed.refusal]);
  }
  const request = parsed.request;

  // ── 1. WHO IS ASKING ────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  // A SERVICE-ROLE TOKEN FROM A BROWSER IS REFUSED. This endpoint exists so the
  // frontend never needs one; accepting it would defeat the point.
  if (bearer && bearer === SERVICE_ROLE) {
    return json({ error: "service_role_not_accepted",
      message: "Call this as the signed-in user, not with a service key." }, 403);
  }
  let userId: string | null = null;
  try {
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data } = await userClient.auth.getUser(bearer);
    userId = data?.user?.id ?? null;
  } catch { userId = null; }
  if (!userId) return json({ error: "unauthorized" }, 401);

  // ── 2. WHAT THEY ARE ASKING ABOUT ───────────────────────────────────────────
  const [{ data: task }, { data: plan }, { data: conversation }] = await Promise.all([
    admin.from("tasks").select("id, plan_id, workspace_id, status, result")
      .eq("id", request.original_task_id).maybeSingle(),
    admin.from("task_plans").select("id, workspace_id, user_id, steps, user_instruction")
      .eq("id", request.original_plan_id).maybeSingle(),
    admin.from("conversations").select("id, workspace_id, user_id")
      .eq("id", request.conversation_id).maybeSingle(),
  ]);

  // POSITIVE PROOF OF LINKAGE, because `conversations.workspace_id` is unset on
  // almost every row and comparing it refused every real conversation.
  const { count: planMessageCount } = await admin.from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", request.conversation_id)
    .filter("metadata->>plan_id", "eq", request.original_plan_id);
  const conversationCarriesOriginalPlan = (planMessageCount ?? 0) > 0;

  // ── 3. MAY THEY? Same guard as every other path, unmodified. ────────────────
  const workspaceId = (task?.workspace_id ?? plan?.workspace_id) as string | null;
  if (!workspaceId) {
    return json({ error: "task_not_found", message: REFUSAL_MESSAGE.task_not_found }, 404);
  }
  const { data: member } = await admin.from("workspace_members")
    .select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  const access = decideWorkspaceAccess({
    bearerIsServiceRole: false, authenticatedUserId: userId, isMember: !!member,
  });
  if (!access.ok) return json({ error: access.error }, access.status);

  // ── 4. IS THERE ALREADY ONE? ────────────────────────────────────────────────
  const { data: priorRows } = await admin.from("task_plans")
    .select("id, plan")
    .eq("workspace_id", workspaceId)
    .filter("plan->continuation->>continuation_of_task_id", "eq", request.original_task_id)
    .limit(1);
  let existing: { plan_id: string; task_id: string } | null = null;
  if (priorRows && priorRows.length > 0) {
    const priorPlanId = (priorRows[0] as { id: string }).id;
    const { data: priorTask } = await admin.from("tasks")
      .select("id").eq("plan_id", priorPlanId).order("created_at", { ascending: true })
      .limit(1).maybeSingle();
    existing = { plan_id: priorPlanId, task_id: (priorTask as { id: string } | null)?.id ?? "" };
  }

  const { data: toolCalls } = await admin.from("tool_calls")
    .select("status, input_json, output_json")
    .eq("task_id", request.original_task_id)
    .order("created_at", { ascending: true });

  const decision = decideContinuation({
    request,
    task: task as never, plan: plan as never, conversation: conversation as never,
    conversationCarriesOriginalPlan,
    toolCalls: (toolCalls ?? []) as never,
    existing,
  });

  if (!decision.ok) {
    return json({ error: decision.refusal, message: REFUSAL_MESSAGE[decision.refusal] },
      REFUSAL_STATUS[decision.refusal]);
  }
  // REPEATED CLICKS RETURN THE SAME CONTINUATION. Not a new task, not a second
  // set of paid identity searches.
  if (!decision.created) {
    return json({ ok: true, created: false, ...decision.existing,
      conversation_id: request.conversation_id });
  }

  const spec = decision.spec;

  // ── 5. FAIL CLOSED BEFORE SPENDING ──────────────────────────────────────────
  // The whole continuation rests on discovery ADOPTING the stored run. If the
  // state would cause a new Actor start, nothing is created and nothing is
  // spent.
  if (wouldStartNewDiscoveryRun(spec.capability_execution_state,
    { restorableCompanies: spec.lead_resume_records.length })) {
    console.error("[continue-workflow][refused] state would start a new discovery run");
    return json({ error: "would_start_new_actor",
      message: "Refused: continuing would start a new discovery run instead of reusing the stored one." }, 409);
  }

  // ── 6. CREATE THE CONTINUATION ──────────────────────────────────────────────
  // Plan first. If the run-agent invocation later fails, this row and its anchor
  // message are REMOVED — a continuation that did not run must not leave a
  // phantom plan or a message describing work that never happened.
  const { data: newPlan, error: planErr } = await admin.from("task_plans").insert({
    workspace_id: spec.workspace_id,
    user_id: spec.user_id,
    created_by: spec.user_id,
    user_instruction: spec.user_instruction ?? spec.lineage.original_user_query ?? "Continue verification",
    plan_summary: `Continuation of plan ${spec.lineage.parent_plan_id} from stored run ${spec.lineage.apify_run_id}`,
    steps: spec.steps,
    status: "executing",
    current_step: 0,
    plan: { continuation: spec.lineage, idempotency_key: spec.idempotency_key },
  }).select("id").single();

  if (planErr || !newPlan) {
    return json({ error: "continuation_create_failed", details: planErr?.message }, 500);
  }
  const continuationPlanId = (newPlan as { id: string }).id;

  // The anchor message is how `persistLeadResultsPanel` finds the conversation,
  // and it is what keeps the continuation in the SAME chat.
  const { data: anchor } = await admin.from("messages").insert({
    conversation_id: spec.conversation_id,
    role: "assistant",
    content: "Continuing verification from the companies already discovered — no new search was run.",
    agent_slug: "pilot",
    metadata: {
      plan_id: continuationPlanId,
      agent_id: "pilot",
      workflow_kind: "qualified_lead_sourcing",
      continuation: spec.lineage,
    },
  }).select("id").single();

  const rollback = async (why: string) => {
    console.error("[continue-workflow][rollback]", why);
    if (anchor) await admin.from("messages").delete().eq("id", (anchor as { id: string }).id);
    await admin.from("tasks").delete().eq("plan_id", continuationPlanId);
    await admin.from("task_plans").delete().eq("id", continuationPlanId);
  };

  // ── 7. RUN IT. Server-to-server; the service role never leaves this function.
  const step0 = Array.isArray(spec.steps) ? (spec.steps as Record<string, unknown>[])[0] ?? {} : {};
  const toolInput = ((step0.metadata as { tool_input?: unknown } | undefined)?.tool_input) ?? null;
  let invokeStatus = 0;
  let invokeBody: unknown = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/run-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        plan_id: continuationPlanId,
        step_index: 0,
        agent_slug: (step0.agent_slug as string) ?? "scout",
        workspace_id: spec.workspace_id,
        user_id: spec.user_id,
        instruction: (step0.instruction as string) ?? spec.user_instruction,
        input: spec.lineage.original_user_query,
        tool_needed: (step0.tool_needed as string) ?? "source_with_apify",
        ...(toolInput ? { tool_input: toolInput } : {}),
        execution_mode: "company_first",
        capability_execution_state: spec.capability_execution_state,
        // THE OTHER HALF OF THE RESUME — AN ADDRESS, NOT A PAYLOAD.
        //
        // This used to send the checkpoint records themselves. run-agent now
        // loads them from the database against this task id and refuses the read
        // unless the row's workspace matches the one it is authorised for, so a
        // forged record cannot attach a wrong identity or suppress a needed call.
        lead_resume_parent_task_id: spec.lineage.parent_task_id,
      }),
    });
    invokeStatus = res.status;
    invokeBody = await res.json().catch(() => null);
  } catch (e) {
    await rollback(String(e));
    return json({ error: "continuation_invoke_failed", message: String(e) }, 502);
  }

  if (invokeStatus >= 400) {
    await rollback(`run-agent ${invokeStatus}`);
    return json({ error: "continuation_invoke_failed", status: invokeStatus, details: invokeBody }, 502);
  }

  const { data: createdTask } = await admin.from("tasks")
    .select("id").eq("plan_id", continuationPlanId)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();

  return json({
    ok: true,
    created: true,
    version: CONTINUATION_VERSION,
    plan_id: continuationPlanId,
    task_id: (createdTask as { id: string } | null)?.id ?? null,
    conversation_id: spec.conversation_id,
    continuation: spec.lineage,
    run_agent: invokeBody,
  });
});
