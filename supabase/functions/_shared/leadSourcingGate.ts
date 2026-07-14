// Fail-closed gate for Find Leads *identity* sourcing. Pure / deterministic
// (imports only executionMode + leadPersistenceGuard). These are the exact helpers
// run-agent calls so a generic-LLM response can NEVER become a company/person lead
// when the required provider source is unconfigured/unavailable/failed/empty.
//
// Root cause it closes (live plan c0f0d7eb): run-agent's Apify gate keyed only off
// tool_input.tool_name / selected_actor_key, while orchestrate threads the step's
// tool as body.tool_needed="source_with_apify". An AI-planned tool_input without a
// tool_name therefore fell through to the generic LLM path, which fabricated 10
// founders that reached Aria and finalized the plan as "complete".
//
// Scope: this restriction applies ONLY to Find Leads provider identity sourcing.
// Generic LLM remains available for non-lead research / summarization / analysis.

import { buildNoResults, type NoResultsPayload } from "./leadPersistenceGuard.ts";

const s = (v: unknown) => (v ?? "").toString().trim().toLowerCase();

/** The provider lead-source tool(s) that MUST be provider-backed (never LLM-sourced). */
export const PROVIDER_SOURCE_TOOLS = new Set(["source_with_apify"]);

/** Structured, stable reasons for a fail-closed provider-source outcome. */
export type ProviderSourceReason =
  | "provider_source_unconfigured"
  | "provider_source_unavailable"
  | "provider_source_failed"
  | "provider_source_empty"
  | "no_provider_backed_candidates";

export interface SourcingStepSignals {
  agent_slug?: string | null;
  /** body.tool_needed threaded by orchestrate from the plan step. */
  tool_needed?: string | null;
  /** tool_input.tool_name (staged plans). */
  tool_name?: string | null;
  /** tool_input.selected_actor_key (staged plans / actor routing). */
  selected_actor_key?: string | null;
}

/**
 * True when this run-agent step is Find Leads provider *identity* sourcing — i.e.
 * a step whose required tool is a provider lead-source tool (or an Apify actor).
 * Recognizes the tool from ANY of the authoritative markers, including
 * body.tool_needed (which run-agent previously ignored). Does NOT depend on the
 * free-text instruction, so it can't be spoofed or missed by wording.
 */
export function isFindLeadsProviderSourcingStep(sig: SourcingStepSignals | null | undefined): boolean {
  if (!sig) return false;
  const toolNeeded = s(sig.tool_needed);
  const toolName = s(sig.tool_name);
  const actorKey = s(sig.selected_actor_key);
  if (PROVIDER_SOURCE_TOOLS.has(toolNeeded)) return true;
  if (PROVIDER_SOURCE_TOOLS.has(toolName)) return true;
  if (actorKey.startsWith("apify_")) return true;
  return false;
}

export interface ProviderSourceState {
  /** The provider tool/actor is configured (has token + actor id) in this env. */
  configured?: boolean;
  /** The provider tool reported unavailable at call time (e.g. runTool.unavailable). */
  unavailable?: boolean;
  /** The provider tool/actor errored (auth/credits/timeout/http). */
  errored?: boolean;
  /** Raw items the provider returned (across attempts). */
  rawItemCount?: number;
  /** Accepted normalized provider items after validation. */
  acceptedItemCount?: number;
  /** Provider-backed candidates that survived the Scout→Aria provider gate. */
  providerBackedCandidateCount?: number;
}

/**
 * Classify a provider-source outcome into a structured reason, or `null` when the
 * source produced at least one provider-backed candidate (the run may proceed).
 * Ordered most-specific first so the reason reflects the earliest failure.
 */
export function classifyProviderSourceOutcome(state: ProviderSourceState): ProviderSourceReason | null {
  const accepted = Math.max(0, state.acceptedItemCount ?? 0);
  const backed = Math.max(0, state.providerBackedCandidateCount ?? 0);
  if (state.configured === false) return "provider_source_unconfigured";
  if (state.unavailable === true) return "provider_source_unavailable";
  if (state.errored === true) return "provider_source_failed";
  // Zero accepted normalized items (whether or not raw items came back) ⇒ there is
  // no provider index to build ⇒ empty. Accepted>0 but zero survived the Scout→Aria
  // provider match ⇒ no provider-backed candidates.
  if (accepted === 0) return "provider_source_empty";
  if (backed === 0) return "no_provider_backed_candidates";
  return null;
}

export interface ProviderSourceNoResults extends NoResultsPayload {
  result_status: "no_results";
  provider_calls: number;
  reason: ProviderSourceReason;
}

/**
 * Canonical fail-closed terminal for a Find Leads provider-sourcing step that
 * yielded zero provider-backed candidates. Wraps the shared buildNoResults (so the
 * lead/qualified/persisted/next_step invariants stay identical) and adds the
 * structured reason + provider_calls. Aria/Penn are NOT invoked; nothing persists.
 */
export function buildProviderSourceNoResults(
  reason: ProviderSourceReason,
  opts?: { rejected_provenance_count?: number; provider_calls?: number },
): ProviderSourceNoResults {
  const base = buildNoResults(opts?.rejected_provenance_count ?? 0);
  return {
    ...base,
    result_status: "no_results",
    provider_calls: Math.max(0, opts?.provider_calls ?? 0),
    reason,
  };
}
