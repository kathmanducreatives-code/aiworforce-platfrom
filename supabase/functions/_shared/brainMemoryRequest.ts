// company-brain-memory: request parsing and outcome mapping (pure).
//
// The edge handler is a thin shell around this: parse → role pre-check →
// RPC (which re-authorizes in its own transaction) → map the outcome. Keeping
// the parsing here makes every refusal testable without a server.

import { MEMORY_SCOPES, decisionScopeError, valueMatchesType } from "./brainMemoryModel.ts";
import type { BrainPermission } from "./brainRole.ts";

export const MEMORY_OPS = ["set", "correct", "decide", "retract", "dispute", "mark_stale", "reactivate"] as const;
export type MemoryOp = typeof MEMORY_OPS[number];

export type MemoryRequest =
  | { action: "context"; workspace_id: string }
  | { action: "write"; workspace_id: string; op: MemoryOp; payload: Record<string, unknown>; idempotency_key: string }
  | { action: "review_proposal"; workspace_id: string; proposal_id: string; decision: "approve" | "correct" | "reject";
      corrected_value: unknown; note: string | null; expected_memory_version: number | null; idempotency_key: string }
  | { action: "redact"; workspace_id: string; target: "memory" | "revision"; id: string; reason: string }
  | { action: "content_approved"; workspace_id: string; content_item_id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Which Brain permission an action needs before any RPC is sent. */
export function permissionForMemoryAction(action: MemoryRequest["action"]): BrainPermission {
  if (action === "context") return "read";
  if (action === "redact") return "activate";
  return "edit";
}

export function parseMemoryRequest(body: unknown): { ok: true; req: MemoryRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be an object" };
  const b = body as Record<string, unknown>;
  const workspace_id = s(b.workspace_id);
  if (!UUID.test(workspace_id)) return { ok: false, error: "workspace_id must be a uuid" };
  const action = s(b.action);
  const idem = s(b.idempotency_key);
  const needKey = () => (idem.length >= 8 && idem.length <= 200 ? null : "idempotency_key required (8-200 chars)");

  switch (action) {
    case "context":
      return { ok: true, req: { action, workspace_id } };

    case "write": {
      const op = s(b.op) as MemoryOp;
      if (!(MEMORY_OPS as readonly string[]).includes(op)) return { ok: false, error: "unknown op" };
      const k = needKey(); if (k) return { ok: false, error: k };
      const p = b.payload;
      if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, error: "payload must be an object" };
      const payload = { ...(p as Record<string, unknown>) };
      // A browser cannot claim a provenance it does not have.
      if ("source_type" in payload && !["user_provided", "corroborated", "provider_returned"].includes(String(payload.source_type))) {
        return { ok: false, error: "source_type not allowed for a user write" };
      }
      for (const f of ["created_by_kind", "created_by_agent", "approval_status", "approved_by", "proposal_id", "verification_status"]) {
        if (f in payload) return { ok: false, error: `${f} is set by the server, never by the request` };
      }
      for (const f of ["expires_at", "review_at", "observed_at"]) {
        if (payload[f] != null && !ISO.test(String(payload[f]))) return { ok: false, error: `${f} must be an ISO date` };
      }
      if (["retract", "dispute", "mark_stale", "reactivate"].includes(op)) {
        if (!UUID.test(s(payload.memory_id))) return { ok: false, error: "memory_id must be a uuid" };
        if (!Number.isInteger(payload.expected_version)) return { ok: false, error: "expected_version required" };
      } else {
        const scope = s(payload.scope) || "workspace";
        if (!(MEMORY_SCOPES as readonly string[]).includes(scope)) return { ok: false, error: "unknown scope" };
        if (op === "decide") {
          const err = decisionScopeError(s(payload.category), scope, s(payload.scope_ref) || null);
          if (err) return { ok: false, error: err };
          const v = payload.value as Record<string, unknown> | undefined;
          if (!v || typeof v.outcome !== "string") return { ok: false, error: "a decision needs value.outcome" };
        } else if (!valueMatchesType(s(payload.value_type), payload.value)) {
          return { ok: false, error: "value does not match value_type" };
        }
        if (payload.expected_version != null && !Number.isInteger(payload.expected_version)) {
          return { ok: false, error: "expected_version must be an integer" };
        }
      }
      return { ok: true, req: { action, workspace_id, op, payload, idempotency_key: idem } };
    }

    case "review_proposal": {
      const decision = s(b.decision) as "approve" | "correct" | "reject";
      if (!["approve", "correct", "reject"].includes(decision)) return { ok: false, error: "decision must be approve, correct or reject" };
      if (!UUID.test(s(b.proposal_id))) return { ok: false, error: "proposal_id must be a uuid" };
      const k = needKey(); if (k) return { ok: false, error: k };
      if (decision === "correct" && b.corrected_value === undefined) return { ok: false, error: "correct needs corrected_value" };
      const ev = b.expected_memory_version;
      if (ev != null && !Number.isInteger(ev)) return { ok: false, error: "expected_memory_version must be an integer" };
      return { ok: true, req: {
        action, workspace_id, proposal_id: s(b.proposal_id), decision,
        corrected_value: decision === "correct" ? b.corrected_value : null,
        note: s(b.note) || null, expected_memory_version: (ev as number | null) ?? null, idempotency_key: idem,
      } };
    }

    case "redact": {
      const target = s(b.target) as "memory" | "revision";
      if (target !== "memory" && target !== "revision") return { ok: false, error: "target must be memory or revision" };
      if (!UUID.test(s(b.id))) return { ok: false, error: "id must be a uuid" };
      if (!s(b.reason)) return { ok: false, error: "a redaction needs a reason" };
      return { ok: true, req: { action, workspace_id, target, id: s(b.id), reason: s(b.reason) } };
    }

    case "content_approved":
      if (!UUID.test(s(b.content_item_id))) return { ok: false, error: "content_item_id must be a uuid" };
      return { ok: true, req: { action, workspace_id, content_item_id: s(b.content_item_id) } };

    default:
      return { ok: false, error: "unknown action" };
  }
}

/** RPC outcome → HTTP status. */
export function statusForOutcome(outcome: string): number {
  switch (outcome) {
    case "ok": case "unchanged": case "already_recorded":
    case "created": case "contradiction": case "duplicate_pending": case "already_known": case "previously_rejected":
      return 200;
    case "invalid": return 400;
    case "session_invalid": return 401;
    case "not_member": case "forbidden_role": return 403;
    case "not_found": return 404;
    case "stale": case "not_pending": case "idempotency_conflict": return 409;
    default: return 500;
  }
}

/** True when the error says the memory schema is not on this project (held migration). */
export function isMemorySchemaMissing(message: string | null | undefined): boolean {
  return /company_brain_(memory|proposal|revisions)[a-z_]*.*(does not exist|not find|schema cache)|function .*company_brain_(memory|proposal).* does not exist|PGRST20[02]/i
    .test(message ?? "");
}

/**
 * LYRA's insight from APPROVED content: the angle a person approved for
 * publishing, offered back as a content preference ("use this angle again").
 * Derived by the server from the stored, approved row — never from the request.
 */
export function lyraInsightFromApprovedContent(item: {
  id: string; status: string | null; title: string | null; metadata: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  if (item.status !== "approved") return null;
  const strat = (item.metadata?.content_strategy ?? null) as { angle?: unknown } | null;
  const angle = typeof strat?.angle === "string" ? strat.angle.trim() : "";
  if (!angle || angle.length > 300) return null;
  const slug = angle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "angle";
  return {
    kind: "preference", category: "content", fact_key: `content.proven_angle:${slug}`,
    value_type: "text", value: angle,
    rationale: `Your team approved "${(item.title ?? "a post").slice(0, 120)}", written from this angle. Keep using it?`,
    evidence: [{ source_ref: `content_item:${item.id}` }],
    source_type: "agent_suggestion", confidence: "low",
    dedupe_key: `lyra:proven_angle:${slug}`,
  };
}
