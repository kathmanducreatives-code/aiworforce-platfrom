// THE MISSION PATH'S HANDOFF INTO THE CANONICAL LEAD LIBRARY.
//
// WHAT WAS MISSING.
//
// A mission hiring run produced `tasks.result.workbench_*` and nothing else. The
// Workbench could render it; the Lead Library stayed empty. That is the same
// Path A / Path B disconnect `companyRowProjection` was written to close for the
// company-first pipeline — a company that cleared identity, enrichment and the
// Company Brain was visible as progress and absent as a record.
//
// `leadWorkbenchProjection`'s own header states the intended split, and it is the
// contract this module implements:
//
//   QUALIFIED rows  → `lead_candidates`. Real records. Written only on an
//                     explicit Brain pass, by the existing persistence path.
//   EVALUATION rows → `tasks.result.workbench_evaluation_rows`. Evidence of work
//                     done, never actionable.
//
// The two are COMPLEMENTARY, not alternatives: `projectEvaluationRows` skips a
// company once it qualifies, and this projection picks it up at exactly that
// point. Together they account for every company the run touched.
//
// ── NO SECOND PERSISTENCE SYSTEM ────────────────────────────────────────────
//
// This module writes nothing and knows no SQL. It MAPS an `EngineCompany` onto
// the `PendingDecisionMaker` shape that `buildCompanyRowPersistencePlan` already
// takes, and that function — unchanged — produces the same
// `CompoundPersistencePlan` the canonical `persistPlan` already executes. Same
// projection, same writer, same invariants:
//
//   * an account row is NEVER `CONTACT` and never quota-eligible;
//   * `persistable` is false for a company without a strong identifier;
//   * dedup uses `companyRowKey`, the existing key.
//
// ── THE MISSION REMAINS THE SEMANTIC AUTHORITY ──────────────────────────────
//
// Every field below comes from the ENGINE'S OWN RESULT — normalized provider
// rows, resolved identity, enrichment, the hiring assessment and the Brain
// verdict. Nothing here reads `original_user_query`, and nothing parses text.
//
// PURE. No network, provider, model or database access.

import type { EngineCompany } from "./leadCapabilityEngine.ts";
import type { CompoundJob, PendingDecisionMaker } from "./compoundSourcingPipeline.ts";
import type { CompoundPersistencePlan } from "./runAgentCompoundPersistenceAdapter.ts";
import {
  buildCompanyRowPersistencePlan, companyRowKey,
} from "./companyRowProjection.ts";
import { resolveCompanyIdentity, type CompanyIdentity } from "./companyIdentity.ts";
import { identityIsActionable } from "./companyIdentityResolution.ts";

export const MISSION_PERSISTENCE_PROJECTION_VERSION =
  "lead-mission-persistence-projection-v1" as const;

export interface MissionCompanyRow {
  /** `companyRowKey` — the existing cross-round dedup identity. */
  key: string;
  /** The engine's own key, for correlating a row with the run's diagnostics. */
  company_key: string;
  plan: CompoundPersistencePlan;
}

export interface MissionPersistenceProjection {
  version: typeof MISSION_PERSISTENCE_PROJECTION_VERSION;
  rows: MissionCompanyRow[];
  /** Companies that qualified but cannot be persisted, and why. */
  skipped: Array<{ company_key: string; reason: string }>;
}

/**
 * The company's canonical identity, assembled from the strongest source first.
 *
 * Enrichment measured the company; discovery merely found it. Identity
 * resolution is what proved the LinkedIn URL, so it outranks whatever the
 * discovery row happened to carry.
 */
function identityFor(c: EngineCompany): CompanyIdentity {
  const enriched = c.enriched ?? c.company;
  const resolvedUrl = c.identity && identityIsActionable(c.identity)
    ? c.identity.linkedin_company_url
    : null;
  return resolveCompanyIdentity({
    name: enriched.company_name ?? c.company.company_name,
    domain: enriched.canonical_domain ?? c.company.canonical_domain,
    website_url: enriched.website ?? c.company.website,
    linkedin_url: resolvedUrl ?? enriched.linkedin_company_url ?? c.company.linkedin_company_url,
    location: enriched.geography ?? c.company.geography,
  });
}

/**
 * The hiring signal that made this company an opportunity.
 *
 * Verified jobs first — those were proven against the company by
 * `hiring_verification`. Embedded YC roles are the free evidence the assessment
 * settled on when no paid check was needed; they are the company's own openings
 * and are legitimate evidence, but they rank second because they were not
 * checked against the resolved identity.
 *
 * Returns null when the run proved no opening at all, which is a fact the row
 * should carry rather than a gap to fill in.
 */
function jobEvidenceFor(c: EngineCompany): CompoundJob | null {
  const job = c.hiring_jobs[0] ?? c.yc_open_jobs[0] ?? null;
  if (!job) return null;
  const enriched = c.enriched ?? c.company;
  return {
    title: job.title ?? null,
    company: enriched.company_name ?? c.company.company_name ?? null,
    companyDomain: enriched.canonical_domain ?? null,
    companyWebsite: enriched.website ?? null,
    companyLinkedinUrl: enriched.linkedin_company_url ?? null,
    companyDescription: enriched.description ?? null,
    location: job.location ?? null,
    url: job.job_url ?? null,
    ...(job.posted_date ? { postedDate: job.posted_date } : {}),
  };
}

/**
 * Why this company has no decision maker attached.
 *
 * On the mission path the answer is structural and always the same: founder
 * discovery, employer verification and contact enrichment are OFFERS — the
 * capability graph puts all three in `offered_capabilities` and `prohibited`, so
 * no people search ran and none could have. The nearest honest existing reason
 * is that the scoped search has not happened yet.
 *
 * The one exception is a company whose identity never resolved: a scoped search
 * could not have run for it even if people were unlocked, and the existing
 * vocabulary has a value that says exactly that.
 */
function pendingReasonFor(c: EngineCompany): PendingDecisionMaker["reason"] {
  const resolved = !!c.identity && identityIsActionable(c.identity);
  return resolved
    ? "no_decision_maker_returned"
    : "company_identity_insufficient_for_scoped_search";
}

function brainGateFor(c: EngineCompany): "pass" | "fail" | "unknown" {
  if (c.verdict === "pass") return "pass";
  if (c.verdict === "reject") return "fail";
  return "unknown";
}

/**
 * Project a mission run's QUALIFIED companies into canonical persistence plans.
 *
 * ONLY an explicit Brain pass reaches the Lead Library. A company held for
 * review or rejected is evidence of work done and belongs in the evaluation
 * rows, which is where `projectEvaluationRows` already puts it — writing it here
 * would be the fail-open hole that projection exists to keep closed.
 *
 * Deduplicated by `companyRowKey` within the run, so the same company surfacing
 * under two discovery concepts produces one row.
 */
export function projectMissionCompanyRows(
  companies: readonly EngineCompany[], workspaceId: string,
): MissionPersistenceProjection {
  const rows: MissionCompanyRow[] = [];
  const skipped: MissionPersistenceProjection["skipped"] = [];
  const seen = new Set<string>();

  for (const c of companies) {
    if (c.verdict !== "pass") continue;

    const pending: PendingDecisionMaker = {
      company: identityFor(c),
      reason: pendingReasonFor(c),
      jobEvidence: jobEvidenceFor(c),
      brainGate: brainGateFor(c),
      verticalOutcome: c.fit?.stage ?? null,
    };

    const key = companyRowKey(pending);
    if (!key) {
      skipped.push({ company_key: c.key, reason: "no_dedupe_identity" });
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);

    // The EXISTING projection, unchanged. It decides `persistable`, the account
    // binding and the never-CONTACT invariant — this module does not restate any
    // of that.
    const plan = buildCompanyRowPersistencePlan(pending, workspaceId);
    if (!plan.persistable) {
      skipped.push({ company_key: c.key, reason: plan.persistenceReason });
      continue;
    }
    rows.push({ key, company_key: c.key, plan });
  }

  return { version: MISSION_PERSISTENCE_PROJECTION_VERSION, rows, skipped };
}

/** Compact shape for logs and audit rows. Writes nothing. */
export function missionPersistenceSummary(
  p: MissionPersistenceProjection, persisted: number,
): Record<string, unknown> {
  return {
    version: p.version,
    planned: p.rows.length,
    persisted,
    skipped: p.skipped.map((s) => `${s.company_key}:${s.reason}`),
  };
}
