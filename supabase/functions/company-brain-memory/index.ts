// company-brain-memory — the ONE browser door to Company Brain memory writes.
//
// Actions:
//   context            read: the shared context summary + what each agent receives
//   write              set | correct | decide | retract | dispute | mark_stale | reactivate
//   review_proposal    approve | correct | reject an agent proposal
//   redact             privacy redaction of a memory item or a profile revision (owner/admin)
//   content_approved   LYRA: offer the approved content's angle back as a PROPOSAL
//
// Authorization happens twice, on purpose (the AUTH-06 pattern):
//   1. here, before any write is sent: a valid JWT, membership, and the role the
//      action needs (_shared/brainRole.ts) — a viewer is refused without an RPC;
//   2. inside the SECURITY DEFINER function, in the write's own transaction,
//      under row locks on the session and membership — so a demotion, removal
//      or logout that lands in between still refuses the write.
// The browser never holds the service role and cannot call the functions itself.
// No model or provider is called by this function. Nothing here spends.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canBrain, normalizeWorkspaceRole } from "../_shared/brainRole.ts";
import { sessionIdFromBearer } from "../_shared/brainWriter.ts";
import {
  isMemorySchemaMissing, lyraInsightFromApprovedContent, parseMemoryRequest, permissionForMemoryAction, statusForOutcome,
} from "../_shared/brainMemoryRequest.ts";
import { loadCompanyBrainContext, type LoaderDb } from "../_shared/companyBrainContextLoader.ts";
import { atlasView, renderBrainMemoryBlock } from "../_shared/companyBrainAgentViews.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.slice(7).trim();
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: uerr } = await userClient.auth.getUser(token);
  if (uerr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json_body" }, 400); }
  const parsed = parseMemoryRequest(body);
  if (!parsed.ok) return json({ error: "invalid_request", reason: parsed.error }, 400);
  const r = parsed.req;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Membership and role, before anything else is read or sent.
  const { data: member } = await admin.from("workspace_members").select("workspace_id, role")
    .eq("workspace_id", r.workspace_id).eq("user_id", userId).maybeSingle();
  if (!member) return json({ error: "forbidden", reason: "not_member" }, 403);
  const role = normalizeWorkspaceRole((member as { role?: unknown }).role);
  const required = permissionForMemoryAction(r.action);
  if (!canBrain(role, required)) return json({ error: "brain_role_forbidden", role, required }, 403);
  const sessionId = sessionIdFromBearer(authHeader);

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) {
      if (isMemorySchemaMissing(error.message)) return { status: 503, body: { error: "memory_unavailable" } };
      console.error(`[company-brain-memory][${fn}]`, error.message);
      return { status: 500, body: { error: "internal_error" } };
    }
    const res = (data ?? {}) as { outcome?: string };
    return { status: statusForOutcome(String(res.outcome ?? "")), body: res };
  };

  try {
    switch (r.action) {
      case "context": {
        const loaded = await loadCompanyBrainContext(admin as unknown as LoaderDb, r.workspace_id, { userId });
        if (!loaded.ok) return json({ error: loaded.error }, 403);
        const c = loaded.context;
        return json({
          ok: true, status: c.status, fingerprint: c.fingerprint, warnings: c.warnings,
          pending_proposals: c.pending_proposals, needs_review: c.needs_review.length,
          applied: c.applied, recent_changes: c.recent_changes,
          competitors: c.competitors, exclusions: { ...c.exclusions, items: undefined },
          agents: {
            orion: renderBrainMemoryBlock(c, "orion"),
            atlas: renderBrainMemoryBlock(c, "atlas"),
            lyra: renderBrainMemoryBlock(c, "lyra"),
            lisa: renderBrainMemoryBlock(c, "lisa"),
          },
          atlas_contract: atlasView(c),
        });
      }
      case "write": {
        if (!sessionId) return json({ error: "Unauthorized", reason: "session_invalid" }, 401);
        const out = await rpc("company_brain_memory_write", {
          p_workspace_id: r.workspace_id, p_actor_id: userId, p_session_id: sessionId,
          p_op: r.op, p_payload: r.payload, p_idempotency_key: r.idempotency_key,
        });
        return json(out.body, out.status);
      }
      case "review_proposal": {
        if (!sessionId) return json({ error: "Unauthorized", reason: "session_invalid" }, 401);
        const out = await rpc("company_brain_proposal_review", {
          p_workspace_id: r.workspace_id, p_actor_id: userId, p_session_id: sessionId,
          p_proposal_id: r.proposal_id, p_action: r.decision, p_corrected_value: r.corrected_value,
          p_note: r.note, p_expected_memory_version: r.expected_memory_version, p_idempotency_key: r.idempotency_key,
        });
        return json(out.body, out.status);
      }
      case "redact": {
        if (!sessionId) return json({ error: "Unauthorized", reason: "session_invalid" }, 401);
        const out = await rpc("company_brain_memory_redact", {
          p_workspace_id: r.workspace_id, p_actor_id: userId, p_session_id: sessionId,
          p_target: r.target, p_id: r.id, p_reason: r.reason,
        });
        return json(out.body, out.status);
      }
      case "content_approved": {
        // The proposal is derived from the STORED row, scoped to this workspace —
        // the request names the item, it cannot supply the insight.
        const { data: item } = await admin.from("content_item").select("id, status, title, metadata")
          .eq("id", r.content_item_id).eq("workspace_id", r.workspace_id).maybeSingle();
        if (!item) return json({ error: "not_found" }, 404);
        const proposal = lyraInsightFromApprovedContent(item as never);
        if (!proposal) return json({ ok: true, outcome: "nothing_to_propose" });
        const out = await rpc("company_brain_proposal_submit", {
          p_workspace_id: r.workspace_id, p_agent: "lyra", p_payload: proposal,
        });
        return json(out.body, out.status);
      }
    }
  } catch (e) {
    console.error("[company-brain-memory] error", e instanceof Error ? e.message : String(e));
    return json({ error: "internal_error" }, 500);
  }
});
