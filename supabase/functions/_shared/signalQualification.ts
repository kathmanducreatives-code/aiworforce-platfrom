// EVERY REQUIRED SIGNAL GETS ITS OWN VERDICT, AND AN UNINVESTIGATED ONE CANNOT
// BE SATISFIED.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// `MissionEvaluation` carried ONE signal axis, `hiring_fit`, and its prompt line
// reads: "'verified' when a cited current opening matches the required role."
// Hiring had a verdict; funding, posts, comments, expansion, product launch and
// technology did not. They were folded into the generic requirement list, so a
// mission with two signals produced one signal answer and the model chose which
// one it was about.
//
// ── THE RULE THAT MATTERS MOST ──────────────────────────────────────────────
//
// A signal that was never investigated may not be reported as satisfied.
//
// That sounds obvious and was not previously enforceable, because nothing
// compared the mission's required signals against the capabilities that
// actually RAN. Three ways it failed in practice:
//
//   A signal with no scheduled step — `technology` and `post/company` were
//   declared SUPPORTED with approved providers and never scheduled, so the
//   Brain was asked to judge a technology signal from firmographics.
//
//   A step that ran and returned nothing — different from a step that never
//   ran, and only one of them is evidence.
//
//   A step whose provider FAILED — `provider_failure` is not a negative fact,
//   and it is certainly not a positive one.
//
// So a verdict here is a function of two things: was the signal investigated at
// all, and did the investigation produce dated, citable evidence. The model
// judges the second. Code owns the first, and code can veto the model.
//
// PURE. No network, provider, model or database access.

import type { SignalEvent, SignalSubject } from "./missionSignalDescriptor.ts";

export const SIGNAL_QUALIFICATION_VERSION = "signal-qualification-v1" as const;

/**
 * One signal's verdict.
 *
 * `not_investigated` is the addition, and it is deliberately NOT a synonym for
 * `absent`. "We looked and there is nothing" and "nobody looked" are different
 * answers, and only the first may count against a company.
 */
export type SignalVerdict =
  /** Dated, citable evidence that the signal occurred. */
  | "verified"
  /** Evidence consistent with the signal but not conclusive. */
  | "plausible"
  /** The investigation ran and found nothing. A real, usable answer. */
  | "absent"
  /** No capability ran for this signal. NEVER counts for or against. */
  | "not_investigated"
  /** A capability ran and its provider failed. Also never counts. */
  | "investigation_failed";

/** Verdicts that may be treated as the signal being present. */
const POSITIVE: readonly SignalVerdict[] = Object.freeze(["verified", "plausible"]);

/** Verdicts a model is allowed to assert. The other two are code's to set. */
const MODEL_ASSERTABLE: readonly SignalVerdict[] =
  Object.freeze(["verified", "plausible", "absent"]);

export function isPositiveSignal(v: SignalVerdict): boolean {
  return POSITIVE.includes(v);
}

export interface RequiredSignal {
  event: SignalEvent | string;
  subject: SignalSubject | string;
  /** The mission's own qualifier — topic, region, round type, role families. */
  qualifier?: Record<string, unknown> | null;
  timeframe_days?: number | null;
}

/**
 * Which capability proves which signal.
 *
 * ── DERIVED FROM THE GRAPH, NOT INVENTED HERE ──────────────────────────────
 *
 * These are the capability ids `buildCapabilityGraph` schedules. The map exists
 * so "was this signal investigated?" is answerable from `completed_capabilities`
 * without this module knowing anything about actors — which is the same
 * separation the capability catalogue keeps for GPT.
 *
 * A signal with NO entry is one no capability proves. That is not an omission
 * to be filled in later with the nearest step; it is the honest state, and it
 * resolves to `not_investigated`.
 */
export const CAPABILITY_FOR_SIGNAL:
  Readonly<Record<string, readonly string[]>> = Object.freeze({
    "hiring/company": ["hiring_verification", "general_company_discovery",
      "startup_company_discovery"],
    "funding/company": ["funding_signal_discovery"],
    "expansion/company": ["expansion_signal_discovery", "expansion_signal_verification"],
    "product_launch/company": ["product_launch_discovery", "product_launch_verification"],
    "technology/company": ["technology_verification"],
    "post/company": ["company_post_verification"],
    // PERSON SUBJECTS ARE UNLOCK-GATED AND NEVER SCHEDULED. Listed so the
    // reason a mission cannot satisfy them is `requires_unlock` rather than the
    // silence of an absent map entry.
    "post/leadership": [],
    "comment/leadership": [],
    "leadership_change/leadership": [],
  });

export function signalKey(s: RequiredSignal): string {
  return `${s.event}/${s.subject}`;
}

/** The capabilities that would prove this signal, if any exist. */
export function provingCapabilities(s: RequiredSignal): readonly string[] {
  return CAPABILITY_FOR_SIGNAL[signalKey(s)] ?? [];
}

export interface SignalAssessment {
  signal: string;
  event: string;
  subject: string;
  verdict: SignalVerdict;
  /** Which capability established it. Null when none ran. */
  established_by: string | null;
  /** Evidence ids the verdict cites. Empty is only valid for a non-positive verdict. */
  evidence_ids: readonly string[];
  /** True when the only route to this signal is a user-authorised unlock. */
  requires_unlock: boolean;
  reason: string;
}

export interface SignalCoverageInput {
  required: readonly RequiredSignal[];
  /** Capability ids that actually completed, from `state.completed_capabilities`. */
  completed: readonly string[];
  /** Capability ids whose provider failed. */
  failed?: readonly string[];
  /**
   * What the MODEL said about each signal, keyed by `event/subject`.
   *
   * Absent entirely on a run with no model — every signal then resolves from
   * coverage alone, which is the honest answer rather than a default of absent.
   */
  modelVerdicts?: Readonly<Record<string, { verdict: string; evidence_ids?: readonly string[] }>>;
  /**
   * WHAT CODE PROVED, keyed like `modelVerdicts`.
   *
   * ── WHY A SECOND CHANNEL EXISTS ────────────────────────────────────────
   *
   * Until now the only way to assert a POSITIVE signal verdict was for the
   * model to claim one and cite it. Coverage alone yields `not_investigated`,
   * which is the honest answer when nothing judged the evidence.
   *
   * But something does judge it. `hiring_verification` runs a paid job search
   * and `assessHiring` — deterministic code, reading real postings — returns
   * `hiring_verified` with the titles it found. Live run 2026-08-24: twelve
   * openings, verified by code, and this module could only report
   * `not_investigated`, because the model had answered a different question
   * (mission fit) and its uncited claim was rightly downgraded.
   *
   * ── WHERE IT IS ADMITTED, AND WHERE IT IS NOT ──────────────────────────
   *
   * Only where the model contributed no usable judgement: it had nothing to
   * say, or it made a positive claim it could not cite. A model verdict that
   * IS cited still stands, and a model verdict of `absent` is never overturned
   * — code proving openings exist does not make the model's reading of them
   * wrong, and the conservative answer is the one that does not qualify anyone.
   *
   * The same citation rule applies to code: a proven verdict with no evidence
   * ids is not admitted either. The channel is about WHO establishes a fact,
   * never about relaxing what a fact requires.
   */
  provenVerdicts?: Readonly<Record<string, { verdict: string; evidence_ids: readonly string[] }>>;
}

/**
 * Assess every required signal.
 *
 * ── CODE VETOES THE MODEL, NEVER THE REVERSE ───────────────────────────────
 *
 * The model may say `verified` about a signal nobody investigated — it has no
 * way to know which steps ran. So coverage is computed first, and a model
 * verdict is only admitted where a capability actually completed. This is the
 * whole point of the module: the guarantee is structural, not a prompt
 * instruction.
 */
export function assessSignals(i: SignalCoverageInput): SignalAssessment[] {
  const completed = new Set(i.completed);
  const failed = new Set(i.failed ?? []);

  return i.required.map((sig) => {
    const key = signalKey(sig);
    const proving = provingCapabilities(sig);
    const ran = proving.filter((c) => completed.has(c));
    const broke = proving.filter((c) => failed.has(c));

    // ── 1. NOTHING COULD PROVE IT ────────────────────────────────────────
    if (proving.length === 0) {
      const personSubject = sig.subject !== "company";
      return {
        signal: key, event: String(sig.event), subject: String(sig.subject),
        verdict: "not_investigated" as SignalVerdict,
        established_by: null, evidence_ids: [],
        requires_unlock: personSubject,
        reason: personSubject
          ? `${key} is a claim about a person and is only reachable through a ` +
            `user-authorised unlock, so no automatic step investigated it`
          : `no capability proves ${key}; it was not investigated`,
      };
    }

    // ── 2. A CAPABILITY EXISTS AND NONE OF IT RAN ────────────────────────
    if (ran.length === 0) {
      return {
        signal: key, event: String(sig.event), subject: String(sig.subject),
        verdict: (broke.length > 0 ? "investigation_failed" : "not_investigated") as SignalVerdict,
        established_by: null, evidence_ids: [],
        requires_unlock: false,
        reason: broke.length > 0
          ? `${broke.join(", ")} ran and the provider failed, so nothing about ` +
            `${key} was established — this is not evidence of absence`
          : `${proving.join(" or ")} would prove ${key} and neither ran`,
      };
    }

    // ── 3. IT RAN. THE MODEL MAY NOW SPEAK. ──────────────────────────────
    const said = i.modelVerdicts?.[key];
    const claimed = said?.verdict;
    const evidence = said?.evidence_ids ?? [];

    /** A verdict code established, admitted only if it cites evidence. */
    const proven = (() => {
      const p = i.provenVerdicts?.[key];
      if (!p || !(MODEL_ASSERTABLE as readonly string[]).includes(p.verdict)) return null;
      if (POSITIVE.includes(p.verdict as SignalVerdict) && p.evidence_ids.length === 0) {
        return null;
      }
      return p;
    })();

    if (claimed && (MODEL_ASSERTABLE as readonly string[]).includes(claimed)) {
      // A POSITIVE VERDICT MUST CITE SOMETHING. An uncited "verified" is the
      // model's opinion, and the whole architecture rests on the difference.
      if (POSITIVE.includes(claimed as SignalVerdict) && evidence.length === 0) {
        // UNLESS CODE ALREADY PROVED IT. The model's verdict is discarded
        // either way — what stands is the capability's own finding, with the
        // capability's own citations. This is not the model being believed
        // after all: nothing here reads `claimed`.
        if (proven) {
          return {
            signal: key, event: String(sig.event), subject: String(sig.subject),
            verdict: proven.verdict as SignalVerdict,
            established_by: ran[0], evidence_ids: [...proven.evidence_ids],
            requires_unlock: false,
            reason: `${ran.join(", ")} established ${proven.verdict} on ` +
              `${proven.evidence_ids.length} item(s); the model's uncited ` +
              `"${claimed}" was discarded`,
          };
        }
        return {
          signal: key, event: String(sig.event), subject: String(sig.subject),
          verdict: "absent" as SignalVerdict,
          established_by: ran[0], evidence_ids: [],
          requires_unlock: false,
          reason: `${ran.join(", ")} ran, and the claimed "${claimed}" cited no ` +
            `evidence — an uncited positive verdict is downgraded, never trusted`,
        };
      }
      return {
        signal: key, event: String(sig.event), subject: String(sig.subject),
        verdict: claimed as SignalVerdict,
        established_by: ran[0], evidence_ids: evidence,
        requires_unlock: false,
        reason: `${ran.join(", ")} ran; ${claimed}` +
          (evidence.length ? ` on ${evidence.length} cited item(s)` : ""),
      };
    }

    // ── 4. IT RAN AND NOTHING JUDGED IT ──────────────────────────────────
    //
    // Unless CODE judged it. A deterministic capability that read real evidence
    // and cited it is a stronger authority than a model, not a weaker one.
    if (proven) {
      return {
        signal: key, event: String(sig.event), subject: String(sig.subject),
        verdict: proven.verdict as SignalVerdict,
        established_by: ran[0], evidence_ids: [...proven.evidence_ids],
        requires_unlock: false,
        reason: `${ran.join(", ")} established ${proven.verdict} on ` +
          `${proven.evidence_ids.length} item(s), with no evaluator involved`,
      };
    }

    // The common case with no model credit. `absent` would be a lie — the
    // investigation happened but nobody read it — so this stays honest.
    return {
      signal: key, event: String(sig.event), subject: String(sig.subject),
      verdict: "not_investigated" as SignalVerdict,
      established_by: ran[0], evidence_ids: [],
      requires_unlock: false,
      reason: `${ran.join(", ")} ran but no evaluator judged ${key}`,
    };
  });
}

/**
 * Verdicts that claim a signal nobody investigated.
 *
 * Read by qualification and by tests. Returns the violations rather than
 * throwing, because the caller is deciding what to DO about a bad claim and a
 * stack trace decides nothing.
 */
export function verdictsClaimingUninvestigatedSignals(
  assessments: readonly SignalAssessment[],
): string[] {
  return assessments
    .filter((a) => isPositiveSignal(a.verdict) && a.established_by === null)
    .map((a) => `${a.signal}: claimed ${a.verdict} with no capability having run`);
}

/**
 * Is the mission's signal requirement met, and may that be stated?
 *
 * THREE-VALUED, like every other gate here. `unknown` is returned when a
 * required signal was never investigated — which must not read as failure, or a
 * capability gap becomes a verdict about the company.
 */
export type SignalRequirementOutcome = "met" | "not_met" | "unknown";

export function signalRequirementOutcome(
  assessments: readonly SignalAssessment[],
): { outcome: SignalRequirementOutcome; reason: string } {
  if (assessments.length === 0) {
    return { outcome: "met", reason: "the mission requires no signal" };
  }
  const uninvestigated = assessments.filter((a) =>
    a.verdict === "not_investigated" || a.verdict === "investigation_failed");
  if (uninvestigated.length > 0) {
    return {
      outcome: "unknown",
      reason: `${uninvestigated.map((a) => a.signal).join(", ")} ` +
        `${uninvestigated.length === 1 ? "was" : "were"} not investigated, so ` +
        `the signal requirement cannot be judged either way`,
    };
  }
  const missing = assessments.filter((a) => !isPositiveSignal(a.verdict));
  if (missing.length > 0) {
    return {
      outcome: "not_met",
      reason: `${missing.map((a) => a.signal).join(", ")} investigated and absent`,
    };
  }
  return {
    outcome: "met",
    reason: `${assessments.map((a) => a.signal).join(", ")} evidenced`,
  };
}
