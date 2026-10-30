// THE CANARY APIFY ACCOUNT, CHECKED BEFORE ANY PURCHASE. Read-only, free.
//
//   APIFY_API_TOKEN=<canary account token> deno run --allow-net=api.apify.com --allow-env=APIFY_API_TOKEN \
//     --allow-read=docs/launch/proposals scripts/test-project/apify-account-check.ts [--expect-username <name>]
//
// `--json <file>` also writes the result (no secret) for the canary workflow's
// audit (.github/workflows/discovery-test-worker.yml, canary stages).
// `APIFY_API_BASE` (local tests only) points it at a stand-in server; in the
// workflow Deno's --allow-net=api.apify.com refuses any other host.
//
// AFTER THE CANARY, the vendor's side of reconciliation (also free GETs):
//   … apify-account-check.ts --runs <run id>,<run id>,…
// prints each run's actor, status and the USD Apify charged (`usageTotalUsd`)
// beside the canary's per-template cap, and their sum against $0.20.
//
// Three GETs per actor and two for the account — no run is started, nothing is
// charged. The token is sent only as an Authorization header to api.apify.com
// and is NEVER printed, logged or written: the output carries the username,
// plan, monthly usage and limit, and each canary actor's CURRENT public price,
// compared with the maximum the canary catalog
// (docs/launch/proposals/smoke-catalog-canary-funding.json) reserves for it.
//
// Exit 0 only when every check passes. Any REVIEW or FAIL exits 1: the canary
// is not authorized on that account until it is resolved. What this cannot
// prove — that Apify enforces `maxTotalChargeUsd` on the account — is printed
// as a remaining manual check, never as a pass.

import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const args = parseArgs(Deno.args, { string: ["expect-username", "runs", "json", "no-run-evidence"], boolean: ["mask-identity"] });
/** `--mask-identity` (the workflow; its logs and artifacts are public): the username is shown as a+++z (n chars). */
const shown = (u: string) => !args["mask-identity"] || u.length < 3 ? u : `${u[0]}${"*".repeat(u.length - 2)}${u.at(-1)} (${u.length} chars)`;
const BASE = (Deno.env.get("APIFY_API_BASE") ?? "https://api.apify.com").replace(/\/$/, "");
const token = Deno.env.get("APIFY_API_TOKEN")?.trim();
if (!token) {
  console.error("APIFY_API_TOKEN is not set. Export it in your own shell; never paste it into a chat or a file in the repository.");
  Deno.exit(2);
}

/** Units each template may buy in the canary: jobs 3, details 1, Atomus 3 (the catalog's request limits). */
const CANARY: Array<{ template: string; actor: string; units: number }> = [
  { template: "jobs", actor: "harvestapi~linkedin-job-search", units: 3 },
  { template: "details", actor: "harvestapi~linkedin-company", units: 1 },
  { template: "atomus", actor: "atomus~linkedin-company-scraper", units: 3 },
];
const catalog = JSON.parse(Deno.readTextFileSync("docs/launch/proposals/smoke-catalog-canary-funding.json")).approved_quotes;

async function get(path: string): Promise<Json> {
  // Bounded: a hung request fails the check instead of stalling the session.
  const res = await fetch(`${BASE}/v2${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  // The body of an error never echoes the token; only the status and Apify's error type are shown.
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status} ${body?.error?.type ?? ""}`.trim());
  return body.data ?? {};
}

type Result = "PASS" | "REVIEW" | "FAIL" | "INFO";
const results: Array<{ check: string; result: Result; detail: string }> = [];
const record = (check: string, result: Result, detail: string) => results.push({ check, result, detail });
/** INFO is stated, never a pass and never a block: the decision it informs is made elsewhere. */
const allPass = () => results.every((r) => r.result === "PASS" || r.result === "INFO");
/** The non-secret audit record (`--json`). */
const audit: Json = { observed_at: new Date().toISOString(), account: {}, actors: [] as Json[] };

// ── NO-RUN EVIDENCE: Apify's own run list for an actor in a time window ──────
// `--no-run-evidence <actor>@<fromISO>@<toISO>[,…]`. Read-only. For each actor,
// pages Apify's run list for THIS account (newest first) until it reaches runs
// older than the window; `complete` is true only when the listing provably
// covers the whole window. Also states the actor's permission level, which is
// what a 403 on a start most often turns on. No message text is kept.
if (args["no-run-evidence"]) {
  const out: Json[] = [];
  let ok = true;
  for (const spec of String(args["no-run-evidence"]).split(",").filter(Boolean)) {
    const [actor, fromIso, toIso] = spec.split("@");
    const from = Date.parse(fromIso), to = Date.parse(toIso);
    if (!/^[a-z0-9_.-]+~[a-z0-9_.-]+$/i.test(actor ?? "") || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      console.log(`FAIL   evidence ${spec}: not <actor>@<fromISO>@<toISO>`); ok = false; continue;
    }
    try {
      const act = await get(`/acts/${actor}`);
      const inWindow: Json[] = [];
      let offset = 0, listed = 0, complete = false;
      for (let page = 0; page < 20 && !complete; page++) {
        const r = await get(`/acts/${actor}/runs?desc=1&limit=100&offset=${offset}`);
        const items = (r.items ?? []) as Json[];
        listed += items.length;
        for (const it of items) {
          const t = Date.parse(it.startedAt ?? "");
          if (Number.isFinite(t) && t >= from && t <= to) {
            inWindow.push({ id: it.id, status: it.status, startedAt: it.startedAt, usage_total_usd: it.usageTotalUsd ?? null });
          }
        }
        const oldest = Date.parse(items.at(-1)?.startedAt ?? "");
        if (items.length < 100 || (Number.isFinite(oldest) && oldest < from)) complete = true;
        offset += items.length;
      }
      const rec = { actor, from: new Date(from).toISOString(), to: new Date(to).toISOString(), listed, complete,
        runs_in_window: inWindow, permission_level: act.actorPermissionLevel ?? null, deprecated: act.isDeprecated ?? false };
      out.push(rec);
      console.log(`${complete ? "PASS  " : "FAIL  "} evidence ${actor} ${rec.from} → ${rec.to}: ${inWindow.length} run(s) in the window ` +
        `(${listed} listed, listing ${complete ? "complete" : "INCOMPLETE"}; actor permission level ${rec.permission_level ?? "not stated"})`);
      ok &&= complete;
    } catch (e) {
      ok = false;
      out.push({ actor, error: (e as Error).message });
      console.log(`FAIL   evidence ${actor}: ${(e as Error).message}`);
    }
  }
  if (args.json) Deno.writeTextFileSync(String(args.json), JSON.stringify({ ok, evidence: out }, null, 2) + "\n");
  Deno.exit(ok ? 0 : 1);
}

// ── reconciliation mode: what Apify charged for each canary run ──────────────
if (args.runs) {
  const caps: Record<string, number> = Object.fromEntries(CANARY.map((c) => [c.actor, Number(catalog[c.template]?.maximum_microusd) / 1e6]));
  let total = 0, ok = true;
  const receipts: Json[] = [];
  for (const id of String(args.runs).split(",").map((r) => r.trim()).filter(Boolean)) {
    try {
      const run = await get(`/actor-runs/${encodeURIComponent(id)}`);
      const act = await get(`/acts/${run.actId}`);
      const actor = `${act.username}~${act.name}`;
      const usd = Number(run.usageTotalUsd ?? NaN);
      const cap = caps[actor];
      const within = Number.isFinite(usd) && cap !== undefined && usd <= cap;
      ok &&= within && ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status);
      total += Number.isFinite(usd) ? usd : 0;
      receipts.push({ run_id: id, actor, status: run.status, usage_total_usd: Number.isFinite(usd) ? usd : null, cap_usd: cap ?? null, within });
      console.log(`${within ? "PASS  " : "FAIL  "} run ${id}: ${actor} ${run.status} charged $${usd} (cap ${cap ?? "NOT A CANARY ACTOR"}, ` +
        `chargedEventCounts ${JSON.stringify(run.chargedEventCounts ?? {})})`);
    } catch (e) {
      ok = false;
      receipts.push({ run_id: id, error: (e as Error).message });
      console.log(`FAIL   run ${id}: ${(e as Error).message}`);
    }
  }
  if (args.json) Deno.writeTextFileSync(String(args.json), JSON.stringify({ total_usd: total, ok: ok && total <= 0.20, receipts }, null, 2) + "\n");
  console.log(`total charged $${total.toFixed(6)} of the $0.20 provider cap — enter each run in reconcile_discovery_smoke_operation with this vendor amount`);
  Deno.exit(ok && total <= 0.20 ? 0 : 1);
}

// ── the account ──────────────────────────────────────────────────────────────
try {
  const me = await get("/users/me");
  const username = String(me.username ?? "");
  console.log(`account: username=${shown(username)} plan=${me.plan?.id ?? "unknown"}`);
  audit.account = { username: shown(username), user_id: args["mask-identity"] ? null : me.id ?? null, plan: me.plan?.id ?? null,
    plan_monthly_credits_usd: me.plan?.monthlyUsageCreditsUsd ?? null };
  if (args["expect-username"]) {
    record("account identity", username === args["expect-username"] ? "PASS" : "FAIL",
      `username ${shown(username)}, expected ${shown(String(args["expect-username"]))} (the old account must not be used)`);
  } else {
    record("account identity", "REVIEW", `username ${shown(username)}: confirm it is the canary account, not the old one (--expect-username)`);
  }
  const limits = await get("/users/me/limits");
  const max = Number(limits.limits?.maxMonthlyUsageUsd);
  const used = Number(limits.current?.monthlyUsageUsd);
  const cycle = limits.monthlyUsageCycle ?? {};
  console.log(`usage: $${used} of $${max} this cycle (${cycle.startAt ?? "?"} → ${cycle.endAt ?? "?"})`);
  const room = max - used;
  Object.assign(audit.account, { monthly_usage_usd: used, max_monthly_usage_usd: max, room_usd: room,
    cycle_start: cycle.startAt ?? null, cycle_end: cycle.endAt ?? null });
  record("account spending room", Number.isFinite(room) && room >= 0.25 ? "PASS" : "FAIL",
    `$${Number.isFinite(room) ? room.toFixed(4) : "unknown"} left; the canary's combined cap is $0.25`);
  // THE ACCOUNT LIMIT IS REPORTED, NOT RELIED ON. The canary's $3 ceiling is
  // enforced by its own gates (scripts/test-project/canary/canary-budget.ts,
  // which blocks every paid stage); an account limit above it is a stated
  // limitation of that ceiling, never a pass.
  record("account hard limit", "INFO", Number.isFinite(max) && max <= 3
    ? `maxMonthlyUsageUsd=${max}: Apify itself also stops the account at or below the $3 canary budget`
    : `maxMonthlyUsageUsd=${Number.isFinite(max) ? max : "unknown"} is above the $3 canary budget: the $3 is software-enforced ` +
      `(canary-budget.ts B1–B6), not an Apify hard limit`);
} catch (e) {
  record("account", "FAIL", String((e as Error).message));
}

// ── each canary actor's current price against the catalog maximum ─────────────
for (const { template, actor, units } of CANARY) {
  try {
    const act = await get(`/acts/${actor}`);
    // Available: it exists for this account and is not deprecated. A registry entry is not proof.
    const available = !!act.id && act.isDeprecated !== true;
    record(`${template} actor available`, available ? "PASS" : "FAIL", `${actor}: id=${act.id ?? "none"} deprecated=${act.isDeprecated ?? false}`);
    const infos = (act.pricingInfos ?? []) as Json[];
    const now = Date.now();
    const current = infos.filter((i) => !i.startedAt || Date.parse(i.startedAt) <= now)
      .sort((x, y) => Date.parse(y.startedAt ?? 0) - Date.parse(x.startedAt ?? 0))[0];
    if (!current || current.pricingModel !== "PAY_PER_EVENT") {
      record(`${template} price`, "FAIL", `${actor}: pricing model ${current?.pricingModel ?? "none"} — the catalog assumes PAY_PER_EVENT`);
      continue;
    }
    const events = Object.entries((current.pricingPerEvent?.actorChargeEvents ?? {}) as Record<string, Json>);
    // The dearest tier, so the comparison holds whatever the plan maps to.
    const priceOf = (e: Json) => Math.max(Number(e.eventPriceUsd ?? 0),
      ...Object.values((e.eventTieredPricingUsd ?? {}) as Record<string, Json>).map((t) => Number(t.tieredEventPriceUsd ?? 0)));
    const start = events.filter(([k]) => /start/i.test(k));
    const perUnit = events.filter(([k]) => !/start/i.test(k));
    for (const [k, e] of events) console.log(`  ${actor}: ${k} = $${priceOf(e)} (dearest tier) — ${e.eventTitle ?? ""}`);
    const worst = start.reduce((a, [, e]) => a + priceOf(e), 0) + units * Math.max(0, ...perUnit.map(([, e]) => priceOf(e)));
    const reserved = Number(catalog[template]?.maximum_microusd) / 1e6;
    audit.actors.push({ template, actor, available, pricing_model: current.pricingModel, units,
      events: Object.fromEntries(events.map(([k, e]) => [k, priceOf(e)])), worst_case_usd: worst, reserved_usd: reserved });
    if (perUnit.length !== 1) {
      record(`${template} price`, "REVIEW", `${actor}: ${perUnit.length} chargeable events besides the start; decide which apply to ${units} unit(s) (bound by the dearest: $${worst.toFixed(6)} vs reserved $${reserved})`);
    } else {
      // In whole micro-dollars: 0.00005 + 3 × 0.0035 must not fail on a floating-point remainder.
      record(`${template} price`, Math.round(worst * 1e6) <= Math.round(reserved * 1e6) ? "PASS" : "FAIL",
        `${actor}: worst case $${worst.toFixed(6)} for 1 start + ${units} unit(s); the catalog reserves $${reserved}`);
    }
  } catch (e) {
    record(`${template} price`, "FAIL", `${actor}: ${(e as Error).message}`);
  }
}

console.log("");
for (const r of results) console.log(`${r.result.padEnd(6)} ${r.check}: ${r.detail}`);
console.log("MANUAL  maxTotalChargeUsd enforcement on this account is not provable without a run; " +
  "the first canary start's receipt (usageTotalUsd ≤ its cap) is the check, reconciled after the run.");
console.log(`\nobserved_at=${audit.observed_at} — use as --observed-at (valid for 24 h) when every price PASSES.`);
if (args.json) {
  audit.results = results;
  audit.all_pass = allPass();
  Deno.writeTextFileSync(String(args.json), JSON.stringify(audit, null, 2) + "\n");
}
Deno.exit(allPass() ? 0 : 1);
