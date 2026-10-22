import type { EvidenceItem } from "../candidateObservation.ts";
import type { Eligibility } from "../candidateEligibility.ts";
import { object } from "./pilotPolicy.ts";
import { digest } from "./pilotScope.ts";
import { parsePilotCsv } from "./pilotCsv.ts";
import {
  type ImportMapping,
  type NormalizedLead,
  previewCsv,
} from "./pilotImportContract.ts";
import {
  boundedJson,
  companyIdentity,
  exactKeys,
  normalizeSuppliedSource,
  refuse,
  sameSubject,
  subject,
  type SuppliedSource,
  text,
  timestamp,
} from "./pilotCompanyResearch.ts";
export interface PacketScope {
  workspace_id: string;
  client_binding_id: string;
  task_id: string;
}
export interface CsvSnapshot {
  workspace_id: string;
  client_binding_id: string;
  file_hash: string;
  source_rows: number[];
  mapping: Record<string, string>;
  cells: Record<string, string>;
  normalized: NormalizedLead;
  normalized_hash: string;
  collected_at: string | null;
  imported_row_id: null;
  source_kind: "apollo_export_declared_unverified";
}
export async function reviewCsvSnapshot(
  scope: Omit<PacketScope, "task_id">,
  csv: string,
  mapping: ImportMapping,
  selectedHash: string,
  collectedAt: string | null,
): Promise<CsvSnapshot> {
  const p = await previewCsv(csv, mapping),
    parsed = parsePilotCsv(csv),
    row = p.rows.find((r) => r.normalized_hash === selectedHash);
  if (!row) refuse("snapshot_csv_selection_missing");
  const fileBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(csv),
  );
  const file_hash = [...new Uint8Array(fileBytes)].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
  const cells: Record<string, string> = {}, map: Record<string, string> = {};
  parsed.headers.forEach((h, i) => {
    if (mapping[h] !== null) {
      cells[h] = parsed.rows[row.source_rows[0] - 2][i];
      map[h] = mapping[h]!;
    }
  });
  return {
    workspace_id: scope.workspace_id,
    client_binding_id: scope.client_binding_id,
    file_hash,
    source_rows: row.source_rows,
    mapping: map,
    cells,
    normalized: row.normalized,
    normalized_hash: row.normalized_hash,
    collected_at: timestamp(collectedAt, true),
    imported_row_id: null,
    source_kind: "apollo_export_declared_unverified",
  };
}
export interface ApprovedPacketInputs {
  csv: CsvSnapshot;
  sources: SuppliedSource[];
  interpretations: { text: string; source_ids: string[] }[];
  conflicts: { reason: string; source_ids: string[] }[];
}
const hash64 = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const quoted = (s: string) => `"${s.replace(/"/g, '""')}"`;
export async function validateInputs(
  raw: unknown,
  scope: PacketScope,
  asOf: string,
): Promise<ApprovedPacketInputs> {
  timestamp(asOf);
  const input = boundedJson(object(raw), 120000);
  exactKeys(input, ["csv", "sources", "interpretations", "conflicts"]);
  const c = object(input.csv);
  exactKeys(c, [
    "workspace_id",
    "client_binding_id",
    "file_hash",
    "source_rows",
    "mapping",
    "cells",
    "normalized",
    "normalized_hash",
    "collected_at",
    "imported_row_id",
    "source_kind",
  ]);
  if (
    c.workspace_id !== scope.workspace_id ||
    c.client_binding_id !== scope.client_binding_id
  ) refuse("snapshot_csv_scope_mismatch");
  if (
    c.source_kind !== "apollo_export_declared_unverified" ||
    c.imported_row_id !== null || !hash64(c.file_hash) ||
    !hash64(c.normalized_hash)
  ) refuse("snapshot_csv_provenance_invalid");
  if (
    !Array.isArray(c.source_rows) || !c.source_rows.length ||
    c.source_rows.length > 25 ||
    new Set(c.source_rows).size !== c.source_rows.length ||
    c.source_rows.some((v) => !Number.isInteger(v) || v < 2 || v > 26)
  ) refuse("snapshot_csv_rows_invalid");
  const cells = object(c.cells),
    mapping = object(c.mapping),
    headers = Object.keys(cells);
  const csv = [
    headers.map(quoted).join(","),
    headers.map((h) =>
      quoted(
        typeof cells[h] === "string"
          ? cells[h] as string
          : refuse("snapshot_csv_cell_invalid"),
      )
    ).join(","),
  ].join("\n");
  const p = await previewCsv(csv, mapping);
  if (
    p.rows.length !== 1 || p.rows[0].normalized_hash !== c.normalized_hash ||
    await digest(c.normalized) !== await digest(p.rows[0].normalized)
  ) refuse("snapshot_csv_value_mismatch");
  const n = p.rows[0].normalized;
  const target = subject({
    domain: n.company_domain ?? null,
    linkedin_url: n.company_linkedin_url ?? null,
    apollo_account_id: n.apollo_account_id ?? null,
  });
  const collected = timestamp(c.collected_at, true);
  if (collected && Date.parse(collected) > Date.parse(asOf)) {
    refuse("snapshot_future_collection");
  }
  if (!Array.isArray(input.sources) || input.sources.length > 12) {
    refuse("snapshot_source_limit");
  }
  const sources = input.sources.map((v) =>
    normalizeSuppliedSource(v, scope, target, asOf)
  );
  const ids = new Set(["csv"]);
  for (const s of sources) {
    if (ids.has(s.id)) refuse("snapshot_duplicate_source");
    ids.add(s.id);
  }
  const annotations = (v: unknown, key: "text" | "reason") => {
    if (!Array.isArray(v) || v.length > 12) refuse("snapshot_annotation_limit");
    return (v as unknown[]).map((value) => {
      const a = object(value);
      exactKeys(a, [key, "source_ids"]);
      text(a[key]);
      if (
        !Array.isArray(a.source_ids) || !a.source_ids.length ||
        a.source_ids.length > 12 ||
        new Set(a.source_ids).size !== a.source_ids.length ||
        a.source_ids.some((id) => typeof id !== "string" || !ids.has(id))
      ) refuse("snapshot_annotation_source_missing");
      return a;
    });
  };
  return {
    csv: {
      ...c,
      normalized: n,
      collected_at: collected,
    } as unknown as CsvSnapshot,
    sources,
    interpretations: annotations(
      input.interpretations,
      "text",
    ) as unknown as ApprovedPacketInputs["interpretations"],
    conflicts: annotations(
      input.conflicts,
      "reason",
    ) as unknown as ApprovedPacketInputs["conflicts"],
  };
}
export interface PacketFact {
  id: string;
  workspace_id: string;
  client_binding_id: string;
  task_id: string;
  company_key: string;
  provenance_class: "supplied_claim" | "conflicting";
  field: string;
  value: string;
  source_id: string;
  location: {
    csv_rows: number[];
    column: string | null;
    start: number | null;
    end: number | null;
  };
  source: Pick<
    EvidenceItem["source"],
    "provider" | "actor" | "provider_call_id" | "url" | "excerpt"
  >;
  method: EvidenceItem["method"];
  status: "plausible";
  collected_at: string | null;
  event_at: string | null;
  integrity: "exact_field_or_excerpt_match";
  semantic_support: "not_evaluated";
}
export async function buildEvidencePacket(
  scope: PacketScope,
  input: ApprovedPacketInputs,
  asOf: string,
  sellerDomain: string,
  ordering: "insertion_v1" | "canonical_v2" = "insertion_v1",
) {
  const approved = await validateInputs(input, scope, asOf),
    c = approved.csv,
    n = c.normalized;
  const target = subject({
    domain: n.company_domain ?? null,
    linkedin_url: n.company_linkedin_url ?? null,
    apollo_account_id: n.apollo_account_id ?? null,
  });
  if (
    target.domain === sellerDomain ||
    approved.sources.some((s) => s.subject.domain === sellerDomain)
  ) refuse("snapshot_seller_source_contamination");
  const identity = companyIdentity(target, n.company_name);
  if (!identity.dedupeKey) refuse("snapshot_strong_company_identity_required");
  const company_key = identity.dedupeKey;
  const facts: PacketFact[] = [];
  const unknowns = new Set([
    "canonical_verification_unavailable",
    "supplied_employer_and_contact_unverified",
    "semantic_support_not_evaluated",
  ]);
  const add = async (
    v: Omit<
      PacketFact,
      "id" | "company_key" | "workspace_id" | "client_binding_id" | "task_id"
    >,
  ) => {
    const fact = { ...scope, company_key, ...v };
    facts.push({ ...fact, id: `fact-${await digest(fact)}` });
  };
  const isConflict = (id: string) =>
    approved.conflicts.some((g) => g.source_ids.includes(id));
  for (const [column, field] of Object.entries(c.mapping)) {
    if (!c.cells[column].trim()) {
      unknowns.add(`csv_field_missing:${field}`);
      continue;
    }
    await add({
      provenance_class: isConflict("csv") ? "conflicting" : "supplied_claim",
      field,
      value: c.cells[column],
      source_id: "csv",
      location: { csv_rows: c.source_rows, column, start: null, end: null },
      source: {
        provider: "supplied_export",
        actor: "none",
        provider_call_id: null,
        url: null,
        excerpt: c.cells[column],
      },
      method: "provider_field",
      status: "plausible",
      collected_at: c.collected_at,
      event_at: null,
      integrity: "exact_field_or_excerpt_match",
      semantic_support: "not_evaluated",
    });
  }
  for (const s of approved.sources) {
    sameSubject(target, s.subject);
    if (!s.collected_at) unknowns.add(`collection_time_missing:${s.id}`);
    if (!s.event_at) unknowns.add(`event_time_missing:${s.id}`);
    if (s.valid_until && Date.parse(s.valid_until) < Date.parse(asOf)) {
      unknowns.add(`source_stale:${s.id}`);
    }
    if (s.event_at && Date.parse(s.event_at) > Date.parse(asOf)) {
      unknowns.add(`future_event_not_completed:${s.id}`);
    }
    for (const q of s.quotes) {
      await add({
        provenance_class: isConflict(s.id) ? "conflicting" : "supplied_claim",
        field: "source_excerpt",
        value: q.excerpt,
        source_id: s.id,
        location: { csv_rows: [], column: null, start: q.start, end: q.end },
        source: {
          provider: "supplied_snapshot",
          actor: "none",
          provider_call_id: null,
          url: s.url,
          excerpt: q.excerpt,
        },
        method: "provider_field",
        status: "plausible",
        collected_at: s.collected_at,
        event_at: s.event_at,
        integrity: "exact_field_or_excerpt_match",
        semantic_support: "not_evaluated",
      });
    }
  }
  if (!c.collected_at) unknowns.add("collection_time_missing:csv");
  if (!n.source_updated_at) unknowns.add("source_timestamp_missing:csv");
  else unknowns.add("source_updated_time_is_not_event_time:csv");
  if (facts.length > 64) refuse("snapshot_fact_limit");
  // V2 is explicit in the signed context approval. Keep historical V1 byte/order
  // semantics intact; never silently rebase an existing model's F1/F2 references.
  if (ordering === "canonical_v2") {
    facts.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  return boundedJson({
    identity,
    target,
    source_snapshot: approved,
    facts,
    verified_facts: [],
    model_interpretations: approved.interpretations.map((i) => ({
      ...scope,
      ...i,
      provenance_class: "model_interpretation" as const,
    })),
    conflicts: approved.conflicts,
    unknowns: [...unknowns].sort(),
    canonical_decision: null as Eligibility | null,
    qualification_evaluated: false as const,
  }, 180000);
}
