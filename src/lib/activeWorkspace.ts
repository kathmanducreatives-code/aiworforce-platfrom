// Which workspace a signed-in user is working in (roadmap Phase 3b).
//
// It used to be "the first membership row" (`limit(1)`, no order), which is
// arbitrary for anyone in two workspaces — and ANY error on that read fell
// through to provisioning, so a transient failure could create a brand-new
// empty workspace. Now:
//
//   1. the read failed            → an error the app can retry; NEVER provision
//   2. no memberships at all      → provision (a genuinely new user)
//   3. a remembered choice that is still a membership → that one
//   4. otherwise                  → the oldest membership (created_at, then id)
//
// The remembered choice is a per-user convenience in localStorage, re-checked
// against current membership on every resolve, so a removed membership is
// never reused. Pure decision + small storage helpers.

export interface MembershipRow { workspace_id: string; created_at?: string | null }

export type ActiveWorkspaceDecision =
  | { kind: 'use'; workspaceId: string; reason: 'remembered' | 'oldest' }
  | { kind: 'provision' }
  | { kind: 'error' };

export function decideActiveWorkspace(input: {
  memberships: MembershipRow[] | null;
  queryFailed: boolean;
  remembered: string | null;
}): ActiveWorkspaceDecision {
  if (input.queryFailed || input.memberships === null) return { kind: 'error' };
  if (input.memberships.length === 0) return { kind: 'provision' };
  if (input.remembered && input.memberships.some((m) => m.workspace_id === input.remembered)) {
    return { kind: 'use', workspaceId: input.remembered, reason: 'remembered' };
  }
  const oldest = [...input.memberships].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.workspace_id.localeCompare(b.workspace_id))[0];
  return { kind: 'use', workspaceId: oldest.workspace_id, reason: 'oldest' };
}

const key = (userId: string) => `agentory:active-workspace:${userId}`;

export function rememberedWorkspace(userId: string): string | null {
  try { return localStorage.getItem(key(userId)); } catch { return null; }
}

export function rememberWorkspace(userId: string, workspaceId: string): void {
  try { localStorage.setItem(key(userId), workspaceId); } catch { /* a convenience only */ }
}
