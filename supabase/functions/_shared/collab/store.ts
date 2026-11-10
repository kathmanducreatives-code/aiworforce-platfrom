// The ledger's RPC seam. Every call goes through a SECURITY DEFINER function
// (held migration 20261112120000); nothing here writes a table directly.
import { handoffError, type Handoff, type HandoffStatus, type HumanDecision } from "./contract.ts";

export type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

export interface ProposeOutcome { outcome: string; id: string | null; status: HandoffStatus | null }

export async function proposeHandoff(db: Rpc, h: Handoff<unknown>): Promise<ProposeOutcome> {
  const bad = handoffError(h);
  if (bad) return { outcome: `invalid: ${bad}`, id: null, status: null };
  try {
    const { data, error } = await db.rpc("agent_handoff_propose", { p_workspace_id: h.workspace_id, p_handoff: h });
    if (error) return { outcome: "database_rejected", id: null, status: null };
    const d = (data ?? {}) as { outcome?: string; id?: string; status?: HandoffStatus };
    return { outcome: String(d.outcome ?? "unknown"), id: d.id ?? null, status: d.status ?? null };
  } catch { return { outcome: "store_threw", id: null, status: null }; }
}

export async function decideHandoff(db: Rpc, i: { workspace_id: string; actor_id: string; session_id: string; handoff_id: string; decision: HumanDecision; note?: string | null }) {
  const { data, error } = await db.rpc("agent_handoff_decide", {
    p_workspace_id: i.workspace_id, p_actor_id: i.actor_id, p_session_id: i.session_id, p_handoff_id: i.handoff_id,
    p_decision: i.decision, p_note: i.note ?? null,
  });
  if (error) return { outcome: "database_rejected", status: null as string | null };
  const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string; status?: string } | null;
  return { outcome: String(row?.outcome ?? "unknown"), status: row?.status ?? null };
}

export async function advanceHandoff(db: Rpc, i: { workspace_id: string; handoff_id: string; agent: string; expected: HandoffStatus; to: HandoffStatus; result?: Record<string, unknown> | null; error?: string | null }) {
  const { data, error } = await db.rpc("agent_handoff_advance", {
    p_workspace_id: i.workspace_id, p_handoff_id: i.handoff_id, p_agent: i.agent, p_expected: i.expected, p_to: i.to,
    p_result: i.result ?? null, p_error: i.error ?? null,
  });
  if (error) return { outcome: "database_rejected", status: null as string | null };
  const d = (data ?? {}) as { outcome?: string; status?: string };
  return { outcome: String(d.outcome ?? "unknown"), status: d.status ?? null };
}

export async function lyraDraft(db: Rpc, i: { workspace_id: string; handoff_id: string; draft: Record<string, unknown> }) {
  const { data, error } = await db.rpc("agent_handoff_lyra_draft", { p_workspace_id: i.workspace_id, p_handoff_id: i.handoff_id, p_draft: i.draft });
  if (error) return { outcome: "database_rejected", content_item_id: null as string | null };
  const d = (data ?? {}) as { outcome?: string; content_item_id?: string };
  return { outcome: String(d.outcome ?? "unknown"), content_item_id: d.content_item_id ?? null };
}
