// TERRA HYBRID BENCHMARK HARNESS.
//
//   deno run --allow-read --allow-env scripts/model-bench/run.ts [--stage 1|2]
//       DRY RUN (default). No network. Prints the matrix and the HARD MAXIMUM.
//
//   ... run.ts --manifest 1|2 > manifest.json
//       The exact run: models, efforts, prompts (+ sha256), repeats, per-call and
//       total hard maxima, cap and approval string. No network.
//
//   ... run.ts --check-model gpt-6.1-terra      (needs --allow-net=api.openai.com)
//       AVAILABILITY CHECK. One GET /v1/models/<id> — model retrieval, not inference.
//
//   ... run.ts --score recorded.json | --summarize results.jsonl
//       OFFLINE scoring / per-candidate summary (success rate, cost per success).
//
//   ... run.ts --live --stage 1 --budget-usd 2.00
//       PAID. Refused unless AGENTORY_MODEL_BENCH_APPROVED equals
//       "I approve paid model benchmark spend up to $<budget> for stage <n>"
//       AND the stage's HARD MAXIMUM fits the budget.
//
// ── WHY THE CAP CANNOT BE EXCEEDED ──────────────────────────────────────────
//   * Every call's cost is bounded BEFORE it is sent: input ≤ one token per
//     character of the prompt + 100 tokens of message overhead (a token is never
//     shorter than one character), output ≤ the hard output cap sent with the
//     request (`max_completion_tokens`, which includes reasoning; Anthropic
//     `max_tokens`, which includes thinking). Priced by the runtime cost model,
//     long-prompt surcharges included.
//   * Admission: a call is sent only if (spent so far + its hard bound) ≤ budget.
//   * Fail-closed accounting: a call whose usage is missing is charged its bound.
//   * NO RETRIES: one HTTP request per (candidate, task, repeat). A failure is
//     recorded and the run moves on.
//   So total spend ≤ Σ hard bounds ≤ budget, whatever the providers return.

import { BENCH_TASKS, type BenchTask } from "./tasks.ts";
import { scoreOutput } from "./scorers.ts";
import { MODEL_PRICES, priceModelCall, readModelUsage } from "../../supabase/functions/_shared/modelCostModel.ts";
import { getAgentorySystemPrompt } from "../../supabase/functions/_shared/agentorySystemPrompt.ts";

export type Effort = "none" | "low" | "medium";
export interface Candidate { id: string; model: string; vendor: "openai" | "anthropic"; effort: Effort | null; role: string }

/** The comparison matrix. Current routes first, then GPT-6.x / Claude 5.5 alternatives (prices verified 2026-11-11). */
export const BENCH_CANDIDATES: readonly Candidate[] = [
  { id: "haiku-4.5", model: "claude-haiku-4-5-20251001", vendor: "anthropic", effort: null, role: "current: chat replies, planning, ORION wording, LYRA" },
  { id: "luna-5.6", model: "gpt-5.6-luna", vendor: "openai", effort: "none", role: "current: understanding, ATLAS, LISA" },
  { id: "terra-5.6", model: "gpt-5.6-terra", vendor: "openai", effort: "low", role: "current: validator repair" },
  { id: "terra-6.1-none", model: "gpt-6.1-terra", vendor: "openai", effort: "none", role: "candidate" },
  { id: "terra-6.1-low", model: "gpt-6.1-terra", vendor: "openai", effort: "low", role: "candidate" },
  { id: "terra-6.1-medium", model: "gpt-6.1-terra", vendor: "openai", effort: "medium", role: "candidate (OpenAI default effort)" },
  { id: "luna-6", model: "gpt-6-luna", vendor: "openai", effort: "none", role: "alternative cheap base" },
  { id: "haiku-5.5", model: "claude-haiku-5-5", vendor: "anthropic", effort: null, role: "alternative cheap prose (adaptive thinking, default effort)" },
];
export const REPEATS = 3;
/** Output cap multiplier per effort — reasoning tokens count against the cap. Anthropic: 2x for adaptive thinking. */
const OUTPUT_CAP_MULT: Record<string, number> = { none: 1, low: 2, medium: 4, anthropic: 2 };
export const STAGE_CAPS_USD: Readonly<Record<1 | 2, number>> = { 1: 2, 2: 5 };

type Read = (k: string) => string | undefined;

/** The hard output cap sent with the request for this candidate and task. */
export function outputCap(c: Candidate, t: BenchTask): number {
  return t.maxOutputTokens * OUTPUT_CAP_MULT[c.vendor === "anthropic" ? "anthropic" : (c.effort ?? "none")];
}

/** Stage 2: the same tasks inside Agentory's REAL system prompts (production-size inputs). */
export function stageTasks(stage: 1 | 2): readonly BenchTask[] {
  if (stage === 1) return BENCH_TASKS;
  const prefix = (t: BenchTask): string => {
    switch (t.category) {
      case "planning": return getAgentorySystemPrompt({ taskType: "planning", currentAgent: "orion" });
      case "lead_research": return getAgentorySystemPrompt({ taskType: "agent_execution", currentAgent: "atlas" });
      case "market_signal": return getAgentorySystemPrompt({ taskType: "agent_execution", currentAgent: "lisa" });
      case "content": return getAgentorySystemPrompt({ taskType: "agent_execution", currentAgent: "lyra" });
      default: return getAgentorySystemPrompt({ taskType: "pilot_router", currentAgent: "orion" });
    }
  };
  return BENCH_TASKS.map((t) => ({ ...t, id: `${t.id}@prod`, system: `${prefix(t)}\n\n${t.system}` }));
}

/** HARD upper bound on one call's cost (see header). Infinity for an unpriced model. */
export function hardCallBound(c: Candidate, t: BenchTask): number {
  if (!MODEL_PRICES[c.model]) return Infinity;
  const input = t.system.length + t.user.length + 100;
  const p = priceModelCall({ model: c.model, usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: outputCap(c, t) } });
  return p.estimated_usd ?? Infinity;
}
export function hardRunBound(stage: 1 | 2 = 1, cands: readonly Candidate[] = BENCH_CANDIDATES, repeats = REPEATS): number {
  const tasks = stageTasks(stage);
  return cands.reduce((s, c) => s + tasks.reduce((a, t) => a + hardCallBound(c, t), 0) * repeats, 0);
}
/** Legacy names (dfacbb2c). */
export const maxPassCost = (c: Candidate) => BENCH_TASKS.reduce((a, t) => a + hardCallBound(c, t), 0);
export const maxRunCost = (cands: readonly Candidate[] = BENCH_CANDIDATES, repeats = REPEATS) => hardRunBound(1, cands, repeats);

export const approvalString = (budget: number, stage: 1 | 2) =>
  `I approve paid model benchmark spend up to $${budget.toFixed(2)} for stage ${stage}`;
export function liveApproval(budget: number, read: Read, stage: 1 | 2 = 1): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(budget) || budget <= 0) return { ok: false, reason: "--budget-usd must be a positive number" };
  if (budget > STAGE_CAPS_USD[stage]) return { ok: false, reason: `refused: stage ${stage} is capped at $${STAGE_CAPS_USD[stage]}` };
  const want = approvalString(budget, stage);
  if (read("AGENTORY_MODEL_BENCH_APPROVED") !== want) return { ok: false, reason: `refused: set AGENTORY_MODEL_BENCH_APPROVED="${want}" for this one invocation` };
  const bound = hardRunBound(stage);
  if (bound > budget) return { ok: false, reason: `refused: hard maximum $${bound.toFixed(4)} exceeds budget $${budget}` };
  return { ok: true };
}

/** The OpenAI request body for one candidate. GPT-5/6: reasoning_effort + max_completion_tokens, no temperature. */
export function openaiBody(c: Candidate, t: BenchTask): Record<string, unknown> {
  return {
    model: c.model,
    messages: [{ role: "system", content: t.system }, { role: "user", content: t.user }],
    ...(c.effort ? { reasoning_effort: c.effort } : {}),
    max_completion_tokens: outputCap(c, t),
    ...(t.jsonKeys ? { response_format: { type: "json_object" } } : {}),
  };
}
export function anthropicBody(c: Candidate, t: BenchTask): Record<string, unknown> {
  return { model: c.model, max_tokens: outputCap(c, t), system: t.system, messages: [{ role: "user", content: t.user }] };
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function manifest(stage: 1 | 2): Promise<Record<string, unknown>> {
  const tasks = stageTasks(stage);
  const bound = hardRunBound(stage);
  return {
    manifest_version: "terra-bench-manifest-v1", stage, generated_offline: true,
    cap_usd: STAGE_CAPS_USD[stage], hard_maximum_usd: Number(bound.toFixed(4)), fits_cap: bound <= STAGE_CAPS_USD[stage],
    repeats: REPEATS, calls: tasks.length * BENCH_CANDIDATES.length * REPEATS, retries: 0,
    approval_env: "AGENTORY_MODEL_BENCH_APPROVED", approval_value: approvalString(STAGE_CAPS_USD[stage], stage),
    command: `AGENTORY_MODEL_BENCH_APPROVED="${approvalString(STAGE_CAPS_USD[stage], stage)}" deno run --allow-read --allow-env --allow-net=api.openai.com,api.anthropic.com scripts/model-bench/run.ts --live --stage ${stage} --budget-usd ${STAGE_CAPS_USD[stage].toFixed(2)} > bench-stage${stage}.jsonl`,
    prices: Object.fromEntries(BENCH_CANDIDATES.map((c) => [c.model, MODEL_PRICES[c.model]])),
    candidates: BENCH_CANDIDATES.map((c) => ({ ...c,
      hard_max_per_pass_usd: Number(tasks.reduce((a, t) => a + hardCallBound(c, t), 0).toFixed(5)) })),
    tasks: await Promise.all(tasks.map(async (t) => ({
      id: t.id, category: t.category ?? null, workforce_task: t.task, max_output_tokens: t.maxOutputTokens,
      json_keys: t.jsonKeys, must_mention: t.mustMention ?? null, must_not_recommend: t.mustNotRecommend ?? null,
      max_words: t.maxWords ?? null, system_chars: t.system.length, user_chars: t.user.length,
      sha256: await sha256(t.system + "\u0000" + t.user), system: t.system, user: t.user,
    }))),
    scoring: ["structured_valid", "icp_violations", "suspected_hallucinations", "citations.accuracy", "required_points",
      "forbidden_recommendations", "within_word_limit", "success", "latency_ms", "input/output/reasoning tokens", "cost_usd",
      "cost_per_success (via --summarize)", "blind human grade for correctness and reasoning quality"],
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
  const rows = JSON.parse(Deno.readTextFileSync(path)) as Array<{ task_id: string; model: string; output: string; latency_ms?: number }>;
  const all = [...stageTasks(1), ...stageTasks(2)];
  for (const r of rows) {
    const t = all.find((x) => x.id === r.task_id);
    if (!t) { console.log(`skip: unknown task ${r.task_id}`); continue; }
    console.log(JSON.stringify({ model: r.model, latency_ms: r.latency_ms ?? null, ...scoreOutput(t, r.output) }));
  }
}

export interface ResultRow { candidate: string; category: string | null; success: boolean; latency_ms: number;
  input_tokens: number; output_tokens: number; reasoning_tokens: number | null; cost_usd: number; http: number }
export function summarize(rows: readonly ResultRow[]): Record<string, Record<string, number | null>> {
  const by: Record<string, ResultRow[]> = {};
  for (const r of rows) (by[r.candidate] ??= []).push(r);
  return Object.fromEntries(Object.entries(by).map(([c, rs]) => {
    const ok = rs.filter((r) => r.success).length;
    const cost = rs.reduce((a, r) => a + r.cost_usd, 0);
    const lat = rs.map((r) => r.latency_ms).sort((a, b) => a - b);
    return [c, { calls: rs.length, success_rate: rs.length ? ok / rs.length : null, total_cost_usd: Number(cost.toFixed(5)),
      cost_per_success_usd: ok ? Number((cost / ok).toFixed(6)) : null,
      p50_latency_ms: lat.length ? lat[Math.floor(lat.length / 2)] : null,
      mean_output_tokens: rs.length ? Math.round(rs.reduce((a, r) => a + r.output_tokens, 0) / rs.length) : null,
      http_errors: rs.filter((r) => r.http !== 200).length }];
  }));
}

async function live(stage: 1 | 2, budget: number): Promise<void> {
  const read: Read = (k) => Deno.env.get(k);
  const gate = liveApproval(budget, read, stage);
  if (!gate.ok) { console.error(gate.reason); Deno.exit(3); }
  const okey = Deno.env.get("OPENAI_API_KEY"), akey = Deno.env.get("ANTHROPIC_API_KEY");
  const tasks = stageTasks(stage);
  let spent = 0;
  for (let rep = 0; rep < REPEATS; rep++) for (const c of BENCH_CANDIDATES) for (const t of tasks) {
    const key = c.vendor === "openai" ? okey : akey;
    if (!key) { console.log(JSON.stringify({ candidate: c.id, task: t.id, skipped: `no ${c.vendor} key` })); continue; }
    const bound = hardCallBound(c, t);
    if (spent + bound > budget) { console.error(`stopped before ${c.id}/${t.id}: admission would exceed $${budget}`); return; }
    const started = Date.now();
    let status = 0, data: Record<string, unknown> | null = null;
    try {
      const res = c.vendor === "openai"
        ? await fetch("https://api.openai.com/v1/chat/completions", { method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(openaiBody(c, t)) })
        : await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify(anthropicBody(c, t)) });
      status = res.status;
      data = await res.json().catch(() => null);
    } catch { status = 0; }
    const usage = readModelUsage(data);
    const priced = priceModelCall({ model: c.model, usage });
    const cost = priced.estimated_usd ?? bound; // fail-closed
    spent += cost;
    const output = c.vendor === "openai"
      ? String(((data?.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content) ?? "")
      : ((data?.content as Array<{ type?: string; text?: string }> | undefined) ?? []).filter((x) => x.type === "text" || x.text).map((x) => x.text ?? "").join("");
    console.log(JSON.stringify({ stage, rep, candidate: c.id, model: c.model, effort: c.effort, task: t.id, category: t.category ?? null,
      http: status, latency_ms: Date.now() - started, input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0,
      reasoning_tokens: usage.reasoning_tokens ?? null, cost_usd: cost, cost_source: priced.estimated_usd == null ? "hard_bound" : "event_priced",
      spent_usd: Number(spent.toFixed(5)), ...scoreOutput(t, output), output }));
  }
  console.error(`done: spent $${spent.toFixed(4)} of $${budget}`);
}

if (import.meta.main) {
  const a = Deno.args;
  const at = (f: string) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  const stage = (at("--stage") === "2" ? 2 : 1) as 1 | 2;
  if (a.includes("--check-model")) await checkModel(at("--check-model") ?? "gpt-6.1-terra");
  else if (a.includes("--score")) scoreFile(at("--score")!);
  else if (a.includes("--summarize")) {
    const rows = Deno.readTextFileSync(at("--summarize")!).split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.candidate && !r.skipped);
    console.log(JSON.stringify(summarize(rows), null, 2));
  } else if (a.includes("--manifest")) console.log(JSON.stringify(await manifest((at("--manifest") === "2" ? 2 : 1)), null, 2));
  else if (a.includes("--live")) await live(stage, Number(at("--budget-usd")));
  else {
    const tasks = stageTasks(stage);
    console.log(`DRY RUN — stage ${stage}: ${tasks.length} fictional tasks × ${BENCH_CANDIDATES.length} candidates × ${REPEATS} repeats = ${tasks.length * BENCH_CANDIDATES.length * REPEATS} calls, 0 retries. No network.`);
    for (const c of BENCH_CANDIDATES) {
      console.log(`  ${c.id.padEnd(18)} ${c.model.padEnd(28)} effort ${String(c.effort ?? "-").padEnd(6)} hard max/pass $${tasks.reduce((x, t) => x + hardCallBound(c, t), 0).toFixed(5)}`);
    }
    console.log(`HARD MAXIMUM stage ${stage}: $${hardRunBound(stage).toFixed(4)} (cap $${STAGE_CAPS_USD[stage]})`);
  }
}
