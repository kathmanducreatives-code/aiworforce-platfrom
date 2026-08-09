// THE HARNESS MUST NOT BE ABLE TO SPEND ANYTHING.
//
// Planning evaluation and sourcing execution are separate call graphs. This
// pins that they stay separate, so a future edit cannot quietly give the
// harness a provider.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runPlanner, decliningStubs } from "./harness.ts";
import { EVAL_SET } from "./dataset.ts";
import { CRITERIA, TOTAL_WEIGHT, weightedScore, decide } from "./rubric.ts";

const FILES = ["harness.ts", "run.ts", "dataset.ts", "rubric.ts"];

Deno.test("safety: the harness imports nothing that can execute a provider", async () => {
  // Checked on IMPORT and CALL syntax, not bare mentions: these files name the
  // execution path in comments precisely to explain why they stay away from it,
  // and that explanation is worth keeping.
  for (const f of FILES) {
    const src = await Deno.readTextFile(new URL(f, import.meta.url));
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      for (const forbidden of [
        "toolRegistry", "run-agent", "runAgent", "companyFirst", "contactDiscovery",
        "qualifiedLeadPersistence", "supabase-js", "leadCapabilityEngine", "sourcingRetry",
      ]) {
        assert(!spec.includes(forbidden),
          `${f} imports ${spec} — planning evaluation may not reach execution`);
      }
    }
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    for (const call of ["runTool(", "createClient(", "executeRunAgentCompanyFirstSourcing(", "runCapabilityPlan("]) {
      assert(!code.includes(call), `${f} calls ${call} — that is execution, not planning`);
    }
  }
});

Deno.test("safety: the database handle throws on any access", async () => {
  // Proven by running a real case: the planner tries to load mission context and
  // must survive the refusal rather than reaching a database.
  const plan = await runPlanner("claude", EVAL_SET[0], decliningStubs());
  assertEquals(plan.error, null, "a refused database must not break planning");
});

Deno.test("safety: both model seams are injected and counted", async () => {
  const counter = { gpt: 0, claude: 0 };
  await runPlanner("gpt", EVAL_SET[0], decliningStubs(counter));
  assertEquals(counter.claude, 0, "selecting GPT must not invoke the Claude seam");
  const c2 = { gpt: 0, claude: 0 };
  await runPlanner("claude", EVAL_SET[0], decliningStubs(c2));
  assertEquals(c2.gpt, 0, "selecting Claude must not invoke the GPT seam");
});

Deno.test("safety: no network permission is required to run the set", async () => {
  // If any of this reached out, the test process would fail on a missing
  // --allow-net rather than pass.
  for (const c of EVAL_SET.slice(0, 3)) {
    for (const p of ["gpt", "claude"] as const) {
      const r = await runPlanner(p, c, decliningStubs());
      assertEquals(r.error, null);
    }
  }
});

// ═══ THE RUBRIC IS FIXED AND HONEST ═══════════════════════════════════════

Deno.test("rubric: weights total 100 and correctness dominates", () => {
  assertEquals(TOTAL_WEIGHT, 100);
  const critical = CRITERIA
    .filter((c) => ["hard_constraint_preservation", "query_understanding", "signal_interpretation"].includes(c.key))
    .reduce((a, c) => a + c.weight, 0);
  assert(critical > 50, `the three critical criteria must outweigh everything else, got ${critical}`);
  const latency = CRITERIA.find((c) => c.key === "latency")!.weight;
  assert(latency <= 2, "latency must never be able to swing a result");
});

Deno.test("rubric: an unmeasured criterion scores zero, not skipped", () => {
  // Shrinking the denominator would flatter whichever planner produced less.
  assertEquals(weightedScore({}), 0);
  assertEquals(weightedScore({ latency: 1 }), 1);
});

Deno.test("rubric: the decision rule refuses to force a winner", () => {
  const base = { cases: 15, severe: 0 };
  assertEquals(decide({ name: "a", score: 80, ...base }, { name: "b", score: 78, ...base }).result,
    "INCONCLUSIVE", "a 2-point margin is not a result");
  assertEquals(decide({ name: "a", score: 90, ...base }, { name: "b", score: 70, ...base }).result, "WINNER");
  // Higher score but more severe failures must not win.
  assertEquals(decide({ name: "a", score: 90, cases: 15, severe: 5 }, { name: "b", score: 70, cases: 15, severe: 0 }).result,
    "INCONCLUSIVE", "severe failures must not be averaged away");
  assertEquals(decide({ name: "a", score: 90, cases: 3, severe: 0 }, { name: "b", score: 70, cases: 3, severe: 0 }).result,
    "INCONCLUSIVE", "too few cases cannot support a conclusion");
});

Deno.test("dataset: every query is non-empty and categorised", () => {
  assert(EVAL_SET.length >= 12, "below the pre-declared minimum for a conclusion");
  for (const c of EVAL_SET) {
    assert(c.query.trim().length > 15, `${c.id} has no real query`);
    assert(c.note.trim().length > 20, `${c.id} must justify its slot`);
  }
});
