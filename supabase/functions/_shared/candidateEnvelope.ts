// Common Candidate Envelope (Phase 1C) — pure / deterministic.
//
// One shape every actor's output normalizes INTO, so the sufficiency gate and the
// enrichment planner reason about evidence rather than raw provider shapes.
//
// Hard rules enforced here:
//   - provider FACTS become evidence;
//   - Company Brain requirements are CONSTRAINTS, never candidate evidence;
//   - LLM interpretations are NEVER evidence;
//   - provenance is immutable;
//   - evidence is APPEND-ONLY (never silently overwritten).

import type { EvidenceCategory, EvidenceConfidence, EvidenceSourceType } from "./evidenceContract.ts";
import type { ArtifactType, TargetEntity } from "./leadEntityIntent.ts";

export interface EvidenceItem {
  category: EvidenceCategory;
  value?: unknown;
  sourceType: EvidenceSourceType;
  sourceUrl?: string;
  actorKey?: string;
  actorId?: string;
  observedAt?: string;      // ISO
  confidence: EvidenceConfidence;
  verified: boolean;
}

export interface NormalizedPersonCandidate {
  fullName?: string | null;
  title?: string | null;
  companyName?: string | null;
  profileUrl?: string | null;
  locationText?: string | null;
  countryCode?: string | null;
}
export interface NormalizedCompanyCandidate {
  name?: string | null;
  website?: string | null;
  domain?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  headquarters?: string | null;
  linkedinUrl?: string | null;
  countryCode?: string | null;
}
export interface NormalizedJobSignal {
  title?: string | null;
  companyName?: string | null;
  jobUrl?: string | null;
  postedAt?: string | null;
  locationText?: string | null;
}

export interface QualificationResult {
  identityConfidence: number;
  icpFitScore: number;
  timingScore: number;
  evidenceCompleteness: number;
  decision: "accept" | "stage_missing_evidence" | "reject_icp" | "reject_source" | "reject_timing";
  reasons: string[];
  missingEvidence: EvidenceCategory[];
}

export interface CandidateEnvelope {
  candidateId: string;
  targetEntity: TargetEntity;
  primaryArtifactType: ArtifactType;
  person?: NormalizedPersonCandidate;
  company?: NormalizedCompanyCandidate;
  job?: NormalizedJobSignal;
  evidence: EvidenceItem[];
  sourceProvenance: {
    provider: string;
    actorKey: string;
    actorId: string;
    providerRunId?: string;
    verified: boolean;
  };
  /** Canonical company key for evidence reuse/dedupe (Phase 1H). */
  companyKey?: string | null;
  qualification?: QualificationResult;
}

// ------------------------------------------------------------ evidence rules --

/** Source types that can carry VERIFIED provider facts. `company_brain` is a
 * constraint source and can never be verified candidate evidence. */
const EVIDENCE_SOURCES: ReadonlySet<EvidenceSourceType> = new Set(["apify_actor", "official_website", "public_web"]);

/** True when an evidence item is a legitimate, verified provider fact. */
export function isVerifiedProviderEvidence(item: EvidenceItem): boolean {
  return item.verified === true && EVIDENCE_SOURCES.has(item.sourceType);
}

/**
 * Append evidence. Append-only: an existing item for the same
 * (category, sourceUrl, actorKey) is never overwritten — a new observation is
 * appended so the trail stays auditable. Brain-sourced items are rejected as
 * evidence (they are constraints), as are unverified LLM interpretations.
 */
export function appendEvidence(env: CandidateEnvelope, items: EvidenceItem[]): CandidateEnvelope {
  const additions = items.filter((i) => {
    if (i.sourceType === "company_brain") return false;   // constraint, not evidence
    return true;
  });
  return { ...env, evidence: [...env.evidence, ...additions] };
}

/** Categories currently satisfied by VERIFIED provider evidence at/above `min`. */
export function satisfiedCategories(
  env: CandidateEnvelope,
  min: EvidenceConfidence = "low",
): Set<EvidenceCategory> {
  const rank: Record<EvidenceConfidence, number> = { low: 0, medium: 1, high: 2 };
  const out = new Set<EvidenceCategory>();
  for (const e of env.evidence) {
    if (!isVerifiedProviderEvidence(e)) continue;
    if (rank[e.confidence] < rank[min]) continue;
    out.add(e.category);
  }
  return out;
}

/** Is an evidence item fresh relative to `now` and a window (hours)? */
export function isEvidenceFresh(item: EvidenceItem, now: string, windowHours?: number): boolean {
  if (!windowHours) return true;             // no freshness demand
  if (!item.observedAt) return false;        // a freshness demand needs a timestamp
  const t = Date.parse(item.observedAt);
  const n = Date.parse(now);
  if (!isFinite(t) || !isFinite(n)) return false;
  return (n - t) <= windowHours * 3600_000;
}

// ------------------------------------------------------- company dedupe key ---

const nrmUrl = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
const nrmName = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|co|gmbh|sa|bv|plc)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");

/**
 * Canonical company key (Phase 1H), strongest identifier first:
 *   1. normalized company LinkedIn URL
 *   2. normalized official domain
 *   3. normalized company name + geography fallback
 * Multiple people at one company MUST resolve to the same key so their company
 * evidence is fetched once and fanned back out.
 */
export function companyKeyFor(input: {
  companyLinkedinUrl?: string | null;
  website?: string | null;
  domain?: string | null;
  companyName?: string | null;
  countryCode?: string | null;
}): string | null {
  const li = nrmUrl(input.companyLinkedinUrl);
  if (li) return `li:${li}`;
  const dom = nrmUrl(input.domain) || nrmUrl(input.website);
  if (dom) return `dom:${dom.split("/")[0]}`;
  const nm = nrmName(input.companyName);
  if (nm) return `name:${nm}${input.countryCode ? `|${String(input.countryCode).toLowerCase()}` : ""}`;
  return null;
}
