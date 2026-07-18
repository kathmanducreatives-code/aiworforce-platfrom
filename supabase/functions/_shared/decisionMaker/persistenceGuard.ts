// Persistence guard for discovered decision-makers. Pure — decides, never writes.
//
// The caller performs the write only when this returns ok. Keeping the decision
// pure means the rule "a probable match is never auto-persisted" is testable
// without a database.

import { normalizePersonLinkedInUrl } from "./personProfile.ts";
import { isTargetRoleFamily, type DecisionMakerRoleFamily } from "./roleFamily.ts";
import type { EmployerVerificationStatus } from "./employerVerification.ts";

export interface PersistenceCandidate {
  full_name: string | null;
  linkedin_url: string | null;
  role_family: DecisionMakerRoleFamily;
  verification_status: EmployerVerificationStatus;
  /** Provenance is mandatory — an unattributable contact can't be audited. */
  provenance: {
    provider: string | null;
    actor: string | null;
    stage: string | null;
    verification_methods: string[];
  } | null;
}

export interface PersistenceContext {
  workspace_id: string;
  /** Workspace the lead actually belongs to, resolved server-side. */
  lead_workspace_id: string;
  /** Normalized LinkedIn URLs already stored for this workspace. */
  existing_contact_urls: string[];
}

export type PersistenceDecision =
  | { ok: true; normalized_linkedin_url: string }
  | { ok: false; reason_code: string };

/**
 * Decide whether a candidate may be written to contacts.
 *
 * Deliberately strict: only a VERIFIED current employee in a target role family,
 * with a valid profile URL, retained provenance, and no existing duplicate, in a
 * workspace that actually owns the lead.
 */
export function decidePersistence(
  candidate: PersistenceCandidate,
  ctx: PersistenceContext,
): PersistenceDecision {
  // Workspace ownership is checked before anything about the person.
  if (!ctx.workspace_id || ctx.workspace_id !== ctx.lead_workspace_id) {
    return { ok: false, reason_code: "lead_not_in_workspace" };
  }

  if (candidate.verification_status !== "verified") {
    return {
      ok: false,
      reason_code: candidate.verification_status === "probable"
        ? "probable_requires_manual_review"
        : "employer_not_verified",
    };
  }

  if (!isTargetRoleFamily(candidate.role_family)) {
    return { ok: false, reason_code: "role_not_target" };
  }

  const url = normalizePersonLinkedInUrl(candidate.linkedin_url);
  if (!url) return { ok: false, reason_code: "invalid_profile_url" };

  if (!candidate.full_name) return { ok: false, reason_code: "missing_name" };

  if (!candidate.provenance || !candidate.provenance.verification_methods?.length) {
    return { ok: false, reason_code: "missing_provenance" };
  }

  const existing = new Set(
    (ctx.existing_contact_urls ?? [])
      .map((u) => normalizePersonLinkedInUrl(u))
      .filter((u): u is string => !!u),
  );
  if (existing.has(url)) return { ok: false, reason_code: "duplicate_contact" };

  return { ok: true, normalized_linkedin_url: url };
}
