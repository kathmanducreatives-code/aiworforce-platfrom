// STRATEGIST OBSERVABILITY RECORD.
//
// One storable record per strategist resolution, identical in shape no matter
// which adapter served it. It answers "what happened, how much did it cost, and
// was the model or the deterministic path in charge?" and NOTHING else.
//
// It deliberately never carries: prompt text, model output text, credentials,
// candidate/company PII, or chain-of-thought. Only a stable prompt HASH travels,
// so two runs can be compared without persisting what was sent.

import type { StrategistProviderId } from "./provider.ts";

export type StrategistPurposeTag = "initial_strategy" | "next_action";

export type StrategistOutcome =
  | "model_primary_approved"
  | "model_escalation_approved"
  | "deterministic_fallback";

export interface StrategistObservabilityRecord {
  purpose: StrategistPurposeTag;
  policy_version: string;
  prompt_schema_version: string;
  /** Stable hash of system+user message. Never the messages themselves. */
  prompt_hash: string;
  /** Configured adapter that served the call. */
  provider: StrategistProviderId | string | null;
  /** Canonical model id (never a vendor wire id). */
  model: string | null;
  escalated: boolean;
  model_requests: number;
  latency_ms: number;
  outcome: StrategistOutcome;
  status: string;
  failure_reason: string | null;
  workspace_id: string | null;
  task_id: string | null;
  round: number | null;
  usage?: unknown;
}

const SECRET_HINTS = [/api[_-]?key/i, /authorization/i, /bearer\s/i, /(^|[^a-z0-9])sk-[A-Za-z0-9]{16,}/i];

/** Defensive: no field of a record may ever look like a credential. */
export function recordLooksSafe(record: StrategistObservabilityRecord): boolean {
  const serialized = JSON.stringify(record);
  return !SECRET_HINTS.some((p) => p.test(serialized));
}

export interface BuildObservabilityInput {
  purpose: StrategistPurposeTag;
  policyVersion: string;
  promptSchemaVersion: string;
  promptHash: string;
  provider: StrategistProviderId | string | null;
  model: string | null;
  escalated: boolean;
  modelRequests: number;
  latencyMs: number;
  outcome: StrategistOutcome;
  status: string;
  failureReason?: string | null;
  workspaceId?: string | null;
  taskId?: string | null;
  round?: number | null;
  usage?: unknown;
}

export function buildStrategistObservability(
  input: BuildObservabilityInput,
): StrategistObservabilityRecord {
  return {
    purpose: input.purpose,
    policy_version: input.policyVersion,
    prompt_schema_version: input.promptSchemaVersion,
    prompt_hash: input.promptHash,
    provider: input.provider,
    model: input.model,
    escalated: input.escalated,
    model_requests: input.modelRequests,
    latency_ms: input.latencyMs,
    outcome: input.outcome,
    status: input.status,
    failure_reason: input.failureReason ?? null,
    workspace_id: input.workspaceId ?? null,
    task_id: input.taskId ?? null,
    round: input.round ?? null,
    usage: input.usage,
  };
}

export type StrategistObservabilitySink = (record: StrategistObservabilityRecord) => void;

/** Emitting telemetry must never be able to fail a run. */
export function emitStrategistObservability(
  record: StrategistObservabilityRecord,
  sink?: StrategistObservabilitySink,
): void {
  if (!sink) return;
  try {
    sink(record);
  } catch {
    // observability is best-effort, by design
  }
}
