// LEAD V2 P5 — WHICH CANDIDATES ARE WORTH EXPLAINING, AND WHAT THEY COST.
//
// The reasoner is one batched model call, so the decision worth making is WHO
// is in the batch. Only candidates code has already found ELIGIBLE are: a
// pending or ineligible candidate has no label for a model to choose, and
// paying to narrate a disposition is the spend this phase exists to avoid.
//
// Extracted from run-agent so the selection rule can be tested — `index.ts`
// calls `Deno.serve` at import time and cannot be imported by a test.

import { evaluateEligibility } from "./candidateEligibility.ts";
import { computeCeiling } from "./opportunityLabel.ts";
import type { MissionCriterion } from "./missionCriteria.ts";
import type { MissionCandidate } from "./workbenchMissionView.ts";
import {
  REASONER_MAX_CANDIDATES, type ReasonerCandidate, type ReasonerProposals,
} from "./gptOpportunityReasoner.ts";

export { makeGptOpportunityReasoner } from "./gptOpportunityReasoner.ts";

/** The eligible candidates, best ceiling first, capped at the batch size. */
export function candidatesToReason(
  criteria: readonly MissionCriterion[], candidates: readonly MissionCandidate[], anchor: string | null,
  limit = REASONER_MAX_CANDIDATES,
): ReasonerCandidate[] {
  const out: ReasonerCandidate[] = [];
  for (const c of candidates) {
    if (c.screened_out || !c.identity_resolved) continue;
    const eligibility = evaluateEligibility(criteria, c.graph);
    if (eligibility.eligibility !== "eligible") continue;
    const ceiling = computeCeiling({ criteria, graph: c.graph, eligibility, anchor });
    if (!ceiling.ceiling) continue;
    out.push({ company_key: c.company_key, name: c.name, ceiling, graph: c.graph });
  }
  // Strongest evidence first: a batch that runs out of room should spend it on
  // the candidates a user will read first.
  out.sort((a, b) =>
    b.ceiling.evidence_coverage - a.ceiling.evidence_coverage ||
    b.ceiling.signal_strength - a.ceiling.signal_strength ||
    a.company_key.localeCompare(b.company_key));
  return out.slice(0, limit);
}

/** Runs the reasoner over the eligible candidates. Never throws into the run. */
export async function reasonForCandidates(i: {
  request: string;
  criteria: readonly MissionCriterion[];
  anchor: string | null;
  candidates: readonly MissionCandidate[];
  enabled: boolean;
  reason: (x: { request: string; candidates: readonly ReasonerCandidate[] }) => Promise<ReasonerProposals>;
}): Promise<ReasonerProposals> {
  if (!i.enabled) return {};
  const batch = candidatesToReason(i.criteria, i.candidates, i.anchor);
  if (batch.length === 0) return {};
  try {
    return await i.reason({ request: i.request, candidates: batch });
  } catch {
    // A failed explanation is not a failed run: the ceiling is still the label.
    return {};
  }
}
