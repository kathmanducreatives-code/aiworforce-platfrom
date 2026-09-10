// WHICH ENGINE RUNS A LEAD MISSION — V1 edge (default) or the V2 worker.
//
// SAFE BY DEFAULT. The allowlist is empty unless LEAD_V2_WORKER_WORKSPACES names
// workspaces explicitly. Empty ⇒ every mission resolves to v1_edge ⇒ V2 is
// disabled. There is no global on switch; a workspace opts in by id, one at a
// time, and the very first production canary also forces requestedLeadCount = 1.
//
// No Deno/edge coupling: env is read through an injected reader so this resolves
// identically in an edge function, the worker, and a unit test.

export type LeadExecutionEngine = "v1_edge" | "v2_worker";

export const LEAD_V2_WORKSPACES_ENV = "LEAD_V2_WORKER_WORKSPACES";

/** The first production V2 canary runs one lead regardless of mission config. */
export const V2_CANARY_FORCED_REQUESTED_LEAD_COUNT = 1;

export type EnvReader = (key: string) => string | undefined;

function defaultReader(key: string): string | undefined {
  try {
    return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
      .Deno?.env.get(key);
  } catch {
    return undefined; // env access denied ⇒ treat as unset ⇒ V2 disabled
  }
}

export function v2WorkspaceAllowlist(read: EnvReader = defaultReader): Set<string> {
  const raw = read(LEAD_V2_WORKSPACES_ENV) ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

/** TRUE only when at least one workspace is explicitly allowlisted. */
export function v2Enabled(read: EnvReader = defaultReader): boolean {
  return v2WorkspaceAllowlist(read).size > 0;
}

/**
 * The engine for a given workspace. Unknown/absent workspace ⇒ v1_edge.
 * A workspace is v2_worker ONLY if it appears in the allowlist.
 */
export function resolveLeadExecutionEngine(
  workspaceId: string | null | undefined,
  read: EnvReader = defaultReader,
): LeadExecutionEngine {
  if (!workspaceId) return "v1_edge";
  return v2WorkspaceAllowlist(read).has(workspaceId) ? "v2_worker" : "v1_edge";
}
