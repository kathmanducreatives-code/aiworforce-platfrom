// TERRA BENCHMARK HARNESS.
//
//   deno run --allow-read --allow-env scripts/model-bench/run.ts
//       DRY RUN (default). No network. Prints the task set, the candidate
//       models, and an upper-bound cost estimate for one live pass.
//
//   ... run.ts --check-model gpt-6.1-terra      (needs --allow-net=api.openai.com)
//       AVAILABILITY CHECK. One GET /v1/models/<id> (model retrieval is not a
//       billed call). Prints whether this account can see the id. This is what
//       an operator runs before setting AGENTORY_TERRA_MODEL_VERIFIED=true.
//
//   ... run.ts --score recorded.json
//       OFFLINE SCORING of outputs recorded elsewhere: [{task_id, model, output,
//       latency_ms?, input_tokens?, output_tokens?}]. No network.
//
//   ... run.ts --live --budget-usd 2.00
//       PAID. Refused unless AGENTORY_MODEL_BENCH_APPROVED equals
//       "I approve paid model benchmark spend up to $<budget>" AND the dry-run
//       upper bound fits inside the budget. Stops once the budget is reached.
//       NOT RUN in Workforce V2: the spending scope has not been approved.

import { BENCH_TASKS, type BenchTask } from "./tasks.ts";
import { estimateTokens, scoreOutput } from "./scorers.ts";
import { MODEL_PRICES, priceModelCall, readModelUsage } from "../../supabase/functions/_shared/modelCostModel.ts";
import { terraModelId, terraPrice } from "../../supabase/functions/_shared/terraPolicy.ts";
import { openAIChatBody } from "../../supabase/functions/_shared/aiProvider.ts";

export const BENCH_CANDIDATES = [
  "claude-haiku-4-5-20251001", "gpt-5.6-luna", "gpt-6.1-sol", "gpt-5.6-terra", "gpt-6.1-terra",
] as const;

type Read = (k: string) => string | undefined;
export interface CostEstimate { model: string; priced: boolean; upper_bound_usd: number | null }

/** Upper bound for one pass: each task's estimated input plus twice its output cap (reasoning headroom). */
export function estimatePass(model: string, tasks: readonly BenchTask[] = BENCH_TASKS, read: Read = () => undefined): CostEstimate {
  const p = MODEL_PRICES[model] ?? (model === terraModelId(read) ? terraPrice(read) : null);
  if (!p) return { model, priced: false, upper_bound_usd: null };
  let usd = 0;
  for (const t of tasks) {
    usd += estimateTokens(t.system + t.user) / 1e6 * p.input_per_1m;
    usd += (t.maxOutputTokens * 2) / 1e6 * p.output_per_1m;
  }
  return { model, priced: true, upper_bound_usd: Math.round(usd * 10000) / 10000 };
}

export function liveApproval(budget: number, read: Read): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(budget) || budget <= 0) return { ok: false, reason: "--budget-usd must be a positive number" };
  const want = `I approve paid model benchmark spend up to $${budget.toFixed(2)}`;
  if (read("AGENTORY_MODEL_BENCH_APPROVED") !== want) {
    return { ok: false, reason: `refused: set AGENTORY_MODEL_BENCH_APPROVED="${want}" for this one invocation` };
  }
  return { ok: true };
}

async function checkModel(id: string): Promise<void> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) { console.log(`check-model: OPENAI_API_KEY not set — cannot verify ${id}`); Deno.exit(2); }
  const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  await res.body?.cancel();
  console.log(res.ok
    ? `check-model: ${id} IS available to this account (HTTP ${res.status}). Next: confirm its published price and request shape.`
    : `check-model: ${id} is NOT available (HTTP ${res.status}). Leave AGENTORY_TERRA_MODEL_VERIFIED unset.`);
  Deno.exit(res.ok ? 0 : 1);
}

function scoreFile(path: string): void {
  const rows = JSON.parse(Deno.readTextFileSync(path)) as Array<{
    task_id: string; model: string; output: string; latency_ms?: number; input_tokens?: number; output_tokens?: number;
  }>;
  for (const r of rows) {
    const t = BENCH_TASKS.find((x) => x.id === r.task_id);
    if (!t) { console.log(`skip: unknown task ${r.task_id}`); continue; }
    const cost = priceModelCall({
      model: r.model,
      usage: readModelUsage({ usage: { prompt_tokens: r.input_tokens, completion_tokens: r.output_tokens } }),
    });
    console.log(JSON.stringify({
      model: r.model, latency_ms: r.latency_ms ?? null,
      tokens: { input: r.input_tokens ?? null, output: r.output_tokens ?? null },
      cost_usd: cost.estimated_usd ?? cost.actual_usd, cost_source: cost.source, ...scoreOutput(t, r.output),
    }));
  }
}

async function live(budget: number): Promise<void> {
  const read: Read = (k) => Deno.env.get(k);
  const gate = liveApproval(budget, read);
  if (!gate.ok) { console.error(gate.reason); Deno.exit(3); }
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) { console.error("OPENAI_API_KEY not set"); Deno.exit(2); }
  const models = BENCH_CANDIDATES.filter((m) => m.startsWith("gpt-"))
    .map((m) => m === "gpt-6.1-terra" ? terraModelId(read) : m);
  const total = models.reduce((s, m) => s + (estimatePass(m, BENCH_TASKS, read).upper_bound_usd ?? Infinity), 0);
  if (total > budget) {
    console.error(`refused: upper-bound estimate $${total} exceeds budget $${budget} (an unpriced model counts as unbounded)`);
    Deno.exit(3);
  }
  let spent = 0;
  for (const model of models) {
    for (const t of BENCH_TASKS) {
      const started = Date.now();
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(openAIChatBody(model,
          [{ role: "system", content: t.system }, { role: "user", content: t.user }],
          { maxTokens: t.maxOutputTokens, jsonMode: !!t.jsonKeys })),
      });
      const data = await res.json().catch(() => null);
      const cost = priceModelCall({ model, usage: readModelUsage(data) });
      spent += cost.estimated_usd ?? cost.actual_usd ?? 0;
      const output = data?.choices?.[0]?.message?.content ?? "";
      console.log(JSON.stringify({
        model, http: res.status, latency_ms: Date.now() - started, usage: data?.usage ?? null,
        cost_usd: cost.estimated_usd ?? cost.actual_usd, ...scoreOutput(t, output),
      }));
      if (spent >= budget) { console.error(`stopped: budget $${budget} reached`); return; }
    }
  }
}

if (import.meta.main) {
  const a = Deno.args;
  const at = (f: string) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  if (a.includes("--check-model")) await checkModel(at("--check-model") ?? "gpt-6.1-terra");
  else if (a.includes("--score")) scoreFile(at("--score")!);
  else if (a.includes("--live")) await live(Number(at("--budget-usd")));
  else {
    const read: Read = (k) => Deno.env.get(k);
    console.log(`DRY RUN — ${BENCH_TASKS.length} fictional tasks, no network.`);
    for (const t of BENCH_TASKS) {
      console.log(`  ${t.id.padEnd(16)} ${t.task.padEnd(22)} ~${estimateTokens(t.system + t.user)} in / ≤${t.maxOutputTokens} out`);
    }
    for (const m of BENCH_CANDIDATES) {
      const e = estimatePass(m === "gpt-6.1-terra" ? terraModelId(read) : m, BENCH_TASKS, read);
      console.log(`  ${e.model.padEnd(28)} ${e.priced ? `≤ $${e.upper_bound_usd} per pass` : "UNPRICED — set AGENTORY_TERRA_PRICE_USD_PER_1M before any live run"}`);
    }
    console.log("Live benchmark NOT executed: paid spend requires an approved budget (--live --budget-usd + AGENTORY_MODEL_BENCH_APPROVED).");
  }
}
