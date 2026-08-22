// LUNA FIRST. THE REAL VALIDATOR JUDGES. TERRA REPAIRS, ONCE.
//
//     LUNA → validate → valid?  yes → continue
//                              no  → TERRA → revalidate → valid → continue
//                                                       → invalid → fail safely
//
// ── WHAT THIS REPLACED ──────────────────────────────────────────────────────
//
// A two-TIER policy over gpt-4.1 and gpt-4.1-mini. Tiers named a cost shape,
// not a ladder, so a stage whose output was structurally invalid had nowhere to
// go and one bad response was a dead run. And gpt-4.1 was never the cheap
// option: on one execution-plan call (16k in / 1.5k out) Luna is 8.8x cheaper
// and Terra is 14% MORE expensive.
//
// Four bindings reached gpt-4.1 by OMISSION — they passed no route at all, so
// they inherited the default tier. A model choice nobody made, invisible in the
// cost trace. Test 6 is the one that caught them.
//
// ── THE DISTINCTION THAT MATTERS MOST ───────────────────────────────────────
//
// Terra runs on the SAME OpenAI account as Luna, so a provider failure must
// never escalate — it would call a second model that fails identically, one
// round trip later, burying the real code under a duplicate.
//
// ZERO network, ZERO models, ZERO database.

import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DeterministicStageError, escalationRoute, GPT_STAGES, isDeterministicStage,
  LUNA, ModelRoutingLedger, routeModel, routingTable, SOL, TERRA,
} from "../../../supabase/functions/_shared/gptModelRouter.ts";
import {
  isProviderSideFailure, runWithEscalation, type ValidationVerdict,
} from "../../../supabase/functions/_shared/modelEscalation.ts";

const VALID: ValidationVerdict = { valid: true, errors: [] };
const REJECTED: ValidationVerdict = {
  valid: false,
  errors: ["filter_dropped: apify_yc_companies_memo23 has no input `maxItems`"],
};

/** A scripted stage: each entry is one attempt's outcome. */
function scripted<T>(outcomes: Array<{ ok: boolean; value?: T; failureCode?: string }>) {
  const models: string[] = [];
  const previous: Array<{ errors: string[] } | null> = [];
  let i = 0;
  return {
    models, previous,
    run: (route: { model: string }, prev: { errors: string[] } | null) => {
      models.push(route.model);
      previous.push(prev);
      return Promise.resolve(outcomes[i++] ?? { ok: false, failureCode: "http_error" });
    },
  };
}

// ═══ 1-2. LUNA FIRST, AND A VALID RESULT NEVER REACHES TERRA ═══════════════

Deno.test("1. mission compilation starts on Luna, at low effort", () => {
  const r = routeModel("mission_compilation");
  assertEquals(r.model, LUNA);
  assertEquals(r.reasoning_effort, "low");
  assertEquals(r.slot, "primary");
});

Deno.test("2. a valid Luna result never calls Terra", async () => {
  const s = scripted([{ ok: true, value: { mission: "ok" } }]);
  const out = await runWithEscalation("mission_compilation", {
    run: s.run, validate: () => VALID,
  });
  assert(out.ok);
  assertEquals(s.models, [LUNA], "exactly one call, on Luna");
  assertEquals(out.record.event, "primary_success");
  assertEquals(out.record.actual_model, LUNA);
  assertEquals(out.record.attempts, 1);
});

// ═══ 3. AN INVALID RESULT ESCALATES EXACTLY ONCE ═══════════════════════════

Deno.test("3. an invalid Luna mission triggers Terra exactly ONCE", async () => {
  const s = scripted([
    { ok: true, value: { mission: "bad" } },
    { ok: true, value: { mission: "repaired" } },
  ]);
  let seen = 0;
  const out = await runWithEscalation("mission_compilation", {
    run: s.run,
    validate: () => (++seen === 1 ? REJECTED : VALID),
  });
  assert(out.ok);
  assertEquals(s.models, [LUNA, TERRA], "Luna then Terra — and no third rung");
  assertEquals(out.record.event, "terra_success");
  assertEquals(out.record.attempts, 2);
});

Deno.test("4. Terra receives the validator's EXACT errors and Luna's output", async () => {
  // Terra repairs what a validator rejected. Paraphrasing the rejection would
  // ask it to fix a different problem.
  const s = scripted([
    { ok: true, value: { plan: "bad" } },
    { ok: true, value: { plan: "fixed" } },
  ]);
  let seen = 0;
  await runWithEscalation("execution_plan", {
    run: s.run, validate: () => (++seen === 1 ? REJECTED : VALID),
  });
  assertEquals(s.previous[0], null, "the first attempt has no prior");
  assertEquals(s.previous[1]?.errors, REJECTED.errors,
    "verbatim, not summarised");
  assertEquals((s.previous[1] as { value?: unknown }).value, { plan: "bad" },
    "with the rejected output, so Terra repairs rather than restarts");
});

// ═══ 5-6. THE REAL VALIDATOR IS THE AUTHORITY ══════════════════════════════

Deno.test("5. a discovery proposal the live validator rejects escalates", async () => {
  const s = scripted([
    { ok: true, value: { actors: [] } },
    { ok: true, value: { actors: [{ actor_key: "x" }] } },
  ]);
  let seen = 0;
  const out = await runWithEscalation("discovery_actor_selection", {
    run: s.run,
    // Stands in for `validateDiscoveryStrategy`; the production wiring passes
    // that function itself — see `leadCapabilityEngine`, which builds
    // `validation_feedback` from its violations and revalidates with it.
    validate: () => (++seen === 1 ? REJECTED : VALID),
  });
  assert(out.ok);
  assertEquals(s.models, [LUNA, TERRA]);
  assert(out.record.escalation_reason?.includes("filter_dropped"),
    "the reason is the validator's own words");
});

Deno.test("6. a valid discovery proposal does NOT escalate", async () => {
  const s = scripted([{ ok: true, value: { actors: [{ actor_key: "yc" }] } }]);
  const out = await runWithEscalation("discovery_actor_selection", {
    run: s.run, validate: () => VALID,
  });
  assert(out.ok);
  assertEquals(s.models, [LUNA]);
  assertEquals(out.record.event, "primary_success");
});

Deno.test("7. Terra's output is REVALIDATED, and invalid Terra fails safely", async () => {
  // Terra is not trusted because it is Terra. Same question, same function.
  const s = scripted([
    { ok: true, value: { plan: "bad" } },
    { ok: true, value: { plan: "still bad" } },
  ]);
  const out = await runWithEscalation("execution_plan", {
    run: s.run, validate: () => REJECTED,
  });
  assert(!out.ok, "an unrepaired plan must not ship");
  assertEquals(s.models, [LUNA, TERRA]);
  assertEquals(out.record.event, "final_failure");
  assertEquals(out.record.attempts, 2, "bounded — it does not try a third time");
});

// ═══ 8-9. PROVIDER FAILURES DO NOT ESCALATE ════════════════════════════════

Deno.test("8. QUOTA EXHAUSTION FROM LUNA DOES NOT CALL TERRA", async () => {
  // The one that matters. Terra shares the account; it would fail identically.
  // On 2026-08-21 an empty balance produced four silent retries and a chat that
  // answered nothing — escalation would have made that eight.
  const s = scripted([{ ok: false, failureCode: "quota_exhausted" }]);
  const out = await runWithEscalation("mission_compilation", {
    run: s.run, validate: () => VALID,
  });
  assert(!out.ok);
  assertEquals(s.models, [LUNA], "ONE call. Terra was never asked.");
  assertEquals(out.record.event, "provider_failure_no_escalation");
  assertEquals(out.record.provider_failure_code, "quota_exhausted",
    "and the real code survives, so the layer above says `quota_exhausted` " +
    "rather than `planning failed`");
});

Deno.test("9. an outage, an auth failure and a transport fault behave the same", async () => {
  for (const code of ["http_error", "transport_error", "no_api_key", "timeout"]) {
    const s = scripted([{ ok: false, failureCode: code }]);
    const out = await runWithEscalation("execution_plan", {
      run: s.run, validate: () => VALID,
    });
    assertEquals(s.models, [LUNA], `${code} must not reach Terra`);
    assertEquals(out.record.event, "provider_failure_no_escalation");
    assert(isProviderSideFailure(code));
  }
});

Deno.test("10. but a MODEL-OUTPUT failure still escalates", () => {
  // The distinction, stated directly: these are answers, not absences.
  for (const code of ["unparseable_json", "schema_refused", "empty_response"]) {
    assert(!isProviderSideFailure(code),
      `${code} is the model answering badly — Terra has something to work with`);
  }
});

// ═══ 11-12. HIGH-VOLUME STAGES STAY ON LUNA AND DO NOT ESCALATE ════════════

Deno.test("11. triage and qualification run on Luna, at no effort", () => {
  for (const stage of [
    "mission_triage", "company_qualification", "mission_evaluation",
    "grounded_evidence_evaluation", "pool_evaluation", "semantic_classification",
    "summary_generation",
  ] as const) {
    const r = routeModel(stage);
    assertEquals(r.model, LUNA, `${stage} runs on Luna`);
    assertEquals(r.reasoning_effort, "none", `${stage} does not pay for reasoning`);
  }
});

Deno.test("12. and they fail safely rather than escalating", async () => {
  // An undecidable verdict is already a defined outcome. A second model call
  // would buy cost, not information, at the volume where that multiplies hardest.
  const s = scripted([{ ok: true, value: { verdict: "?" } }]);
  const out = await runWithEscalation("mission_triage", {
    run: s.run, validate: () => REJECTED,
  });
  assert(!out.ok);
  assertEquals(s.models, [LUNA], "no Terra");
  assertEquals(out.record.event, "final_failure");
});

// ═══ 13. DETERMINISTIC SYSTEMS ASK NO MODEL ════════════════════════════════

Deno.test("13. pool ranking is deterministic and routing it is an ERROR", () => {
  // AUDITED, NOT ASSUMED. `POOL_RANKING_MODE` defaults to shadow, and the live
  // runs say what the call contributed: run 4fe98f5c made one ranking call,
  // its output was "absent or unreadable", `proposed_source` was
  // `deterministic_fallback`, and the deterministic order shipped with
  // `moved_count: 0`. A model contributing nothing, twice a run.
  assert(isDeterministicStage("pool_ranking"));
  assertThrows(() => routeModel("pool_ranking"), DeterministicStageError);
  assertEquals(escalationRoute("pool_ranking", "any"), null);
  assert(!routingTable().some((r) => r.stage === "pool_ranking"),
    "a deterministic stage has no row in the model routing table");
});

Deno.test("14. identity, credits, cost accounting and continuation are model-free", () => {
  // The architectural line: GPT owns semantic planning, CODE owns validation,
  // boundaries, money and idempotency. A model call in any of these would make
  // an accounting answer non-reproducible.
  for (const f of [
    "creditAuthorization.ts", "providerCostModel.ts", "modelCostModel.ts",
    "leadAutoContinuation.ts", "executionLedger.ts",
  ]) {
    const src = Deno.readTextFileSync(new URL(
      `../../../supabase/functions/_shared/${f}`, import.meta.url));
    assert(!/\bgptStructured\s*\(/.test(src), `${f} must not call a model`);
    assert(!/\brouteModel\s*\(/.test(src), `${f} must not route one either`);
  }
});

// ═══ 15. SOL IS OUTSIDE NORMAL PRODUCTION ══════════════════════════════════

Deno.test("15. SOL IS UNREACHABLE FROM EVERY STAGE", () => {
  // Declared in the router so its absence is testable — an omitted constant
  // could not be asserted against.
  for (const stage of GPT_STAGES) {
    if (isDeterministicStage(stage)) continue;
    assert(routeModel(stage).model !== SOL, `${stage} must not resolve to Sol`);
    assert(escalationRoute(stage, "any")?.model !== SOL,
      `${stage} must not ESCALATE to Sol either`);
  }
  assert(!routingTable().some((r) => r.model === SOL));
});

Deno.test("16. and gpt-4.1 is gone from every routed stage", () => {
  // Not left as a hidden fallback. The tier lookup survives in `gptProvider`
  // only for a call site that passes no route, and there are none in the lead
  // flow — every stage above resolves through the policy.
  for (const r of routingTable()) {
    assert(r.model === LUNA || r.model === TERRA,
      `${r.stage} resolved to ${r.model}, outside the production ladder`);
  }
});

// ═══ 17. THE TELEMETRY THAT ANSWERS "HOW OFTEN DID LUNA NEED TERRA?" ═══════

Deno.test("17. every escalation event is emitted as it happens", async () => {
  // The first draft of this test asserted the LENGTH OF A LITERAL ARRAY it had
  // just written down, which proves nothing about the code. These drive the
  // real ladder and read what it emitted.
  const seen: string[] = [];
  const onEvent = (r: { event: string }) => seen.push(r.event);

  // Clean success.
  await runWithEscalation("mission_compilation", {
    run: scripted([{ ok: true, value: 1 }]).run, validate: () => VALID, onEvent,
  });
  assertEquals(seen, ["primary_success"]);

  // Escalated and repaired: the escalation is announced BEFORE Terra runs, so a
  // run that dies mid-escalation still shows why it was escalating.
  seen.length = 0;
  let n = 0;
  await runWithEscalation("mission_compilation", {
    run: scripted([{ ok: true, value: 1 }, { ok: true, value: 2 }]).run,
    validate: () => (++n === 1 ? REJECTED : VALID),
    onEvent,
  });
  assertEquals(seen, ["terra_escalation", "terra_success"]);

  // Provider failure: one event, and it names the refusal to escalate.
  seen.length = 0;
  await runWithEscalation("mission_compilation", {
    run: scripted([{ ok: false, failureCode: "quota_exhausted" }]).run,
    validate: () => VALID, onEvent,
  });
  assertEquals(seen, ["provider_failure_no_escalation"]);

  // Unrepaired: escalated, then final.
  seen.length = 0;
  await runWithEscalation("execution_plan", {
    run: scripted([{ ok: true, value: 1 }, { ok: true, value: 2 }]).run,
    validate: () => REJECTED, onEvent,
  });
  assertEquals(seen, ["terra_escalation", "final_failure"]);
});

Deno.test("18. the ledger counts escalations separately from attempts", () => {
  // "What percentage of Luna calls needed Terra?" is answerable only if an
  // escalation is a ROW of its own rather than a flag on the attempt.
  const l = new ModelRoutingLedger();
  l.record(routeModel("mission_compilation"));
  l.record(escalationRoute("mission_compilation", "validator rejected")!);
  l.record(routeModel("mission_triage"));

  const s = l.summary() as { total_calls: number; stages: Array<Record<string, unknown>> };
  assertEquals(s.total_calls, 3);
  const esc = s.stages.find((r) => r.model === TERRA);
  assertEquals(esc?.escalations, 1);
  const primary = s.stages.find((r) => r.stage === "mission_compilation" && r.model === LUNA);
  assertEquals(primary?.escalations, 0, "the Luna attempt is not itself an escalation");
});

Deno.test("19. a route records the model, the effort and WHY", async () => {
  const s = scripted([
    { ok: true, value: 1 }, { ok: true, value: 2 },
  ]);
  let seen = 0;
  const out = await runWithEscalation<number>("execution_plan", {
    run: s.run, validate: () => (++seen === 1 ? REJECTED : VALID),
  });
  assertEquals(out.record.primary_model, LUNA);
  assertEquals(out.record.actual_model, TERRA, "what ACTUALLY produced the answer");
  assert(out.record.escalation_reason!.length > 10);
  assertEquals(out.route.reasoning_effort, "low");
});

// ═══ 20. GPT NEVER PICKS ITS OWN MODEL ═════════════════════════════════════

Deno.test("20. routing is a pure function of the stage and counts", () => {
  // A run's routing must be reproducible from its record. A field like
  // `quality_target` would make this the knob the router refuses to be, and a
  // model asked to pick its own tier picks the expensive one.
  const a = routeModel("mission_compilation", { requested_count: 10 });
  const b = routeModel("mission_compilation", { requested_count: 10 });
  assertEquals(JSON.stringify(a), JSON.stringify(b));

  const src = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/gptModelRouter.ts", import.meta.url));
  // The signals the router may read are all COUNTS. A signal it cannot check is
  // a signal it cannot be tested on.
  const iface = src.slice(src.indexOf("export interface RoutingSignals"));
  const body = iface.slice(0, iface.indexOf("}"));
  assert(!/string/.test(body),
    "a free-text routing signal is a place for a model's opinion to enter");
});
