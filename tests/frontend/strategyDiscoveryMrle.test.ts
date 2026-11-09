// MRLE Workbench: the panel shows what the BACKEND decided — how each requirement is checked,
// the questions a blocked plan asks, the outcome (shortfall included) and each company's
// business-model evidence. Fixtures: the simulation generated from the real service
// (scripts/dev/mrle-simulation.ts; synthetic .example companies, mocked providers).
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readOutcome, readStrategyPlan, readStrategyRun, routeLine, runStrategy, spendLine, type Invoke } from "../../src/lib/strategyDiscovery.ts";
import { simulatedInvoke, strategyDiscoveryMockMode } from "../../src/lib/strategyDiscoveryMock.ts";

const sim = JSON.parse(await Deno.readTextFile(new URL("../../src/lib/__fixtures__/strategyDiscoverySimulation.json", import.meta.url)));

Deno.test("simulation is labelled and synthetic", () => {
  assertEquals(sim.simulated, true);
  const names = JSON.stringify(sim.run.body.queue) + JSON.stringify(sim.run.body.review);
  assertFalse(/https?:\/\/(?![a-z0-9.-]*\.example\b|www\.linkedin\.com)/i.test(names.replace(/\\\//g, "/")), "only .example sites (and synthetic LinkedIn slugs)");
});

Deno.test("plan: every requirement says how it will be checked; REQUIRED B2B is checked on the company's own website", () => {
  const p = readStrategyPlan(sim.plan.body)!;
  assertEquals(p.status, "ready");
  const lines = p.requirements.map((r) => `${r.necessity} ${r.label}: ${routeLine(r)}`);
  assert(lines.some((l) => /required Business model: B2B: Checked by the company's own website/.test(l)), lines.join("\n"));
  assert(lines.some((l) => /required Hiring: .*Checked by dated job postings/.test(l)), lines.join("\n"));
  assert(p.interpretation.assumptions.some((a) => a.includes("30 days")), "the default hiring window is shown as an assumption");
});

Deno.test("blocked plan: the question names the unchecked requirement and offers review-only; the re-plan is ready", () => {
  const b = readStrategyPlan(sim.blockedPlan.body)!;
  assertEquals(b.status, "blocked");
  assert(b.questions.length >= 1 && b.questions.every((q) => q.includes("review-only")), JSON.stringify(b.questions));
  assert(b.requirements.length === 0 || b.requirements.some((r) => r.route === "not_checkable"));
  const r = readStrategyPlan(sim.reviewOnlyPlan.body)!;
  assertEquals(r.status, "ready");
  assert(r.requirements.some((x) => x.route === "not_checkable" && /Business model/.test(x.label)), "review-only keeps the requirement visibly unchecked");
});

Deno.test("run: outcome with shortfall, grouped companies, business-model evidence with quote and source", () => {
  const run = readStrategyRun(sim.run.body)!;
  assertEquals(run.outcome?.status, "completed_with_shortfall");
  assertStringIncludes(run.outcome!.summary, "of 5 requested");
  const q = run.companies.filter((c) => c.verdict === "qualified");
  assertEquals(q.map((c) => c.name), ["Northwind Ledger"]);
  assertEquals(q[0].businessModel?.status, "verified_b2b");
  assert(q[0].businessModel?.quote && q[0].businessModel.url?.startsWith("https://northwind.example"));
  assertEquals(q[0].location, "Austin, United States");
  assert(run.companies.filter((c) => c.verdict === "pending").every((c) => c.businessModel?.status !== "verified_b2b"), "an unverified company is never shown as verified B2B");
  assertStringIncludes(spendLine(run.outcome!.spend), "estimated");
});

Deno.test("a failed run (409 with outcome) is shown as that outcome, never as 'no response'", async () => {
  const failed = { error: "discovery failed: job search failed (Error); counted at its worst case, not retried", outcome: { status: "failed", summary: "The run stopped on an error.", nextStep: "Nothing is retried automatically.", requested: 5, qualified: 0, needsVerification: 0, rejected: 0, shortfall: 5, spend: { apifyUsd: 0.021, leadoceanRecords: 0, basis: "estimate" } }, steps: [], spend: { apifyUsd: 0.021, leadoceanRecords: 0 } };
  const invoke: Invoke = (() => Promise.resolve({ data: null, error: Object.assign(new Error("409"), { context: new Response(JSON.stringify(failed), { status: 409 }) }) })) as Invoke;
  const plan = readStrategyPlan(sim.plan.body)!;
  const r = await runStrategy(invoke, { workspaceId: "w", messageId: "m", query: "q", choice: "auto" }, plan);
  assert(r.ok);
  assertEquals(r.value!.outcome?.status, "failed");
  assertEquals(r.value!.companies.length, 0);
  assertEquals(readOutcome({ status: "made_up", summary: "x" }), null, "an unknown outcome is never guessed");
});

Deno.test("the simulation is development-only: off in production builds and unless explicitly asked for", async () => {
  assertEquals(strategyDiscoveryMockMode({ DEV: false, VITE_STRATEGY_DISCOVERY_MOCK: "true" }), "off");
  assertEquals(strategyDiscoveryMockMode({ DEV: true }), "off");
  assertEquals(strategyDiscoveryMockMode({ DEV: true, VITE_STRATEGY_DISCOVERY_MOCK: "true" }), "ready");
  assertEquals(strategyDiscoveryMockMode({ DEV: true, VITE_STRATEGY_DISCOVERY_MOCK: "blocked" }), "blocked");
  const inv = simulatedInvoke("blocked", sim, 0);
  const blocked = await inv<Record<string, unknown>>("lead-pipeline", { action: "strategy_plan" });
  assertEquals(blocked.data, null);
  const ro = await inv<Record<string, unknown>>("lead-pipeline", { action: "strategy_plan", allow_review_only: true });
  assertEquals((ro.data as { status: string }).status, "ready");
});

Deno.test("Workbench link: the run's plan id is read from the backend; absent, malformed or empty means no Workbench button", () => {
  const base = sim.run.body;
  assertEquals(readStrategyRun({ ...base, workbench: { planId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" } })!.workbenchPlanId, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
  for (const w of [undefined, null, {}, { planId: "" }, { planId: 7 }, "x"]) assertEquals(readStrategyRun({ ...base, workbench: w })!.workbenchPlanId, null, JSON.stringify(w));
});
