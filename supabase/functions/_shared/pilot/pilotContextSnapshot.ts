// P5 offline foundation: no default dependencies, endpoint, model or research executor.
import {
  buildCanonicalCompanyBrain,
  type CanonicalCompanyBrain,
} from "../getCompiledCompanyBrainForWorkspace.ts";
import {
  buildSellerContext,
  type SellerContext,
} from "../workbench/sellerContext.ts";
import { SELLER_IDENTITY_FIELD_PATHS } from "../companyBrainSourceRole.ts";
import {
  isSellerIdentityBlocked,
  resolveCanonicalSellerIdentity,
} from "../workbench/sellerIdentity.ts";
import { canonical, digest, PilotAccess } from "./pilotScope.ts";
import {
  type EnvRead,
  loadPilotEnrollment,
  object,
  pilotSigningKey,
  validId,
} from "./pilotPolicy.ts";
import type { PilotScopeStore, Row } from "./pilotScopeStore.ts";
import {
  type ApprovedPacketInputs,
  buildEvidencePacket,
  type PacketScope,
  validateInputs,
} from "./pilotEvidencePacket.ts";
import {
  boundedJson,
  exactKeys,
  refuse,
  timestamp,
} from "./pilotCompanyResearch.ts";
import type { PilotSnapshotStore } from "./pilotSnapshotStore.ts";
const BRAIN_KEYS = new Set([
  ...SELLER_IDENTITY_FIELD_PATHS.map((p) => p.split(".")[0]),
  "target_customer",
  "buyer_personas",
  "pain_points",
  "triggers",
  "jobs_to_watch",
  "positive_examples",
  "negative_examples",
  "content_angles",
  "business_context",
  "messaging_guidelines",
  "exclusions",
  "qualification_rules",
  "founder",
  "competitors",
  "tools",
  "signal_preferences",
  "schema_version",
  "setup_status",
  "is_draft",
  "brain_confidence",
  "source_metadata",
]);
export interface BrainReview {
  version: "pilot_brain_review_v1";
  workspace_id: string;
  client_binding_id: string;
  source_updated_at: string;
  approved_sections: string[];
  omitted_fields: string[];
  approved_profile: Record<string, unknown>;
  compiled_context: CanonicalCompanyBrain;
  seller_context: SellerContext;
  content_role: "reviewed_client_instructions_not_verified_buyer_facts";
}
function safeProfile(value: unknown, depth = 0): void {
  if (depth > 12) refuse("snapshot_brain_depth");
  if (typeof value === "string" && value.length > 8192) {
    refuse("snapshot_brain_field_too_large");
  }
  if (Array.isArray(value)) {
    if (value.length > 100) refuse("snapshot_brain_array_limit");
    value.forEach((v) => safeProfile(v, depth + 1));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (
        /^(workspaceid|clientid|clientbindingid|tenantid|userid|taskid|accountid|contactid|apikey|secret|password|accesstoken|refreshtoken|credentials|credentialid|destinationid|proto|prototype|constructor)$/i
          .test(k.replace(/[^a-z0-9]/gi, ""))
      ) {
        refuse("snapshot_brain_unsafe_field");
      }
      safeProfile(v, depth + 1);
    }
  }
}
export function reviewBrainSnapshot(
  scope: Omit<PacketScope, "task_id">,
  row: Row,
  sections: string[],
): BrainReview {
  if (
    row.workspace_id !== scope.workspace_id || row.onboarding_completed !== true
  ) refuse("snapshot_brain_scope_or_activation");
  const profile = object(row.profile);
  if (
    !Array.isArray(sections) || !sections.length || sections.length > 80 ||
    new Set(sections).size !== sections.length ||
    sections.some((k) => !BRAIN_KEYS.has(k) || !Object.hasOwn(profile, k))
  ) refuse("snapshot_brain_approval_invalid");
  const known = Object.keys(profile).filter((k) => BRAIN_KEYS.has(k));
  if (known.some((k) => !sections.includes(k))) {
    refuse("snapshot_brain_instruction_omitted");
  }
  if (!sections.includes("company")) refuse("snapshot_brain_identity_missing");
  const projected = Object.fromEntries(
    [...sections].sort().map((k) => [k, profile[k]]),
  );
  safeProfile(projected);
  const approved_profile = boundedJson(projected, 16000);
  const brain = buildCanonicalCompanyBrain(
    scope.workspace_id,
    approved_profile,
  );
  if (brain.normalized.is_draft) refuse("snapshot_brain_draft_not_approved");
  return boundedJson({
    version: "pilot_brain_review_v1",
    workspace_id: scope.workspace_id,
    client_binding_id: scope.client_binding_id,
    source_updated_at: timestamp(row.updated_at)!,
    approved_sections: [...sections].sort(),
    omitted_fields: Object.keys(profile).filter((k) => !sections.includes(k))
      .sort(),
    approved_profile,
    compiled_context: brain,
    seller_context: buildSellerContext(approved_profile),
    content_role: "reviewed_client_instructions_not_verified_buyer_facts",
  }, 64000) as BrainReview;
}
export interface SnapshotApproval {
  version: "pilot_context_v1" | "pilot_context_v2";
  brain_hash: string;
  inputs_hash: string;
  approved_sections: string[];
  as_of: string;
}
function approvalOf(v: unknown): SnapshotApproval {
  const a = object(v);
  exactKeys(a, [
    "version",
    "brain_hash",
    "inputs_hash",
    "approved_sections",
    "as_of",
  ]);
  if (
    (a.version !== "pilot_context_v1" && a.version !== "pilot_context_v2") ||
    ![a.brain_hash, a.inputs_hash].every((h) =>
      typeof h === "string" && /^[a-f0-9]{64}$/.test(h)
    ) || !Array.isArray(a.approved_sections) ||
    a.approved_sections.some((k) => typeof k !== "string")
  ) refuse("snapshot_approval_invalid");
  timestamp(a.as_of);
  return a as unknown as SnapshotApproval;
}
export interface FrozenPilotPacket extends PacketScope {
  version: "pilot_context_packet_v1" | "pilot_context_packet_v2";
  actor_id: string;
  binding_hash: string;
  enrollment_hash: string;
  approval: SnapshotApproval;
  brain: BrainReview;
  evidence: Awaited<ReturnType<typeof buildEvidencePacket>>;
  capabilities: {
    research: false;
    models: false;
    external_api: false;
    send: false;
    qualification: false;
  };
  packet_hash: string;
}
export interface SnapshotDeps {
  mode: "offline_fixture";
  env: EnvRead;
  user_id: string;
  scopeStore: PilotScopeStore;
  snapshots: PilotSnapshotStore;
  loadApprovedInputs: (scope: PacketScope) => Promise<unknown>;
}
const taskBinding = (t: Row) => ({
  id: t.id,
  workspace_id: t.workspace_id,
  user_id: t.user_id,
  payload: t.payload,
});
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
async function materialize(
  scope: PacketScope,
  actor: string,
  binding_hash: string,
  enrollment_hash: string,
  approval: SnapshotApproval,
  brain: BrainReview,
  inputs: ApprovedPacketInputs,
  sellerDomain: string,
): Promise<FrozenPilotPacket> {
  if (
    brain.version !== "pilot_brain_review_v1" ||
    brain.workspace_id !== scope.workspace_id ||
    brain.client_binding_id !== scope.client_binding_id ||
    brain.compiled_context.workspace_id !== scope.workspace_id ||
    brain.compiled_context.compiled.workspace_id !== scope.workspace_id ||
    brain.content_role !==
      "reviewed_client_instructions_not_verified_buyer_facts"
  ) refuse("snapshot_stored_brain_invalid");
  if (
    await digest(brain) !== approval.brain_hash ||
    canonical(brain.approved_sections) !==
      canonical([...approval.approved_sections].sort())
  ) refuse("snapshot_approved_brain_changed");
  const seller = resolveCanonicalSellerIdentity({
    profile: brain.approved_profile,
  });
  if (isSellerIdentityBlocked(seller) || seller.domain !== sellerDomain) {
    refuse("snapshot_stored_client_identity_mismatch");
  }
  const normalized = await validateInputs(inputs, scope, approval.as_of);
  if (await digest(normalized) !== approval.inputs_hash) {
    refuse("snapshot_approved_inputs_changed");
  }
  const evidence = await buildEvidencePacket(
    scope,
    normalized,
    approval.as_of,
    sellerDomain,
    approval.version === "pilot_context_v2" ? "canonical_v2" : "insertion_v1",
  );
  const packet = boundedJson({
    ...scope,
    version: approval.version === "pilot_context_v2"
      ? "pilot_context_packet_v2" as const
      : "pilot_context_packet_v1" as const,
    actor_id: actor,
    binding_hash,
    enrollment_hash,
    approval,
    brain,
    evidence,
    capabilities: {
      research: false as const,
      models: false as const,
      external_api: false as const,
      send: false as const,
      qualification: false as const,
    },
  }, 256000);
  return { ...packet, packet_hash: await digest(packet) };
}
export async function freezePilotContext(
  scope: PacketScope,
  deps: SnapshotDeps,
): Promise<FrozenPilotPacket> {
  if (deps.mode !== "offline_fixture") refuse("pilot_snapshot_disabled");
  if (
    Object.keys(scope).sort().join(",") !==
      "client_binding_id,task_id,workspace_id" ||
    ![scope.workspace_id, scope.client_binding_id, scope.task_id, deps.user_id]
      .every(validId)
  ) refuse("snapshot_explicit_task_scope_required");
  const enrollment = loadPilotEnrollment(
      deps.env,
      scope.workspace_id,
      scope.client_binding_id,
    ),
    store = deps.scopeStore,
    key = pilotSigningKey(deps.env);
  await PilotAccess.forUser(store, enrollment, deps.user_id);
  const rows = await store.records(scope.workspace_id, "task", [scope.task_id]);
  if (rows.length !== 1 || rows[0].status !== "ready") {
    refuse("snapshot_task_not_ready");
  }
  const task = structuredClone(rows[0]);
  const snapshotStore = {
    ...store,
    records: async (
      w: string,
      k: Parameters<PilotScopeStore["records"]>[1],
      ids: readonly string[],
    ) =>
      w === scope.workspace_id && k === "task" && ids.length === 1 &&
        ids[0] === scope.task_id
        ? [task]
        : await store.records(w, k, ids),
  };
  await PilotAccess.forTask(
    snapshotStore,
    enrollment,
    scope.task_id,
    key,
    deps.user_id,
  );
  const approval = approvalOf(object(task.payload).pilot_context);
  const binding_hash = await digest(taskBinding(task)),
    enrollment_hash = await digest(enrollment);
  const check = async () => {
    if (
      canonical(
        loadPilotEnrollment(
          deps.env,
          scope.workspace_id,
          scope.client_binding_id,
        ),
      ) !== canonical(enrollment)
    ) refuse("snapshot_enrollment_changed");
    await PilotAccess.forTask(
      store,
      enrollment,
      scope.task_id,
      key,
      deps.user_id,
    );
    const now = await store.records(scope.workspace_id, "task", [
      scope.task_id,
    ]);
    if (
      now.length !== 1 || now[0].status !== "ready" ||
      await digest(taskBinding(now[0])) !== binding_hash
    ) refuse("snapshot_task_changed");
  };
  await check();
  const saved = await deps.snapshots.read(scope);
  if (saved) {
    if (
      saved.version !==
        (approval.version === "pilot_context_v2"
          ? "pilot_context_packet_v2"
          : "pilot_context_packet_v1") ||
      saved.workspace_id !== scope.workspace_id ||
      saved.client_binding_id !== scope.client_binding_id ||
      saved.task_id !== scope.task_id || saved.actor_id !== deps.user_id ||
      saved.binding_hash !== binding_hash ||
      saved.enrollment_hash !== enrollment_hash ||
      canonical(saved.approval) !== canonical(approval)
    ) refuse("snapshot_stored_scope_mismatch");
    // Reuse frozen raw+compiled Brain. Never compile or substitute today's Brain on resume.
    const expected = await materialize(
      scope,
      deps.user_id,
      binding_hash,
      enrollment_hash,
      approval,
      saved.brain,
      saved.evidence.source_snapshot,
      enrollment.seller_domain,
    );
    if (canonical(saved) !== canonical(expected)) {
      refuse("snapshot_stored_integrity_failure");
    }
    await check();
    return freeze(structuredClone(expected));
  }
  const row = await store.brain(scope.workspace_id);
  if (!row) refuse("snapshot_brain_missing");
  const brain = reviewBrainSnapshot(scope, row, approval.approved_sections);
  const inputs = await validateInputs(
    await deps.loadApprovedInputs(scope),
    scope,
    approval.as_of,
  );
  const packet = await materialize(
    scope,
    deps.user_id,
    binding_hash,
    enrollment_hash,
    approval,
    brain,
    inputs,
    enrollment.seller_domain,
  );
  await check();
  const inserted = await deps.snapshots.insertOnce(packet, {
    ...scope,
    actor_id: deps.user_id,
    binding_hash,
    enrollment_hash,
    brain_hash: approval.brain_hash,
    inputs_hash: approval.inputs_hash,
  });
  if (canonical(inserted) !== canonical(packet)) {
    refuse("snapshot_commit_mismatch");
  }
  await check();
  return freeze(structuredClone(packet));
}
