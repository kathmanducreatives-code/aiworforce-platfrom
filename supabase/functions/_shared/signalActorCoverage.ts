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
  executableScenarioActors, scenarioIsExecutable, scenarioIsServable,
} from "./discoveryScenarioMatrix.ts";
import type { LeadMissionV1, MissionSignal } from "./leadMission.ts";
import { toStoreId } from "./actorIdentity.ts";
import {
  isUnlockGatedActor, resolveSignalSupport, type SignalDependency,
} from "./actorEvidenceCapability.ts";
import type { MissionSignalDescriptor } from "./missionSignalDescriptor.ts";

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
  // ── THE STRUCTURED EVENTS NEED SCENARIOS TOO ──────────────────────────────
  //
  // `post` and `comment` entered the vocabulary in Phase 2 and had no entry
  // here, so a leadership-post gap could not name the source that would close
  // it — `actors` came back empty and the user was told only that nothing could
  // be done.
  //
  // The VERDICT still comes from the evidence table, which is subject-aware;
  // this mapping exists only to supply the remedy and the evidence prose. Both
  // activity scenarios are listed because the subject decides which one applies
  // and this table is keyed by type alone.
  post: ["company_linkedin_activity", "founder_linkedin_activity"],
  // `comment` maps to nothing on purpose: no registered Actor returns comment
  // data at all, so there is no source to name as a remedy.
  comment: [],
  headcount_change: ["company_size_discovery"],
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

/**
 * The DERIVED verdict, from what Actors can actually produce.
 *
 * `coverOne` below still consults the scenario matrix, which carries the
 * `minimum_evidence` prose and the verified `blocked_reason` sentences worth
 * showing a user. But the matrix describes SOURCES, including many no
 * capability may call, so it cannot decide support on its own — that is what
 * reported funding as covered while nothing could ask a funding source
 * anything.
 *
 * `actorEvidenceCapability` decides. When a signal carries a structured
 * descriptor, its status comes from the evidence table and the matrix supplies
 * only the wording.
 */
export type SignalCoverageStatus =
  /** Actors exist, and a capability may actually CALL one. */
  | "covered"
  /**
   * A source exists and is known, but no capability declares it — so nothing
   * may call it and no step can be planned for it.
   *
   * DISTINCT FROM `unservable` ON PURPOSE. "No source exists" is a dead end;
   * "the source exists and is unreachable" is a carding task with a known
   * target, and a user told the first when the second is true will stop asking
   * for something we are two decisions away from supporting.
   *
   * This status is what `covered` used to swallow: a funding signal reported
   * COVERED while `runnable_actors` was empty and no funding source was ever
   * asked anything.
   */
  | "capability_gap"
  /**
   * The evidence is about a PERSON, and person discovery is unlock-gated.
   *
   * Deliberately not `capability_gap`: the work exists and is reachable, it is
   * simply never automatic. Calling it a gap would tell the user nothing can be
   * done when the honest answer is that they may choose to authorise it.
   */
  | "requires_unlock"
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
  /**
   * Work that must be authorised before this signal could be pursued.
   *
   * Non-empty for every person-level requirement. Carried so the plan can
   * SURFACE the dependency — "this needs a founder unlock" — instead of either
   * spending on it silently or dropping the requirement for lack of a route.
   */
  dependencies?: SignalDependency[];
  /** Qualifiers the request stated that no available source can filter on. */
  unhonoured_qualifiers?: string[];
}

export interface CoverageReport {
  signals: SignalCoverage[];
  /** Every Actor any required signal needs, as Store ids, in first-seen order. */
  required_actors: string[];
  /**
   * THE SUBSET THE ENGINE CAN ACTUALLY RUN, as repo keys.
   *
   * This is what makes multi-signal execution real rather than reported. A
   * hiring signal needs a discovery source AND a job source; both are declared
   * capabilities, so both resolve here and both get run. A funding signal needs
   * Crunchbase, which no capability declares — it resolves to nothing, appears
   * in `described_only`, and the shortfall says so instead of the run quietly
   * skipping it.
   */
  runnable_actors: string[];
  /** Store ids a signal needs that no capability can call. Never silent. */
  described_only: string[];
  /**
   * What the request asked for that no signal type can express.
   *
   * Carried from the mission verbatim. Non-empty forces `fully_covered` false —
   * a requirement that was never represented cannot have been served.
   */
  unrepresented_requirements: string[];
  /**
   * Every authorisation this mission's signals depend on, deduplicated.
   *
   * The plan renders these as offers. Present here so a mission requiring a
   * person-level signal states the dependency truthfully rather than either
   * spending on it or silently dropping the requirement.
   */
  dependencies: SignalDependency[];
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

  // ── THE DERIVED VERDICT ───────────────────────────────────────────────────
  //
  // A structured signal knows its event, its subject and its qualifiers, so
  // support is a question the evidence table can answer exactly. The scenario
  // matrix is still consulted below for its `minimum_evidence` prose, but it
  // describes sources rather than permissions and must not decide the verdict.
  //
  // This is what makes a leadership post and a company post produce different
  // answers from the same word "post".
  if (signal.event && signal.subject) {
    const support = resolveSignalSupport(signal as MissionSignalDescriptor);
    const spec = scenarios.map((id) => SCENARIO_MATRIX[id]).find(Boolean);
    const base = {
      signal: type,
      scenarios,
      minimum_evidence: spec?.minimum_evidence ?? "",
      ...(support.dependencies.length ? { dependencies: support.dependencies } : {}),
      ...(support.unhonoured_qualifiers.length
        ? { unhonoured_qualifiers: support.unhonoured_qualifiers } : {}),
    };
    if (support.status === "supported") {
      return {
        ...base, status: "covered",
        actors: [...support.discovery_actors, ...support.verification_actors],
        ...(support.reason ? { limitation: support.reason } : {}),
      };
    }
    // A GAP NAMES ITS OWN REMEDY.
    //
    // The verdict comes from the evidence table, but the matrix still knows
    // WHICH described source would close the gap — Crunchbase for funding, the
    // profile-post scraper for a leadership post. Naming it turns "we cannot"
    // into a carding task with a known target, and it stays out of
    // `runnable_actors`, so nothing may act on it.
    const remedy = scenarios
      .map((id) => SCENARIO_MATRIX[id])
      .filter(Boolean)
      .flatMap((sp) => executableScenarioActors(sp as ScenarioSpec).described_only);
    return {
      ...base,
      status: support.status === "requires_unlock" ? "requires_unlock" : "capability_gap",
      actors: dedupe(remedy),
      limitation: support.reason,
    };
  }

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

  // COVERED: a scenario is not merely described — a capability may CALL it.
  //
  // The executability test is the whole point. `scenarioIsServable` asks only
  // whether a source exists, which is true of Crunchbase, the news scrapers and
  // both post scrapers — none of which any capability declares. Reporting those
  // as covered is what let a mission requiring funding run to completion having
  // asked no funding source anything, and then describe itself as fully served.
  const executable = servable.filter(scenarioIsExecutable);
  if (executable.length > 0) {
    const actors = dedupe(executable.flatMap((s) => s.preferred_actors));
    return {
      signal: type, status: "covered", scenarios, actors,
      minimum_evidence: executable[0].minimum_evidence,
    };
  }

  // KNOWN BUT UNREACHABLE. The source exists, its schema has been read, and no
  // capability declares it — so a plan naming it would schedule a step that
  // never runs. Named precisely, because the fix is specific and knowable.
  if (servable.length > 0) {
    const unreachable = dedupe(
      servable.flatMap((s) => executableScenarioActors(s).described_only),
    );
    return {
      signal: type, status: "capability_gap", scenarios,
      // The Actors are reported so the gap names its own remedy, but they are
      // NOT runnable and no caller may treat this list as executable work.
      actors: unreachable,
      minimum_evidence: servable[0].minimum_evidence,
      limitation:
        `"${type}" has a known source (${unreachable.join(", ") || "none resolvable"}) ` +
        `but no capability declares it, so nothing may call it. No step was ` +
        `planned and no evidence for this signal was collected.`,
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

function dedupeDeps(xs: SignalDependency[]): SignalDependency[] {
  const seen = new Set<string>();
  const out: SignalDependency[] = [];
  for (const d of xs) {
    const k = `${d.kind}:${d.capability}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
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

  // ── A REQUIREMENT WE COULD NOT EXPRESS IS NOT A REQUIREMENT WE MET ────────
  //
  // The doc comment above says a mission with no recorded signals is fully
  // covered by definition, and that was true only while "no signals" meant "the
  // request asked for none". It also covers the case where the request asked
  // for something the vocabulary has no word for, and the parser dropped it.
  //
  // Ten structural missions were run through this module and every one returned
  // `fully_covered: true` — including "logistics companies showing GTM headcount
  // growth" and "CEOs commenting on sales automation", both of which reached
  // here with `required_signals: []`. The report was not lying about the signals
  // it had; it was silent about the one it never received.
  //
  // `unrepresented_requirements` closes that hole at the only place that can:
  // the mission records what it could not represent, and no report may call
  // itself complete while that list is non-empty.
  const unrepresented = mission.unrepresented_requirements ?? [];

  // Split what a signal NEEDS from what this system can CALL. The engine may
  // only run a declared capability's provider; anything else is knowledge we
  // have and permission we lack, and the difference has to survive into the
  // record or a run will look like it covered a signal it never asked about.
  const runnable: string[] = [];
  const described_only: string[] = [];
  for (const sig of signals) {
    for (const id of sig.scenarios) {
      const spec = SCENARIO_MATRIX[id];
      if (!spec) continue;
      const split = executableScenarioActors(spec);
      // ── RUNNABLE MEANS RUNNABLE WITHOUT AUTHORISATION ───────────────────
      //
      // The scenario matrix knows which Actors are CALLABLE; it does not know
      // which are unlock-gated. A profile-post scraper is callable and is also
      // reachable only after an accepted founder unlock, so listing it here
      // would tell the engine it may run something no one has agreed to buy.
      //
      // Gated Actors stay visible through `signals[].actors` and the
      // `requires_unlock` status — the remedy is named, it is simply not
      // presented as work this run may do.
      for (const k of split.runnable) {
        if (isUnlockGatedActor(k)) continue;
        if (!runnable.includes(k)) runnable.push(k);
      }
      for (const d of split.described_only) {
        if (sig.actors.includes(d) && !described_only.includes(d)) described_only.push(d);
      }
    }
  }

  const unrepresentedStatement = unrepresented.length === 0 ? "" :
    `The request also asked for ${unrepresented.join("; and ")}. ` +
    `${unrepresented.length === 1 ? "That requirement was" : "Those requirements were"} ` +
    `not represented in this mission at all, so nothing was planned or collected for ` +
    `${unrepresented.length === 1 ? "it" : "them"}.`;

  return {
    signals,
    required_actors,
    runnable_actors: runnable,
    described_only,
    unrepresented_requirements: unrepresented,
    dependencies: dedupeDeps(signals.flatMap((x) => x.dependencies ?? [])),
    fully_covered: unmet.length === 0 && unrepresented.length === 0,
    shortfall_statement: [
      unmet.length === 0 ? "" : buildShortfallStatement(unmet),
      unrepresentedStatement,
    ].filter(Boolean).join(" "),
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
      // A capability gap is not a failure to find candidates — it is work that
      // was never attempted. Saying so plainly is the difference between the
      // user asking for more results and the user asking for the right thing.
      : s.status === "capability_gap"
      ? `"${s.signal}" was not collected at all`
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
  // COMPARE CANONICALLY, NEVER BY STRING.
  //
  // A signal's Actors are Store ids; a strategy's are repo keys. Comparing them
  // directly reported EVERY signal as unserved, including ones the strategy was
  // running — the exact two-names-for-one-thing defect `actorIdentity` exists to
  // remove, reproduced here the moment the matrix moved to Store ids.
  const selected = new Set(
    strategyActorIds.map((k) => toStoreId(k) ?? k),
  );
  return report.signals.filter((s) =>
    s.status === "covered" && s.actors.length > 0 &&
    !s.actors.some((a) => selected.has(toStoreId(a) ?? a)));
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
    runnable_actors: r.runnable_actors,
    ...(r.unrepresented_requirements.length
      ? { unrepresented_requirements: r.unrepresented_requirements } : {}),
    ...(r.dependencies.length ? { dependencies: r.dependencies } : {}),
    ...(r.described_only.length ? { described_only: r.described_only } : {}),
    ...(r.shortfall_statement ? { shortfall_statement: r.shortfall_statement } : {}),
  };
}
