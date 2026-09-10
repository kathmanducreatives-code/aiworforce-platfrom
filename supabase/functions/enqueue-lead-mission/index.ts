// enqueue-lead-mission — create a V2 lead mission for the long-running worker.
//
// GUARDED. It only enqueues when the workspace resolves to the v2_worker engine
// (i.e. it is in LEAD_V2_WORKER_WORKSPACES). With the allowlist empty — the Step 2
// default — every request is refused with 409, so V2 stays fully disabled and no
// `queued` lead_mission_v2 task is ever created.
//
// What it creates (only when enabled):
//   • a lead_lineages row (the cancellation/lease authority), and
//   • a tasks row with status='queued' and result->'lead_mission_v2' carrying the
//     mission spec — the ONLY marker claim_next_lead_mission selects on.
// The first production canary forces requested_lead_count = 1 regardless of input.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveLeadExecutionEngine, V2_CANARY_FORCED_REQUESTED_LEAD_COUNT,
} from "../_shared/leadExecutionEngine.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { workspace_id?: string; mission?: Record<string, unknown> } = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const workspaceId = body.workspace_id;
  if (!workspaceId) return json({ error: "workspace_id_required" }, 400);

  // THE GATE. Empty allowlist ⇒ v1_edge ⇒ refuse. V2 is opt-in per workspace.
  if (resolveLeadExecutionEngine(workspaceId, (k) => Deno.env.get(k)) !== "v2_worker") {
    return json({ error: "v2_worker_not_enabled_for_workspace", workspace_id: workspaceId }, 409);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "server_misconfigured" }, 500);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const taskId = crypto.randomUUID();
  const missionSpec = {
    ...(body.mission ?? {}),
    requested_lead_count: V2_CANARY_FORCED_REQUESTED_LEAD_COUNT, // forced for the canary
    enqueued_at: new Date().toISOString(),
    engine: "v2_worker",
  };

  // Lineage row first: it is the cancellation/lease authority the worker checks.
  const { error: linErr } = await admin.from("lead_lineages").insert({
    lineage_id: taskId, workspace_id: workspaceId, status: "active",
  });
  if (linErr) return json({ error: "lineage_insert_failed", detail: linErr.message }, 500);

  const { error: taskErr } = await admin.from("tasks").insert({
    id: taskId, workspace_id: workspaceId, lineage_id: taskId,
    status: "queued",
    result: { lead_mission_v2: missionSpec },
  });
  if (taskErr) return json({ error: "task_insert_failed", detail: taskErr.message }, 500);

  return json({ mission_id: taskId, lineage_id: taskId, engine: "v2_worker", requested_lead_count: V2_CANARY_FORCED_REQUESTED_LEAD_COUNT }, 201);
});
