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
// ── THE INVARIANT, AND THE MISSION IT WAS WRITTEN FOR ──────────────────────
//
// This module used to hold one unconditional rule: a company row is NEVER
// quota-eligible and NEVER CONTACT, because only a verified person can be
// CONTACT-ready. On a `contact_ready_leads` mission that is exactly right and it
// is unchanged below — a company with no decision-maker is not the lead the user
// asked for, however well it scored.
//
// On a `qualified_companies` mission it was the wrong question. There the
// company IS the deliverable: the engine counts `qualified_company_keys` toward
// quota, stops on `quota_met` and reports SATISFIED on the strength of Company
// Brain passes alone, no person involved. Writing those same companies as
// `NEEDS_REVIEW` / `quota_eligible: false` made the run's own output contradict
// its own verdict — run e93380bd said 5 of 5 qualified and produced five rows
// that read `company_brain_status: "qualified"` beside `quota_eligible: false`.
//
// So the rule is now conditional on what was asked for, and on nothing else. It
// is NOT conditional on how good the company looked: `brainGate === "pass"` is
// still required, and every other path keeps the old values exactly.

import type { PendingDecisionMaker } from "./compoundSourcingPipeline.ts";
import type { CompoundPersistencePlan } from "./runAgentCompoundPersistenceAdapter.ts";
import { hasStrongId } from "./companyIdentity.ts";

/**
 * What the mission asked for, as far as this projection is concerned.
 *
 * `contact` is the default at every call site that does not say otherwise, so
 * behaviour is unchanged for every caller that has not been taught about
 * missions — the person-first compound pipeline included.
 */
export type CompanyRowDeliverable = "company" | "contact";

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
  deliverable: CompanyRowDeliverable = "contact",
): CompoundPersistencePlan {
  const id = pending.company;
  const identified = hasStrongId(id);
  const job = pending.jobEvidence ?? null;

  // ── IS THIS ROW THE ANSWER, OR A STEP TOWARD ONE? ────────────────────────
  //
  // BOTH conditions, never either alone. The mission must have asked for
  // companies, AND the Company Brain must have actually passed this one. A
  // Brain pass on a contact mission is still pending a person; an unknown or
  // failed gate on a company mission is still unqualified. Neither becomes
  // quota-eligible here.
  const isDeliverable = deliverable === "company" && pending.brainGate === "pass";

  // The stage follows: a company that IS the deliverable and cleared the Brain
  // is qualified, not "waiting for a decision-maker search" that the mission
  // never asked for.
  const stage: CompanyRowStage = isDeliverable ? "company_qualified" : companyRowStage(pending);

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
        // `raw.verdict` is what the Workbench resolver reads as the row's
        // disposition. `qualified` is a QUALIFYING_DISPOSITION there; it says
        // the COMPANY qualified and deliberately does not say `CONTACT`, which
        // would imply a person.
        verdict: isDeliverable ? "QUALIFIED" : "NEEDS_REVIEW",
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
        // NOT "pending" when no person was ever required. `pending` reads as
        // "we are still looking", which on a company mission is a search that
        // is not going to happen and a promise the run will never keep.
        decision_maker_status: isDeliverable
          ? "not_required"
          : (stage === "decision_maker_unverified" ? "unverified" : "pending"),
        // UNCHANGED EITHER WAY. No person means no contact, and a qualified
        // company is still a company — `contactBlocked` below says the same.
        contact_status: "needs_contact",
        // THE ONE FIELD THIS FIX EXISTS FOR. True only when this row is the
        // thing that was asked for and the Brain passed it — which is the exact
        // condition under which the engine already counted it toward quota.
        quota_eligible: isDeliverable,
        // WHY it is quota-eligible, recorded rather than inferable. A row that
        // claims quota credit must be able to say what earned it.
        qualification_basis: isDeliverable ? "company_brain_pass" : null,
        quota_basis: isDeliverable ? "qualified_companies_mission" : null,
      },
    },
    // ── TWO FIELDS NAMED `verdict`, TWO VOCABULARIES ────────────────────────
    //
    // This one is `CompoundVerdict` — CONTACT | WATCH | NEEDS_REVIEW | REJECT —
    // and it is the PERSON verdict of the compound pipeline. It drives
    // `VERDICT_TO_CEIL`, so `CONTACT` here would grant this row a contact
    // ceiling it must never have. A company row has no person to judge, so
    // `NEEDS_REVIEW` is the honest value and is UNCHANGED by this fix.
    //
    // The row's own qualification lives in `raw.verdict` above, which is what
    // the Workbench reads. Confusing these two is what this module now names
    // explicitly rather than leaving for the next reader to work out.
    verdict: "NEEDS_REVIEW",
    persistable: identified,
    persistenceReason: identified ? `company_row_persistable:${stage}` : "company_identity_unresolved",
    // STILL BLOCKED, STILL FOR THE SAME REASON. Qualifying a company does not
    // produce a decision-maker, and nothing downstream may read this row as
    // permission to send anything.
    contactBlocked: true,
    blockReasons: isDeliverable
      ? ["no_verified_decision_maker", "contact_not_requested"]
      : ["no_verified_decision_maker", `pending:${pending.reason}`],
  };
}
