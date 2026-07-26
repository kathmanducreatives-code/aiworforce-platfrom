// COMPILE AN APPROVED STRATEGY INTO EXISTING ADAPTER INPUT.
//
// Claude proposes SEMANTICS — "search these titles, in these locations, aim for
// this many results". This module turns that into the neutral request shape the
// EXISTING provider adapters already consume. It does not build actor-native JSON,
// does not know an actor id, and does not call anything.
//
//   Claude          ->  { capability_key: "jobs_search", titles: [...], locations: [...] }
//   this compiler   ->  { actorKey: "apify_jobs", titles: [...], locations: [...], limit }
//   existing adapter->  actor-native request  (unchanged, still the only place
//                                              that knows the provider's schema)
//
// DETERMINISM IS THE CONTRACT. The same approved strategy must always produce the
// same compiled input and the same hash — that is what makes idempotency, cost
// forecasting and provider-call records keep working unchanged. So every list is
// filtered to the approved set, de-duplicated case-insensitively, and SORTED. No
// clock, no randomness, no iteration-order dependence.
//
// PURE. No network, no provider calls, no model calls, no database access.

import { canonicalJson, sha256Hex } from "../../planHash.ts";
import { resolveAdapterKey, getCapability, clampResultLimit } from "../capabilityRegistry.ts";
import type { AgentoryEnvironmentMode } from "../mission.ts";
import type { LeadInitialStrategy, LeadSearchPurpose } from "./leadStrategy.ts";
import type { LeadSourcingMission } from "./leadMission.ts";

/** One compiled search, in the neutral shape the existing adapters accept. */
export interface CompiledLeadSearch {
  purpose: LeadSearchPurpose;
  /** Canonical registry key. The adapter resolves the actor id from this. */
  actorKey: string;
  titles: string[];
  keywords: string[];
  locations: string[];
  languages: string[];
  /** Already clamped to the capability's own ceiling. */
  limit: number;
  postingWindowDays?: number;
}

export interface CompiledLeadPlan {
  searches: CompiledLeadSearch[];
  /** Titles that survived review, in deterministic order. */
  approvedTitles: string[];
  excludedTitles: string[];
  /** Stable identity of the compiled plan. */
  planHash: string;
  /** Cost/limit forecast, from the capability registry. Never from the planner. */
  forecast: {
    totalCalls: number;
    maxResults: number;
  };
}

function dedupeSorted(values: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const raw of values) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (!seen.has(k)) seen.set(k, s);
  }
  return [...seen.values()].sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
}

export interface CompileInput {
  mission: LeadSourcingMission;
  strategy: LeadInitialStrategy;
  /** Titles cleared for autonomous execution. Everything else is dropped. */
  approvedTitles: string[];
  environment: AgentoryEnvironmentMode;
}

export type CompileResult =
  | { ok: true; plan: CompiledLeadPlan }
  | { ok: false; reason: string };

/**
 * Compile an approved strategy.
 *
 * Titles are intersected with `approvedTitles` rather than trusted from the
 * strategy: a title that failed review must not reach a provider even if the
 * planner listed it inside a search. A search left with no titles at all is
 * DROPPED, not silently sent unfiltered — an unfiltered search is a different,
 * much broader search than the one that was approved.
 */
export async function compileLeadStrategy(input: CompileInput): Promise<CompileResult> {
  const { mission, strategy, environment } = input;
  const approved = new Set(input.approvedTitles.map((t) => t.toLowerCase()));

  // Locations come from the MISSION, not the strategy: the user's own wording is
  // authoritative, and a location the planner added has already been flagged for
  // approval by the validator rather than silently compiled.
  const geo = mission.company_target.geography;
  const missionLocations = dedupeSorted([
    ...geo.normalized_locations,
    ...geo.explicit_raw_locations.filter(
      (raw) => !geo.normalized_locations.some((n) => n.toLowerCase() === raw.toLowerCase()),
    ),
  ]);

  const searches: CompiledLeadSearch[] = [];

  for (const s of strategy.searches) {
    const actorKey = resolveAdapterKey(s.capability_key, { department: "leads", environment });
    if (!actorKey) {
      return { ok: false, reason: `capability_not_resolvable:${s.capability_key}` };
    }
    const cap = getCapability(s.capability_key);
    if (!cap) return { ok: false, reason: `capability_missing:${s.capability_key}` };

    const titles = dedupeSorted((s.titles ?? []).filter((t) => approved.has(t.trim().toLowerCase())));

    // A decision-maker search carries the person roles, which are validated
    // separately and are not hiring-role titles.
    const isDecisionMaker = s.purpose === "find_decision_makers";
    const effectiveTitles = isDecisionMaker
      ? dedupeSorted(s.titles ?? mission.decision_maker.roles)
      : titles;

    if (!isDecisionMaker && (s.titles ?? []).length > 0 && effectiveTitles.length === 0) {
      // Every title this search proposed failed review. Sending it without titles
      // would broaden it far beyond what was approved.
      continue;
    }

    searches.push({
      purpose: s.purpose,
      actorKey,
      titles: effectiveTitles,
      keywords: dedupeSorted(s.keywords ?? []),
      locations: missionLocations.length > 0 ? missionLocations : dedupeSorted(s.locations ?? []),
      languages: dedupeSorted(s.languages ?? []),
      limit: clampResultLimit(cap, s.result_target),
      ...(s.posting_window_days !== undefined ? { postingWindowDays: s.posting_window_days } : {}),
    });
  }

  if (searches.length === 0) return { ok: false, reason: "no_executable_searches" };

  const approvedTitles = dedupeSorted(input.approvedTitles);
  const excludedTitles = dedupeSorted([
    ...((mission.constraints.hard.excluded_titles as string[] | undefined) ?? []),
    ...strategy.role_ontology.excluded_titles,
  ]);

  // The hash covers exactly what will be executed. Sorted lists mean two runs of
  // the same strategy hash identically regardless of the order Claude emitted.
  const planHash = await sha256Hex(canonicalJson({ searches, approvedTitles, excludedTitles }));

  return {
    ok: true,
    plan: {
      searches,
      approvedTitles,
      excludedTitles,
      planHash,
      forecast: {
        totalCalls: searches.length,
        maxResults: searches.reduce((n, s) => n + s.limit, 0),
      },
    },
  };
}

/**
 * The DETERMINISTIC plan — what the workflow does today, and what it falls back to.
 *
 * Built from the registry titles and the mission's own geography, with no planner
 * involvement whatsoever. This is the proof that the workflow remains usable
 * without Claude.
 */
export async function compileDeterministicPlan(
  mission: LeadSourcingMission,
  titles: string[],
  environment: AgentoryEnvironmentMode,
): Promise<CompileResult> {
  const geo = mission.company_target.geography;
  const locations = dedupeSorted([
    ...geo.normalized_locations,
    ...geo.explicit_raw_locations.filter(
      (raw) => !geo.normalized_locations.some((n) => n.toLowerCase() === raw.toLowerCase()),
    ),
  ]);

  const jobsKey = resolveAdapterKey("jobs_search", { department: "leads", environment });
  if (!jobsKey) return { ok: false, reason: "capability_not_resolvable:jobs_search" };
  const jobsCap = getCapability("jobs_search")!;

  const searches: CompiledLeadSearch[] = [{
    purpose: "discover_hiring_companies",
    actorKey: jobsKey,
    titles: dedupeSorted(titles),
    keywords: [],
    locations,
    languages: [],
    limit: clampResultLimit(jobsCap, jobsCap.limits.maximum_results ?? 25),
  }];

  if (mission.decision_maker.roles.length > 0) {
    const peopleKey = resolveAdapterKey("contact_enrichment", { department: "leads", environment });
    const peopleCap = getCapability("contact_enrichment");
    if (peopleKey && peopleCap) {
      searches.push({
        purpose: "find_decision_makers",
        actorKey: peopleKey,
        titles: dedupeSorted(mission.decision_maker.roles),
        keywords: [],
        locations,
        languages: [],
        limit: clampResultLimit(peopleCap, peopleCap.limits.maximum_results ?? 25),
      });
    }
  }

  const approvedTitles = dedupeSorted(titles);
  const excludedTitles = dedupeSorted((mission.constraints.hard.excluded_titles as string[] | undefined) ?? []);
  const planHash = await sha256Hex(canonicalJson({ searches, approvedTitles, excludedTitles }));

  return {
    ok: true,
    plan: {
      searches, approvedTitles, excludedTitles, planHash,
      forecast: { totalCalls: searches.length, maxResults: searches.reduce((n, s) => n + s.limit, 0) },
    },
  };
}
