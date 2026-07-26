// FINAL-LEAD QUOTA POLICY — the concept the audit found missing entirely.
//
// The v96 run had `requested_count: null`; the only 25 in the system was
// DEFAULT_COMPOUND_LIMITS.rawJobs, a PROVIDER FETCH CAP. Raw batch size and the
// number of leads a user actually wants are different quantities that happen to
// share a digit. They are separate fields here, permanently.
//
//   requestedLeadCount  — how many ELIGIBLE leads to deliver   (this module)
//   rawJobsPerRound     — how many raw provider rows to fetch  (CompoundLimits)

import type { CompoundCandidate } from "./compoundSourcingPipeline.ts";

/** Product default for the lead-sourcing workflow ONLY. Never applied to generic
 * tool calls, lead actions, or non-sourcing tasks. */
export const DEFAULT_REQUESTED_LEAD_COUNT = 25;
export const MIN_REQUESTED_LEAD_COUNT = 1;
/** Consistent with the existing provider ceiling (max_results is clamped to 100). */
export const MAX_REQUESTED_LEAD_COUNT = 100;

export type RequestedCountSource = "explicit" | "workflow_default" | "legacy_default";

export interface ResolvedLeadQuota {
  requestedLeadCount: number;
  source: RequestedCountSource;
  /** Set when the caller supplied something unusable; the value was clamped. */
  clamped: boolean;
  invalidReason: string | null;
}

/**
 * Resolve the final-lead quota. An explicit request wins; otherwise the
 * lead-sourcing default applies — but ONLY when this is a lead-sourcing workflow.
 */
export function resolveRequestedLeadCount(input: {
  explicit?: number | string | null | undefined;
  isLeadSourcingWorkflow: boolean;
  legacyFallback?: number | null;
}): ResolvedLeadQuota {
  const raw = input.explicit;
  if (raw !== null && raw !== undefined && `${raw}`.trim() !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.floor(n) !== n || n < MIN_REQUESTED_LEAD_COUNT) {
      // Unsafe/invalid → clamp through the existing convention rather than throw.
      return {
        requestedLeadCount: Math.min(MAX_REQUESTED_LEAD_COUNT, Math.max(MIN_REQUESTED_LEAD_COUNT, Math.floor(Number.isFinite(n) ? n : DEFAULT_REQUESTED_LEAD_COUNT))),
        source: "explicit", clamped: true,
        invalidReason: `requested_lead_count must be an integer >= ${MIN_REQUESTED_LEAD_COUNT}`,
      };
    }
    if (n > MAX_REQUESTED_LEAD_COUNT) {
      return { requestedLeadCount: MAX_REQUESTED_LEAD_COUNT, source: "explicit", clamped: true, invalidReason: `requested_lead_count capped at ${MAX_REQUESTED_LEAD_COUNT}` };
    }
    return { requestedLeadCount: n, source: "explicit", clamped: false, invalidReason: null };
  }

  if (input.isLeadSourcingWorkflow) {
    return { requestedLeadCount: DEFAULT_REQUESTED_LEAD_COUNT, source: "workflow_default", clamped: false, invalidReason: null };
  }
  // A non-sourcing task must NOT inherit the sourcing default.
  const legacy = Math.max(MIN_REQUESTED_LEAD_COUNT, Math.floor(input.legacyFallback ?? MIN_REQUESTED_LEAD_COUNT));
  return { requestedLeadCount: legacy, source: "legacy_default", clamped: false, invalidReason: null };
}

// ------------------------------------------------------- eligibility ----

export type QuotaPolicy = "contact_only" | "contact_and_watch";
export const DEFAULT_QUOTA_POLICY: QuotaPolicy = "contact_only";

/**
 * The canonical definition of a DELIVERED lead.
 *
 * CONTACT counts. WATCH/NEEDS_REVIEW counts only under an explicit non-default
 * policy. REJECT/SKIP never count — a rejected row is not work delivered to the
 * user, and counting it is what let a 0-CONTACT run report `completed`.
 */
export function isQuotaEligibleCandidate(
  candidate: { verdict?: string | null } | null | undefined,
  policy: QuotaPolicy = DEFAULT_QUOTA_POLICY,
): boolean {
  const v = (candidate?.verdict ?? "").toUpperCase();
  if (v === "REJECT" || v === "SKIP") return false;
  if (v === "CONTACT") return true;
  if (policy === "contact_and_watch") return v === "WATCH" || v === "NEEDS_REVIEW";
  return false;
}

/**
 * Stable cross-round lead identity, most reliable evidence first:
 *   1. verified company identity + person profile URL
 *   2. canonical account id + contact identity
 *   3. company domain + normalized person name
 *   4. safe fallback
 */
export function leadIdentityKey(c: CompoundCandidate): string {
  const company = c.account?.canonicalDomain || c.account?.linkedinCompanyId || c.account?.linkedinUrl
    || c.account?.normalizedName || "unknown-company";
  const person = c.person?.linkedinUrl
    ? String(c.person.linkedinUrl).replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase()
    : (c.person?.name ?? "").toLowerCase().replace(/\s+/g, " ").trim() || "unknown-person";
  return `${company}::${person}`;
}

export function countEligible(candidates: CompoundCandidate[], policy: QuotaPolicy = DEFAULT_QUOTA_POLICY): number {
  const seen = new Set<string>();
  let n = 0;
  for (const c of candidates) {
    const k = leadIdentityKey(c);
    if (seen.has(k)) continue;      // dedupe BEFORE counting
    seen.add(k);
    if (isQuotaEligibleCandidate(c, policy)) n++;
  }
  return n;
}

export function remainingLeadCount(requested: number, eligible: number): number {
  return Math.max(0, requested - eligible);
}
