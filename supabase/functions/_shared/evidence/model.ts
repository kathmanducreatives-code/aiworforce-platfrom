// ONE EVIDENCE SHAPE FOR EVERY DEPARTMENT. PURE.
//
// Company Brain facts, saved leads, LISA signals and cached web pages each
// carried their own provenance vocabulary. An answer that mixes them needs one
// shape, one verification scale and one freshness rule, so a stale forum post
// and a verified two-source announcement can never read the same.
//
// Verification classes (Workforce V2 §3):
//   verified       ≥ 2 independent sources, or an approved Brain fact
//   single_source  one source, or the company's own announcement
//   inference      an agent's judgement with no quotable source (lead fit reasons)
//   contradicted   sources disagree or the claim was retracted
//   stale          older than its source type's freshness window
//   unknown        nothing says either way
//
// Nothing here fetches. Cost policy: the retrieval layer reads only records
// already bought and stored, so a retrieval costs $0 and buys nothing. Fresh
// Firecrawl/Apify work goes through the existing approval + credit paths.

export const EVIDENCE_MODEL_VERSION = "evidence-v1" as const;

export const EVIDENCE_SOURCE_TYPES = ["company_brain", "lead", "lisa_signal", "web_page"] as const;
export type EvidenceSourceType = typeof EVIDENCE_SOURCE_TYPES[number];

export const VERIFICATION_CLASSES = ["verified", "single_source", "inference", "contradicted", "stale", "unknown"] as const;
export type VerificationClass = typeof VERIFICATION_CLASSES[number];

/** Days a claim of this source type stays current. Brain facts are governed by their own lifecycle. */
export const FRESHNESS_DAYS: Readonly<Record<EvidenceSourceType, number | null>> = Object.freeze({
  company_brain: null,
  lead: 90,
  lisa_signal: 60,
  web_page: 30,
});

export interface EvidenceItem {
  /** Stable within a workspace: `<source_type>:<record id>`. */
  id: string;
  workspace_id: string;
  source_type: EvidenceSourceType;
  source_url: string | null;
  /** When the claim was published or happened, if known. */
  published_at: string | null;
  /** When Agentory obtained it. */
  retrieved_at: string;
  /** Who or what the claim is about. */
  subject: { name: string | null; domain: string | null };
  content: string;
  verification: VerificationClass;
  confidence: "high" | "medium" | "low";
  /** Read under workspace membership; never served across workspaces. */
  permissions: { scope: "workspace"; workspace_id: string };
  /** The record this came from, for audit. */
  provenance: { table: string; record_id: string };
}

const DAY = 86_400_000;
const ms = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };

/** Apply the freshness window: a current class becomes `stale` past it. Contradicted stays contradicted. */
export function applyFreshness(
  verification: VerificationClass, source: EvidenceSourceType,
  dates: { published_at: string | null; retrieved_at: string }, now: Date,
): VerificationClass {
  if (verification === "contradicted") return verification;
  const window = FRESHNESS_DAYS[source];
  if (window == null) return verification;
  const at = ms(dates.published_at) ?? ms(dates.retrieved_at);
  if (at == null) return verification === "verified" ? "single_source" : verification;
  return now.getTime() - at > window * DAY ? "stale" : verification;
}

/** LISA's counted verification level → the shared class. */
export function classFromLisa(level: string | null | undefined, lifecycle: string | null | undefined, columnStatus?: string | null): VerificationClass {
  if (lifecycle === "contradicted" || lifecycle === "retracted" || level === "contradicted") return "contradicted";
  if (lifecycle === "stale") return "stale";
  if (level === "corroborated") return "verified";
  if (level === "self_reported" || level === "single_source") return "single_source";
  if (level === "model_inference") return "inference";
  if (columnStatus === "provider_verified") return "verified";
  if (columnStatus === "self_reported") return "single_source";
  return "unknown";
}

/** A Brain memory item's status → the shared class. Only approved, active items reach here. */
export function classFromBrain(verificationStatus: string | null | undefined, lifecycle: string | null | undefined): VerificationClass {
  if (lifecycle === "disputed" || lifecycle === "retracted" || lifecycle === "rejected") return "contradicted";
  if (lifecycle === "stale" || lifecycle === "expired" || lifecycle === "superseded") return "stale";
  // An approved Brain fact is the workspace's own statement: verified for this workspace.
  return verificationStatus === "unverified" ? "single_source" : "verified";
}

const normName = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normUrl = (u: string | null | undefined) =>
  String(u ?? "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/** Does this item concern the subject? Domain match wins; otherwise a name match. */
export function concerns(item: EvidenceItem, subject: { name?: string | null; domain?: string | null }): boolean {
  const d = String(subject.domain ?? "").toLowerCase().replace(/^www\./, "");
  if (d && item.subject.domain && item.subject.domain.toLowerCase().replace(/^www\./, "") === d) return true;
  const n = normName(subject.name);
  if (!n) return false;
  const iname = normName(item.subject.name);
  return !!iname && (iname === n || iname.startsWith(n + " ") || n.startsWith(iname + " "));
}

const RANK: Record<VerificationClass, number> = { verified: 0, single_source: 1, inference: 2, unknown: 3, stale: 4, contradicted: 5 };

/**
 * Dedupe: one item per (source url) or, without a url, per (source type,
 * subject, content). The strongest verification survives; ties keep the newest.
 */
export function dedupeEvidence(items: readonly EvidenceItem[]): EvidenceItem[] {
  const by = new Map<string, EvidenceItem>();
  for (const it of items) {
    const key = it.source_url ? `u:${normUrl(it.source_url)}|${normName(it.subject.name)}`
      : `c:${it.source_type}|${normName(it.subject.name)}|${normName(it.content).slice(0, 120)}`;
    const prev = by.get(key);
    if (!prev || RANK[it.verification] < RANK[prev.verification] ||
      (RANK[it.verification] === RANK[prev.verification] && (ms(it.retrieved_at) ?? 0) > (ms(prev.retrieved_at) ?? 0))) {
      by.set(key, it);
    }
  }
  return [...by.values()];
}

/** Strongest first, then newest. */
export function rankEvidence(items: readonly EvidenceItem[]): EvidenceItem[] {
  return [...items].sort((a, b) =>
    RANK[a.verification] - RANK[b.verification] ||
    (ms(b.published_at ?? b.retrieved_at) ?? 0) - (ms(a.published_at ?? a.retrieved_at) ?? 0));
}

export const VERIFICATION_LABEL: Readonly<Record<VerificationClass, string>> = Object.freeze({
  verified: "verified",
  single_source: "single source",
  inference: "agent inference",
  contradicted: "contradicted",
  stale: "stale",
  unknown: "unverified",
});
