// COMPANY BRAIN V2 · B2.3 — ORION's offer to remember, in a live chat turn.
//
//   1. detectMemoryOffer reads the user's own message (pure, no model call).
//   2. A lasting statement becomes a PENDING proposal from 'orion' through the
//      V1 company_brain_proposal_submit (service role): deduped, never a second
//      pending copy, never re-offered within 180 days of a person rejecting it,
//      and flagged when it contradicts an active memory item.
//   3. ORION adds one message to the conversation carrying `memory_offer`; the
//      chat shows Remember / Edit / Not now. Remembering is a person's approval
//      (company-brain-memory review_proposal, editor role, in-transaction check).
//
// Best-effort by design: a failure here never costs the user their answer, and a
// workspace without the held memory tables simply gets no offer.
import { detectMemoryOffer, profileConflictForItem, type MemoryOffer } from "./orionMemoryOffer.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }> };

export interface MemoryOfferRecord {
  /** pending: awaiting a person · already_known: the Brain already holds exactly this · temporary: not stored. */
  status: "pending" | "already_known" | "temporary";
  summary: string;
  what?: string;
  proposal_id?: string;
  /** The Brain's profile says otherwise; approving needs an explicit choice. */
  conflict?: string | null;
  /** It replaces an earlier memory item (the review shows the old value). */
  replaces_memory_id?: string | null;
  kind?: "fact" | "preference" | "decision";
}

export async function offerMemoryFromTurn(admin: Admin, input: {
  workspaceId: string;
  conversationId: string;
  messageId: string | null;
  message: string;
  profile: Record<string, unknown> | null;
  now?: Date;
}): Promise<MemoryOfferRecord | null> {
  let offer: MemoryOffer | null;
  try { offer = detectMemoryOffer(input.message); } catch { return null; }
  if (!offer) return null;
  if (offer.kind === "temporary") return { status: "temporary", summary: offer.summary };
  const said = input.message.trim().replace(/\s+/g, " ");
  try {
    const { data, error } = await admin.rpc("company_brain_proposal_submit", {
      p_workspace_id: input.workspaceId,
      p_agent: "orion",
      p_payload: {
        kind: offer.item.kind, category: offer.item.category, fact_key: offer.item.fact_key,
        value_type: offer.item.value_type, value: offer.item.value,
        rationale: `You told ORION in chat: “${said.slice(0, 400)}”`,
        evidence: [{
          source_ref: `conversation:${input.conversationId}${input.messageId ? `#message:${input.messageId}` : ""}`,
          excerpt: said.slice(0, 500),
          observed_at: (input.now ?? new Date()).toISOString(),
        }],
        // What a person said in chat, read by rules: a suggestion until a person approves it.
        source_type: "agent_suggestion",
        confidence: "medium",
      },
    });
    if (error) return null;
    const out = (data ?? {}) as { outcome?: string; proposal_id?: string; contradicts_memory_id?: string | null };
    if (out.outcome === "already_known") return { status: "already_known", summary: offer.summary, what: offer.what, kind: offer.item.kind };
    if ((out.outcome === "created" || out.outcome === "contradiction" || out.outcome === "duplicate_pending") && out.proposal_id) {
      return {
        status: "pending", summary: offer.summary, what: offer.what, kind: offer.item.kind,
        proposal_id: out.proposal_id,
        conflict: profileConflictForItem(input.profile, offer.item),
        replaces_memory_id: out.contradicts_memory_id ?? null,
      };
    }
    // previously_rejected: a person said no to exactly this — ORION does not ask again.
    return null;
  } catch {
    return null;
  }
}

/** The chat message ORION adds for an offer. */
export function memoryOfferMessage(r: MemoryOfferRecord): { content: string; metadata: Record<string, unknown> } {
  const content = r.status === "temporary"
    ? `Noted for this request only. ${r.summary.replace(/^Applied to this request only\.\s*/, "")}`
    : r.status === "already_known"
    ? `Your Company Brain already has this: ${r.summary}. Every agent follows it.`
    : `That sounds like a lasting ${r.kind === "decision" ? "business decision" : "preference"}: “${r.summary}”. Should I remember it for every agent?${r.conflict ? ` Note: ${r.conflict}` : ""}`;
  return { content, metadata: { memory_offer: r } };
}
