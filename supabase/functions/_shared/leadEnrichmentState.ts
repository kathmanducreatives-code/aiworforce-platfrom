// AN EMPTY ENRICHMENT IS NOT A FACT ABOUT THE COMPANY.
//
// The enrichment stage recorded exactly one bit: `c.enriched !== null`. Four
// entirely different things collapse into that single `null`:
//
//   * the provider answered, and had no record for this company
//   * the provider call FAILED
//   * the call was never started, because the checkpoint reserve was reached
//   * the company never reached the stage at all
//
// Only the first says anything about the company, and even that says only "the
// provider does not know it". The other three are facts about the RUN. Reading
// any of them as evidence is the inference this architecture forbids outright —
// and it is the inference a bare `null` invites at every call site that touches
// it.
//
// So the outcome is recorded explicitly, once, by the stage that knows. Every
// consumer — qualification, the resume checkpoint, the Workbench projection —
// reads the outcome rather than re-deriving a judgement from an absence.
//
// PURE. No network, no provider, no database.

export const ENRICHMENT_STATE_VERSION = "enrichment-state-v1" as const;

/**
 * What actually happened when this company's enrichment was attempted.
 *
 *   not_attempted   the company never reached the stage — not shortlisted, or
 *                   its identity never resolved. Nothing was bought.
 *   success         the provider returned a record for this company.
 *   empty           the call was made, paid for and ANSWERED, and this company
 *                   was not in the answer. The only outcome that carries any
 *                   information about the company itself, and even then only
 *                   that the provider has no record of it.
 *   provider_error  the call failed. Says nothing about anything.
 *   deferred        the call was never started — the deadline's checkpoint
 *                   reserve was reached first. Resumable, and a continuation
 *                   picks up exactly these.
 *
 * `empty` and `provider_error` are deliberately distinct despite both yielding
 * no row: one is an answer and the other is a silence.
 */
export type EnrichmentOutcome =
  | "not_attempted"
  | "success"
  | "empty"
  | "provider_error"
  | "deferred";

export const ENRICHMENT_OUTCOMES: readonly EnrichmentOutcome[] = [
  "not_attempted", "success", "empty", "provider_error", "deferred",
];

/** Human-readable, shown verbatim in the Workbench and in telemetry. */
export const ENRICHMENT_EXPLANATION: Readonly<Record<EnrichmentOutcome, string>> =
  Object.freeze({
    not_attempted: "Enrichment was never attempted for this company.",
    success: "Enrichment returned a company record.",
    empty: "Enrichment ran and the provider had no record for this company.",
    provider_error: "The enrichment provider call failed; no evidence was collected.",
    deferred: "The run reached its time budget before enrichment could be attempted.",
  });

/** Did this outcome produce evidence a decision may be based on? */
export function enrichmentIsEvidence(o: EnrichmentOutcome): boolean {
  return o === "success";
}

/**
 * Was the question actually ASKED and ANSWERED?
 *
 * The predicate that separates a fact about the company from a fact about the
 * run. `empty` is answered; `provider_error` and `deferred` are not, and a
 * company holding either must never be reported as decided.
 */
export function enrichmentWasAnswered(o: EnrichmentOutcome): boolean {
  return o === "success" || o === "empty";
}

/**
 * Is this outcome TERMINAL for the run?
 *
 * `deferred` and `provider_error` are not: a continuation can still buy the
 * evidence, so a capability holding either is incomplete rather than done.
 */
export function enrichmentIsTerminal(o: EnrichmentOutcome): boolean {
  return o === "not_attempted" || o === "success" || o === "empty";
}

/** Run-level counts. A zero is a real measurement, not a missing one. */
export function summariseEnrichmentOutcomes(
  outcomes: Iterable<EnrichmentOutcome>,
): Record<EnrichmentOutcome | "total", number> {
  const out = {
    not_attempted: 0, success: 0, empty: 0, provider_error: 0, deferred: 0, total: 0,
  };
  for (const o of outcomes) {
    out.total++;
    if (o in out) out[o]++;
  }
  return out;
}

/** Narrow an untrusted value (a restored checkpoint) to a known outcome. */
export function asEnrichmentOutcome(v: unknown): EnrichmentOutcome {
  const s = String(v ?? "");
  return (ENRICHMENT_OUTCOMES as readonly string[]).includes(s)
    ? s as EnrichmentOutcome
    : "not_attempted";
}
