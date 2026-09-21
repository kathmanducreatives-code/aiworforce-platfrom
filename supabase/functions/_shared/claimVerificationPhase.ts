// LEAD V2 — THE VERIFICATION PHASE: CANONICAL GAPS → VERIFIER → PURCHASE.
//
// One authority decides which paid verification a company receives:
//
//   evidence graph → hard claim unknown → evidence-gap router → the verifier
//   whose route the router chose → that verifier buys, through the ledger →
//   canonical claim written → graph updated → eligibility re-read
//
// Before this, the business model had a second authority: the legacy Brain's
// `computeEvidenceDebts` picked which companies got Firecrawl pages, and the
// canonical router only decided afterwards whether the pages could be re-read.
// A company the canonical claim needed but the legacy Brain thought settled
// got no pages; a company the legacy Brain wanted researched got pages whether
// or not its canonical claim was already answered. Under Lead V2 the legacy
// debt no longer runs at all; every verifier — funding, business model — is
// selected here, from the canonical gaps, and only here.
//
// ORDER AND STOPPING.
//
//   * Verifiers run cheapest route first (`cost_hint_usd`). Eligibility is
//     re-read between them, so a company one verifier FAILS is not bought for
//     by the next.
//   * The quota is checked before every verifier. Once the canonical qualified
//     count meets the request, nothing more is bought this slice — a run that
//     has its leads stops verifying; runs already paid for are still adopted.
//     Below it, a verifier is given at most twice the shortfall (the most
//     promising first), never its whole pool: one lead short buys two checks.
//   * A target (preference) never reaches here: only HARD unknown checks are
//     gaps, so a ranking-only criterion cannot trigger a purchase.
//
// Pure orchestration; every effect is an injected function.

import {
  verificationTargets, type ClaimVerifier, type PendingVerifierRun, type VerifiableCandidate,
  type VerifierDeps, type VerifierFinding,
} from "./claimVerifier.ts";
import { CLAIM_REGISTRY, type ClaimDefinition } from "./evidenceGapRouter.ts";
import { PRODUCTION_READINESS, type ReadinessPolicy, routeActorReady } from "./routeReadiness.ts";
import { relevantVerifierActors, type ClaimPlan } from "./claimPlan.ts";

export const CLAIM_VERIFICATION_PHASE_VERSION = "claim-verification-phase-v1" as const;
/** Companies verified per missing lead, at most, per verifier per slice. */
export const SHORTFALL_MARGIN = 2;

export interface VerificationPhaseInput {
  mission_id: string | null;
  /** The request: the phase stops buying once the canonical qualified count reaches it. */
  requested_count: number;
  /** Candidates as they stand NOW — re-read after every verifier. */
  candidates: () => VerifiableCandidate[];
  /** The canonical qualified count as it stands now. */
  qualified: () => number;
  criteriaValue: (criterionId: string) => unknown;
  verifiers: readonly ClaimVerifier[];
  /** Call, clock, log. `ready` is derived here from the readiness policy. */
  deps: Omit<VerifierDeps, "ready">;
  /** Per-mission refusals (opt-in gate, credit): such an actor is not ready. */
  unavailable?: (actor: string) => boolean;
  readiness?: ReadinessPolicy;
  /** Runs earlier slices started, to adopt before anything new is bought. */
  pending: readonly PendingVerifierRun[];
  /** The engine writes a finding onto its company. */
  apply: (finding: VerifierFinding, verifier: ClaimVerifier) => boolean;
  registry?: readonly ClaimDefinition[];
  /**
   * The mission's claim plan. A verifier whose route answers no HARD claim of
   * it is not run at all — a claim the user did not require buys nothing.
   */
  claim_plan?: ClaimPlan;
  log?: (event: string, meta?: Record<string, unknown>) => void;
}

export interface VerificationPhaseReport {
  version: typeof CLAIM_VERIFICATION_PHASE_VERSION;
  /** Verifiers in the order they were considered (cheapest route first). */
  order: string[];
  ran: Array<{ verifier: string; targets: string[]; findings: number; recorded: number; pending: number }>;
  /** Why the phase stopped buying early, when it did. */
  stopped: "quota_met" | null;
  /** Verifiers the claim plan made irrelevant: no hard claim they answer. */
  irrelevant: string[];
  pending: PendingVerifierRun[];
  changed: number;
}

function routeOf(v: ClaimVerifier, registry: readonly ClaimDefinition[]) {
  for (const d of registry) {
    const r = d.routes.find((x) => x.actor === v.route_actor);
    if (r) return r;
  }
  return null;
}

export async function runClaimVerificationPhase(i: VerificationPhaseInput): Promise<VerificationPhaseReport> {
  const registry = i.registry ?? CLAIM_REGISTRY;
  const policy = i.readiness ?? PRODUCTION_READINESS;
  const log = i.log ?? (() => {});
  const ordered = [...i.verifiers].sort((a, b) =>
    (routeOf(a, registry)?.cost_hint_usd ?? Infinity) - (routeOf(b, registry)?.cost_hint_usd ?? Infinity));
  const report: VerificationPhaseReport = {
    version: CLAIM_VERIFICATION_PHASE_VERSION, order: ordered.map((v) => v.key), ran: [], stopped: null,
    irrelevant: [], pending: [], changed: 0,
  };
  const relevant = i.claim_plan ? relevantVerifierActors(i.claim_plan) : null;
  for (const verifier of ordered) {
    if (relevant && !relevant.has(verifier.route_actor) && !i.pending.some((r) => r.verifier === verifier.key)) {
      report.irrelevant.push(verifier.key);
      continue;
    }
    const route = routeOf(verifier, registry);
    const mine = i.pending.filter((r) => r.verifier === verifier.key);
    const need = Math.max(1, i.requested_count) - i.qualified();
    if (need <= 0) report.stopped = "quota_met";
    // A RUN ALREADY PAID FOR IS STILL ADOPTED; NOTHING NEW IS BOUGHT.
    const targets = need <= 0 ? [] : verificationTargets(verifier, i.candidates(), i.criteriaValue, registry, policy)
      .slice(0, need * SHORTFALL_MARGIN);
    if (targets.length === 0 && mine.length === 0) continue;
    const deps: VerifierDeps = {
      ...i.deps,
      // THE ONE READINESS AUTHORITY, for this verifier's capability.
      // THE SAME QUESTION EVERY OTHER LAYER ASKS. This used to call
      // `policy.decide` directly, which skips the provider-class contract that
      // `routeActorReady` enforces — a weaker question than the graph, the
      // router, the planner and the runtime all ask. It was weaker because the
      // authority could not model a non-Apify provider: Firecrawl has no actor
      // card, so the strict check refused a provider that is declared READY and
      // runs every day. `providerClassOf` models it now, so the exemption is
      // gone and the verifier asks what everyone else asks.
      ready: (actor) =>
        !!route && routeActorReady(actor, route.capability, policy).ready &&
        !(i.unavailable?.(actor) ?? false),
    };
    const result = await verifier.verify(targets, deps, { mission_id: i.mission_id, pending: mine });
    let recorded = 0;
    for (const f of result.findings) {
      if (i.apply(f, verifier)) recorded++;
      report.changed++;
    }
    report.pending.push(...result.pending);
    report.ran.push({
      verifier: verifier.key, targets: targets.map((t) => t.company_key),
      findings: result.findings.length, recorded, pending: result.pending.length,
    });
    log("verifier_ran", {
      verifier: verifier.key, targets: targets.length, findings: result.findings.length,
      recorded, pending: result.pending.length,
    });
  }
  if (report.stopped) log("verification_stopped", { reason: report.stopped, qualified: i.qualified(), requested: i.requested_count });
  return report;
}
