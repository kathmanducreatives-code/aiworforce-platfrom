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
// <out>/kickoff.json (body, compiled mission, ledger rows, authorization) and
// <out>/interpretation.txt (I1–I8). Exits 1 if any interpretation check fails:
// a misread mission is never queued.
import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";
import { buildMissionCompilerBinding } from "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts";
import { lunaOnlyFetch, prepareKickoff } from "./prepareKickoff.ts";

const a = parseArgs(Deno.args, {
  string: ["approved-by", "out", "workspace", "user", "pricing-version", "jobs-max", "details-max", "observed-at", "price-source", "queue", "plan", "proposal"],
});
const need = (k: string) => { const v = a[k]; if (!v) { console.error(`--${k} is required`); Deno.exit(2); } return String(v); };
need("approved-by");
const out = need("out");
const proposalFile = a.proposal ? String(a.proposal) : null;
if (!proposalFile && !Deno.env.get("OPENAI_API_KEY")) { console.error("OPENAI_API_KEY (the TEST project's key) is required, or --proposal for a dry run"); Deno.exit(2); }
const workspaceId = need("workspace");
const catalog = JSON.parse(Deno.readTextFileSync(new URL("../../../docs/launch/proposals/smoke-catalog-two-actor.json", import.meta.url))).approved_quotes;

// Luna only, ≤ 2 calls, the Luna template's bounds: refused before sending otherwise.
// A dry run allows ZERO calls: the gate refuses anything at all.
const gate = lunaOnlyFetch(globalThis.fetch.bind(globalThis), proposalFile ? { maxCalls: 0 } : {});
globalThis.fetch = gate.fetch;
const k = await prepareKickoff({
  workspace_id: workspaceId, user_id: need("user"),
  queue_id: a.queue ?? crypto.randomUUID(), plan_id: a.plan ?? crypto.randomUUID(),
  pricing_version: need("pricing-version"), catalog,
  prices: { jobs_maximum_microusd: Number(need("jobs-max")), details_maximum_microusd: Number(need("details-max")),
    observed_at: need("observed-at"), source: need("price-source") },
  compile: proposalFile
    ? () => Promise.resolve(JSON.parse(Deno.readTextFileSync(proposalFile)))
    : (mission, onModelCall) =>
      buildMissionCompilerBinding({ workspaceId, onModelCall }).proposeMission!({ originalUserQuery: mission, requestedCount: 1 }),
});
console.log(`compile gate: ${gate.sent.length} request(s) sent ${JSON.stringify(gate.sent)}; refused ${JSON.stringify(gate.refused)}`);
Deno.mkdirSync(out, { recursive: true });
Deno.writeTextFileSync(`${out}/kickoff.sql`, k.sql);
Deno.writeTextFileSync(`${out}/kickoff.json`, JSON.stringify(k, null, 2));
const report = k.interpretation.map((v) => `${v.result.padEnd(4)} ${v.id} ${v.criterion}\n     observed: ${v.observed}`).join("\n");
Deno.writeTextFileSync(`${out}/interpretation.txt`, report + "\n");
console.log(report);
for (const r of k.compile_ledger_rows) {
  const m = r.metadata ?? {};
  console.log(`compile: ${m.model} in=${m.input_tokens} cached=${m.cached_input_tokens} out=${m.output_tokens} est=$${r.estimated_cost_usd}`);
}
const ok = k.interpretation.every((v) => v.result === "PASS");
console.log(ok ? `\nINTERPRETATION PASS — review ${out}/kickoff.sql before running it` : "\nINTERPRETATION FAIL — do not queue");
Deno.exit(ok ? 0 : 1);
