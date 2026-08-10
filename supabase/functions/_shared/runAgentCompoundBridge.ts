// Bridge between run-agent orchestration and the deterministic compound modules.
//
// Pure + testable. run-agent imports these to (a) detect a company-first request
// and (b) enforce the verified-company CONTACT ceiling on the person path, so an
// accountless / off-company / evidence-less compound candidate can never be
// marked CONTACT regardless of any AI score — the exact production failure.

import type { LeadEntityIntent } from "./leadEntityIntent.ts";
import type { EmployerMatchOutcome } from "./employerVerification.ts";

/** True when the request must be sourced company-first (verify the company + its
 *  signal, then find the person inside it). */
export function isCompanyFirstRequest(intent: Pick<LeadEntityIntent, "company_gate_required" | "execution_mode">): boolean {
  return intent.company_gate_required === true && intent.execution_mode === "company_first";
}

export type ContactCeiling = "contact" | "watch" | "needs_review" | "reject";

export interface CompoundGateInput {
  companyGateRequired: boolean;
  /** A canonical account/company identity is bound to the candidate. */
  hasVerifiedAccount: boolean;
  /** Deterministic current-employer verification result (null = not evaluated). */
  employer: EmployerMatchOutcome | null;
  /** The attached hiring-evidence URL (required for a company-signal request). */
  jobEvidenceUrl: string | null | undefined;
  /** Whether the person's role matches the requested role (true/false/unknown). */
  personRoleMatch: boolean | "unknown";
}

/**
 * The HIGHEST verdict a compound candidate may receive. A failed hard fact caps
 * at "reject"; an unproven-but-not-contradicted fact caps at "needs_review";
 * everything verified allows "contact". A non-compound request is uncapped.
 * An AI score can only choose AT OR BELOW this ceiling — never above it.
 */
export function compoundContactCeiling(x: CompoundGateInput): ContactCeiling {
  if (!x.companyGateRequired) return "contact";
  if (!x.hasVerifiedAccount) return "needs_review";        // account_id = null → never CONTACT
  if (!x.jobEvidenceUrl) return "reject";                  // required hiring evidence missing
  if (x.personRoleMatch === false) return "reject";        // wrong role (advisor/former/etc.)
  switch (x.employer) {
    case "verified_mismatch":
    case "historical_only":
      return "reject";                                     // off-company / not current
    case "ambiguous":
    case "insufficient_evidence":
    case null:
      return "needs_review";                               // unproven current employer
    case "verified_match":
      break;
  }
  if (x.personRoleMatch === "unknown") return "needs_review";
  return "contact";
}

/** Clamp a proposed verdict to the ceiling (deterministic; score cannot exceed it). */
const RANK: Record<ContactCeiling, number> = { contact: 0, watch: 1, needs_review: 2, reject: 3 };
export function clampToCeiling(proposed: ContactCeiling, ceiling: ContactCeiling): ContactCeiling {
  return RANK[proposed] >= RANK[ceiling] ? proposed : ceiling;
}
