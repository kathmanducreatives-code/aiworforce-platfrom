import { object, PilotRefusal, validId } from "./pilotPolicy.ts";
import {
  PILOT_HARD_LIMITS,
  PILOT_MODEL_REGISTRY,
} from "./pilotModelRegistry.ts";
export interface PilotModelSelection {
  provider: "openai";
  model: "gpt-4.1-mini";
  credential_id: string;
  policy_version: number;
  task_kind: "call_brief";
  schema: "pilot_model_probe_v1";
}
export interface PilotModelPolicy {
  workspace_id: string;
  client_binding_id: string;
  version: number;
  execution_enabled: boolean;
  data_sharing_approved: boolean;
  provider: "openai";
  model: "gpt-4.1-mini";
  credential_id: string;
  max_input_tokens: number;
  max_output_tokens: number;
  model_budget_usd: number;
  provider_budget_usd: number;
  combined_budget_usd: number;
}
const exact = (o: Record<string, unknown>, keys: string[]) => {
  if (
    Object.keys(o).length !== keys.length ||
    Object.keys(o).some((k) => !keys.includes(k))
  ) throw new PilotRefusal("invalid_model_policy", 400);
};
export function modelSelection(raw: unknown): PilotModelSelection {
  const v = object(raw);
  exact(v, [
    "provider",
    "model",
    "credential_id",
    "policy_version",
    "task_kind",
    "schema",
  ]);
  const entry = PILOT_MODEL_REGISTRY.find((e) =>
    e.provider === v.provider && e.model === v.model && e.implemented
  );
  if (!entry || v.task_kind !== "call_brief" || v.schema !== entry.schema) {
    throw new PilotRefusal("unsupported_pilot_model", 400);
  }
  if (
    !validId(v.credential_id) || !Number.isSafeInteger(v.policy_version) ||
    Number(v.policy_version) < 1
  ) throw new PilotRefusal("invalid_model_selection", 400);
  return v as unknown as PilotModelSelection;
}
// Only a trusted server policy loader may supply this document. No browser settings fallback.
export function modelPolicy(
  raw: unknown,
  workspace: string,
  client: string,
): PilotModelPolicy {
  const p = object(raw);
  exact(p, [
    "workspace_id",
    "client_binding_id",
    "version",
    "execution_enabled",
    "data_sharing_approved",
    "provider",
    "model",
    "credential_id",
    "max_input_tokens",
    "max_output_tokens",
    "model_budget_usd",
    "provider_budget_usd",
    "combined_budget_usd",
  ]);
  if (p.workspace_id !== workspace || p.client_binding_id !== client) {
    throw new PilotRefusal("model_policy_scope_mismatch");
  }
  modelSelection({
    provider: p.provider,
    model: p.model,
    credential_id: p.credential_id,
    policy_version: p.version,
    task_kind: "call_brief",
    schema: "pilot_model_probe_v1",
  });
  if (
    typeof p.execution_enabled !== "boolean" ||
    typeof p.data_sharing_approved !== "boolean"
  ) throw new PilotRefusal("invalid_model_policy", 400);
  for (
    const [k, max] of [["max_input_tokens", 8192], [
      "max_output_tokens",
      512,
    ]] as const
  ) {
    if (
      !Number.isSafeInteger(p[k]) || Number(p[k]) < 1 || Number(p[k]) > max
    ) throw new PilotRefusal("invalid_model_token_limit", 400);
  }
  for (
    const [k, max] of [["model_budget_usd", PILOT_HARD_LIMITS.model_usd], [
      "provider_budget_usd",
      PILOT_HARD_LIMITS.provider_usd,
    ], ["combined_budget_usd", PILOT_HARD_LIMITS.combined_usd]] as const
  ) {
    if (
      typeof p[k] !== "number" || !Number.isFinite(p[k]) || Number(p[k]) <= 0 ||
      Number(p[k]) > max
    ) throw new PilotRefusal("invalid_model_budget", 400);
  }
  if (Number(p.model_budget_usd) > Number(p.combined_budget_usd)) {
    throw new PilotRefusal("invalid_model_budget", 400);
  }
  return structuredClone(p) as unknown as PilotModelPolicy;
}
export function enforceModelSelection(
  selection: PilotModelSelection,
  policy: PilotModelPolicy,
) {
  if (!policy.execution_enabled) {
    throw new PilotRefusal("pilot_model_execution_disabled", 503);
  }
  if (!policy.data_sharing_approved) {
    throw new PilotRefusal("model_data_sharing_not_approved");
  }
  if (
    selection.policy_version !== policy.version ||
    selection.provider !== policy.provider ||
    selection.model !== policy.model ||
    selection.credential_id !== policy.credential_id
  ) throw new PilotRefusal("task_model_policy_mismatch", 409);
}
