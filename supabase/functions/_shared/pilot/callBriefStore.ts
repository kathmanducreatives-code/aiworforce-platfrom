// Interface only. Native RLS, ownership, append-only writes and atomic settlement are enablement gates.
import type { PacketScope } from "./pilotEvidencePacket.ts";
import type { PilotModelSelection } from "./pilotTaskModelPolicy.ts";
import type { PilotModelReceipt } from "./pilotTaskStore.ts";
import type { BriefChoice } from "./callBriefContract.ts";
import type { renderCallBrief } from "./callBriefValidator.ts";
export interface BriefFence extends PacketScope {
  actor_id: string;
  packet_hash: string;
  brain_hash: string;
  inputs_hash: string;
  binding_hash: string;
  policy_hash: string;
  request_hash: string;
}
export interface CallBriefDraft extends BriefFence {
  version: "pilot_call_brief_draft_v1";
  selection: PilotModelSelection;
  model_receipt: PilotModelReceipt;
  source_lineage: {
    file_hash: string;
    normalized_hash: string;
    source_rows: number[];
    apollo_account_id: string | null;
    apollo_contact_id: string | null;
    imported_row_id: null;
    source_origin: "declared_unverified_export";
  };
  choice: BriefChoice;
  content: ReturnType<typeof renderCallBrief>;
  review_status: "unreviewed_draft";
  review_required: true;
  dispatch_allowed: false;
  draft_hash: string;
}
export interface CallBriefStore {
  // Must return only this exact task/client's immutable output linked to its settled model receipt.
  read(scope: PacketScope): Promise<CallBriefDraft | null>;
  // Atomic same-task append once; identical returns original, different conflicts. Reauthorize fences.
  // No update/upsert or new operation key on retry. Never imply this performs review/dispatch.
  insertOnce(draft: CallBriefDraft, fence: BriefFence): Promise<CallBriefDraft>;
}
