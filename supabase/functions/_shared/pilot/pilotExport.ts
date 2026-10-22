import { canonical, digest } from "./pilotScope.ts";
import { object, validId } from "./pilotPolicy.ts";
import { exactKeys, refuse } from "./pilotCompanyResearch.ts";
import {
  assertReceipt,
  expectedReceipt,
  hash64,
  loadReview,
  makeReviewEvent,
  operationScope,
  type PilotReviewDeps,
  type ReviewContext,
  reviewContext,
  type ReviewState,
  reviewState,
  reviewTime,
} from "./pilotReview.ts";
import type { ExportManifest, ReviewEvent } from "./pilotExportStore.ts";
export const REVIEW_CSV_HEADERS = [
  "workspace_id",
  "client_binding_id",
  "task_id",
  "apollo_account_id",
  "apollo_contact_id",
  "root_draft_hash",
  "revision_hash",
  "packet_hash",
  "brain_hash",
  "inputs_hash",
  "approval_hash",
  "reviewed_by",
  "reviewed_at",
  "review_expires_at",
  "approval_provenance_json",
  "model_provider",
  "actual_model",
  "model_attempt_id",
  "classification",
  "company_name_supplied_unverified",
  "supplied_facts_unverified_json",
  "signal_excerpts_unverified_json",
  "talking_points_hypotheses_json",
  "questions_json",
  "missing_information_json",
  "human_notes_unverified_json",
  "do_not_claim_json",
  "source_references_json",
  "source_lineage_json",
  "reviewed_client_context_json",
] as const;
// RFC4180 quoting is separate from formula protection. Never strip or normalize factual text.
export function csvCell(value: string): { encoded: string; escaped: boolean } {
  if (
    value.length > 100000 || [...value].some((c) => {
      const n = c.codePointAt(0)!;
      return n === 0 || n === 0x7f || n === 0xfffd ||
        n >= 0xd800 && n <= 0xdfff || n < 32 && ![9, 10, 13].includes(n) ||
        n >= 0x202a && n <= 0x202e || n >= 0x2066 && n <= 0x2069;
    })
  ) refuse("export_unsafe_characters");
  const probe = value.normalize("NFKC").replace(/^[\s\p{Cf}]+/u, "");
  const escaped = /^[=+\-@]/.test(probe), safe = escaped ? `'${value}` : value;
  return { encoded: `"${safe.replace(/"/g, '""')}"`, escaped };
}
export interface ExportItem {
  task_id: string;
  expected_head: string | null;
  revision_hash: string;
  approval_hash: string;
}
export interface PrepareReviewExport {
  operation_id: string;
  items: ExportItem[];
}
function approved(
  c: ReviewContext,
  s: ReviewState,
  i: ExportItem,
  head: boolean,
) {
  if (
    s.status !== "approved_for_manual_csv" || !s.approval ||
    s.revision.hash !== i.revision_hash ||
    s.approval.revision_hash !== i.revision_hash ||
    s.approval.event_hash !== i.approval_hash ||
    (head && s.head_hash !== i.expected_head)
  ) refuse("export_stale_or_unapproved");
  if (!c.policy.export_enabled) refuse("pilot_export_disabled");
}
function renderRows(contexts: ReviewContext[], states: ReviewState[]) {
  const rows = contexts.map((c, n) => {
    const s = states[n],
      d = c.draft,
      r = s.revision,
      content = r.content,
      a = s.approval!;
    const facts = new Map<string, typeof content.company_overview[number]>();
    for (
      const f of [
        ...content.company_overview,
        ...content.signal_evidence_for_human_review,
        ...content.talking_points.map((t) => t.buyer_context),
        ...content.discovery_questions.flatMap((q) =>
          q.buyer_premise ? [q.buyer_premise] : []
        ),
      ]
    ) facts.set(f.id, f);
    const company =
      c.packet.evidence.source_snapshot.csv.normalized.company_name;
    return [
      c.scope.workspace_id,
      c.scope.client_binding_id,
      c.scope.task_id,
      d.source_lineage.apollo_account_id ?? "",
      d.source_lineage.apollo_contact_id ?? "",
      d.draft_hash,
      r.hash,
      d.packet_hash,
      d.brain_hash,
      d.inputs_hash,
      a.event_hash,
      a.actor_id,
      a.at,
      a.expires_at,
      canonical(s.events.find((e) => e.event_hash === a.event_hash)),
      d.model_receipt.actual_provider!,
      d.model_receipt.actual_model!,
      d.model_receipt.attempt_id,
      "SUPPLIED_UNVERIFIED; human approval is not fact verification",
      company,
      canonical([...facts.values()]),
      canonical(content.signal_evidence_for_human_review),
      canonical(content.talking_points),
      canonical(content.discovery_questions),
      canonical(content.missing_information),
      canonical({
        classification: "human_supplied_unverified",
        editor_id: r.editor_id,
        edited_at: r.edited_at,
        revision_hash: r.hash,
        notes: r.notes,
      }),
      canonical(content.do_not_claim),
      canonical({
        fact_references: [...facts.values()].map((f) => ({
          id: f.id,
          company_key: f.company_key,
          source_id: f.source_id,
          location: f.location,
          source: f.source,
          collected_at: f.collected_at,
          event_at: f.event_at,
          integrity: f.integrity,
          semantic_support: f.semantic_support,
        })),
        source_snapshots: content.source_snapshots_for_review,
      }),
      canonical(d.source_lineage),
      canonical(content.reviewed_client_instructions),
    ];
  });
  if (rows.some((cells) => cells.length !== REVIEW_CSV_HEADERS.length)) {
    refuse("export_header_contract_invalid");
  }
  const escaped_cells: { row: number; column: string }[] = [];
  const lines = [
    REVIEW_CSV_HEADERS.map((h) => csvCell(h).encoded).join(","),
    ...rows.map((cells, index) =>
      cells.map((value, column) => {
        const cell = csvCell(value);
        if (cell.escaped) {
          escaped_cells.push({
            row: index + 2,
            column: REVIEW_CSV_HEADERS[column],
          });
        }
        return cell.encoded;
      }).join(",")
    ),
  ];
  const csv = lines.join("\r\n") + "\r\n",
    byte_length = new TextEncoder().encode(csv).length;
  if (byte_length > 250000) refuse("export_byte_limit");
  return { csv, byte_length, escaped_cells };
}
export async function prepareReviewCsv(
  scope: { workspace_id: string; client_binding_id: string },
  raw: PrepareReviewExport,
  deps: PilotReviewDeps,
) {
  if (deps.mode !== "offline_fixture") refuse("pilot_export_disabled");
  exactKeys(object(scope), ["workspace_id", "client_binding_id"]);
  if (!validId(scope.workspace_id) || !validId(scope.client_binding_id)) {
    refuse("export_explicit_scope_required");
  }
  const r = object(raw);
  exactKeys(r, ["operation_id", "items"]);
  if (
    !validId(r.operation_id) || !Array.isArray(r.items) || r.items.length < 1 ||
    r.items.length > 5
  ) refuse("export_request_invalid");
  const items = r.items.map((v) => {
    const i = object(v);
    exactKeys(i, [
      "task_id",
      "expected_head",
      "revision_hash",
      "approval_hash",
    ]);
    if (
      !validId(i.task_id) || !hash64(i.revision_hash) ||
      !hash64(i.approval_hash) ||
      (i.expected_head !== null && !hash64(i.expected_head))
    ) refuse("export_item_invalid");
    return i as unknown as ExportItem;
  });
  if (new Set(items.map((i) => i.task_id)).size !== items.length) {
    refuse("export_duplicate_task");
  }
  // No client CSV/body/approved flag is accepted. Every row is reconstructed from authorized snapshots/history.
  const contexts = await Promise.all(
    items.map((i) => reviewContext({ ...scope, task_id: i.task_id }, deps)),
  );
  if (
    contexts.some((c) =>
      c.policy.max_export_rows < items.length ||
      c.fence.review_policy_hash !== contexts[0].fence.review_policy_hash
    )
  ) refuse("export_batch_policy_refused");
  const states = await Promise.all(contexts.map((c) => loadReview(c, deps)));
  states.forEach((s, i) => approved(contexts[i], s, items[i], false));
  await Promise.all(contexts.map((c) => c.destination()));
  const operation = operationScope(contexts[0], r.operation_id as string),
    request_hash = await digest({
      scope,
      actor_id: deps.user_id,
      fences: contexts.map((c) => c.fence),
      request: r,
    });
  const prior = await deps.events.operation(operation);
  if (prior && (prior.request_hash !== request_hash || !prior.manifest)) {
    refuse("export_operation_conflict");
  }
  if (!prior) {
    states.forEach((s, i) => approved(contexts[i], s, items[i], true));
  }
  const rendered = renderRows(contexts, states),
    prepared_at = prior?.manifest?.prepared_at ?? reviewTime(deps);
  const bytes = new TextEncoder().encode(rendered.csv),
    sum = await crypto.subtle.digest("SHA-256", bytes),
    file_hash = [...new Uint8Array(sum)].map((v) =>
      v.toString(16).padStart(2, "0")
    ).join("");
  let manifest: ExportManifest = {
    ...operation,
    version: "pilot_manual_csv_v1",
    destination_id: contexts[0].policy.destination_id,
    prepared_at,
    status: "prepared_for_manual_download",
    file_name: `outpost-reviewed-${file_hash.slice(0, 16)}.csv`,
    mime_type: "text/csv;charset=utf-8",
    file_hash,
    byte_length: rendered.byte_length,
    rows: contexts.map((c, i) => ({
      task_id: c.scope.task_id,
      revision_hash: states[i].revision.hash,
      approval_hash: states[i].approval!.event_hash,
      root_draft_hash: c.fence.root_draft_hash,
      packet_hash: c.fence.packet_hash,
    })),
    escaped_cells: rendered.escaped_cells,
    dispatch_allowed: false,
    remote_update_performed: false,
  };
  let events: ReviewEvent[];
  if (prior) {
    events = states.map((s) => {
      const e = s.events.find((e) => e.operation_id === operation.operation_id);
      if (
        !e || e.request_hash !== request_hash ||
        e.data.kind !== "export_prepared" ||
        canonical(e.data.manifest) !== canonical(manifest)
      ) refuse("export_replay_invalid");
      return e;
    });
    assertReceipt(
      prior,
      expectedReceipt(operation, request_hash, events, manifest),
    );
  } else {
    events = await Promise.all(
      contexts.map((c, i) =>
        makeReviewEvent(
          c,
          states[i],
          operation.operation_id,
          request_hash,
          prepared_at,
          { kind: "export_prepared", manifest },
        )
      ),
    );
    // Validate future history before requesting an atomic append.
    await Promise.all(
      contexts.map((c, i) =>
        reviewState(c, [...states[i].events, events[i]], reviewTime(deps))
      ),
    );
    await Promise.all(contexts.map((c) => c.check()));
    const receipt = await deps.events.commit({
      operation,
      request_hash,
      transitions: contexts.map((c, i) => ({
        fence: c.fence,
        expected_head: states[i].head_hash,
        event: events[i],
      })),
      manifest,
    });
    // Identical concurrent requests share the first durable preparation timestamp.
    if (
      !receipt.manifest ||
      canonical({ ...receipt.manifest, prepared_at: manifest.prepared_at }) !==
        canonical(manifest)
    ) refuse("export_commit_manifest_mismatch");
    manifest = receipt.manifest;
    const committedStates = await Promise.all(
      contexts.map((c) => loadReview(c, deps)),
    );
    events = committedStates.map((s) => {
      const e = s.events.find((e) =>
        e.operation_id === operation.operation_id &&
        e.request_hash === request_hash
      );
      if (
        !e || e.data.kind !== "export_prepared" ||
        canonical(e.data.manifest) !== canonical(manifest)
      ) refuse("export_commit_missing");
      return e;
    });
    assertReceipt(
      receipt,
      expectedReceipt(operation, request_hash, events, manifest),
    );
  }
  // No bytes released if authorization/version/approval changed before return, even after commit.
  await Promise.all(contexts.map(async (c, i) => {
    await c.check();
    const latest = await loadReview(c, deps);
    approved(c, latest, items[i], false);
    if (!latest.events.some((e) => e.event_hash === events[i].event_hash)) {
      refuse("export_commit_missing");
    }
  }));
  return { manifest, csv: rendered.csv };
}
