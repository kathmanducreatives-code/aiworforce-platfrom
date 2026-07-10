// Lead junk AUDIT classifier (Part 2 — audit tooling only).
//
// Pure / import-free classifier that inspects a stored lead row and decides
// whether it looks like junk that a HUMAN might later choose to archive. It is
// deliberately conservative and READ-ONLY: it never deletes, never mutates, and
// never touches anything cross-workspace. It only *labels* + explains, so a
// dry-run report can be reviewed before anyone decides to act.
//
// It never classifies a user-approved/enriched/contacted/sent artifact as junk
// (those are protected regardless of source-quality), and it never hard-deletes.
// The strongest verdict it can emit is "archive_candidate" — a suggestion only.

export type JunkVerdict = "keep" | "archive_candidate";

export interface AuditLeadRow {
  id?: string | null;
  workspace_id?: string | null;
  company_name?: string | null;
  website?: string | null;
  domain?: string | null;
  source_url?: string | null;
  status?: string | null;                 // e.g. new / approved / contacted / sent
  contact_status?: string | null;
  enrichment_status?: string | null;
  draft_status?: string | null;
  raw?: Record<string, unknown> | null;    // preserved provider/analyst jsonb
}

export interface AuditResult {
  id: string | null;
  verdict: JunkVerdict;
  reasons: string[];
  protected: boolean;    // true if a human-touched artifact shielded it from archiving
}

const SHORTENER_HOST = /(?:^|\.)(bit\.ly|tinyurl\.com|t\.co|lnkd\.in|goo\.gl|ow\.ly|rebrand\.ly|shorturl\.at|cutt\.ly|buff\.ly|is\.gd)$/i;
const PROTECTED_STATUS = /\b(approved|contacted|sent|replied|won|meeting|booked|enriched)\b/i;

function s(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }

function isShortener(url: string): boolean {
  if (!url) return false;
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = new URL(withProto).hostname.replace(/^www\./i, "").toLowerCase();
    return SHORTENER_HOST.test(host);
  } catch { return false; }
}

/** Has a human acted on this row? If so it is PROTECTED from archiving. */
export function isHumanProtected(row: AuditLeadRow): boolean {
  const raw = (row.raw && typeof row.raw === "object" ? row.raw : {}) as Record<string, unknown>;
  const statuses = [row.status, row.contact_status, row.enrichment_status, row.draft_status, raw.status]
    .map(s).filter(Boolean);
  if (statuses.some((x) => PROTECTED_STATUS.test(x))) return true;
  // An approved/sent draft or a verified contact is never junk.
  if (s(row.draft_status) === "approved") return true;
  if (raw.user_approved === true || raw.approved === true) return true;
  return false;
}

/**
 * Classify ONE stored lead row. Conservative: only rows with NO real proof AND
 * NO human touch are flagged as archive candidates. Everything else is kept.
 * Never mutates the row.
 */
export function classifyLeadForAudit(row: AuditLeadRow): AuditResult {
  const raw = (row.raw && typeof row.raw === "object" ? row.raw : {}) as Record<string, unknown>;
  const reasons: string[] = [];

  if (isHumanProtected(row)) {
    return { id: row.id ?? null, verdict: "keep", reasons: ["human-touched (approved/contacted/enriched) — protected"], protected: true };
  }

  const sourceUrl = s(row.source_url) || s(raw.source_url as string) || s(raw.job_url as string);
  const website = s(row.website) || s(raw.company_website as string);
  const domain = s(row.domain) || s(raw.domain as string);

  // No source proof at all, or an explicit proof_incomplete sentinel → junk.
  if (!sourceUrl || /proof_incomplete/i.test(sourceUrl)) reasons.push("no verifiable source proof (never should have persisted)");
  // Website is a link shortener AND there is no real company domain → identity unverifiable.
  if (isShortener(website) && !domain) reasons.push("company website is a link shortener with no verified domain");
  if (raw.website_shortener_dropped === true && !domain) reasons.push("shortener website was dropped and no real domain remains");
  // Recruiter/staffing proxy the pipeline already flagged → not a real target account.
  if (raw.recruiter_proxy === true) reasons.push("recruiter/staffing proxy post; actual hiring company hidden");
  // Explicit hard-reject recorded on the row (gate decision) with no accepted signal.
  if (typeof raw.match_tier === "string" && raw.match_tier === "reject") reasons.push("recorded match_tier = reject");
  const gate = s(raw.gate_decision as string);
  if (/reject/i.test(gate)) reasons.push(`gate decision = ${gate}`);
  // Completely empty identity (no company name AND no domain AND no source).
  if (!s(row.company_name) && !domain && !sourceUrl) reasons.push("empty identity (no company, domain, or source)");

  const verdict: JunkVerdict = reasons.length ? "archive_candidate" : "keep";
  if (!reasons.length) reasons.push("has source proof / verified identity — keep");
  return { id: row.id ?? null, verdict, reasons, protected: false };
}

export interface AuditSummary {
  reviewed: number;
  keep: number;
  archive_candidates: number;
  protected: number;
  archive_ids: string[];
  reason_counts: Record<string, number>;
}

/**
 * Dry-run audit over a batch of rows. Returns counts + the ids that a HUMAN
 * could choose to archive. Performs NO deletion and NO mutation — the caller
 * decides what (if anything) to do with the result.
 */
export function auditLeadBatch(rows: AuditLeadRow[]): AuditSummary {
  const summary: AuditSummary = { reviewed: 0, keep: 0, archive_candidates: 0, protected: 0, archive_ids: [], reason_counts: {} };
  for (const row of rows ?? []) {
    const r = classifyLeadForAudit(row);
    summary.reviewed++;
    if (r.protected) summary.protected++;
    if (r.verdict === "archive_candidate") {
      summary.archive_candidates++;
      if (r.id) summary.archive_ids.push(r.id);
      for (const reason of r.reasons) summary.reason_counts[reason] = (summary.reason_counts[reason] ?? 0) + 1;
    } else {
      summary.keep++;
    }
  }
  return summary;
}
