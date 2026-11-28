// Canonical signal → ATLAS, as an agent_handoffs proposal (Signals recovery, Phase 5).
//
// Wraps signalHandoff.ts's provider-independent SignalAtlasHandoffV1 in the collaboration
// contract (contract.ts), so it travels through the SAME ledger, approval and idempotency rules
// as ORION → ATLAS. It is a PROPOSAL: requires_approval is always true, and ATLAS's own mission
// flow (approval, credits, dedupe, existing-relationship holds) runs only when a person launches it.
// Nothing here calls ATLAS or changes its code (ATLAS V5 is developed separately).
// PURE.
import { COLLAB_CONTRACT_VERSION, type Handoff, type Verification } from "./contract.ts";
import { buildSignalAtlasHandoff, type CanonicalSignalRow, type HandoffBrainScope, type HandoffRefusal, type SignalAtlasHandoffV1 } from "../signalHandoff.ts";

export function signalToAtlasHandoff(row: CanonicalSignalRow, workspace_id: string, scope: HandoffBrainScope | null, brain_fingerprint: string | null):
  { ok: true; handoff: Handoff<{ signal_handoff: SignalAtlasHandoffV1 }> } | { ok: false; reason: HandoffRefusal; detail: string } {
  const b = buildSignalAtlasHandoff(row, workspace_id, scope);
  if (!b.ok) return b;
  const h = b.handoff;
  const level = h.verification.level;
  const verification: Verification = {
    level: (["corroborated", "self_reported", "single_source", "contradicted"] as const).includes(level as never) ? level as Verification["level"] : "unknown",
    confidence: (h.verification.confidence === "high" || h.verification.confidence === "medium") ? h.verification.confidence : "low",
    confirmed: [`${h.company.name}: ${h.signal.kind} signal${h.signal.event_date ? ` on ${h.signal.event_date}` : ""}`],
    inferred: [`${h.company.name} may fit your ICP — ATLAS has not checked yet`],
  };
  return { ok: true, handoff: {
    contract_version: COLLAB_CONTRACT_VERSION,
    workspace_id, source_agent: "lisa", target_agent: "atlas", kind: "atlas_research",
    company: { name: h.company.name, domain: h.company.domain_verified ? h.company.domain : null, account_id: h.company.account_id },
    signal_ids: [h.signal.id], lead_ids: [], brain_fingerprint,
    reason: h.recommended_discovery_action.query,
    evidence: h.evidence.map((e) => ({ ref: `signal_events:${h.signal.id}`, url: e.url, excerpt: e.excerpt })),
    verification, requires_approval: true,
    idempotency_key: `atlas_research:signal:${h.signal.id}`,
    payload: { signal_handoff: h },
  } };
}
