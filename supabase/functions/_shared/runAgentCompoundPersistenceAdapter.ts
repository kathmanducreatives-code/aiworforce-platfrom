// Persistence-plan adapter: a gated compound candidate → a deterministic, safe
// persistence PLAN. Pure (no DB) so it is unit-testable; the runtime executes the
// plan through the existing PR #85 safe-association writer. Enforces the
// verified-company CONTACT invariant: an accountless / off-company / evidence-less
// candidate can NEVER be planned as CONTACT.

import type { CompoundCandidate, CompoundVerdict } from "./compoundSourcingPipeline.ts";
import { compoundContactCeiling, clampToCeiling, type ContactCeiling } from "./runAgentCompoundBridge.ts";
import { hasStrongId } from "./companyIdentity.ts";

export interface CompoundPersistencePlan {
  workspaceId: string;
  /** Canonical account to upsert (null only when unverifiable — then never CONTACT). */
  account: { name: string | null; domain: string | null; linkedinUrl: string | null; description: string | null } | null;
  contact: { name: string | null; title: string | null; linkedinUrl: string | null } | null;
  /** The lead_candidate row payload (person lead), evidence carried in raw. */
  leadCandidate: {
    lead_type: "person";
    reason: string | null;      // grounded why-now
    next_action: string;
    raw: Record<string, unknown>;
  };
  /** Final verdict AFTER the ceiling clamp — a score can never exceed this. */
  verdict: CompoundVerdict;
  /** True when this candidate must NOT be persisted as a contactable lead. */
  contactBlocked: boolean;
  blockReasons: string[];
}

const CEIL_TO_VERDICT: Record<ContactCeiling, CompoundVerdict> = { contact: "CONTACT", watch: "WATCH", needs_review: "NEEDS_REVIEW", reject: "REJECT" };
const VERDICT_TO_CEIL: Record<CompoundVerdict, ContactCeiling> = { CONTACT: "contact", WATCH: "watch", NEEDS_REVIEW: "needs_review", REJECT: "reject" };

export function buildCompoundPersistencePlan(candidate: CompoundCandidate, workspaceId: string): CompoundPersistencePlan {
  const hasVerifiedAccount = candidate.account.dedupeKey != null && hasStrongId(candidate.account);
  const ceiling = compoundContactCeiling({
    companyGateRequired: true,
    hasVerifiedAccount,
    employer: candidate.employer.outcome,
    jobEvidenceUrl: candidate.jobEvidence.url,
    personRoleMatch: candidate.gates.person_role === "pass" ? true : candidate.gates.person_role === "fail" ? false : "unknown",
  });
  const finalCeiling = clampToCeiling(VERDICT_TO_CEIL[candidate.verdict], ceiling);
  const verdict = CEIL_TO_VERDICT[finalCeiling];
  const contactBlocked = verdict !== "CONTACT";

  const blockReasons: string[] = [];
  if (!hasVerifiedAccount) blockReasons.push("no_verified_account");
  if (candidate.employer.outcome !== "verified_match") blockReasons.push(`employer:${candidate.employer.outcome}`);
  if (!candidate.jobEvidence.url) blockReasons.push("missing_job_evidence");
  if (candidate.gates.person_role !== "pass") blockReasons.push(`role:${candidate.gates.person_role}`);

  return {
    workspaceId,
    // Only bind an account when it is verifiably identified.
    account: hasVerifiedAccount
      ? { name: candidate.account.name, domain: candidate.account.canonicalDomain, linkedinUrl: candidate.account.linkedinUrl, description: candidate.jobEvidence.companyDescription ?? null }
      : null,
    contact: candidate.person.name || candidate.person.linkedinUrl
      ? { name: candidate.person.name, title: candidate.person.title, linkedinUrl: candidate.person.linkedinUrl ?? null }
      : null,
    leadCandidate: {
      lead_type: "person",
      reason: verdict === "CONTACT" ? candidate.whyNow : null,
      next_action: verdict === "CONTACT" ? "review_and_contact" : verdict === "WATCH" ? "watch" : verdict === "NEEDS_REVIEW" ? "review" : "reject",
      raw: {
        compound: true,
        query_intent: candidate.jobEvidence.title ? candidate.whyNow : null,
        verdict,
        gates: candidate.gates,
        gate_reasons: candidate.reasons,
        employer_verification: candidate.employer.outcome,
        vertical: candidate.vertical.vertical,
        vertical_outcome: candidate.vertical.outcome,
        why_now: verdict === "CONTACT" ? candidate.whyNow : null,
        outreach_angle: verdict === "CONTACT" ? candidate.opener : null,
        job_evidence: { title: candidate.jobEvidence.title, url: candidate.jobEvidence.url, location: candidate.jobEvidence.location, posted: candidate.jobEvidence.postedDate },
        evidence_ids: candidate.evidence.map((e) => e.id),
        source_actor: { jobs: "curious_coder/linkedin-jobs-scraper", people: "harvestapi/linkedin-profile-search" },
      },
    },
    verdict,
    contactBlocked,
    blockReasons,
  };
}
