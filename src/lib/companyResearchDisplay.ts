// Structured company-research presentation. Pure — no React, no `@/` imports.
//
// The Workbench rendered `Company enriched: <raw text>`, where the text came
// straight from scraped page content. Production shows the result: newsletter
// copy, Markdown image syntax and page fragments presented as a company summary.
//
// This module sanitizes the summary and exposes structured parts, so the cell
// renders a compact card instead of one unbounded string.

export type ResearchDisplayStatus =
  | 'not_started'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'missing_company_identity'
  | 'unavailable'
  | 'timed_out'
  | 'failed';

export interface CompanyResearchView {
  status: ResearchDisplayStatus;
  summary: string | null;
  evidence_count: number;
  missing_evidence: string[];
  confidence: string | null;
  /** True when there is enough to ground an outreach claim. */
  usable: boolean;
}

const MAX_SUMMARY_CHARS = 220;

/**
 * Strip page furniture from a scraped summary. Returns null when nothing
 * usable survives — better an honest blank than newsletter copy presented as a
 * company description.
 */
export function sanitizeSummary(input: unknown): string | null {
  if (typeof input !== 'string') return null;

  let s = input
    // Markdown images: ![alt](url) — these rendered literally in the cell.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    // Markdown links → keep the label, drop the target.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Bare URLs.
    .replace(/https?:\/\/\S+/g, ' ')
    // Markdown emphasis / headings / list bullets.
    .replace(/[*_`>#]+/g, ' ')
    .replace(/^\s*[-•]\s+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!s) return null;

  // Drop leading newsletter / CTA / cookie furniture.
  const FURNITURE = /^(subscribe|sign up|newsletter|read more|learn more|cookie|accept all|share this|follow us|the newsletter|episode \d+)\b/i;
  if (FURNITURE.test(s)) {
    const afterFirstSentence = s.split(/(?<=[.!?])\s+/).slice(1).join(' ').trim();
    s = afterFirstSentence;
  }
  if (!s) return null;

  // A usable company summary is prose, not a fragment or a heading. Word count
  // rather than character count: "Acme builds robots" is a valid short summary,
  // while "Pricing" is a nav label. An arbitrary length cutoff rejects both.
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;
  if (!/[a-z]/.test(s)) return null;

  if (s.length > MAX_SUMMARY_CHARS) {
    const cut = s.slice(0, MAX_SUMMARY_CHARS);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = lastStop > 80 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
  }
  return s;
}

/** True when a string still carries raw page markup we must never render. */
export function containsRawMarkup(value: string | null | undefined): boolean {
  if (!value) return false;
  return /!\[|\]\(|https?:\/\//.test(value);
}

interface RawEnrichmentLike {
  company_summary?: unknown;
  evidence_urls?: unknown;
  missing_evidence?: unknown;
  confidence?: unknown;
}

/**
 * Build the display view from either the persisted `company_enrichment` blob or
 * the namespaced Workbench stage payload.
 */
export function buildCompanyResearchView(
  source: RawEnrichmentLike | null | undefined,
  status: ResearchDisplayStatus = 'succeeded',
): CompanyResearchView {
  const e = source ?? {};
  const summary = sanitizeSummary(e.company_summary);
  const evidence = Array.isArray(e.evidence_urls) ? e.evidence_urls.filter((u) => typeof u === 'string') : [];
  const missing = Array.isArray(e.missing_evidence) ? e.missing_evidence.map((m) => String(m)) : [];
  const confidence = typeof e.confidence === 'string' ? e.confidence : null;

  // "Provider completed" is not success. Usable requires a real summary AND at
  // least one source backing it.
  const usable = !!summary && evidence.length > 0;

  let resolved: ResearchDisplayStatus = status;
  if (status === 'succeeded' && !usable) resolved = 'partial';

  return {
    status: resolved,
    summary,
    evidence_count: evidence.length,
    missing_evidence: missing,
    confidence,
    usable,
  };
}

export const RESEARCH_STATUS_COPY: Record<ResearchDisplayStatus, string> = {
  not_started: 'Not researched',
  running: 'Researching…',
  succeeded: 'Company researched',
  partial: 'Company research incomplete',
  missing_company_identity: 'Verify the company domain or LinkedIn page first',
  unavailable: 'Research provider unavailable',
  timed_out: 'Company research timed out',
  failed: 'Company research failed',
};

/** Compact evidence line: "4 verified sources" / "No sources yet". */
export function evidenceLine(view: CompanyResearchView): string {
  if (view.evidence_count === 0) return 'No sources yet';
  return `${view.evidence_count} verified source${view.evidence_count === 1 ? '' : 's'}`;
}

/** First missing-evidence item, phrased for the cell. */
export function missingLine(view: CompanyResearchView): string | null {
  if (view.missing_evidence.length === 0) return null;
  const first = view.missing_evidence[0].replace(/_/g, ' ');
  const extra = view.missing_evidence.length - 1;
  return extra > 0 ? `${first} (+${extra} more)` : first;
}

// ---------------------------------------------------------------------------
// Outreach prerequisite copy — must name the SPECIFIC missing step.
// ---------------------------------------------------------------------------

export const OUTREACH_BLOCK_COPY: Record<string, string> = {
  blocked_missing_company_evidence: 'Complete company research first',
  blocked_missing_person: 'Find a verified decision-maker first',
  blocked_missing_company_brain: 'Complete Company Brain before drafting',
  ready: 'Ready to draft',
};

/**
 * Never the bare "Complete the required previous step first" — that told the
 * user nothing about which step.
 */
export function outreachBlockCopy(reasonCode: string | null | undefined): string {
  if (!reasonCode) return 'Complete the required previous step first';
  return OUTREACH_BLOCK_COPY[reasonCode] ?? 'Complete the required previous step first';
}

export const APPROVAL_NOTICE = 'Approval required · Nothing sent';
