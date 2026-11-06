// ONE APPROVED MISSION CONTRACT v4 RUN ON TEST — plan → approval → run → per-requirement verdicts.
//
// Owner-approved 2026-11-06: "approve the TEST run within 0.25 USD". Apify only, no
// LeadOcean records, no phone lookups, no enrichment, no outreach, no production writes.
//
// Run it on YOUR machine with a TEST workspace OWNER/ADMIN login (the CI smoke account is a
// plain member, which the function refuses for any paid run). Credentials stay in your shell:
//
//   TEST_URL=https://tlvnfrxzjhsjgdofwehb.supabase.co TEST_ANON_KEY=<TEST publishable key> \
//   TEST_OWNER_EMAIL=… TEST_OWNER_PASSWORD=… TEST_WORKSPACE_ID=40e2512f-09b6-433e-97fe-f9999a1f1897 \
//   CONTRACT_V4_RUN_APPROVAL="approve the TEST run within 0.25 USD" AGENTORY_PROVIDER_LIVE_TESTS=enabled \
//     deno run --allow-net --allow-env --allow-write scripts/test-project/contract-v4-run.ts --out contract-v4-run
//
//   (--dry-run plans only: one model call, no provider spend.)
//
// SPEND, enforced in layers that do not depend on each other:
//   1 the plan request carries max_apify_usd 0.25 and max_leadocean_records 0 (server ceiling);
//   2 the plan's worst case must fit $0.25, or nothing runs;
//   3 the approval sent is the plan's OWN worst case (never more), bound into the signed token;
//   4 a fixed walk id: the server's ledgered invoker never re-buys a step it already bought, so a
//     second invocation cannot spend twice;
//   5 after the run, reported spend above $0.25 or unreadable spend is a failure.
// Nothing is retried. The report holds plans, spend, verdicts and step summaries — no token,
// key, password or contact value.
import { assertLiveTestsEnabled } from "../_liveTestGate.ts";

export const TEST_REF = "tlvnfrxzjhsjgdofwehb";
export const APPROVAL_PHRASE = "approve the TEST run within 0.25 USD";
export const CAP_USD = 0.25;
export const WALK_ID = "contract-v4-test-run-1";
export const MISSION = "Find 5 US B2B companies actively hiring Account Executives, excluding SDRs.";

export type Call = (fn: string, body: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;
type Verdict = { requirementId: string; necessity: string; status: string; decision: string; evidence: unknown[] };

export interface RunReport {
  mission: string; walkId: string; dryRun: boolean;
  plan: { status: number; planStatus: string | null; binding: string | null; contractHash: string | null; estimateUsd: number | null; strategy: string | null; requirements: unknown[]; assumptions: unknown[]; blockedReason: string | null };
  run: null | { status: number; runStatus: string | null; spendUsd: number | null; leadoceanRecords: number | null; contractHash: string | null; leads: number; verdicts: { leadKey: string; verdicts: Verdict[] }[]; invariantViolations: unknown[]; error: string | null };
  checks: { name: string; pass: boolean; detail: string }[];
  ok: boolean;
}

/** Plan, verify, run once, verify. Pure over `call` (testable offline). */
export async function runContractV4(call: Call, workspaceId: string, o: { dryRun: boolean }): Promise<RunReport> {
  const base = { workspace_id: workspaceId, walk_id: WALK_ID, query: MISSION, requested_count: 5, max_apify_usd: CAP_USD, max_leadocean_records: 0 };
  const checks: RunReport["checks"] = [];
  const check = (name: string, pass: boolean, detail: string) => { checks.push({ name, pass, detail }); return pass; };
  const p = await call("lead-pipeline", { action: "strategy_plan", ...base });
  const plan = (p.body.plan ?? {}) as Record<string, unknown>;
  const interp = (p.body.interpretation ?? {}) as { missionContract?: { hash?: string; contract?: { requirements?: { id: string; dimension: string; necessity: string; origin: { source: string } }[] }; assumptions?: unknown[] } };
  const binding = ((plan.binding ?? {}) as { contract?: string }).contract ?? null;
  const est = ((plan.estimate ?? {}) as { apifyUsd?: number; leadoceanRecords?: number });
  const report: RunReport = {
    mission: MISSION, walkId: WALK_ID, dryRun: o.dryRun,
    plan: {
      status: p.status, planStatus: (plan.status as string) ?? null, binding, contractHash: interp.missionContract?.hash ?? null,
      estimateUsd: est.apifyUsd ?? null, strategy: (plan.strategy as string) ?? null,
      requirements: (interp.missionContract?.contract?.requirements ?? []).map((r) => ({ id: r.id, dimension: r.dimension, necessity: r.necessity, source: r.origin.source })),
      assumptions: interp.missionContract?.assumptions ?? [], blockedReason: (plan.blockedReason as string) ?? null,
    },
    run: null, checks, ok: false,
  };
  const ready = check("plan ready", p.status === 200 && plan.status === "ready", `HTTP ${p.status}, ${String(plan.status ?? p.body.error ?? "")}`)
    && check("plan bound to the Mission Contract", !!binding && binding === `mission-contract-v1:${report.plan.contractHash}`, String(binding))
    && check("worst case within the approved cap", typeof est.apifyUsd === "number" && est.apifyUsd <= CAP_USD + 1e-9 && (est.leadoceanRecords ?? 0) === 0,
      `$${est.apifyUsd} Apify, ${est.leadoceanRecords ?? 0} LeadOcean records (cap $${CAP_USD}, 0 records)`)
    && check("approval token issued", typeof p.body.approval_token === "string", "signed plan token present (value not recorded)");
  if (!ready || o.dryRun) { report.ok = ready && o.dryRun; return report; }

  const r = await call("lead-pipeline", { action: "strategy_run", ...base,
    approval: { plan_hash: plan.planHash, apify_usd: est.apifyUsd, leadocean_records: 0, token: p.body.approval_token } });
  const spend = (r.body.spend ?? null) as { apifyUsd?: number; leadoceanRecords?: number } | null;
  const verdicts = (r.body.requirementVerdicts ?? []) as { leadKey: string; verdicts: Verdict[] }[];
  report.run = {
    status: r.status, runStatus: (r.body.status as string) ?? null, spendUsd: spend?.apifyUsd ?? null, leadoceanRecords: spend?.leadoceanRecords ?? null,
    contractHash: (r.body.missionContractHash as string) ?? null, leads: verdicts.length, verdicts,
    invariantViolations: (r.body.invariantViolations as unknown[]) ?? [], error: (r.body.error as string) ?? null,
  };
  const requiredIds = ((interp.missionContract?.contract?.requirements ?? []).filter((x) => x.necessity === "required" && x.dimension !== "unsupported")).map((x) => x.id).sort();
  check("run answered", r.status === 200, `HTTP ${r.status}${report.run.error ? `: ${report.run.error}` : ""}`);
  check("spend readable and within the cap", typeof spend?.apifyUsd === "number" && spend.apifyUsd <= CAP_USD + 1e-9 && (spend.leadoceanRecords ?? 0) === 0,
    `$${spend?.apifyUsd} Apify, ${spend?.leadoceanRecords ?? "?"} LeadOcean records`);
  check("the run executed the approved contract", report.run.contractHash === report.plan.contractHash, `${report.run.contractHash}`);
  check("no invariant violated", report.run.invariantViolations.length === 0, JSON.stringify(report.run.invariantViolations).slice(0, 200));
  check("one verdict per required requirement, for every lead", verdicts.every((v) => JSON.stringify(v.verdicts.filter((x) => requiredIds.includes(x.requirementId)).map((x) => x.requirementId).sort()) === JSON.stringify(requiredIds)),
    `${verdicts.length} leads × ${requiredIds.length} required requirements`);
  check("verified always cites evidence", verdicts.every((v) => v.verdicts.every((x) => x.status !== "verified" || x.evidence.length > 0)), "no evidence-less verified");
  report.ok = checks.every((c) => c.pass);
  return report;
}

if (import.meta.main) {
  const env = (k: string) => { const v = Deno.env.get(k); if (!v) throw new Error(`${k} is required`); return v; };
  const url = env("TEST_URL");
  if (url !== `https://${TEST_REF}.supabase.co`) throw new Error("refusing: TEST_URL is not the TEST project");
  const dryRun = Deno.args.includes("--dry-run");
  if (!dryRun) {
    if (Deno.env.get("CONTRACT_V4_RUN_APPROVAL") !== APPROVAL_PHRASE) throw new Error(`refusing: CONTRACT_V4_RUN_APPROVAL must be exactly "${APPROVAL_PHRASE}"`);
    assertLiveTestsEnabled();
  }
  const anon = env("TEST_ANON_KEY");
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email: env("TEST_OWNER_EMAIL"), password: env("TEST_OWNER_PASSWORD") }) });
  const jwt = ((await auth.json()) as { access_token?: string }).access_token;
  if (!jwt) throw new Error("sign-in failed");
  const call: Call = async (fn, body) => {
    const res = await fetch(`${url}/functions/v1/${fn}`, { method: "POST", headers: { authorization: `Bearer ${jwt}`, apikey: anon, "content-type": "application/json" }, body: JSON.stringify(body) });
    let parsed: Record<string, unknown> = {};
    try { parsed = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, body: parsed };
  };
  const out = Deno.args.includes("--out") ? Deno.args[Deno.args.indexOf("--out") + 1] : "contract-v4-run";
  const report = await runContractV4(call, env("TEST_WORKSPACE_ID"), { dryRun });
  await Deno.mkdir(out, { recursive: true });
  await Deno.writeTextFile(`${out}/contract-v4-run.json`, JSON.stringify(report, null, 1) + "\n");
  for (const c of report.checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`);
  console.log(report.ok ? "RESULT: OK" : "RESULT: NOT OK");
  if (!report.ok) Deno.exit(1);
}
