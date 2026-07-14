// Typed Find Leads execution modes + a deterministic plan filter. Pure / import-free.
//
// Root cause it fixes: a lead query ("find me 5 founders") produced an AI plan
// Scout → Aria → Penn(draft_outreach) that executed the outreach-drafting step
// automatically, generating messages even with zero qualified leads. This module
// introduces an explicit `source_and_qualify_only` mode and a filter that strips
// every outreach/drafting/publishing step from a plan, so the runtime cannot add
// or execute Penn in that mode.

export type ExecutionMode = "fast" | "deep" | "outreach" | "source_and_qualify_only";

export const SOURCE_AND_QUALIFY_ONLY: ExecutionMode = "source_and_qualify_only";

export function normalizeExecutionMode(m: string | null | undefined): ExecutionMode {
  const v = (m ?? "").toString().trim().toLowerCase();
  if (v === "source_and_qualify_only") return "source_and_qualify_only";
  if (v === "deep") return "deep";
  if (v === "outreach") return "outreach";
  return "fast";
}

export function isSourceAndQualifyOnly(m: string | null | undefined): boolean {
  return normalizeExecutionMode(m) === "source_and_qualify_only";
}

/** Agents that may never appear/run in source_and_qualify_only. */
export const FORBIDDEN_AGENTS_SQO = ["penn"] as const;

/** Tools that may never appear/run in source_and_qualify_only. */
export const FORBIDDEN_TOOLS_SQO = [
  "draft_outreach",
  "send_email",
  "send_outreach",
  "send_message",
  "post_content",
  "publish_content",
  "comment",
] as const;

/** True when this mode permits generating/persisting an outreach draft at all. */
export function draftingAllowedInMode(m: string | null | undefined): boolean {
  return !isSourceAndQualifyOnly(m);
}

/** Blocked reason string when drafting is forbidden by the mode, else null. */
export function modeDraftBlockReason(m: string | null | undefined): string | null {
  return isSourceAndQualifyOnly(m)
    ? "execution mode is source_and_qualify_only: outreach drafting is forbidden"
    : null;
}

export interface PlanStepLike {
  agent_slug?: string | null;
  tool_needed?: string | null;
  step_index?: number;
  [k: string]: unknown;
}

/** Is a single step allowed under this mode? */
export function stepAllowedInMode(step: PlanStepLike, m: string | null | undefined): boolean {
  if (!isSourceAndQualifyOnly(m)) return true;
  const slug = (step.agent_slug ?? "").toString().toLowerCase();
  const tool = (step.tool_needed ?? "").toString().toLowerCase();
  if ((FORBIDDEN_AGENTS_SQO as readonly string[]).includes(slug)) return false;
  if ((FORBIDDEN_TOOLS_SQO as readonly string[]).includes(tool)) return false;
  return true;
}

export interface PlanFilterResult<T extends PlanStepLike> {
  steps: T[];
  removed: Array<{ agent_slug: string | null; tool_needed: string | null; reason: string }>;
}

/**
 * Filter a plan for the given mode. In source_and_qualify_only every Penn /
 * outreach / drafting / publishing step is removed and the remaining steps are
 * re-indexed contiguously (so downstream chaining by array position is intact).
 * Any other mode returns the steps unchanged.
 */
export function filterPlanForMode<T extends PlanStepLike>(steps: T[], m: string | null | undefined): PlanFilterResult<T> {
  if (!isSourceAndQualifyOnly(m) || !Array.isArray(steps)) return { steps: steps ?? [], removed: [] };
  const removed: PlanFilterResult<T>["removed"] = [];
  const kept: T[] = [];
  for (const s of steps) {
    if (stepAllowedInMode(s, m)) kept.push(s);
    else removed.push({ agent_slug: (s.agent_slug ?? null) as string | null, tool_needed: (s.tool_needed ?? null) as string | null, reason: "forbidden in source_and_qualify_only" });
  }
  kept.forEach((s, i) => { if (typeof s.step_index === "number" || "step_index" in s) (s as PlanStepLike).step_index = i; });
  return { steps: kept, removed };
}
