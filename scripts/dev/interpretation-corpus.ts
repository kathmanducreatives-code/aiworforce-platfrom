// INTERPRETATION CORPUS RUNNER — one meaning, many phrasings, one canonical summary.
//
//   deno run --allow-read --allow-env scripts/dev/interpretation-corpus.ts
//
// Mission reliability S0. Corpus: tests/fixtures/mission-reliability/v1/cases.json. Every
// phrasing (a paraphrase, or a recorded model reading of the same request) is compiled by
// the real compiler and summarised canonically — the summary a reviewer would write for
// the request's meaning:
//
//   geo        hard geography "value@scope"
//   roles      the hard hiring requirement's roles (registered titles by canonical id)
//   roleMatch  any | all
//   excluded   excluded roles (canonical)
//   hard       other hard requirements (dimension, industry by value)
//   anyOf      either/or groups
//   unmappable an extra hard requirement no evidence can answer (must be false)
//
// A phrasing passes when its summary equals the case's label. A labelled `defect` marks a
// phrasing the current code is known to get wrong; CI fails on any unlabelled mismatch.

import { compileLeadMission } from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import { specFromMission } from "../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { canonicalTitleOf, classifyRoleFamily } from "../../supabase/functions/_shared/roleFamilies.ts";

const ROOT = new URL("../../", import.meta.url);
export const CASES_PATH = "tests/fixtures/mission-reliability/v1/cases.json";

export interface Expect { geo: string[]; roles: string[]; roleMatch: string; excluded: string[]; hard: string[]; anyOf: string[][]; hiringWindowDays?: number }
export interface Phrasing { label: string; query: string; proposal: Record<string, unknown>; defect?: string }
export interface Case { id: string; title: string; expect: Expect; phrasings: Phrasing[] }
export interface Summary { geo: string[]; roles: string[]; roleMatch: string; excluded: string[]; hard: string[]; anyOf: string[][]; unmappable: boolean; hiringWindowDays: number | null }
export interface PhrasingResult { case: string; label: string; ok: boolean; defect: string | null; mismatches: string[]; summary: Summary }

export const loadCases = (): Case[] => JSON.parse(Deno.readTextFileSync(new URL(CASES_PATH, ROOT))).cases;
/** Pairs of cases that mean DIFFERENT things: their canonical summaries must differ. */
export interface Contrast { a: string; b: string; why: string }
export const loadContrasts = (): Contrast[] => JSON.parse(Deno.readTextFileSync(new URL(CASES_PATH, ROOT))).contrasts ?? [];

const BLANK = {
  requested_opportunity_count: 5, requested_contact_ready_count: null, company_types: [], geographies: ["United States"], employee_range: { min: null, max: null },
  decision_maker_roles: [], soft_preferences: [], preferred_signals: ["hiring"], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } }, disallowed_broadening: [],
  required_evidence: [], required_capabilities: [], preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false,
  confidence: 0.85, unknowns: [], known_companies: [], signal_recency_days: 30, required_signal_terms: [], no_broadening_requested: false,
  geography_is_hard: true, prohibitions: [], output_intent: "companies", strategies: ["hiring"],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().replace(/s$/, "");
/**
 * A role by MEANING: a registered title by its id (exact, Stage 2 policy); a broad word
 * ("salespeople", "sales people", "sellers", "sales roles") by its family; anything else
 * literally. So paraphrases of one role compare equal and distinct roles stay distinct.
 */
const role = (t: string) => {
  const k = canonicalTitleOf(t);
  if (k) return k;
  const f = classifyRoleFamily(t);
  return f && f !== "custom" ? `family:${f}` : norm(t);
};

type Crit = { kind: string; dimension: string; value: unknown; any_of?: string[]; geography_scope?: string; time_window?: { days?: number } };

export function compilePhrasing(p: Phrasing) {
  const { extra_hard, geo_hard, ...rest } = p.proposal as Record<string, unknown> & { extra_hard?: unknown[]; geo_hard?: string[] };
  const geo = geo_hard ?? ["United States"];
  const proposal = { ...BLANK, ...rest, hard_constraints: [{ field: "geography", operator: "in", value: geo, reason: "stated" }, ...(extra_hard ?? [])] };
  return compileLeadMission({ originalUserQuery: p.query, proposal: proposal as never, requestedCount: 5 }).final_mission as unknown as Record<string, unknown>;
}

export function summarise(m: Record<string, unknown>): Summary {
  const cs = ((m.criteria ?? []) as Crit[]).filter((c) => c.kind === "hard");
  const hiring = cs.find((c) => c.dimension === "hiring");
  const q = ((hiring?.value as { qualifier?: Record<string, unknown> } | undefined)?.qualifier ?? {}) as
    { role_terms?: string[]; excluded_role_terms?: string[]; role_match?: string };
  const val = (v: unknown) => typeof v === "string" ? v : Array.isArray(v) ? v.join("|") : JSON.stringify(v);
  const specHard = specFromMission(m as never, { defaultCount: 5 }).requirements.hard.map((h) => h.key);
  return {
    geo: cs.filter((c) => c.dimension === "geography").map((c) => `${val(c.value).toLowerCase()}@${c.geography_scope ?? "-"}`).sort(),
    roles: [...new Set((q.role_terms ?? []).map(role))].sort(),
    roleMatch: q.role_match ?? "any",
    excluded: [...new Set((q.excluded_role_terms ?? []).map(role))].sort(),
    hard: cs.filter((c) => !["geography", "hiring"].includes(c.dimension))
      .map((c) => c.dimension === "industry" ? `industry:${norm(val(c.value))}` : c.dimension).sort(),
    anyOf: [...new Set(cs.filter((c) => (c.any_of?.length ?? 0) > 1).map((c) => JSON.stringify([...c.any_of!].sort())))].map((s) => JSON.parse(s)).sort(),
    unmappable: specHard.includes("unmappable"),
    hiringWindowDays: hiring?.time_window?.days ?? null,
  };
}

export function compare(e: Expect, s: Summary): string[] {
  const out: string[] = [];
  const eq = (k: string, a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${k}: expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`); };
  eq("geo", [...e.geo].sort(), s.geo);
  eq("roles", [...e.roles].sort(), s.roles);
  eq("roleMatch", e.roleMatch, s.roleMatch);
  eq("excluded", [...e.excluded].sort(), s.excluded);
  // Other hard requirements: every expected one present (industry by prefix), nothing extra.
  const missing = e.hard.filter((x) => !s.hard.some((a) => a.startsWith(x)));
  const extra = s.hard.filter((a) => !e.hard.some((x) => a.startsWith(x)));
  if (missing.length || extra.length) out.push(`hard: missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`);
  eq("anyOf", e.anyOf.map((g) => [...g].sort()).sort(), s.anyOf);
  if (s.unmappable) out.push("unmappable: an extra hard requirement no evidence can answer reaches execution");
  if (e.hiringWindowDays !== undefined) eq("hiringWindowDays", e.hiringWindowDays, s.hiringWindowDays);
  return out;
}

export function runCases(cases = loadCases()): PhrasingResult[] {
  const out: PhrasingResult[] = [];
  for (const c of cases) {
    for (const p of c.phrasings) {
      const s = summarise(compilePhrasing(p));
      const mismatches = compare(c.expect, s);
      out.push({ case: c.id, label: p.label, ok: mismatches.length === 0, defect: p.defect ?? null, mismatches, summary: s });
    }
  }
  return out;
}

/** Contrast pairs whose first (defect-free) phrasings compile to the SAME summary: a distinction lost. */
export function collapsedContrasts(results: PhrasingResult[], contrasts = loadContrasts()): string[] {
  const first = (id: string) => results.find((r) => r.case === id && !r.defect)?.summary;
  return contrasts.filter((c) => JSON.stringify(first(c.a)) === JSON.stringify(first(c.b))).map((c) => `${c.a} vs ${c.b} (${c.why})`);
}

/** Paraphrase stability: phrasings of one case that compile to DIFFERENT summaries. */
export function unstableCases(results: PhrasingResult[]): string[] {
  const by = new Map<string, Set<string>>();
  for (const r of results) by.set(r.case, (by.get(r.case) ?? new Set()).add(JSON.stringify(r.summary)));
  return [...by].filter(([, s]) => s.size > 1).map(([k]) => k);
}

if (import.meta.main) {
  const r = runCases();
  for (const x of r) console.log(`${x.ok ? "ok  " : "FAIL"} ${x.case} ${x.label}${x.defect ? ` [${x.defect}]` : ""}${x.ok ? "" : `\n      ${x.mismatches.join("\n      ")}`}`);
  console.log(JSON.stringify({ phrasings: r.length, correct: r.filter((x) => x.ok).length, wrongLabelled: r.filter((x) => !x.ok && x.defect).length,
    wrongUnlabelled: r.filter((x) => !x.ok && !x.defect).map((x) => `${x.case}:${x.label}`), fixedButLabelled: r.filter((x) => x.ok && x.defect).map((x) => `${x.case}:${x.label}`),
    unstableCases: unstableCases(r), collapsedContrasts: collapsedContrasts(r) }));
}
