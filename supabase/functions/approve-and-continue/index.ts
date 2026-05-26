import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { approval_id, action } = await req.json();
    // action = "approve" | "reject"

    if (!approval_id || !action) {
      return new Response(
        JSON.stringify({ error: "approval_id and action required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Fetch approval
    const { data: approval } = await supabase
      .from("approvals")
      .select("*")
      .eq("id", approval_id)
      .single();

    if (!approval) {
      return new Response(
        JSON.stringify({ error: "Approval not found" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (approval.status !== "pending") {
      return new Response(
        JSON.stringify({ error: "Approval already resolved" }),
        { status: 409, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Mark approval resolved
    await supabase
      .from("approvals")
      .update({
        status: action === "approve" ? "approved" : "rejected",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", approval_id);

    // Log to activity feed
    await supabase.from("activity_feed").insert({
      workspace_id: approval.workspace_id,
      task_plan_id: approval.task_plan_id,
      agent_id: approval.agent_id,
      event_type: action === "approve" ? "approved" : "rejected",
      title: action === "approve" ? "Approved — continuing" : "Rejected — plan stopped",
      body: action === "approve"
        ? "User approved. Continuing to next step."
        : "User rejected the output.",
      metadata: { approval_id },
    });

    if (action === "reject") {
      await supabase
        .from("task_plans")
        .update({ status: "failed" })
        .eq("id", approval.task_plan_id);

      return new Response(
        JSON.stringify({ success: true, status: "rejected" }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // If approved — fire next step if one exists
    const nextStep = approval.payload?.next_step;
    if (nextStep) {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/run-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          task_plan_id: approval.task_plan_id,
          step_index: nextStep.step_index,
          agent_id: nextStep.agent_id,
          workspace_id: approval.workspace_id,
          instruction: nextStep.instruction,
          input: approval.payload?.output,
          needs_approval: nextStep.needs_approval,
        }),
      });

      return new Response(
        JSON.stringify({ success: true, status: "continuing", next_agent: nextStep.agent_name }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // No next step after approval — mark done
    await supabase
      .from("task_plans")
      .update({ status: "done" })
      .eq("id", approval.task_plan_id);

    return new Response(
      JSON.stringify({ success: true, status: "done" }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Unexpected error", detail: String(err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
