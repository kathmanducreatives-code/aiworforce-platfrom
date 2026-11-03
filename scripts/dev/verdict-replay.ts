// QUALIFICATION-VERDICT REPLAY — would this code change what stored candidates qualify as?
//
//   deno run --allow-read --allow-env scripts/dev/verdict-replay.ts                       # compare with the recorded baseline
//   deno run --allow-read --allow-write --allow-env scripts/dev/verdict-replay.ts --write # re-record (a reviewed semantic change)
//   deno run --allow-read --allow-env scripts/dev/verdict-replay.ts --release-dir <a> [--candidate-dir <b>]
//
// Option E's semantic baseline and production replay gate replay CRITERIA derivation.
// They cannot see a change to the shared QUALIFICATION engine (candidateEligibility):
// that is where D1 and D5 live. This replays the engine itself, offline, on stored
// production candidates: every checkpoint of every Replay Lab fixture
// (tests/replay/fixtures, sanitized production runs) is rehydrated by the production
// `restoreWorkingSet`, turned into evidence graphs by `missionCandidatesFrom` (judged at
// the checkpoint's own instant, never the wall clock), and qualified by
// `evaluateEligibility` against the mission's re-derived criteria — exactly the path
// run-agent takes. Each side loads ITS OWN modules (`--release-dir` / `--candidate-dir`),
// so a release older than this script is judged by its own code.
//
// Output per candidate: the eligibility and every check's result. Nothing is bought;
// nothing reads a database.

const ROOT = new URL("../../", import.meta.url);
export const VERDICT_BASELINE_PATH = "tests/fixtures/atlas-eval/verdict-baseline.json";
const FIXTURE_DIR = "tests/replay/fixtures";

export interface CandidateVerdict { eligibility: string; checks: Record<string, string> }
export type Verdicts = Record<string, CandidateVerdict>;

type Mods = {
  deriveMissionCriteria: (m: unknown) => unknown[];
  evaluateEligibility: (c: unknown[], g: unknown) => { eligibility: string; checks: { criterion_id: string; dimension: string; result: string }[] };
  restoreWorkingSet: (c: unknown[]) => unknown[];
  missionCandidatesFrom: (run: { companies: unknown[] }, opts: { missionId?: string | null; now?: Date }) => { company_key: string; graph: unknown }[];
};

async function modules(root: string): Promise<Mods> {
  const at = (p: string) => import(new URL(`supabase/functions/_shared/${p}`, `file://${Deno.realPathSync(root)}/`).href);
  const [crit, elig, engine] = await Promise.all([at("missionCriteria.ts"), at("candidateEligibility.ts"), at("leadCapabilityEngine.ts")]);
  return { deriveMissionCriteria: crit.deriveMissionCriteria, evaluateEligibility: elig.evaluateEligibility, restoreWorkingSet: engine.restoreWorkingSet, missionCandidatesFrom: engine.missionCandidatesFrom };
}

/** A stored checkpoint: a mission and the company resume records run-agent wrote, judged at `at`. */
interface StoredCheckpoint { key: string; mission: unknown; companies: unknown[]; at: string }

const readJson = (p: string) => JSON.parse(Deno.readTextFileSync(new URL(p, ROOT)));
/** The newest evidence instant in the records: a checkpoint without a stamp is judged then, never at the wall clock. */
const newestObservation = (companies: unknown[]) =>
  (JSON.stringify(companies).match(/"observed_at":"([^"]+)"/g) ?? []).map((s) => s.slice(15, -1)).filter((d) => Number.isFinite(Date.parse(d))).sort().at(-1) ?? "2026-10-01T00:00:00Z";

/**
 * Every stored production checkpoint in the repository (sanitized):
 *   tests/replay/fixtures/*.json                 mission + named checkpoints (with their instant)
 *   tests/fixtures/lead-v2/canary-*\/result.json  lead_mission + lead_resume_checkpoint
 *   tests/fixtures/lead-v2/run-*\/                task.json lead_mission + lineage.json checkpoint
 */
export function storedCheckpoints(): StoredCheckpoint[] {
  const out: StoredCheckpoint[] = [];
  for (const e of [...Deno.readDirSync(new URL(FIXTURE_DIR, ROOT))].filter((x) => x.isFile && x.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
    const fx = readJson(`${FIXTURE_DIR}/${e.name}`);
    if (!fx.mission || !fx.checkpoints) continue;
    for (const [name, cp] of Object.entries(fx.checkpoints as Record<string, { at: string; companies: unknown[] }>)) {
      out.push({ key: `${e.name.replace(/\.json$/, "")}#${name}`, mission: fx.mission, companies: cp.companies, at: cp.at });
    }
  }
  const lv2 = "tests/fixtures/lead-v2";
  for (const e of [...Deno.readDirSync(new URL(lv2, ROOT))].filter((x) => x.isDirectory).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = `${lv2}/${e.name}`;
    const has = (f: string) => { try { return Deno.statSync(new URL(`${dir}/${f}`, ROOT)).isFile; } catch { return false; } };
    if (has("result.json")) {
      const r = readJson(`${dir}/result.json`);
      const cos = r.lead_resume_checkpoint?.companies;
      if (r.lead_mission && Array.isArray(cos) && cos.length) out.push({ key: `${e.name}#result`, mission: r.lead_mission, companies: cos, at: newestObservation(cos) });
    }
    if (has("task.json") && has("lineage.json")) {
      const mission = readJson(`${dir}/task.json`).result?.lead_mission;
      const cos = readJson(`${dir}/lineage.json`).current_state?.lead_resume_checkpoint?.companies;
      if (mission && Array.isArray(cos) && cos.length) out.push({ key: `${e.name}#lineage`, mission, companies: cos, at: newestObservation(cos) });
    }
  }
  return out;
}

/** Every stored candidate's verdict under the code at `root` (default: this checkout). */
export async function verdicts(root = Deno.realPathSync(new URL(".", ROOT))): Promise<Verdicts> {
  const m = await modules(root);
  const out: Verdicts = {};
  for (const cp of storedCheckpoints()) {
    const criteria = m.deriveMissionCriteria(structuredClone(cp.mission));
    const companies = m.restoreWorkingSet(structuredClone(cp.companies));
    const candidates = m.missionCandidatesFrom({ companies }, { missionId: "verdict-replay", now: new Date(cp.at) });
    for (const c of candidates) {
      const r = m.evaluateEligibility(criteria, c.graph);
      const checks: Record<string, string> = {};
      for (const k of r.checks) checks[`${k.dimension}:${k.criterion_id}`] = k.result;
      out[`${cp.key}#${c.company_key}`] = { eligibility: r.eligibility, checks: Object.fromEntries(Object.entries(checks).sort()) };
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export interface VerdictChange { key: string; before: CandidateVerdict | null; after: CandidateVerdict | null; eligibilityChanged: boolean; checks: string[] }

export function diffVerdicts(before: Verdicts, after: Verdicts): VerdictChange[] {
  const out: VerdictChange[] = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const b = before[key] ?? null, a = after[key] ?? null;
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    const ids = [...new Set([...Object.keys(b?.checks ?? {}), ...Object.keys(a?.checks ?? {})])];
    out.push({
      key, before: b, after: a, eligibilityChanged: b?.eligibility !== a?.eligibility,
      checks: ids.filter((id) => b?.checks[id] !== a?.checks[id]).map((id) => `${id}: ${b?.checks[id] ?? "-"} → ${a?.checks[id] ?? "-"}`),
    });
  }
  return out;
}

export function summarise(v: Verdicts) {
  const by: Record<string, number> = {};
  for (const x of Object.values(v)) by[x.eligibility] = (by[x.eligibility] ?? 0) + 1;
  return { candidates: Object.keys(v).length, ...by };
}

function arg(name: string): string | undefined {
  const i = Deno.args.indexOf(name);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}

if (import.meta.main) {
  const rel = arg("--release-dir");
  const print = (d: VerdictChange[]) => {
    for (const c of d) console.log(`${c.eligibilityChanged ? "ELIGIBILITY" : "check"} ${c.key}: ${c.before?.eligibility ?? "-"} → ${c.after?.eligibility ?? "-"}\n   ${c.checks.join(" | ")}`);
  };
  if (rel) {
    const before = await verdicts(rel);
    const after = await verdicts(arg("--candidate-dir") ?? undefined);
    const d = diffVerdicts(before, after);
    console.log(JSON.stringify({ release: summarise(before), candidate: summarise(after), changed: d.length, eligibilityChanged: d.filter((x) => x.eligibilityChanged).length }));
    print(d);
  } else {
    const current = await verdicts();
    if (Deno.args.includes("--write")) {
      await Deno.writeTextFile(new URL(VERDICT_BASELINE_PATH, ROOT), JSON.stringify(current, null, 1) + "\n");
      console.log(`wrote ${VERDICT_BASELINE_PATH}`, JSON.stringify(summarise(current)));
    } else {
      const d = diffVerdicts(JSON.parse(await Deno.readTextFile(new URL(VERDICT_BASELINE_PATH, ROOT))), current);
      console.log(d.length ? `${d.length} verdict change(s)` : `no verdict changes (${JSON.stringify(summarise(current))})`);
      print(d);
      if (d.length) Deno.exit(1);
    }
  }
}
