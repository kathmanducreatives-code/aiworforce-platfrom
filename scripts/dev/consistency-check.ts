// CROSS-COMPONENT CONSISTENCY — do the planner, ORION and qualification read ONE mission?
//
//   deno run --allow-read --allow-env scripts/dev/consistency-check.ts            # compare with the recorded baseline
//   deno run --allow-read --allow-write --allow-env scripts/dev/consistency-check.ts --write
//
// Mission reliability S0 (root causes R5/R6). After compilation three components each
// rebuild what the mission means:
//   criteria   deriveMissionCriteria — what QUALIFICATION decides on
//   planner    specFromMission (criteria + required_signals + requirementsFromMission)
//   orion      buildQualificationContext (role vocabulary from required_signal_terms and
//              signal families; locations) — what ORION's verifier searches and gates on
// For every mission (stored persisted fixtures + every interpretation-corpus phrasing)
// this compares their view of roles, exclusions, geography, hard signals and OR groups,
// and records each disagreement by category. The target architecture (one frozen reader)
// drives this to zero; the recorded baseline is today's count.

import { buildQualificationContext } from "../../supabase/functions/_shared/missionQualificationContext.ts";
import { specFromMission } from "../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { deriveMissionCriteria } from "../../supabase/functions/_shared/missionCriteria.ts";
import { criteriaFrozen, criteriaOf } from "../../supabase/functions/_shared/missionCriteriaReader.ts";
import { persistedMissions } from "./mission-semantics.ts";
import { compilePhrasing, loadCases } from "./interpretation-corpus.ts";

const ROOT = new URL("../../", import.meta.url);
export const CONSISTENCY_BASELINE_PATH = "tests/fixtures/mission-reliability/consistency-baseline.json";

const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim().replace(/s$/, "");
type Crit = { kind: string; dimension: string; value: unknown; any_of?: string[] };
const SIGNALS = new Set(["hiring", "funding", "expansion", "social_activity", "leadership_change", "product_launch", "technology", "headcount_growth"]);

export type Category =
  | "roles_planner_differs" | "roles_missing_from_orion_vocabulary" | "exclusions_dropped_by_planner" | "exclusions_absent_from_orion"
  | "geography_planner_differs" | "geography_orion_differs" | "hard_signals_planner_differs" | "or_groups_not_in_planner"
  // S2: a LEGACY (unfrozen) stored mission whose stored criteria differ from what ORION
  // re-derives at run time. Not a component bug: compiler drift on a stored meaning,
  // listed for the owner (S5). A frozen mission (S3) cannot have it.
  | "legacy_stored_criteria_drift";

export function check(m: Record<string, unknown>): Category[] {
  const out: Category[] = [];
  // QUALIFICATION's view: the one reader, as ORION/run-agent call it.
  const criteria = criteriaOf(m as never, { legacy: "rederive" }) as unknown as Crit[];
  if (!criteriaFrozen(m as never) && Array.isArray(m.criteria) && m.criteria.length &&
    JSON.stringify(m.criteria) !== JSON.stringify(deriveMissionCriteria(m as never))) out.push("legacy_stored_criteria_drift");
  const hard = criteria.filter((c) => c.kind === "hard");
  const hiring = hard.find((c) => c.dimension === "hiring");
  const q = ((hiring?.value as { qualifier?: Record<string, unknown> } | undefined)?.qualifier ?? {}) as { role_terms?: string[]; excluded_role_terms?: string[] };
  const cRoles = [...new Set((q.role_terms ?? []).map(norm))].sort();
  const cExcl = [...new Set((q.excluded_role_terms ?? []).map(norm))].sort();
  const cGeo = hard.filter((c) => c.dimension === "geography").flatMap((c) => Array.isArray(c.value) ? c.value.map(String) : [String(c.value)]).map(norm).sort();
  const cSignals = [...new Set(hard.filter((c) => SIGNALS.has(c.dimension)).map((c) => c.dimension))].sort();
  const cOr = hard.some((c) => (c.any_of?.length ?? 0) > 1 && c.any_of!.every((a) => a.startsWith("signal:")));

  let spec;
  try { spec = specFromMission(m as never, { defaultCount: 5 }); } catch { return ["roles_planner_differs"]; }
  const sh = spec.signals.find((s) => s.kind === "hiring");
  if (hiring && JSON.stringify([...new Set((sh?.roleTerms ?? []).map(norm))].sort()) !== JSON.stringify(cRoles)) out.push("roles_planner_differs");
  if (cExcl.length && JSON.stringify([...new Set((sh?.excludedRoleTerms ?? []).map(norm))].sort()) !== JSON.stringify(cExcl)) out.push("exclusions_dropped_by_planner");
  if (JSON.stringify([...new Set(spec.geography.map(norm))].sort()) !== JSON.stringify([...new Set(cGeo)].sort())) out.push("geography_planner_differs");
  if (JSON.stringify([...new Set(spec.signals.filter((s) => s.hard).map((s) => s.kind))].sort()) !== JSON.stringify(cSignals.filter((k) => k !== "headcount_growth"))) out.push("hard_signals_planner_differs");
  if (cOr) {
    const want = hard.filter((c) => (c.any_of?.length ?? 0) > 1 && c.any_of!.every((a) => a.startsWith("signal:")))
      .map((c) => [...new Set(c.any_of!.map((a) => a.slice(7)))].sort().join("|"));
    const have = new Set((spec.signalAlternatives ?? []).map((g) => [...g].sort().join("|")));
    if (!want.every((w) => have.has(w))) out.push("or_groups_not_in_planner");
  }

  const qc = buildQualificationContext(m as never, { criteriaAuthority: true });
  const vocab = new Set(qc.role_vocabulary.required_titles.map(norm));
  if (hiring && cRoles.some((r) => !vocab.has(r) && ![...vocab].some((v) => v.includes(r) || r.includes(v)))) out.push("roles_missing_from_orion_vocabulary");
  const oExcl = new Set((qc.role_vocabulary.excluded_titles ?? []).map(norm));
  if (cExcl.some((e) => !oExcl.has(e))) out.push("exclusions_absent_from_orion");
  const oGeo = [...new Set(qc.locations.map(norm))].sort();
  if (cGeo.length && JSON.stringify(oGeo) !== JSON.stringify([...new Set(cGeo)].sort())) out.push("geography_orion_differs");
  return out;
}

export async function consistency(): Promise<Record<string, Category[]>> {
  const out: Record<string, Category[]> = {};
  for (const [k, m] of await persistedMissions()) out[k] = check(m);
  for (const c of loadCases()) for (const p of c.phrasings) out[`corpus:${c.id}:${p.label}`] = check(compilePhrasing(p));
  // S4: the same requests compiled under contract v3 (the model's validated understanding).
  for (const c of loadCases()) for (const p of c.phrasings) out[`corpus-v3:${c.id}:${p.label}`] = check(compilePhrasing(p, "v3"));
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.length).sort(([a], [b]) => a.localeCompare(b)));
}

export function counts(r: Record<string, Category[]>, total: number) {
  const by: Record<string, number> = {};
  for (const v of Object.values(r)) for (const c of v) by[c] = (by[c] ?? 0) + 1;
  // S2: a disagreement on a mission whose stored copy has NOT drifted is a component bug.
  const beyondLegacyDrift = Object.values(r).filter((v) => !v.includes("legacy_stored_criteria_drift")).length;
  return { missions: total, withDisagreement: Object.keys(r).length, beyondLegacyDrift, by: Object.fromEntries(Object.entries(by).sort(([, a], [, b]) => b - a)) };
}

if (import.meta.main) {
  const r = await consistency();
  const total = (await persistedMissions()).length + 2 * loadCases().reduce((n, c) => n + c.phrasings.length, 0);
  const s = counts(r, total);
  if (Deno.args.includes("--write")) {
    await Deno.writeTextFile(new URL(CONSISTENCY_BASELINE_PATH, ROOT), JSON.stringify({ summary: s, disagreements: r }, null, 1) + "\n");
    console.log(`wrote ${CONSISTENCY_BASELINE_PATH}`, JSON.stringify(s));
  } else {
    console.log(JSON.stringify(s, null, 1));
  }
}
