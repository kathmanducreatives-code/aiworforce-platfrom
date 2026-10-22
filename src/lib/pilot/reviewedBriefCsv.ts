// Validate server-prepared bytes, never build an approved CSV from browser state.
export interface ManualCsvScope {
  workspace_id: string;
  client_binding_id: string;
  actor_id: string;
}
export interface ManualCsvRow {
  task_id: string;
  revision_hash: string;
  approval_hash: string;
}
const row = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw Error("Invalid export response");
  }
  return v as Record<string, unknown>;
};
export async function reviewedBriefCsv(
  raw: unknown,
  scope: ManualCsvScope,
  expected: ManualCsvRow[],
) {
  const r = row(raw), m = row(r.manifest);
  if (
    m.version !== "pilot_manual_csv_v1" ||
    m.workspace_id !== scope.workspace_id ||
    m.client_binding_id !== scope.client_binding_id ||
    m.actor_id !== scope.actor_id ||
    m.status !== "prepared_for_manual_download" ||
    m.dispatch_allowed !== false || m.remote_update_performed !== false ||
    m.mime_type !== "text/csv;charset=utf-8" || typeof r.csv !== "string" ||
    !Array.isArray(m.rows) || m.rows.length !== expected.length ||
    expected.length < 1 || expected.length > 5 ||
    new Set(expected.map((i) => i.task_id)).size !== expected.length
  ) throw Error("Export identity mismatch");
  expected.forEach((e, i) => {
    const a = row((m.rows as unknown[])[i]);
    if (
      a.task_id !== e.task_id || a.revision_hash !== e.revision_hash ||
      a.approval_hash !== e.approval_hash
    ) throw Error("Export version mismatch");
  });
  const bytes = new TextEncoder().encode(r.csv);
  if (bytes.length > 250000 || m.byte_length !== bytes.length) {
    throw Error("Export size mismatch");
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes),
    hash = [...new Uint8Array(digest)].map((v) =>
      v.toString(16).padStart(2, "0")
    ).join("");
  if (
    m.file_hash !== hash ||
    m.file_name !== `outpost-reviewed-${hash.slice(0, 16)}.csv`
  ) throw Error("Export integrity mismatch");
  return {
    bytes,
    file_name: m.file_name as string,
    mime_type: "text/csv;charset=utf-8" as const,
    manifest: structuredClone(m),
  };
}
