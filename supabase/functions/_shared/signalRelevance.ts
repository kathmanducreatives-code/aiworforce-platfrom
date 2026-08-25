// PHASE 7 — DOES THIS SITUATION MATTER TO *THIS* COMPANY?
//
// ── WHAT THE MODEL IS AND IS NOT ALLOWED TO DO ──────────────────────────────
//
// The deterministic floor owns EXISTENCE. A `SignalCluster` was built from
// events that were collected, evidenced and written; whether a signal happened
// is settled before this module runs and is never reopened here.
//
// What the model adds is JUDGEMENT ABOUT FIT: does this overlap the ICP, does
// it connect to what the workspace sells, is the buyer plausibly relevant, is
// it actually timely. That is the one question lexical matching cannot answer,
// and it is the only question asked.
//
// ── THE BOUNDARY IS CODE, NOT A PROMPT INSTRUCTION ──────────────────────────
//
// Every rule below is enforced by the validator against the cluster the model
// was given. A prompt that says "only cite real events" is a request; a
// validator that drops uncited claims is a guarantee.
//
//   IT CANNOT INVENT A SIGNAL. Every cited id must be an event id the cluster
//   actually contains. Anything else is dropped, and a verdict left with no
//   citation is refused.
//
//   IT CANNOT PROMOTE. The adjustment is a multiplier in (0, 1]: relevance may
//   lower a cluster's rank and may leave it alone, and there is no arithmetic
//   by which it can raise one. So a cluster cannot overtake one the evidence
//   ranked above it, whatever the model says about it.
//
//   IT CANNOT CALL A STALE SITUATION TIMELY. `timely` is only admitted when a
//   cited event carries a SOURCE date inside the recency window. An undated
//   event is when we looked, not when it happened, and cannot make anything
//   current.
//
//   A FAILURE CHANGES NOTHING. Any provider error, unparseable answer or
//   refused verdict returns the deterministic cluster untouched.
//
// PURE. No network, provider, model or database access — the caller supplies
// the model's answer and this decides what may be believed.

import type { SignalCluster } from "./signalCluster.ts";

export const SIGNAL_RELEVANCE_VERSION = "signal-relevance-v1" as const;

/** How relevant the situation is to this workspace. */
export type RelevanceBand = "high" | "medium" | "low" | "none";

/**
 * What each band does to the deterministic priority.
 *
 * ALL AT OR BELOW 1. Relevance is a demotion instrument: the floor decided what
 * the evidence supports and the model may only say "this matters less to you
 * than its evidence suggests". `high` is 1 — agreement leaves the ranking alone
 * rather than rewarding it, because a model that can add rank can reorder the
 * feed on an opinion.
 */
export const BAND_FACTOR: Readonly<Record<RelevanceBand, number>> = Object.freeze({
  high: 1, medium: 0.7, low: 0.4, none: 0.15,
});

/** How recent a cited source date must be for `timely` to stand. */
export const TIMELY_WINDOW_DAYS = 45;

/** The model's answer, before anything is believed. */
export interface RawRelevanceVerdict {
  relevance?: unknown;
  why_now?: unknown;
  why_it_matters?: unknown;
  /** Event ids from the cluster that support the claim. */
  evidence_event_ids?: unknown;
  /** Whether the model claims the situation is current. */
  timely?: unknown;
}

export interface RelevanceVerdict {
  version: typeof SIGNAL_RELEVANCE_VERSION;
  relevance: RelevanceBand;
  why_now: string | null;
  why_it_matters: string | null;
  /** Event ids, every one verified to belong to this cluster. */
  evidence_event_ids: string[];
  timely: boolean;
  /** The deterministic priority, multiplied down. Never up. */
  adjusted_priority: number;
  /** What the validator changed or refused, in its own words. */
  adjustments: string[];
  /** `model` when a verdict was believed; `deterministic` when it was not. */
  source: "model" | "deterministic";
}

const BANDS: readonly RelevanceBand[] = ["high", "medium", "low", "none"];

const text = (v: unknown, max = 600): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/**
 * The verdict a cluster carries when no model spoke.
 *
 * NOT A NEUTRAL DEFAULT — an explicit statement that the ranking is the
 * deterministic one. `relevance: "high"` would be a claim nobody made; the
 * factor is 1 because the floor's own priority is what stands.
 */
export function deterministicVerdict(c: SignalCluster, reason: string): RelevanceVerdict {
  return {
    version: SIGNAL_RELEVANCE_VERSION,
    relevance: "none",
    why_now: null,
    why_it_matters: null,
    evidence_event_ids: [],
    timely: false,
    adjusted_priority: c.priority,
    adjustments: [reason],
    source: "deterministic",
  };
}

export interface ValidateOptions {
  now?: number;
  timely_window_days?: number;
}

/**
 * Decide what of the model's answer may be believed.
 *
 * Returns a verdict either way: a refused answer becomes the deterministic one
 * with the reason recorded, because a cluster with no explanation is a cluster
 * the feed still has to show.
 */
export function validateRelevance(
  cluster: SignalCluster,
  raw: RawRelevanceVerdict | null | undefined,
  opts: ValidateOptions = {},
): RelevanceVerdict {
  if (!raw || typeof raw !== "object") {
    return deterministicVerdict(cluster, "the model returned no usable answer");
  }
  const adjustments: string[] = [];
  const now = opts.now ?? Date.now();
  const windowDays = opts.timely_window_days ?? TIMELY_WINDOW_DAYS;

  // ── THE BAND ──────────────────────────────────────────────────────────────
  const claimedBand = String(raw.relevance ?? "").toLowerCase() as RelevanceBand;
  if (!BANDS.includes(claimedBand)) {
    return deterministicVerdict(
      cluster, `"${String(raw.relevance)}" is not a relevance band`);
  }

  // ── THE CITATIONS ─────────────────────────────────────────────────────────
  //
  // Kept only if the cluster actually contains the event. This is what stops a
  // model inventing a signal: it may only point at things already collected.
  const ownIds = new Set(
    cluster.events.map((e) => e.id).filter((x): x is string => !!x),
  );
  const claimed = Array.isArray(raw.evidence_event_ids)
    ? raw.evidence_event_ids.filter((x): x is string => typeof x === "string")
    : [];
  const cited = claimed.filter((id) => ownIds.has(id));
  const foreign = claimed.length - cited.length;
  if (foreign > 0) {
    adjustments.push(
      `${foreign} cited id(s) are not events in this cluster and were dropped`);
  }

  // A POSITIVE VERDICT MUST POINT AT SOMETHING. Without a citation the claim is
  // the model's opinion about a company, which is precisely what this module
  // exists not to publish.
  if (claimedBand !== "none" && cited.length === 0) {
    return deterministicVerdict(
      cluster,
      claimed.length > 0
        ? "every cited id belonged to another cluster; an uncited verdict is not believed"
        : "the verdict cited no evidence, and an uncited verdict is not believed",
    );
  }

  // ── TIMELINESS ────────────────────────────────────────────────────────────
  //
  // Only a SOURCE date can make a situation current. `observed_at` is when we
  // looked; a cluster of things we noticed today may be a year old.
  const cutoff = now - windowDays * 86_400_000;
  const hasFreshSource = cluster.events.some((e) => {
    if (!e.id || !cited.includes(e.id)) return false;
    if (e.occurred_at_basis !== "source_reported" || !e.occurred_at) return false;
    const t = Date.parse(e.occurred_at);
    return Number.isFinite(t) && t >= cutoff;
  });
  let timely = raw.timely === true;
  if (timely && !hasFreshSource) {
    timely = false;
    adjustments.push(
      `"timely" was refused: no cited event carries a source date inside ` +
      `${windowDays} days, and an observation date is when we looked`,
    );
  }

  // ── THE BAND, CAPPED BY WHAT THE EVIDENCE CAN CARRY ───────────────────────
  //
  // A situation nobody can date is not a "high" one however well it fits: the
  // question the band answers is "act on this now", and an undated cluster
  // cannot support that. It is capped at `medium` rather than refused, because
  // the FIT the model judged is real even when the timing is unknown.
  let band = claimedBand;
  if (band === "high" && !hasFreshSource) {
    band = "medium";
    adjustments.push(
      "capped at medium: no cited event carries a recent source date, so the " +
      "situation cannot be shown to be current",
    );
  }

  const why_now = text(raw.why_now);
  const why_it_matters = text(raw.why_it_matters);
  if (band !== "none" && !why_now && !why_it_matters) {
    return deterministicVerdict(
      cluster, "the verdict explained nothing, and a band with no reason is not believed");
  }

  return {
    version: SIGNAL_RELEVANCE_VERSION,
    relevance: band,
    why_now,
    why_it_matters,
    evidence_event_ids: cited,
    timely,
    // ── THE ONE PLACE THE PRIORITY CHANGES, AND IT ONLY GOES DOWN ───────────
    adjusted_priority: Math.round(cluster.priority * BAND_FACTOR[band]),
    adjustments,
    source: "model",
  };
}

/** A cluster with its relevance verdict attached. */
export interface JudgedCluster {
  cluster: SignalCluster;
  relevance: RelevanceVerdict;
}

/**
 * Order judged clusters for the feed.
 *
 * By the ADJUSTED priority, then by the deterministic one, then by key. The
 * second tiebreak matters: two clusters the model demoted equally must still
 * fall in the order the evidence put them, so a model opinion never decides a
 * tie it was not asked about.
 */
export function rankJudged(judged: readonly JudgedCluster[]): JudgedCluster[] {
  return [...judged].sort((a, b) =>
    b.relevance.adjusted_priority - a.relevance.adjusted_priority ||
    b.cluster.priority - a.cluster.priority ||
    a.cluster.key.localeCompare(b.cluster.key));
}
