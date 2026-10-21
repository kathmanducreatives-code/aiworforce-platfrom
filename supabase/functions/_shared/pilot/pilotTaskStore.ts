// No database implementation is shipped. Native atomicity/schema is an enablement gate.
import type { ModelUsage } from "../modelCostModel.ts";
import type {
  PilotModelPolicy,
  PilotModelSelection,
} from "./pilotTaskModelPolicy.ts";
export interface ModelAdmission {
  workspace_id: string;
  client_binding_id: string;
  task_id: string;
  actor_id: string;
  binding_hash: string;
  selection: PilotModelSelection;
  policy_hash: string;
  policy: PilotModelPolicy;
  reserve_usd: number;
  // One probe per signed task. This is NOT permission to reset the existing mission counter.
  max_task_attempts: 1;
  runtime_attempt_ceiling: 4;
  workspace_ceiling_usd: number;
  workspace_period_days: number;
}
export interface PilotModelReceipt {
  attempt_id: string;
  workspace_id: string;
  client_binding_id: string;
  task_id: string;
  requested_provider: "openai";
  actual_provider: "openai" | null;
  transport_dispatched: boolean;
  requested_model: string;
  actual_model: string | null;
  response_id: string | null;
  request_id: string | null;
  usage: ModelUsage;
  estimated_cost_usd: number | null;
  actual_cost_usd: null;
  cost_source: "event_priced" | "unknown";
  status: "succeeded" | "failed";
  failure_code: string | null;
  finish_reason: string | null;
  http_status: number | null;
  duration_ms: number;
  accounting_uncertain: boolean;
}
export interface PilotTaskModelStore {
  // Atomic admission: reauthorize/fence task+policy+actor, inspect existing spending,
  // reserve upper-bound cost, consume one shared attempt, and persist started receipt.
  // An existing attempt (settled OR pending) refuses replay, including after restart.
  reserve(admission: ModelAdmission): Promise<{ attempt_id: string }>;
  // Exactly once, atomic receipt settlement + ledger projection. Unknown/missing
  // usage keeps reservation held; no success/output release if this fails.
  settle(receipt: PilotModelReceipt): Promise<void>;
}
