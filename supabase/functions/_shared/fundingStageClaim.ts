// LEAD V2 P6 — WHAT PROVES A COMPANY IS STILL AT SEED.
//
// The mission says "pre-seed to seed". Today the only thing that answers a
// `company_stage` criterion is a substring test against whatever label an actor
// happened to attach, so "series_c" and "seed" are compared as text and a
// cohort record decides nothing. That is not a stage claim; it is a string.
//
// A funding stage is an ORDERING over verified rounds, and the architecture
// document fixes the decision (§12):
//
//   verified latest round = Seed AND no later verified Series A/B/C → PASS
//   verified Series A/B/C later round                               → FAIL
//   funding exists but round type unclear                           → PENDING
//   no trustworthy data                                             → PENDING
//
// and one prohibition that this module exists to enforce:
//
//   "Do not infer stage from company age, branding, team size, or GPT
//    intuition."
//
// So the only input here is a list of ROUNDS. There is no headcount parameter,
// no founded year, no description — the function could not infer from them if a
// caller wanted it to. A model-extracted round type is carried as corroboration
// and can never, by itself, decide anything: §12 also says Firecrawl "should
// not be the primary funding-stage classifier".
//
// TWO ASYMMETRIES ARE DELIBERATE.
//
//   * Absence never fails. No rounds, unreadable rounds, a provider that
//     returned nothing — all PENDING. A company we cannot prove is Seed is not
//     thereby proven to be Series B. (§30: "unknown funding => pending".)
//   * PASS needs a complete record; FAIL does not. To say "no LATER round" is
//     to make a claim about every round that exists, so a partial history can
//     only ever be PENDING. To say "a later round exists" one verified later
//     round is enough, and no completeness is required.
//
// Pure. No provider, no clock beyond what the caller passes, no I/O.

import type { EvidenceItem, EvidenceMethod } from "./candidateObservation.ts";

export const FUNDING_STAGE_CLAIM_VERSION = "funding-stage-claim-v1" as const;

/**
 * THE LADDER. Only rounds that mark a position on it can order a company's
 * stage. Everything else — a bridge, a SAFE, a grant, venture debt, a secondary
 * sale between shareholders — is real funding and is NOT a later stage, so it
 * can neither prove nor contradict one.
 *
 * `pre-seed` and `angel` share rank 0 on purpose: they are both "before seed",
 * and nothing in this file needs to tell them apart.
 */
export const FUNDING_STAGE_LADDER: Readonly<Record<string, number>> = Object.freeze({
  "pre-seed": 0, "angel": 0,
  "seed": 1,
  "series-a": 2, "series-b": 3, "series-c": 4, "series-d": 5, "series-e": 6,
  "series-f": 7, "series-g": 8, "series-h": 9, "series-i": 10,
  "growth": 11, "pre-ipo": 12,
});

/** Funding that carries no rung. Never proof of a stage, never a contradiction. */
export const NON_ORDINAL_ROUND_TYPES: readonly string[] = Object.freeze([
  "extension", "bridge", "convertible", "debt", "grant", "safe",
  "secondary", "pipe", "other", "unknown",
]);

/** One round, as a provider reported it. Nothing here is inferred. */
export interface FundingRoundFact {
  /** The provider's own label, verbatim. Normalized for comparison, never rewritten. */
  round_type: string | null;
  /** ISO date the round was ANNOUNCED. Optional: SEED-1 orders by rung, not by date. */
  announced_date: string | null;
  amount_usd: number | null;
  investors: readonly string[];
  source_urls: readonly string[];
  /** `model_extraction` is corroboration only — it cannot decide this claim. */
  method: EvidenceMethod;
}

/** A company's funding record as one provider holds it. */
export interface FundingRecordFact {
  provider: string;
  actor: string;
  rounds: readonly FundingRoundFact[];
  /**
   * The provider's own count of rounds it holds for this company. When it
   * exceeds the rounds we were given, the history is partial and PASS is not
   * available — we cannot see whether a later round is among the missing ones.
   */
  reported_round_count: number | null;
  /** True only when the provider states this is the company's COMPLETE record. */
  history_complete: boolean | null;
  observed_at: string | null;
  source_url: string | null;
}

export type FundingStageVerdict = "pass" | "fail" | "pending";

export type FundingStageReason =
  | "no_funding_record"
  | "no_rounds_reported"
  | "round_type_unclear"
  | "unrequestable_stage"
  | "history_incomplete"
  | "later_round_verified"
  | "later_round_unverified"
  | "required_stage_not_verified"
  | "required_stage_verified_and_latest"
  | "model_extraction_only"
  /** PASS was asked to rest on a CITED round, and the decisive round carries no source URL. */
  | "required_stage_uncorroborated";

export interface FundingStageDecision {
  version: typeof FUNDING_STAGE_CLAIM_VERSION;
  verdict: FundingStageVerdict;
  /** The stage asked for, normalized. Null when the mission asked for a stage off the ladder. */
  required_stage: string | null;
  /** Highest rung any VERIFIED round reaches. Null when none does. */
  highest_verified_stage: string | null;
  /** A later rung seen but not verified — enough to withhold PASS, never enough to FAIL. */
  highest_unverified_stage: string | null;
  reasons: FundingStageReason[];
  /** Human sentence for the Workbench. Says what was proven, not what was guessed. */
  explanation: string;
  /** Rounds the verdict actually rests on, so the claim can cite them. */
  carrier_rounds: FundingRoundFact[];
  /** Whether a web/model reading agreed. Recorded; never load-bearing. */
  corroborated_by_model: boolean;
}

/** `Series A` / `series_a` / `SERIES-A` are one rung. */
export function normalizeRoundType(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  if (!t) return null;
  const alias: Record<string, string> = {
    "preseed": "pre-seed", "pre-seed-round": "pre-seed", "seed-round": "seed",
    "angel-round": "angel", "series-a-round": "series-a",
    "secondary-market": "secondary", "post-ipo-debt": "debt", "post-ipo-equity": "pipe",
    "private-equity": "growth", "corporate-round": "other", "venture-round": "unknown",
  };
  const n = alias[t] ?? t;
  if (n in FUNDING_STAGE_LADDER) return n;
  if (NON_ORDINAL_ROUND_TYPES.includes(n)) return n;
  return "unknown";
}

/** A rung, or null for funding that carries none. */
export function stageRank(type: string | null): number | null {
  if (!type) return null;
  const r = FUNDING_STAGE_LADDER[type];
  return typeof r === "number" ? r : null;
}

/**
 * VERIFIED means: a provider field (or a deterministic derivation of one) that
 * names a rung AND carries a citation — a source url or an announced date.
 *
 * A round type with neither is a bare assertion, and a bare assertion is not
 * allowed to contradict a user's criterion.
 */
export function isVerifiedRound(r: FundingRoundFact): boolean {
  if (r.method === "model_extraction") return false;
  if (stageRank(normalizeRoundType(r.round_type)) === null) return false;
  return (r.source_urls?.length ?? 0) > 0 || !!r.announced_date;
}

function label(rank: number): string {
  for (const [k, v] of Object.entries(FUNDING_STAGE_LADDER)) if (v === rank && k !== "angel") return k;
  return "unknown";
}

/**
 * SEED-1 and its generalization to any rung of the ladder.
 *
 * @param required_stage the stage the mission asked for ("seed", "pre-seed", …).
 * @param record the funding record, or null when no provider produced one.
 */
export function decideFundingStage(i: {
  required_stage: string | null;
  record: FundingRecordFact | null;
  /**
   * PASS MUST CITE. A round is "verified" by a source URL OR an announced date,
   * which is enough to CONTRADICT a stage (one dated Series A is a later round)
   * but not enough to PROVE one: a dated Seed row from a firmographics feed is
   * the provider's word, not a citation. When true, PASS additionally requires
   * the decisive round to carry a source URL; otherwise the claim is PENDING
   * (`required_stage_uncorroborated`). FAIL is unchanged. Default false keeps
   * every existing caller exactly as it was.
   */
  pass_requires_source_url?: boolean;
}): FundingStageDecision {
  const required = normalizeRoundType(i.required_stage);
  const requiredRank = stageRank(required);
  const base: FundingStageDecision = {
    version: FUNDING_STAGE_CLAIM_VERSION,
    verdict: "pending", required_stage: requiredRank === null ? null : required,
    highest_verified_stage: null, highest_unverified_stage: null,
    reasons: [], explanation: "", carrier_rounds: [], corroborated_by_model: false,
  };

  if (requiredRank === null) {
    // "bootstrapped", "growth-stage", a free-text stage — not a rung, so this
    // module has nothing to say and must not pretend otherwise.
    return { ...base, reasons: ["unrequestable_stage"],
      explanation: `"${i.required_stage ?? ""}" is not a funding round, so funding rounds cannot decide it` };
  }
  if (!i.record) {
    return { ...base, reasons: ["no_funding_record"], explanation: "no funding record was retrieved" };
  }

  const rounds = i.record.rounds ?? [];
  base.corroborated_by_model = rounds.some(
    (r) => r.method === "model_extraction" && stageRank(normalizeRoundType(r.round_type)) !== null,
  );
  if (rounds.length === 0) {
    return { ...base, reasons: ["no_rounds_reported"],
      explanation: `${i.record.provider} returned no funding rounds, which is not evidence of a stage` };
  }

  const ranked = rounds
    .map((r) => ({ r, type: normalizeRoundType(r.round_type), verified: isVerifiedRound(r) }))
    .map((x) => ({ ...x, rank: stageRank(x.type) }));
  const onLadder = ranked.filter((x) => x.rank !== null);

  if (onLadder.length === 0) {
    return { ...base, reasons: ["round_type_unclear"], carrier_rounds: rounds.slice(0, 4).map((r) => r),
      explanation: `${rounds.length} funding event(s) found, none naming a round type that marks a stage` };
  }

  const verified = onLadder.filter((x) => x.verified);
  const unverified = onLadder.filter((x) => !x.verified);
  const maxVerified = verified.length ? Math.max(...verified.map((x) => x.rank as number)) : null;
  const maxUnverified = unverified.length ? Math.max(...unverified.map((x) => x.rank as number)) : null;
  base.highest_verified_stage = maxVerified === null ? null : label(maxVerified);
  base.highest_unverified_stage = maxUnverified === null ? null : label(maxUnverified);

  // FAIL — a verified round sits above the rung the mission asked for. This is
  // the one verdict that needs no completeness: seeing a later round is enough.
  if (maxVerified !== null && maxVerified > requiredRank) {
    const carriers = verified.filter((x) => (x.rank as number) > requiredRank).map((x) => x.r);
    return { ...base, verdict: "fail", reasons: ["later_round_verified"], carrier_rounds: carriers,
      explanation: `a verified ${label(maxVerified)} round is later than ${required}` };
  }

  // A later round we could not verify is ambiguity, never a contradiction.
  if (maxUnverified !== null && maxUnverified > requiredRank) {
    return { ...base, reasons: ["later_round_unverified"],
      carrier_rounds: unverified.filter((x) => (x.rank as number) > requiredRank).map((x) => x.r),
      explanation: `a ${label(maxUnverified)} round is reported but not verified, so ${required} cannot be confirmed` };
  }

  if (maxVerified === null) {
    const reasons: FundingStageReason[] = ["required_stage_not_verified"];
    if (base.corroborated_by_model) reasons.push("model_extraction_only");
    return { ...base, reasons, carrier_rounds: onLadder.map((x) => x.r),
      explanation: `round types were reported but none is verified by a provider field with a citation` };
  }
  if (maxVerified < requiredRank) {
    // Verified pre-seed against a seed criterion: earlier, not later. Not proof
    // of the asked-for stage, and not a contradiction either.
    return { ...base, reasons: ["required_stage_not_verified"], carrier_rounds: verified.map((x) => x.r),
      explanation: `the latest verified round is ${label(maxVerified)}, earlier than ${required}` };
  }

  // PASS NEEDS THE WHOLE RECORD. "No later round" is a claim about rounds we
  // have not seen, so a partial history can only be PENDING.
  const held = rounds.length;
  const complete = i.record.history_complete === true ||
    (typeof i.record.reported_round_count === "number" && i.record.reported_round_count <= held);
  if (!complete) {
    return { ...base, reasons: ["history_incomplete"], carrier_rounds: verified.map((x) => x.r),
      explanation: i.record.reported_round_count === null
        ? `a verified ${required} round was found, but ${i.record.provider} does not state that this is the full history`
        : `a verified ${required} round was found, but ${i.record.provider} reports ${i.record.reported_round_count} rounds and returned ${held}` };
  }

  const decisive = verified.filter((x) => x.rank === requiredRank).map((x) => x.r);
  if (i.pass_requires_source_url && !decisive.some((r) => (r.source_urls?.length ?? 0) > 0)) {
    return { ...base, reasons: ["required_stage_uncorroborated"], carrier_rounds: decisive,
      explanation: `the latest round is ${required} in a complete history, but no source cites that round` };
  }
  return { ...base, verdict: "pass", reasons: ["required_stage_verified_and_latest"],
    carrier_rounds: decisive,
    explanation: `the latest verified round is ${required}, with no later round in a complete history` };
}

/** The claim status this verdict writes into the evidence graph. */
export function fundingStageStatus(v: FundingStageVerdict): EvidenceItem["status"] {
  return v === "pass" ? "proven" : v === "fail" ? "disproven" : "unknown";
}

/**
 * The canonical `company_stage` EvidenceItem for a decided funding-stage claim.
 *
 * The id is STABLE per company and claim, so a second, better funding reading
 * REPLACES this item rather than stacking a second opinion beside it — the same
 * identity rule Phase C established for the business-model claim.
 *
 * Returns null for PENDING: a pending claim is the absence of an answer, and
 * writing an `unknown` item would only give the graph something to mistake for
 * one.
 */
export function fundingStageEvidenceItem(i: {
  company_key: string;
  decision: FundingStageDecision;
  record: FundingRecordFact;
  mission_id: string | null;
  provider_call_id: string | null;
  observed_at: string;
  valid_until?: string | null;
}): EvidenceItem | null {
  const d = i.decision;
  if (d.verdict === "pending") return null;
  const carrier = d.carrier_rounds[0] ?? null;
  return {
    evidence_id: `fnd_${i.company_key}_funding_stage`.slice(0, 64),
    company_key: i.company_key,
    dimension: "company_stage",
    value: {
      claim: "funding_stage",
      required_stage: d.required_stage,
      verdict: d.verdict,
      latest_verified_stage: d.highest_verified_stage,
      reasons: d.reasons,
      explanation: d.explanation,
      rounds_cited: d.carrier_rounds.map((r) => ({
        round_type: normalizeRoundType(r.round_type),
        announced_date: r.announced_date,
        amount_usd: r.amount_usd,
        source_url: r.source_urls[0] ?? null,
      })),
    },
    status: fundingStageStatus(d.verdict),
    source: {
      provider: i.record.provider,
      actor: i.record.actor,
      provider_call_id: i.provider_call_id,
      url: carrier?.source_urls[0] ?? i.record.source_url ?? null,
      excerpt: null,
    },
    // The rung comes from a provider field; the ORDERING of rungs is ours.
    method: "deterministic_derivation",
    observed_at: i.observed_at,
    valid_until: i.valid_until ?? null,
    confidence: d.verdict === "pass" ? "high" : "medium",
    derived_from: [],
    mission_id: i.mission_id,
    origin: "lead_mission",
  };
}
