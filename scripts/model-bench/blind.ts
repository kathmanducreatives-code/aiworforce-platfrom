// BLIND HUMAN GRADING for the Terra benchmark. Pure; no network.
//
//   deno run --allow-read --allow-write scripts/model-bench/blind.ts pack results.jsonl out-prefix [seed]
//       → out-prefix.sheet.json  (per task: anonymised answers A, B, C… in a seeded shuffle)
//       → out-prefix.key.json    (label → candidate/repeat; keep it away from graders)
//   deno run --allow-read scripts/model-bench/blind.ts unblind graded.sheet.json out-prefix.key.json
//       → mean grade per candidate and per category
//
// Graders score each answer 1–5 on correctness, grounding and usefulness. The
// sheet shows word counts so a grader can see — and is told not to reward —
// length: the rubric scores the answer to the question, not its size.

export interface BlindRow { candidate: string; rep: number; task: string; category: string | null; output: string }
export interface SheetEntry { label: string; output: string; words: number; grade_correctness: number | null; grade_grounding: number | null; grade_usefulness: number | null }
export interface Sheet { rubric: string; tasks: Array<{ task: string; category: string | null; answers: SheetEntry[] }> }
export type Key = Record<string, Record<string, { candidate: string; rep: number }>>;

export const RUBRIC = "Score each answer 1–5 on CORRECTNESS (matches the evidence), GROUNDING (cites only given evidence, flags stale/contradicted/missing), " +
  "USEFULNESS (clear recommendation and next step). Do NOT reward length: a shorter answer that is correct and actionable scores higher than a longer one that pads.";

/** Deterministic PRNG so a pack can be regenerated identically from its seed. */
function rng(seed: number) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export function blindPack(rows: readonly BlindRow[], seed = 20261111): { sheet: Sheet; key: Key } {
  const rand = rng(seed);
  const byTask = new Map<string, BlindRow[]>();
  for (const r of rows) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r]);
  const sheet: Sheet = { rubric: RUBRIC, tasks: [] };
  const key: Key = {};
  for (const [task, rs] of byTask) {
    const shuffled = [...rs].map((r) => ({ r, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.r);
    key[task] = {};
    sheet.tasks.push({ task, category: rs[0].category, answers: shuffled.map((r, i) => {
      const label = i < 26 ? String.fromCharCode(65 + i) : `Z${i}`;
      key[task][label] = { candidate: r.candidate, rep: r.rep };
      return { label, output: r.output, words: r.output.trim().split(/\s+/).filter(Boolean).length,
        grade_correctness: null, grade_grounding: null, grade_usefulness: null };
    }) });
  }
  return { sheet, key };
}

export function unblind(sheet: Sheet, key: Key): Record<string, { graded: number; mean: number | null; by_category: Record<string, number> }> {
  const acc: Record<string, { sum: number; n: number; cat: Record<string, { sum: number; n: number }> }> = {};
  for (const t of sheet.tasks) for (const a of t.answers) {
    const who = key[t.task]?.[a.label];
    const g = [a.grade_correctness, a.grade_grounding, a.grade_usefulness].filter((x): x is number => typeof x === "number");
    if (!who || g.length === 0) continue;
    const mean = g.reduce((s, x) => s + x, 0) / g.length;
    const c = (acc[who.candidate] ??= { sum: 0, n: 0, cat: {} });
    c.sum += mean; c.n++;
    const k = t.category ?? "uncategorised";
    const cc = (c.cat[k] ??= { sum: 0, n: 0 });
    cc.sum += mean; cc.n++;
  }
  return Object.fromEntries(Object.entries(acc).map(([c, v]) => [c, { graded: v.n, mean: v.n ? Number((v.sum / v.n).toFixed(3)) : null,
    by_category: Object.fromEntries(Object.entries(v.cat).map(([k, x]) => [k, Number((x.sum / x.n).toFixed(3))])) }]));
}

if (import.meta.main) {
  const [cmd, a, b, seed] = Deno.args;
  if (cmd === "pack") {
    const rows = Deno.readTextFileSync(a).split("\n").filter(Boolean).map((l) => JSON.parse(l))
      .filter((r) => r.candidate && typeof r.output === "string" && !r.skipped)
      .map((r) => ({ candidate: r.candidate, rep: r.rep, task: r.task, category: r.category ?? null, output: r.output }));
    const { sheet, key } = blindPack(rows, seed ? Number(seed) : undefined);
    Deno.writeTextFileSync(`${b}.sheet.json`, JSON.stringify(sheet, null, 2));
    Deno.writeTextFileSync(`${b}.key.json`, JSON.stringify(key, null, 2));
    console.log(`wrote ${b}.sheet.json (for graders) and ${b}.key.json (keep private)`);
  } else if (cmd === "unblind") {
    console.log(JSON.stringify(unblind(JSON.parse(Deno.readTextFileSync(a)), JSON.parse(Deno.readTextFileSync(b))), null, 2));
  } else console.log("usage: blind.ts pack <results.jsonl> <out-prefix> [seed] | unblind <graded.sheet.json> <key.json>");
}
