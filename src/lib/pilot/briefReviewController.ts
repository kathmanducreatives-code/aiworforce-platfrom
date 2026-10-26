import { type CallBriefScope, callBriefView } from "./callBriefView";
import { reviewedBriefCsv } from "./reviewedBriefCsv";
const row = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw Error("Invalid review response");
  }
  return v as Record<string, unknown>;
};
export interface ReviewChoice {
  schema_version: "call_brief_v1";
  company_overview: string[];
  business_context: string[];
  signal_evidence: string[];
  talking_points: { fact_id: string; brain_id: string }[];
  discovery_questions: {
    kind: string;
    fact_id: string | null;
    brain_id: string | null;
  }[];
  missing_information: string[];
}
export interface ReviewerNote {
  text: string;
  fact_ids: string[];
  classification: "human_supplied_unverified";
}
export interface ReviewView {
  version: "pilot_review_view_v1";
  workspace_id: string;
  client_binding_id: string;
  task_id: string;
  root_draft: Record<string, unknown>;
  revision: {
    hash: string;
    number: number;
    choice: ReviewChoice;
    notes: ReviewerNote[];
    content: unknown;
  };
  status:
    | "unreviewed"
    | "approved_for_manual_csv"
    | "rejected"
    | "approval_expired";
  head_hash: string | null;
  approval: {
    event_hash: string;
    revision_hash: string;
    actor_id: string;
    at: string;
    expires_at: string;
  } | null;
}
export interface ReviewService {
  inspect: (scope: CallBriefScope) => Promise<unknown>;
  review: (
    scope: CallBriefScope,
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  prepare: (
    scope: { workspace_id: string; client_binding_id: string },
    request: Record<string, unknown>,
  ) => Promise<unknown>;
}
function validateView(raw: unknown, s: CallBriefScope): ReviewView {
  const v = row(raw), root = row(v.root_draft), rev = row(v.revision);
  if (
    v.version !== "pilot_review_view_v1" || v.workspace_id !== s.workspace_id ||
    v.client_binding_id !== s.client_binding_id || v.task_id !== s.task_id ||
    !/^[a-f0-9]{64}$/.test(String(rev.hash)) ||
    !Number.isSafeInteger(rev.number) || !Array.isArray(rev.notes) ||
    !["unreviewed", "approved_for_manual_csv", "rejected", "approval_expired"]
      .includes(String(v.status))
  ) throw Error("Review scope/version mismatch");
  callBriefView({ ...root, content: rev.content }, s);
  for (const n of rev.notes) {
    const note = row(n);
    if (
      note.classification !== "human_supplied_unverified" ||
      typeof note.text !== "string" || note.text.length > 1000
    ) throw Error("Invalid reviewer note");
  }
  if (v.approval !== null) {
    const a = row(v.approval);
    if (
      a.revision_hash !== rev.hash || typeof a.event_hash !== "string" ||
      a.actor_id !== root.actor_id
    ) throw Error("Review approval mismatch");
  }
  return structuredClone(v) as unknown as ReviewView;
}
// One controller per selected task/client. No local approval boolean, storage cache or implicit retry.
export class BriefReviewController {
  readonly instance_id = crypto.randomUUID();
  readonly scope: CallBriefScope;
  view: ReviewView | null = null;
  pending: Record<string, unknown> | null = null;
  private pendingExport: {
    request: Record<string, unknown>;
    items: {
      task_id: string;
      expected_head: string | null;
      revision_hash: string;
      approval_hash: string;
    }[];
    actor_id: string;
  } | null = null;
  private generation = 0;
  private disposed = false;
  constructor(scope: CallBriefScope, private service: ReviewService) {
    this.scope = Object.freeze({ ...scope });
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.view = null;
    this.pending = null;
    this.pendingExport = null;
  }
  private current(epoch: number) {
    if (this.disposed || epoch !== this.generation) {
      throw Error("Review response is stale");
    }
  }
  async inspect() {
    const epoch = ++this.generation;
    this.pending = null;
    this.pendingExport = null;
    const result = await this.service.inspect(this.scope);
    this.current(epoch);
    return this.view = validateView(result, this.scope);
  }
  private async submit(request: Record<string, unknown>) {
    const epoch = ++this.generation;
    this.pending = structuredClone(request);
    const result = await this.service.review(
      this.scope,
      structuredClone(request),
    );
    this.current(epoch);
    this.view = validateView(result, this.scope);
    this.pending = null;
    this.pendingExport = null;
    return this.view;
  }
  private request(action: string) {
    if (!this.view) throw Error("Load a server review first");
    return {
      action,
      operation_id: crypto.randomUUID(),
      expected_head: this.view.head_hash,
      expected_revision: this.view.revision.hash,
    };
  }
  edit(choice: ReviewChoice, notes: ReviewerNote[]) {
    return this.submit({
      ...this.request("edit"),
      choice: structuredClone(choice),
      notes: structuredClone(notes),
    });
  }
  approve(acknowledge: boolean) {
    if (!acknowledge) {
      throw Error("Acknowledge unverified information before review approval");
    }
    return this.submit({
      ...this.request("approve"),
      acknowledge_unverified: true,
    });
  }
  reject(reason: string) {
    return this.submit({ ...this.request("reject"), reason });
  }
  retry() {
    if (!this.pending) throw Error("No uncertain review request");
    return this.submit(structuredClone(this.pending));
  }
  async exportCsv() {
    const v = this.view;
    if (!v || v.status !== "approved_for_manual_csv" || !v.approval) {
      throw Error("Server approval required");
    }
    const epoch = ++this.generation,
      items = [{
        task_id: this.scope.task_id,
        expected_head: v.head_hash,
        revision_hash: v.revision.hash,
        approval_hash: v.approval.event_hash,
      }],
      request = { operation_id: crypto.randomUUID(), items };
    if (
      this.pendingExport &&
      (this.pendingExport.items[0].revision_hash !== v.revision.hash ||
        this.pendingExport.items[0].approval_hash !== v.approval.event_hash)
    ) throw Error("Export version changed; reload server review");
    if (!this.pendingExport) {
      this.pendingExport = {
        request,
        items,
        actor_id: String(v.root_draft.actor_id),
      };
    }
    const pending = this.pendingExport;
    // UI approval merely selects expected versions. Server reauthorizes and reads its own history.
    const result = await this.service.prepare({
      workspace_id: this.scope.workspace_id,
      client_binding_id: this.scope.client_binding_id,
    }, structuredClone(pending.request));
    this.current(epoch);
    const out = await reviewedBriefCsv(result, {
      workspace_id: this.scope.workspace_id,
      client_binding_id: this.scope.client_binding_id,
      actor_id: pending.actor_id,
    }, pending.items);
    this.current(epoch);
    // Repeat explicit downloads reuse this exact operation; the server still reauthorizes
    // every request. Inspect/edit/approval changes clear it; no CSV bytes are cached.
    return out;
  }
}
