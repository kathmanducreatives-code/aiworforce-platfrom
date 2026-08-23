// TWO QUESTIONS, NEVER ONE SCORE.
//
// ── WHY THESE MUST NOT BE COLLAPSED ─────────────────────────────────────────
//
// "Find founders matching my ICP whose comments show they need what I sell" is
// two independent claims about two different objects:
//
//   ICP FIT      who the company and the person ARE — industry, size,
//                geography, role. A property of identity, slow-moving, and
//                provable from firmographic evidence.
//
//   INTENT FIT   what they SAID — the topic, the problem, how strongly it reads
//                as a need, and how recently. A property of behaviour,
//                fast-decaying, and provable only from dated content.
//
// A lead that is strong on one and absent on the other is not a middling lead;
// it is a different kind of lead, and averaging them into a single number
// destroys exactly the information a user needs to act. Someone complaining
// eloquently about a problem who is not in the ICP is not a prospect. A perfect
// ICP match who has said nothing is a cold account, not a warm one.
//
// So this module keeps them apart, records what evidenced each, and refuses to
// emit a combined score. `combinedPriority` returns a BAND — a coarse, ordinal
// label a human can reason about — and the band is derived from the two
// verdicts rather than from arithmetic on invented weights.
//
// ── WHAT CODE DECIDES AND WHAT THE MODEL DECIDES ────────────────────────────
//
// The model judges. Whether a comment about "reply rates falling off a cliff"
// indicates a need for outbound help is a semantic question, and no regex owns
// it. What this module owns is the SHAPE of the answer: that a verdict cites
// evidence, that an unevidenced verdict is `insufficient_evidence` rather than
// a guess, that intent has a date, and that the two dimensions stay separable
// all the way to the ranking.
//
// PURE. No network, provider, model or database access.

import type { SignalSubject } from "./missionSignalDescriptor.ts";

export const ICP_INTENT_VERSION = "icp-intent-separation-v1" as const;

/** How well the ENTITY matches who the user sells to. */
export type IcpVerdict = "strong" | "partial" | "poor" | "insufficient_evidence";

/**
 * How strongly the CONTENT indicates the need the user's offer addresses.
 *
 * `explicit` is reserved for someone stating the need or asking for help.
 * `implied` covers describing the problem, complaining about the current
 * process, or discussing poor results — which is what real buying intent
 * usually looks like, and why searching for the literal words "looking for
 * help" finds almost nobody.
 */
export type IntentVerdict =
  | "explicit" | "implied" | "topical_only" | "none" | "insufficient_evidence";

/** One citation. A verdict without at least one of these is not a verdict. */
export interface EvidenceRef {
  /** What kind of artifact this is. */
  kind: "post" | "comment" | "job" | "article" | "funding_round" | "firmographic";
  /** Where a person can go and read it. Null only for firmographic records. */
  url: string | null;
  /** ISO date of the artifact. Required for anything time-sensitive. */
  dated_at: string | null;
  /** The words that carried the claim, quoted rather than paraphrased. */
  excerpt?: string;
}

export interface IcpAssessment {
  verdict: IcpVerdict;
  /** Which ICP dimensions were actually checked — industry, size, geography… */
  dimensions_met: readonly string[];
  dimensions_failed: readonly string[];
  dimensions_unknown: readonly string[];
  evidence: readonly EvidenceRef[];
  reason: string;
}

export interface IntentAssessment {
  verdict: IntentVerdict;
  /** Whose behaviour this is. A company post and a founder's post differ. */
  subject: SignalSubject;
  /** What the content was about, in the model's words. */
  topic: string | null;
  /** Age of the freshest supporting artifact, in days. Null when undated. */
  age_days: number | null;
  evidence: readonly EvidenceRef[];
  reason: string;
}

/**
 * The ordinal band, and deliberately not a number.
 *
 * A score invites arithmetic nobody calibrated — averaging a 0.8 ICP with a 0.3
 * intent produces 0.55, which is meaningless and looks authoritative. A band
 * says what to DO with the lead and keeps both inputs visible beside it.
 */
export type PriorityBand =
  /** In the ICP and actively signalling. Work these first. */
  | "priority"
  /** In the ICP, talking about the space without a clear need. */
  | "warm"
  /** In the ICP, no signal. A normal outbound account. */
  | "icp_only"
  /** Signalling clearly, outside the ICP. Interesting, not a prospect. */
  | "signal_outside_icp"
  /** Neither holds. */
  | "not_qualified"
  /** One of the two could not be judged from the evidence collected. */
  | "insufficient_evidence";

export interface RankedCandidate {
  icp: IcpAssessment;
  intent: IntentAssessment;
  band: PriorityBand;
  /** Why this band, naming both halves. Shown to the user. */
  rationale: string;
}

/** Bands in the order a user should work them. */
export const PRIORITY_ORDER: readonly PriorityBand[] = Object.freeze([
  "priority", "warm", "icp_only", "signal_outside_icp",
  "insufficient_evidence", "not_qualified",
]);

/**
 * Combine two verdicts into a band.
 *
 * ── THE ONE DETERMINISTIC RULE IN A SEMANTIC PIPELINE ──────────────────────
 *
 * Everything upstream is the model's judgement. This is not, because the
 * COMBINATION is where a scoring formula would quietly be invented, and where
 * the ICP/intent distinction would quietly be lost. The rules are ordinal, they
 * are few, and each one is a sentence a user would agree with:
 *
 *   a strong ICP with real intent is the best lead available;
 *   a strong signal from outside the ICP is never promoted on signal alone;
 *   an unjudgeable half is reported as unjudgeable, never rounded to zero.
 */
export function combinedPriority(
  icp: IcpAssessment, intent: IntentAssessment,
): PriorityBand {
  // AN UNJUDGED HALF IS NOT A ZERO. Rounding "we could not tell" down to "no"
  // is how a missing capability turns into a negative verdict about a company.
  if (icp.verdict === "insufficient_evidence" ||
      intent.verdict === "insufficient_evidence") {
    return "insufficient_evidence";
  }

  const inIcp = icp.verdict === "strong" || icp.verdict === "partial";
  const signalling = intent.verdict === "explicit" || intent.verdict === "implied";

  if (!inIcp) {
    // OUTSIDE THE ICP, SIGNAL OR NOT. A stranger describing the problem this
    // product solves is a fine piece of market research and a bad lead, so it
    // is surfaced under its own band rather than mixed into the good ones.
    return signalling ? "signal_outside_icp" : "not_qualified";
  }
  if (signalling) return "priority";
  if (intent.verdict === "topical_only") return "warm";
  return "icp_only";
}

/** Assemble a ranked candidate, keeping both halves legible. */
export function rankCandidate(
  icp: IcpAssessment, intent: IntentAssessment,
): RankedCandidate {
  const band = combinedPriority(icp, intent);
  return { icp, intent, band, rationale: explainBand(band, icp, intent) };
}

function explainBand(
  band: PriorityBand, icp: IcpAssessment, intent: IntentAssessment,
): string {
  const icpPart = `ICP ${icp.verdict}` +
    (icp.dimensions_met.length ? ` (${icp.dimensions_met.join(", ")})` : "");
  const intentPart = `intent ${intent.verdict}` +
    (intent.topic ? ` on "${intent.topic}"` : "") +
    (intent.age_days != null ? `, ${intent.age_days}d old` : "");

  switch (band) {
    case "priority":
      return `${icpPart} and ${intentPart}. Both halves are evidenced, which is ` +
        `the only combination that earns priority.`;
    case "warm":
      return `${icpPart} and ${intentPart}. They are in the space but nothing ` +
        `read as a need, so this is interest rather than intent.`;
    case "icp_only":
      return `${icpPart}, and no relevant activity was found. A normal outbound ` +
        `account, not a signalled one.`;
    case "signal_outside_icp":
      return `${intentPart}, but ${icpPart}. Signal alone never promotes a ` +
        `candidate: someone with the problem you solve is not a prospect if you ` +
        `do not sell to them.`;
    case "insufficient_evidence":
      return `Not judgeable: ${icp.verdict === "insufficient_evidence"
        ? `ICP fit could not be established (${icp.reason})`
        : `intent could not be established (${intent.reason})`}.`;
    case "not_qualified":
      return `${icpPart} and ${intentPart}. Neither half holds.`;
  }
}

/**
 * Sort candidates by band, then by intent recency inside a band.
 *
 * Recency breaks ties and nothing else: it decides ORDER within a band and is
 * never allowed to lift a candidate into a better one. A very recent comment
 * from outside the ICP stays outside the ICP.
 */
export function rankAll(candidates: readonly RankedCandidate[]): RankedCandidate[] {
  return [...candidates].sort((a, b) => {
    const ba = PRIORITY_ORDER.indexOf(a.band);
    const bb = PRIORITY_ORDER.indexOf(b.band);
    if (ba !== bb) return ba - bb;
    const aa = a.intent.age_days ?? Number.POSITIVE_INFINITY;
    const ab = b.intent.age_days ?? Number.POSITIVE_INFINITY;
    return aa - ab;
  });
}

/**
 * Reasons an assessment may not be trusted as stated.
 *
 * Read by qualification. An assessment that cites nothing, or dates nothing
 * while claiming recency, is a model's opinion rather than a finding — and the
 * whole architecture rests on the difference.
 */
export function assessmentViolations(
  icp: IcpAssessment, intent: IntentAssessment,
): string[] {
  const out: string[] = [];
  if (icp.verdict !== "insufficient_evidence" && icp.evidence.length === 0) {
    out.push("icp_verdict_without_evidence");
  }
  if (intent.verdict !== "insufficient_evidence" && intent.verdict !== "none" &&
      intent.evidence.length === 0) {
    out.push("intent_verdict_without_evidence");
  }
  // Intent is a claim about NOW. An undated artifact cannot support it.
  if ((intent.verdict === "explicit" || intent.verdict === "implied") &&
      intent.evidence.every((e) => e.dated_at === null)) {
    out.push("intent_claimed_without_a_dated_artifact");
  }
  // A person-subject intent must cite something a person authored.
  if (intent.subject !== "company" &&
      intent.evidence.some((e) => e.kind === "firmographic")) {
    out.push("person_intent_cited_from_firmographic_evidence");
  }
  return out;
}
