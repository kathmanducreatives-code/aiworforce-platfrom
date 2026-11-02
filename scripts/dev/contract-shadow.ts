// CONTRACT SHADOW — what the closed requirement vocabulary WOULD change, before it changes anything.
//
//   deno run --allow-read --allow-env scripts/dev/contract-shadow.ts            # compare with the recorded report
//   deno run --allow-read --allow-write --allow-env scripts/dev/contract-shadow.ts --write
//
// Offline (no network, no model). For every persisted mission fixture and corpus case it
//   1. classifies each proposed hard constraint with requirementVocabulary.ts
//      (canonical type, or `other` — quoted from the request or not), and
//   2. renames each canonical constraint to the one field name the compiler routes for
//      that type, re-derives the criteria, and diffs the MEANING against today's
//      (missionSemantics.ts).
//
// A non-empty diff is exactly what activating the strict contract would change for that
// mission. Stage 4 records the report; Stage 6 may activate only once every difference is
// either intended or fixed in the compiler.

import { deriveMissionCriteria } from "../../supabase/functions/_shared/missionCriteria.ts";
import { missionSemantics, semanticDiff } from "../../supabase/functions/_shared/missionSemantics.ts";
import { type CanonicalRequirement, classifyConstraints, REQUIREMENT_VOCABULARY_VERSION } from "../../supabase/functions/_shared/requirementVocabulary.ts";
import { compileCaseMission, corpusCases, persistedMissions } from "./mission-semantics.ts";

const ROOT = new URL("../../", import.meta.url);
export const SHADOW_REPORT_PATH = "tests/fixtures/mission-semantics/shadow-report.json";

/** The field name the current compiler routes for each canonical type. */
export const COMPILER_FIELD: Record<CanonicalRequirement, string> = {
  geography: "geography", geography_presence: "presence", company_stage: "stage", industry: "industry",
  business_model: "business_model", hiring_role: "hiring_role", hiring_count: "open_roles", hiring_window: "hiring_signal_recency",
  funding_event: "funding_event", funding_window: "funding_recency_days", employee_range: "employee_range",
  employee_min: "employee_min", employee_max: "employee_max", excluded_company_types: "excluded_company_types",
  excluded_geographies: "excluded_geographies", excluded_roles: "excluded_roles", known_companies: "known_companies",
};

export interface ShadowEntry {
  constraints: { field: string; as: string }[];
  /** What renaming to the canonical fields changes in the mission's meaning (empty: nothing). */
  diff: string[];
}

export function shadowMission(mission: Record<string, unknown>): ShadowEntry {
  const query = String(mission.original_user_query ?? "");
  const hard = (mission.hard_constraints ?? {}) as Record<string, unknown>;
  const classified = classifyConstraints(hard, query);
  const renamed: Record<string, unknown> = {};
  const constraints: ShadowEntry["constraints"] = [];
  for (const [field, raw] of Object.entries(hard)) {
    const c = classified.find((x) => x.originalField === field)!;
    const as = c.kind === "canonical" ? COMPILER_FIELD[c.field] : c.quoted ? "other (quoted)" : "other (NOT quoted)";
    constraints.push({ field, as: c.kind === "canonical" ? `${c.field} → ${as}` : as });
    renamed[c.kind === "canonical" ? COMPILER_FIELD[c.field] : field] = raw;
  }
  const before = missionSemantics(mission as never, deriveMissionCriteria(mission as never));
  const shadowed = { ...mission, hard_constraints: renamed };
  delete (shadowed as { criteria?: unknown }).criteria;
  const after = missionSemantics(shadowed as never, deriveMissionCriteria(shadowed as never));
  return { constraints, diff: semanticDiff(before, after) };
}

export async function shadowReport(): Promise<{ version: string; entries: Record<string, ShadowEntry> }> {
  const entries: Record<string, ShadowEntry> = {};
  for (const [key, mission] of await persistedMissions()) entries[key] = shadowMission(mission);
  for (const c of await corpusCases()) entries[`corpus:${c.name}`] = shadowMission(compileCaseMission(c));
  return { version: REQUIREMENT_VOCABULARY_VERSION, entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) };
}

/** Counts for the PR / report. */
export function summarise(r: { entries: Record<string, ShadowEntry> }) {
  const all = Object.values(r.entries).flatMap((e) => e.constraints);
  return {
    missions: Object.keys(r.entries).length,
    constraints: all.length,
    canonical: all.filter((c) => !c.as.startsWith("other")).length,
    otherQuoted: all.filter((c) => c.as === "other (quoted)").length,
    otherUnquoted: all.filter((c) => c.as === "other (NOT quoted)").length,
    missionsWithSemanticChange: Object.values(r.entries).filter((e) => e.diff.length).length,
  };
}

if (import.meta.main) {
  const r = await shadowReport();
  if (Deno.args.includes("--write")) {
    await Deno.writeTextFile(new URL(SHADOW_REPORT_PATH, ROOT), JSON.stringify(r, null, 1) + "\n");
    console.log(`wrote ${SHADOW_REPORT_PATH}`, JSON.stringify(summarise(r)));
  } else {
    console.log(JSON.stringify(summarise(r)));
    for (const [k, e] of Object.entries(r.entries)) if (e.diff.length) console.log(`${k}\n   ${e.diff.join(" | ")}`);
  }
}
