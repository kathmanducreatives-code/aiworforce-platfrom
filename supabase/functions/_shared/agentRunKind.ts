// WHAT KIND OF RUN IS THIS?
//
// ── THE DEFECT THIS FIXES ───────────────────────────────────────────────────
//
// `run-agent` acquires a LEAD LINEAGE LEASE for every task it executes, with no
// guard on what the task is. That is correct for the capability engine, where a
// lineage is the ownership fence across continuations, resumes and multi-round
// sourcing. It is wrong for Scribe: a Content generation has no continuation,
// no resume and no rounds, so the lineage it creates has no path to a terminal
// state and is left `status: 'running'` for ever.
//
// Measured on 2026-09-11: one Content canary produced two lineages, both stuck
// running, both with zero candidates and no lead work of any kind.
//
// ── WHY A PREDICATE AND NOT A REWRITE ───────────────────────────────────────
//
// The honest long-term model is a generic AgentRun with Lead, Content, Signal
// and Outreach as kinds of it. That is a platform refactor, and the Lead engine
// it would rewrite is the proven part of this system.
//
// This is the smallest correct step toward it: name the distinction that
// already exists implicitly, in one place, so `run-agent` can ask instead of
// assuming. Lead behaviour is untouched — every slug that is not a content
// writer still takes exactly the path it takes today.
//
// PURE. No network, no database, no clock.

export type AgentRunKind = "lead" | "content";

/**
 * Agents that produce CONTENT rather than leads.
 *
 * Deliberately a set of one. `penn` writes outreach copy, which belongs to a
 * lead's lifecycle and legitimately runs inside a lineage; `scribe` is the
 * Content employee and owns nothing in the lead world. Adding a slug here is a
 * decision that its runs stop being lead executions, which is why it is an
 * explicit list rather than a heuristic on the instruction text.
 */
const CONTENT_AGENTS: ReadonlySet<string> = new Set(["scribe"]);

/**
 * Classify a run from what `run-agent` already knows at entry.
 *
 * `content_item_id` is the positive signal: a run filling a specific Content
 * draft is unambiguously Content, whatever else is on the body. The slug alone
 * is the fallback, because a Scribe run from the orphaned content-engagement
 * loop carries no item id and is still not a lead.
 */
export function classifyAgentRun(input: {
  agentSlug?: string | null;
  contentItemId?: string | null;
}): AgentRunKind {
  if (input.contentItemId) return "content";
  return CONTENT_AGENTS.has((input.agentSlug ?? "").toLowerCase()) ? "content" : "lead";
}

/**
 * Does this run need the lead lineage lease?
 *
 * ONLY LEAD RUNS. The lease exists to stop two executions of the same lineage
 * spending twice — a hazard that requires continuations, which Content does not
 * have. Acquiring one for Content buys nothing and leaves a row nothing closes.
 *
 * The lineage IDENTIFIER is still computed for a Content run: it is the task id,
 * and `logicalCallKey` uses it to make provider and model calls idempotent. Only
 * the database row and its lease are skipped.
 */
export function runNeedsLineageLease(kind: AgentRunKind): boolean {
  return kind === "lead";
}
