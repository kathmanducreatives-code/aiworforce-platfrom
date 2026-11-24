// THE PLANNER'S VIEW OF THE COMPANY BRAIN — a bounded projection, never the row.
//
// `orchestrate` used to paste `JSON.stringify(profile)` into the planning prompt
// and hand the same raw object to the system prompt. The profile is the whole
// JSONB row: research blobs, the stored integration_status map, suggested-fix
// queues, onboarding metadata, and anything a user ever pasted into a free-text
// field — unbounded in size and unfiltered for secrets (audit P1-3, roadmap 1.3).
//
// This composes the two canonical pieces that already exist and are tested:
// buildCanonicalCompanyBrain (normalize + compile, the lead path's own view) and
// buildMissionContext (secret stripping, deterministic ordering, per-field bounds,
// hard vs soft rules, the tenant guard). It adds one thing they do not: a hard
// ceiling on the serialized size, reached by shortening every list the same way,
// so a pathological brain degrades evenly instead of being cut mid-JSON.
//
// Pure — no DB, no network.
import { buildCanonicalCompanyBrain } from "./getCompiledCompanyBrainForWorkspace.ts";
import { buildMissionContext, CONTEXT_LIMITS, type MissionContext } from "./intelligence/missionContext.ts";

export const EMPTY_BRAIN_MARKER = "(empty — onboarding not completed; do not invent company facts)";

export interface PlannerBrainContext {
  /** The projection, or null when the workspace has no brain content at all. */
  context: MissionContext | null;
  /** What goes into the prompt. Always ≤ CONTEXT_LIMITS.maxSerializedChars. */
  serialized: string;
  /** Per-list item cap that was finally applied (20 unless shrunk to fit). */
  listLimit: number;
}

const LIST_STEPS = [CONTEXT_LIMITS.maxListItems, 10, 5, 2, 1, 0];

function capLists<T extends Record<string, unknown>>(o: T, n: number): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = Array.isArray(v) ? v.slice(0, n) : v;
  return out as T;
}

export function plannerBrainContext(
  workspaceId: string,
  profile: Record<string, unknown> | null | undefined,
): PlannerBrainContext {
  if (!profile || Object.keys(profile).length === 0) {
    return { context: null, serialized: EMPTY_BRAIN_MARKER, listLimit: CONTEXT_LIMITS.maxListItems };
  }
  const canonical = buildCanonicalCompanyBrain(workspaceId, profile);
  const projected = buildMissionContext(workspaceId, canonical);
  // buildMissionContext reads `name` / `company_name`; the compiler's summary
  // calls it `product_name`, so the projection loses the company's name. Filled
  // here (bounded like every other string) rather than by editing the shared
  // projection, which other planners pin.
  const productName = typeof canonical.company_summary?.product_name === "string"
    ? canonical.company_summary.product_name.trim().slice(0, CONTEXT_LIMITS.maxStringLength) : "";
  const full: MissionContext = projected.company_brain.company_name || !productName ? projected
    : { ...projected, company_brain: { ...projected.company_brain, company_name: productName } };
  for (const n of LIST_STEPS) {
    const ctx: MissionContext = n === CONTEXT_LIMITS.maxListItems ? full : {
      ...full,
      company_brain: capLists(full.company_brain as unknown as Record<string, unknown>, n) as unknown as MissionContext["company_brain"],
      icp: capLists(full.icp as unknown as Record<string, unknown>, n) as unknown as MissionContext["icp"],
      readiness: capLists(full.readiness as unknown as Record<string, unknown>, n) as unknown as MissionContext["readiness"],
    };
    const serialized = JSON.stringify(ctx);
    if (serialized.length <= CONTEXT_LIMITS.maxSerializedChars) return { context: ctx, serialized, listLimit: n };
  }
  // Unreachable with lists at 0 items (only bounded strings remain); kept total.
  return { context: null, serialized: EMPTY_BRAIN_MARKER, listLimit: 0 };
}
