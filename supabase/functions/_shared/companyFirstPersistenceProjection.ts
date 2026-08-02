// COMPANY-FIRST RESULTS → THE CANONICAL PERSISTENCE CONTRACT.
//
// The company-first executor produces stages and evidence; the qualified-lead
// pipeline already owns accounts, contacts, lead_candidates, contact enrichment
// and quota. This module is the ADAPTER between them. It deliberately creates no
// table, no contract and no enrichment path of its own — everything it emits is
// a `CompoundPersistencePlan`, which `persistPlan` in run-agent already knows how
// to write and already routes into contact enrichment.
//
// ── WHAT COUNTS ──────────────────────────────────────────────────────────────
// Only CONTACT with quota_eligible=true. A qualified company is real progress
// and is persisted so the Workbench can show it, but it is NOT a lead: it is
// persisted as an account-level record that can never be quota-eligible. That
// separation is the entire point — the historical failure mode is a funnel that
// reports work as leads.
//
// Pure. No I/O.

import type { CompoundPersistencePlan } from "./runAgentCompoundPersistenceAdapter.ts";
import type { CompanyFirstRouteResult } from "./companyFirstRouteExecutor.ts";
import { countsTowardQuota, type LeadVerdict } from "./companyFirstStages.ts";

export interface ProjectedPlan {
  plan: CompoundPersistencePlan;
  /** Stable across retries and resumes — the dedupe key persistence relies on. */
  idempotencyKey: string;
  stage: string;
  quotaEligible: boolean;
}

export interface ProjectionResult {
  plans: ProjectedPlan[];
  counts: {
    accounts_projected: number;
    people_projected: number;
    contact_ready: number;
    quota_eligible: number;
    blocked: number;
  };
}

const s = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * Project one route result into canonical persistence plans.
 *
 * Two kinds of record come out:
 *   * ACCOUNT-level, for every company that reached qualified_company but has no
 *     verified founder yet. Persisted so the Workbench keeps showing the work,
 *     never quota-eligible.
 *   * PERSON-level, one per verified founder. Only these can become CONTACT.
 */
export function projectCompanyFirstPersistence(
  result: CompanyFirstRouteResult, workspaceId: string, taskId: string,
): ProjectionResult {
  const plans: ProjectedPlan[] = [];
  let accounts = 0, people = 0, contactReady = 0, quotaEligible = 0, blocked = 0;

  for (const row of result.companies) {
    const rec = row.record;
    const enriched = row.enriched;
    const company = enriched ?? row.company;
    const linkedinUrl = row.identity.linkedin_company_url ?? company.linkedin_company_url;
    const reachedQualified = rec.history.some((h) => h.stage === "qualified_company");

    // Evidence carried on EVERY record, pass or reject. A rejected company keeps
    // its exact gate reasons — an audit that only explains successes is useless.
    const evidence = {
      source: "company_first_route",
      task_id: taskId,
      stage: rec.stage,
      stage_history: rec.history,
      stage_reason: rec.stage_reason,
      failed_gates: rec.failed_gates,
      missing_evidence: rec.missing_evidence,
      aggregator_evidence: rec.aggregator,
      identity: {
        status: row.identity.status,
        evidence: row.identity.evidence,
        linkedin_company_url: linkedinUrl,
      },
      // BOTH provenances survive. Discovery evidence is not overwritten by
      // enrichment; the Brain read the enriched one and that is recorded.
      discovery_evidence: {
        source_provenance: row.company.source_provenance,
        external_source_id: row.company.external_source_id,
        startup_evidence: row.company.startup_evidence,
        employee_range_advisory: row.company.employee_range_advisory,
      },
      enrichment_evidence: enriched
        ? {
          source_provenance: enriched.source_provenance,
          employee_count: enriched.employee_count,
          industry_ids: enriched.industry_ids,
          company_type: enriched.company_type,
          geography: enriched.geography,
        }
        : null,
      hiring_evidence: row.hiring_jobs.map((j) => ({
        job_id: j.job_id, title: j.title, job_url: j.job_url,
        posted_date: j.posted_date, company_linkedin_url: j.company_linkedin_url,
        source: j.source,
      })),
    };

    const account = linkedinUrl || company.canonical_domain
      ? {
        name: company.company_name,
        domain: company.canonical_domain,
        linkedinUrl,
        description: company.description,
      }
      : null;

    // ── ACCOUNT-LEVEL RECORD ────────────────────────────────────────────────
    // Qualified companies are persisted even with no founder yet, so the
    // Workbench does not hide completed work behind a pending enrichment.
    if (reachedQualified && row.founders.length === 0) {
      accounts++;
      plans.push({
        idempotencyKey: `cf:account:${taskId}:${rec.company_key}`,
        stage: rec.stage,
        quotaEligible: false,
        plan: {
          workspaceId,
          account,
          contact: null,
          leadCandidate: {
            lead_type: "account",
            reason: hiringReason(row.hiring_jobs, company.company_name),
            next_action: "founder_discovery_pending",
            raw: { ...evidence, record_kind: "qualified_company" },
          },
          // A company is never a contactable lead. WATCH keeps it visible
          // without ever letting it reach the quota.
          verdict: "WATCH",
          persistable: !!account,
          persistenceReason: account ? "qualified_company" : "unverifiable_account",
          contactBlocked: true,
          blockReasons: ["account_level_record_not_a_person_lead"],
        },
      });
      continue;
    }

    // ── PERSON-LEVEL RECORDS ────────────────────────────────────────────────
    for (const f of row.founders) {
      people++;
      // CONTACT requires: a verified account, a verified current employer, and a
      // real hiring signal. Anything short of that is review, not a lead.
      const employerVerified = f.current_employer_is_current === true &&
        !!f.current_employer_linkedin_url;
      const hasHiring = row.hiring_jobs.length > 0;
      const verdict: LeadVerdict = account && employerVerified && hasHiring
        ? "CONTACT"
        : employerVerified ? "NEEDS_REVIEW" : "REJECT";
      const eligible = verdict === "CONTACT" && !!account;
      if (verdict === "CONTACT") contactReady++;
      if (countsTowardQuota(verdict, eligible)) quotaEligible++;
      if (verdict === "REJECT") blocked++;

      plans.push({
        // Keyed on the STABLE profile id, never the opaque LinkedIn URL.
        idempotencyKey: `cf:person:${taskId}:${rec.company_key}:${f.source_profile_id ?? f.full_name}`,
        stage: verdict === "CONTACT" ? "contact_pending" : rec.stage,
        quotaEligible: eligible,
        plan: {
          workspaceId,
          account,
          contact: { name: f.full_name, title: f.title, linkedinUrl: f.linkedin_url },
          leadCandidate: {
            lead_type: "person",
            reason: hiringReason(row.hiring_jobs, company.company_name),
            next_action: verdict === "CONTACT" ? "contact_enrichment" : "manual_review",
            raw: {
              ...evidence,
              record_kind: "founder",
              person: {
                source_profile_id: f.source_profile_id,
                current_employer: f.current_employer,
                current_employer_linkedin_url: f.current_employer_linkedin_url,
                current_employer_is_current: f.current_employer_is_current,
                tenure_years: f.tenure_years,
                source_provenance: f.source_provenance,
              },
            },
          },
          verdict: verdict as CompoundPersistencePlan["verdict"],
          // REJECT is diagnostics only — the canonical policy already forbids
          // writing accounts/contacts for it.
          persistable: verdict !== "REJECT" && !!account,
          persistenceReason: verdict === "REJECT" ? "employer_not_verified" : "company_first_founder",
          contactBlocked: verdict !== "CONTACT",
          blockReasons: verdict === "CONTACT" ? [] :
            [employerVerified ? "no_hiring_evidence" : "employer_unverified"],
        },
      });
    }
  }

  return {
    plans,
    counts: {
      accounts_projected: accounts, people_projected: people,
      contact_ready: contactReady, quota_eligible: quotaEligible, blocked,
    },
  };
}

/** A grounded reason-to-contact-now, built only from observed job evidence. */
function hiringReason(
  jobs: CompanyFirstRouteResult["companies"][number]["hiring_jobs"],
  companyName: string | null,
): string | null {
  const j = jobs[0];
  if (!j || !s(j.title)) return null;
  const co = s(companyName) ?? "the company";
  return `${co} is hiring ${j.title}${j.posted_date ? ` (posted ${j.posted_date.slice(0, 10)})` : ""}.`;
}

/**
 * Quota credit from PERSISTED outcomes.
 *
 * Reads the same rule as the funnel so the two can never disagree: a company,
 * a hiring signal and a verified founder are all worth zero.
 */
export function quotaCreditFromProjection(p: ProjectionResult): number {
  return p.plans.filter((x) => countsTowardQuota(
    x.plan.verdict as LeadVerdict, x.quotaEligible)).length;
}
