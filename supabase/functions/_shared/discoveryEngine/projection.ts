// Engine leads → the Leads tables (accounts, contacts, lead_candidates), the same
// shape the provider-discovery and lead-pipeline projections write. Attribution in
// raw.agentory_discovery_engine: classification, which providers discovered it,
// per-fact provenance, conflicts and the request match. Existing Leads are
// updated, never re-created. Rejected candidates are not written. No phone value
// is ever written by discovery. Pure: returns rows.

import type { EngineLead, EngineRun } from "./engine.ts";

export const ENGINE_ATTRIBUTION_VERSION = "discovery-engine-v1" as const;

export interface EngineRow {
  existingLeadId: string | null;
  account: { workspace_id: string; name: string; domain: string | null; website_url: string | null; linkedin_url: string | null; location: string | null; industry: string | null; employee_count: string | null; source: string; raw: Record<string, unknown> };
  contact: { workspace_id: string; full_name: string | null; title: string | null; linkedin_url: string | null; company: string | null; location: string | null; email: null; phone: null; source: string; raw: Record<string, unknown> } | null;
  lead_candidate: { workspace_id: string; lead_type: string; status: string; fit_score: number | null; priority: number | null; reason: string; next_action: string | null; raw: Record<string, unknown> };
}

export function projectEngineLead(l: EngineLead, ctx: { workspaceId: string; run: Pick<EngineRun, "planHash">; query: string }): EngineRow | null {
  if (l.classification === "rejected") return null;
  const f = l.verification.facts;
  const attribution = {
    version: ENGINE_ATTRIBUTION_VERSION, query: ctx.query, plan_hash: ctx.run.planHash, classification: l.classification, reasons: l.reasons,
    discovered_by: l.discoveredBy, verification: l.verification.companyRecord, request_match: l.requestMatch,
    facts: l.facts, conflicts: l.conflicts, rank: { score: l.rank.score, explanation: l.rank.explanation, factors: l.rank.factors },
    signals: l.signals.map((s) => ({ type: s.type, source_url: s.sourceUrl, event_date: s.eventDate, recency: s.recency, confidence: s.confidence, provider: s.provider, corroboration: s.corroboration })),
    founder_check: l.founderCheck, outreach_blockers: l.outreachBlockers,
  };
  return {
    existingLeadId: l.existingLeadIds[0] ?? null,
    account: {
      workspace_id: ctx.workspaceId, name: l.company.name ?? l.company.domain ?? "Unknown company", domain: l.company.domain,
      website_url: l.company.domain ? `https://${l.company.domain}` : null, linkedin_url: l.company.linkedinUrl,
      // Only verified facts are shown as the account's location / size.
      location: f?.hq?.text ?? null, industry: f?.industry ?? null, employee_count: f?.sizeBand ? `${f.sizeBand.min}-${f.sizeBand.max ?? ""}` : null,
      source: `discovery_engine:${l.company.providers.join("+")}`, raw: { agentory_discovery_engine: attribution },
    },
    contact: l.person ? { workspace_id: ctx.workspaceId, full_name: l.person.name, title: l.person.title, linkedin_url: l.person.linkedinUrl, company: l.company.name, location: null, email: null, phone: null,
      source: `discovery_engine:${l.person.providers.join("+")}`, raw: { agentory_discovery_engine: { version: ENGINE_ATTRIBUTION_VERSION, person_key: l.person.key, role_family: l.person.roleFamily } } } : null,
    lead_candidate: {
      workspace_id: ctx.workspaceId, lead_type: "discovery_engine",
      status: l.classification === "eligible" ? "qualified" : "new",
      fit_score: l.rank.score, priority: null, reason: l.rank.explanation,
      next_action: l.outreachReadiness === "ready_for_review" ? "review_before_outreach" : null,
      raw: { agentory_discovery_engine: attribution },
    },
  };
}
