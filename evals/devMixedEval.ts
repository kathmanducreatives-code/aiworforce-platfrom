// DEVELOPMENT RUNNER — iterate here, never against the held-out suite.
//
//   deno run --allow-net --allow-env --allow-read evals/devMixedEval.ts
//
// Reports each part's objective in order, because the weakness is per-part:
// the whole request's objective can be right while the first part's is wrong.
import { understandRequest } from "../supabase/functions/_shared/chatBrain.ts";

const SUITE = JSON.parse(await Deno.readTextFile(
  new URL("./fixtures/devMixedDecomposition.json", import.meta.url)));
const deps = { readEnv: (k: string) => Deno.env.get(k) };

let pass = 0;
for (const c of SUITE.cases) {
  const out = await understandRequest(c.utterance, {}, deps);
  if (!out.ok) { console.log(`  FAIL refused        ${c.utterance}`); continue; }
  const got = out.request.parts.map((p) => p.objective);
  const want: string[] = c.objectives;
  // ORDER MATTERS. `read+source` becoming `source+read` is still wrong: the
  // dependent part would run first.
  const ok = got.length === want.length && want.every((w, i) => got[i] === w);
  const dep = out.request.parts.some((p) => (p.depends_on ?? []).length > 0);
  const depOk = !c.dependent || dep;
  if (ok && depOk) pass++;
  console.log(`  ${ok && depOk ? "ok  " : "FAIL"} want ${want.join("+").padEnd(18)} got ${got.join("+").padEnd(18)} dep=${dep} ${c.note ? "[" + c.note.slice(0, 24) + "]" : ""}`);
  if (!(ok && depOk)) console.log(`       ${c.utterance}`);
}
console.log(`\n  dev set: ${pass}/${SUITE.cases.length}`);
