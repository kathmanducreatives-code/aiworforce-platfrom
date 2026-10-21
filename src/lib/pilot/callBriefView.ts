// Presentation checks only. Authorization, snapshot/receipt validation and hashes belong on server.
export interface CallBriefScope {
  workspace_id: string;
  client_binding_id: string;
  task_id: string;
}
const row = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw Error("Invalid draft");
  }
  return v as Record<string, unknown>;
};
const list = (v: unknown): unknown[] => {
  if (!Array.isArray(v) || v.length > 100) throw Error("Invalid draft list");
  return v;
};
const text = (v: unknown): string => {
  if (typeof v !== "string" || v.length > 16000) {
    throw Error("Invalid draft text");
  }
  return v;
};
const nullable = (v: unknown) => v === null ? null : text(v);
export function callBriefView(raw: unknown, scope: CallBriefScope) {
  if (new TextEncoder().encode(JSON.stringify(raw)).length > 180000) {
    throw Error("Draft too large");
  }
  const scoped = (v: unknown, task = true) => {
    const r = row(v);
    if (
      !scope.workspace_id || !scope.client_binding_id || !scope.task_id ||
      r.workspace_id !== scope.workspace_id ||
      r.client_binding_id !== scope.client_binding_id ||
      task && r.task_id !== scope.task_id
    ) throw Error("Draft scope mismatch");
    return r;
  };
  const d = scoped(raw), c = row(d.content), receipt = scoped(d.model_receipt);
  if (
    d.version !== "pilot_call_brief_draft_v1" ||
    d.review_status !== "unreviewed_draft" || d.review_required !== true ||
    d.dispatch_allowed !== false || c.qualification_decision !== null ||
    c.qualification_evaluated !== false || list(c.verified_facts).length ||
    list(c.grounded_buying_signals).length || receipt.status !== "succeeded" ||
    receipt.finish_reason !== "stop"
  ) throw Error("Unsupported draft");
  const fact = (v: unknown) => {
    const f = scoped(v), source = row(f.source);
    if (
      !["supplied_claim", "conflicting"].includes(text(f.provenance_class)) ||
      f.semantic_support !== "not_evaluated"
    ) throw Error("Unsupported fact");
    return {
      id: text(f.id),
      field: text(f.field),
      value: text(f.value),
      classification: text(f.provenance_class),
      source_id: text(f.source_id),
      url: nullable(source.url),
      collected_at: nullable(f.collected_at),
      event_at: nullable(f.event_at),
      location: JSON.stringify(row(f.location)),
    };
  };
  const brain = (v: unknown) => {
    const b = row(v);
    if (
      b.classification !== "reviewed_client_context" ||
      !["string", "number", "boolean"].includes(typeof b.value)
    ) throw Error("Unsupported client context");
    return { id: text(b.id), path: text(b.path), value: String(b.value) };
  };
  const question = (v: unknown) => {
    const q = row(v);
    if (q.mode !== "question_not_assertion") {
      throw Error("Unsupported question");
    }
    return {
      text: text(q.text),
      buyer: q.buyer_premise === null ? null : fact(q.buyer_premise),
      client: q.client_context === null ? null : brain(q.client_context),
    };
  };
  return {
    source_snapshots: list(c.source_snapshots_for_review).map((v) => {
      const s = scoped(v, false);
      return { id: text(s.id), locator: text(s.locator), body: text(s.body) };
    }),
    hash: text(d.draft_hash),
    packet_hash: text(d.packet_hash),
    company: list(c.company_overview).map(fact),
    context: list(c.relevant_business_context).map(brain),
    instructions: list(c.reviewed_client_instructions).map(brain),
    signals: list(c.signal_evidence_for_human_review).map(fact),
    talking_points: list(c.talking_points).map((v) => {
      const t = row(v);
      if (t.mode !== "plausible_fit_not_buyer_fact") {
        throw Error("Unsupported talking point");
      }
      return {
        buyer: fact(t.buyer_context),
        offer: brain(t.reviewed_offer),
        question: question(t.question),
      };
    }),
    questions: list(c.discovery_questions).map(question),
    unknowns: list(c.missing_information).map((v) => text(row(v).reason)),
    do_not_claim: list(c.do_not_claim).map(text),
    model: text(receipt.actual_model),
    provider: text(receipt.actual_provider),
    source_lineage: JSON.stringify(row(d.source_lineage), null, 2),
  };
}
