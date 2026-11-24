// The five-company demo kickoff (`--scenario demo_funding`), prepared offline
// from the reviewed proposal: its interpretation checks, the assumed 30-day
// hiring window disclosed for approval, the funding verifiers in the catalog at
// ZERO starts, and the project guard. Plus the TEST worker's isolation: exactly
// one Lead V2 workspace, no unproven-provider probe. No network, no database.
import { assert, assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  A7_MISSION, ATOMUS_ACTOR, DEMO_FUNDING_MISSION, DETAILS_ACTOR, JOBS_ACTOR, prepareKickoff, PVALYOU_ACTOR,
  type KickoffInput,
} from "../../../scripts/test-project/real-gpt/prepareKickoff.ts";
import { assumedWindowDisclosures, judgeDemoFundingInterpretation } from "../../../scripts/test-project/real-gpt/demoFundingJudge.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";

const read = (p: string) => Deno.readTextFileSync(new URL(`../../../${p}`, import.meta.url));
const PROPOSAL = JSON.parse(read("docs/launch/proposals/demo-funding-reviewed-mission-proposal.json"));
const CATALOG = JSON.parse(read("docs/launch/proposals/smoke-catalog-demo-funding.json"));

const input = (over: Partial<KickoffInput> = {}): KickoffInput => ({
  scenario: "demo_funding", project_ref: "abcdefghijklmnopqrst",
  workspace_id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222",
  queue_id: "33333333-3333-4333-8333-333333333333", plan_id: "44444444-4444-4444-8444-444444444444",
  pricing_version: "contract", catalog: CATALOG.approved_quotes,
  prices: { jobs_maximum_microusd: 5000, details_maximum_microusd: 4000, atomus_maximum_microusd: 17550,
    pvalyou_maximum_microusd: 40050, observed_at: "2026-10-28T00:00:00Z", source: "test" },
  compile: () => Promise.resolve(structuredClone(PROPOSAL)),
  ...over,
});

Deno.test("demo kickoff: the reviewed proposal passes D1–D7, five companies, hiring and funding windows separate", async () => {
  const k = await prepareKickoff(input());
  assertEquals(k.scenario, "demo_funding");
  assertEquals(k.interpretation.map((v) => `${v.id}:${v.result}`), ["D1:PASS", "D2:PASS", "D3:PASS", "D4:PASS", "D5:PASS", "D6:PASS", "D7:PASS"]);
  assertEquals((k.request as { requested_lead_count: number }).requested_lead_count, 5);
  assertEquals((k.request as { instruction: string }).instruction, DEMO_FUNDING_MISSION);
  const signals = (k.compiled_mission.required_signals as Array<{ event?: string; type?: string; timeframe_days?: number }>)
    .map((s) => [s.event ?? s.type, s.timeframe_days]);
  assertEquals(signals, [["hiring", 30], ["funding", 180]]);
});

Deno.test("demo kickoff: the assumed 30-day hiring window is disclosed for approval, in the artifacts and the SQL", async () => {
  const k = await prepareKickoff(input());
  assertEquals(k.disclosures.length, 1);
  assertStringIncludes(k.disclosures[0], "last 30 days is Agentory's default");
  assertStringIncludes(k.disclosures[0], "the request states no hiring timeframe");
  assertStringIncludes(k.sql, `-- ASSUMED, NOT STATED BY THE USER: ${k.disclosures[0]}`);
  // A window the user did state is never listed as assumed.
  assert(!k.disclosures.some((d) => /funding/i.test(d)));
});

Deno.test("demo kickoff: the funding verifiers are in the catalog, and every actor is authorized for ZERO starts", async () => {
  const k = await prepareKickoff(input());
  assertEquals(k.authorization.actor_limits, { [JOBS_ACTOR]: 0, [DETAILS_ACTOR]: 0, [ATOMUS_ACTOR]: 0, [PVALYOU_ACTOR]: 0 });
  const q = k.authorization.quotes as Record<string, { allowed_actors: string[]; maximum_microusd: number; request_limits: Record<string, unknown> }>;
  assertEquals(q.atomus.allowed_actors, [ATOMUS_ACTOR]);
  assertEquals(q.atomus.maximum_microusd, 17550);
  assertEquals(q.pvalyou.maximum_microusd, 40050);
  assertEquals((q.pvalyou.request_limits.pin_body as { tier: string }).tier, "basic", "Pvalyou's cheap tier is pinned by the gate");
  assertEquals(CATALOG.live_execution, "blocked");
  assertEquals(CATALOG.approved_quotes.atomus.observed_at, null, "no price is observed in the proposal itself");
});

Deno.test("demo kickoff: production refs are refused; the demo needs an explicit TEST ref and observed funding prices", async () => {
  for (const ref of ["ohsdatpvfdjdemstoiuj", "wqnigjhcwjxtmordrwno"]) {
    await assertRejects(() => prepareKickoff(input({ project_ref: ref })), Error, "not a non-production project");
    // Also for A7, when a ref is given.
    await assertRejects(() => prepareKickoff(input({ scenario: "a7", project_ref: ref })), Error, "not a non-production project");
  }
  await assertRejects(() => prepareKickoff(input({ project_ref: undefined })), Error, "needs project_ref");
  await assertRejects(() => prepareKickoff(input({ prices: { ...input().prices, atomus_maximum_microusd: undefined } })),
    Error, "atomus_maximum_microusd");
});

Deno.test("demo judge: a mission compiled as people, or with the windows merged, fails", () => {
  const ok = compileLeadMission({ originalUserQuery: DEMO_FUNDING_MISSION, proposal: structuredClone(PROPOSAL), requestedCount: 5 }).final_mission;
  const asPeople = { ...ok, target_entity: "person", requested_output: "contact_ready_leads", decision_makers: { roles: ["Founder"] } };
  assertEquals(judgeDemoFundingInterpretation(asPeople as never).find((v) => v.id === "D1")!.result, "FAIL");
  const merged = { ...ok, required_signals: ok.required_signals.map((s) => ({ ...s, timeframe_days: 180 })) };
  assertEquals(judgeDemoFundingInterpretation(merged as never).find((v) => v.id === "D6")!.result, "FAIL");
  assertEquals(assumedWindowDisclosures({ criteria: [] }), []);
});

Deno.test("A7 kickoff unchanged: default scenario, A7 sentence, two actors, no disclosures required by the CLI", () => {
  const cli = read("scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts");
  assertStringIncludes(cli, 'const scenario = (a.scenario ?? "a7")');
  assertStringIncludes(cli, '"smoke-catalog-two-actor.json"');
  assertStringIncludes(cli, "Deno.exit(3)");
  assert(A7_MISSION.startsWith("Find 1 US B2B software company"));
});

Deno.test("TEST worker isolation: exactly one Lead V2 workspace, no unproven-provider probe, production refused", () => {
  const wf = read(".github/workflows/discovery-test-worker.yml");
  assertStringIncludes(wf, "LEAD_V2_WORKER_WORKSPACES: ${{ vars.TEST_WORKSPACE_ID }}");
  for (const v of ["LEAD_V2_PROVIDER_PROBE_WORKSPACES", "LEAD_V2_PROVIDER_PROBE_ROUTES", "LEAD_V2_ALLOW_EXPERIMENTAL_ROUTES"]) {
    assert(!wf.includes(v), `${v} must never be set for the TEST worker`);
  }
  assertStringIncludes(wf, "ohsdatpvfdjdemstoiuj|wqnigjhcwjxtmordrwno)");
  assertStringIncludes(wf, "DISCOVERY_SMOKE_ADMISSION: enforce");
});

// ── THE FIRST REAL-APIFY CANARY (`--scenario canary_funding`) ────────────────
const CANARY_CATALOG = JSON.parse(read("docs/launch/proposals/smoke-catalog-canary-funding.json"));
const CANARY_PROPOSAL = JSON.parse(read("docs/launch/proposals/canary-funding-reviewed-mission-proposal.json"));
const canaryInput = (over: Partial<KickoffInput> = {}): KickoffInput => input({
  scenario: "canary_funding", catalog: CANARY_CATALOG.approved_quotes,
  prices: { jobs_maximum_microusd: 4000, details_maximum_microusd: 4050, atomus_maximum_microusd: 10550,
    observed_at: "2026-10-28T00:00:00Z", source: "test" },
  compile: () => Promise.resolve(structuredClone(CANARY_PROPOSAL)),
  ...over,
});
const PAID = Object.fromEntries(Object.entries(CANARY_CATALOG.actor_limits_proposed_for_paid_canary).filter(([k]) => k !== "note")) as Record<string, number>;

Deno.test("canary kickoff: the user's sentence, ONE company, D1–D7 pass, both windows kept, the hiring default disclosed", async () => {
  const k = await prepareKickoff(canaryInput());
  assertEquals((k.request as { instruction: string }).instruction,
    "Find one US company hiring Account Executives that raised funding within the last six months.");
  assertEquals((k.request as { requested_lead_count: number }).requested_lead_count, 1);
  assertEquals(k.interpretation.map((v) => `${v.id}:${v.result}`), ["D1:PASS", "D2:PASS", "D3:PASS", "D4:PASS", "D5:PASS", "D6:PASS", "D7:PASS"]);
  assertEquals(k.interpretation.find((v) => v.id === "D2")!.criterion, "1 company is requested");
  const signals = (k.compiled_mission.required_signals as Array<{ event?: string; type?: string; timeframe_days?: number }>)
    .map((s) => [s.event ?? s.type, s.timeframe_days]);
  assertEquals(signals, [["hiring", 30], ["funding", 180]], "nothing dropped, the windows are not merged");
  assertStringIncludes(k.sql, "-- ASSUMED, NOT STATED BY THE USER: Hiring");
  // A five-company reading of the one-company request fails D2.
  const five = { ...k.compiled_mission, requested_count: 5 };
  assertEquals(judgeDemoFundingInterpretation(five as never, 1).find((v) => v.id === "D2")!.result, "FAIL");
});

Deno.test("canary kickoff: ZERO starts by default — jobs, details and Atomus only, no Pvalyou template", async () => {
  const k = await prepareKickoff(canaryInput());
  assertEquals(k.authorization.actor_limits, { [JOBS_ACTOR]: 0, [DETAILS_ACTOR]: 0, [ATOMUS_ACTOR]: 0 });
  const q = k.authorization.quotes as Record<string, unknown>;
  assertEquals(Object.keys(q).sort(), ["atomus", "details", "jobs", "model", "reads"]);
  assertStringIncludes(k.sql, "-- ZERO STARTS: this authorization purchases nothing.");
  assert(!k.sql.includes(PVALYOU_ACTOR), "no paid fallback can be authorized");
});

Deno.test("canary kickoff: a PAID authorization needs a named approval, and allows at most one start per approved actor", async () => {
  const k = await prepareKickoff(canaryInput({ paid: { approved_by: "Operator, 2026-10-29", actor_limits: PAID } }));
  assertEquals(k.authorization.actor_limits, { [JOBS_ACTOR]: 1, [DETAILS_ACTOR]: 1, [ATOMUS_ACTOR]: 1 });
  assertStringIncludes(k.sql, "-- PAID: APPROVED BY Operator, 2026-10-29.");
  assertStringIncludes(k.sql, "worst-case provider 18600 µ$");
  await assertRejects(() => prepareKickoff(canaryInput({ paid: { approved_by: " ", actor_limits: PAID } })), Error, "names who approved");
  await assertRejects(() => prepareKickoff(canaryInput({ paid: { approved_by: "x", actor_limits: { ...PAID, [ATOMUS_ACTOR]: 2 } } })),
    Error, "at most one start");
  await assertRejects(() => prepareKickoff(canaryInput({ paid: { approved_by: "x", actor_limits: { ...PAID, [PVALYOU_ACTOR]: 1 } } })),
    Error, "at most one start");
  await assertRejects(() => prepareKickoff(input({ paid: { approved_by: "x", actor_limits: PAID } })), Error, "only canary_funding");
});

Deno.test("canary kickoff: production refs refused, an explicit TEST ref and the Atomus price required, a Pvalyou template refused", async () => {
  for (const ref of ["ohsdatpvfdjdemstoiuj", "wqnigjhcwjxtmordrwno"]) {
    await assertRejects(() => prepareKickoff(canaryInput({ project_ref: ref })), Error, "not a non-production project");
  }
  await assertRejects(() => prepareKickoff(canaryInput({ project_ref: undefined })), Error, "needs project_ref");
  await assertRejects(() => prepareKickoff(canaryInput({ prices: { ...canaryInput().prices, atomus_maximum_microusd: undefined } })),
    Error, "atomus_maximum_microusd");
  await assertRejects(() => prepareKickoff(canaryInput({ catalog: CATALOG.approved_quotes })), Error, "must not carry a Pvalyou template");
});

Deno.test("canary kickoff: planner_runtime names the checkout's commit, not the last edge deploy's buildInfo", async () => {
  const sha = "fed35777b0034c32be1952ca7faa6ea8a8d5bc60";
  const k = await prepareKickoff(canaryInput({ planner_commit: sha }));
  const r = k.compiled_mission.planner_runtime as Record<string, unknown>;
  assertEquals([r.git_sha, r.git_short, r.dirty], [sha, "fed35777", null], "dirty is unknown, never asserted clean");
  assertEquals(r.function, "real-gpt-kickoff");
  await assertRejects(() => prepareKickoff(canaryInput({ planner_commit: "fed35777" })), Error, "40-character");
  const cli = read("scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts");
  assertStringIncludes(cli, "not the reviewed --expected-sha");
});
