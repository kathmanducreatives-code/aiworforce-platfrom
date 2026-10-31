// PREPARE THE ZERO-APIFY REAL-GPT KICKOFF. Makes the real mission compilation
// (Luna only, at most 2 requests, each within the Luna template's 30,720-byte /
// 4,000-token bound: ≤ 2 × $0.01248 committed; ≈ $0.006 expected) and writes
// files only: it never connects to a database. Refuses to run without the
// approval flag, because the compile is a paid call.
//
//   OPENAI_API_KEY=<test project key> deno run --allow-env --allow-net=api.openai.com --allow-read --allow-write=<out> \
//     scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts \
//       --approved-by "<name, date>" --out <dir> \
//       --workspace <uuid> --user <uuid> --pricing-version <v> \
//       --jobs-max <µ$> --details-max <µ$> --observed-at <ISO> --price-source "<where>"
//
// DRY RUN (TEST acceptance step 2, no model call at all): pass
// `--proposal docs/launch/proposals/a7-reviewed-mission-proposal.json` instead
// of OPENAI_API_KEY. The reviewed proposal is compiled offline; nothing is sent
// and the compile ledger is empty.
//
// Writes <out>/kickoff.sql (the one transaction to review and run),
// <out>/kickoff.json (body, compiled mission, the raw model proposal and the
// compiler's changes to it, ledger rows, authorization) and
// <out>/interpretation.txt (I1–I8). Exits 1 if any interpretation check fails:
// a misread mission is never queued.
//
// THE FIVE-COMPANY DEMO (`--scenario demo_funding`): "Find 5 US companies
// hiring Account Executives that raised funding within the last six months."
// Also requires `--project-ref <isolated TEST ref>` (production refs are
// refused) and the funding verifiers' observed maxima `--atomus-max` and
// `--pvalyou-max` (µ$); uses docs/launch/proposals/smoke-catalog-demo-funding.json;
// judges D1–D7 instead of I1–I8. Every window the request did not state (the
// 30-day hiring default) is printed and written as ASSUMED; the run exits 3
// until `--acknowledge-defaults` records that the operator accepted it. Every
// actor is still authorized for ZERO starts.
//
// THE FIRST REAL-APIFY CANARY (`--scenario canary_funding`): the same request
// for ONE company, over docs/launch/proposals/smoke-catalog-canary-funding.json
// (jobs, details, Atomus; no Pvalyou). Needs `--project-ref` and `--atomus-max`.
// ZERO starts unless `--authorize-paid "<approver, date>"`: then one start each
// for jobs, details and Atomus (the catalog's proposed paid limits) and the SQL
// header names the approval and the worst-case provider spend.
import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";
import { buildMissionCompilerBinding } from "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts";
import { lunaOnlyFetch, prepareKickoff } from "./prepareKickoff.ts";
import { CANARY_CATALOG_PATH } from "../canary/validate-kickoff.ts";

const a = parseArgs(Deno.args, {
  string: ["approved-by", "out", "workspace", "user", "pricing-version", "jobs-max", "details-max", "observed-at", "price-source", "queue", "plan", "proposal",
    "scenario", "project-ref", "atomus-max", "pvalyou-max", "authorize-paid", "expected-sha", "catalog"],
  boolean: ["acknowledge-defaults"],
});
const need = (k: string) => { const v = a[k]; if (!v) { console.error(`--${k} is required`); Deno.exit(2); } return String(v); };
need("approved-by");
const out = need("out");
const proposalFile = a.proposal ? String(a.proposal) : null;
if (!proposalFile && !Deno.env.get("OPENAI_API_KEY")) { console.error("OPENAI_API_KEY (the TEST project's key) is required, or --proposal for a dry run"); Deno.exit(2); }
const workspaceId = need("workspace");
const scenario = (a.scenario ?? "a7") as "a7" | "demo_funding" | "canary_funding";
if (!["a7", "demo_funding", "canary_funding"].includes(scenario)) { console.error("--scenario must be a7, demo_funding or canary_funding"); Deno.exit(2); }
const funding = scenario !== "a7";
// THE CONTRACT NAMES ITS CATALOG (canary_funding only), and only a reviewed
// canary-funding catalog may be named; whether its maxima stay within the
// reviewed ceilings is `validate-kickoff.ts` K11's question.
if (a.catalog && scenario !== "canary_funding") { console.error("--catalog is for --scenario canary_funding only"); Deno.exit(2); }
if (a.catalog && !CANARY_CATALOG_PATH.test(String(a.catalog))) { console.error(`--catalog must be a reviewed canary-funding catalog: ${a.catalog}`); Deno.exit(2); }
const catalogFile = a.catalog ? String(a.catalog).replace("docs/launch/proposals/", "")
  : scenario === "demo_funding" ? "smoke-catalog-demo-funding.json"
  : scenario === "canary_funding" ? "smoke-catalog-canary-funding.json" : "smoke-catalog-two-actor.json";
const catalogDoc = JSON.parse(Deno.readTextFileSync(new URL(`../../../docs/launch/proposals/${catalogFile}`, import.meta.url)));
const catalog = catalogDoc.approved_quotes;
if (a["authorize-paid"] && scenario !== "canary_funding") { console.error("--authorize-paid is for --scenario canary_funding only"); Deno.exit(2); }
const paid = a["authorize-paid"]
  ? { approved_by: String(a["authorize-paid"]), actor_limits: Object.fromEntries(
    Object.entries(catalogDoc.actor_limits_proposed_for_paid_canary).filter(([k]) => k !== "note")) as Record<string, number> }
  : undefined;

// THE COMMIT THIS KICKOFF RUNS FROM, read from .git (no subprocess), stamped
// into the mission's planner_runtime. With --expected-sha (the reviewed SHA)
// any other checkout is refused.
function checkoutCommit(): string | null {
  try {
    const git = new URL("../../../.git/", import.meta.url);
    const head = Deno.readTextFileSync(new URL("HEAD", git)).trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5);
    try { return Deno.readTextFileSync(new URL(ref, git)).trim(); } catch { /* packed */ }
    const line = Deno.readTextFileSync(new URL("packed-refs", git)).split("\n").find((l) => l.endsWith(` ${ref}`));
    return line ? line.split(" ")[0] : null;
  } catch { return null; }
}
const commit = checkoutCommit();
if (a["expected-sha"] && commit !== a["expected-sha"]) {
  console.error(`checkout is ${commit ?? "unknown"}, not the reviewed --expected-sha ${a["expected-sha"]}`);
  Deno.exit(2);
}

// Luna only, ≤ 2 calls, the Luna template's bounds: refused before sending otherwise.
// A dry run allows ZERO calls: the gate refuses anything at all.
const gate = lunaOnlyFetch(globalThis.fetch.bind(globalThis), proposalFile ? { maxCalls: 0 } : {});
globalThis.fetch = gate.fetch;
const k = await prepareKickoff({
  scenario, project_ref: funding ? need("project-ref") : a["project-ref"], paid,
  ...(commit && /^[0-9a-f]{40}$/.test(commit) ? { planner_commit: commit } : {}),
  workspace_id: workspaceId, user_id: need("user"),
  queue_id: a.queue ?? crypto.randomUUID(), plan_id: a.plan ?? crypto.randomUUID(),
  pricing_version: need("pricing-version"), catalog,
  prices: { jobs_maximum_microusd: Number(need("jobs-max")), details_maximum_microusd: Number(need("details-max")),
    observed_at: need("observed-at"), source: need("price-source"),
    ...(scenario === "demo_funding" ? { atomus_maximum_microusd: Number(need("atomus-max")), pvalyou_maximum_microusd: Number(need("pvalyou-max")) } : {}),
    ...(scenario === "canary_funding" ? { atomus_maximum_microusd: Number(need("atomus-max")) } : {}) },
  compile: proposalFile
    ? () => Promise.resolve(JSON.parse(Deno.readTextFileSync(proposalFile)))
    : (mission, onModelCall) =>
      buildMissionCompilerBinding({ workspaceId, onModelCall }).proposeMission!({ originalUserQuery: mission,
        requestedCount: scenario === "demo_funding" ? 5 : 1 }),
});
console.log(`compile gate: ${gate.sent.length} request(s) sent ${JSON.stringify(gate.sent)}; refused ${JSON.stringify(gate.refused)}`);
Deno.mkdirSync(out, { recursive: true });
Deno.writeTextFileSync(`${out}/kickoff.sql`, k.sql);
Deno.writeTextFileSync(`${out}/kickoff.json`, JSON.stringify(k, null, 2));
const assumed = k.disclosures.map((d) => `ASSUMED  ${d}`).join("\n");
const report = k.interpretation.map((v) => `${v.result.padEnd(4)} ${v.id} ${v.criterion}\n     observed: ${v.observed}`).join("\n") +
  (assumed ? `\n\n${assumed}` : "");
Deno.writeTextFileSync(`${out}/interpretation.txt`, report + "\n");
console.log(report);
for (const r of k.compile_ledger_rows) {
  const m = r.metadata ?? {};
  console.log(`compile: ${m.model} in=${m.input_tokens} cached=${m.cached_input_tokens} out=${m.output_tokens} est=$${r.estimated_cost_usd}`);
}
const ok = k.interpretation.every((v) => v.result === "PASS");
if (!ok) { console.log("\nINTERPRETATION FAIL — do not queue"); Deno.exit(1); }
if (k.disclosures.length && !a["acknowledge-defaults"]) {
  console.log("\nINTERPRETATION PASS, BUT IT ASSUMES WHAT THE REQUEST DID NOT STATE (above). " +
    "Re-run with --acknowledge-defaults once that is accepted; do not queue until then.");
  Deno.exit(3);
}
console.log(`\nINTERPRETATION PASS — review ${out}/kickoff.sql before running it`);
Deno.exit(0);
