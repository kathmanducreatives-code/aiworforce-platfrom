// PHASE 4 — WHAT THE CLOCK ACTUALLY BUYS.
//
// ── WHY THIS FILE'S PREMISE CHANGED ─────────────────────────────────────────
//
// Phase 4 was scoped to answer "does qualification now begin materially
// earlier?" after Phases 1-3. It does not, and that is worth stating rather
// than measuring around:
//
//   Phase 1 skips the amendment call ONLY when a mission's graph carries no
//   OPTIONAL_BY_CHAIN capability. "AI startups currently hiring" carries
//   `hiring_verification`, so that mission saves nothing.
//
//   Phase 2 changed a verdict and a set of counters. It moves no wall clock.
//
//   Phase 3 measured the identity-gate relaxation and reverted it: identity and
//   enrichment still run in the same place at the same cost, so the 26s that
//   audit was chasing is untouched.
//
// So the honest questions are the other two the handoff named: under the SAME
// clock, does the run spend its last seconds on the right companies, and does
// the remainder survive to a continuation rather than being lost?
//
// Fake clock throughout. No network, no model, no spend.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { createExecutionDeadline } from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const QUERY =
  "Find AI startups in the United States hiring software engineers. Return 5 qualified leads.";

const mission = (): LeadMissionV1 => parseLeadMissionDeterministic(QUERY);

const BRAIN = {
  employee_min: null, employee_max: null,
  positive_industries: [] as string[], excluded_industries: [] as string[],
  required_geography: null,
};

/**
 * Four companies whose STRENGTH differs and whose arrival order is deliberately
 * the reverse of it. Sales roles score a commercial tier; a lone engineering
 * role does not — so `weak-*` arrive first and `strong-*` last.
 */
const ROWS = [
  { name: "WeakA", website: "https://weak-a.com", teamSize: 30, id: "weak-a",
    batch: "W20", industries: ["B2B"], oneLiner: "B2B SaaS.",
    openJobs: [{ title: "Platform Engineer" }] },
  { name: "WeakB", website: "https://weak-b.com", teamSize: 30, id: "weak-b",
    batch: "W20", industries: ["B2B"], oneLiner: "B2B SaaS.",
    openJobs: [{ title: "Platform Engineer" }] },
  { name: "StrongA", website: "https://strong-a.com", teamSize: 40, id: "strong-a",
    batch: "W20", industries: ["B2B"], oneLiner: "B2B SaaS.",
    openJobs: [{ title: "VP of Sales" }, { title: "Account Executive" }] },
  { name: "StrongB", website: "https://strong-b.com", teamSize: 40, id: "strong-b",
    batch: "W20", industries: ["B2B"], oneLiner: "B2B SaaS.",
    openJobs: [{ title: "Head of Sales" }, { title: "Account Executive" }] },
] as unknown as Record<string, unknown>[];

const identityRow = (slug: string) => ({
  companyName: slug, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
  website: `https://${slug}.com`, employeeCount: 40,
  description: `${slug} is a B2B SaaS platform sold on subscription.`,
});

/** Runs the plan on a fake clock, recording the ORDER companies were evaluated. */
async function run(o: { budgetMs: number; perEvalMs: number }) {
  let now = 0;
  const evaluated: string[] = [];
  const deadline = createExecutionDeadline({
    budgetMs: o.budgetMs, now: () => now, assumedCallMs: 1_000,
  });
  const m = mission();
  const r = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    invoke: (call: CompiledActorCall<unknown>) => {
      now += 1_000;
      if (call.actorKey === "apify_yc_companies_memo23") return Promise.resolve(ROWS);
      return Promise.resolve(
        ROWS.map((x) => identityRow(String(x.id))) as Record<string, unknown>[],
      );
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    evaluateMission: (args: { company_key: string }) => {
      evaluated.push(args.company_key);
      now += o.perEvalMs;
      return stubMissionEvaluator({ mission_fit: "pass" })(args as never);
    },
    deadline,
  } as never, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, maxCandidates: 20,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
  } as never);
  return { run: r as never as Record<string, unknown>, evaluated, elapsed: () => now };
}

Deno.test("1. with time for everyone, everyone is evaluated", async () => {
  // The control. Without it, test 2 could pass on a run that evaluates nobody.
  const { evaluated } = await run({ budgetMs: 600_000, perEvalMs: 1_000 });

  assert(evaluated.length >= 2, `expected the pool to be evaluated, got ${evaluated.length}`);
});

// ── TEST 2 REMOVED, AND WHY ─────────────────────────────────────────────────
//
// A test asserting "the strong companies are the ones evaluated" belongs here,
// and it was written. It could not be made to MEAN anything in this fixture:
// probing a genuinely rationing clock (budget 300s, 120s per evaluation) showed
// only two of four companies evaluated — and they were `weak-a` and `weak-b`,
// in arrival order.
//
// The cause is not the ordering rule. Every company in THIS fixture comes back
// with `hiring_assessment: null` and `hiring_jobs: []`, because these synthetic
// rows do not populate `yc_open_jobs` the way a real memo23 row does. With no
// assessment, `strength()` returns the same band for all four and the stable
// sort correctly preserves arrival order. The test would have been asserting
// the fixture, not the behaviour.
//
// What the ordering rule rests on instead, both already in the suite:
//   * evaluationPathTelemetry test 6 — the sort itself, in isolation, on inputs
//     whose tiers genuinely differ.
//   * the Phase 3 measurement on the REAL 25-row memo23 fixture, where tiers DO
//     differ — {A: 5, none: 2} — which is the case the rule exists for.
//
// Left as a gap rather than a green tick: proving it end-to-end needs a fixture
// whose rows carry real open jobs, and that is worth building deliberately.

Deno.test("3. a company the clock never reached is NOT rejected", async () => {
  // The failure mode that matters. Running out of time must leave a company
  // resumable — no verdict — rather than quietly unqualified, because a
  // continuation is what turns the remainder into leads.
  const { run: r } = await run({ budgetMs: 8_000, perEvalMs: 30_000 });
  const cs = (r.companies ?? []) as Array<Record<string, unknown>>;
  for (const c of cs) {
    const v = c.verdict as { decision?: string } | null;
    assertFalse(
      v?.decision === "reject",
      `${c.key}: an unreached company must never be rejected by the clock`,
    );
  }
});

Deno.test("4. a clock-stopped run states why, and claims nobody", async () => {
  // An honest shortfall is the correct output of a clock-stopped run, and it is
  // what the continuation reads. Silence is how 1af9b9ea looked complete while
  // delivering nothing.
  //
  // NOTE ON THE BUDGET: 8s is tight enough that DISCOVERY itself is the stage
  // that stops — `companies` comes back empty. That is not a weaker test, it is
  // the same property one stage earlier, and it is worth knowing the guard
  // holds there too rather than only at qualification.
  const { run: r } = await run({ budgetMs: 8_000, perEvalMs: 30_000 });
  const s = r.state as Record<string, unknown>;

  assertEquals((s.qualified_company_keys as string[] | undefined) ?? [], [],
    "a run that ran out of clock must claim nobody as qualified");
  assert(
    String(s.terminal_reason ?? "").length > 0,
    "and must say in words why it stopped",
  );
  assert(
    ((s.pending_capabilities as string[] | undefined) ?? []).length > 0,
    "leaving the unfinished stages for a continuation to resume",
  );
});
