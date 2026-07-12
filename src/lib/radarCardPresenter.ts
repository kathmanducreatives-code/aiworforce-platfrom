// Source-specific card presenters — pure, import-free, unit-testable. Turn a raw
// persisted signal (signals.raw, enriched by radarSignalEnrichment) into a clean
// view model per source, so the UI never buries the exact role in company text or
// shows duplicate tags. No fabrication: engagement/funding fields stay absent when
// the row doesn't carry them.

export type CanonicalDecision = "contact" | "watch" | "needs_review" | "skip";

function str(v: unknown): string | null { const t = typeof v === "string" ? v.trim() : ""; return t || null; }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function isHttpUrl(u: unknown): boolean { return /^https?:\/\/\S+/i.test((typeof u === "string" ? u : "").trim()); }

/** Collapse "X: X" duplicate labels (mirror of radarDecision.cleanLabel). */
export function cleanLabel(label: string | null | undefined): string {
  const s = (label ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(.*?)\s*[:\-–—]\s*(.*)$/);
  if (m && m[1].trim().toLowerCase() === m[2].trim().toLowerCase()) return m[1].trim();
  return s;
}

export interface RawSignal { signal_type?: string | null; title?: string | null; source_url?: string | null; raw?: Record<string, unknown> | null; }

function d(row: RawSignal): Record<string, unknown> { return row.raw ?? {}; }
function details(row: RawSignal): Record<string, unknown> { return (d(row)["source_details"] ?? {}) as Record<string, unknown>; }
function decision(row: RawSignal): CanonicalDecision {
  const v = String(d(row)["canonical_decision"] ?? "needs_review");
  return (["contact", "watch", "needs_review", "skip"].includes(v) ? v : "needs_review") as CanonicalDecision;
}

export interface HiringCardVM {
  company: string | null; role: string | null; role_family: string | null;
  location: string | null; posted_date: string | null;
  why_it_matters: string | null; evidence_url: string | null; decision: CanonicalDecision;
  can_draft_outreach: boolean;
}
export function hiringCardVM(row: RawSignal): HiringCardVM {
  const de = details(row);
  return {
    company: str(de["company"]) ?? str(d(row)["account_name"]),
    role: str(de["job_title"]),
    role_family: str(d(row)["role_family"]),
    location: str(de["location"]),
    posted_date: str(de["posted_at"]),
    why_it_matters: str(d(row)["why_it_matters"]),
    evidence_url: isHttpUrl(row.source_url) ? row.source_url ?? null : (isHttpUrl(de["job_url"]) ? String(de["job_url"]) : null),
    decision: decision(row),
    can_draft_outreach: !!d(row)["can_draft_outreach"],
  };
}

export interface PostCardVM {
  author: string | null; company: string | null; excerpt: string | null;
  engagement_label: string | null; topic: string | null; why: string | null;
  evidence_url: string | null; decision: CanonicalDecision;
}
export function postCardVM(row: RawSignal): PostCardVM {
  const de = details(row);
  const eng = d(row)["engagement_class"];
  return {
    author: str(de["author"]) ?? str(d(row)["contact_name"]),
    company: str(de["author_company"]) ?? str(d(row)["account_name"]),
    excerpt: str(row.title) ?? str(d(row)["excerpt"]),
    // Never fabricate "viral": only show a label the row actually carries.
    engagement_label: str(eng),
    topic: str(d(row)["topic"]),
    why: str(d(row)["why_it_matters"]),
    evidence_url: isHttpUrl(row.source_url) ? row.source_url ?? null : null,
    decision: decision(row),
  };
}

export interface CommentCardVM {
  commenter: string | null; company: string | null; comment: string | null;
  parent_post_url: string | null; intent: string | null; why_now: string | null; decision: CanonicalDecision;
}
export function commentCardVM(row: RawSignal): CommentCardVM {
  const de = details(row);
  return {
    commenter: str(de["commenter"]) ?? str(d(row)["contact_name"]),
    company: str(de["commenter_company"]),
    comment: str(de["comment_text"]) ?? str(row.title),
    parent_post_url: isHttpUrl(de["parent_post_url"]) ? String(de["parent_post_url"]) : null,
    intent: str(d(row)["intent"]),
    why_now: str(d(row)["why_now"]),
    decision: decision(row),
  };
}

export interface CompetitorCardVM {
  competitor: string | null; competitor_class: string | null; change: string | null;
  evidence_url: string | null; implication: string | null; decision: CanonicalDecision;
}
export function competitorCardVM(row: RawSignal): CompetitorCardVM {
  const de = details(row);
  return {
    competitor: str(de["competitor"]) ?? str(d(row)["competitor_name"]),
    competitor_class: str(d(row)["competitor_class"]),
    change: str(d(row)["change_detected"]),
    evidence_url: isHttpUrl(row.source_url) ? row.source_url ?? null : null,
    implication: str(d(row)["why_it_matters"]),
    decision: decision(row),
  };
}

export interface FundingCardVM {
  company: string | null; round: string | null; amount: string | null; announced_date: string | null;
  evidence_url: string | null; enables: string | null; decision: CanonicalDecision;
}
export function fundingCardVM(row: RawSignal): FundingCardVM {
  const de = details(row);
  return {
    company: str(de["company"]) ?? str(d(row)["account_name"]),
    // Absent unless the row actually carries the value — never inferred.
    round: str(de["funding_round"]),
    amount: str(de["funding_amount"]),
    announced_date: str(de["posted_at"]),
    evidence_url: isHttpUrl(row.source_url) ? row.source_url ?? null : null,
    enables: str(d(row)["why_it_matters"]),
    decision: decision(row),
  };
}

export interface TrendCardVM {
  workflow: string | null; maturity: string | null; evidence_urls: string[]; why: string | null; decision: CanonicalDecision;
}
export function trendCardVM(row: RawSignal): TrendCardVM {
  const urls = Array.isArray(d(row)["evidence_urls"]) ? (d(row)["evidence_urls"] as unknown[]).filter(isHttpUrl).map(String) : (isHttpUrl(row.source_url) ? [row.source_url as string] : []);
  return {
    workflow: str(d(row)["topic"]) ?? str(row.title),
    maturity: str(d(row)["maturity"]),
    evidence_urls: urls,
    why: str(d(row)["why_it_matters"]),
    decision: decision(row),
  };
}

export const DECISION_LABEL: Record<CanonicalDecision, string> = {
  contact: "Contact", watch: "Watch", needs_review: "Needs review", skip: "Skip",
};
