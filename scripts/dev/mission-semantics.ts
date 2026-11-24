// MISSION SEMANTICS BASELINE — what every stored mission and corpus case means today.
//
//   deno run --allow-read scripts/dev/mission-semantics.ts            # compare with the baseline
//   deno run --allow-read --allow-write scripts/dev/mission-semantics.ts --write   # record a new baseline
//
// Two sources, both offline (no network, no model, no provider):
//
//   persisted  every `lead-mission-v1` object in the repository's fixtures, re-derived
//              EXACTLY as run-agent does at run time (`deriveMissionCriteria(mission)`,
//              PRODUCTION_READINESS) — the production semantic replay: a compiler change
//              shows here as the meaning a stored ORION mission would run with.
//   corpus     tests/fixtures/mission-semantics/corpus.json: a query + model proposal per
//              case, compiled by `compileLeadMission` — the historical GPT failures and the
//              owner-decided readings.
//
// The baseline (tests/fixtures/mission-semantics/baseline.json) is the review surface:
// a PR that changes it is a semantic change and lists every difference.

import { compileLeadMission } from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria } from "../../supabase/functions/_shared/missionCriteria.ts";
import { type MissionSemantics, missionSemantics, semanticDiff, semanticsFingerprint } from "../../supabase/functions/_shared/missionSemantics.ts";
import { canonicalJson, sha256Hex } from "../../supabase/functions/_shared/providerInputFingerprint.ts";

const ROOT = new URL("../../", import.meta.url);
export const BASELINE_PATH = "tests/fixtures/mission-semantics/baseline.json";
const CORPUS_PATH = "tests/fixtures/mission-semantics/corpus.json";
const FIXTURE_DIRS = ["tests", "docs"];

export interface Entry { source: "persisted" | "corpus"; fingerprint: string; semantics: MissionSemantics }

export const BLANK_PROPOSAL = {
  requested_opportunity_count: null, requested_contact_ready_count: null, company_types: [], geographies: ["United States"],
  employee_range: { min: null, max: null }, decision_maker_roles: [], soft_preferences: [], preferred_signals: ["hiring"],
  adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
  disallowed_broadening: [], required_evidence: [], required_capabilities: [], preferred_source_strategy: [],
  evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.85, unknowns: [], known_companies: [],
  signal_recency_days: 30, required_signal_terms: [], no_broadening_requested: false, geography_is_hard: true,
  prohibitions: [], output_intent: "companies", strategies: ["hiring"],
};
const US_HARD = { field: "geography", operator: "in", value: ["United States"], reason: "US" };

export interface CorpusCase { name: string; query: string; proposal: Record<string, unknown> & { extra_hard?: unknown[] } }

/** The compiled mission of a corpus case. */
export function compileCaseMission(c: CorpusCase): Record<string, unknown> {
  const { extra_hard, ...rest } = c.proposal;
  const proposal = { ...BLANK_PROPOSAL, ...rest, hard_constraints: [US_HARD, ...(extra_hard ?? [])] };
  return compileLeadMission({ originalUserQuery: c.query, proposal: proposal as never, requestedCount: (rest.requested_opportunity_count as number) ?? null }).final_mission as unknown as Record<string, unknown>;
}

export function compileCase(c: CorpusCase): MissionSemantics {
  const { extra_hard, ...rest } = c.proposal;
  const proposal = { ...BLANK_PROPOSAL, ...rest, hard_constraints: [US_HARD, ...(extra_hard ?? [])] };
  const m = compileLeadMission({ originalUserQuery: c.query, proposal: proposal as never, requestedCount: (rest.requested_opportunity_count as number) ?? null }).final_mission as unknown as Record<string, unknown>;
  return missionSemantics(m as never, (m.criteria as unknown[]) ?? []);
}

function* walk(o: unknown, path: string): Generator<[string, Record<string, unknown>]> {
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) yield* walk(o[i], `${path}[${i}]`); return; }
  if (!o || typeof o !== "object") return;
  const r = o as Record<string, unknown>;
  if (r.version === "lead-mission-v1" && typeof r.original_user_query === "string") { yield [path, r]; return; }
  for (const [k, v] of Object.entries(r)) yield* walk(v, `${path}.${k}`);
}

async function* jsonFiles(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(new URL(dir, ROOT))) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) { if (e.name !== "node_modules") yield* jsonFiles(p); }
    else if (e.name.endsWith(".json") && !p.startsWith("tests/fixtures/mission-semantics/")) yield p;
  }
}

/** Every distinct persisted lead-mission-v1 fixture, keyed `persisted:<file>#<path>` (first path wins). */
export async function persistedMissions(): Promise<[string, Record<string, unknown>][]> {
  const out: [string, Record<string, unknown>][] = [];
  const seen = new Set<string>();
  const files: string[] = [];
  for (const d of FIXTURE_DIRS) for await (const f of jsonFiles(d)) files.push(f);
  for (const f of files.sort()) {
    let doc: unknown;
    try { doc = JSON.parse(await Deno.readTextFile(new URL(f, ROOT))); } catch { continue; }
    for (const [path, mission] of walk(doc, "$")) {
      const content = sha256Hex(canonicalJson(mission));
      if (seen.has(content)) continue;
      seen.add(content);
      out.push([`persisted:${f}#${path}`, mission]);
    }
  }
  return out;
}

export async function corpusCases(): Promise<CorpusCase[]> {
  return (JSON.parse(await Deno.readTextFile(new URL(CORPUS_PATH, ROOT))) as { cases: CorpusCase[] }).cases;
}

/** Every entry, keyed. Persisted missions are de-duplicated by content (the first path wins). */
export async function build(): Promise<Record<string, Entry>> {
  const out: Record<string, Entry> = {};
  for (const [key, mission] of await persistedMissions()) {
    const s = missionSemantics(mission as never, deriveMissionCriteria(mission as never));
    out[key] = { source: "persisted", fingerprint: semanticsFingerprint(s), semantics: s };
  }
  const corpus = { cases: await corpusCases() };
  for (const c of corpus.cases) {
    const s = compileCase(c);
    out[`corpus:${c.name}`] = { source: "corpus", fingerprint: semanticsFingerprint(s), semantics: s };
  }
  return out;
}

/** Differences between a recorded baseline and the current build: one line per changed entry. */
export function compare(baseline: Record<string, Entry>, current: Record<string, Entry>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(baseline)) if (!current[k]) out.push(`${k}: missing`);
  for (const [k, e] of Object.entries(current)) {
    const b = baseline[k];
    if (!b) { out.push(`${k}: new entry`); continue; }
    if (b.fingerprint !== e.fingerprint) out.push(`${k}: ${semanticDiff(b.semantics, e.semantics).join("; ") || "changed"}`);
  }
  return out;
}

if (import.meta.main) {
  const current = await build();
  if (Deno.args.includes("--write")) {
    const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
    await Deno.writeTextFile(new URL(BASELINE_PATH, ROOT), JSON.stringify(sorted, null, 1) + "\n");
    console.log(`wrote ${Object.keys(sorted).length} entries to ${BASELINE_PATH}`);
  } else {
    const baseline = JSON.parse(await Deno.readTextFile(new URL(BASELINE_PATH, ROOT)));
    const diff = compare(baseline, current);
    console.log(diff.length ? diff.join("\n") : `no semantic differences (${Object.keys(current).length} entries)`);
    if (diff.length) Deno.exit(1);
  }
}
