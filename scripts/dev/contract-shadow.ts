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
// The contract VALIDATES (refuses an unquoted `other`) and never renames, so activation
// changes no accepted mission's meaning. The rename diff is recorded for information only.

import { deriveMissionCriteria } from "../../supabase/functions/_shared/missionCriteria.ts";
import { missionSemantics, semanticDiff } from "../../supabase/functions/_shared/missionSemantics.ts";
import { type CanonicalRequirement, classifyConstraints, REQUIREMENT_VOCABULARY_VERSION } from "../../supabase/functions/_shared/requirementVocabulary.ts";
import { compileCaseMission, corpusCases, persistedMissions } from "./mission-semantics.ts";

const ROOT = new URL("../../", import.meta.url);
export const SHADOW_REPORT_PATH = "tests/fixtures/mission-semantics/shadow-report.json";

/**
 * The field name the current compiler routes for each canonical type; `null` keeps the
 * field exactly as proposed. INDUSTRY KEEPS ITS FIELD: the compiler reads industries from
 * company_profile and skips an `industry` hard constraint, so renaming one would silently
 * drop it (the Stage 4 shadow found this on missionHiringSalesRoles). The vocabulary still
 * CLASSIFIES it as `industry`; only the routing is preserved, so meaning is unchanged.
 */
export const COMPILER_FIELD: Record<CanonicalRequirement, string | null> = {
  geography: "geography", geography_presence: "presence", company_stage: "stage", industry: null,
  business_model: "business_model", hiring_role: "hiring_role", hiring_count: "open_roles", hiring_window: "hiring_signal_recency",
  funding_event: "funding_event", funding_window: "funding_recency_days", employee_range: "employee_range",
  employee_min: "employee_min", employee_max: "employee_max", excluded_company_types: "excluded_company_types",
  excluded_geographies: "excluded_geographies", excluded_roles: "excluded_roles", known_companies: "known_companies",
};

export interface ShadowEntry {
  constraints: { field: string; as: string }[];
  /**
   * Would the strict contract REFUSE this mission? Only an `other` constraint whose value
   * is not quoted from the request is refused (it is the model's own idea). The contract
   * validates; it never renames what the compiler receives, so an accepted mission's
   * meaning is unchanged by construction.
   */
  refused: boolean;
  /**
   * INFORMATION ONLY, never applied: what renaming each constraint to its canonical field
   * would change. A rename changes criterion ids (in-flight results are keyed by them), so
   * renaming stays out of the contract unless an owner approves the listed change.
   */
  renameDiff: string[];
}

export function shadowMission(mission: Record<string, unknown>): ShadowEntry {
  const query = String(mission.original_user_query ?? "");
  const hard = (mission.hard_constraints ?? {}) as Record<string, unknown>;
  const classified = classifyConstraints(hard, query);
  const renamed: Record<string, unknown> = {};
  const constraints: ShadowEntry["constraints"] = [];
  for (const [field, raw] of Object.entries(hard)) {
    const c = classified.find((x) => x.originalField === field)!;
    const target = c.kind === "canonical" ? COMPILER_FIELD[c.field] ?? field : field;
    const as = c.kind === "canonical" ? `${c.field} → ${target}` : c.quoted ? "other (quoted)" : "other (NOT quoted)";
    constraints.push({ field, as });
    renamed[target] = raw;
  }
  const before = missionSemantics(mission as never, deriveMissionCriteria(mission as never));
  const shadowed = { ...mission, hard_constraints: renamed };
  delete (shadowed as { criteria?: unknown }).criteria;
  const after = missionSemantics(shadowed as never, deriveMissionCriteria(shadowed as never));
  const refused = classified.some((c) => c.kind === "other" && !c.quoted);
  return { constraints, refused, renameDiff: semanticDiff(before, after) };
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
    refused: Object.values(r.entries).filter((e) => e.refused).length,
    renameWouldChange: Object.values(r.entries).filter((e) => e.renameDiff.length).length,
  };
}

if (import.meta.main) {
  const r = await shadowReport();
  if (Deno.args.includes("--write")) {
    await Deno.writeTextFile(new URL(SHADOW_REPORT_PATH, ROOT), JSON.stringify(r, null, 1) + "\n");
    console.log(`wrote ${SHADOW_REPORT_PATH}`, JSON.stringify(summarise(r)));
  } else {
    console.log(JSON.stringify(summarise(r)));
    for (const [k, e] of Object.entries(r.entries)) {
      if (e.refused) console.log(`REFUSED ${k}`);
      if (e.renameDiff.length) console.log(`rename (info only) ${k}\n   ${e.renameDiff.join(" | ")}`);
    }
  }
}
