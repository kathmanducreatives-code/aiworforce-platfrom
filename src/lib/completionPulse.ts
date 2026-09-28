// COMPLETION PULSE — when the dashboard may say "something just finished".
//
// Source: the `completed` events useAgentVisualStates already derives from real
// task rows (one per task id, inside its event window). Nothing else counts.
//
// A completion that was already on screen when the page loaded is history, not
// news: the first snapshot only SEEDS what has been seen. After that, each new
// event key fires once.
//
// PURE. Deno-testable.

import { VISUAL_AGENT_KEYS, type AgentVisualState, type VisualAgentKey } from "./agent3d/visualState.ts";

export interface CompletionPulse { agent: VisualAgentKey; key: string }

/**
 * The completions in `states` not yet in `seen`, newest first. Mutates `seen`
 * (adds what it returns). Pass `seen = null` to seed: nothing is returned.
 */
export function takeNewCompletions(
  states: Readonly<Record<VisualAgentKey, AgentVisualState>>,
  seen: Set<string> | null,
): { seen: Set<string>; fresh: CompletionPulse[] } {
  const done = VISUAL_AGENT_KEYS
    .map((agent) => ({ agent, event: states[agent]?.event ?? null }))
    .filter((x) => x.event?.kind === "completed")
    .sort((a, b) => (b.event!.at ?? 0) - (a.event!.at ?? 0))
    .map(({ agent, event }) => ({ agent, key: event!.key }));
  if (seen === null) return { seen: new Set(done.map((d) => d.key)), fresh: [] };
  const fresh = done.filter((d) => !seen.has(d.key));
  fresh.forEach((d) => seen.add(d.key));
  return { seen, fresh };
}
