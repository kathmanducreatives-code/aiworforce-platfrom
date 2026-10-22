import { object, validId } from "./pilotPolicy.ts";
import { exactKeys, refuse } from "./pilotCompanyResearch.ts";
export interface ReviewPolicy {
  workspace_id: string;
  client_binding_id: string;
  version: number;
  review_enabled: boolean;
  export_enabled: boolean;
  approval_ttl_seconds: number;
  max_export_rows: number;
  destination_id: string;
}
export function reviewPolicy(
  raw: unknown,
  workspace: string,
  client: string,
): ReviewPolicy {
  const p = object(raw);
  exactKeys(p, [
    "workspace_id",
    "client_binding_id",
    "version",
    "review_enabled",
    "export_enabled",
    "approval_ttl_seconds",
    "max_export_rows",
    "destination_id",
  ]);
  if (p.workspace_id !== workspace || p.client_binding_id !== client) {
    refuse("review_policy_scope_mismatch");
  }
  if (
    !Number.isSafeInteger(p.version) || Number(p.version) < 1 ||
    typeof p.review_enabled !== "boolean" ||
    typeof p.export_enabled !== "boolean" ||
    !Number.isSafeInteger(p.approval_ttl_seconds) ||
    Number(p.approval_ttl_seconds) < 1 ||
    Number(p.approval_ttl_seconds) > 86400 ||
    !Number.isSafeInteger(p.max_export_rows) || Number(p.max_export_rows) < 1 ||
    Number(p.max_export_rows) > 5 || !validId(p.destination_id)
  ) refuse("review_policy_invalid");
  if (!p.review_enabled) refuse("pilot_review_disabled");
  return structuredClone(p) as unknown as ReviewPolicy;
}
