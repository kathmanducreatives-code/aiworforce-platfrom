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
import { canonicalTitleOf } from "../../supabase/functions/_shared/roleFamilies.ts";

export const TEST_REF = "tlvnfrxzjhsjgdofwehb";
export const APPROVAL_PHRASE = "approve the TEST run within 0.25 USD";
export const CAP_USD = 0.25;
export const WALK_ID = "contract-v4-test-run-1";
// Owner 2026-11-07: B2B is MANDATORY for this run, stated in the mission's own words (the
// global M01 rule — a descriptive "US B2B companies" ranks — is unchanged).
export const MISSION = "Find 5 companies headquartered in the United States that must operate as B2B businesses, are actively hiring Account Executives, and exclude companies whose hiring evidence is only for SDR/BDR roles.";

type Req = { id: string; dimension: string; necessity: string; facet?: string; polarity?: string; place?: string; scope?: string | null; value?: string;
  kind?: string; roleTerms?: string[] | null; excludedRoleTerms?: string[] | null };
/**
 * What THIS mission must read as, or nothing is bought (owner acceptance, 2026-11-07).
 * Checked on every fresh plan, so a live re-reading that drops or weakens one stops the run.
 */
export function missionShapeProblems(c: { requirements?: Req[]; deliverable?: { count?: number | null } } | null): string[] {
  const rs = c?.requirements ?? [];
  const out: string[] = [];
  const titles = (xs: string[] | null | undefined) => new Set((xs ?? []).map(canonicalTitleOf).filter(Boolean));
  if (!rs.some((r) => r.dimension === "geography" && r.necessity === "required" && r.polarity === "include" && r.place === "United States" && r.scope === "headquarters")) out.push("US headquarters is not REQUIRED");
  if (!rs.some((r) => r.dimension === "industry" && r.facet === "business_model" && r.polarity === "include" && r.value?.toUpperCase() === "B2B" && r.necessity === "required")) out.push("B2B business model is not REQUIRED");
  const h = rs.find((r) => r.dimension === "signal" && r.kind === "hiring" && r.necessity === "required");
  if (!h || !titles(h.roleTerms).has("account_executive")) out.push("actively hiring Account Executives is not REQUIRED");
  const ex = titles(h?.excludedRoleTerms);
  for (const [k, label] of [["sales_development_representative", "SDR"], ["business_development_representative", "BDR"]]) if (!ex.has(k)) out.push(`${label} postings are not excluded from the hiring evidence`);
  if (c?.deliverable?.count !== 5) out.push(`requested count is ${c?.deliverable?.count ?? "missing"}, not 5`);
  return out;
}

export type Call = (fn: string, body: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;
type Verdict = { requirementId: string; necessity: string; status: string; decision: string; evidence: unknown[] };

export interface RunReport {
  mission: string; walkId: string; dryRun: boolean;
  plan: { status: number; planStatus: string | null; binding: string | null; contractHash: string | null; estimateUsd: number | null; strategy: string | null; requirements: unknown[]; assumptions: unknown[]; blockedReason: string | null;
    /** The complete approved contract (no secrets: the user's request, requirements, assumptions). */
    contract: unknown; disclosures: string[]; clarification: unknown;
    /** Unsupported items merged as exact duplicates of an enforced requirement (audit; coverage.ts). */
    mergedDuplicates: { span: string; coveredBy: string[]; reason: string }[] };
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
  const interp = (p.body.interpretation ?? {}) as { missionContract?: { hash?: string; contract?: { requirements?: { id: string; dimension: string; necessity: string; origin: { source: string; span?: string }; excludedRoleTerms?: string[] | null; roleTerms?: string[] | null }[]; ambiguities?: unknown[] }; assumptions?: unknown[]; disclosures?: string[]; mergedDuplicates?: { span: string; coveredBy: string[]; reason: string }[] } };
  const binding = ((plan.binding ?? {}) as { contract?: string }).contract ?? null;
  const est = ((plan.estimate ?? {}) as { apifyUsd?: number; leadoceanRecords?: number });
  const report: RunReport = {
    mission: MISSION, walkId: WALK_ID, dryRun: o.dryRun,
    plan: {
      status: p.status, planStatus: (plan.status as string) ?? null, binding, contractHash: interp.missionContract?.hash ?? null,
      estimateUsd: est.apifyUsd ?? null, strategy: (plan.strategy as string) ?? null,
      // Roles are shown in full (2026-11-06: the summary hid the SDR exclusion inside the hiring requirement).
      requirements: (interp.missionContract?.contract?.requirements ?? []).map((r) => ({ id: r.id, dimension: r.dimension, necessity: r.necessity, source: r.origin.source, span: r.origin.span ?? "",
        ...(r.roleTerms ? { roleTerms: r.roleTerms } : {}), ...(r.excludedRoleTerms ? { excludedRoleTerms: r.excludedRoleTerms } : {}) })),
      assumptions: interp.missionContract?.assumptions ?? [], blockedReason: (plan.blockedReason as string) ?? null,
      contract: interp.missionContract?.contract ?? null, disclosures: interp.missionContract?.disclosures ?? [],
      clarification: p.body.clarification ?? null, mergedDuplicates: interp.missionContract?.mergedDuplicates ?? [],
    },
    run: null, checks, ok: false,
  };
  const ready = check("plan ready", p.status === 200 && plan.status === "ready", `HTTP ${p.status}, ${String(plan.status ?? p.body.error ?? "")}`)
    && check("every stated requirement is checked (nothing only shown as 'Not checked', no open question)",
      report.plan.disclosures.length === 0 && !(interp.missionContract?.contract?.ambiguities ?? []).length, report.plan.disclosures.join("; ") || "none")
    && check("every merged duplicate names a required requirement that enforces it",
      report.plan.mergedDuplicates.every((m) => m.coveredBy.length > 0 && m.coveredBy.every((id) => (interp.missionContract?.contract?.requirements ?? []).some((x) => x.id === id && x.necessity === "required" && x.dimension !== "unsupported"))),
      report.plan.mergedDuplicates.map((m) => `"${m.span}" → ${m.coveredBy.join(", ")}`).join("; ") || "none merged")
    && check("the contract reads as this mission (US HQ, B2B, AE hiring REQUIRED; SDR/BDR excluded; 5)",
      missionShapeProblems(interp.missionContract?.contract as never).length === 0, missionShapeProblems(interp.missionContract?.contract as never).join("; ") || "all present")
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
