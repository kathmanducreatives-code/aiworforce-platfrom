// EVERY REQUEST ENDS IN A STATE THAT NAMES WHAT IT PROVED.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
//
//   NEVER CLAIM A CAPABILITY OR RESULT WITHOUT A PROOF PATH.
//
// A reply is not allowed to imply more than the system established. That is not
// a tone preference; it is the difference between "10 leads saved" — which was
// the size of one query page while the workspace held 32 — and an answer a user
// can act on.
//
// ── THE FIVE STATES, AND WHY THERE ARE EXACTLY FIVE ────────────────────────
//
// Each one exists because collapsing it into another produced a real defect:
//
//   SATISFIED            the question was answered from something proved.
//
//   PARTIALLY_SATISFIED  part was answered and the rest is DECLARED. "I can see
//                        the leads but nothing is scored" is this. Collapsing it
//                        into SATISFIED is how a superlative got answered with
//                        an arbitrary slice; collapsing it into FAILED is how a
//                        known gap became a generic error.
//
//   REQUIRES_UNLOCK      the work is understood and blocked on a person or a
//                        credential. `PaidExecutionBlockedError` is this, and it
//                        was being finalised as `unhandled_exception` — a
//                        deliberate refusal recorded as a crash.
//
//   UNSUPPORTED          the product cannot do this yet, and says so. Distinct
//                        from FAILED because nothing went wrong.
//
//   FAILED               something broke, and the CATEGORY survives. A category
//                        lost at the catch is a bug report nobody can action.
//
// Nothing here formats a sentence. The state travels with the answer so the
// surface, the log and the UI agree about what happened, and so a gap cannot be
// dropped silently on the way out.
//
// Pure. No network, no database, no model.

export const OUTCOME_CONTRACT_VERSION = "outcome-v1" as const;

export type OutcomeState =
  | "SATISFIED"
  | "PARTIALLY_SATISFIED"
  | "REQUIRES_UNLOCK"
  | "UNSUPPORTED"
  | "FAILED";

/**
 * Why a request did not fully succeed.
 *
 * A CLOSED VOCABULARY, because the point is that a caller must choose. A free
 * string would let "something went wrong" back in through the type system.
 */
export type FailureCategory =
  /** The product has no implementation for this yet. */
  | "unsupported_capability"
  /** It could be answered, but the evidence needed is not held or not scored. */
  | "insufficient_evidence"
  /** The request could mean more than one thing and guessing would cost. */
  | "ambiguous_request"
  /** The understanding model was unavailable or unreadable. */
  | "model_failure"
  /** A provider call failed or was refused. */
  | "provider_failure"
  /** A person must approve, or a credential is missing. */
  | "requires_approval"
  /** Stage 0 refused: the mission cannot be expressed as executable work. */
  | "not_feasible"
  /** Execution started and did not complete. */
  | "execution_failure"
  /** A defect. The one category that means "file a bug". */
  | "internal_error";

/** A capability the answer did NOT establish, stated rather than omitted. */
export interface DeclaredGap {
  /** Machine-readable, for telemetry and for deciding what to build next. */
  code: string;
  /** What is missing, in the user's terms. */
  detail: string;
}

export interface Outcome {
  version: typeof OUTCOME_CONTRACT_VERSION;
  state: OutcomeState;
  /** Present for every state except SATISFIED. */
  category?: FailureCategory;
  /** What the answer could not establish. Required when PARTIALLY_SATISFIED. */
  gaps: DeclaredGap[];
  /** Machine reason, for logs. Never shown verbatim to a user. */
  reason: string;
}

const outcome = (
  state: OutcomeState, reason: string,
  category?: FailureCategory, gaps: DeclaredGap[] = [],
): Outcome => ({
  version: OUTCOME_CONTRACT_VERSION, state, reason, gaps,
  ...(category ? { category } : {}),
});

export const satisfied = (reason: string): Outcome =>
  outcome("SATISFIED", reason);

/**
 * Answered in part, with the remainder named.
 *
 * REFUSES AN EMPTY GAP LIST. "Partially satisfied, and I won't say what's
 * missing" is indistinguishable from a claim of success, which is the thing
 * this contract exists to prevent — so it degrades to SATISFIED rather than
 * silently asserting a gap it cannot describe.
 */
export const partiallySatisfied = (reason: string, gaps: DeclaredGap[]): Outcome =>
  gaps.length === 0
    ? outcome("SATISFIED", `${reason}:no_declared_gaps`)
    : outcome("PARTIALLY_SATISFIED", reason, "insufficient_evidence", gaps);

export const requiresUnlock = (reason: string, gaps: DeclaredGap[] = []): Outcome =>
  outcome("REQUIRES_UNLOCK", reason, "requires_approval", gaps);

export const unsupported = (reason: string, gaps: DeclaredGap[] = []): Outcome =>
  outcome("UNSUPPORTED", reason, "unsupported_capability", gaps);

export const failed = (reason: string, category: FailureCategory): Outcome =>
  outcome("FAILED", reason, category);

/**
 * Categorise a thrown value.
 *
 * ── WHY THIS EXISTS AT THE CATCH ───────────────────────────────────────────
 *
 * `pilot-chat`'s top-level handler computed `String(e)`, the provider code and
 * a kind, logged all of them, and then persisted `{ type: "error", kind:
 * "unexpected" }` — discarding, at the moment of writing the row, everything
 * needed to tell a missing capability from a provider outage from a defect.
 *
 * A category that reaches the database is a bug report. One that reaches only
 * `console.error` is a bug report nobody will read.
 */
export function categorizeThrown(e: unknown): FailureCategory {
  const name = (e as { name?: unknown })?.name;
  const msg = String((e as { message?: unknown })?.message ?? e ?? "");
  if (typeof name === "string") {
    if (/MissionCompilationFailed/.test(name)) return "model_failure";
    if (/MissionCompilationBlocked/.test(name)) return "not_feasible";
    if (/PaidExecutionBlocked/.test(name)) return "requires_approval";
    if (/CapabilityContainment/.test(name)) return "not_feasible";
  }
  // A TDZ or a type error is a defect, and must never be reported as anything
  // softer. `Cannot access 'x' before initialization` took out six surfaces and
  // read to users as a transient glitch worth retrying.
  if (e instanceof ReferenceError || e instanceof TypeError) return "internal_error";
  if (/quota|rate.?limit|credits?_exhausted/i.test(msg)) return "provider_failure";
  return "internal_error";
}

/** The record persisted alongside a failure, so the category survives the turn. */
export function failureMetadata(e: unknown, extra: Record<string, unknown> = {}) {
  const category = categorizeThrown(e);
  return {
    type: "error",
    outcome: {
      version: OUTCOME_CONTRACT_VERSION,
      state: "FAILED" as const,
      category,
      gaps: [],
      reason: `thrown:${category}`,
    },
    // THE MESSAGE, TRUNCATED, NOT THE STACK. Enough to recognise the fault when
    // reading rows; not so much that a database row becomes a log sink.
    error_name: (e as { name?: unknown })?.name ?? null,
    error_message: String((e as { message?: unknown })?.message ?? e ?? "").slice(0, 300),
    ...extra,
  };
}
