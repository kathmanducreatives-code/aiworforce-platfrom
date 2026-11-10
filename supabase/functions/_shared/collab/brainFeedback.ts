// AGENTS → COMPANY BRAIN: knowledge proposals, never facts.
//
// Uses the Company Brain V1 proposal mechanism (company_brain_proposal_submit
// via lisaBrainProposals.submitProposals) — no second memory store. Every
// proposal is PENDING until an editor/admin/owner approves it; rejected ones
// are remembered (previously_rejected) and never influence any agent.
//
// What each agent may propose:
//   LISA   a competitor a person watches but the Brain does not list
//          (lisaBrainProposals.competitorProposalsFromMonitoring, reused).
//   ATLAS  an account-fit note after a SAVED research result: "not a fit
//          because …" or "fits the ICP" — scoped to that one company
//          (fact_key account_fit:<domain>), never an industry rule. Once a
//          person approves "not a fit", ORION stops recommending that company
//          (lisaToOrion reads approved `account_fit` facts).
//   LYRA   nothing automatically. Content preferences are a person's
//          decisions made on the Company Brain page.
//
// Low-value observations are NOT proposed: already-known companies, failed or
// budget-blocked research, unsaved results.
//
// PURE.

import { proposalError, type ProposalInput } from "../brainMemoryModel.ts";
import type { AtlasResearchResult } from "./atlasToOrion.ts";

export { competitorProposalsFromMonitoring, submitProposals } from "../lisaBrainProposals.ts";

export function atlasFitProposal(r: AtlasResearchResult, observedAt: string): ProposalInput | null {
  if (!r.persisted || (r.qualification !== "qualified" && r.qualification !== "rejected")) return null;
  const key = (r.company.domain ?? r.company.name).toLowerCase().replace(/[^a-z0-9.]+/g, "-");
  const fit = r.qualification === "qualified" ? "fits_icp" : "not_a_fit";
  const reason = r.reasons[0] ?? (fit === "fits_icp" ? "matched the ICP" : "did not match the ICP");
  const p: ProposalInput = {
    kind: "fact", category: "account_fit", fact_key: `account_fit:${key}`,
    value_type: "object", value: { name: r.company.name, domain: r.company.domain, fit, reason },
    rationale: `ATLAS research on ${r.company.name} concluded: ${fit === "fits_icp" ? "fits your ICP" : "not a fit"} — ${reason}.`,
    evidence: [
      { source_ref: `agent_handoffs:${r.handoff_id}`, observed_at: observedAt },
      ...(r.lead_candidate_id ? [{ source_ref: `lead_candidates:${r.lead_candidate_id}`, observed_at: observedAt }] : []),
      ...r.evidence.filter((e) => e.url).slice(0, 5).map((e) => ({ source_url: e.url!, observed_at: observedAt })),
    ],
    // ATLAS's verdict is an inference over provider data, not a fact a person confirmed.
    source_type: "model_inference",
    confidence: r.confidence,
    dedupe_key: `atlas:account_fit:${key}:${fit}`,
  };
  return proposalError(p, "atlas") ? null : p;
}
