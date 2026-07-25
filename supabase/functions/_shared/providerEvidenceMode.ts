// NON-PERSISTING PROVIDER EVIDENCE MODE + company-first write boundary.
//
// Live defect (run lead-quality-sales-ops-us-20260725T150059Z): the company-first
// branch reported `persisted: 0`, yet 20 accounts and 20 lead_candidates existed
// afterwards. `runTool` persists provider output via writeMemoryFromToolCall
// (toolRegistry.ts) unless the tool input carries `defer_persistence: true`. The
// evidence calls never set it, so 25 UNQUALIFIED jobs became Lead Library rows
// before the company gate had a say.
//
// For company-first sourcing, raw provider rows are EVIDENCE, not leads. They stay
// in memory until job relevance, location, company qualification, dedupe, employer
// verification, evidence validation and the hard gates have all run. Only the
// guarded persistence adapter may write.
//
// This is the existing, already-supported flag — not a new tool contract — so
// ordinary flows that omit it keep persisting exactly as before.

/** The flag `runTool` checks before writing provider output as leads. */
export const DEFER_PERSISTENCE_KEY = "defer_persistence";

/** Stamp an evidence-mode provider input. */
export function withEvidenceOnlyPersistence<T extends Record<string, unknown>>(input: T): T & { defer_persistence: true } {
  return { ...input, defer_persistence: true };
}

/** True when this provider input is guaranteed not to write leads. */
export function isNonPersistingProviderInput(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  return (input as Record<string, unknown>)[DEFER_PERSISTENCE_KEY] === true;
}

// ---------------------------------------------------- provider envelope ----
//
// WRAPPER vs NATIVE. `runTool`/source_with_apify reads its control fields from the
// TOP LEVEL of the tool input (toolRegistry: `i.query`, `i.location`,
// `i.max_results`, `i.selected_actor_key`, `i.defer_persistence`) and passes
// everything under `input:` to the selected actor's adapter as `user_input`.
//
// Putting `max_results` (or query/location) under `input:` silently loses it —
// that is exactly how the 2026-07-25 run sent an unfiltered LinkedIn search and
// how a people lookup would have taken 25 profiles per company instead of 2.
// Wrapper controls must therefore NEVER be nested, and native actor fields must
// NEVER sit at the top level.

export interface ProviderEnvelope {
  selected_actor_key: string;
  /** Wrapper-only control; never reaches the actor's native JSON. */
  defer_persistence: true;
  /** Wrapper-only; the shared run-level result ceiling. */
  max_results: number;
  /** Actor-native fields, handed to the selected actor's adapter as user_input. */
  input: Record<string, unknown>;
}

/**
 * Build the tool-input envelope for an evidence-mode provider call: wrapper
 * controls at the top level, actor-native fields under `input`.
 */
export function buildProviderEnvelope(
  actorKey: string,
  nativeInput: Record<string, unknown>,
  maxResults: number,
): ProviderEnvelope {
  return {
    selected_actor_key: actorKey,
    defer_persistence: true,
    max_results: Math.max(1, Math.floor(maxResults)),
    input: nativeInput,
  };
}

/** Wrapper controls that must never appear inside the actor-native payload. */
export const WRAPPER_ONLY_KEYS = [
  DEFER_PERSISTENCE_KEY, "persistence_mode", "selected_actor_key", "actor_id",
  "workspace_id", "plan_id", "task_id", "run_id", "original_user_query", "source_type",
] as const;

/** True when a NATIVE actor payload is free of Agentory wrapper controls. */
export function nativePayloadIsClean(native: Record<string, unknown>): boolean {
  return !WRAPPER_ONLY_KEYS.some((k) => k in native);
}

// ------------------------------------------------------- write boundary ----

export interface CompanyFirstWriteBoundary {
  rawProviderItems: number;
  normalizedJobs: number;
  verifiedCompanies: number;
  peopleResults: number;
  qualifiedCandidates: number;
  rejectedCandidates: number;
  persistenceAttempts: number;
  persistedRecords: number;
  /** MUST stay 0 — a provider call that could write leads counts here. */
  providerSideWrites: number;
  /** Set when providerSideWrites > 0; the task must report this, not clean success. */
  invariantViolation: string | null;
}

export function newWriteBoundary(): CompanyFirstWriteBoundary {
  return {
    rawProviderItems: 0, normalizedJobs: 0, verifiedCompanies: 0, peopleResults: 0,
    qualifiedCandidates: 0, rejectedCandidates: 0, persistenceAttempts: 0,
    persistedRecords: 0, providerSideWrites: 0, invariantViolation: null,
  };
}

/**
 * Record a provider invocation. An input WITHOUT the non-persisting flag can write
 * leads behind the gate's back, so it increments providerSideWrites and trips the
 * invariant — the run then reports the violation instead of claiming clean
 * persistence.
 */
export function recordProviderInvocation(
  boundary: CompanyFirstWriteBoundary,
  input: unknown,
  label: string,
): void {
  if (!isNonPersistingProviderInput(input)) {
    boundary.providerSideWrites += 1;
    boundary.invariantViolation =
      `provider_side_write_risk:${label} invoked without ${DEFER_PERSISTENCE_KEY}=true`;
  }
}

export function writeBoundaryHolds(boundary: CompanyFirstWriteBoundary): boolean {
  return boundary.providerSideWrites === 0 && boundary.invariantViolation === null;
}
