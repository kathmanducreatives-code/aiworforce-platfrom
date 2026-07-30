// COMPANY-ROW PROJECTION — the missing handoff between a qualified company and
// the canonical Workbench.
//
// The company-first pipeline only ever emitted PERSON-level candidates. A company
// that cleared job-family, geography, identity resolution and Company Brain but
// produced no verified decision-maker was returned as `pendingDecisionMakers` and
// then dropped: nothing was persisted, so the canonical Workbench (which reads
// `lead_candidates`) stayed empty while the raw job posts were still visible from
// `tool_calls.output_json`. That is the Path A / Path B disconnect.
//
// This module is PURE (no DB, no clock, no network). It maps one qualified-but-
// pending company onto the SAME `CompoundPersistencePlan` the existing safe writer
// already executes — no second ingestion pipeline, no second writer, no second
// Workbench view.
//
// INVARIANT: a company row is NEVER quota-eligible and NEVER CONTACT. Only a
// verified person, through `compoundContactCeiling`, can be CONTACT-ready.

import type { PendingDecisionMaker } from "./compoundSourcingPipeline.ts";
import type { CompoundPersistencePlan } from "./runAgentCompoundPersistenceAdapter.ts";
import { hasStrongId } from "./companyIdentity.ts";

/** Layer-9 Workbench progression for an account row. */
export type CompanyRowStage =
  | "company_resolution_pending"
  | "company_resolved"
  | "company_qualification_pending"
  | "company_qualified"
  | "decision_maker_search_pending"
  | "decision_maker_unverified";

/**
 * Deterministic stage for a pending company. Ordered from the weakest fact to
 * the strongest so a row can only ever describe what was actually established.
 */
export function companyRowStage(pending: PendingDecisionMaker): CompanyRowStage {
  if (pending.reason === "company_identity_insufficient_for_scoped_search") {
    return "company_resolution_pending";
  }
  if (pending.brainGate === "unknown") return "company_qualification_pending";
  if (pending.reason === "decision_maker_unverified") return "decision_maker_unverified";
  return "decision_maker_search_pending";
}

/** Stable identity for cross-round company-row deduplication. */
export function companyRowKey(pending: PendingDecisionMaker): string {
  const id = pending.company;
  return (id.dedupeKey ?? id.canonicalDomain ?? id.linkedinUrl ?? id.normalizedName ?? id.name ?? "").toLowerCase();
}

/**
 * Project a qualified-but-pending company into an account-stage persistence plan.
 *
 * `persistable` is true only when the company is verifiably identified — a
 * name-only company would otherwise create an unresolvable Workbench row.
 */
export function buildCompanyRowPersistencePlan(
  pending: PendingDecisionMaker,
  workspaceId: string,
): CompoundPersistencePlan {
  const id = pending.company;
  const identified = hasStrongId(id);
  const stage = companyRowStage(pending);
  const job = pending.jobEvidence ?? null;

  return {
    workspaceId,
    account: identified
      ? {
        name: id.name,
        domain: id.canonicalDomain,
        linkedinUrl: id.linkedinUrl,
        description: job?.companyDescription ?? null,
      }
      : null,
    // An account-stage row has no person yet — by definition.
    contact: null,
    leadCandidate: {
      lead_type: "account",
      reason: job?.title ? `Hiring signal: ${job.title}` : null,
      next_action: stage === "company_resolution_pending" ? "resolve_company" : "find_decision_maker",
      raw: {
        compound: true,
        row_kind: "company",
        workbench_stage: stage,
        verdict: "NEEDS_REVIEW",
        pending_reason: pending.reason,
        company_name: id.name ?? null,
        company_domain: id.canonicalDomain ?? null,
        company_linkedin_url: id.linkedinUrl ?? null,
        company_identity_key: id.dedupeKey ?? null,
        company_resolution_status: identified ? "verified" : "unresolved",
        company_brain_status: pending.brainGate === "pass"
          ? "qualified"
          : pending.brainGate === "fail"
          ? "rejected"
          : "evidence_pending",
        company_type_status: pending.verticalOutcome ?? null,
        job_evidence: job
          ? { title: job.title, url: job.url, location: job.location, posted: job.postedDate }
          : null,
        hiring_signal_title: job?.title ?? null,
        hiring_signal_url: job?.url ?? null,
        hiring_signal_date: job?.postedDate ?? null,
        decision_maker_status: stage === "decision_maker_unverified" ? "unverified" : "pending",
        contact_status: "needs_contact",
        // HARD INVARIANT: a company row never counts toward the CONTACT quota.
        quota_eligible: false,
      },
    },
    verdict: "NEEDS_REVIEW",
    persistable: identified,
    persistenceReason: identified ? `company_row_persistable:${stage}` : "company_identity_unresolved",
    contactBlocked: true,
    blockReasons: ["no_verified_decision_maker", `pending:${pending.reason}`],
  };
}
