// DIAGNOSTIC · HOW STABLE IS CHAT BRAIN'S READING OF THE SAME TURN?
//
// Replays the exact conversation that preceded a live-test turn (from your local
// r11/r12 transcript) and asks ONLY the understanding model (Chat Brain, GPT-5.6
// Luna) to read the turn N times. No answers are generated, nothing is written,
// no Supabase project is touched. Prints the distribution of readings: objective,
// parts, back-references (kind / cardinality / value) and blocking ambiguities.
//
// Costs OpenAI money (about $0.0005–0.001 per reading). Hard-capped: it stops
// BEFORE a call that could cross the cap. Defaults: 5 repetitions, $0.05 cap;
// maximums: 10 repetitions, $0.10. Never prints the key.
//
//   deno run --allow-env --allow-net=api.openai.com --allow-read \
//     scripts/orion-pilot/understanding-variance.ts --dry-run --transcript r12-transcript.json --turns 4,12
//   ORION_VARIANCE_APPROVED="I approve up to \$0.05 of understanding-variance calls" OPENAI_API_KEY=… \
//   deno run --allow-env --allow-net=api.openai.com --allow-read \
//     scripts/orion-pilot/understanding-variance.ts --transcript r12-transcript.json --turns 4,12 --reps 5
import { understandRequest } from "../../supabase/functions/_shared/chatBrain.ts";
import { TURN_LOOKBACK, TURN_MAX_CHARS } from "../../supabase/functions/_shared/conversationTurns.ts";

const arg = (k: string, d: string) => Deno.args.includes(k) ? Deno.args[Deno.args.indexOf(k) + 1] : d;
const transcriptPath = arg("--transcript", "r12-transcript.json");
const turns = arg("--turns", "4,12").split(",").map((x) => Number(x.trim())).filter((n) => n > 0);
const reps = Math.min(Math.max(Number(arg("--reps", "5")), 1), 10);
const capUsd = Math.min(Math.max(Number(arg("--cap", "0.05")), 0.01), 0.10);
const PER_CALL_WORST_USD = 0.003; // a reading plus one repair attempt, generous
const APPROVAL = `I approve up to $${capUsd.toFixed(2)} of understanding-variance calls`;

type Turn = { n?: number; prompt?: string; answer?: string };
const transcript = (JSON.parse(await Deno.readTextFile(transcriptPath)) as Turn[]).filter((t) => typeof t.n === "number");

function contextFor(n: number) {
  const prior = transcript.filter((t) => (t.n as number) < n).sort((a, b) => (a.n as number) - (b.n as number));
  const turnsOut: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const t of prior) {
    if (t.prompt) turnsOut.push({ role: "user", content: t.prompt.slice(0, TURN_MAX_CHARS) });
    if (t.answer) turnsOut.push({ role: "assistant", content: t.answer.slice(0, TURN_MAX_CHARS) });
  }
  return turnsOut.slice(-TURN_LOOKBACK);
}

const plan = turns.map((n) => ({ n, turn: transcript.find((t) => t.n === n) }));
for (const p of plan) if (!p.turn?.prompt) { console.error(`refusing: turn ${p.n} not found in ${transcriptPath}`); Deno.exit(2); }
console.log(`turns ${turns.join(", ")} × ${reps} repetitions = ${turns.length * reps} readings; worst case $${(turns.length * reps * PER_CALL_WORST_USD).toFixed(3)}, hard cap $${capUsd.toFixed(2)}`);
if (Deno.args.includes("--dry-run")) {
  for (const p of plan) console.log(`\n#${p.n}: ${p.turn!.prompt!.slice(0, 100)}\n  context: ${contextFor(p.n).length} prior messages`);
  Deno.exit(0);
}
if (Deno.env.get("ORION_VARIANCE_APPROVED") !== APPROVAL) { console.error(`refusing: set ORION_VARIANCE_APPROVED="${APPROVAL}"`); Deno.exit(2); }
if (!Deno.env.get("OPENAI_API_KEY")) { console.error("refusing: OPENAI_API_KEY is not set"); Deno.exit(2); }

let spent = 0;
const results: unknown[] = [];
outer: for (const p of plan) {
  const tally = new Map<string, number>();
  for (let i = 0; i < reps; i++) {
    if (spent + PER_CALL_WORST_USD > capUsd) { console.log(`STOPPED at the $${capUsd.toFixed(2)} cap (spent $${spent.toFixed(4)})`); break outer; }
    const u = await understandRequest(p.turn!.prompt!, { conversation: contextFor(p.n) }, {
      readEnv: (k) => Deno.env.get(k),
      onModelCall: (t) => { spent += Number(t.actual_cost_usd ?? t.estimated_cost_usd ?? PER_CALL_WORST_USD); },
    });
    const reading = !u.ok ? `UNREADABLE(${u.reason})` : JSON.stringify({
      objective: u.request.objective,
      parts: u.request.parts.map((x) => ({
        objective: x.objective, entity: x.subject.entity,
        references: (x.subject.references ?? []).map((r) => ({ kind: r.kind, cardinality: r.cardinality ?? null, value: r.value })),
      })),
      blocking: u.request.ambiguity.filter((a) => a.blocking).map((a) => a.field),
    });
    tally.set(reading, (tally.get(reading) ?? 0) + 1);
  }
  console.log(`\n#${p.n}: ${p.turn!.prompt!.slice(0, 90)}`);
  for (const [reading, count] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${count}× ${reading}`);
  results.push({ n: p.n, readings: Object.fromEntries(tally) });
}
await Deno.writeTextFile("understanding-variance.json", JSON.stringify({ spent_usd: spent, reps, results }, null, 2));
console.log(`\nspent $${spent.toFixed(4)} of $${capUsd.toFixed(2)}; wrote understanding-variance.json`);
