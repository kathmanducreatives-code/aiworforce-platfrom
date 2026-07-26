// PLANNER DIAGNOSTICS — what a planning round is allowed to record.
//
// NO NEW TABLE in Phase 1. This produces a plain object shaped to sit inside the
// existing `tasks.result` metadata that run-agent already writes, so adopting it
// later changes what a task result CONTAINS, never how it is persisted. Nothing
// here writes anything.
//
// The design constraint is subtractive: diagnostics must be useful enough to debug
// a bad plan without becoming a second, unguarded copy of the prompt. So the record
// carries HASHES of the input and output rather than their text, and an allow-list
// builder rather than a spread — a spread would silently start recording whatever
// field someone adds to the planner envelope next.
//
// NEVER RECORDED: secrets, API keys, raw Company Brain, prompt text, model
// reasoning, or anything belonging to another workspace.
//
// PURE. No network, no database, no environment reads.

import { canonicalJson, sha256Hex } from "../planHash.ts";
import type { AgentoryDepartment } from "./mission.ts";
import type { PlannerCallDiagnostics, PlannerStatus } from "./plannerWrapper.ts";

export const DIAGNOSTICS_VERSION = "agentory-planner-diagnostics-1.0.0";

/** The key this record occupies inside an existing task result. */
export const PLANNER_DIAGNOSTICS_KEY = "planner_diagnostics";

export interface PlannerDiagnosticsRecord {
  diagnostics_version: string;

  mission_id: string;
  task_id: string | null;
  workspace_id: string;
  department: AgentoryDepartment;

  planner_version: string;
  model: string;
  provider: string;

  input_hash: string;
  output_hash: string | null;

  status: PlannerStatus;
  latency_ms: number;
  token_usage: { input?: number; output?: number } | null;

  strategy_hash: string | null;
  validation: {
    valid: boolean;
    violation_codes: string[];
    approvals_required: string[];
  } | null;

  fallback_reason: string | null;
  approval_required: boolean;
  round: number | null;
  estimated_cost_usd: number | null;
}

// ------------------------------------------------------------ redaction ------
//
// Token usage arrives as an opaque `usage` blob whose shape differs per provider.
// Only the two numeric counts are extracted; the rest is discarded rather than
// stored, because an unknown blob is exactly where a prompt echo would hide.

export function extractTokenUsage(usage: unknown): { input?: number; output?: number } | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const input = firstFinite(u.input_tokens, u.prompt_tokens, (u.input as Record<string, unknown>)?.tokens);
  const output = firstFinite(u.output_tokens, u.completion_tokens, (u.output as Record<string, unknown>)?.tokens);
  if (input === undefined && output === undefined) return null;
  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
  };
}

function firstFinite(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

// ------------------------------------------------------------- the builder ---

export interface BuildDiagnosticsInput {
  missionId: string;
  taskId?: string | null;
  workspaceId: string;
  department: AgentoryDepartment;
  call: PlannerCallDiagnostics;
  strategyHash?: string | null;
  validation?: {
    valid: boolean;
    violations?: Array<{ code: string; severity: string }>;
  } | null;
  fallbackReason?: string | null;
  round?: number | null;
  estimatedCostUsd?: number | null;
}

/**
 * Build one diagnostics record.
 *
 * Field-by-field by construction. There is no path by which an unlisted field of
 * `call` or `validation` reaches the output.
 */
export function buildPlannerDiagnostics(input: BuildDiagnosticsInput): PlannerDiagnosticsRecord {
  const violations = input.validation?.violations ?? [];

  return {
    diagnostics_version: DIAGNOSTICS_VERSION,

    mission_id: input.missionId,
    task_id: input.taskId ?? null,
    workspace_id: input.workspaceId,
    department: input.department,

    planner_version: input.call.planner_version,
    model: input.call.model,
    provider: input.call.provider,

    input_hash: input.call.input_hash,
    output_hash: input.call.output_hash,

    status: input.call.status,
    latency_ms: input.call.latency_ms,
    token_usage: extractTokenUsage(input.call.token_usage),

    strategy_hash: input.strategyHash ?? null,
    validation: input.validation
      ? {
          valid: input.validation.valid,
          violation_codes: violations.filter((v) => v.severity === "block").map((v) => v.code).sort(),
          approvals_required: violations.filter((v) => v.severity === "approval_required").map((v) => v.code).sort(),
        }
      : null,

    fallback_reason: input.fallbackReason ?? null,
    approval_required: violations.some((v) => v.severity === "approval_required"),
    round: input.round ?? null,
    estimated_cost_usd: input.estimatedCostUsd ?? null,
  };
}

// ------------------------------------------------------------- the assertion --
//
// A test asserts this over every produced record. Keeping the forbidden-key list
// next to the builder is what makes "we do not log secrets" a check rather than a
// claim in a comment.

const FORBIDDEN_KEY_RE =
  /(api[_-]?key|secret|password|token(?!_usage)|bearer|authorization|credential|cookie|prompt|system_prompt|user_message|messages|reasoning|thinking|chain_of_thought|company_brain|icp|evidence|instruction)/i;

export interface RedactionAudit {
  safe: boolean;
  offendingPaths: string[];
}

/** Walk a record and report any key that must never be persisted. */
export function auditRedaction(record: unknown): RedactionAudit {
  const offending: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (typeof v === "object") {
      for (const k of Object.keys(v as Record<string, unknown>)) {
        if (FORBIDDEN_KEY_RE.test(k)) offending.push(path ? `${path}.${k}` : k);
        walk((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      }
    }
  };
  walk(record, "");
  return { safe: offending.length === 0, offendingPaths: offending.sort() };
}

/**
 * Merge diagnostics into an existing task result.
 *
 * Returns a NEW object under a single reserved key. It never mutates its input and
 * never touches another key, so adopting it cannot disturb a result document that
 * the continuation and Workbench paths already depend on.
 */
export function attachDiagnostics(
  result: Record<string, unknown> | null | undefined,
  record: PlannerDiagnosticsRecord,
): Record<string, unknown> {
  return { ...(result ?? {}), [PLANNER_DIAGNOSTICS_KEY]: record };
}

/** Stable identity for a diagnostics record, for de-duplication in logs. */
export function diagnosticsHash(record: PlannerDiagnosticsRecord): Promise<string> {
  return sha256Hex(canonicalJson(record));
}
