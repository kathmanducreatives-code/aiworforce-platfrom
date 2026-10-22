// READ-ONLY ASSESSMENT: which stored Company Brains still hold divergent copies?
//
// Brains saved before #147 and roadmap 1.2 can hold a legacy `icp` block, a
// radar `signal_preferences` copy or a legacy `competitors.known` list that no
// longer matches the structured Brain. Both write paths now repair a row on its
// next save; this module answers "how many rows are still divergent, and in
// which copies" WITHOUT writing anything, so the decision to repair (a separate,
// approved run of the same reconcile on those rows) is made on evidence.
//
// It reuses the write paths' own reconcile (companyBrainMirror.ts), so "would
// change" means exactly "the next save would change this". Output names copies
// and paths only — never a profile value — so a report is safe to share.
//
// Pure — no DB, no network.
import { normalizeCompanyBrain } from "./normalizeCompanyBrain.ts";
import { reconcileDerivedCopies, structuredAuthoritative } from "./companyBrainMirror.ts";

type Raw = Record<string, unknown>;

export interface RowAssessment {
  workspace_id: string;
  /** Dotted paths the next save would rewrite, e.g. `icp.industries`. Empty = consistent. */
  would_change: string[];
  /** A structured (v2) Brain exists; legacy-only rows are reported but never "divergent". */
  structured: boolean;
}

export interface AssessmentReport {
  rows: number;
  structured_rows: number;
  divergent_rows: number;
  /** Count of rows per path the next save would rewrite. */
  by_path: Record<string, number>;
  /** Workspace ids of divergent rows — ids only, for the approved repair run. */
  divergent_workspace_ids: string[];
}

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
/** Comparison form: a missing key, null, "" and [] are all "nothing" — adding an empty key is not divergence. */
const asValue = (v: unknown): string =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0) ? "" : JSON.stringify(v);
const STRUCTURED_KEYS = ["target_customer", "buyer_personas", "pain_points", "competitors", "content_angles"];

export function assessBrainRow(workspace_id: string, profile: unknown): RowAssessment {
  const existing: Raw = isObj(profile) ? profile : {};
  const structured = existing.schema_version === 2 || isObj(existing.target_customer)
    || STRUCTURED_KEYS.some((k) => Array.isArray(existing[k]));
  const merged: Raw = structuredClone(existing);
  const after = normalizeCompanyBrain(structuredAuthoritative(merged));
  reconcileDerivedCopies(merged, normalizeCompanyBrain(existing), existing, after, false);

  const would_change: string[] = [];
  for (const block of ["icp", "signal_preferences", "competitors"]) {
    const a = isObj(existing[block]) ? existing[block] as Raw : null;
    const b = isObj(merged[block]) ? merged[block] as Raw : null;
    if (!a && !b) continue;
    for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      if (asValue(a?.[key]) !== asValue(b?.[key])) would_change.push(`${block}.${key}`);
    }
  }
  // A legacy-only row's mirror is rebuilt from itself; any churn there (key order,
  // a missing empty key) is not divergence between two truths.
  return { workspace_id, would_change: structured ? would_change.sort() : [], structured };
}

export function assessBrains(rows: Array<{ workspace_id: string; profile: unknown }>): AssessmentReport {
  const report: AssessmentReport = { rows: rows.length, structured_rows: 0, divergent_rows: 0, by_path: {}, divergent_workspace_ids: [] };
  for (const r of rows) {
    const a = assessBrainRow(r.workspace_id, r.profile);
    if (a.structured) report.structured_rows++;
    if (!a.would_change.length) continue;
    report.divergent_rows++;
    report.divergent_workspace_ids.push(a.workspace_id);
    for (const p of a.would_change) report.by_path[p] = (report.by_path[p] ?? 0) + 1;
  }
  report.divergent_workspace_ids.sort();
  return report;
}
