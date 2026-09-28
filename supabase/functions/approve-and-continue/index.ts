import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { functionUrl } from "../_shared/functionEndpoints.ts";
import {
  decideApprovalAccess, parseApprovalRequest, settledAnswer, statusFor,
  type ApprovalRecord,
} from "../_shared/approvalAuthorization.ts";

// USER ENDPOINT. The caller is a signed-in user; the workspace is derived from
// the approval row, never from the request. See _shared/approvalAuthorization.ts
// for the order of checks. Nothing privileged is written until every check passes.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export interface ApproveDeps {
  env: (k: string) => string | undefined;
  fetch: typeof fetch;
}

const defaultDeps: ApproveDeps = {
  env: (k) => Deno.env.get(k),
  fetch: (input, init) => fetch(input, init),
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export async function handleApproveAndContinue(req: Request, deps: ApproveDeps = defaultDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = deps.env("SUPABASE_URL");
  const anonKey = deps.env("SUPABASE_ANON_KEY");
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "server_misconfigured" }, 500);

  try {
    // 1. AUTHENTICATE — a real user, before the body is even read.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token || token === anonKey) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(url, anonKey, {
      global: { fetch: deps.fetch, headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    const userId = userData?.user?.id ?? null;
    if (userErr || !userId) return json({ error: "unauthorized" }, 401);

    const parsed = parseApprovalRequest(await req.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
    const { approvalId, action } = parsed;

    const admin = createClient(url, serviceKey, {
      global: { fetch: deps.fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 2. LOAD THE APPROVAL server-side; 3. its workspace is the only one that counts.
    const { data: approvalRow } = await admin
      .from("approvals")
      .select("id,workspace_id,task_plan_id,agent_id,status,payload")
      .eq("id", approvalId)
      .maybeSingle();
    const approval = (approvalRow ?? null) as ApprovalRecord | null;

    // 4–5. MEMBERSHIP AND ROLE in that workspace.
    let role: string | null = null;
    if (approval?.workspace_id) {
      const { data: member } = await admin
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", approval.workspace_id)
        .eq("user_id", userId)
        .maybeSingle();
      role = member ? String((member as { role?: unknown }).role ?? "member") : null;
    }
    const access = decideApprovalAccess({ approval, role });
    if (!access.ok) return json({ error: access.error }, access.status);
    const workspaceId = access.workspaceId;

    if (approval!.status !== "pending") {
      const a = settledAnswer(approval!.status, action);
      return json(a.body, a.status);
    }

    // 6. SETTLE — only a row that is STILL pending passes, so two racing
    // requests cannot both continue the plan.
    const newStatus = statusFor(action);
    const { data: won } = await admin
      .from("approvals")
      .update({ status: newStatus, resolved_at: new Date().toISOString() })
      .eq("id", approvalId)
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .select("id");
    if (!Array.isArray(won) || won.length === 0) {
      const { data: now } = await admin.from("approvals").select("status").eq("id", approvalId).maybeSingle();
      const a = settledAnswer((now as { status?: string } | null)?.status ?? null, action);
      return json(a.body, a.status);
    }

    await admin.from("activity_feed").insert({
      workspace_id: workspaceId,
      task_plan_id: approval!.task_plan_id,
      agent_id: approval!.agent_id,
      event_type: action === "approve" ? "approved" : "rejected",
      title: action === "approve" ? "Approved — continuing" : "Rejected — plan stopped",
      body: action === "approve" ? "User approved. Continuing to next step." : "User rejected the output.",
      metadata: { approval_id: approvalId, decided_by: userId },
    });

    if (action === "reject") {
      if (approval!.task_plan_id) {
        await admin.from("task_plans").update({ status: "failed" })
          .eq("id", approval!.task_plan_id).eq("workspace_id", workspaceId);
      }
      return json({ ok: true, success: true, status: "rejected" });
    }

    const payload = (approval!.payload ?? {}) as Record<string, unknown>;
    const nextStep = payload.next_step as
      | { step_index?: unknown; agent_id?: unknown; agent_name?: unknown; instruction?: unknown; needs_approval?: unknown }
      | undefined;
    if (nextStep) {
      await deps.fetch(functionUrl("run-agent", deps.env), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          task_plan_id: approval!.task_plan_id,
          step_index: nextStep.step_index,
          agent_id: nextStep.agent_id,
          workspace_id: workspaceId,
          instruction: nextStep.instruction,
          input: payload.output,
          needs_approval: nextStep.needs_approval,
        }),
      });
      return json({ ok: true, success: true, status: "continuing", next_agent: nextStep.agent_name ?? null });
    }

    if (approval!.task_plan_id) {
      await admin.from("task_plans").update({ status: "done" })
        .eq("id", approval!.task_plan_id).eq("workspace_id", workspaceId);
    }
    return json({ ok: true, success: true, status: "done" });
  } catch (err) {
    // Detail goes to the log, never to the caller.
    console.error("[approve-and-continue] unexpected error", String(err));
    return json({ error: "unexpected_error" }, 500);
  }
}

if (!Deno.env.get("APPROVE_AND_CONTINUE_IMPORT_ONLY")) Deno.serve((req) => handleApproveAndContinue(req));
