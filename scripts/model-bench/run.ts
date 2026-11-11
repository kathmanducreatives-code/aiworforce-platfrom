// TERRA BENCHMARK HARNESS.
//
//   deno run --allow-read --allow-env scripts/model-bench/run.ts
//       DRY RUN (default). No network. Prints the task set, the candidate
//       matrix, and the MAXIMUM cost of one approved live run (every task ×
//       every candidate × REPEATS, every output at its cap, reasoning headroom).
//
//   ... run.ts --check-model gpt-6.1-terra      (needs --allow-net=api.openai.com)
//       AVAILABILITY CHECK. One GET /v1/models/<id> — a model-retrieval read,
//       not an inference call. Prints whether this account can see the id.
//
//   ... run.ts --score recorded.json
//       OFFLINE SCORING of outputs recorded elsewhere: [{task_id, model, output,
//       latency_ms?, input_tokens?, output_tokens?}]. No network.
//
//   ... run.ts --live --budget-usd 5.00
//       PAID. Refused unless AGENTORY_MODEL_BENCH_APPROVED equals
//       "I approve paid model benchmark spend up to $<budget>" AND the dry-run
//       maximum fits inside the budget. Stops once measured spend reaches it.

import { BENCH_TASKS, type BenchTask } from "./tasks.ts";
import { estimateTokens, scoreOutput } from "./scorers.ts";
import { LIST_PRICES } from "./prices.ts";
import { priceModelCall, readModelUsage } from "../../supabase/functions/_shared/modelCostModel.ts";

export type Effort = "none" | "low" | "medium";
export interface Candidate { id: string; model: string; vendor: "openai" | "anthropic"; effort: Effort | null; role: string }

/** The comparison matrix (Terra audit §5). Current routes first, then GPT-6.x alternatives. */
export const BENCH_CANDIDATES: readonly Candidate[] = [
  { id: "haiku-4.5", model: "claude-haiku-4-5-20251001", vendor: "anthropic", effort: null, role: "current: chat replies, planning, ORION wording, LYRA" },
  { id: "luna-5.6", model: "gpt-5.6-luna", vendor: "openai", effort: "none", role: "current: understanding, ATLAS, LISA" },
  { id: "terra-5.6", model: "gpt-5.6-terra", vendor: "openai", effort: "low", role: "current: validator repair" },
  { id: "terra-6.1-none", model: "gpt-6.1-terra", vendor: "openai", effort: "none", role: "candidate" },
  { id: "terra-6.1-low", model: "gpt-6.1-terra", vendor: "openai", effort: "low", role: "candidate" },
  { id: "terra-6.1-medium", model: "gpt-6.1-terra", vendor: "openai", effort: "medium", role: "candidate (default effort)" },
  { id: "luna-6", model: "gpt-6-luna", vendor: "openai", effort: "none", role: "alternative cheap base" },
  { id: "haiku-5.5", model: "claude-haiku-5-5", vendor: "anthropic", effort: null, role: "alternative cheap prose" },
];
export const REPEATS = 3;
/** Reasoning headroom for the CAP only: output cap × this, billed as output. */
const CAP_REASONING: Record<string, number> = { none: 0, low: 2, medium: 4 };

type Read = (k: string) => string | undefined;

/** Maximum cost of one pass of every task on one candidate (inputs estimated, outputs at cap). */
export function maxPassCost(c: Candidate, tasks: readonly BenchTask[] = BENCH_TASKS): number {
  const p = LIST_PRICES[c.model];
  if (!p) return Infinity;
  let usd = 0;
  for (const t of tasks) {
    const outCap = t.maxOutputTokens * (1 + CAP_REASONING[c.effort ?? "none"]);
    usd += (estimateTokens(t.system + t.user) * p.input + outCap * p.output) / 1e6;
  }
  return usd;
}
export function maxRunCost(cands: readonly Candidate[] = BENCH_CANDIDATES, repeats = REPEATS): number {
  return cands.reduce((s, c) => s + maxPassCost(c) * repeats, 0);
}

export function liveApproval(budget: number, read: Read): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(budget) || budget <= 0) return { ok: false, reason: "--budget-usd must be a positive number" };
  const want = `I approve paid model benchmark spend up to $${budget.toFixed(2)}`;
  if (read("AGENTORY_MODEL_BENCH_APPROVED") !== want) {
    return { ok: false, reason: `refused: set AGENTORY_MODEL_BENCH_APPROVED="${want}" for this one invocation` };
  }
  return { ok: true };
}

/** The request body for one candidate. GPT-5/6: reasoning_effort + max_completion_tokens, no temperature. */
export function openaiBody(c: Candidate, t: BenchTask): Record<string, unknown> {
  return {
    model: c.model,
    messages: [{ role: "system", content: t.system }, { role: "user", content: t.user }],
    ...(c.effort ? { reasoning_effort: c.effort } : {}),
    max_completion_tokens: t.maxOutputTokens * (1 + CAP_REASONING[c.effort ?? "none"]),
    ...(t.jsonKeys ? { response_format: { type: "json_object" } } : {}),
  };
}

async function checkModel(id: string): Promise<void> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) { console.log(`check-model: OPENAI_API_KEY not set — cannot verify ${id}`); Deno.exit(2); }
  const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` } });
  await res.body?.cancel();
  console.log(res.ok
    ? `check-model: ${id} IS visible to this API project (HTTP ${res.status}).`
    : `check-model: ${id} is NOT visible to this API project (HTTP ${res.status}).`);
  Deno.exit(res.ok ? 0 : 1);
}

function scoreFile(path: string): void {
  const rows = JSON.parse(Deno.readTextFileSync(path)) as Array<{
    task_id: string; model: string; output: string; latency_ms?: number; input_tokens?: number; output_tokens?: number;
  }>;
  for (const r of rows) {
    const t = BENCH_TASKS.find((x) => x.id === r.task_id);
    if (!t) { console.log(`skip: unknown task ${r.task_id}`); continue; }
    console.log(JSON.stringify({ model: r.model, latency_ms: r.latency_ms ?? null,
      tokens: { input: r.input_tokens ?? null, output: r.output_tokens ?? null }, ...scoreOutput(t, r.output) }));
  }
}

function listCost(model: string, inTok: number, outTok: number): number {
  const p = LIST_PRICES[model];
  return p ? (inTok * p.input + outTok * p.output) / 1e6 : NaN;
}

async function live(budget: number): Promise<void> {
  const read: Read = (k) => Deno.env.get(k);
  const gate = liveApproval(budget, read);
  if (!gate.ok) { console.error(gate.reason); Deno.exit(3); }
  const max = maxRunCost();
  if (max > budget) { console.error(`refused: maximum $${max.toFixed(2)} exceeds budget $${budget}`); Deno.exit(3); }
  const okey = Deno.env.get("OPENAI_API_KEY"), akey = Deno.env.get("ANTHROPIC_API_KEY");
  let spent = 0;
  for (let rep = 0; rep < REPEATS; rep++) for (const c of BENCH_CANDIDATES) for (const t of BENCH_TASKS) {
    if (c.vendor === "openai" && !okey) { console.log(JSON.stringify({ candidate: c.id, skipped: "no OPENAI_API_KEY" })); continue; }
    if (c.vendor === "anthropic" && !akey) { console.log(JSON.stringify({ candidate: c.id, skipped: "no ANTHROPIC_API_KEY" })); continue; }
    const started = Date.now();
    let output = "", inTok = 0, outTok = 0, reasoning: number | null = null, status = 0;
    if (c.vendor === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${okey}` }, body: JSON.stringify(openaiBody(c, t)) });
      status = res.status;
      const data = await res.json().catch(() => null);
      output = data?.choices?.[0]?.message?.content ?? "";
      const u = readModelUsage(data);
      inTok = u.input_tokens ?? 0; outTok = u.output_tokens ?? 0;
      reasoning = data?.usage?.completion_tokens_details?.reasoning_tokens ?? null;
      void priceModelCall;
    } else {
      const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": akey!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: c.model, max_tokens: t.maxOutputTokens, system: t.system, messages: [{ role: "user", content: t.user }] }) });
      status = res.status;
      const data = await res.json().catch(() => null);
      output = (data?.content ?? []).map((x: { text?: string }) => x?.text ?? "").join("");
      inTok = data?.usage?.input_tokens ?? 0; outTok = data?.usage?.output_tokens ?? 0;
    }
    const cost = listCost(c.model, inTok, outTok);
    spent += Number.isFinite(cost) ? cost : 0;
    console.log(JSON.stringify({ rep, candidate: c.id, model: c.model, effort: c.effort, task: t.id, category: t.category ?? null,
      http: status, latency_ms: Date.now() - started, input_tokens: inTok, output_tokens: outTok, reasoning_tokens: reasoning,
      cost_usd: cost, ...scoreOutput(t, output), output }));
    if (spent >= budget) { console.error(`stopped: budget $${budget} reached`); return; }
  }
}

if (import.meta.main) {
  const a = Deno.args;
  const at = (f: string) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  if (a.includes("--check-model")) await checkModel(at("--check-model") ?? "gpt-6.1-terra");
  else if (a.includes("--score")) scoreFile(at("--score")!);
  else if (a.includes("--live")) await live(Number(at("--budget-usd")));
  else {
    console.log(`DRY RUN — ${BENCH_TASKS.length} fictional tasks × ${BENCH_CANDIDATES.length} candidates × ${REPEATS} repeats = ${BENCH_TASKS.length * BENCH_CANDIDATES.length * REPEATS} calls. No network.`);
    for (const t of BENCH_TASKS) console.log(`  ${t.id.padEnd(20)} ${(t.category ?? "").padEnd(20)} ~${estimateTokens(t.system + t.user)} in / ≤${t.maxOutputTokens} out`);
    for (const c of BENCH_CANDIDATES) console.log(`  ${c.id.padEnd(18)} ${c.model.padEnd(28)} effort ${String(c.effort ?? "-").padEnd(6)} max/pass $${maxPassCost(c).toFixed(4)}  (${c.role})`);
    console.log(`MAXIMUM for the full live run: $${maxRunCost().toFixed(2)}`);
    console.log("Live benchmark NOT executed: paid spend requires an approved budget (--live --budget-usd + AGENTORY_MODEL_BENCH_APPROVED).");
  }
}
