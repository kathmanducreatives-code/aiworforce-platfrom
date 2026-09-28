// WHO MAY SETTLE AN APPROVAL — decided before any privileged write.
//
// `approve-and-continue` used the service-role client with no caller check at
// all: anyone holding the public anon key and an approval id could approve or
// reject ANY workspace's approval and continue its plan (which can send
// outreach). The chain is now, in this order and nothing skipped:
//
//   authenticate the caller (a real user JWT)
//   → load the approval SERVER-SIDE by id
//   → derive the workspace FROM THE APPROVAL (never from the request)
//   → verify the caller is a member of that workspace
//   → verify the member's role may settle approvals
//   → only then write, with a conditional update that only a PENDING row passes
//
// This module is pure: the handler does the IO and feeds the answers in, so the
// decisions are unit-tested without a network.

export type ApprovalAction = "approve" | "reject";

/** Membership roles that may settle an approval. Unknown roles are refused. */
export const APPROVER_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "member"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Refusal = { ok: false; status: number; error: string };

export function parseApprovalRequest(body: unknown):
  | { ok: true; approvalId: string; action: ApprovalAction }
  | Refusal {
  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const approvalId = typeof b.approval_id === "string" ? b.approval_id.trim() : "";
  if (!UUID_RE.test(approvalId)) return { ok: false, status: 400, error: "approval_id_required" };
  // Anything but the two actions is refused — the old handler treated every
  // value other than "reject" as an approval.
  if (b.action !== "approve" && b.action !== "reject") return { ok: false, status: 400, error: "invalid_action" };
  return { ok: true, approvalId, action: b.action };
}

export interface ApprovalRecord {
  id: string;
  workspace_id: string | null;
  task_plan_id: string | null;
  agent_id: string | null;
  status: string | null;
  payload: Record<string, unknown> | null;
}

/**
 * After authentication: may THIS user act on THIS approval? `role` is the
 * caller's membership role in the approval's own workspace, or null.
 * An approval with no workspace can be authorised by nobody.
 */
export function decideApprovalAccess(i: { approval: ApprovalRecord | null; role: string | null }):
  | { ok: true; workspaceId: string }
  | Refusal {
  if (!i.approval || !i.approval.workspace_id) return { ok: false, status: 404, error: "approval_not_found" };
  if (i.role === null) return { ok: false, status: 403, error: "forbidden" };
  if (!APPROVER_ROLES.has(i.role)) return { ok: false, status: 403, error: "forbidden_action" };
  return { ok: true, workspaceId: i.approval.workspace_id };
}

const SETTLED_BY: Record<ApprovalAction, string> = { approve: "approved", reject: "rejected" };

export function statusFor(action: ApprovalAction): string {
  return SETTLED_BY[action];
}

/**
 * The answer for an approval that is no longer pending — deterministic, so a
 * repeated click or a retried request never continues a plan twice. The same
 * decision again is a success that did nothing; the opposite one is a conflict.
 */
export function settledAnswer(currentStatus: string | null, action: ApprovalAction):
  { status: number; body: Record<string, unknown> } {
  if (currentStatus === SETTLED_BY[action]) {
    return { status: 200, body: { ok: true, success: true, status: currentStatus, already_settled: true } };
  }
  return { status: 409, body: { ok: false, error: "approval_already_resolved", status: currentStatus } };
}
