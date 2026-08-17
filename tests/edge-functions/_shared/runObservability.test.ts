// CAN A RUN EXPLAIN ITSELF?
//
// ── WHAT THIS FIXES ─────────────────────────────────────────────────────────
//
// Auditing the 2026-08-17 run had to answer "which interpreter chose these
// actors?" by comparing the live Apify input against the hardcoded literals in
// `leadCapabilityEngine` character by character, then concluding "these match,
// so it must have been deterministic". The engine HAD computed the answer and
// logged it; nothing persisted it.
//
// In the same run the continuation stopped at 30 of 110 candidates and recorded
// `status: 500` with the response body discarded — a status that maps to six
// different `500` returns in run-agent and separates none of them.
//
// Both are the same defect: the system knew, and did not write it down. These
// tests pin the record, not the behaviour it describes.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  discoveryStrategyDiagnostics,
  type DiscoveryStrategy,
} from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import { dispatchContinuation } from "../../../supabase/functions/_shared/leadContinuationDispatch.ts";

const strategy = (over: Partial<DiscoveryStrategy> = {}): DiscoveryStrategy => ({
  version: "lead-discovery-strategy-v1",
  source: "model_validated",
  selections: [{
    actor_key: "apify_yc_companies_memo23",
    role: "primary",
    input: { industries: ["AI"], regions: ["United States of America"], isHiring: true },
    rationale: "YC covers early-stage AI startups and supports the hiring filter",
    dropped_filters: [],
    requires_enrichment: true,
  }],
  violations: [],
  ...over,
} as DiscoveryStrategy);

Deno.test("1. the record says WHO chose the actors", () => {
  const model = discoveryStrategyDiagnostics(strategy());
  assertEquals(model.source, "model_validated");
  assertEquals(model.model_chosen, true);

  const code = discoveryStrategyDiagnostics(strategy({ source: "deterministic_fallback" }));
  assertEquals(code.model_chosen, false, "the deterministic path must be self-identifying");
});

Deno.test("2. it carries WHY, per actor", () => {
  const d = discoveryStrategyDiagnostics(strategy());
  const actors = d.actors as Array<Record<string, unknown>>;
  assertEquals(
    actors[0].rationale,
    "YC covers early-stage AI startups and supports the hiring filter",
    "the model's stated reason must survive into the record",
  );
});

Deno.test("3. it carries the ACTUAL INPUT, not just the field names", () => {
  // THE ONE THAT WOULD HAVE ANSWERED "where did industries: ['B2B'] come from?"
  // in a single lookup instead of a code hunt.
  const d = discoveryStrategyDiagnostics(strategy());
  const actors = d.actors as Array<Record<string, unknown>>;
  assertEquals(
    (actors[0].input as Record<string, unknown>).industries, ["AI"],
    "the compiled input must be persisted verbatim",
  );
  assert(Array.isArray(actors[0].input_fields), "field names stay too, for quick scanning");
});

Deno.test("4. it carries what the validator DID, not how often", () => {
  const d = discoveryStrategyDiagnostics(strategy({
    source: "model_repaired",
    violations: [
      { code: "unsupported_filter", message: "memo23 has no `query`", severity: "repair", actor_key: "apify_yc_companies_memo23" },
      { code: "unregistered_actor", message: "no such actor", severity: "block", actor_key: "made_up" },
    ],
  }));
  const v = d.violations as Array<Record<string, unknown>>;
  assertEquals(v.length, 2);
  assertEquals(v[0].code, "unsupported_filter");
  assertEquals(v[1].code, "unregistered_actor");
  // Counts are still there — they are the quick read — but no longer the ONLY thing.
  assertEquals(d.blocked, 1);
  assertEquals(d.repaired, 1);
});

Deno.test("5. run-agent persists the strategy onto the task result", async () => {
  // WIRING, not behaviour. The engine computed this for months and no row ever
  // carried it; a correct diagnostic nobody stores is the bug being fixed.
  const RUN = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assert(
    /discovery_strategy:\s*capabilityRun\?\.state\.discovery_strategy/.test(RUN),
    "the task result must record discovery_strategy from the engine state",
  );
});

// ── CONTINUATION FAILURES ───────────────────────────────────────────────────

const deps = (res: { status: number; text?: () => Promise<string> }) => ({
  fetch: () => Promise.resolve(res),
  functionsBaseUrl: "https://example.test/functions/v1",
  serviceRoleKey: "k",
  handoffWindowMs: 50,
  log: () => {},
});

const req = {
  resumeTaskId: "task-1", workspaceId: "ws-1", userId: "u-1", planId: "plan-1",
  agentSlug: "scout", stepIndex: 0, instruction: "go", continuationIndex: 1,
};

Deno.test("6. a refused continuation records the response body", async () => {
  // THE REGRESSION. `status: 500` alone cannot distinguish task_insert_failed
  // from step_failed from an unhandled exception.
  const out = await dispatchContinuation(
    // deno-lint-ignore no-explicit-any
    req as any,
    // deno-lint-ignore no-explicit-any
    deps({ status: 500, text: () => Promise.resolve('{"error":"step_failed","details":"actor timeout"}') }) as any,
  );

  assertEquals(out.dispatched, false);
  assert(!out.dispatched && out.status === 500);
  assert(!out.dispatched && out.error_code === "step_failed", "the error code must be extracted");
  assert(!out.dispatched && out.error_message === "actor timeout", "and the detail");
  assert(
    !out.dispatched && out.detail.includes("step_failed"),
    "the human-readable line must name the cause, not just the status",
  );
  assert(!out.dispatched && (out.response_body ?? "").includes("actor timeout"));
});

Deno.test("7. the failure is attributable to a plan, task and attempt", async () => {
  const out = await dispatchContinuation(
    // deno-lint-ignore no-explicit-any
    req as any, deps({ status: 500, text: () => Promise.resolve("{}") }) as any,
  );
  assert(!out.dispatched && out.plan_id === "plan-1");
  assert(!out.dispatched && out.task_id === "task-1");
  assert(!out.dispatched && out.continuation_index === 1);
});

Deno.test("8. a non-JSON error page is still captured", async () => {
  // Gateway and edge-runtime errors are HTML or plain text. Raw is better than
  // nothing, and must not throw.
  const out = await dispatchContinuation(
    // deno-lint-ignore no-explicit-any
    req as any, deps({ status: 546, text: () => Promise.resolve("WORKER_LIMIT") }) as any,
  );
  assert(!out.dispatched && (out.response_body ?? "").includes("WORKER_LIMIT"));
  assert(!out.dispatched && out.error_code === undefined);
});

Deno.test("9. a body that cannot be read never breaks the dispatch result", async () => {
  const out = await dispatchContinuation(
    // deno-lint-ignore no-explicit-any
    req as any, deps({ status: 500, text: () => Promise.reject(new Error("stream closed")) }) as any,
  );
  assertEquals(out.dispatched, false);
  assert(!out.dispatched && out.response_body === "<body unreadable>");
});

Deno.test("10. a fake with no text() degrades to the old record, not a crash", async () => {
  // Many existing tests supply `{ status }` only. They must keep working.
  // deno-lint-ignore no-explicit-any
  const out = await dispatchContinuation(req as any, deps({ status: 400 }) as any);
  assertEquals(out.dispatched, false);
  assert(!out.dispatched && out.response_body === "<body not captured>");
});

Deno.test("11. a successful dispatch still reads nothing and reports nothing", async () => {
  let read = 0;
  const out = await dispatchContinuation(
    // deno-lint-ignore no-explicit-any
    req as any, deps({ status: 200, text: () => { read++; return Promise.resolve("ok"); } }) as any,
  );
  assertEquals(out.dispatched, true);
  assertEquals(read, 0, "the happy path must not consume the body");
});
