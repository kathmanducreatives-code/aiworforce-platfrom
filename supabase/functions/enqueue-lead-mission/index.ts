// enqueue-lead-mission — queue a mission step for the LeadMission V2 worker.
//
// SERVICE-ROLE ONLY. The caller is orchestrate (or an operator), never a browser:
// the body is a run-agent kickoff and is replayed with service authority.
//
// GUARDED. It enqueues only when the workspace resolves to the v2_worker engine
// (i.e. it is listed in LEAD_V2_WORKER_WORKSPACES). With the allowlist empty —
// the default — every request is refused with 409 and V2 stays disabled.
//
// What it stores: orchestrate's own kickoff body for an approved mission step,
// with the canary's quota forced to 1. The worker replays it into run-agent's
// handler, so V2 executes exactly the request the edge path would have.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveLeadExecutionEngine } from "../_shared/leadExecutionEngine.ts";
import {
  forceCanaryLeadCount, validateV2KickoffBody, type KickoffBody,
} from "../_shared/leadMissionV2Request.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "server_misconfigured" }, 500);

  const authz = req.headers.get("Authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (token !== SERVICE_KEY) return json({ error: "Unauthorized" }, 401);

  let payload: { request?: unknown } = {};
  try { payload = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const valid = validateV2KickoffBody(payload.request);
  if (!valid.ok) return json({ error: "invalid_request", code: valid.code }, 400);
  const request = payload.request as KickoffBody;
  const workspaceId = request.workspace_id as string;

  // THE GATE. Empty allowlist ⇒ v1_edge ⇒ refuse. V2 is opt-in per workspace.
  if (resolveLeadExecutionEngine(workspaceId, (k) => Deno.env.get(k)) !== "v2_worker") {
    return json({ error: "v2_worker_not_enabled_for_workspace", workspace_id: workspaceId }, 409);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const forced = forceCanaryLeadCount(request);
  const { data, error } = await admin.from("lead_mission_queue")
    .insert({ workspace_id: workspaceId, request: forced, status: "queued" })
    .select("id")
    .single();
  if (error || !data) return json({ error: "enqueue_failed", detail: error?.message ?? null }, 500);

  return json({
    queue_id: (data as { id: string }).id,
    engine: "v2_worker",
    requested_lead_count: forced.requested_lead_count,
  }, 201);
});
