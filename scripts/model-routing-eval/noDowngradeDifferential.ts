// NO-DOWNGRADE DIFFERENTIAL: contract v1 vs v2 over a request corpus. Pure, offline.
//
//   deno run --allow-read scripts/model-routing-eval/noDowngradeDifferential.ts <corpus.jsonl> [omitted|hiring|funding]
//
// <corpus.jsonl>: one JSON string (a user request) per line.
//   omitted  the model returns NO signal_windows (the worst case for a silent downgrade)
//   hiring   every timeframe in the request quoted verbatim and filed under hiring (review R1's shape)
//   funding  the same, filed under funding
// Each request's v2 hard criteria must equal v1's, be narrower, or the compile must be refused
// before spend. A DOWNGRADE (a hard requirement dropped, widened or unenforced) is a defect.

import * as C from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import * as E from "./interpretationCorpus.ts";
import * as T from "../../supabase/functions/_shared/missionInterpretationContract.ts";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const qs: string[] = Deno.readTextFileSync(Deno.args[0]).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const variant = Deno.args[1] ?? "omitted";
const hard = (m: Json) => new Map<string, Json>((m.criteria ?? []).filter((c: Json) => c.kind === "hard")
  .map((c: Json) => [`${c.dimension}|${JSON.stringify(c.dimension === "hiring" ? c.value?.qualifier ?? null : c.value)}`, c]));
const sigs = (m: Json) => (m.required_signals ?? []).map((s: Json) => `${s.event ?? s.type}:${s.timeframe_days ?? "-"}`).sort();
const tally: Record<string, number> = {};
const reasons: Record<string, number> = {};
const examples: Record<string, string[]> = {};
const bump = (k: string, ex?: string) => {
  tally[k] = (tally[k] ?? 0) + 1;
  if (ex && (examples[k] ??= []).length < 6) examples[k].push(ex);
};
for (const q of qs) {
  const p1 = E.baseProposal();
  const v1: Json = C.compileLeadMission({ originalUserQuery: q, proposal: p1, requestedCount: 5, contract: "v1" }).final_mission;
  const p2 = E.baseProposal(); p2.signal_windows = [];
  if (variant !== "omitted") {
    // Adversarial: every timeframe in the request quoted verbatim and filed under ONE event.
    p2.signal_windows = T.timeExpressionsIn(q.toLowerCase()).map((x: Json) => ({ event: variant, days: T.windowDaysOfPhrase(x.text), phrase: x.text, signal: null }));
  }
  let v2: Json;
  try { v2 = C.compileLeadMission({ originalUserQuery: q, proposal: p2, requestedCount: 5, contract: "v2" }).final_mission; }
  catch (e) {
    if (!(e as Json).reasons) throw e;
    bump("refused_before_spend");
    for (const r of (e as Json).reasons as string[]) { const k = r.replace(/:[^:]*$/, ""); reasons[k] = (reasons[k] ?? 0) + 1; }
    continue;
  }
  const a = hard(v1), b = hard(v2);
  const lines: string[] = [];
  let down = false, narrow = false;
  for (const [k, c] of a) {
    const d = b.get(k);
    if (!d) { down = true; lines.push(`DROPPED ${k}@${c.time_window?.days ?? "-"}`); continue; }
    const x = c.time_window?.days ?? null, y = d.time_window?.days ?? null;
    if (x !== y) {
      if (x != null && (y == null || y > x)) { down = true; lines.push(`WIDER ${k} ${x}→${y ?? "none"}`); }
      else { narrow = true; lines.push(`NARROWER ${k} ${x ?? "none"}→${y}`); }
    }
    if ((c.time_window?.enforced !== false) && d.time_window?.enforced === false) { down = true; lines.push(`UNENFORCED ${k}`); }
  }
  for (const k of b.keys()) if (!a.has(k)) { narrow = true; lines.push(`ADDED ${k}`); }
  const s1 = sigs(v1).join(","), s2 = sigs(v2).join(",");
  if (!lines.length && s1 === s2) { bump("identical"); continue; }
  if (!lines.length) { bump("hard_identical_runtime_signal_differs", `${q.slice(0, 100)}\n      v1 ${s1}\n      v2 ${s2}`); continue; }
  bump(down ? "DOWNGRADE" : narrow ? "narrower_or_added" : "other", `${q.slice(0, 100)}\n      ${lines.join("; ")}\n      v1 ${s1} | v2 ${s2}`);
}
console.log(JSON.stringify({ variant, total: qs.length, tally, refusal_reasons: reasons }, null, 1));
for (const [k, ex] of Object.entries(examples)) { console.log(`\n## ${k}`); for (const e of ex) console.log("  -", e); }
if (tally.DOWNGRADE) Deno.exit(1);
