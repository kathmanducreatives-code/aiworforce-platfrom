// Pipeline leads → the rows the existing Leads dashboard and ATLAS read
// (`accounts`, `contacts`, `lead_candidates`), the same shape as the provider
// discovery projection (discoveryProviders/leadProjection.ts), attribution in
// `raw.agentory_pipeline`.
//
//   existing Lead     never re-created: the row is an UPDATE of that Lead's
//                     attribution only (its id, stage, status are untouched)
//   ineligible        not projected
//   phone             the number is written to contacts.phone only when the
//                     enrichment authorization returned one AND its class is
//                     person-associated or verified; its class, verification,
//                     provenance and do-not-call flag go in raw. A switchboard
//                     goes in raw only. Nothing here sends anything.
//
// Pure: returns rows; the caller writes them.

import type { PipelineLead, PipelineRun } from "./pipeline.ts";

export const PIPELINE_ATTRIBUTION_VERSION = "lead-pipeline-v1" as const;

export interface PipelineRow {
  /** When set, update this existing Lead's attribution; do not insert. */
  existingLeadId: string | null;
  account: { workspace_id: string; name: string; domain: string | null; website_url: string | null; linkedin_url: string | null; location: string | null; industry: string | null; employee_count: string | null; source: string; raw: Record<string, unknown> };
  contact: { workspace_id: string; full_name: string | null; title: string | null; linkedin_url: string | null; company: string | null; location: string | null; email: null; phone: string | null; source: string; raw: Record<string, unknown> } | null;
  lead_candidate: { workspace_id: string; lead_type: string; status: string; fit_score: number | null; priority: number | null; reason: string; next_action: string | null; raw: Record<string, unknown> };
}

export function projectPipelineLead(l: PipelineLead, ctx: { workspaceId: string; values: PipelineRun["contactValues"] }): PipelineRow | null {
  // Rejected candidates (verified, screened or duplicate) are not written.
  if (l.classification === "rejected") return null;
  const v = l.person ? ctx.values.find((x) => x.personKey === l.person!.key) : undefined;
  const writable = v && (v.class === "unverified_person_associated" || v.class === "verified_person_direct") && !l.phone?.doNotCall;
  const attribution = {
    version: PIPELINE_ATTRIBUTION_VERSION, icp: l.icpId, statuses: l.statuses,
    // LeadOcean discovers, Apify verifies, the shared engine decides: provenance of each part.
    classification: l.classification, screen: l.screen, verified_by_apify: l.verified, founder_check: l.founderCheck, qualification: l.qualification, canonical_record: l.canonicalRecord,
    rank: { score: l.rank.score, lane: l.rank.lane, explanation: l.rank.explanation, factors: l.rank.factors },
    signals: l.signals.map((s) => ({ id: s.signalId, type: s.type, source_url: s.sourceUrl, event_date: s.eventDate, collected_at: s.collectedAt, recency: s.recency, confidence: s.confidence, provider: s.provider, actor: s.actor, cost: s.cost, corroboration: s.corroboration, excerpt: s.evidence.excerpt })),
    outreach_blockers: l.outreachBlockers, provenance: l.provenance, company_ids: l.company.providerCompanyIds,
  };
  const loc = [l.company.hq.city, l.company.hq.region, l.company.hq.country].filter(Boolean).join(", ") || null;
  return {
    existingLeadId: l.existingLeadIds[0] ?? null,
    account: {
      workspace_id: ctx.workspaceId, name: l.company.name ?? l.company.domain ?? "Unknown company", domain: l.company.domain,
      website_url: l.company.domain ? `https://${l.company.domain}` : null, linkedin_url: l.company.linkedinUrl, location: loc,
      industry: l.company.industry[0] ?? null, employee_count: l.company.employeeCount != null ? String(l.company.employeeCount) : null,
      source: `lead_pipeline:${l.provenance.providers.join("+")}`, raw: { agentory_pipeline: attribution },
    },
    contact: l.person ? {
      workspace_id: ctx.workspaceId, full_name: l.person.name, title: l.person.title, linkedin_url: l.person.linkedinUrl, company: l.company.name,
      location: null, email: null, phone: writable ? v!.e164 : null, source: "lead_pipeline:leadocean",
      raw: { agentory_pipeline: { version: PIPELINE_ATTRIBUTION_VERSION, person_key: l.person.key, provider_person_id: l.person.providerPersonId, role_family: l.person.roleFamily, phone: l.phone } },
    } : null,
    lead_candidate: {
      workspace_id: ctx.workspaceId, lead_type: "lead_pipeline",
      // eligible → qualified; needs_verification enters as discovered ("new"), never qualified.
      status: l.classification === "eligible" ? "qualified" : "new",
      fit_score: l.rank.score, priority: null,
      reason: l.rank.explanation,
      next_action: l.statuses.outreachReadiness === "ready_for_review" ? "review_before_outreach" : null,
      raw: { agentory_pipeline: attribution },
    },
  };
}
