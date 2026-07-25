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
