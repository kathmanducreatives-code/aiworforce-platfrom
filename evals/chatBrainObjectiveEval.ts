// LIVE-MODEL EVALUATION OF CHAT BRAIN, AGAINST THE HELD-OUT SUITE.
//
// ── RUN IT DELIBERATELY, NEVER IN CI ───────────────────────────────────────
//
//   deno run --allow-net --allow-env --allow-read evals/chatBrainObjectiveEval.ts
//
// Every case is a real model call, so this spends money and takes minutes. It
// is a manually-run measurement, not a test — wiring it into the suite would
// bill every `deno test`.
//
// ── THE RULE THAT MAKES THE NUMBER MEAN ANYTHING ───────────────────────────
//
// The suite is HELD OUT. If a case fails, the prompt or the parser changes —
// never the case. Editing an expectation to match model behaviour converts the
// only independent measurement in Phase B into a restatement of what the model
// already does. Nothing in this script writes to the fixture.
//
// It also does not touch production: no database, no pilot-chat, no shadow
// traffic. It calls `understandRequest` exactly as production would and reports.

import {
  understandRequest, type ChatBrainOutcome,
} from "../supabase/functions/_shared/chatBrain.ts";
import type { ModelRoute } from "../supabase/functions/_shared/gptModelRouter.ts";
import type { RequestV1 } from "../supabase/functions/_shared/requestV1.ts";

const SUITE = JSON.parse(await Deno.readTextFile(
  new URL("../tests/edge-functions/_shared/fixtures/objectiveEvalSuite.json", import.meta.url)));

interface Row {
  utterance: string;
  group: string;
  expected: string;
  actual: string;
  expected_entity: string | null;
  actual_entity: string | null;
  references: string;
  signals: string;
  qualifiers: string;
  output: string;
  ambiguity: string;
  blocking: boolean | null;
  parts: number;
  depends_on: string;
  repaired: boolean;
  latency_ms: number;
  model: string;
  pass: boolean;
  reason: string;
}

const deps = { readEnv: (k: string) => Deno.env.get(k) };

function summarise(r: RequestV1) {
  const p = r.parts[0];
  return {
    entity: p?.subject.entity ?? null,
    references: r.parts.flatMap((x) => (x.subject.references ?? []).map((y) => y.value)).join("; "),
    signals: r.parts.flatMap((x) => (x.requirements ?? []).map((q) => q.event)).join("; "),
    qualifiers: r.parts.flatMap((x) =>
      (x.requirements ?? []).map((q) => JSON.stringify(q.qualifier ?? {}))).join("; "),
    output: r.parts.map((x) => `${x.output.shape}:${x.output.count ?? "-"}`).join("; "),
    ambiguity: r.ambiguity.map((a) => `${a.field}${a.blocking ? "!" : ""}`).join("; "),
    blocking: r.ambiguity.length ? r.ambiguity.some((a) => a.blocking) : null,
    parts: r.parts.length,
    depends_on: r.parts.map((x) => `${x.id}<-${(x.depends_on ?? []).join(",") || "-"}`).join("; "),
    objectives: r.parts.map((x) => x.objective),
  };
}

async function runOne(
  utterance: string, group: string, expected: string,
  check: (r: RequestV1) => { pass: boolean; reason: string },
): Promise<Row> {
  let route: ModelRoute | null = null;
  const t0 = Date.now();
  let out: ChatBrainOutcome;
  try {
    out = await understandRequest(utterance, { onRoute: (r) => { route = route ?? r; } }, deps);
  } catch (e) {
    out = { ok: false, reason: "provider_failure", violations: [] };
    console.error("  threw:", String(e).slice(0, 120));
  }
  const latency_ms = Date.now() - t0;
  const model = (route as ModelRoute | null)?.model ?? "-";

  if (!out.ok) {
    return {
      utterance, group, expected, actual: `REFUSED:${out.reason}`,
      expected_entity: null, actual_entity: null, references: "", signals: "",
      qualifiers: "", output: "", ambiguity: "", blocking: null, parts: 0,
      depends_on: "", repaired: false, latency_ms, model,
      // A REFUSAL IS NEVER SILENTLY source/research. It is a clarification, and
      // for a definite case that is still a miss — but a SAFE one.
      pass: false, reason: `model unreadable (${out.violations.join(",") || out.reason})`,
    };
  }
  const s = summarise(out.request);
  const v = check(out.request);
  return {
    utterance, group, expected, actual: out.request.objective,
    expected_entity: null, actual_entity: s.entity,
    references: s.references, signals: s.signals, qualifiers: s.qualifiers,
    output: s.output, ambiguity: s.ambiguity, blocking: s.blocking,
    parts: s.parts, depends_on: s.depends_on, repaired: out.repaired,
    latency_ms, model, pass: v.pass, reason: v.reason,
  };
}

const rows: Row[] = [];
const limit = Number(Deno.env.get("EVAL_LIMIT") ?? "0");

console.log("── single-objective cases ──");
for (const c of SUITE.cases.slice(0, limit || undefined)) {
  const row = await runOne(c.utterance, c.pair ? `pair:${c.pair}` : c.objective, c.objective,
    (r) => r.objective === c.objective
      ? { pass: true, reason: "" }
      : { pass: false, reason: `expected ${c.objective}, got ${r.objective}` });
  rows.push(row);
  console.log(`  ${row.pass ? "ok  " : "FAIL"} ${row.expected.padEnd(8)} → ${row.actual.padEnd(10)} ${row.utterance.slice(0, 62)}`);
}

console.log("── mixed requests ──");
for (const c of SUITE.mixed.slice(0, limit || undefined)) {
  const want: string[] = c.objectives;
  const row = await runOne(c.utterance, "mixed", want.join("+"), (r) => {
    const got = r.parts.map((p) => p.objective);
    const covered = want.every((w) => got.includes(w as never));
    const dep = r.parts.some((p) => (p.depends_on ?? []).length > 0);
    if (!covered) return { pass: false, reason: `parts ${got.join("+")} miss ${want.join("+")}` };
    if (c.dependent && !dep) return { pass: false, reason: "no dependency between parts" };
    return { pass: true, reason: "" };
  });
  rows.push(row);
  console.log(`  ${row.pass ? "ok  " : "FAIL"} ${row.expected.padEnd(16)} parts=${row.parts} ${row.utterance.slice(0, 54)}`);
}

console.log("── ambiguity ──");
for (const c of SUITE.ambiguous.slice(0, limit || undefined)) {
  const row = await runOne(c.utterance, "ambiguity", c.blocking ? "blocking" : "non-blocking",
    (r) => {
      const blocks = r.ambiguity.some((a) => a.blocking);
      if (c.blocking && !blocks) {
        return { pass: false, reason: "must block: acting could target the wrong entity" };
      }
      if (!c.blocking && blocks) return { pass: false, reason: "blocked a safe vagueness" };
      return { pass: true, reason: "" };
    });
  rows.push(row);
  console.log(`  ${row.pass ? "ok  " : "FAIL"} ${row.expected.padEnd(14)} blocking=${row.blocking} ${row.utterance.slice(0, 48)}`);
}

// ── report ────────────────────────────────────────────────────────────────
const pct = (a: number, b: number) => b === 0 ? "  -  " : `${((a / b) * 100).toFixed(0).padStart(3)}%`;
const groups = new Map<string, Row[]>();
for (const r of rows) {
  const key = r.group.startsWith("pair:") ? "near-miss pairs" : r.group;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
console.log("\n══ ACCURACY ══");
for (const [g, rs] of [...groups].sort()) {
  const ok = rs.filter((r) => r.pass).length;
  console.log(`  ${g.padEnd(18)} ${pct(ok, rs.length)}  (${ok}/${rs.length})`);
}
const ok = rows.filter((r) => r.pass).length;
console.log(`  ${"OVERALL".padEnd(18)} ${pct(ok, rows.length)}  (${ok}/${rows.length})`);

const lat = rows.map((r) => r.latency_ms).sort((a, b) => a - b);
console.log(`\n  latency p50 ${lat[Math.floor(lat.length / 2)]}ms  p95 ${lat[Math.floor(lat.length * 0.95)]}ms`);
console.log(`  repairs used: ${rows.filter((r) => r.repaired).length}`);
console.log(`  refusals:     ${rows.filter((r) => r.actual.startsWith("REFUSED")).length}`);
console.log(`  models:       ${[...new Set(rows.map((r) => r.model))].join(", ")}`);

console.log("\n══ FAILURES ══");
for (const r of rows.filter((x) => !x.pass)) {
  console.log(`  [${r.group}] ${r.utterance}`);
  console.log(`      want ${r.expected} · got ${r.actual} · ${r.reason}`);
  if (r.signals || r.references) {
    console.log(`      entity=${r.actual_entity} refs=[${r.references}] signals=[${r.signals}] amb=[${r.ambiguity}]`);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const path = `evals/results/chatBrain-${stamp}.json`;
await Deno.mkdir("evals/results", { recursive: true });
await Deno.writeTextFile(path, JSON.stringify({ rows, generated_at: new Date().toISOString() }, null, 2));
console.log(`\nfull per-case record → ${path}`);
