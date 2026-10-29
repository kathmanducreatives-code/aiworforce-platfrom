// THE CANARY APIFY ACCOUNT, CHECKED BEFORE ANY PURCHASE. Read-only, free.
//
//   APIFY_API_TOKEN=<canary account token> deno run --allow-net=api.apify.com --allow-env=APIFY_API_TOKEN \
//     --allow-read=docs/launch/proposals scripts/test-project/apify-account-check.ts [--expect-username <name>]
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

const args = parseArgs(Deno.args, { string: ["expect-username", "runs"] });
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
  const res = await fetch(`https://api.apify.com/v2${path}`, { headers: { Authorization: `Bearer ${token}` } });
  // The body of an error never echoes the token; only the status and Apify's error type are shown.
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status} ${body?.error?.type ?? ""}`.trim());
  return body.data ?? {};
}

const results: Array<{ check: string; result: "PASS" | "REVIEW" | "FAIL"; detail: string }> = [];
const record = (check: string, result: "PASS" | "REVIEW" | "FAIL", detail: string) => results.push({ check, result, detail });

// ── reconciliation mode: what Apify charged for each canary run ──────────────
if (args.runs) {
  const caps: Record<string, number> = Object.fromEntries(CANARY.map((c) => [c.actor, Number(catalog[c.template]?.maximum_microusd) / 1e6]));
  let total = 0, ok = true;
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
      console.log(`${within ? "PASS  " : "FAIL  "} run ${id}: ${actor} ${run.status} charged $${usd} (cap ${cap ?? "NOT A CANARY ACTOR"}, ` +
        `chargedEventCounts ${JSON.stringify(run.chargedEventCounts ?? {})})`);
    } catch (e) {
      ok = false;
      console.log(`FAIL   run ${id}: ${(e as Error).message}`);
    }
  }
  console.log(`total charged $${total.toFixed(6)} of the $0.20 provider cap — enter each run in reconcile_discovery_smoke_operation with this vendor amount`);
  Deno.exit(ok && total <= 0.20 ? 0 : 1);
}

// ── the account ──────────────────────────────────────────────────────────────
try {
  const me = await get("/users/me");
  const username = String(me.username ?? "");
  console.log(`account: username=${username} plan=${me.plan?.id ?? "unknown"}`);
  if (args["expect-username"]) {
    record("account identity", username === args["expect-username"] ? "PASS" : "FAIL",
      `username ${username}, expected ${args["expect-username"]} (the old account must not be used)`);
  } else {
    record("account identity", "REVIEW", `username ${username}: confirm it is the canary account, not the old one (--expect-username)`);
  }
  const limits = await get("/users/me/limits");
  const max = Number(limits.limits?.maxMonthlyUsageUsd);
  const used = Number(limits.current?.monthlyUsageUsd);
  const cycle = limits.monthlyUsageCycle ?? {};
  console.log(`usage: $${used} of $${max} this cycle (${cycle.startAt ?? "?"} → ${cycle.endAt ?? "?"})`);
  const room = max - used;
  record("account spending room", Number.isFinite(room) && room >= 0.25 ? "PASS" : "FAIL",
    `$${Number.isFinite(room) ? room.toFixed(4) : "unknown"} left; the canary's combined cap is $0.25`);
  // A low account limit is a second, vendor-side ceiling. Recommended, not required.
  record("account limit as a backstop", Number.isFinite(max) && max <= 5 ? "PASS" : "REVIEW",
    `maxMonthlyUsageUsd=${Number.isFinite(max) ? max : "unknown"}; a small account limit (≤ $5) bounds any failure of the other caps`);
} catch (e) {
  record("account", "FAIL", String((e as Error).message));
}

// ── each canary actor's current price against the catalog maximum ─────────────
for (const { template, actor, units } of CANARY) {
  try {
    const act = await get(`/acts/${actor}`);
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
    if (perUnit.length !== 1) {
      record(`${template} price`, "REVIEW", `${actor}: ${perUnit.length} chargeable events besides the start; decide which apply to ${units} unit(s) (bound by the dearest: $${worst.toFixed(6)} vs reserved $${reserved})`);
    } else {
      record(`${template} price`, worst <= reserved ? "PASS" : "FAIL",
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
console.log(`\nobserved_at=${new Date().toISOString()} — use as --observed-at (valid for 24 h) when every price PASSES.`);
Deno.exit(results.every((r) => r.result === "PASS") ? 0 : 1);
