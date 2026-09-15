// LEAD V2 P0 — V1 AND SIGNALS MONITORING ARE UNCHANGED, BYTE FOR BYTE.
//
// The snapshots were captured at 3833a2a6, BEFORE any P0 code existed:
//   p0-legacy-graph-snapshots.json      24 lead missions → graph + feasibility
//   p0-legacy-monitoring-snapshots.json 19 monitoring subjects → graph
// The executability gate is opt-in. Every caller that does not opt in — V1
// workspaces, and Signals monitoring through its port — must reproduce them
// exactly.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { assessRequestFeasibility } from "../../../supabase/functions/_shared/requestFeasibility.ts";
import { compileMonitoringMission } from "../../../supabase/functions/_shared/monitoringMission.ts";
import {
  buildMonitoringCapabilityGraph, MONITORING_EXECUTABILITY_MODE,
} from "../../../supabase/functions/_shared/monitoringRetrievalPort.ts";
import { executabilityGateFor } from "../../../supabase/functions/_shared/capabilityExecutability.ts";

const FIX = new URL("../../fixtures/lead-v2/", import.meta.url);
const read = (f: string) => JSON.parse(Deno.readTextFileSync(new URL(f, FIX)));
const SRC = (p: string) => Deno.readTextFileSync(new URL(`../../../supabase/functions/${p}`, import.meta.url));
// deno-lint-ignore no-explicit-any
type Json = any;
/** The snapshot went through JSON; compare the same way. */
const j = (x: unknown) => JSON.parse(JSON.stringify(x));

const GRAPH = read("p0-legacy-graph-snapshots.json");
const MON = read("p0-legacy-monitoring-snapshots.json");

Deno.test("the snapshots are the pre-P0 capture", () => {
  assertEquals(GRAPH.captured_at_commit, "3833a2a6");
  assertEquals(MON.captured_at_commit, "3833a2a6");
  assertEquals(GRAPH.cases.length, 24);
  assertEquals(MON.cases.length, 19);
});

Deno.test("default (legacy) graph + feasibility reproduce every lead snapshot exactly", () => {
  for (const c of GRAPH.cases as Json[]) {
    const plan = buildCapabilityGraph(c.mission);
    assertEquals(j(plan), c.plan, `${c.id}: graph`);
    assertEquals(j(assessRequestFeasibility(c.mission, plan)), c.feasibility, `${c.id}: feasibility`);
    assertFalse("executability" in plan, `${c.id}: legacy plans carry no gate record`);
  }
});

Deno.test("an explicit `legacy` is the same as the default", () => {
  for (const c of GRAPH.cases as Json[]) {
    const plan = buildCapabilityGraph(c.mission, { executability: "legacy" });
    assertEquals(j(plan), c.plan, c.id);
    assertEquals(j(assessRequestFeasibility(c.mission, plan, { executability: "legacy" })), c.feasibility, c.id);
  }
});

Deno.test("a V1 workspace resolves to legacy, so every V1 call site builds the snapshot plan", () => {
  const v1 = "11111111-2222-4333-8444-555555555555";
  const allowlist = (k: string) => k === "LEAD_V2_WORKER_WORKSPACES" ? "e8af257d-4c42-4fc2-9d62-037cdfac27c4" : undefined;
  assertEquals(executabilityGateFor(v1, allowlist), "legacy");
  assertEquals(executabilityGateFor(v1, () => undefined), "legacy");
});

Deno.test("Signals monitoring, through its port, reproduces every monitoring snapshot exactly", () => {
  assertEquals(MONITORING_EXECUTABILITY_MODE, "legacy");
  let compared = 0;
  for (const c of MON.cases as Json[]) {
    if (c.id === "multi" || !c.input) continue;
    const compiled = compileMonitoringMission({ workspace_id: "ws-fixture", subjects: [c.input.subject], icp: c.input.icp });
    assertEquals(compiled.ok, c.compiled_ok, `${c.id}: compile`);
    if (!compiled.ok || !compiled.mission) continue;
    assertEquals(j(compiled.mission), c.mission, `${c.id}: mission`);
    assertEquals(j(buildMonitoringCapabilityGraph(compiled.mission)), c.plan, `${c.id}: plan`);
    compared++;
  }
  const multi = (MON.cases as Json[]).find((c) => c.id === "multi");
  assertEquals(j(buildMonitoringCapabilityGraph(multi.mission)), multi.plan, "multi");
  assert(compared >= 9, `compared ${compared} icp monitoring plans`);
});

Deno.test("monitoring still enters and schedules what it did before P0 (not gated)", () => {
  const icp = (MON.cases as Json[]).filter((c) => String(c.id).startsWith("icp:") && c.plan);
  const entries = new Set(icp.map((c) => c.plan.entry_capability));
  const steps = new Set(icp.flatMap((c) => c.plan.steps.map((s: Json) => s.capability)));
  assert(entries.has("expansion_signal_discovery") && entries.has("product_launch_discovery"));
  assert(steps.has("technology_verification") && steps.has("company_post_verification"));
  for (const c of icp) {
    assertEquals(j(buildMonitoringCapabilityGraph(c.mission)), c.plan, c.id);
  }
});

Deno.test("every monitoring plan is built through the port", () => {
  const scan = SRC("run-monitoring-scan/index.ts");
  const collect = SRC("_shared/signalCollectability.ts");
  for (const [name, src] of [["run-monitoring-scan", scan], ["signalCollectability", collect]] as const) {
    assert(src.includes("buildMonitoringCapabilityGraph"), `${name} uses the port`);
    assertFalse(/\bbuildCapabilityGraph\(/.test(src), `${name} does not call the lead graph directly`);
  }
  assert(scan.includes("buildPlan: buildMonitoringCapabilityGraph"));
  assert(SRC("_shared/monitoringRetrievalPort.ts").includes('MONITORING_EXECUTABILITY_MODE = "legacy"'));
});

Deno.test("lead call sites take the gate from the workspace, never a hardcoded enforce", () => {
  const ra = SRC("run-agent/index.ts");
  const orch = SRC("orchestrate/index.ts");
  const pilot = SRC("pilot-chat/index.ts");
  for (const [name, src] of [["run-agent", ra], ["orchestrate", orch], ["pilot-chat", pilot]] as const) {
    assert(src.includes("executabilityGateFor("), `${name} resolves the gate`);
    assertFalse(src.includes('executability: "enforce"'), `${name} never forces enforce`);
    const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    const calls = [...code.matchAll(/buildCapabilityGraph\(([^)]*)\)/g)].map((m) => m[1]);
    assert(calls.length > 0, name);
    for (const args of calls) assert(args.includes("executability"), `${name}: buildCapabilityGraph(${args}) passes the gate`);
  }
  assert(ra.includes('inProcess.continuationOwner === "v2_queue"'), "worker execution is V2 by definition");
  assert(/buildPaidExecutionPreflight\(\{\s*executability: leadExecutabilityGate/.test(ra), "run-agent preflight graded by the gate");
  assert(pilot.includes("assessRequestFeasibility(mission, previewPlan, { executability: previewGate })"));
});
