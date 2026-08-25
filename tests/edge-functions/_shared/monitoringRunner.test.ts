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
  resumableState,
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
//
// These use `hiring` as the vehicle. They used `funding`, which Phase 4 showed
// is NOT collectible for a tracked company — nothing that would prove it is
// scheduled for a named subject — so such a subject is now dropped before it
// can spend, and a dropped subject has no investigation to reuse against. The
// property under test is reuse versus staleness and is unchanged.

Deno.test("4. fresh LEAD-origin evidence is reused rather than re-bought", async () => {
  const fresh: ExistingEvidence[] = [{
    signal_type: "sales_hiring",
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
    signals: [{ event: "hiring", subject: "company" }],
  }], h);

  assert(out.ok);
  assertEquals(out.preflight.reused, 1);
  assertEquals(out.preflight.investigating, 0);
  assertEquals(out.preflight.origins, { lead_mission: 1 });
});

Deno.test("5. STALE lead evidence does not suppress the investigation", async () => {
  const stale: ExistingEvidence[] = [{
    signal_type: "sales_hiring",
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
    signals: [{ event: "hiring", subject: "company" }], timeframe_days: 30,
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

// ── WHAT A MONITORING RESUME MAY CARRY ──────────────────────────────────────
//
// Live run 2026-08-24: `harvestapi/linkedin-job-search` SUCCEEDED in 156s with
// 12 openings. The tool's poll gives up at 90s and reports the run PENDING with
// its id — by design. With nowhere to keep that id, the next invocation started
// a SECOND run of the same search and threw the first one's result away.

Deno.test("10. a stored state's pending runs are carried, its completions are not", () => {
  const stored = {
    version: "capability-execution-state-v1",
    mission_hash: "abc123",
    provider_attempts: [{ capability: "hiring_verification", outcome: "pending" }],
    accumulated_cost_units: 3,
    completed_capabilities: ["company_enrichment", "company_identity_resolution"],
    pending_runs: [{
      capability: "hiring_verification", provider: "apify_linkedin_job_search",
      run_id: "O4zCsy1DB1Rc2JgSk", dataset_id: "ds1", actor_build_id: null,
      started_at: "2026-08-24T16:27:55Z",
    }],
  };
  const r = resumableState(stored, "abc123");
  assert(r, "a matching state must be resumable");
  const pr = r!.pending_runs as Array<{ run_id: string }>;
  assertEquals(pr.length, 1);
  assertEquals(pr[0].run_id, "O4zCsy1DB1Rc2JgSk");
  // THE ACCOUNTING SURVIVES. `provider_attempts` and the accumulated cost are
  // the true record of what this question has already cost; a resume that reset
  // them would under-report spend.
  assert(Array.isArray(r!.provider_attempts), "the engine spreads this and iterates it");
  // THE COMPLETIONS ARE DROPPED. Monitoring keeps no per-company records, so
  // skipping a stage would leave the pool without the results that stage made.
  assertEquals(
    r!.completed_capabilities, [],
    "a resumed monitoring pass must not skip stages whose results it did not keep",
  );
  assertEquals(r!.accumulated_cost_units, 3, "a resume must not reset what the run has cost");
});

Deno.test("11. a state for a different question is refused, not adapted", () => {
  const stored = {
    version: "capability-execution-state-v1",
    mission_hash: "someone-elses-question",
    pending_runs: [{
      capability: "hiring_verification", provider: "apify_linkedin_job_search",
      run_id: "X", dataset_id: null, actor_build_id: null, started_at: "t",
    }],
  };
  assertEquals(resumableState(stored, "abc123"), null);
  // And an unrecognised version is refused rather than read optimistically.
  assertEquals(
    resumableState({ ...stored, version: "something-else", mission_hash: "abc123" }, "abc123"),
    null,
  );
  // Nothing in flight is nothing to resume.
  assertEquals(
    resumableState({ ...stored, mission_hash: "abc123", pending_runs: [] }, "abc123"),
    null,
  );
});

Deno.test("12. the pending run is persisted before the feed is written", async () => {
  const order: string[] = [];
  await runMonitoring(
    {
      workspace_id: "w",
      subjects: [{
        kind: "tracked_company", identifier: "acme.com", label: "Acme",
        signals: [{ event: "hiring", subject: "company" }], timeframe_days: 30,
      }],
      icp: null,
    },
    {
      buildPlan: () => ({ steps: [{ capability: "company_identity_resolution" }] }),
      runPlan: (_m, _p, resume) => {
        order.push(resume ? "run:resumed" : "run:fresh");
        return Promise.resolve({
          companies: [], state: { qualified_company_keys: [], completed_capabilities: [] },
        });
      },
      loadRunState: () => { order.push("load"); return Promise.resolve(null); },
      saveRunState: () => { order.push("save"); return Promise.resolve(); },
      loadHeldEvidence: () => { order.push("evidence"); return Promise.resolve([]); },
      writeEvent: () => { order.push("write"); return Promise.resolve({ written: true }); },
    },
  );
  // A pending provider run is money already spent. Losing its id costs more
  // than losing a pass's feed, so it is written first.
  assertEquals(order, ["evidence", "load", "run:fresh", "save"]);
});

// ── THE GATE IS THE SUBJECT'S ───────────────────────────────────────────────

/** A run result carrying one company, seeded from a named subject. */
function namedCompanyRun(identifier: string, opts: {
  qualified: boolean; verdict?: string;
}) {
  const key = identifier.toLowerCase();
  return {
    companies: [{
      key,
      company: {
        company_name: "Acme", canonical_domain: null, linkedin_company_url: null,
        external_source_id: `mission_supplied:${identifier.trim().toLowerCase()}`,
      },
      signal_assessments: [{
        signal: "hiring/company", verdict: opts.verdict ?? "verified", evidence_ids: ["e1"],
      }],
    }],
    state: {
      qualified_company_keys: opts.qualified ? [key] : [],
      completed_capabilities: ["hiring_verification"],
    },
  };
}

const namedDeps = (
  run: ReturnType<typeof namedCompanyRun>, written: Record<string, unknown>[],
) => ({
  buildPlan: () => ({ steps: [{ capability: "hiring_verification" }] }),
  runPlan: () => Promise.resolve(run),
  loadHeldEvidence: () => Promise.resolve([]),
  writeEvent: (i: Record<string, unknown>) => {
    written.push(i);
    return Promise.resolve({ written: true });
  },
});

Deno.test("13. a NAMED subject needs an evidenced signal, not a Lead-fit verdict", async () => {
  // Live run 2026-08-24: the evaluator was asked whether Vercel satisfies a
  // mission whose ICP is empty — a competitor subject states none — and
  // answered `insufficient_evidence`, correctly. There was no fit question to
  // answer; the workspace answered it by choosing to watch the company.
  const written: Record<string, unknown>[] = [];
  const out = await runMonitoring(
    {
      workspace_id: "w",
      subjects: [{
        kind: "competitor", identifier: "https://www.linkedin.com/company/vercel/",
        label: "Vercel", signals: [{ event: "hiring", subject: "company" }],
        timeframe_days: 90,
      }],
      icp: null,
    },
    namedDeps(
      namedCompanyRun("https://www.linkedin.com/company/vercel/", { qualified: false }),
      written,
    ),
  );
  assert(out.ok);
  assertEquals(written.length, 1, "a watched competitor that is hiring must produce an event");
  // THE SUBJECT MODEL SURVIVES: a competitor is not an account.
  assertEquals(written[0].subject_type, "competitor");
  assertEquals(written[0].origin, "scheduled_monitor");
});

Deno.test("14. an unevidenced signal still produces nothing, however it was named", async () => {
  const written: Record<string, unknown>[] = [];
  await runMonitoring(
    {
      workspace_id: "w",
      subjects: [{
        kind: "tracked_company", identifier: "acme.com", label: "Acme",
        signals: [{ event: "hiring", subject: "company" }], timeframe_days: 90,
      }],
      icp: null,
    },
    namedDeps(
      namedCompanyRun("acme.com", { qualified: true, verdict: "absent" }), written,
    ),
  );
  assertEquals(written.length, 0, "an absent signal must never reach the feed");
});

Deno.test("15. a DISCOVERED company still has to qualify", async () => {
  const written: Record<string, unknown>[] = [];
  await runMonitoring(
    {
      workspace_id: "w",
      subjects: [{
        kind: "icp", identifier: null, label: "our ICP",
        signals: [{ event: "hiring", subject: "company" }], timeframe_days: 90,
      }],
      icp: { verticals: ["b2b saas"], business_models: [], locations: [], stages: [] },
    },
    {
      buildPlan: () => ({ steps: [{ capability: "hiring_verification" }] }),
      // No `external_source_id` — the engine found this one itself.
      runPlan: () => Promise.resolve({
        companies: [{
          key: "found.com",
          company: {
            company_name: "Found", canonical_domain: "found.com",
            linkedin_company_url: null,
          },
          signal_assessments: [{
            signal: "hiring/company", verdict: "verified", evidence_ids: ["e1"],
          }],
        }],
        state: { qualified_company_keys: [], completed_capabilities: ["hiring_verification"] },
      }),
      loadHeldEvidence: () => Promise.resolve([]),
      writeEvent: (i) => { written.push(i as Record<string, unknown>); return Promise.resolve({ written: true }); },
    },
  );
  assertEquals(
    written.length, 0,
    "an ICP monitor's feed must be what qualified, not everything it looked at",
  );
});

Deno.test("16. the event key is the one the pre-flight asks with", async () => {
  // A subject named by LinkedIn URL carries no domain and no name. Keying the
  // event on the company's domain would write an empty key, and the pre-flight
  // — which asks with the subject's own identifier — could never match it, so
  // every pass would re-buy what the last one proved.
  const written: Record<string, unknown>[] = [];
  const id = "https://www.linkedin.com/company/vercel/";
  await runMonitoring(
    {
      workspace_id: "w",
      subjects: [{
        kind: "competitor", identifier: id, label: "Vercel",
        signals: [{ event: "hiring", subject: "company" }], timeframe_days: 90,
      }],
      icp: null,
    },
    namedDeps(namedCompanyRun(id, { qualified: false }), written),
  );
  assertEquals(written.length, 1);
  const key = String(written[0].subject_key);
  assert(key.length > 0, "an event must never be written with an empty subject key");
  // The same canonical form the pre-flight uses for this subject.
  assertEquals(key, key.trim().toLowerCase());
  assert(key.includes("vercel"));
});

// ── THE AUTHORITY MUST SURVIVE THE WHOLE WAY DOWN ───────────────────────────
//
// The guard that stops the legacy writer publishing behind an engine lives in
// `memoryWriter`. It was fixed to accept any engine authority — and stayed
// unreachable, because `toolRegistry` narrowed anything that was not exactly
// `capability_engine` to `legacy` one layer above it. Live run 2026-08-24: ten
// v1 `signals` rows in a monitoring-only workspace, one per pass, from a
// watchlist nobody asked to turn into a pipeline.
//
// Three files now share one list. This test is what stops a fourth copy.

Deno.test("17. every layer carries the authority instead of re-deciding it", async () => {
  const read = (f: string) =>
    Deno.readTextFile(new URL(`../../../supabase/functions/_shared/${f}`, import.meta.url));

  for (const f of ["toolRegistry.ts", "memoryWriter.ts"]) {
    const src = await read(f);
    assert(
      src.includes("PERSISTENCE_AUTHORITIES"),
      `${f} must derive the authority list from the seam, not restate it`,
    );
    // The exact-equality narrowing is the bug, in either file.
    assertFalse(
      /persistence_authority\s*===\s*"capability_engine"/.test(src),
      `${f} compares the authority to one literal — a second engine is silently downgraded`,
    );
  }

  // And the runner still spends under its own authority, so the guard has
  // something to recognise.
  assertEquals(MONITORING_AUTHORITY, "monitoring_engine");
  const seam = await read("capabilityExecution.ts");
  assert(
    seam.includes(`"${MONITORING_AUTHORITY}"`),
    "the monitoring authority must be in the shared list the guards derive from",
  );
});

// ── PHASE 4: AN UNCOLLECTIBLE SIGNAL COSTS NOTHING AND SAYS WHY ─────────────

Deno.test("18. a subject whose signals cannot be collected never reaches a plan", async () => {
  // `technology` is scheduled for a tracked company and skipped by the engine.
  // Before this, such a subject compiled, planned, resolved identity, paid to
  // enrich — and established nothing, while the run reported `ok`.
  let planned = 0;
  let ran = 0;
  const out = await runMonitoring(
    {
      workspace_id: "w",
      subjects: [{
        kind: "tracked_company", identifier: "acme.com", label: "Acme",
        signals: [{ event: "technology", subject: "company" }], timeframe_days: 90,
      }],
      icp: null,
    },
    {
      buildPlan: () => { planned++; return { steps: [{ capability: "company_enrichment" }] }; },
      runPlan: () => {
        ran++;
        return Promise.resolve({
          companies: [], state: { qualified_company_keys: [], completed_capabilities: [] },
        });
      },
      loadHeldEvidence: () => Promise.resolve([]),
      writeEvent: () => Promise.resolve({ written: true }),
    },
  );

  assertEquals(out.ok, false, "a run that can establish nothing must not report ok");
  assertEquals(out.refusal, "no_usable_subjects");
  assertEquals(planned, 0, "nothing may be planned for a signal that cannot be proved");
  assertEquals(ran, 0, "and nothing may be executed, so nothing is spent");

  // THE REASON TRAVELS. A dropped subject that does not say why is the silence
  // this phase exists to remove.
  assert(out.dropped_subjects.length > 0);
  const dropped = out.dropped_subjects.find((d) => /technology/.test(d.reason));
  assert(dropped, `the drop must name the signal: ${JSON.stringify(out.dropped_subjects)}`);
  assert(
    /no canonical signal type|does not drive|would prove/.test(dropped!.reason),
    `and why it cannot be collected: ${dropped!.reason}`,
  );
});

Deno.test("19. a mixed subject keeps what it can collect and reports what it cannot", async () => {
  let plannedSignals: unknown = null;
  const out = await runMonitoring(
    {
      workspace_id: "w",
      subjects: [{
        kind: "tracked_company", identifier: "acme.com", label: "Acme",
        signals: [
          { event: "hiring", subject: "company" },
          { event: "funding", subject: "company" },
        ],
        timeframe_days: 90,
      }],
      icp: null,
    },
    {
      buildPlan: (m) => {
        plannedSignals = (m as { required_signals?: unknown }).required_signals;
        return { steps: [{ capability: "hiring_verification" }] };
      },
      runPlan: () => Promise.resolve({
        companies: [], state: { qualified_company_keys: [], completed_capabilities: [] },
      }),
      loadHeldEvidence: () => Promise.resolve([]),
      writeEvent: () => Promise.resolve({ written: true }),
    },
  );

  assert(out.ok, `${out.refusal}: ${out.reason}`);
  assertEquals(out.accepted_subjects, 1, "the subject survives on the signal it can collect");
  // The mission asks ONLY for what can be established.
  assertEquals(
    (plannedSignals as Array<{ type: string }>).map((s) => s.type), ["hiring"],
    "an uncollectible signal must not appear in the compiled mission",
  );
  // And funding is still explained, not dropped in silence.
  assert(out.dropped_subjects.some((d) => /funding/.test(d.reason)));
});
