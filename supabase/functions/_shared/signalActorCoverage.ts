// REQUIRED SIGNALS → SCENARIOS → ACTORS, AND WHAT IS NOT COVERED.
//
// This is the arrow the architecture was missing. The mission already recorded
// what evidence the request needs — `required_signals: [{ type: "hiring" }, …]`
// — and the registry already knew which Actors produce which evidence. Nothing
// joined them. Discovery selected company-finding Actors and every other
// required signal was left to whichever later stage happened to look for it.
//
// The consequence was a specific, repeatable dishonesty: a mission asking for
// companies that are hiring AND raised funding recently would discover
// companies, qualify them on hiring, and report success — having never once
// asked a funding source anything. The funding requirement was in the mission,
// visible in the persisted result, and silently unserved.
//
// ── WHY COVERAGE IS REPORTED RATHER THAN ENFORCED ────────────────────────────
//
// A signal with no Actor is not a reason to refuse the mission. "Find US AI
// startups hiring engineers that raised recently" is mostly answerable: the
// hiring half is fully served, and the funding half is served as a signal but
// not as an amount. Refusing the whole request because one clause is
// unserveable would be worse than answering the part that works and saying so.
//
// So this module produces a COVERAGE REPORT: what each signal needs, which
// Actors can supply it, and — where nothing can — the reason, in the words the
// verification produced. That report is what makes the diagram's final branch
// honest. "No more candidates" and "no source could ever have answered this"
// are different endings, and a user who receives seven leads instead of ten
// deserves to know which one they got.
//
// PURE. No network, provider, model or database access.

import {
  SCENARIO_MATRIX, type ScenarioId, type ScenarioSpec,
  scenarioIsServable,
} from "./discoveryScenarioMatrix.ts";
import type { LeadMissionV1, MissionSignal } from "./leadMission.ts";

/**
 * The signal vocabulary, normalised.
 *
 * `MissionSignal.type` is a free-form string — the compiler's own doc comment
 * gives "hiring", "funding", "expansion", "leadership_change", "technology" as
 * examples, and a model-compiled mission may produce near-misses of any of
 * them. Matching exactly would silently drop a signal the user asked for, and
 * dropping a signal is precisely the failure this module exists to end. So
 * synonyms map, and anything unrecognised is reported as unrecognised rather
 * than ignored.
 */
const SIGNAL_SYNONYMS: Readonly<Record<string, ScenarioId[]>> = Object.freeze({
  hiring: ["hiring_engineers"],
  hiring_signal: ["hiring_engineers"],
  job_posting: ["hiring_engineers"],
  open_roles: ["hiring_engineers"],
  job_growth: ["job_growth_signal"],

  funding: ["recent_funding"],
  funding_signal: ["recent_funding"],
  recent_funding: ["recent_funding"],
  funding_round: ["funding_round_type"],
  funding_amount: ["funding_amount"],
  investor: ["investor_discovery"],

  founder_activity: ["founder_announcements", "founder_linkedin_activity"],
  founder_post: ["founder_linkedin_activity"],
  social_activity: ["company_linkedin_activity"],
  company_activity: ["company_linkedin_activity"],

  company_size: ["company_size_discovery"],
  headcount: ["company_size_discovery"],
  employee_count: ["company_size_discovery"],

  industry: ["market_industry_discovery"],
  vertical: ["market_industry_discovery"],
  market: ["market_industry_discovery"],

  technology: ["technology_stack_verification"],
  tech_stack: ["technology_stack_verification"],
  technology_adoption: ["competitor_technology_adoption"],

  growth: ["growth_signals"],
  growth_event: ["growth_signals"],
  expansion: ["expansion_signals"],
  leadership_change: ["founder_announcements"],
  acquisition: ["acquisition_signals"],
  news: ["recent_company_news"],
  product_launch: ["product_launches"],
});

export type SignalCoverageStatus =
  /** Actors exist and can serve this signal. */
  | "covered"
  /** Serveable, but only in a weaker form than asked — see `limitation`. */
  | "partial"
  /** No registered Actor can serve it. `limitation` says why. */
  | "unservable"
  /** The signal type is not in the vocabulary; nothing was even attempted. */
  | "unrecognised";

export interface SignalCoverage {
  /** The signal type exactly as the mission recorded it. */
  signal: string;
  status: SignalCoverageStatus;
  scenarios: ScenarioId[];
  /** Actors that would serve it, in execution order. Empty when unservable. */
  actors: string[];
  /** What must be true for this signal to count. From the scenario. */
  minimum_evidence: string;
  /** Present on `partial` and `unservable`: the verified reason, in full. */
  limitation?: string;
}

export interface CoverageReport {
  signals: SignalCoverage[];
  /** Every Actor any required signal needs, deduplicated, in first-seen order. */
  required_actors: string[];
  /** True when every recorded signal is fully covered. */
  fully_covered: boolean;
  /**
   * The sentence a user should see when the mission cannot fully be served.
   * Empty when everything is covered.
   */
  shortfall_statement: string;
}

/** Scenarios this signal maps to, or an empty list when unrecognised. */
export function scenariosForSignal(signalType: string): ScenarioId[] {
  const key = signalType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return SIGNAL_SYNONYMS[key] ?? [];
}

function coverOne(signal: MissionSignal): SignalCoverage {
  const type = String(signal.type ?? "").trim();
  const scenarios = scenariosForSignal(type);

  if (scenarios.length === 0) {
    return {
      signal: type, status: "unrecognised", scenarios: [], actors: [],
      minimum_evidence: "",
      limitation:
        `"${type}" is not a signal this system recognises, so no source was ` +
        `selected for it. It was neither served nor refused — it was not understood.`,
    };
  }

  const specs = scenarios.map((id) => SCENARIO_MATRIX[id]).filter(Boolean) as ScenarioSpec[];
  const servable = specs.filter(scenarioIsServable);

  // FULLY COVERED: at least one scenario has a preferred Actor and no block.
  if (servable.length > 0) {
    const actors = dedupe(servable.flatMap((s) => s.preferred_actors));
    return {
      signal: type, status: "covered", scenarios, actors,
      minimum_evidence: servable[0].minimum_evidence,
    };
  }

  // BLOCKED, BUT WITH A LESSER ANSWER. `funding_amount` is the case this exists
  // for: no source returns a figure unattended, but news may mention one. A
  // weaker answer offered honestly beats a refusal.
  const withFallback = specs.find((s) => s.fallback_actors.length > 0);
  if (withFallback) {
    return {
      signal: type, status: "partial", scenarios,
      actors: [...withFallback.fallback_actors],
      minimum_evidence: withFallback.minimum_evidence,
      limitation: withFallback.blocked_reason ?? "no preferred source; a fallback was used",
    };
  }

  return {
    signal: type, status: "unservable", scenarios, actors: [],
    minimum_evidence: specs[0]?.minimum_evidence ?? "",
    limitation: specs[0]?.blocked_reason ?? "no registered Actor serves this signal",
  };
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/**
 * What this mission's signals need, and what cannot be supplied.
 *
 * Always returns a report. A mission with no recorded signals is fully covered
 * by definition — it asked for nothing beyond the company profile, and that is
 * discovery's own job rather than a signal to cover.
 */
export function coverMissionSignals(mission: LeadMissionV1): CoverageReport {
  const signals = (mission.required_signals ?? []).map(coverOne);
  const required_actors = dedupe(signals.flatMap((s) => s.actors));
  const unmet = signals.filter((s) => s.status !== "covered");

  return {
    signals,
    required_actors,
    fully_covered: unmet.length === 0,
    shortfall_statement: unmet.length === 0 ? "" : buildShortfallStatement(unmet),
  };
}

/**
 * The honest sentence.
 *
 * Written for a person, not a log. It names the signal, says plainly that it
 * could not be served in the form requested, and gives the verified reason —
 * because "we found 7 of 10" invites the user to ask for more candidates, while
 * "no source returns a funding amount without a Crunchbase session cookie"
 * tells them the only thing that would actually change the answer.
 */
export function buildShortfallStatement(unmet: SignalCoverage[]): string {
  const parts = unmet.map((s) => {
    const head = s.status === "partial"
      ? `"${s.signal}" could only be answered in a weaker form`
      : s.status === "unrecognised"
      ? `"${s.signal}" was not understood`
      : `"${s.signal}" could not be answered`;
    return s.limitation ? `${head}: ${s.limitation}` : head;
  });
  return parts.join(" ");
}

/**
 * Does a proposed strategy actually serve the signals the mission requires?
 *
 * Returns the covered signals whose Actors are MISSING from the strategy. This
 * is the check that would have caught the failure in this module's header: a
 * strategy of pure company discovery, against a mission that also required
 * funding, reports every funding signal here.
 *
 * Reported, not enforced — see the header. The engine records it; a later
 * stage may still supply the evidence by another route, and refusing here
 * would break every mission whose signal is proven during enrichment.
 */
export function signalsUnservedByStrategy(
  report: CoverageReport, strategyActorIds: readonly string[],
): SignalCoverage[] {
  const selected = new Set(strategyActorIds);
  return report.signals.filter((s) =>
    s.status === "covered" && s.actors.length > 0 &&
    !s.actors.some((a) => selected.has(a)));
}

/** Compact record for the execution state. Reasons kept; payloads never. */
export function coverageDiagnostics(r: CoverageReport): Record<string, unknown> {
  return {
    fully_covered: r.fully_covered,
    signals: r.signals.map((s) => ({
      signal: s.signal,
      status: s.status,
      scenarios: s.scenarios,
      actors: s.actors,
      ...(s.limitation ? { limitation: s.limitation } : {}),
    })),
    required_actors: r.required_actors,
    ...(r.shortfall_statement ? { shortfall_statement: r.shortfall_statement } : {}),
  };
}
