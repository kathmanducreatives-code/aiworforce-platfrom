// Signal Feed v1 — preferences live inside company_brain.profile.signal_preferences.
// No migration required. This module owns defaults, normalization, and the merge logic.

import type { StructuredBrain } from "@/lib/companyBrainSchema";

export type SignalFrequency = "weekly" | "daily" | "manual";

export interface SignalDefaultMix {
  hiring: number;
  linkedin_intent: number;
  competitors: number;
  workflows: number;
  people: number;
}

export interface SignalPreferences {
  keywords: string[];
  competitors: string[];
  hiring_roles: string[];
  linkedin_topics: string[];
  workflow_topics: string[];
  geographies: string[];
  industries: string[];
  pain_points: string[];
  disqualifiers: string[];
  default_mix: SignalDefaultMix;
  frequency: SignalFrequency;
  strict_geography: boolean;
}

export const DEFAULT_MIX: SignalDefaultMix = {
  hiring: 3,
  linkedin_intent: 3,
  competitors: 2,
  workflows: 2,
  people: 0,
};

export function emptyPreferences(): SignalPreferences {
  return {
    keywords: [],
    competitors: [],
    hiring_roles: [],
    linkedin_topics: [],
    workflow_topics: [],
    geographies: [],
    industries: [],
    pain_points: [],
    disqualifiers: [],
    default_mix: { ...DEFAULT_MIX },
    frequency: "manual",
    strict_geography: false,
  };
}

function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

/** Build sensible defaults from Company Brain when the user has no overrides. */
export function defaultsFromBrain(brain: Partial<StructuredBrain> | null | undefined): SignalPreferences {
  const out = emptyPreferences();
  if (!brain) return out;
  out.industries = arr(brain.icp?.industries);
  out.hiring_roles = arr(brain.icp?.buyer_roles);
  out.pain_points = arr(brain.icp?.pain_points);
  out.disqualifiers = arr(brain.icp?.disqualifiers);
  out.competitors = [...arr(brain.competitors?.known), ...arr(brain.competitors?.adjacent)];
  if (brain.icp?.geography) out.geographies = [brain.icp.geography];
  // Generic workflow topics derived from product context
  out.workflow_topics = ["AI agents", "Claude Code", "Apify", "Firecrawl", "automation"];
  out.linkedin_topics = ["AI SDR", "lead generation", "outbound", "founder ops"];
  return out;
}

/** Merge stored prefs over defaults; arrays are replaced (not concatenated) when present. */
export function mergePreferences(
  brain: Partial<StructuredBrain> | null | undefined,
  stored: Partial<SignalPreferences> | null | undefined,
): SignalPreferences {
  const base = defaultsFromBrain(brain);
  if (!stored) return base;
  return {
    keywords: stored.keywords ?? base.keywords,
    competitors: stored.competitors ?? base.competitors,
    hiring_roles: stored.hiring_roles ?? base.hiring_roles,
    linkedin_topics: stored.linkedin_topics ?? base.linkedin_topics,
    workflow_topics: stored.workflow_topics ?? base.workflow_topics,
    geographies: stored.geographies ?? base.geographies,
    industries: stored.industries ?? base.industries,
    pain_points: stored.pain_points ?? base.pain_points,
    disqualifiers: stored.disqualifiers ?? base.disqualifiers,
    default_mix: { ...base.default_mix, ...(stored.default_mix ?? {}) },
    frequency: stored.frequency ?? base.frequency,
    strict_geography: stored.strict_geography ?? base.strict_geography,
  };
}

export function totalSignalsInMix(mix: SignalDefaultMix): number {
  return mix.hiring + mix.linkedin_intent + mix.competitors + mix.workflows + mix.people;
}

export function readPreferencesFromBrainProfile(
  profile: Record<string, unknown> | null | undefined,
): Partial<SignalPreferences> | null {
  if (!profile) return null;
  const raw = (profile as Record<string, unknown>).signal_preferences;
  if (!raw || typeof raw !== "object") return null;
  return raw as Partial<SignalPreferences>;
}
