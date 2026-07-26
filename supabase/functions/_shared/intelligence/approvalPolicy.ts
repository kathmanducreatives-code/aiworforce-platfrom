// APPROVAL POLICY — what a planner may change on its own, and what needs a human.
//
// The dividing line is NOT how large the change is. It is whether the change alters
// what the user asked for.
//
//   AUTONOMOUS  — a different way to find the SAME thing.
//                 "Revenue Operations" alongside "Sales Operations" is the same
//                 role under another name; searching in a different order is the
//                 same search.
//
//   APPROVAL    — a different thing.
//                 Germany instead of the United States, VPs instead of founders,
//                 8 leads instead of 5. Each is defensible, and none is what was
//                 asked for. A planner that can make these silently can satisfy its
//                 quota by redefining the request, which is the specific failure
//                 this policy exists to prevent.
//
// PHASE 1: the policy is BUILT and TESTED, not wired. Nothing calls it from a live
// workflow. Approval EXECUTION — surfacing a request, capturing a decision,
// resuming — is Phase 2.
//
// PURE. No network, no database, no environment reads.

export type ApprovalSeverity = "autonomous" | "approval_required";

/**
 * Changes a planner may make without asking.
 *
 * Every entry preserves the user's requested OUTCOME. None widens the target set,
 * relaxes a gate, or spends more than was budgeted.
 */
export const AUTONOMOUS_CHANGES = [
  "exact_synonym",
  "same_language_safe_synonym",
  "local_language_equivalent",
  "search_order_change",
  "more_results_within_budget",
  "equivalent_preapproved_capability",
  "stronger_evidence_research",
  "tighter_exclusions",
] as const;

/**
 * Changes that require a human decision first.
 *
 * These all change WHAT is being asked for, WHO counts as an answer, or WHAT it
 * costs. `tighter_exclusions` is autonomous and `qualification_relaxation` is not,
 * for the same reason: narrowing keeps every result valid, loosening does not.
 */
export const APPROVAL_REQUIRED_CHANGES = [
  "geography_expansion",
  "company_vertical_change",
  "material_company_size_relaxation",
  "seniority_change",
  "adjacent_job_function",
  "requested_count_change",
  "output_entity_change",
  "quota_policy_relaxation",
  "qualification_relaxation",
  "current_employer_requirement_change",
  "budget_increase",
  "materially_more_expensive_provider",
  "watch_candidates_in_contact_quota",
] as const;

export type AutonomousChange = typeof AUTONOMOUS_CHANGES[number];
export type ApprovalRequiredChange = typeof APPROVAL_REQUIRED_CHANGES[number];
export type ChangeKind = AutonomousChange | ApprovalRequiredChange;

const AUTONOMOUS_SET: ReadonlySet<string> = new Set(AUTONOMOUS_CHANGES);
const APPROVAL_SET: ReadonlySet<string> = new Set(APPROVAL_REQUIRED_CHANGES);

/**
 * Classify a change.
 *
 * DEFAULT DENY. An unrecognized change kind is `approval_required`, never
 * autonomous. A change nobody has classified is a change nobody has reasoned about,
 * and the safe reading of "I don't know what this is" is not "go ahead".
 */
export function classifyChange(kind: string | null | undefined): ApprovalSeverity {
  const k = String(kind ?? "").trim().toLowerCase();
  if (AUTONOMOUS_SET.has(k)) return "autonomous";
  if (APPROVAL_SET.has(k)) return "approval_required";
  return "approval_required";
}

export function isAutonomous(kind: string | null | undefined): boolean {
  return classifyChange(kind) === "autonomous";
}

export function requiresApproval(kind: string | null | undefined): boolean {
  return classifyChange(kind) === "approval_required";
}

/** True when `kind` is a change nobody has classified — reported separately. */
export function isUnrecognizedChange(kind: string | null | undefined): boolean {
  const k = String(kind ?? "").trim().toLowerCase();
  return !AUTONOMOUS_SET.has(k) && !APPROVAL_SET.has(k);
}

// ------------------------------------------------------ workspace overrides ---

export interface ApprovalPolicyConfig {
  /** Change kinds this workspace has additionally pre-authorized. */
  autonomously_allowed: string[];
  /** Change kinds this workspace always wants to approve. */
  approval_required: string[];
}

/**
 * Kinds a workspace may NEVER pre-authorize away.
 *
 * A workspace can loosen policy for things that are matters of taste. It cannot
 * pre-authorize spending more money, ignoring the requested count, or changing what
 * counts as a qualified lead — those protect the user from the system, so the
 * system does not get to waive them.
 */
export const NON_WAIVABLE: readonly ApprovalRequiredChange[] = [
  "budget_increase",
  "requested_count_change",
  "output_entity_change",
  "quota_policy_relaxation",
  "qualification_relaxation",
  "watch_candidates_in_contact_quota",
];

const NON_WAIVABLE_SET: ReadonlySet<string> = new Set(NON_WAIVABLE);

/**
 * Classify a change under a workspace's configuration.
 *
 * Order matters: a workspace's explicit `approval_required` wins over its own
 * `autonomously_allowed`, and NON_WAIVABLE wins over everything. The strictest
 * applicable rule is the one applied.
 */
export function classifyChangeWithPolicy(
  kind: string | null | undefined,
  config: ApprovalPolicyConfig | null | undefined,
): ApprovalSeverity {
  const k = String(kind ?? "").trim().toLowerCase();

  if (NON_WAIVABLE_SET.has(k)) return "approval_required";
  if ((config?.approval_required ?? []).some((x) => String(x).trim().toLowerCase() === k)) {
    return "approval_required";
  }
  if ((config?.autonomously_allowed ?? []).some((x) => String(x).trim().toLowerCase() === k)) {
    // A workspace may pre-authorize a waivable kind, but never invent a new one:
    // an unrecognized kind stays approval_required even if listed here.
    return isUnrecognizedChange(k) ? "approval_required" : "autonomous";
  }
  return classifyChange(k);
}

// ------------------------------------------------------------- the decision ---

export interface ProposedChange {
  kind: string;
  reason?: string;
  proposed_change?: unknown;
}

export interface ApprovalDecision {
  /** True when every proposed change may proceed without a human. */
  autonomous: boolean;
  approved: ProposedChange[];
  needs_approval: Array<ProposedChange & { severity: "approval_required"; unrecognized: boolean }>;
}

/** Partition a planner's proposed changes. */
export function decideApprovals(
  changes: ProposedChange[] | null | undefined,
  config?: ApprovalPolicyConfig | null,
): ApprovalDecision {
  const approved: ProposedChange[] = [];
  const needs: ApprovalDecision["needs_approval"] = [];

  for (const c of changes ?? []) {
    const kind = String(c?.kind ?? "");
    if (classifyChangeWithPolicy(kind, config) === "autonomous") {
      approved.push({ ...c, kind });
    } else {
      needs.push({ ...c, kind, severity: "approval_required", unrecognized: isUnrecognizedChange(kind) });
    }
  }

  return { autonomous: needs.length === 0, approved, needs_approval: needs };
}
