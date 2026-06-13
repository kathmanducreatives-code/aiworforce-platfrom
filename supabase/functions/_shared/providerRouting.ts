// Provider routing policy (pure, unit-testable).
//
// Gemini (Lovable AI gateway) remains the router/planner/controller for Pilot,
// classification, orchestration planning, and tool routing. Anthropic/Claude is
// PREFERRED for writing-quality agent execution — Scribe (content, comments) and
// Penn (outreach/DM copy).
//
// aiProvider.generateText() falls back to Gemini automatically when
// ANTHROPIC_API_KEY is missing, so returning "anthropic" here never crashes — it
// is a *preference*, not a hard requirement.

import type { ProviderName, TaskType } from "./aiProvider.ts";

/** Agents whose output is copy/writing and should prefer Claude when available. */
export const ANTHROPIC_WRITING_AGENTS: ReadonlySet<string> = new Set(["scribe", "penn"]);

/**
 * Preferred provider for a given agent's *execution* step.
 * Returns "anthropic" for writing agents (Scribe/Penn), otherwise undefined so
 * the default Gemini provider is used. Case-insensitive; tolerant of null.
 */
export function preferredProviderForAgent(agentSlug?: string | null): ProviderName | undefined {
  const slug = (agentSlug ?? "").trim().toLowerCase();
  return ANTHROPIC_WRITING_AGENTS.has(slug) ? "anthropic" : undefined;
}

/**
 * Planner/controller task types that must stay on the Gemini/default path.
 * Used to assert (and document) that we never move planning to Claude.
 */
const PLANNER_TASK_TYPES: ReadonlySet<TaskType> = new Set<TaskType>([
  "pilot_chat",
  "orchestration_plan",
  "tool_input_planning",
  "helper",
]);

export function isPlannerTask(taskType: TaskType): boolean {
  return PLANNER_TASK_TYPES.has(taskType);
}
