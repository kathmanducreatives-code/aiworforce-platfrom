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
  /**
   * WHICH PAID CALLS STAND BEHIND THIS ROUND, AND WHAT EACH CONTRIBUTED.
   *
   * A merged round has more than one source, and they prove different things:
   * the source that CITED it (its source URLs) proves the event happened; the
   * source that only REPORTED it corroborates. Absent on a round that came
   * straight from one record — `roundProvenance` then reads the record's own
   * call. See `fundingCorroboration.corroborateFunding`.
   */
  provenance?: readonly FundingProvenanceRef[];
}

/** One source of one funding round. */
export interface FundingProvenanceRef {
  actor: string;
  /** The paid call that returned it. Null only when no call is known (a fixture, a replay). */
  provider_call_id: string | null;
  /**
   * `cited`: this source supplied the round's source URL(s) — it is the event's
   * citation. `reported`: it listed the round without citing it. A source is
   * never marked `cited` for a URL it did not supply.
   */
  role: "reported" | "cited";
}

/**
 * WHO SAID THE HISTORY IS COMPLETE.
 *
 * "No later round" (a stage PASS) and "nothing recent" (a recency FAIL) are
 * claims about rounds we have not seen; the only thing that licenses them is a
 * provider's statement of how many rounds exist. This names that provider and
 * the call it answered in, so a verdict that leans on completeness can cite it.
 */
export interface FundingCompletenessRef {
  actor: string;
  provider_call_id: string | null;
  reported_round_count: number | null;
  history_complete: boolean | null;
  /** Does the count cover the rounds held? False is a PARTIAL history, stated. */
  complete: boolean;
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
  /**
   * The ONE paid call that returned it, when exactly one did. A record merged
   * from several calls leaves this null — it is never forced onto one of them —
   * and names them all in `provider_call_ids`.
   */
  provider_call_id?: string | null;
  /** Every paid call this record was built from, deduplicated in contribution order. */
  provider_call_ids?: readonly string[];
  /**
   * The source of the completeness count, when one exists. `undefined` on a
   * record nobody stamped (derived from the record by `recordCompleteness`);
   * `null` when completeness was WITHDRAWN (two sources disagreed).
   */
  completeness?: FundingCompletenessRef | null;
  /** Who the record is about, as the provider named them. Identity, not evidence. */
  company?: { name: string | null; domain: string | null; linkedin_url: string | null } | null;
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

// ── PROVENANCE: WHICH PAID CALL PROVES WHAT ─────────────────────────────────
//
// A funding verdict can rest on two purchases that prove DIFFERENT things. The
// corroborated Seed PASS is the canonical case:
//
//   the Seed EVENT        reported by atomus, CITED by pvalyou (source URL)
//   the history's COMPLETENESS   atomus's true round count — "no later round"
//
// Merging the two records into one used to keep neither call id: the record
// carried `provider_call_id: null` and the verdict named only the call that
// happened to settle it. These helpers keep every source, keep event and
// history provenance apart, and never attach a source to a citation it did not
// supply.

/** Distinct call ids, in first-seen order. Nulls dropped. Same input ⇒ same output. */
export function dedupeCallIds(ids: Iterable<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const id of ids) if (typeof id === "string" && id && !out.includes(id)) out.push(id);
  return out;
}

/** Distinct provenance refs (actor, call, role), in first-seen order. */
export function dedupeProvenance(refs: Iterable<FundingProvenanceRef>): FundingProvenanceRef[] {
  const out: FundingProvenanceRef[] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    const k = `${r.actor}|${r.provider_call_id ?? ""}|${r.role}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ actor: r.actor, provider_call_id: r.provider_call_id ?? null, role: r.role });
  }
  return out;
}

/**
 * Who stands behind this round. A round that carries its own provenance (a
 * merged round) answers for itself; otherwise it is the record's own call, and
 * it CITED the round only if the round carries a source URL from it.
 */
export function roundProvenance(record: FundingRecordFact, round: FundingRoundFact): FundingProvenanceRef[] {
  if (round.provenance && round.provenance.length > 0) return dedupeProvenance(round.provenance);
  return [{
    actor: record.actor, provider_call_id: record.provider_call_id ?? null,
    role: (round.source_urls?.length ?? 0) > 0 ? "cited" : "reported",
  }];
}

/** Is this record's round list complete, by the provider's own count? */
function historyIsComplete(r: FundingRecordFact): boolean {
  if (r.history_complete === true) return true;
  return typeof r.reported_round_count === "number" && r.reported_round_count <= r.rounds.length;
}

/**
 * The source of this record's completeness count, or null when it states none.
 * A record that was stamped answers for itself (null = withdrawn); an unstamped
 * one is its own source when it states a count.
 */
export function recordCompleteness(r: FundingRecordFact): FundingCompletenessRef | null {
  if (r.completeness !== undefined) return r.completeness;
  if (r.history_complete !== true && typeof r.reported_round_count !== "number") return null;
  return {
    actor: r.actor, provider_call_id: r.provider_call_id ?? null,
    reported_round_count: r.reported_round_count, history_complete: r.history_complete,
    complete: historyIsComplete(r),
  };
}

/** Every paid call a record was built from. */
export function recordCallIds(r: FundingRecordFact): string[] {
  return dedupeCallIds([
    ...(r.provider_call_ids ?? []),
    r.provider_call_id,
    ...r.rounds.flatMap((round) => roundProvenance(r, round).map((p) => p.provider_call_id)),
    recordCompleteness(r)?.provider_call_id,
  ]);
}

/** What a funding verdict rests on, in the terms an audit asks. */
export interface FundingDecisionProvenance {
  /** The rounds the verdict rests on, each with who reported and who cited it. */
  events: Array<{ round_type: string | null; announced_date: string | null; sources: FundingProvenanceRef[] }>;
  /**
   * The completeness the verdict RELIES ON — set only when it does (a stage
   * PASS; a recency FAIL). Null for every other verdict, and always null on
   * PENDING: a verdict that did not use completeness does not claim it.
   */
  history_completeness: FundingCompletenessRef | null;
  /** Every paid call the verdict materially rests on: event sources, then completeness. */
  provider_call_ids: string[];
}

/**
 * Provenance for a decided verdict. `sources_of` resolves a carrier round's
 * sources (by default from the one record the verdict read).
 */
export function fundingDecisionProvenance(i: {
  verdict: FundingStageVerdict;
  carrier_rounds: readonly FundingRoundFact[];
  record: FundingRecordFact | null;
  /** True when the verdict could not have been reached without a complete history. */
  relies_on_completeness: boolean;
  sources_of?: (round: FundingRoundFact) => FundingProvenanceRef[];
  completeness?: FundingCompletenessRef | null;
}): FundingDecisionProvenance {
  const sourcesOf = i.sources_of ??
    ((round: FundingRoundFact) => (i.record ? roundProvenance(i.record, round) : dedupeProvenance(round.provenance ?? [])));
  const events = i.carrier_rounds.map((round) => ({
    round_type: normalizeRoundType(round.round_type),
    announced_date: round.announced_date,
    sources: sourcesOf(round),
  }));
  const completeness = i.verdict !== "pending" && i.relies_on_completeness
    ? (i.completeness !== undefined ? i.completeness : (i.record ? recordCompleteness(i.record) : null))
    : null;
  return {
    events,
    history_completeness: completeness,
    provider_call_ids: dedupeCallIds([
      ...events.flatMap((e) => e.sources.map((s) => s.provider_call_id)),
      completeness?.provider_call_id,
    ]),
  };
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
  /** The call that settled the claim. Used only when the record names no call of its own. */
  provider_call_id: string | null;
  observed_at: string;
  valid_until?: string | null;
  /** The evidence the verdict was derived from — the funding record item(s) it read. */
  derived_from?: readonly string[];
}): EvidenceItem | null {
  const d = i.decision;
  if (d.verdict === "pending") return null;
  const carrier = d.carrier_rounds[0] ?? null;
  // Only a PASS needs the whole history ("no LATER round"); a FAIL rests on the
  // later round alone.
  const provenance = fundingDecisionProvenance({
    verdict: d.verdict, carrier_rounds: d.carrier_rounds, record: i.record,
    relies_on_completeness: d.verdict === "pass",
  });
  const ids = provenance.provider_call_ids.length > 0
    ? provenance.provider_call_ids : dedupeCallIds([i.provider_call_id]);
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
      provenance,
    },
    status: fundingStageStatus(d.verdict),
    source: {
      provider: i.record.provider,
      actor: i.record.actor,
      // ONE call when one call proves it; null when several do — never forced
      // onto one of them. `provider_call_ids` names them all.
      provider_call_id: ids.length === 1 ? ids[0] : null,
      provider_call_ids: ids,
      url: carrier?.source_urls[0] ?? i.record.source_url ?? null,
      excerpt: null,
    },
    // The rung comes from a provider field; the ORDERING of rungs is ours.
    method: "deterministic_derivation",
    observed_at: i.observed_at,
    valid_until: i.valid_until ?? null,
    confidence: d.verdict === "pass" ? "high" : "medium",
    derived_from: [...(i.derived_from ?? [])],
    mission_id: i.mission_id,
    origin: "lead_mission",
  };
}

// ── "RECENTLY FUNDED" — DECIDED FROM ROUNDS WE ALREADY HOLD ─────────────────
//
// A funding SIGNAL criterion ("recently raised", "funded in the last 6 months")
// used to pass on the mere PRESENCE of a funding item, whatever its date. So a
// company whose only round was announced in 2019 satisfied "recently funded",
// and the mission's own time window — which the card prints — decided nothing.
//
// This reads the dated rounds the mission ALREADY has (funding discovery's
// FundingRecordFacts, the corroborated record the pair writes) and answers the
// window. It buys nothing: the verifier route exists for companies we hold no
// rounds for at all, and is never taken for one we do.
//
// The asymmetry of `decideFundingStage` is kept, for the same reason:
//
//   a verified round inside the window                      → PASS
//   no round inside it, and the history is COMPLETE         → FAIL
//   no round inside it, and the history may be partial      → PENDING
//   no rounds, undated rounds, or no record at all          → PENDING
//
// Absence is never disproof: "we have not seen a recent round" and "there has
// not been one" are different claims, and only a complete history closes the
// gap between them.

export type RecentFundingReason =
  | "no_funding_record"
  | "no_dated_rounds"
  | "round_inside_window"
  | "no_round_inside_window"
  | "history_incomplete"
  | "no_window_requested";

export interface RecentFundingDecision {
  version: typeof FUNDING_STAGE_CLAIM_VERSION;
  verdict: FundingStageVerdict;
  /** The window asked for, in days. */
  window_days: number | null;
  /** The most recent dated round seen, whatever the verdict. */
  latest_announced_date: string | null;
  reasons: RecentFundingReason[];
  explanation: string;
  carrier_rounds: FundingRoundFact[];
  /**
   * The paid calls behind the carrier rounds and, for a FAIL, the complete
   * history that licenses "nothing recent". A PASS needs no completeness.
   */
  provenance: FundingDecisionProvenance;
}

export function decideRecentlyFunded(i: {
  window_days: number | null;
  /** Every funding record the company already carries. Nothing is bought here. */
  records: readonly FundingRecordFact[];
  now: Date | string;
}): RecentFundingDecision {
  const base: RecentFundingDecision = {
    version: FUNDING_STAGE_CLAIM_VERSION, verdict: "pending", window_days: i.window_days,
    latest_announced_date: null, reasons: [], explanation: "", carrier_rounds: [],
    provenance: { events: [], history_completeness: null, provider_call_ids: [] },
  };
  // A carrier round's sources come from the record that held it.
  const owner = new Map<FundingRoundFact, FundingRecordFact>();
  for (const r of i.records) for (const round of r.rounds ?? []) if (!owner.has(round)) owner.set(round, r);
  const sourcesOf = (round: FundingRoundFact) => {
    const r = owner.get(round);
    return r ? roundProvenance(r, round) : dedupeProvenance(round.provenance ?? []);
  };
  const prov = (verdict: FundingStageVerdict, carriers: FundingRoundFact[], completeFrom: FundingRecordFact | null) =>
    fundingDecisionProvenance({
      verdict, carrier_rounds: carriers, record: null, sources_of: sourcesOf,
      relies_on_completeness: completeFrom !== null, completeness: completeFrom ? recordCompleteness(completeFrom) : null,
    });
  const now = typeof i.now === "string" ? Date.parse(i.now) : i.now.getTime();
  if (!i.window_days || i.window_days <= 0) {
    return { ...base, reasons: ["no_window_requested"], explanation: "no recency window was asked for" };
  }
  const records = i.records.filter((r) => (r.rounds?.length ?? 0) > 0);
  if (records.length === 0) {
    return { ...base, reasons: ["no_funding_record"], explanation: "no funding record was retrieved" };
  }
  const cutoff = now - i.window_days * 86_400_000;
  const dated = records.flatMap((r) => r.rounds.map((round) => ({ round, at: Date.parse(round.announced_date ?? "") })))
    .filter((x) => Number.isFinite(x.at));
  if (dated.length === 0) {
    return { ...base, reasons: ["no_dated_rounds"],
      explanation: "funding is reported, but no round carries an announced date" };
  }
  const latest = dated.reduce((a, b) => (b.at > a.at ? b : a));
  base.latest_announced_date = latest.round.announced_date;

  // PASS: a round we can VERIFY (a provider field with a citation or a date),
  // announced inside the window.
  const inside = dated.filter((x) => x.at >= cutoff && isVerifiedRound(x.round));
  if (inside.length > 0) {
    const days = Math.round((now - latest.at) / 86_400_000);
    return {
      ...base, verdict: "pass", reasons: ["round_inside_window"],
      carrier_rounds: inside.map((x) => x.round),
      provenance: prov("pass", inside.map((x) => x.round), null),
      explanation: `a verified ${normalizeRoundType(inside[0].round.round_type) ?? "funding"} round was announced ` +
        `${days} day(s) ago, inside the ${i.window_days}-day window`,
    };
  }

  // FAIL needs the whole record: "nothing recent" is a claim about rounds we
  // have not seen unless the provider says there are none.
  const completeRecord = records.find(historyIsComplete) ?? null;
  if (completeRecord) {
    const days = Math.round((now - latest.at) / 86_400_000);
    return {
      ...base, verdict: "fail", reasons: ["no_round_inside_window"], carrier_rounds: [latest.round],
      provenance: prov("fail", [latest.round], completeRecord),
      explanation: `the most recent round in a complete history was announced ${days} day(s) ago, ` +
        `outside the ${i.window_days}-day window`,
    };
  }
  return {
    ...base, reasons: ["history_incomplete"], carrier_rounds: [latest.round],
    provenance: prov("pending", [latest.round], null),
    explanation: `the rounds we hold are all older than the ${i.window_days}-day window, ` +
      `but no provider states this is the full history`,
  };
}
