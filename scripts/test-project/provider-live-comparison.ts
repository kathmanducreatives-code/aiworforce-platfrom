// LIVE PROVIDER COMPARISON ON TEST — apify_only, leadocean_only (review-only),
// apify_leadocean_concurrent, one mission, ONE cumulative budget (owner-approved
// 2026-11-04: Apify ≤ $0.25 and LeadOcean ≤ 25 records ACROSS all three runs; no phone
// lookups, no enrichment, no outreach, no production writes, no uncontrolled retries).
//
//   TEST_URL=… TEST_ANON_KEY=… SMOKE_USER_EMAIL=… SMOKE_USER_PASSWORD=… TEST_WORKSPACE_ID=… \
//   PROVIDER_LIVE_APPROVAL="run the provider comparison within 0.25 USD and 25 LeadOcean records" \
//   AGENTORY_PROVIDER_LIVE_TESTS=enabled PROVIDER_CMP_PRIOR_SPEND='<the JSON prior-spend.sql prints>' \
//     deno run --allow-net --allow-env --allow-write scripts/test-project/provider-live-comparison.ts [--dry-run] --out <dir>
//
// HOW THE CUMULATIVE CAP IS ENFORCED (each layer independent of the others):
//   1 STATIC ALLOCATION. Every mode gets a fixed slice; the slices sum to AT MOST the cap,
//     checked before any request (`allocationFits`). Unused budget is never reallocated
//     upward to a later mode.
//   2 SERVER CEILING. Each strategy_plan carries its slice explicitly (never the server's
//     larger default); the plan's worst case must fit it, and the approval sent is the slice.
//     The server then runs at min(approval, plan worst case), bound into the signed token.
//   3 PER-RUN PROVIDER LIMITS. Apify runs carry maxTotalChargeUsd; LeadOcean records are
//     reserved in the durable ledger before each call (server side).
//   4 POST-RUN CHECK. A run reporting spend above its slice, or answering without a
//     readable spend (unknown), stops the comparison: no further mode runs.
//   5 ONE SHOT. The TEST ledger's committed spend under the harness's walk ids
//     (provider-cmp-*, prior-spend.sql) is subtracted from the cap first; a second
//     invocation after a paid one is refused. All three plans must be ready before any
//     run, so a blocked mode never leaves a half-spent comparison.
// Nothing is retried by this script. Phone lookups and enrichment cannot be requested:
// strategy_run never enriches (multiProvider.ts) and this script sends no such field.

import { assertLiveTestsEnabled } from "../_liveTestGate.ts";

export const MISSION = "Find US B2B companies actively hiring Account Executives, excluding SDRs.";
export const TOTAL = Object.freeze({ apifyUsd: 0.25, leadoceanRecords: 25 });
export const TEST_REF = "tlvnfrxzjhsjgdofwehb";
export const APPROVAL_PHRASE = "run the provider comparison within 0.25 USD and 25 LeadOcean records";

export interface Slice { mode: string; strategy: string; apifyUsd: number; leadoceanRecords: number; allowReviewOnly: boolean }
export const ALLOCATION: readonly Slice[] = Object.freeze([
  { mode: "Apify only", strategy: "apify_only", apifyUsd: 0.10, leadoceanRecords: 0, allowReviewOnly: false },
  { mode: "LeadOcean only", strategy: "leadocean_only", apifyUsd: 0, leadoceanRecords: 10, allowReviewOnly: true },
  { mode: "Concurrent", strategy: "apify_leadocean_concurrent", apifyUsd: 0.15, leadoceanRecords: 15, allowReviewOnly: false },
]);

/** The slices together never exceed the approved cumulative cap. */
export function allocationFits(a: readonly Slice[] = ALLOCATION, total: { apifyUsd: number; leadoceanRecords: number } = TOTAL): boolean {
  const usd = a.reduce((s, x) => s + x.apifyUsd, 0), lo = a.reduce((s, x) => s + x.leadoceanRecords, 0);
  return usd <= total.apifyUsd + 1e-9 && lo <= total.leadoceanRecords && a.every((x) => x.apifyUsd >= 0 && x.leadoceanRecords >= 0);
}

export type Call = (fn: string, body: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;

export interface ModeOutcome {
  mode: string; strategy: string; slice: Slice;
  plan: { status: number; planStatus: string | null; estimate: unknown; planHash: string | null; blockedReason: string | null };
  run: { status: number; runStatus: string | null; spend: { leadoceanRecords: number; apifyUsd: number } | null; providerSummary: unknown; steps: unknown; error: string | null } | null;
  skipped: string | null; runtimeMs: number;
}

export type Spend = { apifyUsd: number; leadoceanRecords: number };

/**
 * ONE-SHOT ACROSS INVOCATIONS. The cap is for the whole comparison, not per invocation: the
 * TEST ledger's committed spend under this harness's walk ids (prior-spend.sql) is
 * subtracted first, and the frozen allocation must still fit what remains. Unknown prior
 * spend (null) refuses a live run.
 */
export function remainingFits(prior: Spend | null, a: readonly Slice[] = ALLOCATION, total: Spend = TOTAL): { ok: true } | { ok: false; reason: string } {
  if (!prior || !Number.isFinite(prior.apifyUsd) || !Number.isFinite(prior.leadoceanRecords) || prior.apifyUsd < 0 || prior.leadoceanRecords < 0) {
    return { ok: false, reason: "prior spend under the comparison's walk ids is unknown: refusing (run prior-spend.sql against TEST)" };
  }
  const left = { apifyUsd: total.apifyUsd - prior.apifyUsd, leadoceanRecords: total.leadoceanRecords - prior.leadoceanRecords };
  return allocationFits(a, left) ? { ok: true } : { ok: false, reason: `the cap already holds ${JSON.stringify(prior)} from an earlier run; the allocation no longer fits ${JSON.stringify(left)}` };
}

/**
 * Run the comparison. Pure apart from `call` (the TEST functions) and the clock.
 *  1 Every mode is PLANNED first. A live comparison runs nothing unless all three plans are
 *    ready and inside their slices, so a blocked mode never leaves a half-spent comparison.
 *  2 Modes run in order. A run without a readable spend (an error, a timeout, a 5xx) has
 *    UNKNOWN spend: the comparison stops, like a run reporting spend above its slice.
 */
export async function runComparison(call: Call, workspaceId: string, opts: { dryRun: boolean; prior?: Spend | null; now?: () => number } = { dryRun: false }): Promise<{ outcomes: ModeOutcome[]; spent: Spend; stopped: string | null }> {
  if (!allocationFits()) throw new Error("allocation exceeds the approved cumulative cap: nothing was requested");
  if (!opts.dryRun) {
    const fits = remainingFits(opts.prior ?? null);
    if (!fits.ok) throw new Error(`${fits.reason}: nothing was requested`);
  }
  const now = opts.now ?? (() => Date.now());
  const spent: Spend = { apifyUsd: 0, leadoceanRecords: 0 };
  const base = (slice: Slice) => ({
    workspace_id: workspaceId, walk_id: `provider-cmp-${slice.strategy}`, query: MISSION, requested_count: 5,
    strategy: slice.strategy, allow_review_only: slice.allowReviewOnly,
    // ALWAYS explicit: the server's default ceiling is larger than any slice.
    max_apify_usd: slice.apifyUsd, max_leadocean_records: slice.leadoceanRecords,
  });

  // Phase 1: plan every mode (model calls only; no provider is called by strategy_plan).
  const planned: { slice: Slice; outcome: ModeOutcome; token: unknown; started: number }[] = [];
  for (const slice of ALLOCATION) {
    const started = now();
    const p = await call("lead-pipeline", { action: "strategy_plan", ...base(slice) });
    const plan = p.body.plan as { status?: string; estimate?: Spend; planHash?: string; blockedReason?: string } | undefined;
    const outcome: ModeOutcome = { mode: slice.mode, strategy: slice.strategy, slice,
      plan: { status: p.status, planStatus: plan?.status ?? null, estimate: plan?.estimate ?? null, planHash: plan?.planHash ?? null, blockedReason: plan?.blockedReason ?? (p.body.error as string) ?? null },
      run: null, skipped: null, runtimeMs: 0 };
    const est = plan?.estimate;
    if (p.status !== 200 || plan?.status !== "ready" || !est || !plan.planHash) outcome.skipped = "plan not ready";
    else if (est.apifyUsd > slice.apifyUsd + 1e-9 || est.leadoceanRecords > slice.leadoceanRecords) outcome.skipped = `plan worst case ${JSON.stringify(est)} exceeds the slice: refused`;
    outcome.runtimeMs = now() - started;
    planned.push({ slice, outcome, token: p.body.approval_token, started });
  }
  const notReady = planned.filter((x) => x.outcome.skipped);
  let stopped: string | null = null;
  if (opts.dryRun) {
    for (const x of planned) x.outcome.skipped ??= "dry run: plan only";
    return { outcomes: planned.map((x) => x.outcome), spent, stopped: null };
  }
  if (notReady.length) {
    stopped = `not every mode can run (${notReady.map((x) => `${x.slice.mode}: ${x.outcome.skipped}${x.outcome.plan.blockedReason ? ` — ${x.outcome.plan.blockedReason}` : ""}`).join("; ")}): nothing was bought`;
    for (const x of planned) x.outcome.skipped ??= stopped;
    return { outcomes: planned.map((x) => x.outcome), spent, stopped };
  }

  // Phase 2: run each approved plan, in order, stopping at the first unknown or excess spend.
  for (const { slice, outcome, token } of planned) {
    if (stopped) { outcome.skipped = stopped; continue; }
    const started = now();
    const r = await call("lead-pipeline", { action: "strategy_run", ...base(slice),
      approval: { plan_hash: outcome.plan.planHash, apify_usd: slice.apifyUsd, leadocean_records: slice.leadoceanRecords, token } });
    const raw = r.body.spend as Partial<Spend> | undefined;
    const spend = raw && typeof raw.apifyUsd === "number" && typeof raw.leadoceanRecords === "number" ? { apifyUsd: raw.apifyUsd, leadoceanRecords: raw.leadoceanRecords } : null;
    outcome.run = { status: r.status, runStatus: (r.body.status as string) ?? null, spend, providerSummary: r.body.providerSummary ?? null,
      steps: r.body.steps ?? null, error: (r.body.error as string) ?? null };
    outcome.runtimeMs += now() - started;
    if (spend) { spent.apifyUsd += spend.apifyUsd; spent.leadoceanRecords += spend.leadoceanRecords; }
    if (r.status !== 200 || !spend) {
      stopped = `${slice.mode} answered ${r.status} without a readable spend (spend unknown; check the TEST ledger and Apify's run list): comparison stopped`;
    } else if (spend.apifyUsd > slice.apifyUsd + 1e-9 || spend.leadoceanRecords > slice.leadoceanRecords) {
      stopped = `${slice.mode} reported spend ${JSON.stringify(spend)} above its slice: comparison stopped`;
    }
  }
  return { outcomes: planned.map((x) => x.outcome), spent: { apifyUsd: Math.round(spent.apifyUsd * 1e6) / 1e6, leadoceanRecords: spent.leadoceanRecords }, stopped };
}

if (import.meta.main) {
  const env = (k: string) => { const v = Deno.env.get(k); if (!v) throw new Error(`${k} is required`); return v; };
  const url = env("TEST_URL");
  if (url !== `https://${TEST_REF}.supabase.co`) throw new Error("refusing: TEST_URL is not the TEST project");
  const dryRun = Deno.args.includes("--dry-run");
  if (!dryRun && Deno.env.get("PROVIDER_LIVE_APPROVAL") !== APPROVAL_PHRASE) throw new Error(`refusing: PROVIDER_LIVE_APPROVAL must be exactly "${APPROVAL_PHRASE}"`);
  if (!dryRun) assertLiveTestsEnabled();
  // The ledger's committed spend under this harness's walk ids, as printed by prior-spend.sql.
  const priorRaw = Deno.env.get("PROVIDER_CMP_PRIOR_SPEND");
  let prior: Spend | null = null;
  try { prior = priorRaw ? JSON.parse(priorRaw) as Spend : null; } catch { prior = null; }
  const anon = env("TEST_ANON_KEY");
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email: env("SMOKE_USER_EMAIL"), password: env("SMOKE_USER_PASSWORD") }) });
  const jwt = ((await auth.json()) as { access_token?: string }).access_token;
  if (!jwt) throw new Error("sign-in failed");
  const call: Call = async (fn, body) => {
    const res = await fetch(`${url}/functions/v1/${fn}`, { method: "POST", headers: { authorization: `Bearer ${jwt}`, apikey: anon, "content-type": "application/json" }, body: JSON.stringify(body) });
    let parsed: Record<string, unknown> = {};
    try { parsed = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, body: parsed };
  };
  const out = Deno.args[Deno.args.indexOf("--out") + 1] ?? "provider-comparison-out";
  const result = await runComparison(call, env("TEST_WORKSPACE_ID"), { dryRun, prior });
  await Deno.mkdir(out, { recursive: true });
  // No token, key or contact value is in the report: only plans, spend, summaries and steps.
  await Deno.writeTextFile(`${out}/live-comparison.json`, JSON.stringify({ mission: MISSION, total: TOTAL, allocation: ALLOCATION, dryRun, ...result }, null, 1) + "\n");
  console.log(JSON.stringify({ spent: result.spent, stopped: result.stopped, modes: result.outcomes.map((o) => [o.mode, o.plan.planStatus, o.run?.runStatus ?? o.skipped]) }));
}
