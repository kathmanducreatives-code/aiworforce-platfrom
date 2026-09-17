// LEAD V2 P0 — THE AUDITED RUNS REPLAY OFFLINE.
//
// `tests/fixtures/lead-v2/` holds three production runs captured by read-only
// GETs (queue, task, plan, lineage, ledger, credits, and every Apify run with
// its dataset), scrubbed of personal contact data. They let later phases test
// retrieval against the data those runs actually bought, without buying it
// again. Nothing here touches the network: `fetch` is replaced with a thrower.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { assessRequestFeasibility } from "../../../supabase/functions/_shared/requestFeasibility.ts";
import {
  restoreWorkingSet, runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

const FIX = new URL("../../fixtures/lead-v2/", import.meta.url);
// deno-lint-ignore no-explicit-any
type Json = any;
const read = (p: string): Json => JSON.parse(Deno.readTextFileSync(new URL(p, FIX)));
const FILES = ["queue", "task", "plan", "lineage", "lead_execution_calls", "lead_model_calls",
  "credit_transactions", "apify_runs"];
const RUNS = ["4250f181", "9144eaa4", "1e52d43c"] as const;

function noNetwork<T>(fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("P0 replay must not reach the network"); };
  return fn().finally(() => { globalThis.fetch = real; });
}

Deno.test("manifest and all three runs are present and complete", () => {
  const m = read("manifest.json");
  assertEquals(Object.keys(m.runs).sort(), [...RUNS].sort());
  assertEquals(m.runs["1e52d43c"].task_id, "d9c2974f-bb12-4f29-8821-235d743ed7b8");
  assertEquals(m.runs["1e52d43c"].plan_id, "8fbc66e8-17b7-4651-8690-44b9ceb56f7a");
  assertEquals(m.runs["4250f181"].task_id, "4250f181-b6ae-467a-bc46-1abd39ddeccb");
  for (const r of RUNS) {
    for (const f of FILES) read(`run-${r}/${f}.json`);
    assertEquals(read(`run-${r}/queue.json`).status, "failed");
    assertEquals(Object.keys(read(`run-${r}/apify_runs.json`)).length, m.runs[r].apify_runs, r);
  }
});

Deno.test("fixtures carry no secrets and no personal email addresses", () => {
  const secret = [/\bapify_api_[A-Za-z0-9]{10,}/, /\bsk-[A-Za-z0-9_-]{20,}/, /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\./,
    /\bsb_secret_[A-Za-z0-9]{10,}/];
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      for (const s of secret) assert(!s.test(v), `secret-shaped value at ${path}`);
      assert(!email.test(v), `email-shaped value at ${path}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  for (const r of RUNS) for (const f of FILES) walk(read(`run-${r}/${f}.json`), `${r}/${f}`);
});

Deno.test("recorded missions rebuild their graph and feasibility offline", () => {
  for (const r of ["4250f181", "1e52d43c"]) {
    const mission = read(`run-${r}/task.json`).result.lead_mission;
    assert(mission?.original_user_query, r);
    for (const mode of ["legacy", "enforce"] as const) {
      const plan = buildCapabilityGraph(mission, { executability: mode });
      // P3: the audited mission IS the canonical hiring-led mission. V1 keeps
      // the YC-first plan it ran; V2 now starts from the open role.
      assertEquals(plan.entry_capability, mode === "legacy" ? "startup_company_discovery" : "job_discovery", `${r}/${mode}`);
      const f = assessRequestFeasibility(mission, plan, { executability: mode });
      assert(f.ok, `${r}/${mode}: the audited hiring mission stays feasible`);
    }
  }
});

function memo23Names(r: string): Set<string> {
  const out = new Set<string>();
  for (const e of Object.values(read(`run-${r}/apify_runs.json`)) as Json[]) {
    if (e.capability !== "apify_yc_companies_memo23") continue;
    for (const it of e.dataset_items ?? []) if (it?.name) out.add(String(it.name).toLowerCase());
  }
  return out;
}

Deno.test("the lineage checkpoint restores the working set it recorded", () => {
  for (const [r, n] of [["1e52d43c", 30], ["4250f181", 33]] as const) {
    const records = read(`run-${r}/lineage.json`).current_state.lead_resume_checkpoint.companies;
    assertEquals(records.length, n, r);
    const restored = restoreWorkingSet(records);
    assertEquals(restored.length, n, `${r}: every checkpointed company restored`);
    const names = memo23Names(r);
    const found = records.filter((c: Json) => names.has(String(c.company_name).toLowerCase())).length;
    assert(found / n >= 0.9, `${r}: checkpoint companies came from the recorded memo23 datasets (${found}/${n})`);
  }
});

Deno.test("engine discovery replays the recorded memo23 dataset with no network", async () => {
  const runs = (Object.values(read("run-1e52d43c/apify_runs.json")) as Json[])
    .filter((e) => e.capability === "apify_yc_companies_memo23");
  const rows = runs[0].dataset_items as Record<string, unknown>[];
  assertEquals(rows.length, 10);
  const served = new Set(rows.map((x) => String(x.name).toLowerCase()));
  const mission = read("run-1e52d43c/task.json").result.lead_mission;
  let memoCalls = 0;
  const run = await noNetwork(() => runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === "apify_yc_companies_memo23") { memoCalls++; return Promise.resolve(rows); }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  } as unknown as CapabilityEngineDeps as never, {
    // The recorded run was planned YC-first; replay it on that (legacy) graph.
    mission, plan: buildCapabilityGraph(mission, { executability: "legacy" }), maxCandidates: 20,
    readEnv: (k: string) => k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined,
  } as never));
  assert(memoCalls >= 1, "discovery asked the recorded provider");
  assert(run.companies.length > 0, "recorded rows became companies");
  for (const c of run.companies) {
    assert(served.has(String(c.company.company_name).toLowerCase()),
      `${c.company.company_name} came from the recording`);
  }
});

Deno.test("recorded cost: Apify billed more than the ledger recorded (the audited gap)", () => {
  const billed = (Object.values(read("run-1e52d43c/apify_runs.json")) as Json[])
    .reduce((n, e) => n + Number(e.run?.usageTotalUsd ?? 0), 0);
  const ledgered = (read("run-1e52d43c/lead_execution_calls.json") as Json[])
    .filter((x) => x.provider_id === "apify" && x.record_kind === "provider_call")
    .reduce((n, x) => n + Number(x.actual_cost_usd ?? 0), 0);
  assertAlmostEquals(billed, 0.5902, 5e-4);
  assertAlmostEquals(ledgered, 0.2463, 5e-4);
});
