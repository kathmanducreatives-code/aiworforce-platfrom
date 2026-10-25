import {
  authorizePilotModelContext,
  type PilotModelContextDeps,
  type PilotModelDeps,
  runPilotModelTask,
} from "./pilotModelAdapter.ts";
import { freezePilotContext } from "./pilotContextSnapshot.ts";
import { createPilotScopeStore } from "./pilotScopeStore.ts";
import { accountModel } from "./pilotModelAccounting.ts";
import type { PilotSnapshotStore } from "./pilotSnapshotStore.ts";
import type { PacketScope } from "./pilotEvidencePacket.ts";
import { canonical, digest } from "./pilotScope.ts";
import { boundedJson, refuse } from "./pilotCompanyResearch.ts";
import { buildBriefCatalog, callBriefPrompt } from "./callBriefPrompt.ts";
import { renderCallBrief, validateBriefChoice } from "./callBriefValidator.ts";
import type {
  BriefFence,
  CallBriefDraft,
  CallBriefStore,
} from "./callBriefStore.ts";
import type { PilotModelReceipt } from "./pilotTaskStore.ts";
export interface CallBriefDeps extends PilotModelDeps {
  snapshots: PilotSnapshotStore;
  loadApprovedInputs: (scope: PacketScope) => Promise<unknown>;
  briefs: CallBriefStore;
}
function immutable<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v).forEach(immutable);
    Object.freeze(v);
  }
  return v;
}
export interface CallBriefReadDeps extends PilotModelContextDeps {
  snapshots: Pick<PilotSnapshotStore, "read">;
  briefs: Pick<CallBriefStore, "read">;
}
// Review callers receive no transport, credential resolver, accounting writer or source loader.
async function accessCallBrief(
  scope: PacketScope,
  deps: CallBriefReadDeps,
  generation: CallBriefDeps | null,
) {
  if (deps.mode !== "offline_fixture") refuse("pilot_call_brief_disabled");
  // One source of identity/dependencies for P1, P4 and P5; no caller-supplied packet/context override.
  const store = deps.store?.() ?? createPilotScopeStore(deps),
    modelDeps = { ...deps, store: () => store };
  const auth = await authorizePilotModelContext(scope, modelDeps);
  if (auth.selection.schema !== "call_brief_v1") {
    refuse("brief_task_contract_required");
  }
  const frozen = () =>
    freezePilotContext(scope, {
      mode: deps.mode,
      env: deps.env,
      user_id: deps.user_id,
      scopeStore: store,
      snapshots: generation ? generation.snapshots : {
        read: async (s) => {
          const saved = await deps.snapshots.read(s);
          if (!saved) refuse("brief_review_snapshot_missing");
          return saved;
        },
        insertOnce: () =>
          Promise.reject(new Error("brief_review_snapshot_write_forbidden")),
      },
      loadApprovedInputs: generation
        ? generation.loadApprovedInputs
        : () =>
          Promise.reject(new Error("brief_review_source_reload_forbidden")),
    });
  const packet = await frozen(),
    catalog = buildBriefCatalog(packet),
    prompt = callBriefPrompt(catalog);
  const request_hash = await digest(prompt);
  const fence: BriefFence = {
    ...scope,
    actor_id: deps.user_id,
    packet_hash: packet.packet_hash,
    brain_hash: packet.approval.brain_hash,
    inputs_hash: packet.approval.inputs_hash,
    binding_hash: auth.binding_hash,
    policy_hash: auth.policy_hash,
    request_hash,
  };
  const check = async () => {
    await auth.check();
    if ((await frozen()).packet_hash !== packet.packet_hash) {
      refuse("brief_context_changed");
    }
  };
  const materialize = async (
    choice: unknown,
    receipt: PilotModelReceipt,
  ): Promise<CallBriefDraft> => {
    if (
      receipt.workspace_id !== scope.workspace_id ||
      receipt.client_binding_id !== scope.client_binding_id ||
      receipt.task_id !== scope.task_id ||
      receipt.requested_provider !== auth.selection.provider ||
      receipt.actual_provider !== auth.selection.provider ||
      !receipt.transport_dispatched ||
      receipt.requested_model !== auth.selection.model ||
      receipt.actual_model !== auth.selection.model ||
      receipt.status !== "succeeded" || receipt.failure_code !== null ||
      receipt.finish_reason !== "stop" ||
      !receipt.attempt_id || !receipt.request_id || !receipt.response_id ||
      receipt.accounting_uncertain ||
      receipt.http_status === null || receipt.http_status < 200 ||
      receipt.http_status >= 300
    ) refuse("brief_receipt_invalid");
    // Reuse existing accounting parser/pricer rather than trusting persisted cost/status labels.
    const actual = accountModel({
      usage: {
        prompt_tokens: receipt.usage.input_tokens,
        completion_tokens: receipt.usage.output_tokens,
        prompt_tokens_details: {
          cached_tokens: receipt.usage.cached_input_tokens,
        },
      },
    }, receipt.actual_model);
    if (
      receipt.actual_cost_usd !== null ||
      receipt.cost_source !== actual.cost_source ||
      actual.accounting_uncertain ||
      actual.estimated_cost_usd !== receipt.estimated_cost_usd ||
      receipt.usage.input_tokens! > auth.policy.max_input_tokens ||
      receipt.usage.output_tokens! > auth.policy.max_output_tokens
    ) refuse("brief_receipt_usage_invalid");
    const normalized = validateBriefChoice(choice, catalog);
    const body = boundedJson({
      ...fence,
      version: "pilot_call_brief_draft_v1" as const,
      selection: auth.selection,
      model_receipt: receipt,
      source_lineage: {
        file_hash: packet.evidence.source_snapshot.csv.file_hash,
        normalized_hash: packet.evidence.source_snapshot.csv.normalized_hash,
        source_rows: packet.evidence.source_snapshot.csv.source_rows,
        apollo_account_id:
          packet.evidence.source_snapshot.csv.normalized.apollo_account_id ??
            null,
        apollo_contact_id:
          packet.evidence.source_snapshot.csv.normalized.apollo_contact_id ??
            null,
        imported_row_id: null,
        source_origin: "declared_unverified_export" as const,
      },
      choice: normalized,
      content: renderCallBrief(normalized, catalog),
      review_status: "unreviewed_draft" as const,
      review_required: true as const,
      dispatch_allowed: false as const,
    }, 180000);
    return { ...body, draft_hash: await digest(body) };
  };
  await check();
  const saved = await deps.briefs.read(scope);
  if (saved) {
    if (
      saved.version !== "pilot_call_brief_draft_v1" ||
      Object.entries(fence).some(([k, v]) =>
        (saved as unknown as Record<string, unknown>)[k] !== v
      ) || canonical(saved.selection) !== canonical(auth.selection)
    ) refuse("brief_saved_scope_mismatch");
    const expected = await materialize(saved.choice, saved.model_receipt);
    if (canonical(saved) !== canonical(expected)) {
      refuse("brief_saved_integrity_failure");
    }
    await check();
    return { draft: immutable(structuredClone(expected)), packet, catalog };
  }
  if (!generation) refuse("brief_review_draft_missing");
  const result = await runPilotModelTask(scope, {
    ...generation,
    store: () => store,
  }, {
    ...prompt,
    validate: (v) => validateBriefChoice(v, catalog),
  });
  // No generation/repair/fallback loop. A lost/uncertain attempt remains consumed in the P4 store.
  await check();
  const draft = await materialize(result.value, result.receipt);
  const inserted = await generation.briefs.insertOnce(draft, fence);
  if (canonical(inserted) !== canonical(draft)) refuse("brief_commit_mismatch");
  await check();
  return { draft: immutable(structuredClone(draft)), packet, catalog };
}

export async function runCallBrief(
  scope: PacketScope,
  deps: CallBriefDeps,
): Promise<CallBriefDraft> {
  return (await accessCallBrief(scope, deps, deps)).draft;
}
export function readCallBriefForReview(
  scope: PacketScope,
  deps: CallBriefReadDeps,
) {
  return accessCallBrief(scope, deps, null);
}
