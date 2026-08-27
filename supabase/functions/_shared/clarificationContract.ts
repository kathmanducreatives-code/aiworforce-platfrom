// WHO ASKED THE QUESTION, AND THEREFORE WHO MAY READ THE ANSWER.
//
// ── WHAT A SHARED BOOLEAN COST ─────────────────────────────────────────────
//
// `messages.metadata.pending_clarification` was a bare `true` written by five
// different sites, and the resolver that consumed it never checked which one had
// written it. So a clarification asked by ONE workflow was answered by ANOTHER:
//
//   Chat Brain asks "which company do you mean?"
//     -> flag set
//   user replies "what should I focus on first?"
//     -> the lead people-vs-companies resolver claims the turn, because the flag
//        is set and it does not ask whose flag it is
//     -> matches none of its three regexes, and re-asks
//        "Please choose one: individual profiles or companies hiring."
//     -> the re-ask sets the flag AGAIN
//
// The user is then held in a menu belonging to a workflow they never entered,
// and the only exit is to type a word one of three regexes happens to match.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
//
// A clarification is OWNED. Only its owner may interpret the reply, and an
// owner that finds someone else's question must decline the turn and let normal
// understanding run. That is the whole contract, and it is small on purpose: a
// question nobody claims is answered by the semantic path, which is the correct
// default and was never reachable before.
//
// Pure. No network, no database, no model.

export const CLARIFICATION_CONTRACT_VERSION = "clarification-v1" as const;

/**
 * Which workflow asked. Adding a value here is how a new surface earns the
 * right to interpret a reply; nothing else grants it.
 */
export type ClarificationOwner =
  /** Chat Brain could not resolve a conversational referent. */
  | "referent"
  /** The objective router blocked or could not serve the request. */
  | "objective_route"
  /** The legacy lead source selector's people / companies / agency menu. */
  | "lead_source_selector";

export interface PendingClarification {
  version: typeof CLARIFICATION_CONTRACT_VERSION;
  owner: ClarificationOwner;
  /** Machine reason, for telemetry and for deciding what to do with the reply. */
  reason: string;
  /** Which part of the request is unresolved, when one is identifiable. */
  request_part_id?: string | null;
  /** The fields an answer must supply before the original request can proceed. */
  required_fields?: string[];
}

/** Build the metadata a clarification message carries. */
export function pendingClarification(
  owner: ClarificationOwner, reason: string,
  extra: { request_part_id?: string | null; required_fields?: string[] } = {},
): { pending_clarification: PendingClarification } {
  return {
    pending_clarification: {
      version: CLARIFICATION_CONTRACT_VERSION,
      owner,
      reason,
      ...(extra.request_part_id !== undefined
        ? { request_part_id: extra.request_part_id } : {}),
      ...(extra.required_fields ? { required_fields: extra.required_fields } : {}),
    },
  };
}

/**
 * Is this message a clarification owned by `owner`?
 *
 * ── LEGACY `true` IS DELIBERATELY NOT CLAIMED BY ANYONE ────────────────────
 *
 * Rows written before this contract carry `pending_clarification: true`. They
 * are real history and must not be reinterpreted: an old bare flag returns
 * false for every owner, so a stale conversation resumes through normal
 * understanding rather than into a menu whose offered actions no longer exist.
 * Read-only compatibility, at the storage boundary, controlling nothing.
 */
export function clarificationOwnedBy(
  metadata: unknown, owner: ClarificationOwner,
): PendingClarification | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).pending_clarification;
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (c.version !== CLARIFICATION_CONTRACT_VERSION) return null;
  if (c.owner !== owner) return null;
  return {
    version: CLARIFICATION_CONTRACT_VERSION,
    owner,
    reason: typeof c.reason === "string" ? c.reason : "",
    request_part_id: typeof c.request_part_id === "string" ? c.request_part_id : null,
    required_fields: Array.isArray(c.required_fields)
      ? c.required_fields.filter((x): x is string => typeof x === "string") : [],
  };
}

/** True when a message carries a clarification from ANY owner. For telemetry. */
export function isPendingClarification(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const raw = (metadata as Record<string, unknown>).pending_clarification;
  return !!raw && typeof raw === "object" &&
    (raw as Record<string, unknown>).version === CLARIFICATION_CONTRACT_VERSION;
}
