// OFFLINE INTERPRETATION + ROUTING + COST REPORT. No network, no model, no database.
//
//   deno run --allow-read --allow-env scripts/model-routing-eval/interpretationEval.ts
//
// 1. COMPILER ERRORS: each corpus case's correct (reference) proposal compiled
//    under contract v1 and v2; a wrong runtime window is the compiler's or the
//    contract's fault, never a model's. Under v2 some requests must be REFUSED
//    before spend (older-than, future, negated, unenforceable per-signal).
// 2. MODEL ERRORS: deliberately wrong v2 proposals — which ones code catches,
//    by correcting the runtime or by refusing the compile.
// 3. ROUTING: every stage's model, effort and escalation, per model family.
// 4. COST: the token profile of two REAL runs (tests/fixtures/lead-v2, harvested)
//    re-priced per family, plus the mission-compilation call itself. These are
//    ESTIMATES from recorded token counts; a different model emits a different
//    number of tokens, which only the capped live comparison can measure.

import { buildMissionCompilerPayload, compileLeadMission } from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import { escalationRoute, routingTable, type ModelFamilyId } from "../../supabase/functions/_shared/gptModelRouter.ts";
import { priceModelCall } from "../../supabase/functions/_shared/modelCostModel.ts";
import { gptMissionSchemaFor } from "../../supabase/functions/_shared/gptMissionSchema.ts";
import { evaluate, INTERPRETATION_CORPUS, proposalFor } from "./interpretationCorpus.ts";

const pad = (s: unknown, n: number) => String(s).padEnd(n);
const usd = (n: number | null) => n == null ? "n/a" : `$${n.toFixed(4)}`;

// ── 1. compiler errors ──────────────────────────────────────────────────────
console.log("## 1. Correct proposal → compiled runtime, or a refusal before spend (compiler / contract errors)\n");
const tally = { v1: 0, v2: 0 };
const show = (o: ReturnType<typeof evaluate>) => o.refused ? `REFUSED ${o.refused.map((r) => r.replace("interpretation_conflict:", "")).join(", ")}` : JSON.stringify(o.runtime);
for (const c of INTERPRETATION_CORPUS) {
  const row = (["v1", "v2"] as const).map((v) => {
    // A refusal is the expected outcome only under v2; v1 has no refusal for timeframes.
    const o = evaluate(compileLeadMission, c.id, c.request, proposalFor(c, c.windows, v), c.expect, v, v === "v2" ? c.expect_refusal : undefined);
    // v1 cannot refuse for a timeframe: it compiles these silently, which is the defect.
    if (v === "v1" && c.expect_refusal) return `v1 SILENT ${show(o)}`;
    if (o.ok) tally[v]++;
    return `${v} ${o.ok ? "ok  " : "FAIL"} ${show(o)}`;
  });
  const want = c.expect_refusal ? `refuse ${c.expect_refusal.source}` : JSON.stringify(c.expect);
  console.log(`${pad(c.id, 36)} expect ${pad(want, 44)} | ${row.join(" | ")}`);
}
const mustRefuse = INTERPRETATION_CORPUS.filter((c) => c.expect_refusal).length;
console.log(`\nv1 ${tally.v1}/${INTERPRETATION_CORPUS.length - mustRefuse} (and compiles all ${mustRefuse} must-refuse requests silently)   v2 ${tally.v2}/${INTERPRETATION_CORPUS.length}\n`);

// ── 2. model errors ─────────────────────────────────────────────────────────
console.log("## 2. Wrong v2 proposals: does code catch the model's error (correct runtime, or refusal)?\n");
for (const c of INTERPRETATION_CORPUS) for (const e of c.model_errors ?? []) {
  const o = evaluate(compileLeadMission, e.id, c.request, proposalFor(c, e.windows, "v2"), e.expect ?? c.expect, "v2", e.expect_refusal);
  const caught = e.detectable && o.ok && (!e.expect_change || o.changes.some((x) => e.expect_change!.test(x)));
  console.log(`${pad(e.id, 32)} ${e.detectable ? (caught ? "CAUGHT by code     " : "MISSED (defect!)   ") : "model error, code cannot see it"}  ${show(o)}`);
}

// ── 3. routing ──────────────────────────────────────────────────────────────
console.log("\n## 3. Routing per family\n");
for (const fam of ["gpt-5.6", "gpt-6"] as ModelFamilyId[]) {
  console.log(`### ${fam}`);
  for (const r of routingTable(fam)) {
    const e = escalationRoute(r.stage, "validator rejected", {}, fam);
    console.log(`  ${pad(r.stage, 34)} ${pad(r.model, 14)} effort ${pad(r.reasoning_effort, 5)} → ${e ? `${e.model} (${e.reasoning_effort})` : "no escalation"}`);
  }
}

// ── 4. cost ─────────────────────────────────────────────────────────────────
console.log("\n## 4. Estimated model cost per representative mission (re-priced recorded tokens)\n");
type Row = { role: string; model: string; input_tokens: number; cached_input_tokens: number; output_tokens: number };
const runs = ["run-4250f181", "run-1e52d43c"];
const familyModels: Record<string, { primary: string; escalation: string }> = {
  "gpt-5.6 (today)": { primary: "gpt-5.6-luna", escalation: "gpt-5.6-terra" },
  "gpt-6 Luna-first": { primary: "gpt-6-luna", escalation: "gpt-6.1-sol" },
  "Sol everywhere (for scale)": { primary: "gpt-6.1-sol", escalation: "gpt-6.1-sol" },
};
const price = (model: string, i: number, c: number, o: number, writes = 0) =>
  priceModelCall({ model, usage: { input_tokens: i, cached_input_tokens: c, output_tokens: o,
    ...(writes ? { cache_write_input_tokens: writes } : {}) } }).estimated_usd ?? 0;
for (const run of runs) {
  const rows: Row[] = JSON.parse(Deno.readTextFileSync(new URL(`../../tests/fixtures/lead-v2/${run}/lead_model_calls.json`, import.meta.url)));
  const tot = rows.reduce((a, r) => ({ i: a.i + r.input_tokens, c: a.c + (r.cached_input_tokens ?? 0), o: a.o + r.output_tokens }), { i: 0, c: 0, o: 0 });
  console.log(`${run}: ${rows.length} calls, ${tot.i} input (${tot.c} cached), ${tot.o} output tokens — recorded on ${rows[0]?.model}`);
  for (const [name, f] of Object.entries(familyModels)) {
    const base = rows.reduce((s, r) => s + price(f.primary, r.input_tokens, r.cached_input_tokens ?? 0, r.output_tokens), 0);
    // One escalation of the run's largest call, on the escalation model: the bounded worst case per escalation.
    const big = rows.reduce((m, r) => (r.input_tokens > m.input_tokens ? r : m), rows[0]);
    const oneEsc = price(f.escalation, big.input_tokens, 0, big.output_tokens);
    console.log(`  ${pad(name, 28)} ${usd(base)}   + ${usd(oneEsc)} per escalation of its largest call`);
  }
}

console.log("\nMission compilation call (one per mission), estimated from the payload (≈4 chars/token) + schema:");
for (const contract of ["v1", "v2"] as const) {
  const p = buildMissionCompilerPayload({
    originalUserQuery: INTERPRETATION_CORPUS[1].request, contract,
  });
  const userKey = "user_query";
  const fixedChars = JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => k !== userKey && k !== "company_brain_context"))).length;
  const allChars = JSON.stringify(p).length + JSON.stringify(gptMissionSchemaFor(contract)).length;
  const inTok = Math.round(allChars / 4);
  // v2 places every fixed part before the request, so a repeat call can be served
  // from the prompt cache; v1 interleaves the request early. Estimated, not measured.
  const cacheable = contract === "v2" ? Math.round(fixedChars / 4) : Math.round(JSON.stringify({
    schema_version: p.schema_version, agentory_briefing: p.agentory_briefing, instruction: p.instruction,
  }).length / 4);
  for (const m of ["gpt-5.6-luna", "gpt-6-luna", "gpt-6.1-sol"]) {
    console.log(`  ${contract} ${pad(m, 13)} ≈${inTok} in / 1500 out: cold ${usd(price(m, inTok, 0, 1500, Math.min(cacheable, inTok)))} (incl. the cache write, where priced), warm cache ≈${usd(price(m, inTok, Math.min(cacheable, inTok), 1500))}`);
  }
}
