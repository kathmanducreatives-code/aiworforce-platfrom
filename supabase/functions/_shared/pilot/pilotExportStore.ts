// Interface only. Native append-only RLS, atomic CAS/authorization and operation uniqueness are gates.
import type { PacketScope } from "./pilotEvidencePacket.ts";
import type { BriefChoice } from "./callBriefContract.ts";
export interface HumanReviewNote {
  text: string;
  fact_ids: string[];
  classification: "human_supplied_unverified";
}
export interface ExportManifest {
  version: "pilot_manual_csv_v1";
  workspace_id: string;
  client_binding_id: string;
  actor_id: string;
  operation_id: string;
  destination_id: string;
  prepared_at: string;
  status: "prepared_for_manual_download";
  file_name: string;
  mime_type: "text/csv;charset=utf-8";
  file_hash: string;
  byte_length: number;
  rows: {
    task_id: string;
    revision_hash: string;
    approval_hash: string;
    root_draft_hash: string;
    packet_hash: string;
  }[];
  escaped_cells: { row: number; column: string }[];
  dispatch_allowed: false;
  remote_update_performed: false;
}
export type ReviewEventData =
  | { kind: "edit"; choice: BriefChoice; notes: HumanReviewNote[] }
  | { kind: "approve"; acknowledge_unverified: true }
  | { kind: "reject"; reason: string }
  | { kind: "export_prepared"; manifest: ExportManifest };
export interface ReviewFence extends PacketScope {
  actor_id: string;
  root_draft_hash: string;
  packet_hash: string;
  brain_hash: string;
  inputs_hash: string;
  task_binding_hash: string;
  model_policy_hash: string;
  model_receipt_hash: string;
  review_policy_hash: string;
}
export interface ReviewEvent extends ReviewFence {
  sequence: number;
  previous_hash: string | null;
  operation_id: string;
  request_hash: string;
  at: string;
  revision_hash: string;
  data: ReviewEventData;
  event_hash: string;
}
export interface ReviewOperation {
  workspace_id: string;
  client_binding_id: string;
  actor_id: string;
  operation_id: string;
}
export interface ReviewReceipt extends ReviewOperation {
  request_hash: string;
  event_hashes: { task_id: string; event_hash: string }[];
  manifest: ExportManifest | null;
}
export interface ReviewCommit {
  operation: ReviewOperation;
  request_hash: string;
  transitions: {
    fence: ReviewFence;
    expected_head: string | null;
    event: ReviewEvent;
  }[];
  manifest: ExportManifest | null;
}
export interface PilotExportStore {
  history(scope: PacketScope): Promise<ReviewEvent[]>;
  operation(scope: ReviewOperation): Promise<ReviewReceipt | null>;
  // One atomic transaction across ALL transitions. Same operation + exact input is idempotent;
  // any differing input/head/scope/authorization refuses the whole batch. No partial artifacts.
  // Native writer rechecks current task/snapshot/policy/actor and latest head; browser flags are irrelevant.
  commit(input: ReviewCommit): Promise<ReviewReceipt>;
}
