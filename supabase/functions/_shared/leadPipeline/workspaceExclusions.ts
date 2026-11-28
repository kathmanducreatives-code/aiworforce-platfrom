// LEGACY-PATH WORKSPACE EXCLUSIONS (ATLAS, 2026-11-28).
//
// Without the Mission Contract (AGENTORY_MISSION_CONTRACT_V4 off), lead-pipeline read the
// workspace's Company Brain and then applied none of its industry exclusions: a Brain rule or
// an approved "never target crypto" memory was simply ignored. This adds them to the mission
// as REQUIRED exclusion criteria with workspace authority, resolved by the very rule contract
// mode uses (missionContract/brain.ts `resolveWorkspaceExclusions`): same ids, same conflicts,
// same whole-word matching. From there they reach every step that reads criteria — the
// provider filters, verification, eligibility, Flexible Discovery (which never relaxes them)
// and persistence — exactly as in contract mode.
// Pure.

import { criteriaOf } from "../missionCriteriaReader.ts";
import { resolveWorkspaceExclusions, type ContractBrainInput, type WorkspaceExclusionResolution } from "../missionContract/brain.ts";

const fromUser = (s: unknown) => s === "user_explicit" || s === "user_inferred";

export function legacyWorkspaceExclusions(
  mission: unknown, brain: ContractBrainInput | null, o: { workspaceId?: string | null; now?: Date } = {},
): { mission: unknown; resolution: WorkspaceExclusionResolution; added: string[] } {
  const criteria = criteriaOf(mission as never) as unknown as Record<string, unknown>[];
  const asked = criteria.filter((c) => c.dimension === "industry" && fromUser(c.source) && typeof c.value === "string").map((c) => String(c.value));
  const requestExcludes = criteria.filter((c) => c.dimension === "exclusion" && fromUser(c.source)).flatMap((c) => {
    const v = c.value as { field?: unknown; value?: unknown } | null;
    if (v?.field !== "excluded_company_types" && v?.field !== "excluded_industries") return [];
    return (Array.isArray(v.value) ? v.value : [v.value]).filter((x): x is string => typeof x === "string");
  });
  const resolution = resolveWorkspaceExclusions({ asked, requestExcludes, brain, ...o });
  const have = new Set(criteria.map((c) => String(c.id)));
  const extra = resolution.apply.filter((a) => !have.has(a.id)).map((a) => ({
    id: a.id, kind: "hard", dimension: "exclusion", label: a.label, rationale: a.rationale,
    source: "company_brain_policy", user_phrase: "", status: "ok",
    value: { field: "excluded_company_types", value: [a.value] },
    ...(a.memoryIds.length ? { memory_ids: a.memoryIds } : {}),
  }));
  if (!extra.length) return { mission, resolution, added: [] };
  return { mission: { ...(mission as Record<string, unknown>), criteria: [...criteria, ...extra] }, resolution, added: extra.map((e) => e.id) };
}
