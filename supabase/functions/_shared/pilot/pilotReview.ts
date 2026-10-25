import {
  type CallBriefReadDeps,
  readCallBriefForReview,
} from "./callBriefRunner.ts";
import { renderCallBrief, validateBriefChoice } from "./callBriefValidator.ts";
import { canonical, digest, PilotAccess } from "./pilotScope.ts";
import {
  loadPilotEnrollment,
  object,
  pilotSigningKey,
  validId,
} from "./pilotPolicy.ts";
import { createPilotScopeStore } from "./pilotScopeStore.ts";
import {
  boundedJson,
  exactKeys,
  refuse,
  text,
  timestamp,
} from "./pilotCompanyResearch.ts";
import { reviewPolicy } from "./pilotReviewPolicy.ts";
import type { PacketScope } from "./pilotEvidencePacket.ts";
import type { BriefChoice } from "./callBriefContract.ts";
import type {
  HumanReviewNote,
  PilotExportStore,
  ReviewEvent,
  ReviewEventData,
  ReviewFence,
  ReviewOperation,
  ReviewReceipt,
} from "./pilotExportStore.ts";
export interface PilotReviewDeps extends CallBriefReadDeps {
  events: PilotExportStore;
  loadReviewPolicy: (workspace: string, client: string) => Promise<unknown>;
  now: () => string; // trusted injected clock, never supplied by the browser
}
export const hash64 = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function reviewTime(deps: PilotReviewDeps) {
  return new Date(timestamp(deps.now())!).toISOString();
}
function immutable<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v).forEach(immutable);
    Object.freeze(v);
  }
  return v;
}
export async function reviewContext(scope: PacketScope, deps: PilotReviewDeps) {
  if (deps.mode !== "offline_fixture") refuse("pilot_review_disabled");
  const source = await readCallBriefForReview(scope, deps),
    policy = reviewPolicy(
      await deps.loadReviewPolicy(scope.workspace_id, scope.client_binding_id),
      scope.workspace_id,
      scope.client_binding_id,
    );
  const fence: ReviewFence = {
    ...scope,
    actor_id: deps.user_id,
    root_draft_hash: source.draft.draft_hash,
    packet_hash: source.packet.packet_hash,
    brain_hash: source.draft.brain_hash,
    inputs_hash: source.draft.inputs_hash,
    task_binding_hash: source.draft.binding_hash,
    model_policy_hash: source.draft.policy_hash,
    model_receipt_hash: await digest(source.draft.model_receipt),
    review_policy_hash: await digest(policy),
  };
  const check = async () => {
    const current = await readCallBriefForReview(scope, deps);
    if (
      current.draft.draft_hash !== fence.root_draft_hash ||
      await digest(
          reviewPolicy(
            await deps.loadReviewPolicy(
              scope.workspace_id,
              scope.client_binding_id,
            ),
            scope.workspace_id,
            scope.client_binding_id,
          ),
        ) !== fence.review_policy_hash
    ) refuse("review_context_changed");
  };
  const destination = async () => {
    const e = loadPilotEnrollment(
        deps.env,
        scope.workspace_id,
        scope.client_binding_id,
      ),
      s = deps.store?.() ?? createPilotScopeStore(deps);
    const a = await PilotAccess.forTask(
      s,
      e,
      scope.task_id,
      pilotSigningKey(deps.env),
      deps.user_id,
    );
    return await a.destination(policy.destination_id);
  };
  return { ...source, scope, policy, fence, check, destination };
}
export type ReviewContext = Awaited<ReturnType<typeof reviewContext>>;
export interface ReviewRevision {
  number: number;
  hash: string;
  parent_hash: string | null;
  choice: BriefChoice;
  notes: HumanReviewNote[];
  editor_id: string | null;
  edited_at: string | null;
  content: ReturnType<typeof renderCallBrief>;
}
export interface Approval {
  event_hash: string;
  revision_hash: string;
  actor_id: string;
  at: string;
  expires_at: string;
}
export interface ReviewState {
  revision: ReviewRevision;
  head_hash: string | null;
  approval: Approval | null;
  status:
    | "unreviewed"
    | "approved_for_manual_csv"
    | "rejected"
    | "approval_expired";
  rejection_reason: string | null;
  events: ReviewEvent[];
}
export function validateNotes(
  raw: unknown,
  c: ReviewContext,
): HumanReviewNote[] {
  if (!Array.isArray(raw) || raw.length > 8) refuse("review_notes_invalid");
  // Facts use P5's immutable IDs, never model-local aliases or a replacement body.
  const known = new Set(c.catalog.facts.map((f) => f.fact.id));
  return raw.map((v) => {
    const n = object(v);
    exactKeys(n, ["text", "fact_ids", "classification"]);
    text(n.text, 1000);
    if (
      n.classification !== "human_supplied_unverified" ||
      !Array.isArray(n.fact_ids) || n.fact_ids.length > 8 ||
      new Set(n.fact_ids).size !== n.fact_ids.length || n.fact_ids.some((id) =>
        typeof id !== "string" || !known.has(id)
      )
    ) refuse("review_note_provenance_invalid");
    return structuredClone(n) as unknown as HumanReviewNote;
  });
}
async function revision(
  c: ReviewContext,
  number: number,
  parent_hash: string | null,
  choice: unknown,
  notes: unknown,
  editor_id: string | null,
  edited_at: string | null,
): Promise<ReviewRevision> {
  const normalized = validateBriefChoice(choice, c.catalog),
    accepted = validateNotes(notes, c);
  const data = {
    ...c.fence,
    version: "pilot_review_revision_v1",
    number,
    parent_hash,
    choice: normalized,
    notes: accepted,
    editor_id,
    edited_at,
  };
  return {
    number,
    parent_hash,
    choice: normalized,
    notes: accepted,
    editor_id,
    edited_at,
    content: renderCallBrief(normalized, c.catalog),
    hash: await digest(data),
  };
}
export async function reviewState(
  c: ReviewContext,
  events: ReviewEvent[],
  now: string,
): Promise<ReviewState> {
  if (!Array.isArray(events) || events.length > 64) {
    refuse("review_history_limit");
  }
  let current = await revision(c, 0, null, c.draft.choice, [], null, null),
    head: string | null = null,
    approval: Approval | null = null,
    status: ReviewState["status"] = "unreviewed",
    reason: string | null = null,
    previousTime = -Infinity;
  const operations = new Set<string>();
  for (const e of events) {
    exactKeys(object(e), [
      ...Object.keys(c.fence),
      "sequence",
      "previous_hash",
      "operation_id",
      "request_hash",
      "at",
      "revision_hash",
      "data",
      "event_hash",
    ]);
    if (
      Object.entries(c.fence).some(([k, v]) =>
        (e as unknown as Record<string, unknown>)[k] !== v
      ) || e.sequence !== operations.size + 1 || e.previous_hash !== head ||
      !validId(e.operation_id) || operations.has(e.operation_id) ||
      !hash64(e.request_hash) || !hash64(e.event_hash) ||
      !hash64(e.revision_hash)
    ) refuse("review_history_scope_or_chain_invalid");
    const at = timestamp(e.at)!, time = Date.parse(at);
    if (time < previousTime || time > Date.parse(now)) {
      refuse("review_history_time_invalid");
    }
    previousTime = time;
    const { event_hash, ...unsigned } = e;
    if (await digest(unsigned) !== event_hash) {
      refuse("review_history_integrity_invalid");
    }
    const d = object(e.data);
    if (d.kind === "edit") {
      exactKeys(d, ["kind", "choice", "notes"]);
      current = await revision(
        c,
        current.number + 1,
        current.hash,
        d.choice,
        d.notes,
        e.actor_id,
        at,
      );
      approval = null;
      status = "unreviewed";
      reason = null;
    } else if (d.kind === "approve") {
      exactKeys(d, ["kind", "acknowledge_unverified"]);
      if (d.acknowledge_unverified !== true || status === "rejected") {
        refuse("review_history_approval_invalid");
      }
      approval = {
        event_hash,
        revision_hash: current.hash,
        actor_id: e.actor_id,
        at,
        expires_at: new Date(time + c.policy.approval_ttl_seconds * 1000)
          .toISOString(),
      };
      status = "approved_for_manual_csv";
      reason = null;
    } else if (d.kind === "reject") {
      exactKeys(d, ["kind", "reason"]);
      reason = text(d.reason, 1000);
      approval = null;
      status = "rejected";
    } else if (d.kind === "export_prepared") {
      exactKeys(d, ["kind", "manifest"]);
      const m = object(d.manifest), rows = m.rows;
      exactKeys(m, [
        "version",
        "workspace_id",
        "client_binding_id",
        "actor_id",
        "operation_id",
        "destination_id",
        "prepared_at",
        "status",
        "file_name",
        "mime_type",
        "file_hash",
        "byte_length",
        "rows",
        "escaped_cells",
        "dispatch_allowed",
        "remote_update_performed",
      ]);
      const approvedEventHash = approval?.event_hash;
      if (
        !approval || time >= Date.parse(approval.expires_at) ||
        m.version !== "pilot_manual_csv_v1" ||
        m.workspace_id !== c.scope.workspace_id ||
        m.client_binding_id !== c.scope.client_binding_id ||
        m.actor_id !== c.fence.actor_id || m.operation_id !== e.operation_id ||
        m.prepared_at !== at || m.destination_id !== c.policy.destination_id ||
        m.status !== "prepared_for_manual_download" ||
        m.dispatch_allowed !== false || m.remote_update_performed !== false ||
        !hash64(m.file_hash) || !Array.isArray(rows) || !rows.some((r) =>
          object(r).task_id === c.scope.task_id &&
          object(r).revision_hash === current.hash &&
          object(r).approval_hash === approvedEventHash &&
          object(r).root_draft_hash === c.fence.root_draft_hash &&
          object(r).packet_hash === c.fence.packet_hash
        )
      ) {
        refuse("review_history_export_invalid");
      }
    } else refuse("review_history_kind_invalid");
    if (e.revision_hash !== current.hash) {
      refuse("review_history_revision_invalid");
    }
    operations.add(e.operation_id);
    head = e.event_hash;
  }
  if (approval && Date.parse(now) >= Date.parse(approval.expires_at)) {
    status = "approval_expired";
  }
  return {
    revision: current,
    head_hash: head,
    approval,
    status,
    rejection_reason: reason,
    events,
  };
}
export async function loadReview(c: ReviewContext, deps: PilotReviewDeps) {
  return await reviewState(
    c,
    await deps.events.history(c.scope),
    reviewTime(deps),
  );
}
export async function makeReviewEvent(
  c: ReviewContext,
  state: ReviewState,
  operation_id: string,
  request_hash: string,
  at: string,
  data: ReviewEventData,
): Promise<ReviewEvent> {
  const next = data.kind === "edit"
    ? await revision(
      c,
      state.revision.number + 1,
      state.revision.hash,
      data.choice,
      data.notes,
      c.fence.actor_id,
      at,
    )
    : state.revision;
  const unsigned = {
    ...c.fence,
    sequence: state.events.length + 1,
    previous_hash: state.head_hash,
    operation_id,
    request_hash,
    at,
    revision_hash: next.hash,
    data,
  };
  return { ...unsigned, event_hash: await digest(unsigned) };
}
export function operationScope(
  c: ReviewContext,
  operation_id: string,
): ReviewOperation {
  return {
    workspace_id: c.scope.workspace_id,
    client_binding_id: c.scope.client_binding_id,
    actor_id: c.fence.actor_id,
    operation_id,
  };
}
export function expectedReceipt(
  operation: ReviewOperation,
  request_hash: string,
  events: ReviewEvent[],
  manifest: ReviewReceipt["manifest"],
): ReviewReceipt {
  return {
    ...operation,
    request_hash,
    event_hashes: events.map((e) => ({
      task_id: e.task_id,
      event_hash: e.event_hash,
    })),
    manifest,
  };
}
export function assertReceipt(a: unknown, b: ReviewReceipt) {
  if (canonical(a) !== canonical(b)) refuse("review_commit_receipt_mismatch");
}
export type ReviewRequest =
  | {
    action: "edit";
    operation_id: string;
    expected_head: string | null;
    expected_revision: string;
    choice: BriefChoice;
    notes: HumanReviewNote[];
  }
  | {
    action: "approve";
    operation_id: string;
    expected_head: string | null;
    expected_revision: string;
    acknowledge_unverified: true;
  }
  | {
    action: "reject";
    operation_id: string;
    expected_head: string | null;
    expected_revision: string;
    reason: string;
  };
export async function inspectReview(scope: PacketScope, deps: PilotReviewDeps) {
  const c = await reviewContext(scope, deps), s = await loadReview(c, deps);
  await c.check();
  return immutable({
    version: "pilot_review_view_v1" as const,
    ...scope,
    root_draft: c.draft,
    ...s,
  });
}
export async function reviewBrief(
  scope: PacketScope,
  raw: ReviewRequest,
  deps: PilotReviewDeps,
) {
  const r = boundedJson(object(raw), 12000), action = r.action;
  exactKeys(
    r,
    action === "edit"
      ? [
        "action",
        "operation_id",
        "expected_head",
        "expected_revision",
        "choice",
        "notes",
      ]
      : action === "approve"
      ? [
        "action",
        "operation_id",
        "expected_head",
        "expected_revision",
        "acknowledge_unverified",
      ]
      : [
        "action",
        "operation_id",
        "expected_head",
        "expected_revision",
        "reason",
      ],
  );
  if (
    !["edit", "approve", "reject"].includes(String(action)) ||
    !validId(r.operation_id) || !hash64(r.expected_revision) ||
    (r.expected_head !== null && !hash64(r.expected_head))
  ) refuse("review_request_invalid");
  const c = await reviewContext(scope, deps),
    state = await loadReview(c, deps),
    operation = operationScope(c, r.operation_id as string),
    request_hash = await digest({ fence: c.fence, request: r });
  const prior = await deps.events.operation(operation);
  if (prior) {
    if (
      prior.request_hash !== request_hash || prior.event_hashes.length !== 1 ||
      prior.event_hashes[0].task_id !== scope.task_id || prior.manifest !== null
    ) refuse("review_operation_conflict");
    const e = state.events.find((e) =>
      e.event_hash === prior.event_hashes[0].event_hash
    );
    if (
      !e || e.operation_id !== operation.operation_id ||
      e.request_hash !== request_hash ||
      e.revision_hash !== state.revision.hash ||
      (action === "approve" && state.approval?.event_hash !== e.event_hash) ||
      (action === "reject" && state.status !== "rejected")
    ) refuse("review_operation_stale");
    assertReceipt(prior, expectedReceipt(operation, request_hash, [e], null));
    await c.check();
    return await inspectReview(scope, deps);
  }
  if (
    state.head_hash !== r.expected_head ||
    state.revision.hash !== r.expected_revision
  ) refuse("review_stale_version");
  let data: ReviewEventData;
  if (action === "edit") {
    data = {
      kind: "edit",
      choice: validateBriefChoice(r.choice, c.catalog),
      notes: validateNotes(r.notes, c),
    };
  } else if (action === "approve") {
    if (r.acknowledge_unverified !== true || state.status === "rejected") {
      refuse("review_approval_refused");
    }
    data = { kind: "approve", acknowledge_unverified: true };
  } else data = { kind: "reject", reason: text(r.reason, 1000) };
  const event = await makeReviewEvent(
    c,
    state,
    operation.operation_id,
    request_hash,
    reviewTime(deps),
    data,
  );
  await reviewState(c, [...state.events, event], reviewTime(deps));
  await c.check();
  const receipt = await deps.events.commit({
    operation,
    request_hash,
    transitions: [{ fence: c.fence, expected_head: state.head_hash, event }],
    manifest: null,
  });
  // A concurrent identical operation may have committed with the first server timestamp.
  // Resolve the durable event rather than minting a second revision or trusting a new local timestamp.
  const result = await inspectReview(scope, deps);
  const committed = result.events.find((e) =>
    e.operation_id === operation.operation_id && e.request_hash === request_hash
  );
  if (
    !committed || committed.previous_hash !== state.head_hash ||
    canonical(committed.data) !== canonical(data)
  ) refuse("review_commit_missing");
  assertReceipt(
    receipt,
    expectedReceipt(operation, request_hash, [committed], null),
  );
  if (result.revision.hash !== committed.revision_hash) {
    refuse("review_result_superseded");
  }
  return result;
}
