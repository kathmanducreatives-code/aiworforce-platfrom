// WHAT PRODUCTION ACTUALLY DOES WITH ONE MESSAGE PER OBJECTIVE.
//
// Runs the real chain — Chat Brain → objective router → pilot-chat binding —
// and stops at the binding. Nothing is executed and nothing is bought: the
// binding is where `pilot-chat` would hand off, and this reports it instead.
import { understandRequest } from "../supabase/functions/_shared/chatBrain.ts";
import { routeRequest } from "../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../supabase/functions/_shared/chatBrainBinding.ts";

const deps = { readEnv: (k: string) => Deno.env.get(k) };
const CASES: Array<[string, string]> = [
  ["converse",  "Do you think my ICP is too broad?"],
  ["read",      "What are my strongest signals?"],
  ["research",  "Check whether Vercel is recruiting."],
  ["source",    "Find 3 B2B SaaS companies hiring SDRs."],
  ["monitor",   "Keep watching Vercel."],
  ["compose",   "Turn that into a LinkedIn post."],
  ["mixed",     "Find recently funded recruiting agencies and give me 3 post ideas."],
  ["mixed",     "Show me my saved companies and then find more like them."],
  ["ambiguous", "Monitor them."],
];

console.log("label      objective   parts                route         binding    spend  outcome");
console.log("─".repeat(112));
for (const [label, utterance] of CASES) {
  const out = await understandRequest(utterance, {}, deps);
  if (!out.ok) {
    console.log(`${label.padEnd(10)} ${"REFUSED".padEnd(11)} ${out.reason}`);
    continue;
  }
  const route = routeRequest(out.request, { spendAllowed: true, confirmationRequired: true });
  const bind = bindRoute(route);
  const parts = out.request.parts.map((p) => p.objective).join("+");
  const outcome = bind.kind === "category" ? `→ ${bind.category}`
    : bind.kind === "reply" ? `↩ "${(bind.message ?? "").slice(0, 34)}…"`
    : bind.kind === "read" ? "▤ read surface (no provider)"
    : bind.kind === "monitor" ? "◷ monitor surface (records only)"
    : `⤵ old classifier (${bind.reason})`;
  console.log(
    `${label.padEnd(10)} ${out.request.objective.padEnd(11)} ${parts.padEnd(20)} ` +
    `${route.kind.padEnd(13)} ${bind.kind.padEnd(10)} ${String(route.may_spend).padEnd(6)} ${outcome}`);
  console.log(`           "${utterance}"`);
}
