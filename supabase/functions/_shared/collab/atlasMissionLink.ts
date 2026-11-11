// ORION → ATLAS LAUNCH, AND ATLAS → ORION FROM SAVED RECORDS. PURE.
//
// LAUNCH. An approved research handoff becomes a mission ONLY through the
// existing Leads workflow: the packet below is the message the user sends to
// ORION, which compiles the mission, shows its cost, and waits for the user's
// own mission approval and credit reservation. Approving the handoff approved
// research of one company; it did not approve spend. This module calls nothing.
//
// SYNC. ATLAS's verdict is read from what ATLAS SAVED — the workspace's
// lead_candidates row for that company, written after the handoff was
// approved. No caller supplies the verdict, so a browser cannot fabricate one
// (the service-key `atlas_report` hook stays the path for ATLAS's own reports).

import { atlasResultFromMission, type AtlasResearchResult } from "./atlasToOrion.ts";
import type { HandoffStatus } from "./contract.ts";

export const ATLAS_MISSION_LINK_VERSION = "atlas-mission-link-v1" as const;

export interface LinkableHandoff {
  id: string;
  kind: string;
  status: HandoffStatus;
  signal_ids: string[];
  company: { name?: string | null; domain?: string | null } | null;
  decided_at: string | null;
  payload: Record<string, unknown>;
}

export interface LaunchPacket {
  version: typeof ATLAS_MISSION_LINK_VERSION;
  collab_handoff_id: string;
  /** Sent to ORION as an ordinary chat message; the mission card that follows is approved separately. */
  message: string;
  requested_count: 1;
  company_domain: string | null;
  guardrails: { mission_approval_required: true; contact_enrichment: false; outreach: false };
}

export type LaunchRefusal = { ok: false; reason: "not_research" | "not_approved" | "no_prefill"; status?: string };

export function launchPacketFor(h: LinkableHandoff): { ok: true; packet: LaunchPacket } | LaunchRefusal {
  if (h.kind !== "atlas_research") return { ok: false, reason: "not_research" };
  if (h.status !== "approved") return { ok: false, reason: "not_approved", status: h.status };
  const pre = (h.payload?.prefilled_mission ?? null) as { query?: unknown; company_domain?: unknown } | null;
  const query = typeof pre?.query === "string" ? pre.query.trim() : "";
  if (!query) return { ok: false, reason: "no_prefill" };
  return {
    ok: true,
    packet: {
      version: ATLAS_MISSION_LINK_VERSION, collab_handoff_id: h.id,
      message: query.slice(0, 500), requested_count: 1,
      company_domain: typeof pre?.company_domain === "string" ? pre.company_domain : null,
      guardrails: { mission_approval_required: true, contact_enrichment: false, outreach: false },
    },
  };
}

export interface SavedLeadRow {
  id: string;
  status: string | null;
  reason: string | null;
  fit_score: number | null;
  created_at: string;
  account_id: string | null;
  accounts?: { domain?: string | null; name?: string | null } | null;
}

/**
 * The ATLAS result a saved lead row supports, or null when ATLAS has not
 * finished (no row since approval, or a row still `new`). Only rows written
 * AFTER the handoff was approved count: an older lead is not this mission's work.
 */
export function resultFromSavedLead(h: LinkableHandoff, rows: readonly SavedLeadRow[]): AtlasResearchResult | null {
  const since = h.decided_at ? Date.parse(h.decided_at) : NaN;
  const domain = String(h.company?.domain ?? "").toLowerCase().replace(/^www\./, "");
  const mine = rows
    .filter((r) => Number.isFinite(since) && Date.parse(r.created_at) >= since)
    .filter((r) => !domain || String(r.accounts?.domain ?? "").toLowerCase().replace(/^www\./, "") === domain)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const lead = mine.find((r) => r.status === "qualified" || r.status === "rejected");
  if (!lead) return null;
  return atlasResultFromMission({
    handoff_id: h.id, signal_id: h.signal_ids[0] ?? null,
    company: { name: String(h.company?.name ?? lead.accounts?.name ?? ""), domain: h.company?.domain ?? null },
    verdict: lead.status === "qualified" ? "pass" : "fail",
    lead_candidate_id: lead.id, account_id: lead.account_id,
    reasons: lead.reason ? [lead.reason] : [],
    evidence: [{ ref: `lead_candidates:${lead.id}` }],
    confidence: (lead.fit_score ?? 0) >= 75 ? "high" : (lead.fit_score ?? 0) >= 50 ? "medium" : "low",
    stages_completed: ["sourced", "qualified", "saved"],
    persisted: true,
  });
}
