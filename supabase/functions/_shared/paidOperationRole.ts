// WHO MAY SPEND THE WORKSPACE'S MONEY. One rule for every paid endpoint.
//
// Membership alone used to be enough: a VIEWER could start a paid Firecrawl
// scrape, a radar scan, a lead unlock or an image generation directly, even
// though the same viewer may not approve a mission (approvalAuthorization) or
// edit the Company Brain. Paid work now needs the same role that may edit:
// owner, admin or editor. An unknown role reads as viewer (normalizeWorkspaceRole).

import { canBrain, normalizeWorkspaceRole, type WorkspaceRole } from "./brainRole.ts";

export const PAID_OPERATION_FORBIDDEN = "role_forbidden_paid_operation" as const;

export function canRunPaidOperation(rawRole: unknown): boolean {
  return canBrain(normalizeWorkspaceRole(rawRole), "edit");
}

export function paidRoleRefusal(rawRole: unknown): { error: typeof PAID_OPERATION_FORBIDDEN; role: WorkspaceRole } {
  return { error: PAID_OPERATION_FORBIDDEN, role: normalizeWorkspaceRole(rawRole) };
}
