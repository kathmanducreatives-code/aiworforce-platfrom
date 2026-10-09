// THE BINDING — the production implementation under review, behind the lab's names.
//
// REVIEW BINDING FOR PR #24 (fix/hiring-affordability-compiled-estimate, 5c9b5fcb).
// The lab's tests assert behaviour through these names only, so the SAME
// assertions run against any implementation of the hiring affordability rule.
// Nothing here decides anything: every function is PR #24's own, or a verbatim
// copy of code PR #24 keeps inline in run-agent (pinned by source in
// invariants/providerSpec.test.ts, so a copy that drifted from run-agent fails).

import { candidateCeilingRefusal, type ReserveRequest, type SpendLedger } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import {
  type ClaimVerifier, type LedgerCallDeps, ledgerAffordability, type VerifiableCandidate, type VerificationTarget,
  type VerifierCall,
} from "../../../supabase/functions/_shared/claimVerifier.ts";
import type { VerificationPhaseInput, VerificationPhaseReport } from "../../../supabase/functions/_shared/claimVerificationPhase.ts";
import { hiringClaimVerifier } from "../../../supabase/functions/_shared/hiringClaimVerifier.ts";
import { hiringSearchTitles } from "../../../supabase/functions/_shared/hiringSearchVocabulary.ts";
import { missionCandidatesFrom, type EngineCompany } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { isUnfinishedFrontier } from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { buildQualificationContext } from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import { roleMatchesFamily, type RoleFamily } from "../../../supabase/functions/_shared/roleFamilies.ts";

export const BINDING = "PR #24 (5c9b5fcb)";

/** The affordability answer, in the lab's terms. */
export interface Gate { estimate_usd: number; idempotency_key: string | null; refused_candidate: boolean; would_commit_usd: number | null; limit_usd: number | null }

/** The gate PR #24 wires into the phase: `ledgerAffordability` over the purchase's spec compiler and ledger. */
export function affordabilityGate(deps: Pick<LedgerCallDeps, "ledger" | "spec">) {
  const gate = ledgerAffordability(deps);
  return (call: VerifierCall): Gate | null => {
    const d = gate(call);
    if (!d) return null;
    const key = deps.spec(call).idempotency_key ?? null;
    return d.ok
      ? { estimate_usd: d.estimate_usd, idempotency_key: key, refused_candidate: false, would_commit_usd: null, limit_usd: null }
      : { estimate_usd: d.estimate_usd, idempotency_key: key, refused_candidate: true, would_commit_usd: d.would_commit_usd, limit_usd: d.limit_usd };
  };
}

/** The phase input PR #24 takes for that gate. */
export function phaseGate(deps: Pick<LedgerCallDeps, "ledger" | "spec">, record?: (call: VerifierCall, g: Gate | null) => void):
  Pick<VerificationPhaseInput, "affordability"> {
  const raw = ledgerAffordability(deps);
  const lab = affordabilityGate(deps);
  return { affordability: (call) => { record?.(call, lab(call)); return raw(call); } };
}

/** The exact call a verifier would buy for these targets. */
export const verifierCall = (v: ClaimVerifier, targets: readonly VerificationTarget[]): VerifierCall | null => v.call_for?.(targets) ?? null;

/** The phase's unaffordable report, in the lab's terms. */
export function unaffordableOf(r: VerificationPhaseReport) {
  return (r.unaffordable ?? []).map((u) => ({
    verifier: u.verifier, company_key: u.company_key, estimate_usd: u.estimate_usd, limit_usd: u.limit_usd,
    would_commit_usd: u.spent_usd + u.estimate_usd,
  }));
}

/** The candidate ceiling's verdict — the rule `reserve` and the gate share in PR #24. */
export function candidateRule(l: SpendLedger, q: Pick<ReserveRequest, "purpose" | "candidate_keys" | "estimate_usd">) {
  return candidateCeilingRefusal(l, q);
}

// ── VERBATIM FROM PR #24 run-agent (inline there) ──────────────────────────

export function verifiableCandidatesFrom(
  engineRun: { companies: readonly EngineCompany[] }, vCriteria: readonly MissionCriterion[], missionId: string,
): VerifiableCandidate[] {
  return missionCandidatesFrom(engineRun, { missionId: String(missionId) }).map((cand) => {
    const e = evaluateEligibility(vCriteria as MissionCriterion[], cand.graph);
    return {
      company_key: cand.company_key, name: cand.name, domain: cand.domain, linkedin_url: cand.linkedin_url,
      graph: cand.graph, eligibility: e.eligibility,
      hard_checks: e.checks.filter((x) => x.kind === "hard"),
      attempted_routes: cand.attempted_routes ?? [],
      unaffordable_routes: cand.unaffordable_routes ?? [],
      // Triage withheld paid verification: `verificationTargets` skips it.
      paid_verification_blocked: cand.paid_verification_blocked ?? null,
    };
  });
}

export function missionHiringVerifier(vMission: LeadMissionV1, vCriteria: readonly MissionCriterion[]) {
  const hiringCriterion = vCriteria.find((c) => c.dimension === "hiring" && c.kind === "hard" && c.status === "ok");
  if (!hiringCriterion) return null;
  const families = (((hiringCriterion.value as { qualifier?: { role_families?: unknown } } | null)
    ?.qualifier?.role_families ?? []) as unknown[]).map(String);
  const vocab = buildQualificationContext(vMission, { criteriaAuthority: true }).role_vocabulary;
  const titles = hiringSearchTitles(vocab);
  const lowered = vocab.required_titles.map((t) => String(t).toLowerCase());
  return hiringClaimVerifier({
    titles, role_families: families,
    window_days: hiringCriterion.time_window?.days ?? null,
    matchesRole: (title) => families.length > 0
      ? families.some((f) => roleMatchesFamily(title, f as RoleFamily))
      : lowered.some((t) => title.toLowerCase().includes(t)),
  });
}

const DEFERRED_STAGE_REASONS: readonly string[] = [
  "deferred", "qualification_deferred",
];
export function unfinishedFrontierCount(companies: readonly EngineCompany[]): number {
  return companies.filter((c) =>
    isUnfinishedFrontier(
      c.investigation_state,
      DEFERRED_STAGE_REASONS.includes(
        String((c as { stage_block?: { reason?: string } | null })
          .stage_block?.reason ?? ""),
      ),
    )).length;
}

/** What run-agent must carry for the copies above to be the code it runs (source pins). */
export const RUN_AGENT_PINS = [
  "const vCandidates = () => missionCandidatesFrom(engineRun, { missionId: String(task.id) }).map((cand) => {",
  "unaffordable_routes: cand.unaffordable_routes ?? [],",
  "const hiringCriterion = vCriteria.find((c) => c.dimension === \"hiring\" && c.kind === \"hard\" && c.status === \"ok\");",
  "const titles = hiringSearchTitles(vocab);",
  "? capabilityRun.companies.filter((c) =>\n            isUnfinishedFrontier(\n              c.investigation_state,",
  "DEFERRED_STAGE_REASONS.includes(\n                String((c as { stage_block?: { reason?: string } | null })\n                  .stage_block?.reason ?? \"\"),",
  "const DEFERRED_STAGE_REASONS: readonly string[] = [\n  \"deferred\", \"qualification_deferred\",\n];",
  "const vSpec = await verifierSpecFor(vState);",
  "call: await verifierCallFor(vState, vSpec),",
  "affordability: ledgerAffordability({ ledger: vState.spend_ledger!, spec: vSpec }),",
  "spec: spec ?? await verifierSpecFor(vState),",
  "verificationRoutesRemain: p5View?.evidence_gaps.with_executable_route ?? 0,",
  "claimProgressInPool: claimProgressCount({",
];
