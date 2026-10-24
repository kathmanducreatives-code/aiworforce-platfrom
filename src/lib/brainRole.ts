// Who may do what to a workspace's Company Brain (roadmap Phase 3a).
//
// Frontend copy of supabase/functions/_shared/brainRole.ts — the server decides;
// this lets the page show a viewer a read-only Brain. Keep the two identical.
//
// Owner decision P3-D1 (2026-10-23): the workspace roles are owner, admin,
// editor and viewer. `workspace_members.role` is free text, so anything else —
// a legacy value, a typo, an empty string — is treated as a viewer: it fails
// closed. The browser cannot write `company_brain` at all
// (20261023120000_company_brain_server_writes_only.sql); every edit reaches the
// backend, and the backend asks this before any model call or write.
//
// Client Brains (Phase 3c) additionally require an explicit client-scoped grant
// for every role, owner and admin included (P3-D3). That check lives with the
// client schema, which is not built yet. Pure.

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type BrainPermission = "read" | "edit" | "activate";

const ROLES: readonly WorkspaceRole[] = ["owner", "admin", "editor", "viewer"];

export function normalizeWorkspaceRole(raw: unknown): WorkspaceRole {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (ROLES as readonly string[]).includes(v) ? v as WorkspaceRole : "viewer";
}

const ALLOWED: Record<BrainPermission, readonly WorkspaceRole[]> = {
  read: ["owner", "admin", "editor", "viewer"],
  edit: ["owner", "admin", "editor"],
  // Activation switches what Leads, Signals, Content and Outreach run on.
  activate: ["owner", "admin"],
};

export function canBrain(role: WorkspaceRole, permission: BrainPermission): boolean {
  return ALLOWED[permission].includes(role);
}

/**
 * The permission a `generate-company-brain-draft` action needs. Reading status
 * needs read; activating needs activate; everything else — research, drafting,
 * saving, editing, and any action this list doesn't know — needs edit, so a new
 * action is never readable-only by accident.
 */
export function brainPermissionForAction(action: string): BrainPermission {
  if (action === "status") return "read";
  if (action === "activate") return "activate";
  return "edit";
}
