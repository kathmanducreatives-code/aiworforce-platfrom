// WHEN A CAPABILITY MAY CLOSE, AND WHEN A CLOSED ONE MUST BE REOPENED.
//
// ── THE STATE THIS EXISTS TO MAKE IMPOSSIBLE ───────────────────────────────
//
// Task 5c461aa3, 2026-08-28, persisted verbatim:
//
//   completed_capabilities : [general_company_discovery, company_enrichment,
//                             persistence]
//   pending_capabilities   : [company_identity_resolution, hiring_verification,
//                             company_brain_qualification]
//   lead_library_persistence: { planned: 0, persisted: 0 }
//
// `persistence` is the LAST node in the graph. It closed having saved nothing,
// while the three capabilities that produce the things it saves were still
// pending. The engine skips any capability already in `completed_capabilities`:
//
//   if (state.completed_capabilities.includes(cap)) {
//     outcomes.push({ capability: cap, status: "skipped_resumed", ... });
//
// So every future slice of that lineage would verify hiring, qualify companies
// — and then skip the step that writes them down. The run had six companies
// with real sales openings behind it and could never have saved one.
//
// The proximate cause was one argument: the persistence branch called
// `finish(cap, "complete", state.contact_identities.length, [], true, null)`,
// passing `evidence: true` unconditionally. But fixing that argument alone
// would leave the same shape available to every other node, so the rule lives
// here instead, expressed once over the plan.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
//
// A capability that produced NOTHING may only close when nothing it could
// still be waiting on is pending. "Could still be waiting on" is read off the
// plan: the capabilities ordered before it. A first node has no predecessors
// and is therefore never held open by this; a last node is held open by any
// unfinished predecessor, which is exactly the property persistence needed.
//
// Zero rows is the trigger, not failure. A capability that DID something has
// earned its completion whatever else is outstanding — reopening it would
// re-spend for work already paid for.
//
// Pure. No network, no database, no model.

export const CAPABILITY_COMPLETION_VERSION = "capability-completion-v1" as const;

/**
 * The two lists that describe where a run has got to.
 *
 * Generic over the capability id so the engine's own union survives the round
 * trip — a `string[]` here would force a cast at the call site, and a cast is
 * how a repair could put an unknown capability into a typed list.
 */
export interface CapabilityLifecycleState<T extends string = string> {
  completed_capabilities: T[];
  pending_capabilities: T[];
}

/**
 * Is this completion provisional — a node closing on nothing while something
 * upstream is still open?
 *
 * `planOrder` is the capability sequence the engine executes, which is also the
 * dependency order: a node can only consume what the nodes before it produced.
 */
export function completionIsProvisional(i: {
  capability: string;
  /** What the capability actually produced this pass. */
  rows: number;
  planOrder: readonly string[];
  pendingCapabilities: readonly string[];
}): boolean {
  if (i.rows > 0) return false;
  const at = i.planOrder.indexOf(i.capability);
  // A capability not in the plan has no predecessors to wait on.
  if (at <= 0) return false;
  const pending = new Set(i.pendingCapabilities);
  return i.planOrder.slice(0, at).some((c) => pending.has(c));
}

export interface RepairResult<T extends string = string> {
  state: CapabilityLifecycleState<T>;
  /** Capabilities moved back to pending, with why. Empty when nothing changed. */
  reopened: Array<{ capability: T; reason: string }>;
}

/**
 * Reopen capabilities an older build closed on nothing.
 *
 * ── WHY THIS IS NARROW ─────────────────────────────────────────────────────
 *
 * The obvious repair — reopen anything completed out of order — would re-run
 * `company_enrichment` on a checkpoint where identity resolution is still
 * pending, and enrichment costs money for companies already enriched. A repair
 * that spends is worse than the state it repairs.
 *
 * So a capability is only reopened when all three hold:
 *
 *   it is completed;
 *   a capability ordered BEFORE it is still pending;
 *   it made NO provider attempt — there is no paid work behind its completion.
 *
 * That last condition is what makes the repair free. `persistence` and
 * `company_brain_qualification` reach no provider at all, so redoing them costs
 * nothing; every capability that bought something keeps its completion.
 *
 * Idempotent: repairing an already-repaired state changes nothing.
 */
export function repairPrematureCompletions<T extends string>(
  state: CapabilityLifecycleState<T>,
  planOrder: readonly T[],
  providerAttempts: ReadonlyArray<{ capability?: string | null }>,
): RepairResult<T> {
  const paidFor = new Set(
    providerAttempts.map((a) => a?.capability).filter((c): c is string => !!c));
  const pending = new Set(state.pending_capabilities);
  const reopened: RepairResult<T>["reopened"] = [];
  const completed: T[] = [];

  for (const cap of state.completed_capabilities) {
    const at = planOrder.indexOf(cap);
    const blockedBy = at > 0
      ? planOrder.slice(0, at).filter((c) => pending.has(c))
      : [];
    if (blockedBy.length > 0 && !paidFor.has(cap)) {
      reopened.push({
        capability: cap,
        reason: `closed with no provider work while ${blockedBy.join(", ")} ${
          blockedBy.length === 1 ? "was" : "were"} still pending`,
      });
      continue;
    }
    completed.push(cap);
  }

  if (reopened.length === 0) return { state, reopened };

  // ORDER IS THE PLAN'S ORDER, not the order things were reopened in — the
  // engine walks `pending_capabilities` and a shuffled list would run
  // persistence before qualification all over again.
  const nextPending: T[] = [
    ...state.pending_capabilities,
    ...reopened.map((r) => r.capability),
  ].sort((a, b) => planOrder.indexOf(a) - planOrder.indexOf(b));

  return {
    state: { completed_capabilities: completed, pending_capabilities: nextPending },
    reopened,
  };
}
