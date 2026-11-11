// TERRA AUDIT COST MODEL. Deterministic; no network. Prints markdown tables.
//
//   deno run --allow-read scripts/model-bench/costModel.ts
//
// Every number is either MEASURED (from a recorded call in this repo) or an
// ASSUMPTION named below. Replace assumptions with benchmark measurements
// (usage.prompt_tokens / completion_tokens / reasoning_tokens) when an approved
// live run exists. Model list prices: ./prices.ts (vendor pages, 2026-11-11).

import { callCost, LIST_PRICES } from "./prices.ts";

// ── CALL PROFILES (tokens per call) ─────────────────────────────────────────
// src: M = measured in this repo, C = computed from the prompt text in code, A = assumption
export const CALLS = {
  understand:       { input: 2600, output: 300,  src: "C: chatBrain SYSTEM ≈1,806 tok + schema/turns (A ≈800); output A (cap 1,500)" },
  converse_simple:  { input: 2000, output: 200,  src: "C: converse system ≈606 tok + context/turns (A); output A (cap 420)" },
  converse_complex: { input: 4500, output: 420,  src: "A: workspace context + facts + 8 turns; output at cap 420" },
  brief:            { input: 3500, output: 700,  src: "C: reporting prompt ≈1,383 tok + facts/Brain (A); output A (cap 900)" },
  weekly_report:    { input: 9000, output: 1500, src: "A: a week of facts; no weekly-report call exists today" },
  plan:             { input: 2800, output: 800,  src: "C: planning prompt ≈1,379 tok + registry ≤875 + brief (A); output A (cap 2,048)" },
  lyra_draft:       { input: 3153, output: 308,  src: "M: first Scribe generation 2026-09-10 (3153 in / 308 out)" },
  signal_relevance: { input: 786,  output: 286,  src: "M: LISA relevance call on Luna (786 in / 286 out, 3.8 s)" },
  lead_call:        { input: 6500, output: 750,  src: "M/A: heaviest run 688,303 tok / 95 calls = 7,245 tok/call; 90/10 split A" },
} as const;
type CallKind = keyof typeof CALLS;

// ASSUMPTION: reasoning tokens per visible output token, by effort. To be measured.
export const REASONING_MULT: Record<string, number> = { none: 0, low: 1, medium: 3 };
export const REPAIR_RATE = 0.10; // A: share of planning outputs a validator rejects

// ── TASKS ───────────────────────────────────────────────────────────────────
export interface TaskSpec { name: string; calls: Array<[CallKind, number]>; provider_usd: number; provider_note: string }
export const TASKS: TaskSpec[] = [
  { name: "Simple chat message", calls: [["understand", 1], ["converse_simple", 1]], provider_usd: 0, provider_note: "none" },
  { name: "Complex company question", calls: [["understand", 1], ["converse_complex", 1]], provider_usd: 0, provider_note: "none (stored evidence)" },
  { name: "ORION executive briefing", calls: [["brief", 1]], provider_usd: 0, provider_note: "none" },
  { name: "ATLAS company qualification", calls: [["lead_call", 1]], provider_usd: 0, provider_note: "page fetches billed as provider credits (not priced here)" },
  { name: "Full lead discovery mission (typical)", calls: [["lead_call", 40], ["plan", 4]], provider_usd: 0.2711,
    provider_note: "M: one recorded V2 run, 19 Apify runs = $0.2711 billed" },
  { name: "LISA signal analysis", calls: [["signal_relevance", 1]], provider_usd: 0, provider_note: "collection billed per cycle" },
  { name: "Scheduled monitoring cycle (10 signals)", calls: [["signal_relevance", 10]], provider_usd: 0,
    provider_note: "search/scrape credits: not verified in this audit" },
  { name: "LYRA LinkedIn draft", calls: [["plan", 1], ["lyra_draft", 1]], provider_usd: 0, provider_note: "none" },
  { name: "Multi-agent collaboration workflow", calls: [["lead_call", 10], ["plan", 1], ["lyra_draft", 1]], provider_usd: 0.0714,
    provider_note: "A: 5 Apify runs at the recorded $0.0143/run average" },
  { name: "Weekly executive intelligence report", calls: [["weekly_report", 1]], provider_usd: 0, provider_note: "none" },
];

// ── STRATEGIES: which model + effort serves each call kind ──────────────────
type Route = { model: string; effort: "none" | "low" | "medium"; escalate?: { rate: number; to: string; effort: "low" | "medium" } };
export const STRATEGIES: Record<string, Record<CallKind, Route>> = {
  "Current": {
    understand: { model: "gpt-5.6-luna", effort: "none", escalate: { rate: REPAIR_RATE, to: "gpt-5.6-terra", effort: "low" } },
    converse_simple: { model: "claude-haiku-4-5-20251001", effort: "none" },
    converse_complex: { model: "claude-haiku-4-5-20251001", effort: "none" },
    brief: { model: "claude-haiku-4-5-20251001", effort: "none" },
    weekly_report: { model: "claude-haiku-4-5-20251001", effort: "none" },
    plan: { model: "claude-haiku-4-5-20251001", effort: "none" },
    lyra_draft: { model: "claude-haiku-4-5-20251001", effort: "none" },
    signal_relevance: { model: "gpt-5.6-luna", effort: "low", escalate: { rate: REPAIR_RATE, to: "gpt-5.6-terra", effort: "low" } },
    lead_call: { model: "gpt-5.6-luna", effort: "none" },
  },
  "A · Terra everywhere": {
    understand: { model: "gpt-6.1-terra", effort: "none" },
    converse_simple: { model: "gpt-6.1-terra", effort: "none" },
    converse_complex: { model: "gpt-6.1-terra", effort: "low" },
    brief: { model: "gpt-6.1-terra", effort: "low" },
    weekly_report: { model: "gpt-6.1-terra", effort: "medium" },
    plan: { model: "gpt-6.1-terra", effort: "low" },
    lyra_draft: { model: "gpt-6.1-terra", effort: "low" },
    signal_relevance: { model: "gpt-6.1-terra", effort: "low" },
    lead_call: { model: "gpt-6.1-terra", effort: "none" },
  },
  "B · Hybrid": {
    understand: { model: "gpt-5.6-luna", effort: "none", escalate: { rate: REPAIR_RATE, to: "gpt-6.1-terra", effort: "low" } },
    converse_simple: { model: "claude-haiku-4-5-20251001", effort: "none" },
    converse_complex: { model: "gpt-6.1-terra", effort: "low" },
    brief: { model: "gpt-6.1-terra", effort: "low" },
    weekly_report: { model: "gpt-6.1-terra", effort: "medium" },
    plan: { model: "gpt-6.1-terra", effort: "low" },
    lyra_draft: { model: "claude-haiku-4-5-20251001", effort: "none" },
    signal_relevance: { model: "gpt-5.6-luna", effort: "low", escalate: { rate: REPAIR_RATE, to: "gpt-6.1-terra", effort: "low" } },
    lead_call: { model: "gpt-5.6-luna", effort: "none" },
  },
  "C · Dynamic escalation": {
    understand: { model: "gpt-5.6-luna", effort: "none", escalate: { rate: REPAIR_RATE, to: "gpt-6.1-terra", effort: "low" } },
    converse_simple: { model: "claude-haiku-4-5-20251001", effort: "none" },
    converse_complex: { model: "claude-haiku-4-5-20251001", effort: "none", escalate: { rate: 0.25, to: "gpt-6.1-terra", effort: "low" } },
    brief: { model: "claude-haiku-4-5-20251001", effort: "none", escalate: { rate: 0.20, to: "gpt-6.1-terra", effort: "low" } },
    weekly_report: { model: "claude-haiku-4-5-20251001", effort: "none", escalate: { rate: 0.50, to: "gpt-6.1-terra", effort: "medium" } },
    plan: { model: "claude-haiku-4-5-20251001", effort: "none", escalate: { rate: 0.20, to: "gpt-6.1-terra", effort: "low" } },
    lyra_draft: { model: "claude-haiku-4-5-20251001", effort: "none", escalate: { rate: 0.10, to: "gpt-6.1-terra", effort: "low" } },
    signal_relevance: { model: "gpt-5.6-luna", effort: "low", escalate: { rate: REPAIR_RATE, to: "gpt-6.1-terra", effort: "low" } },
    lead_call: { model: "gpt-5.6-luna", effort: "none", escalate: { rate: 0.10, to: "gpt-6.1-terra", effort: "low" } },
  },
  "Recommended · Hybrid + escalation (cheaper base)": {
    understand: { model: "gpt-6-luna", effort: "none", escalate: { rate: REPAIR_RATE, to: "gpt-6.1-terra", effort: "low" } },
    converse_simple: { model: "claude-haiku-4-5-20251001", effort: "none" },
    converse_complex: { model: "gpt-6.1-terra", effort: "low" },
    brief: { model: "gpt-6.1-terra", effort: "low" },
    weekly_report: { model: "gpt-6.1-terra", effort: "medium" },
    plan: { model: "gpt-6.1-terra", effort: "low" },
    lyra_draft: { model: "claude-haiku-4-5-20251001", effort: "none" },
    signal_relevance: { model: "gpt-6-luna", effort: "low", escalate: { rate: REPAIR_RATE, to: "gpt-6.1-terra", effort: "low" } },
    lead_call: { model: "gpt-6-luna", effort: "none", escalate: { rate: 0.05, to: "gpt-6.1-terra", effort: "low" } },
  },
};

function routeCost(kind: CallKind, r: Route): number {
  const c = CALLS[kind];
  const base = callCost(r.model, { input: c.input, output: c.output, reasoning: c.output * REASONING_MULT[r.effort] });
  if (!r.escalate) return base;
  // An escalated call is a SECOND call (the cheap attempt was already paid).
  const esc = callCost(r.escalate.to, { input: c.input + c.output, output: c.output, reasoning: c.output * REASONING_MULT[r.escalate.effort] });
  return base + r.escalate.rate * esc;
}
export function taskCost(t: TaskSpec, strategy: string): number {
  return t.calls.reduce((s, [k, n]) => s + n * routeCost(k, STRATEGIES[strategy][k]), 0);
}

// ── MONTHLY USAGE PER ACTIVE CUSTOMER (ASSUMPTIONS) ─────────────────────────
export const MONTHLY_USAGE: Record<string, number> = {
  "Simple chat message": 300, "Complex company question": 60, "ORION executive briefing": 22,
  "ATLAS company qualification": 20, "Full lead discovery mission (typical)": 4, "LISA signal analysis": 0,
  "Scheduled monitoring cycle (10 signals)": 30, "LYRA LinkedIn draft": 12,
  "Multi-agent collaboration workflow": 4, "Weekly executive intelligence report": 4,
};

const usd = (x: number) => x < 0.01 ? `$${x.toFixed(5)}` : `$${x.toFixed(4)}`;
if (import.meta.main) {
  const names = Object.keys(STRATEGIES);
  console.log(`| Task | calls | ${names.join(" | ")} | provider (separate) |`);
  console.log(`|---|---|${names.map(() => "---").join("|")}|---|`);
  for (const t of TASKS) {
    console.log(`| ${t.name} | ${t.calls.reduce((s, [, n]) => s + n, 0)} | ${names.map((s) => usd(taskCost(t, s))).join(" | ")} | ${t.provider_usd ? usd(t.provider_usd) : "—"} |`);
  }
  console.log("\nMonthly MODEL cost (provider credits excluded):");
  console.log(`| Customers | ${names.join(" | ")} |`);
  console.log(`|---|${names.map(() => "---").join("|")}|`);
  const per = names.map((s) => TASKS.reduce((a, t) => a + (MONTHLY_USAGE[t.name] ?? 0) * taskCost(t, s), 0));
  for (const n of [1, 10, 100, 1000]) console.log(`| ${n} | ${per.map((p) => `$${(p * n).toFixed(2)}`).join(" | ")} |`);
  const prov = TASKS.reduce((a, t) => a + (MONTHLY_USAGE[t.name] ?? 0) * t.provider_usd, 0);
  console.log(`\nProvider credits per customer-month (recorded Apify rate, missions + workflows only): $${prov.toFixed(2)}`);
  console.log("\nPrices used:", Object.keys(LIST_PRICES).join(", "));
}
