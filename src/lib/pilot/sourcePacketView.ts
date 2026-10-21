// Presentation validation only. This is NOT authorization or a signature verifier.
// No backend imports: the disabled UI cannot import an executor or secret resolver.
export interface PacketViewScope {
  workspace_id: string;
  client_binding_id: string;
  task_id: string;
}
const row = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error("Invalid packet");
  }
  return v as Record<string, unknown>;
};
const list = (v: unknown): unknown[] => {
  if (!Array.isArray(v) || v.length > 100) {
    throw new Error("Invalid packet list");
  }
  return v;
};
const text = (v: unknown): string => {
  if (typeof v !== "string" || v.length > 16000) {
    throw new Error("Invalid packet text");
  }
  return v;
};
const nullableText = (v: unknown): string | null => v === null ? null : text(v);
export function sourcePacketView(packet: unknown, scope: PacketViewScope) {
  if (new TextEncoder().encode(JSON.stringify(packet)).length > 256000) {
    throw new Error("Packet too large");
  }
  const scoped = (v: unknown, task = false) => {
    const r = row(v);
    if (
      r.workspace_id !== scope.workspace_id ||
      r.client_binding_id !== scope.client_binding_id ||
      task && r.task_id !== scope.task_id
    ) throw new Error("Packet scope mismatch");
    return r;
  };
  const p = scoped(packet, true), brain = scoped(p.brain), e = row(p.evidence);
  if (
    !scope.workspace_id || !scope.client_binding_id || !scope.task_id ||
    p.version !== "pilot_context_packet_v1" ||
    e.qualification_evaluated !== false || e.canonical_decision !== null ||
    list(e.verified_facts).length ||
    Object.keys(row(p.capabilities)).length !== 5 ||
    ["research", "models", "external_api", "send", "qualification"].some((k) =>
      row(p.capabilities)[k] !== false
    ) ||
    row(brain.compiled_context).workspace_id !== scope.workspace_id ||
    row(row(brain.compiled_context).compiled).workspace_id !==
      scope.workspace_id
  ) throw new Error("Unsupported packet");
  const s = row(e.source_snapshot), csv = scoped(s.csv);
  const sources = list(s.sources).map((v) => {
    const r = scoped(v);
    return {
      id: text(r.id),
      locator: text(r.locator),
      url: nullableText(r.url),
      collected_at: nullableText(r.collected_at),
      event_at: nullableText(r.event_at),
    };
  });
  const sourceIds = new Set(["csv", ...sources.map((s) => s.id)]);
  const facts = list(e.facts).map((v) => {
    const f = scoped(v, true);
    if (
      !sourceIds.has(text(f.source_id)) ||
      !["supplied_claim", "conflicting"].includes(text(f.provenance_class)) ||
      f.semantic_support !== "not_evaluated" ||
      f.integrity !== "exact_field_or_excerpt_match"
    ) throw new Error("Unsupported fact");
    return {
      id: text(f.id),
      field: text(f.field),
      value: text(f.value),
      source_id: text(f.source_id),
      classification: text(f.provenance_class),
      collected_at: nullableText(f.collected_at),
      event_at: nullableText(f.event_at),
    };
  });
  const interpretations = list(e.model_interpretations).map((v) => {
    const i = scoped(v, true);
    if (
      i.provenance_class !== "model_interpretation" ||
      list(i.source_ids).some((id) => !sourceIds.has(text(id)))
    ) throw new Error("Unsupported interpretation");
    return text(i.text);
  });
  return {
    packet_hash: text(p.packet_hash),
    brain_hash: text(row(p.approval).brain_hash),
    brain_updated_at: text(brain.source_updated_at),
    csv_file_hash: text(csv.file_hash),
    csv_rows: list(csv.source_rows).map((n) => {
      if (!Number.isInteger(n)) throw new Error("Invalid row");
      return n as number;
    }),
    apollo_account_id: nullableText(
      row(csv.normalized).apollo_account_id ?? null,
    ),
    apollo_contact_id: nullableText(
      row(csv.normalized).apollo_contact_id ?? null,
    ),
    sources,
    facts,
    interpretations,
    unknowns: list(e.unknowns).map(text),
  };
}
