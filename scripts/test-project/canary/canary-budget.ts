// THE CANARY'S $3 BUDGET, CHECKED BEFORE EVERY PAID STAGE. Pure; reads files.
//
//   deno run --allow-read --allow-write=<audit> scripts/test-project/canary/canary-budget.ts \
//     --stage verify|prepare|launch --apify <apify.json> --spent-microusd <n> --prior-prepares <n> --json <file>
//
// ── WHAT ENFORCES THE $3, AND WHAT DOES NOT ──────────────────────────────────
//
// Apify's account limit ($19 on the canary account) is NOT the enforcer: it is
// far above $3 and the canary does not depend on it. The $3 rests on these:
//   1. The database admission gate (held 20261015140000): every paid request
//      needs a durable, worst-case reservation against the queue row's
//      authorization — one start per approved actor, a model attempt bound,
//      a combined $0.25 cap — and an uncertain start is held, never re-sent.
//   2. Apify's own per-run cap: every start carries `maxTotalChargeUsd` equal
//      to its template maximum (pinned by the gate), on PAY_PER_EVENT actors.
//   3. Request limits pinned by the gate (≤ 3 jobs, 1 company, ≤ 3 companies).
//   4. OpenAI calls bounded by request bytes and max output tokens.
// This script adds the canary-level ceiling over all attempts: what the canary
// already spent plus the next stage's worst case must fit $3, and the next
// attempt's worst case must fit the stricter $0.25 combined authorization.
// "Already spent" is (a) every provider and model operation in the database, at
// the vendor's reconciled figure or its committed worst case, plus (b) EVERY
// earlier `prepare` run of the canary workflow at the kickoff compile's worst
// case (2 × $0.01248), launched or not — a compile spends money before any
// database row exists, so its record is the workflow run itself.
//
// THE LIMITATION, reported on every run: (2) is Apify's documented per-run
// behaviour and is not provable before a run; the first launch's receipts are
// the check (reconcile FAILs any run charged above its cap). If every software
// layer failed at once, exposure would be bounded only by the account limit.
// A $3 software cap is therefore never reported as a hard limit.

import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const CANARY_BUDGET_MICROUSD = 3_000_000;          // the user's per-canary ceiling, all attempts
export const COMBINED_AUTHORIZATION_MICROUSD = 250_000;   // the stricter per-attempt cap (provider + model)
export const PROVIDER_CAP_MICROUSD = 200_000;
export const MODEL_CAP_MICROUSD = 50_000;
export const MODEL_TEMPLATE_MICROUSD = 12_480;            // one Luna attempt's worst case
export const WORKER_MODEL_ATTEMPTS = 4;
export const COMPILE_CALLS = 2;                           // lunaOnlyFetch's bound for the kickoff compile
export const APPROVED_PROVIDER_MICROUSD: Readonly<Record<string, number>> = { jobs: 4_000, details: 4_050, atomus: 10_550 };

export interface BudgetCheck { id: string; what: string; result: "PASS" | "FAIL" | "INFO"; observed: string }

const usd = (micro: number) => `$${(micro / 1e6).toFixed(6)}`;

/**
 * The budget decision for the stage about to run. `spentMicrousd` is what the
 * canary already spent: reconciled vendor figures, or committed worst cases
 * where not yet reconciled, plus recorded kickoff compiles.
 */
export function canaryBudget(i: { stage: string; apify: Json; spentMicrousd: number; priorPrepares: number; catalog: Json }): { ok: boolean; checks: BudgetCheck[]; next_worst_microusd: number; spent_microusd: number } {
  const checks: BudgetCheck[] = [];
  const add = (id: string, what: string, ok: boolean | null, observed: string) =>
    checks.push({ id, what, result: ok === null ? "INFO" : ok ? "PASS" : "FAIL", observed });
  const actors = (i.apify.actors ?? []) as Json[];
  const byTemplate = Object.fromEntries(actors.map((a) => [a.template, a]));

  // B1 — the per-run vendor cap exists for every paid start.
  const ppe = ["jobs", "details", "atomus"].every((t) => byTemplate[t]?.pricing_model === "PAY_PER_EVENT" && byTemplate[t]?.available === true);
  const pinned = ["jobs", "details", "atomus"].every((t) => /maxTotalChargeUsd/.test(String(i.catalog[t]?.liability_bound_ref ?? "")));
  add("B1", "every paid start is a PAY_PER_EVENT run carrying Apify's per-run maxTotalChargeUsd (gate-pinned)", ppe && pinned,
    `pay_per_event=${ppe} pinned=${pinned}`);

  // B2 — today's prices fit each start's reserved maximum (the reservation is a true worst case).
  const provider = ["jobs", "details", "atomus"].reduce((a, t) => a + Math.round(Number(byTemplate[t]?.worst_case_usd ?? Infinity) * 1e6), 0);
  const fits = ["jobs", "details", "atomus"].every((t) =>
    Math.round(Number(byTemplate[t]?.worst_case_usd ?? Infinity) * 1e6) <= APPROVED_PROVIDER_MICROUSD[t]);
  add("B2", "current prices fit every reserved maximum (one start each)", fits, `provider worst ${usd(provider)}`);

  // B3 — one attempt fits the stricter caps: $0.20 provider, $0.05 model, $0.25 combined.
  const reserved = Object.values(APPROVED_PROVIDER_MICROUSD).reduce((a, b) => a + b, 0);
  const model = WORKER_MODEL_ATTEMPTS * MODEL_TEMPLATE_MICROUSD;
  const attempt = reserved + model;
  add("B3", "one attempt's worst case fits $0.20 provider, $0.05 model and the $0.25 combined authorization",
    reserved <= PROVIDER_CAP_MICROUSD && model <= MODEL_CAP_MICROUSD && attempt <= COMBINED_AUTHORIZATION_MICROUSD,
    `provider ${usd(reserved)} + worker model ${usd(model)} = ${usd(attempt)}`);

  // B4 — the canary-level $3 ceiling over all attempts.
  const compile = COMPILE_CALLS * MODEL_TEMPLATE_MICROUSD;
  const next = i.stage === "prepare" || i.stage === "verify" ? compile + attempt : i.stage === "launch" ? attempt : 0;
  const db = Math.max(0, Math.round(i.spentMicrousd));
  const prepares = Number.isInteger(i.priorPrepares) && i.priorPrepares >= 0 ? i.priorPrepares : NaN;
  const spent = db + prepares * compile;
  add("B4", "spent so far + the next stage's worst case fit the $3 canary budget", Number.isFinite(spent) && spent + next <= CANARY_BUDGET_MICROUSD,
    `spent ${usd(spent)} (operations ${usd(db)} + ${prepares} earlier prepare compile(s) × ${usd(compile)}) + next ${usd(next)} (${i.stage === "launch" ? "the paid run" : "compile + the paid run"}) ` +
      `= ${usd(spent + next)} of ${usd(CANARY_BUDGET_MICROUSD)}; remaining after: ${usd(CANARY_BUDGET_MICROUSD - spent - next)}`);

  // B5 — the account can absorb the next attempt, so its limit never cuts a run mid-purchase.
  const room = Math.round(Number(i.apify.account?.room_usd ?? NaN) * 1e6);
  add("B5", "the Apify account's remaining room covers the next attempt's provider worst case", Number.isFinite(room) && room >= reserved,
    `room ${Number.isFinite(room) ? usd(room) : "unknown"} ≥ ${usd(reserved)}`);

  // B6 — the limitation, always stated, never a PASS.
  const limit = Number(i.apify.account?.max_monthly_usage_usd ?? NaN);
  add("B6", "LIMITATION: the $3 is software-enforced; Apify's account hard limit is not the enforcer", null,
    `account hard limit $${Number.isFinite(limit) ? limit : "unknown"} (above $3). The $3 rests on the admission gate's reservations, ` +
      `Apify's per-run maxTotalChargeUsd, the pinned request limits and the model token bounds. Apify's enforcement of ` +
      `maxTotalChargeUsd is unproven until the first run's receipts (reconcile FAILs any run above its cap). If every ` +
      `software layer failed at once, exposure would be bounded only by the account limit.`);

  return { ok: checks.every((c) => c.result !== "FAIL"), checks, next_worst_microusd: next, spent_microusd: spent };
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["stage", "apify", "spent-microusd", "prior-prepares", "json"] });
  const apify = JSON.parse(Deno.readTextFileSync(a.apify!));
  const catalog = JSON.parse(Deno.readTextFileSync(new URL("../../../docs/launch/proposals/smoke-catalog-canary-funding.json", import.meta.url))).approved_quotes;
  const spent = Number(a["spent-microusd"]);
  if (!Number.isFinite(spent)) { console.error("--spent-microusd must be a number"); Deno.exit(2); }
  const prior = Number(a["prior-prepares"]);
  if (!Number.isInteger(prior) || prior < 0) { console.error("--prior-prepares must be a count"); Deno.exit(2); }
  const r = canaryBudget({ stage: String(a.stage), apify, spentMicrousd: spent, priorPrepares: prior, catalog });
  for (const c of r.checks) console.log(`${c.result.padEnd(5)} ${c.id} ${c.what}: ${c.observed}`);
  if (a.json) Deno.writeTextFileSync(a.json, JSON.stringify(r, null, 2) + "\n");
  console.log(r.ok ? "BUDGET OK" : "BUDGET REFUSED — no paid operation runs");
  Deno.exit(r.ok ? 0 : 1);
}
