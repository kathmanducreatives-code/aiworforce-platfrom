// Jobs → SignalEvent adapter (Phase B provider binding) — pure, provider-free.
//
// Converts a SANITIZED, already-normalized job record (apifyJobsNormalizer's
// NormalizedJob, produced by the canonical jobs actor curious_coder/
// linkedin-jobs-scraper / actor key `apify_jobs`) into a canonical SignalEvent.
//
// It binds NO provider and calls NO network: the caller supplies the normalized
// record and the provider identity. GTM hiring roles map to the existing
// job_signal EvidenceCategory via the canonical taxonomy — no parallel system.
//
// Safety: occurred_at comes ONLY from a source-backed posting timestamp; a record
// with no verifiable posting date can never become current timing evidence. No raw
// payload, email, phone, or recruiter contact detail is ever placed on the signal.

import {
  buildSignalDedupeKey, validateSignalEvent,
  type SignalEvent, type SignalEvidenceRef, type GtmSignalType,
} from "./signalEvent.ts";
import type { ListingStatus } from "./timingFreshnessPolicy.ts";
import type { EvidenceConfidence } from "./evidenceContract.ts";

/** The canonical jobs actor this adapter is bound to (resolved from ACTOR_REGISTRY;
 * never invented, never from planner/model text). */
export const JOBS_ACTOR_KEY = "apify_jobs";
export const JOBS_ACTOR_ID = "curious_coder/linkedin-jobs-scraper";

// ------------------------------------------------- title classification -------

/** The minimal normalized job shape this adapter needs (subset of NormalizedJob). */
export interface NormalizedJobLike {
  company?: string | null;
  jobTitle?: string | null;
  linkedinUrl?: string | null;   // company LinkedIn URL
  website?: string | null;
  domain?: string | null;
  jobUrl?: string | null;
  postedAt?: string | null;      // ISO posting timestamp — the ONLY occurred_at basis
  seniorityLevel?: string | null;
  jobFunction?: string | null;
  // deno-lint-ignore no-explicit-any
  raw?: Record<string, any> | null;
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// RevOps is checked FIRST because "sales operations" belongs to RevOps, not to the
// individual-contributor sales family. Order matters: most-specific family wins.
const REVOPS_RE = /\b(revenue operations|rev ?ops|sales operations|sales ops|gtm operations|go[- ]to[- ]market operations|commercial operations)\b/;
const SALES_RE = /\b(sales development|business development|account executive|\bae\b|\bsdr\b|\bbdr\b|sales representative|sales rep|sales manager|head of sales|vp,? sales|vp of sales|sales director|director of sales|chief revenue officer|\bcro\b)\b/;
const GROWTH_RE = /\b(growth lead|growth manager|head of growth|vp,? growth|growth marketing|demand generation|demand gen|\bdemandgen\b|growth hacker|performance marketing)\b/;

/** Deterministically classify a job title into a GTM hiring signal type, or null
 * when the role is not go-to-market hiring. Never guesses: unmatched ⇒ null. */
export function classifyGtmRole(title: string | null | undefined): GtmSignalType | null {
  const t = norm(title);
  if (!t) return null;
  if (REVOPS_RE.test(t)) return "revops_hiring";
  if (SALES_RE.test(t)) return "sales_hiring";
  if (GROWTH_RE.test(t)) return "growth_hiring";
  return null;
}

// --------------------------------------------------- listing status -----------

// `active` must be POSITIVELY source-backed. `unknown` is the honest default — the
// absence of a closing date is never evidence that a listing is open.
const CLOSED_RE = /\b(closed|filled|no longer accepting|position filled|role filled)\b/;
const EXPIRED_RE = /\b(expired|deactivated|delisted|removed)\b/;
const ACTIVE_RE = /\b(active|open|accepting applications|actively hiring|now hiring|is hiring)\b/;

/** Normalize a source-backed listing status. Reads only documented status-ish
 * fields; never infers `active` from missing data. */
export function normalizeListingStatus(job: NormalizedJobLike): ListingStatus {
  const raw = job.raw ?? {};
  // Prefer explicit boolean/enum status fields the actor may surface.
  const explicit = norm(raw.jobState ?? raw.status ?? raw.listingStatus ?? raw.jobStatus ?? raw.state);
  if (raw.closed === true || raw.isClosed === true || raw.expired === true || raw.isExpired === true) {
    return raw.expired === true || raw.isExpired === true ? "expired" : "closed";
  }
  if (raw.active === true || raw.isActive === true || raw.open === true) return "active";
  if (explicit) {
    if (EXPIRED_RE.test(explicit)) return "expired";
    if (CLOSED_RE.test(explicit)) return "closed";
    if (ACTIVE_RE.test(explicit)) return "active";
  }
  // A parseable, future/absent expiry date is not proof of `active` → stay unknown.
  return "unknown";
}

// ---------------------------------------------- record → signal event ---------

export type JobSignalRejectionReason =
  | "not_gtm_hiring"
  | "missing_occurred_at"
  | "no_company_reference"
  | "failed_validation";

export interface JobSignalResult {
  signal: SignalEvent | null;
  rejected: boolean;
  reason?: JobSignalRejectionReason;
}

export interface JobToSignalArgs {
  job: NormalizedJobLike;
  workspace_id: string;
  /** Canonical company identity key (LinkedIn URL / domain / name key). */
  company_ref: string;
  observedAt: string;              // runtime/injected clock — audit only, not freshness
  provider?: string;               // e.g. "apify"
  actorKey?: string;
  actorId?: string;
  confidence?: EvidenceConfidence; // default "high" (provider-backed)
  signalIdFor?: (dedupeKey: string) => string;
}

const cleanUrl = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (u.username || u.password) return undefined;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;   // strip query/fragment
  } catch { return undefined; }
};

/**
 * Map one sanitized normalized job record to a canonical GTM-hiring SignalEvent.
 *
 * Returns `{ signal: null, rejected: true, reason }` when the role is not GTM
 * hiring, has no verifiable posting date, or has no company reference — never a
 * fabricated signal.
 */
export function jobRecordToSignalEvent(args: JobToSignalArgs): JobSignalResult {
  const { job } = args;
  const signalType = classifyGtmRole(job.jobTitle);
  if (!signalType) return { signal: null, rejected: true, reason: "not_gtm_hiring" };
  if (!args.company_ref) return { signal: null, rejected: true, reason: "no_company_reference" };

  // occurred_at MUST be a source-backed posting timestamp. No date ⇒ not admissible
  // as current timing evidence (never fall back to observed_at for freshness).
  const posted = typeof job.postedAt === "string" ? job.postedAt.trim() : "";
  if (!posted || !isFinite(Date.parse(posted))) {
    return { signal: null, rejected: true, reason: "missing_occurred_at" };
  }
  const occurred_at = new Date(Date.parse(posted)).toISOString();

  const sourceUrl = cleanUrl(job.jobUrl);
  const listing_status = normalizeListingStatus(job);
  const roleTitle = norm(job.jobTitle).slice(0, 120);

  const evidence_refs: SignalEvidenceRef[] = [{
    category: "job_signal",
    sourceType: "apify_actor",
    ...(sourceUrl ? { sourceUrl } : {}),
    actorKey: args.actorKey ?? JOBS_ACTOR_KEY,
    actorId: args.actorId ?? JOBS_ACTOR_ID,
    observedAt: args.observedAt,
    confidence: args.confidence ?? "high",
  }];

  const dedupe_key = buildSignalDedupeKey({
    workspace_id: args.workspace_id,
    signal_type: signalType,
    company_ref: args.company_ref,
    occurred_at,
    event_identity: signalType,   // one GTM-hiring event per company per window per family
  });

  // normalized_value carries ONLY sanitized, structured facts — never raw payload/PII.
  const normalized_value: Record<string, unknown> = { role: roleTitle, family: signalType };
  const seniority = typeof job.seniorityLevel === "string" ? job.seniorityLevel.trim() : "";
  if (seniority) normalized_value.seniority = seniority.slice(0, 60);

  const signal: SignalEvent = {
    signal_id: args.signalIdFor ? args.signalIdFor(dedupe_key) : dedupe_key,
    workspace_id: args.workspace_id,
    signal_type: signalType,
    signal_category: "gtm",
    company_ref: args.company_ref,
    person_ref: null,
    evidence_refs,
    source_provider: args.provider ?? "apify",
    actor_key: args.actorKey ?? JOBS_ACTOR_KEY,
    actor_id: args.actorId ?? JOBS_ACTOR_ID,
    source_url: sourceUrl ?? null,
    occurred_at,
    observed_at: args.observedAt,
    confidence: args.confidence ?? "high",
    verification: "provider_verified",
    normalized_value,
    listing_status,
    dedupe_key,
    status: "active",
    provenance: { provider: args.provider ?? "apify", actorKey: args.actorKey ?? JOBS_ACTOR_KEY, actorId: args.actorId ?? JOBS_ACTOR_ID },
    sanitized: true,
  };

  const v = validateSignalEvent(signal);
  if (!v.valid) return { signal: null, rejected: true, reason: "failed_validation" };
  return { signal, rejected: false };
}
