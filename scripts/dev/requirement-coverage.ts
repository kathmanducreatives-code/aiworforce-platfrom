// REQUIREMENT COVERAGE — no stated requirement or preference is silently dropped.
//
//   deno run --allow-read --allow-env scripts/dev/requirement-coverage.ts
//
// Stage 5 of Option E. The interpretation guards (B2B audience, hiring restatement,
// presence scope, exclusion operators, invented startup, restated size, unstated
// location) each REMOVE, MERGE or SOFTEN something a proposal or stored mission holds.
// Each is right on its own; together they are safe only if nothing a mission states
// disappears or weakens without a named rule. This is that one invariant, over every
// stored mission (re-derived as run-agent does) and every corpus case:
//
//   dropped   a company-profile value or hard constraint no criterion represents
//   demoted   a hard constraint on a profile field that compiles only as a target
//
// Each must be explained by one of GUARDS below, or the check fails. A new guard that
// drops or softens something must add its rule here — reviewed — rather than hide it.

import { audienceDescriptor, audienceIntent, deriveMissionCriteria, restatesHiringSignal } from "../../supabase/functions/_shared/missionCriteria.ts";
import { compileCaseMission, corpusCases, persistedMissions } from "./mission-semantics.ts";

const norm = (v: unknown) => String(typeof v === "string" ? v : JSON.stringify(v)).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
type Crit = Record<string, unknown>;
type Mission = Record<string, unknown>;

const PROFILE_DIMENSION: Record<string, string> = { locations: "geography", verticals: "industry", stages: "company_stage", business_models: "business_model", known_companies: "known_companies" };
const COUNTRY_WORDS: Record<string, RegExp> = { "united states": /\b(us|u\.s\.?|usa|united states|america|american)\b/i };

export interface Finding { item: string; kind: "dropped" | "demoted"; guard: string | null }

/** The named rules under which a stated item may be dropped or softened. */
export const GUARDS: { name: string; applies: (f: Omit<Finding, "guard">, m: Mission, crit: Crit[]) => boolean }[] = [
  {
    // missionCriteria "unstated location": a location the request never names is the
    // workspace's default, kept as a ranking target — never a hard filter.
    name: "unstated-location-is-a-target",
    applies: (f, m, crit) => f.kind === "demoted" && f.item === "hard.company_profile.locations" &&
      locations(m).every((l) => !mentions(String(m.original_user_query ?? ""), l)) &&
      locations(m).every((l) => crit.some((c) => c.dimension === "geography" && norm(c.value) === norm(l))),
  },
  {
    // Q3: the parser files stage words ("Series A", "seed") under the kind "startup";
    // the stage is its own criterion and "startup" is kept only when the request says it.
    name: "startup-from-a-stage-word",
    applies: (f, m, crit) => f.kind === "dropped" && f.item === "profile.stages=startup" &&
      !/\bstart-?ups?\b/i.test(String(m.original_user_query ?? "")) &&
      crit.some((c) => c.dimension === "company_stage" && c.kind === "hard"),
  },
  {
    // #203/#211: a hard constraint restating the hiring signal IS the signal; its role
    // must survive on a HARD hiring criterion, or the restatement was a loss.
    name: "hiring-restatement-is-the-signal",
    applies: (f, m, crit) => {
      if (f.kind !== "dropped" || !f.item.startsWith("hard.")) return false;
      const field = f.item.slice(5);
      const raw = ((m.hard_constraints ?? {}) as Record<string, { value?: unknown }>)[field];
      const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.value : raw;
      const signals = (m.required_signals ?? []) as never[];
      return restatesHiringSignal(field, value, signals) &&
        crit.some((c) => c.dimension === "hiring" && c.kind === "hard");
    },
  },
  {
    // #202: an audience the request only PERMITS ("include strong B2C opportunities")
    // is no requirement and no preference — keeping it would filter or rank by it.
    name: "permitted-audience-is-no-requirement",
    applies: (f, m) => {
      if (f.kind !== "dropped" || !f.item.startsWith("profile.")) return false;
      const aud = audienceDescriptor(f.item.split("=")[1]);
      return aud !== null && audienceIntent(String(m.original_user_query ?? ""), aud) === "permit";
    },
  },
];

const locations = (m: Mission) => (((m.company_profile ?? {}) as Record<string, unknown>).locations as string[] | undefined) ?? [];
const mentions = (query: string, loc: string) => (COUNTRY_WORDS[norm(loc)] ?? new RegExp(`\\b${norm(loc).replace(/ /g, "\\s+")}\\b`, "i")).test(query);

/** Is a stated profile value represented by any criterion (a split value counts by its parts)? */
function represented(value: string, dim: string, crit: Crit[]): boolean {
  const vals = crit.map((c) => norm(`${c.id} ${JSON.stringify(c.value)} ${JSON.stringify(c.any_of ?? "")}`));
  if (vals.some((t) => t.includes(value))) return true;
  const parts = crit.filter((c) => c.dimension === dim || (dim === "industry" && c.dimension === "business_model")).map((c) => norm(c.value)).filter(Boolean);
  let rest = value;
  for (const p of parts.sort((a, b) => b.length - a.length)) rest = rest.replace(p, " ");
  return parts.length > 0 && rest.trim().length === 0;
}

export function findings(m: Mission, crit: Crit[]): Finding[] {
  const out: Omit<Finding, "guard">[] = [];
  const cp = (m.company_profile ?? {}) as Record<string, unknown>;
  const text = crit.map((c) => norm(`${c.id} ${JSON.stringify(c.value)}`)).join(" | ");
  for (const [f, dim] of Object.entries(PROFILE_DIMENSION)) {
    for (const v of (cp[f] as unknown[] | undefined) ?? []) if (!represented(norm(v), dim, crit)) out.push({ item: `profile.${f}=${norm(v)}`, kind: "dropped" });
  }
  const er = cp.employee_range as { min?: number | null; max?: number | null } | undefined;
  if (er && (er.min != null || er.max != null) && !crit.some((c) => c.dimension === "company_size")) out.push({ item: "profile.employee_range", kind: "dropped" });
  for (const k of Object.keys((m.hard_constraints ?? {}) as Record<string, unknown>)) {
    if (k.startsWith("company_profile.")) {
      const dim = PROFILE_DIMENSION[k.slice("company_profile.".length)] ?? (k.endsWith("employee_range") ? "company_size" : "");
      const ofDim = crit.filter((c) => c.dimension === dim);
      if (!ofDim.length) out.push({ item: `hard.${k}`, kind: "dropped" });
      else if (!ofDim.some((c) => c.kind === "hard")) out.push({ item: `hard.${k}`, kind: "demoted" });
    } else if (!text.includes(norm(k))) out.push({ item: `hard.${k}`, kind: "dropped" });
  }
  return out.map((f) => ({ ...f, guard: GUARDS.find((g) => g.applies(f, m, crit))?.name ?? null }));
}

/** Every stored mission and corpus case → its findings (only missions with any). */
export async function coverage(): Promise<Record<string, Finding[]>> {
  const out: Record<string, Finding[]> = {};
  const missions: [string, Mission][] = await persistedMissions();
  for (const c of await corpusCases()) missions.push([`corpus:${c.name}`, compileCaseMission(c)]);
  for (const [k, m] of missions) {
    const crit = (k.startsWith("corpus:") ? m.criteria : deriveMissionCriteria(m as never)) as Crit[];
    const f = findings(m, crit);
    if (f.length) out[k] = f;
  }
  return out;
}

if (import.meta.main) {
  const c = await coverage();
  const all = Object.values(c).flat();
  const unexplained = Object.entries(c).flatMap(([k, fs]) => fs.filter((f) => !f.guard).map((f) => `${k}: ${f.kind} ${f.item}`));
  const byGuard: Record<string, number> = {};
  for (const f of all) byGuard[f.guard ?? "UNEXPLAINED"] = (byGuard[f.guard ?? "UNEXPLAINED"] ?? 0) + 1;
  console.log(JSON.stringify({ missionsWithFindings: Object.keys(c).length, findings: all.length, byGuard }));
  for (const u of unexplained) console.log(`UNEXPLAINED ${u}`);
  if (unexplained.length) Deno.exit(1);
}
