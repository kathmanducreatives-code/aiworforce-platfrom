// STRATEGY VALIDATION — deterministic primitives every department shares.
//
// Nothing a model returns reaches a provider without passing through here. The
// checks below are POLICY and EXECUTION SAFETY only: did the plan preserve what the
// user asked for, stay inside the capability allow-list, stay inside budget, and
// avoid smuggling anything executable.
//
// WHAT IS DELIBERATELY ABSENT: department semantics. Whether "Revenue Operations"
// belongs to the sales_operations family is a LEAD question, answered by
// `_shared/jobFamilyRegistry.ts` and `_shared/broadeningValidator.ts`, which already
// do it correctly. Putting role logic here would fork that judgement across two
// files and guarantee they eventually disagree. Departments compose their own
// semantic validators on top of these primitives.
//
// PURE. No network, no database. `detectInjection` is REUSED from the existing
// broadening validator so the repository has one pattern list.

import { canonicalJson, sha256Hex } from "../planHash.ts";
import { detectInjection } from "../broadeningValidator.ts";
import { decideApprovals, type ApprovalPolicyConfig, type ProposedChange } from "./approvalPolicy.ts";
import { isCapabilitySelectable, type CapabilityDepartment } from "./capabilityRegistry.ts";
import type { AgentoryEnvironmentMode } from "./mission.ts";

export type ViolationSeverity = "block" | "approval_required";

export interface StrategyViolation {
  code: string;
  message: string;
  severity: ViolationSeverity;
}

export type StrategyValidationResult<T> =
  | {
      valid: true;
      approved_strategy: T;
      strategy_hash: string;
      approvals_required: [];
    }
  | {
      valid: false;
      violations: StrategyViolation[];
      safe_fallback_available: boolean;
    };

function block(code: string, message: string): StrategyViolation {
  return { code, message, severity: "block" };
}
function approval(code: string, message: string): StrategyViolation {
  return { code, message, severity: "approval_required" };
}

// ------------------------------------------------------------- primitives ----

/** The original instruction must survive the round trip byte-for-byte. */
export function checkInstructionPreserved(original: string, echoed: unknown): StrategyViolation | null {
  if (typeof echoed !== "string") {
    return block("instruction_missing", "The strategy did not carry the original instruction.");
  }
  if (echoed !== original) {
    return block("instruction_altered", "The strategy altered the user's original instruction.");
  }
  return null;
}

export function checkWorkspace(expected: string, actual: unknown): StrategyViolation | null {
  if (String(actual ?? "") !== String(expected)) {
    return block("workspace_mismatch", "The strategy references a different workspace.");
  }
  return null;
}

/** Every selected capability must be registered, enabled and in-department. */
export function checkCapabilities(
  selected: unknown,
  opts: { department: CapabilityDepartment; environment: AgentoryEnvironmentMode },
): StrategyViolation[] {
  const out: StrategyViolation[] = [];
  if (!Array.isArray(selected)) {
    return [block("capabilities_missing", "The strategy selected no capabilities.")];
  }
  for (const raw of selected) {
    const key = String(raw ?? "").trim();
    if (!key) { out.push(block("capability_blank", "A capability key was blank.")); continue; }
    if (!isCapabilitySelectable(key, opts)) {
      out.push(block("capability_not_allowed", `Capability "${key}" is not available here.`));
    }
  }
  if (out.length === 0 && selected.length === 0) {
    out.push(block("capabilities_missing", "The strategy selected no capabilities."));
  }
  return out;
}

/**
 * HARD GEOGRAPHY. Every location the user required must still be present.
 *
 * One-directional by design: a plan may not DROP a required location, but adding
 * one is caught by the approval layer as `geography_expansion` rather than here, so
 * the two failures stay distinguishable in the report.
 */
export function checkGeographyPreserved(required: string[], planned: unknown): StrategyViolation | null {
  if (required.length === 0) return null;
  const have = new Set((Array.isArray(planned) ? planned : []).map((x) => String(x ?? "").trim().toLowerCase()));
  const missing = required.filter((r) => !have.has(r.trim().toLowerCase()));
  if (missing.length > 0) {
    return block("geography_dropped", `Required location(s) dropped: ${missing.join(", ")}.`);
  }
  return null;
}

export function checkExactValue(
  code: string,
  label: string,
  expected: unknown,
  actual: unknown,
): StrategyViolation | null {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    return block(code, `${label} changed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
  return null;
}

export interface BudgetLimits {
  maximum_calls: number;
  maximum_estimated_cost_usd: number;
  maximum_rounds: number;
}

export function checkBudget(limits: BudgetLimits, planned: unknown): StrategyViolation[] {
  const out: StrategyViolation[] = [];
  const p = (planned ?? {}) as Record<string, unknown>;

  const calls = Number(p.estimated_calls ?? 0);
  const cost = Number(p.estimated_cost_usd ?? 0);
  const rounds = Number(p.rounds ?? 0);

  if (!Number.isFinite(calls) || calls < 0) out.push(block("budget_calls_invalid", "Planned call count is not a number."));
  else if (calls > limits.maximum_calls) out.push(block("budget_calls_exceeded", `Planned ${calls} calls; limit is ${limits.maximum_calls}.`));

  if (!Number.isFinite(cost) || cost < 0) out.push(block("budget_cost_invalid", "Planned cost is not a number."));
  else if (cost > limits.maximum_estimated_cost_usd) out.push(block("budget_cost_exceeded", `Planned $${cost}; limit is $${limits.maximum_estimated_cost_usd}.`));

  if (!Number.isFinite(rounds) || rounds < 0) out.push(block("budget_rounds_invalid", "Planned round count is not a number."));
  else if (rounds > limits.maximum_rounds) out.push(block("budget_rounds_exceeded", `Planned ${rounds} rounds; limit is ${limits.maximum_rounds}.`));

  return out;
}

/** A strategy already attempted must not be attempted again. */
export function checkDuplicateStrategy(hash: string, attempted: string[] | null | undefined): StrategyViolation | null {
  if ((attempted ?? []).includes(hash)) {
    return block("duplicate_strategy", "This strategy was already attempted.");
  }
  return null;
}

// ------------------------------------------------------------ unsafe content --
//
// A strategy is a set of capability keys and parameters. It must never carry a URL,
// a provider identifier, a credential, or an arbitrary function name — those are all
// attempts to reach past the capability boundary.

const RAW_ACTOR_RE = /\b[a-z0-9_-]{3,}\/[a-z0-9._-]{3,}\b/i;   // "harvestapi/linkedin-company"
const URL_RE = /https?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;
const CREDENTIAL_RE =
  /\b(api[_-]?key|secret|password|bearer|authorization|token|credential|cookie|x-api-key|anon[_-]?key|service[_-]?role)\b/i;
const FUNCTION_CALL_RE = /\b(eval|exec|require|import|process\.env|Deno\.env|fetch|__proto__|constructor)\b/;

export function checkUnsafeContent(strategy: unknown): StrategyViolation[] {
  const out: StrategyViolation[] = [];
  const blob = canonicalJson(strategy);

  const injection = detectInjection(blob);
  if (injection) out.push(block("prompt_injection", `Strategy contains instruction-shaped content (${injection}).`));

  if (URL_RE.test(blob)) out.push(block("url_not_allowed", "Strategy contains a URL."));
  if (CREDENTIAL_RE.test(blob)) out.push(block("credential_like_field", "Strategy contains a credential-like field."));
  if (FUNCTION_CALL_RE.test(blob)) out.push(block("executable_reference", "Strategy references executable machinery."));
  if (RAW_ACTOR_RE.test(blob)) out.push(block("raw_actor_id", "Strategy references a provider implementation directly."));

  return out;
}

// ------------------------------------------------------------- the composer ---

export interface ValidateStrategyInput<T> {
  strategy: T;
  department: CapabilityDepartment;
  environment: AgentoryEnvironmentMode;

  originalInstruction: string;
  workspaceId: string;

  /** Read the fields this validator needs out of the department's strategy shape. */
  read: {
    echoedInstruction: (s: T) => unknown;
    workspaceId: (s: T) => unknown;
    capabilities: (s: T) => unknown;
    plannedGeography: (s: T) => unknown;
    requestedCount: (s: T) => unknown;
    outputEntity: (s: T) => unknown;
    quotaPolicy: (s: T) => unknown;
    budget: (s: T) => unknown;
  };

  expected: {
    requiredGeography: string[];
    requestedCount: unknown;
    outputEntity: unknown;
    quotaPolicy: unknown;
  };

  budgetLimits: BudgetLimits;
  attemptedStrategyHashes?: string[];
  proposedChanges?: ProposedChange[];
  approvalPolicy?: ApprovalPolicyConfig | null;
  /** False only when the caller genuinely has no deterministic plan to fall back to. */
  safeFallbackAvailable?: boolean;
}

/**
 * Run every shared check.
 *
 * ALL violations are collected before returning — a plan with four problems reports
 * four, so one round trip tells the whole story instead of revealing them one at a
 * time. A single `block` fails the strategy; `approval_required` findings also fail
 * it, but are distinguishable so a caller can surface them as a question rather than
 * as an error.
 */
export async function validateStrategy<T>(
  input: ValidateStrategyInput<T>,
): Promise<StrategyValidationResult<T>> {
  const { strategy, read, expected } = input;
  const violations: StrategyViolation[] = [];
  const push = (v: StrategyViolation | null) => { if (v) violations.push(v); };

  push(checkInstructionPreserved(input.originalInstruction, read.echoedInstruction(strategy)));
  push(checkWorkspace(input.workspaceId, read.workspaceId(strategy)));
  violations.push(...checkCapabilities(read.capabilities(strategy), {
    department: input.department, environment: input.environment,
  }));
  push(checkGeographyPreserved(expected.requiredGeography, read.plannedGeography(strategy)));
  push(checkExactValue("requested_count_changed", "Requested count", expected.requestedCount, read.requestedCount(strategy)));
  push(checkExactValue("output_entity_changed", "Output entity", expected.outputEntity, read.outputEntity(strategy)));
  push(checkExactValue("quota_policy_changed", "Quota policy", expected.quotaPolicy, read.quotaPolicy(strategy)));
  violations.push(...checkBudget(input.budgetLimits, read.budget(strategy)));
  violations.push(...checkUnsafeContent(strategy));

  const strategyHash = await sha256Hex(canonicalJson(strategy));
  push(checkDuplicateStrategy(strategyHash, input.attemptedStrategyHashes));

  // Approval-gated changes fail validation too, but keep their own severity so the
  // caller can tell "this is wrong" from "this needs a human".
  const approvals = decideApprovals(input.proposedChanges, input.approvalPolicy);
  for (const need of approvals.needs_approval) {
    violations.push(approval(
      `approval_required:${need.kind}`,
      need.unrecognized
        ? `Unrecognized change "${need.kind}" requires approval.`
        : `Change "${need.kind}" requires approval.`,
    ));
  }

  if (violations.length > 0) {
    return {
      valid: false,
      violations,
      safe_fallback_available: input.safeFallbackAvailable !== false,
    };
  }

  return { valid: true, approved_strategy: strategy, strategy_hash: strategyHash, approvals_required: [] };
}
