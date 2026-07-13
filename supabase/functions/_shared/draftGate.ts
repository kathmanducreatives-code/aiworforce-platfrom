// Global outreach-draft gate. Pure / import-free.
//
// Root cause it fixes: 5 outreach drafts were persisted for a run with 0 qualified
// leads, linked to no lead_candidate, targeting LLM-fabricated people. This gate
// is the single invariant every draft-persistence path must pass BEFORE writing
// an outreach_drafts row — in ANY execution mode. A draft may be created only for
// a persisted, provider-backed, contact-ready lead whose canonical decision is
// `contact`, and never when the execution mode forbids drafting.

import { modeDraftBlockReason } from "./executionMode.ts";

export interface DraftGateInput {
  execution_mode?: string | null;
  canonical_final_decision?: string | null; // must be "contact"
  contact_ready?: boolean | null;           // must be true
  provider_company_identity?: boolean | null;
  provider_or_verified_person_identity?: boolean | null;
  person_company_association?: boolean | null;
  evidence_url_supported?: boolean | null;
  hard_disqualifier_hit?: boolean | null;
  persisted_lead_candidate_id?: string | null; // must be a real persisted id
}

export interface DraftGateResult {
  allowed: boolean;
  blocked_reasons: string[];
}

/** Evaluate the full draft-gating invariant for one candidate draft. */
export function evaluateDraftGate(input: DraftGateInput): DraftGateResult {
  const reasons: string[] = [];

  const modeReason = modeDraftBlockReason(input.execution_mode);
  if (modeReason) reasons.push(modeReason);

  if ((input.canonical_final_decision ?? "").toString().toLowerCase() !== "contact") {
    reasons.push("canonical_final_decision is not 'contact'");
  }
  if (input.contact_ready !== true) reasons.push("contact_ready is not true");
  if (!input.persisted_lead_candidate_id || !input.persisted_lead_candidate_id.toString().trim()) {
    reasons.push("no persisted lead_candidate_id");
  }
  if (input.provider_company_identity !== true) reasons.push("company identity is not provider-backed");
  if (input.provider_or_verified_person_identity !== true) reasons.push("person identity is not provider-backed or verified");
  if (input.person_company_association !== true) reasons.push("person↔company association not verified");
  if (input.evidence_url_supported !== true) reasons.push("no supported evidence URL");
  if (input.hard_disqualifier_hit === true) reasons.push("hard disqualifier hit");

  return { allowed: reasons.length === 0, blocked_reasons: reasons };
}

/** Convenience: a batch summary — how many drafts are allowed, and why the rest are blocked. */
export function gateDraftBatch(inputs: DraftGateInput[]): { allowed: DraftGateInput[]; blocked: Array<{ input: DraftGateInput; reasons: string[] }> } {
  const allowed: DraftGateInput[] = [];
  const blocked: Array<{ input: DraftGateInput; reasons: string[] }> = [];
  for (const inp of inputs ?? []) {
    const r = evaluateDraftGate(inp);
    if (r.allowed) allowed.push(inp); else blocked.push({ input: inp, reasons: r.blocked_reasons });
  }
  return { allowed, blocked };
}
