// ORION → ATLAS: a REVIEWABLE research proposal, never a running mission.
//
// The handoff carries what ATLAS needs to research one company responsibly:
// identity (domain only when verified), why, the LISA signal and its evidence,
// and the Company Brain as ATLAS itself reads it (`atlasView`: ICP, size,
// geography, exclusions, rejected lead/account refs, when the ICP last
// changed, fingerprint). It also carries a PREFILLED mission request that the
// Leads page shows the user; launching it is the existing ATLAS mission flow,
// with its own approval, credit reservation, dedupe, existing-relationship
// holds and workspace isolation — none of which this module can bypass,
// because it calls nothing.
//
// A LISA SIGNAL IS NOT PERMISSION TO CONTACT ANYONE: the guardrails say so in
// the payload, and contact enrichment / outreach are hard-coded off.
//
// PURE.

import type { AtlasBrainContract } from "../companyBrainAgentViews.ts";
import { matchExclusion } from "../brainMemoryModel.ts";
import { COLLAB_CONTRACT_VERSION, idempotencyKeyFor, type Handoff } from "./contract.ts";
import type { OrionOpportunity } from "./lisaToOrion.ts";

export const ATLAS_RESEARCH_REQUEST_VERSION = "atlas-research-request-v1" as const;

export interface AtlasResearchRequest {
  request_version: typeof ATLAS_RESEARCH_REQUEST_VERSION;
  objective: "qualify_as_customer";
  company: { name: string; domain: string | null; domain_verified: boolean };
  reason: string;
  signal: { id: string; confirmed_event: string; inferred_opportunity: string | null; source_url: string | null };
  icp: { industries: string[]; company_size: { min: number | null; max: number | null }; geography: string[] };
  exclusions: AtlasBrainContract["exclusions"];
  rejected_lead_refs: string[];
  rejected_account_refs: string[];
  icp_changed_at: string | null;
  brain_fingerprint: string;
  guardrails: {
    paid_discovery: "requires_mission_approval";
    contact_enrichment: false;
    outreach: false;
    max_companies: 1;
    note: string;
  };
  /** What the Leads page pre-fills. The user launches (and approves) it there. */
  prefilled_mission: { query: string; requested_count: 1; company_domain: string | null };
}

export type AtlasPreflight = { ok: true } | { ok: false; reason: "excluded" | "rejected_account" | "no_brain" | "not_recommended"; detail: string };

/** What ATLAS will refuse anyway — checked before proposing so ORION never offers it. ATLAS re-checks. */
export function atlasPreflight(opp: OrionOpportunity, contract: AtlasBrainContract | null, accountId: string | null = null): AtlasPreflight {
  if (!opp.trusted || !opp.recommended.some((r) => r.kind === "atlas_research")) {
    return { ok: false, reason: "not_recommended", detail: opp.blocked_detail ?? "ORION does not recommend research for this signal." };
  }
  if (!contract || contract.status === "missing") return { ok: false, reason: "no_brain", detail: "No Company Brain: ATLAS has no ICP to qualify against." };
  const ex = matchExclusion({ ...contract.exclusions, items: [] }, { name: opp.company.name, domain: opp.company.domain });
  if (ex) return { ok: false, reason: "excluded", detail: `Excluded by your Company Brain (${ex}).` };
  if (accountId && contract.rejected_account_refs.includes(accountId)) {
    return { ok: false, reason: "rejected_account", detail: "You previously rejected this account." };
  }
  return { ok: true };
}

export function buildAtlasResearchHandoff(
  workspace_id: string, opp: OrionOpportunity, contract: AtlasBrainContract,
): Handoff<AtlasResearchRequest> {
  const rec = opp.recommended.find((r) => r.kind === "atlas_research")!;
  const domain = opp.company.domain;
  const payload: AtlasResearchRequest = {
    request_version: ATLAS_RESEARCH_REQUEST_VERSION,
    objective: "qualify_as_customer",
    company: { name: opp.company.name, domain, domain_verified: !!domain },
    reason: opp.inferred_opportunity ?? rec.action,
    signal: { id: opp.signal_id, confirmed_event: opp.confirmed_event, inferred_opportunity: opp.inferred_opportunity,
      source_url: opp.evidence[0]?.url ?? null },
    icp: { industries: contract.industries, company_size: contract.company_size, geography: contract.geography },
    exclusions: contract.exclusions,
    rejected_lead_refs: contract.rejected_lead_refs,
    rejected_account_refs: contract.rejected_account_refs,
    icp_changed_at: contract.icp_changed_at,
    brain_fingerprint: contract.fingerprint,
    guardrails: {
      paid_discovery: "requires_mission_approval", contact_enrichment: false, outreach: false, max_companies: 1,
      note: "A market signal is not permission to contact anyone. ATLAS qualifies the company only; any paid step needs your mission approval.",
    },
    prefilled_mission: {
      query: `Research ${opp.company.name}${domain ? ` (${domain})` : ""} and check whether it fits our ICP${contract.industries.length ? ` (${contract.industries.join(", ")})` : ""}. Context: ${opp.confirmed_event}`,
      requested_count: 1, company_domain: domain,
    },
  };
  return {
    contract_version: COLLAB_CONTRACT_VERSION, workspace_id, source_agent: "orion", target_agent: "atlas", kind: "atlas_research",
    company: opp.company, signal_ids: [opp.signal_id], lead_ids: [], brain_fingerprint: contract.fingerprint,
    reason: rec.action, evidence: opp.evidence, verification: opp.verification, requires_approval: true,
    idempotency_key: idempotencyKeyFor("atlas_research", opp.company, [opp.signal_id]), payload,
  };
}
