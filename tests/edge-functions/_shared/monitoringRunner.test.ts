// MONITORING IS A THIN CALLER OF THE SHARED ENGINE — PROVEN, NOT ASSERTED.
//
// ── THE THREE INDEPENDENT REASONS MONITORING CANNOT WRITE LEAD ROWS ─────────
//
// One would be a convention. Three is a boundary:
//
//   1. its plan carries no `persistence` step  (the graph's terminal branch)
//   2. it never calls the persistence bridge   (this runner has no such call)
//   3. it spends under `monitoring_engine`, which the legacy writer's guard
//      recognises as engine-owned and refuses to publish behind
//
// Each is tested separately, because a refactor that removes one silently must
// still fail the other two.
//
// ── AND IT OWNS NO PROVIDERS ────────────────────────────────────────────────
//
// The runner performs no provider call, holds no actor knowledge and does no
// credit arithmetic. If it ever grows one, the convergence has failed and the
// source-level test at the end says so.
//
// PURE. Engine, store and writer are all injected.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runMonitoring, MONITORING_AUTHORITY,
} from "../../../supabase/functions/_shared/monitoringRunner.ts";
import {
  buildCapabilityGraph,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  LEAD_ONLY_CAPABILITIES,
} from "../../../supabase/functions/_shared/monitoringMission.ts";
import {
  PERSISTENCE_AUTHORITIES,
} from "../../../supabase/functions/_shared/capabilityExecution.ts";
import type {
  ExistingEvidence,
} from "../../../supabase/functions/_shared/monitoringPreflight.ts";

const ICP = { verticals: ["cybersecurity"], business_models: ["b2b saas"], locations: ["Europe"] };

const company = (key: string, name: string, domain: string) => ({
  key,
  company: { company_name: name, canonical_domain: domain, linkedin_company_url: null },
  verdict: "pass",
  signal_assessments: [
    { signal: "funding/company", verdict: "verified", evidence_ids: ["e1"] },
  ],
});

function harness(over: Record<string, unknown> = {}) {
  const written: Array<Record<string, unknown>> = [];
  const ranPlans: unknown[] = [];
  const deps = {
    buildPlan: buildCapabilityGraph,
    runPlan: (_m: unknown, plan: unknown) => {
      ranPlans.push(plan);
      return Promise.resolve({
        companies: [company("acme.com", "Acme", "acme.com")],
        state: {
          qualified_company_keys: ["acme.com"],
          completed_capabilities: ["funding_signal_discovery", "company_brain_qualification"],
        },
      });
    },
    loadHeldEvidence: () => Promise.resolve([] as ExistingEvidence[]),
    writeEvent: (input: Record<string, unknown>) => {
      written.push(input);
      return Promise.resolve({ written: true });
    },
    ...over,
    // deno-lint-ignore no-explicit-any
  } as any;
  return { deps, written, ranPlans };
}

const run = (subjects: unknown[], h = harness(), icp: unknown = ICP) =>
  // deno-lint-ignore no-explicit-any
  runMonitoring({ workspace_id: "ws-1", icp, subjects } as any, h.deps);

// ═══════════════ 1-3. THE THREE BOUNDARIES ═════════════════════════════════

Deno.test("1. BOUNDARY ONE: the plan monitoring runs contains no lead stage", async () => {
  const h = harness();
  const out = await run([{ kind: "icp", signals: [{ event: "funding", subject: "company" }] }], h);
  assert(out.ok, out.reason);

  const plan = h.ranPlans[0] as { steps: Array<{ capability: string }> };
  const caps = plan.steps.map((s) => s.capability);
  for (const lead of LEAD_ONLY_CAPABILITIES) {
    assertFalse(caps.includes(lead), `monitoring scheduled ${lead}`);
  }
  assertEquals(out.boundaries.lead_steps_scheduled, []);
});

Deno.test("2. BOUNDARY TWO: a plan that DOES carry a lead stage is refused before spend", async () => {
  // The check runs before the pre-flight and before execution, so a plan that
  // would have behaved like a sourcing run costs nothing to refuse.
  let executed = false;
  let loaded = false;
  const h = harness({
    buildPlan: () => ({ steps: [{ capability: "general_company_discovery" }, { capability: "persistence" }] }),
    loadHeldEvidence: () => { loaded = true; return Promise.resolve([]); },
    runPlan: () => { executed = true; return Promise.resolve({ companies: [], state: { qualified_company_keys: [], completed_capabilities: [] } }); },
  });
  const out = await run([{ kind: "icp", signals: [{ event: "funding", subject: "company" }] }], h);

  assertFalse(out.ok);
  assertEquals(out.refusal, "plan_violates_monitoring_boundary");
  assertFalse(executed, "nothing may execute once the boundary is violated");
  assertFalse(loaded, "not even the pre-flight read should happen");
  assertEquals(out.events.attempted, 0);
  assert(out.reason.includes("persistence"));
});

Deno.test("3. BOUNDARY THREE: monitoring spends under its own engine authority", () => {
  // Which the legacy writer's guard recognises as engine-owned and refuses to
  // publish behind — the fix that stopped a watchlist becoming a pipeline.
  assertEquals(MONITORING_AUTHORITY, "monitoring_engine");
  assert((PERSISTENCE_AUTHORITIES as readonly string[]).includes(MONITORING_AUTHORITY),
    "the authority must be in the engine-owned set the legacy writer derives from");
  assertFalse(MONITORING_AUTHORITY === "capability_engine",
    "monitoring spend must be attributable to monitoring, not to Leads");
});

// ═══════════════ 4-5. IT REUSES BEFORE IT BUYS ═════════════════════════════

Deno.test("4. fresh LEAD-origin evidence is reused rather than re-bought", async () => {
  const fresh: ExistingEvidence[] = [{
    signal_type: "recent_funding",
    occurred_at: new Date(Date.now() - 3600_000).toISOString(),
    occurred_at_basis: "source_reported",
    observed_at: new Date().toISOString(),
    origin: "lead_mission",
    subject_type: "company", subject_key: "acme-com",
    lifecycle_status: "active",
  }];
  const h = harness({ loadHeldEvidence: () => Promise.resolve(fresh) });
  const out = await run([{
    kind: "tracked_company", identifier: "acme.com", label: "Acme",
    signals: [{ event: "funding", subject: "company" }],
  }], h);

  assert(out.ok);
  assertEquals(out.preflight.reused, 1);
  assertEquals(out.preflight.investigating, 0);
  assertEquals(out.preflight.origins, { lead_mission: 1 });
});

Deno.test("5. STALE lead evidence does not suppress the investigation", async () => {
  const stale: ExistingEvidence[] = [{
    signal_type: "recent_funding",
    occurred_at: new Date(Date.now() - 200 * 86_400_000).toISOString(),
    occurred_at_basis: "source_reported",
    observed_at: new Date().toISOString(),
    origin: "lead_mission",
    subject_type: "company", subject_key: "acme-com",
    lifecycle_status: "active",
  }];
  const h = harness({ loadHeldEvidence: () => Promise.resolve(stale) });
  const out = await run([{
    kind: "tracked_company", identifier: "acme.com",
    signals: [{ event: "funding", subject: "company" }], timeframe_days: 30,
  }], h);

  assertEquals(out.preflight.reused, 0);
  assertEquals(out.preflight.investigating, 1, "a stale fact must not freeze the feed");
});

// ═══════════════ 6-7. WHAT IT WRITES ═══════════════════════════════════════

Deno.test("6. events are written for qualified companies with EVIDENCED signals only", async () => {
  const h = harness();
  const out = await run([{ kind: "icp", signals: [{ event: "funding", subject: "company" }] }], h);

  assertEquals(out.events.written, 1);
  const e = h.written[0];
  assertEquals(e.signal_type, "recent_funding");
  assertEquals(e.signal_category, "growth");
  assertEquals(e.origin, "scheduled_monitor");
  // NO INVENTED TIME. This stage has no source date, and says so rather than
  // writing the run time.
  assertEquals(e.occurred_at, null);
  assertEquals(e.occurred_at_basis, "unknown");
  // A SUBJECT, never a fabricated lead entity.
  assertEquals(e.subject_type, "company");
  assertEquals(e.subject_key, "acme-com");
  assertEquals(e.contact_id, undefined);
  assertEquals(e.account_id, undefined);
  assertEquals(e.lead_candidate_id, undefined);
});

Deno.test("7. an UNQUALIFIED company, or an unevidenced signal, writes nothing", async () => {
  // A monitoring run that wrote an event per discovered company would be a feed
  // of everything it looked at rather than of what changed.
  const unqualified = harness({
    runPlan: () => Promise.resolve({
      companies: [company("acme.com", "Acme", "acme.com")],
      state: { qualified_company_keys: [], completed_capabilities: [] },
    }),
  });
  assertEquals((await run([{ kind: "icp", signals: [{ event: "funding" }] }], unqualified)).events.written, 0);

  const unevidenced = harness({
    runPlan: () => Promise.resolve({
      companies: [{
        ...company("acme.com", "Acme", "acme.com"),
        signal_assessments: [
          { signal: "funding/company", verdict: "not_investigated", evidence_ids: [] },
        ],
      }],
      state: { qualified_company_keys: ["acme.com"], completed_capabilities: [] },
    }),
  });
  assertEquals((await run([{ kind: "icp", signals: [{ event: "funding" }] }], unevidenced)).events.written, 0);
});

// ═══════════════ 8. IT OWNS NO PROVIDERS ═══════════════════════════════════

Deno.test("8. the runner contains no provider, actor or credit logic", async () => {
  // The convergence rule, enforced on the source. If monitoring ever grows its
  // own provider call it stops being a caller and becomes a second stack.
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/monitoringRunner.ts", import.meta.url));
  for (const forbidden of [
    "apify", "firecrawl", "harvestapi", "runTool", "source_with_apify",
    "credits_reserve", "actorKey", "compiled_actor_input",
  ]) {
    assertFalse(src.toLowerCase().includes(forbidden.toLowerCase()),
      `monitoringRunner references "${forbidden}" — it must inherit execution, not perform it`);
  }
  // And it must not reach the persistence bridge.
  for (const leadWrite of ["toRouteResultShape", "persistPlan", "lead_candidates"]) {
    assertFalse(src.includes(leadWrite), `monitoring must never call ${leadWrite}`);
  }
});

// ── WHAT A FAILED COLLECTION MUST LOOK LIKE ─────────────────────────────────
//
// Live run 2026-08-24: the account's model credits were exhausted, the engine
// threw `DiscoveryStrategyBlockedError`, and the endpoint answered HTTP 500
// with the cause visible only in the function logs. A scheduler cannot tell an
// out-of-credit account from a broken deployment through a 500.

Deno.test("9. an engine that throws is reported as a refusal, not a crash", async () => {
  const written: unknown[] = [];
  const out = await runMonitoring(
    {
      workspace_id: "w",
      subjects: [{
        kind: "tracked_company", identifier: "Acme", label: "Acme",
        signals: [{ event: "hiring", subject: "company" }], timeframe_days: 30,
      }],
      icp: null,
    },
    {
      buildPlan: () => ({ steps: [{ capability: "company_identity_resolution" }] }),
      runPlan: () => {
        throw new Error("discovery actor selection was blocked (proposal_not_a_list)");
      },
      loadHeldEvidence: () => Promise.resolve([]),
      writeEvent: (i) => { written.push(i); return Promise.resolve({ written: true }); },
    },
  );

  assertEquals(out.ok, false);
  assertEquals(out.refusal, "execution_failed");
  assert(out.reason.includes("proposal_not_a_list"), "the cause must survive into the outcome");
  // NOTHING IS PUBLISHED FROM A FAILED RUN. A partial feed would be worse than
  // no feed: it reads as "these are the signals" when collection never ran.
  assertEquals(written.length, 0);
  assertEquals(out.events, { attempted: 0, written: 0, deduplicated: 0, failed: 0 });
  // The pre-flight already ran, and its accounting is still true.
  assertEquals(out.preflight.planned, 1);
});
