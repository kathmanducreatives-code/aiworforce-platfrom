// OWNER PILOT RUN — the smallest live ATLAS discovery on TEST, run by the owner, on the owner's machine.
//
//   AGENTORY_OWNER_EMAIL=<you@…> deno run --allow-net=tlvnfrxzjhsjgdofwehb.supabase.co --allow-env=AGENTORY_OWNER_EMAIL \
//     scripts/owner-pilot-run.ts [--query "<request>"] [--count 3] [--max-apify-usd 0.04]
//
// 1. Signs in to TEST as you (password typed here, hidden; never stored, never printed).
// 2. strategy_plan: ONE interpretation. Prints the plan: what is hard, what is preferred,
//    the provider steps, the worst-case cost and the plan hash.
// 3. Spends NOTHING unless you type that exact plan hash. Then strategy_run executes the
//    SIGNED plan (no second interpretation), once, and prints the companies found with
//    their verdicts and the actual spend.
//
// Hard limits, checked here AND enforced again by the deployed function:
//   TEST project only · strategy apify_only · LeadOcean 0 records · ≤ 3 companies ·
//   Apify ceiling ≤ $0.05 · one fresh walk id per invocation (the approval token is bound
//   to it; a retry with the same token replays from the ledger and buys nothing twice).
// No phone lookups, no outreach, no production. The approval token stays in memory only.

/** A JSON response read loosely for display (never trusted for a decision the function does not re-check). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const TEST_REF = "tlvnfrxzjhsjgdofwehb";
const TEST_URL = `https://${TEST_REF}.supabase.co`;
const TEST_WORKSPACE = "40e2512f-09b6-433e-97fe-f9999a1f1897";
const TEST_PUBLISHABLE_KEY = "sb_publishable_xJyW_B57hr6_SMFQbf2KPg_7-Fdyrjp";
export const PILOT_LIMITS = { maxCount: 3, maxApifyUsd: 0.05, strategy: "apify_only" } as const;
const DEFAULT_QUERY = "Find 3 US companies actively hiring Account Executives. Prefer B2B companies with 20–500 employees, but include strong opportunities outside that range.";

function arg(name: string): string | undefined {
  const i = Deno.args.indexOf(name);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}

/** The pilot request, refused outside the limits above. */
export function pilotRequest(query: string, count: number, maxApifyUsd: number, walkId: string) {
  if (!query.trim() || query.length > 2000) throw new Error("query must be 1-2000 characters");
  if (!Number.isInteger(count) || count < 1 || count > PILOT_LIMITS.maxCount) throw new Error(`count must be 1-${PILOT_LIMITS.maxCount}`);
  if (!(maxApifyUsd > 0 && maxApifyUsd <= PILOT_LIMITS.maxApifyUsd)) throw new Error(`max Apify must be > 0 and ≤ $${PILOT_LIMITS.maxApifyUsd}`);
  return { workspace_id: TEST_WORKSPACE, walk_id: walkId, query: query.trim(), requested_count: count, strategy: PILOT_LIMITS.strategy, max_apify_usd: maxApifyUsd, max_leadocean_records: 0 };
}

async function readHidden(label: string): Promise<string> {
  await Deno.stdout.write(new TextEncoder().encode(label));
  Deno.stdin.setRaw(true);
  const buf = new Uint8Array(1);
  let out = "";
  try {
    while (true) {
      const n = await Deno.stdin.read(buf);
      if (n === null) break;
      const c = buf[0];
      if (c === 13 || c === 10) break;
      if (c === 3) throw new Error("cancelled");
      if (c === 127) { out = out.slice(0, -1); continue; }
      out += String.fromCharCode(c);
    }
  } finally {
    Deno.stdin.setRaw(false);
    await Deno.stdout.write(new TextEncoder().encode("\n"));
  }
  return out;
}

async function call(body: unknown, jwt: string) {
  const r = await fetch(`${TEST_URL}/functions/v1/lead-pipeline`, {
    method: "POST", headers: { apikey: TEST_PUBLISHABLE_KEY, authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(300_000),
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) as Json }; } catch { return { status: r.status, body: { raw: text.slice(0, 300) } as Json }; }
}

if (import.meta.main) {
  const email = Deno.env.get("AGENTORY_OWNER_EMAIL");
  if (!email) throw new Error("set AGENTORY_OWNER_EMAIL in your own terminal (never paste it into a chat)");
  const req = pilotRequest(arg("--query") ?? DEFAULT_QUERY, Number(arg("--count") ?? 3), Number(arg("--max-apify-usd") ?? 0.04), `pilot-${crypto.randomUUID()}`);

  const password = await readHidden(`TEST password for ${email}: `);
  const auth = await fetch(`${TEST_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: TEST_PUBLISHABLE_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const session = await auth.json().catch(() => ({}));
  if (!auth.ok || !session.access_token) throw new Error(`sign-in failed (HTTP ${auth.status})`);
  const jwt = session.access_token as string;

  const planned = await call({ action: "strategy_plan", ...req }, jwt);
  const plan = planned.body.plan, it = planned.body.interpretation;
  if (planned.status !== 200 || !plan || plan.status !== "ready" || typeof planned.body.approval_token !== "string") {
    console.log(`No runnable plan (HTTP ${planned.status}): ${planned.body.error ?? plan?.blockedReason ?? JSON.stringify(planned.body).slice(0, 300)}`);
    console.log("Nothing was bought.");
    Deno.exit(1);
  }
  console.log(`\nRequest:   ${req.query}`);
  console.log(`Hard:      ${(it?.hard ?? []).map((h: Json) => h.label ?? h.key).join(" · ")}`);
  console.log(`Preferred: ${(it?.preferences ?? []).map((p: Json) => `${p.key}=${JSON.stringify(p.values)}`).join(" · ") || "-"}`);
  console.log(`Signals:   ${(it?.signals ?? []).map((s: Json) => `${s.kind}${s.hard ? " (hard)" : ""} roles=${JSON.stringify(s.roleTerms)} families=${JSON.stringify(s.roleFamilies)} within ${s.windowDays}d`).join(" · ")}`);
  if (it?.contract?.unsupported?.length) console.log(`Unplaced requirements (reported): ${it.contract.unsupported.join(", ")}`);
  console.log(`Strategy:  ${plan.strategy} — ${(plan.steps ?? []).map((s: Json) => `${s.capability} ≤${s.maxItems}`).join(", ")}`);
  console.log(`Worst case: $${plan.estimate.apifyUsd} Apify, ${plan.estimate.leadoceanRecords} LeadOcean records (ceiling $${req.max_apify_usd})`);
  console.log(`Plan hash: ${plan.planHash}\n`);
  if (plan.strategy !== PILOT_LIMITS.strategy || plan.estimate.leadoceanRecords !== 0 || plan.estimate.apifyUsd > req.max_apify_usd) {
    console.log("The plan is outside the pilot limits. Nothing was bought."); Deno.exit(1);
  }

  const typed = (prompt("To spend up to the worst case above, type the plan hash (anything else cancels):") ?? "").trim();
  if (typed !== plan.planHash) { console.log("Cancelled. Nothing was bought."); Deno.exit(0); }

  const ran = await call({ action: "strategy_run", ...req, approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, leadocean_records: 0, token: planned.body.approval_token } }, jwt);
  if (ran.status !== 200) { console.log(`Run refused or failed (HTTP ${ran.status}): ${ran.body.error ?? JSON.stringify(ran.body).slice(0, 300)}`); Deno.exit(1); }
  const b = ran.body;
  console.log(`Run: ${b.status}${b.reason ? ` — ${b.reason}` : ""}; spend $${b.spend?.apifyUsd} Apify, ${b.spend?.leadoceanRecords} LeadOcean records; ${b.written} leads written to TEST`);
  for (const [label, list] of [["Queue", b.queue], ["Review", b.review]] as const) {
    for (const l of (list ?? []) as Json[]) console.log(`  ${label}: ${l.company?.name ?? "?"} (${l.company?.domain ?? "-"}) — ${l.statuses?.qualification ?? l.status ?? "?"}`);
  }
  console.log(`\nWalk ${req.walk_id}. Re-running this script plans a NEW walk; it never re-uses this approval.`);
}
