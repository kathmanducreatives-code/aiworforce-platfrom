// The zero-Apify real-GPT test's evidence query and judge, against the real
// path with the model scripted (scripts/test-project/real-gpt/). The model-only
// run must PASS every automatic criterion; a run that buys from Apify, a
// mispriced model row and a missing compilation row must each FAIL.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sql } from "./lib/harness.ts";
import { runScenario, type Run } from "./lib/discoveryScenario.ts";
import { judgeRealGptRun, overall, type Json } from "../../scripts/test-project/real-gpt/realGptJudge.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const evidenceSql = Deno.readTextFileSync(new URL("../../scripts/test-project/real-gpt/real-gpt-evidence.sql", import.meta.url));

/** The kickoff transaction records the compilation under `kickoff:<queue>:…`; the harness records it as `offline:…`. */
async function asKickoff(r: Run) {
  await sql`update public.lead_execution_calls set logical_call_key = ${"kickoff:" + r.m.queueId + ":mission_compilation"}
             where workspace_id = ${r.m.ws} and logical_call_key like 'offline:mission_compilation%'`;
}
async function evidence(r: Run): Promise<Json> {
  const [row] = [...await sql.unsafe(evidenceSql.replace(":'queue_id'", `'${r.m.queueId}'`))] as Array<Record<string, Json>>;
  return Object.values(row)[0] as Json;
}
const failed = (vs: ReturnType<typeof judgeRealGptRun>) => vs.filter((v) => v.result === "FAIL").map((v) => v.id);

Deno.test("real-GPT judge: the zero-provider run passes every automatic criterion", opts, async () => {
  const r = await runScenario({ label: "judge-model-only", modelOnly: true });
  await asKickoff(r);
  const ev = await evidence(r);
  const vs = judgeRealGptRun(ev);
  assertEquals(failed(vs), [], JSON.stringify(vs.filter((v) => v.result === "FAIL"), null, 1));
  assertEquals(overall(vs), "PASS");
  assertEquals(vs.filter((v) => v.result === "MANUAL").map((v) => v.id), ["R4", "M6"], "the vendors' consoles stay the operator's");
  assertEquals(vs.length, 25);

  // A mispriced row is caught (M4); a missing compilation row is caught (M2).
  const mispriced = structuredClone(ev);
  mispriced.ledger.find((x: Json) => x.record_kind === "model_call" && x.source === "run").estimated_cost_usd = "0.000001";
  assert(failed(judgeRealGptRun(mispriced)).includes("M4"));
  const noCompile = structuredClone(ev);
  noCompile.ledger = noCompile.ledger.filter((x: Json) => x.source !== "kickoff");
  assert(failed(judgeRealGptRun(noCompile)).includes("M2"));
  // A misread mission is caught (I-series): a dropped size requirement, an invented one.
  const misread = structuredClone(ev);
  misread.lead_mission.criteria = misread.lead_mission.criteria.filter((c: Json) => c.dimension !== "company_size");
  misread.lead_mission.criteria.push({ kind: "hard", dimension: "stage", value: "seed", label: "Stage: seed" });
  assertEquals(failed(judgeRealGptRun(misread)).filter((id) => id.startsWith("I")), ["I4", "I6"]);
});

Deno.test("real-GPT judge: a run that buys from Apify fails the provider restriction", opts, async () => {
  const r = await runScenario({ label: "judge-normal" });
  await asKickoff(r);
  const vs = judgeRealGptRun(await evidence(r));
  const f = failed(vs);
  for (const id of ["R1", "R2", "R3", "T2"]) assert(f.includes(id), `${id} must fail: ${JSON.stringify(f)}`);
  assertEquals(overall(vs), "FAIL");
});

Deno.test("real-GPT judge: with no Apify token on the worker (the recommended first run) every automatic criterion still passes", opts, async () => {
  const r = await runScenario({ label: "judge-no-token", modelOnly: true, withoutApifyToken: true });
  await asKickoff(r);
  const vs = judgeRealGptRun(await evidence(r));
  assertEquals(failed(vs), [], JSON.stringify(vs.filter((v) => v.result === "FAIL"), null, 1));
  assertEquals(r.vendorRequests.length, 0, "nothing reached Apify");
});
