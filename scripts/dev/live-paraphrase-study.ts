// LIVE PARAPHRASE STUDY — how well does the REAL model read casual, misspelt, indirect
// requests under contract v3? (mission reliability S4; owner-authorised, ≤ $2, ≤ 180 calls)
//
//   OPENAI_API_KEY=… deno run --allow-read --allow-write --allow-env --allow-net=api.openai.com \
//     scripts/dev/live-paraphrase-study.ts --repeats 3 [--budget-usd 2] [--max-calls 180] [--out docs/benchmarks/live-paraphrase]
//   deno run --allow-read --allow-write --allow-env scripts/dev/live-paraphrase-study.ts --dry-run   # offline, $0
//
// Each corpus phrasing (tests/fixtures/mission-reliability/v1/cases.json) is sent to the
// production mission-compilation route with the v3 payload and strict schema, `repeats`
// times. The model's own proposal is then compiled by the real compiler (contract v3) and
// summarised exactly like the offline corpus, so the result answers: does GPT's reading,
// validated and executed, mean what the request means? Equivalent requests are compared
// for stability; contrast pairs for collapse.
//
// SPENDING IS ENFORCED AT THE TRANSPORT, NOT TRUSTED TO THE LOOP:
//   * every HTTP request — including the provider client's own retry — passes through a
//     guard that first RESERVES its worst-case cost (input estimated from the request body
//     at 1 token per 3 characters, plus the full output token ceiling, at list price) and
//     REFUSES before sending if spent + reservation would exceed the budget, or if the call
//     cap is reached; a refused request is answered locally with a non-retryable 400;
//   * after each response the reservation is replaced by the cost of its reported usage
//     (a response without usage keeps the worst-case reservation as spent);
//   * no paid lead discovery, enrichment or any other host can be reached: the guard only
//     forwards to api.openai.com, and the script asks for no other network permission.
// Results are written with the exact model id, prices, usage and cost per call, so the
// study is reproducible and its spend auditable. No key is printed or written.

import { buildMissionCompilerPayload, compileLeadMission, MISSION_COMPILER_SYSTEM_PROMPT } from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import { gptStructured } from "../../supabase/functions/_shared/gptProvider.ts";
import { gptMissionSchemaFor } from "../../supabase/functions/_shared/gptMissionSchema.ts";
import { routeModel } from "../../supabase/functions/_shared/gptModelRouter.ts";
import { canonicalModelId, MODEL_PRICES, priceModelCall, readModelUsage } from "../../supabase/functions/_shared/modelCostModel.ts";
import { compare, type Case, compilePhrasing, fullProposal, loadCases, loadContrasts, summarise, type Summary } from "./interpretation-corpus.ts";
import { gptContractGenerate } from "../../supabase/functions/_shared/missionContract/gptInterpreter.ts";
import { contractFromProposal } from "../../supabase/functions/_shared/missionContract/interpret.ts";
import { compileContract } from "../../supabase/functions/_shared/missionContract/compile.ts";
import { contractHash } from "../../supabase/functions/_shared/missionContract/contract.ts";
import { v4Expect, v4From } from "./contract-corpus.ts";

const ROOT = new URL("../../", import.meta.url);
const MAX_OUTPUT_TOKENS = 4000;

export interface BudgetGuard {
  fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
  state: () => { calls: number; refused: number; spentUsd: number; reservedUsd: number; ledger: CallRecord[] };
}
export interface CallRecord { n: number; model: string; input_tokens: number | null; output_tokens: number | null; usd: number; basis: "usage" | "worst_case" }

/**
 * The transport guard. `send` is the real (or stub) fetch; nothing reaches it unless the
 * worst case of THIS request fits the remaining budget and the call cap.
 */
export function budgetGuard(o: { budgetUsd: number; maxCalls: number; model: string; send: BudgetGuard["fetch"] }): BudgetGuard {
  const price = MODEL_PRICES[canonicalModelId(o.model)];
  if (!price) throw new Error(`no list price for ${o.model}: the budget cannot be enforced, so the study refuses to run`);
  let calls = 0, refused = 0, spent = 0, reserved = 0;
  const ledger: CallRecord[] = [];
  const refuse = (why: string) => {
    refused++;
    return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve(JSON.stringify({ error: { code: "budget_refused", message: why } })) });
  };
  return {
    state: () => ({ calls, refused, spentUsd: spent, reservedUsd: reserved, ledger }),
    fetch: async (url, init) => {
      if (new URL(url).hostname !== "api.openai.com") return refuse(`host ${new URL(url).hostname} is not the model provider`);
      const body = String(init.body ?? "");
      const worst = (Math.ceil(body.length / 3) * price.input_per_1m + MAX_OUTPUT_TOKENS * price.output_per_1m) / 1e6;
      if (calls >= o.maxCalls) return refuse(`call cap ${o.maxCalls} reached`);
      if (spent + reserved + worst > o.budgetUsd) return refuse(`budget: spent $${spent.toFixed(4)} + this call's worst case $${worst.toFixed(4)} would exceed $${o.budgetUsd}`);
      calls++;
      reserved += worst;
      let res;
      try { res = await o.send(url, init); } catch (e) { reserved -= worst; spent += worst; ledger.push({ n: calls, model: o.model, input_tokens: null, output_tokens: null, usd: worst, basis: "worst_case" }); throw e; }
      const text = await res.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* priced at worst case below */ }
      const usage = readModelUsage(parsed);
      const priced = priceModelCall({ model: o.model, usage });
      const usd = priced.actual_usd ?? priced.estimated_usd ?? worst;
      reserved -= worst;
      spent += usd;
      ledger.push({ n: calls, model: o.model, input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null, usd,
        basis: priced.actual_usd != null || priced.estimated_usd != null ? "usage" : "worst_case" });
      return { ok: res.ok, status: res.status, text: () => Promise.resolve(text) };
    },
  };
}

export interface StudyRow {
  case: string; label: string; repeat: number; ok: boolean; mismatches: string[]; summary: Summary | null; error: string | null; understanding: unknown;
  /** The model's whole structured answer (model output only; no key or request secret). Needed to reproduce a failure offline. */
  proposal?: unknown;
  /** Hard criteria the compiled mission carries that no evidence dimension answers, exactly as compiled. */
  extraHard?: { dimension: string; field: string | null; value: unknown; label: string | null }[];
  /** Why a failed row failed (classifyFailure); absent on a correct row. */
  failure?: FailureClass;
}

/**
 * THE ROLLOUT GATE'S QUESTION for a failed reading (mission-rollout-plan.md §3): was the
 * model's understanding wrong, or was a correct understanding executed wrongly?
 *   transport             no structured answer (e.g. incomplete_response: the output ran out)
 *   model_clarification   the understanding listed an ambiguity; the compiler asked instead
 *   model_understanding   the understanding itself reads the request wrongly
 *   compiled_wrongly      the SAME understanding, with the corpus's recorded legacy fields,
 *                         compiles correctly: the failure came from the answer's other fields
 *                         as the compiler executed them (a compiler-side failure)
 */
export type FailureClass = "transport" | "model_clarification" | "model_understanding" | "compiled_wrongly" | "contract_mismatch";

export function classifyFailure(c: Case, p: Case["phrasings"][number], r: Pick<StudyRow, "error" | "understanding">): FailureClass {
  if (!r.understanding) return r.error?.includes("needs_clarification") ? "model_clarification" : "transport";
  try {
    const m = compilePhrasing({ ...p, understanding: r.understanding } as never, "v3");
    return compare(c.expect, summarise(m)).length ? "model_understanding" : "compiled_wrongly";
  } catch (e) {
    return /needs_clarification/.test((e as Error).message) ? "model_clarification" : "model_understanding";
  }
}

const extraHardOf = (m: Record<string, unknown>) =>
  ((m.criteria ?? []) as { kind: string; dimension: string; value?: { field?: string; value?: unknown }; label?: string }[])
    .filter((x) => x.kind === "hard" && (x.dimension === "constraint" || x.dimension === "exclusion"))
    .map((x) => ({ dimension: x.dimension, field: x.value?.field ?? null, value: x.value?.value ?? null, label: x.label ?? null }));

/**
 * `contract: "v4"` reads every phrasing through the Mission Contract path: ONE structured
 * answer (missionContract/interpret.ts), deterministic validation, the contract compiler.
 * There is no second channel, so a mismatch is the model's reading or the validator's —
 * recorded as `contract_mismatch` with the contract itself (`proposal`, `contractHash`)
 * for review. The budget guard is the same transport guard.
 */
export async function runStudy(o: { repeats: number; budgetUsd: number; maxCalls: number; dryRun: boolean; cases?: Case[]; readEnv?: (k: string) => string | undefined; contract?: "v3" | "v4" }) {
  const cases = o.cases ?? loadCases();
  const route = routeModel("mission_compilation");
  // Dry run: a stub transport that answers with the corpus's own recorded v3 reading,
  // priced as if real — the pipeline and the guard are exercised end to end, for $0.
  const recorded = new Map(cases.flatMap((c) => c.phrasings.map((p) => [p.query, p] as const)));
  const stub: BudgetGuard["fetch"] = (_url, init) => {
    const msg = JSON.parse(String(init.body)).messages.find((m: { role: string }) => m.role === "user").content;
    const q = JSON.parse(msg).user_query as string;
    const p = recorded.get(q)!;
    const proposal = o.contract === "v4" ? v4From(p as never) : fullProposal(p, "v3");
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(proposal) }, finish_reason: "stop" }],
      usage: { prompt_tokens: Math.ceil(String(init.body).length / 3), completion_tokens: 900 },
    })) });
  };
  const guard = budgetGuard({ budgetUsd: o.budgetUsd, maxCalls: o.maxCalls, model: route.model,
    send: o.dryRun ? stub : (url, init) => fetch(url, init) });
  const readEnv = o.readEnv ?? ((k: string) => Deno.env.get(k));
  const rows: StudyRow[] = [];
  outer: for (let r = 1; r <= o.repeats; r++) {
    for (const c of cases) for (const p of c.phrasings) {
      if (o.contract === "v4") {
        const g = await gptContractGenerate({ fetch: guard.fetch, readEnv: o.dryRun ? (k) => (k === "OPENAI_API_KEY" ? "dry-run" : readEnv(k)) : readEnv, sleep: () => Promise.resolve() })(p.query);
        if (!g.ok) {
          rows.push({ case: c.id, label: p.label, repeat: r, ok: false, mismatches: [], summary: null, error: g.code, understanding: null, failure: "transport" });
          if (guard.state().refused > 0) break outer;
          continue;
        }
        try {
          const { contract, rejected } = contractFromProposal(p.query, g.value as never, { model: g.model });
          const understanding = (g.value as { understanding?: unknown }).understanding ?? null;
          if (contract.ambiguities.length) {
            rows.push({ case: c.id, label: p.label, repeat: r, ok: false, mismatches: [], summary: null, error: `needs_clarification:${contract.ambiguities.map((a) => a.question).join(" | ")}`, understanding, proposal: g.value, failure: "model_clarification" });
            continue;
          }
          const s = summarise(await compileContract(contract) as never);
          const mismatches = compare(v4Expect(c.id, c.expect), s);
          rows.push({ case: c.id, label: p.label, repeat: r, ok: !mismatches.length, mismatches, summary: s, error: null, understanding,
            proposal: { answer: g.value, contract, contractHash: await contractHash(contract), rejected }, ...(mismatches.length ? { failure: "contract_mismatch" as const } : {}) });
        } catch (e) {
          rows.push({ case: c.id, label: p.label, repeat: r, ok: false, mismatches: [], summary: null, error: `contract:${(e as Error).message.slice(0, 200)}`, understanding: null, proposal: g.value, failure: "contract_mismatch" });
        }
        continue;
      }
      const payload = buildMissionCompilerPayload({ originalUserQuery: p.query, contract: "v3" });
      const res = await gptStructured<Record<string, unknown>>({
        purpose: route.stage, system: MISSION_COMPILER_SYSTEM_PROMPT, user: JSON.stringify(payload),
        schema: gptMissionSchemaFor("v3"), model: route.model, reasoningEffort: route.reasoning_effort, tier: route.tier,
        routing_reason: route.reason, temperature: 0, maxTokens: MAX_OUTPUT_TOKENS,
      }, { fetch: guard.fetch, readEnv: o.dryRun ? (k) => (k === "OPENAI_API_KEY" ? "dry-run" : readEnv(k)) : readEnv, sleep: () => Promise.resolve() });
      if (!res.ok) {
        rows.push({ case: c.id, label: p.label, repeat: r, ok: false, mismatches: [], summary: null, error: `${res.code}`, understanding: null, failure: "transport" });
        if (guard.state().refused > 0) break outer; // the budget or the cap said stop: no further call is attempted
        continue;
      }
      try {
        const m = compileLeadMission({ originalUserQuery: p.query, proposal: res.value as never, requestedCount: 5, contract: "v3" })
          .final_mission as unknown as Record<string, unknown>;
        const s = summarise(m);
        const mismatches = compare(c.expect, s);
        const understanding = (res.value as { understanding?: unknown }).understanding ?? null;
        const row: StudyRow = { case: c.id, label: p.label, repeat: r, ok: mismatches.length === 0, mismatches, summary: s, error: null, understanding,
          proposal: res.value, extraHard: extraHardOf(m) };
        if (!row.ok) row.failure = classifyFailure(c, p, row);
        rows.push(row);
      } catch (e) {
        const understanding = (res.value as { understanding?: unknown }).understanding ?? null;
        const row: StudyRow = { case: c.id, label: p.label, repeat: r, ok: false, mismatches: [], summary: null,
          error: `compile:${(e as Error).name}:${(e as Error).message.slice(0, 200)}`, understanding, proposal: res.value };
        row.failure = classifyFailure(c, p, row);
        rows.push(row);
      }
    }
  }
  // Stability: within a case, across phrasings and repeats, how many distinct meanings.
  const byCase = new Map<string, Set<string>>();
  for (const x of rows) if (x.summary) byCase.set(x.case, (byCase.get(x.case) ?? new Set()).add(JSON.stringify(x.summary)));
  const contrasts = loadContrasts().filter((k) => {
    const a = rows.filter((x) => x.case === k.a && x.summary).map((x) => JSON.stringify(x.summary));
    const b = new Set(rows.filter((x) => x.case === k.b && x.summary).map((x) => JSON.stringify(x.summary)));
    return a.some((s) => b.has(s));
  }).map((k) => `${k.a} vs ${k.b}`);
  const st = guard.state();
  const failures: Record<FailureClass, number> = { transport: 0, model_clarification: 0, model_understanding: 0, compiled_wrongly: 0, contract_mismatch: 0 };
  for (const x of rows) if (x.failure) failures[x.failure]++;
  const correct = rows.filter((x) => x.ok).length;
  const allWrong = [...new Set(rows.map((x) => x.case))].filter((id) => rows.filter((x) => x.case === id).every((x) => !x.ok));
  // mission-rollout-plan.md §3 (proposed acceptance). A compiled_wrongly failure blocks the rollout.
  const acceptance = {
    accuracy: { value: rows.length ? Number((correct / rows.length).toFixed(4)) : null, threshold: 0.9, pass: rows.length > 0 && correct / rows.length >= 0.9 },
    collapsed_contrasts: { value: contrasts.length, pass: contrasts.length === 0 },
    cases_all_wrong: { value: allWrong, pass: allWrong.length === 0 },
    every_failure_classified: { pass: rows.every((x) => x.ok || !!x.failure) },
    compiler_failures: { value: failures.compiled_wrongly, pass: failures.compiled_wrongly === 0 },
  };
  return {
    model: route.model, prices: MODEL_PRICES[canonicalModelId(route.model)], dry_run: o.dryRun, contract: o.contract ?? "v3",
    budget_usd: o.budgetUsd, max_calls: o.maxCalls, repeats: o.repeats,
    calls: st.calls, refused: st.refused, spent_usd: Number(st.spentUsd.toFixed(6)),
    phrasings_attempted: rows.length, correct: rows.filter((x) => x.ok).length,
    errors: rows.filter((x) => x.error).length,
    unstable_cases: [...byCase].filter(([, s]) => s.size > 1).map(([k]) => k),
    collapsed_contrasts: contrasts,
    failures, acceptance,
    rows, ledger: st.ledger,
  };
}

if (import.meta.main) {
  const arg = (k: string, d: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : d; };
  const dryRun = Deno.args.includes("--dry-run");
  if (!dryRun && !Deno.env.get("OPENAI_API_KEY")) {
    console.error("OPENAI_API_KEY is not set: the live study cannot run (use --dry-run for the offline pipeline check).");
    Deno.exit(2);
  }
  const report = await runStudy({
    repeats: Number(arg("--repeats", "3")), budgetUsd: Number(arg("--budget-usd", "2")), maxCalls: Number(arg("--max-calls", "180")), dryRun,
    contract: arg("--contract", "v3") === "v4" ? "v4" : "v3",
  });
  const out = arg("--out", "docs/benchmarks/live-paraphrase");
  const name = `${dryRun ? "dry-run" : new Date().toISOString().slice(0, 10)}${arg("--contract", "v3") === "v4" ? "-contract-v4" : ""}.json`;
  await Deno.mkdir(new URL(`${out}/`, ROOT), { recursive: true });
  await Deno.writeTextFile(new URL(`${out}/${name}`, ROOT), JSON.stringify(report, null, 1) + "\n");
  const { rows: _r, ledger: _l, ...summary } = report;
  console.log(JSON.stringify(summary, null, 1));
  console.log(`wrote ${out}/${name}`);
}
