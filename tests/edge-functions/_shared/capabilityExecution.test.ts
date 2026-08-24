// THE EXECUTION SEAM, PINNED TO THE ENVELOPE PRODUCTION ACTUALLY SENDS.
//
// ── WHY THE ENVELOPE IS ASSERTED FIELD BY FIELD ─────────────────────────────
//
// Every field here has a production incident behind it, and each failure looked
// like "no candidates" rather than like a bug:
//
//   input nested             spreading `call.input` at the top level makes
//                            `runTool` synthesise a generic jobs payload —
//                            TEST task e8abeb8f sent `{query: null,
//                            location: null}` to memo23 and read Apify's schema
//                            rejection as an empty result.
//   compiled_actor_input     without it the passthrough branch is not taken at
//                            all, whatever `input` contains.
//   compiled_input_hash      re-checked immediately before the POST; runs
//                            rWikfnKgnp5DazDYr and eGzD7gzJNGFm4c4IZ both sent
//                            empty bodies without it.
//   toolResult on the error  a RUNNING Apify run returns `!ok` carrying its
//                            run_id; throwing a bare string abandoned a paid run.
//   read through the contract structured companies arrive under `company_items`;
//                            reading `items` only meant every company-details
//                            call received ZERO rows.
//
// This is a CHARACTERIZATION suite: it was written against the behaviour that
// was already live in `run-agent`, so switching Leads onto the extracted module
// is provably a refactor rather than a rewrite.
//
// PURE. `runTool` is a stub; no network, provider, credit or database access.

import {
  assert, assertEquals, assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCapabilityExecution, buildInvoker, structuredRowsLookIntact,
  isPersistenceAuthority, PERSISTENCE_AUTHORITIES,
  type ToolResultLike,
} from "../../../supabase/functions/_shared/capabilityExecution.ts";

const CALL = {
  actorKey: "apify_yc_companies_memo23",
  actorId: "memo23/y-combinator-scraper",
  input: { mode: "companies", isHiring: true, queries: ["ai"] },
  inputHash: "abc123",
};

function stub(result: ToolResultLike) {
  const calls: Array<{ tool: string; input: Record<string, unknown>; ctx: unknown }> = [];
  const runTool = (tool: string, input: unknown, ctx: unknown) => {
    calls.push({ tool, input: input as Record<string, unknown>, ctx });
    return Promise.resolve(result);
  };
  return { runTool, calls };
}

const ctxFor = (runTool: ReturnType<typeof stub>["runTool"], over: Record<string, unknown> = {}) => ({
  runTool,
  toolCtx: { workspace_id: "ws-1", task_id: "task-1" },
  auditOwnership: () => ({ execution_owner: "gpt", planner_owner: "gpt", planner_adapter: "luna" }),
  persistenceAuthority: "capability_engine",
  ...over,
  // deno-lint-ignore no-explicit-any
}) as any;

// ═══════════════ 1-3. THE ENVELOPE ═════════════════════════════════════════

Deno.test("1. THE PASSTHROUGH CONTRACT: input stays nested and is flagged", async () => {
  const s = stub({ ok: true, data: { items: [{ name: "Acme" }] } });
  await buildInvoker(ctxFor(s.runTool))(CALL);

  assertEquals(s.calls.length, 1);
  const env = s.calls[0].input;
  assertEquals(s.calls[0].tool, "source_with_apify");

  // The two fields that together make runTool honour a compiled payload.
  assertEquals(env.compiled_actor_input, true);
  assertEquals(env.input, CALL.input, "the compiled input must arrive under `input`");

  // AND NOT SPREAD AT THE TOP LEVEL — the exact shape of the e8abeb8f defect.
  assertEquals(env.mode, undefined, "spreading input at the top level resurrects e8abeb8f");
  assertEquals(env.queries, undefined);
  assertEquals(env.isHiring, undefined);

  assertEquals(env.compiled_input_hash, "abc123");
  assertEquals(env.selected_actor_key, CALL.actorKey);
  assertEquals(env.actor_id, CALL.actorId);
  assertEquals(env.capability_key, CALL.actorKey);
  assertEquals(env.persistence_authority, "capability_engine");
  // No resume id unless one was supplied.
  assertEquals("resume_run_id" in env, false);
});

Deno.test("2. ownership is re-read PER CALL, never captured once", async () => {
  // Planning can fall back to a different adapter partway through a run. A
  // ledger row recording the ORIGINAL owner would attribute the spend to a
  // planner that did not make the decision.
  const s = stub({ ok: true, data: { items: [] } });
  let n = 0;
  const invoke = buildInvoker(ctxFor(s.runTool, {
    auditOwnership: () => ({ execution_owner: `owner-${++n}` }),
  }));
  await invoke(CALL);
  await invoke(CALL);
  assertEquals(s.calls[0].input.execution_owner, "owner-1");
  assertEquals(s.calls[1].input.execution_owner, "owner-2");

  // The tool context is passed through untouched.
  assertEquals(s.calls[0].ctx, { workspace_id: "ws-1", task_id: "task-1" });
});

Deno.test("3. a resumed run carries its run id, and only then", async () => {
  const s = stub({ ok: true, data: { items: [] } });
  await buildInvoker(ctxFor(s.runTool))({ ...CALL, resumeRunId: "run-999" });
  assertEquals(s.calls[0].input.resume_run_id, "run-999");
});

// ═══════════════ 4-5. FAILURE CARRIES ITS EVIDENCE ═════════════════════════

Deno.test("4. a failed call throws WITH the tool result attached", async () => {
  // A RUNNING Apify run comes back `!ok` carrying run_id and dataset_id. The
  // engine reads those off the error to record the run as pending and resume
  // it; a bare string abandons a paid run.
  const payload = { run_id: "apify-1", dataset_id: "ds-1", status: "RUNNING" };
  const s = stub({ ok: false, error: "still_running", data: payload });
  const invoke = buildInvoker(ctxFor(s.runTool));

  const err = await assertRejects(() => invoke(CALL), Error, "still_running") as Error & {
    toolResult?: unknown;
  };
  assertEquals(err.toolResult, payload, "the pending-run evidence must survive the throw");
});

Deno.test("5. ok-but-dataless is a failure, and names itself", async () => {
  const s = stub({ ok: true, data: null });
  const err = await assertRejects(
    () => buildInvoker(ctxFor(s.runTool))(CALL), Error) as Error & { toolResult?: unknown };
  assertEquals(err.toolResult, null);
});

// ═══════════════ 6-7. READ THROUGH THE CONTRACT ════════════════════════════

Deno.test("6. structured company rows are read from their OWN field", async () => {
  // `runTool`'s structured-company branch returns rows under `company_items`
  // and used to set `items: []`. Reading `items` only meant every
  // company-details call through the engine received zero rows — live and
  // unnoticed, because identity resolution never produced a URL to enrich.
  const s = stub({
    ok: true,
    data: {
      normalized_source_type: "structured_companies",
      items: [],
      company_items: [{ id: "1", name: "Acme", website: "acme.com" }],
    },
  });
  const rows = await buildInvoker(ctxFor(s.runTool))({
    ...CALL, actorKey: "apify_linkedin_company_details",
    actorId: "harvestapi/linkedin-company",
  });
  assertEquals(rows.length, 1, "reading `items` only would return zero here");
  assertEquals((rows[0] as { name: string }).name, "Acme");
});

Deno.test("7. a job-normalized structured response is REPORTED, not swallowed", async () => {
  // Saying so at the call site is what would have caught task 41342269 in the
  // log instead of six hours later in a CSV diff.
  const logged: Array<{ msg: string; meta?: unknown }> = [];
  const s = stub({
    ok: true,
    data: {
      normalized_source_type: "structured_companies",
      company_items: [{ title: "Senior AE", posted_date: "2026-08-01" }],
    },
  });
  await buildInvoker(ctxFor(s.runTool, {
    log: (msg: string, meta?: unknown) => logged.push({ msg, meta }),
  }))({ ...CALL, actorKey: "apify_linkedin_company_details", actorId: "harvestapi/linkedin-company" });

  assert(logged.some((l) => l.msg === "provider_response_shape_violation"),
    "a shape violation must be reported");

  // The detector itself: identity fields present = intact; job fields = not.
  assertEquals(structuredRowsLookIntact([]).intact, true, "empty is not a violation");
  assertEquals(structuredRowsLookIntact([{ name: "Acme" }]).intact, true);
  assertEquals(structuredRowsLookIntact([{ linkedinUrl: "x" }]).intact, true);
  assertEquals(structuredRowsLookIntact([{ title: "AE" }]).intact, false);
});

// ═══════════════ 8. THE AUTHORITY THAT SEPARATES THE CALLERS ═══════════════

Deno.test("8. each workflow spends under its OWN authority", async () => {
  // Reaches the ledger, so "what did monitoring cost?" is a query rather than
  // an estimate. Both callers share the seam; neither shares the attribution.
  for (const authority of PERSISTENCE_AUTHORITIES) {
    const s = stub({ ok: true, data: { items: [] } });
    await buildInvoker(ctxFor(s.runTool, { persistenceAuthority: authority }))(CALL);
    assertEquals(s.calls[0].input.persistence_authority, authority);
    assert(isPersistenceAuthority(authority));
  }
  assertEquals(isPersistenceAuthority("lead_writer"), false);
  assertEquals(PERSISTENCE_AUTHORITIES.includes("monitoring_engine" as never), true);
});

Deno.test("9. the assembled deps expose exactly the infrastructure half", () => {
  // Model bindings and lead orchestration are deliberately NOT here: grounding
  // mode restores a Lead pool and progress writes a Lead task row. Monitoring
  // supplies its own or supplies none — the engine treats every one as
  // optional, and a run with no evaluator reports insufficient_evidence rather
  // than qualifying anybody.
  const s = stub({ ok: true, data: { items: [] } });
  const deps = buildCapabilityExecution(ctxFor(s.runTool));
  assertEquals(Object.keys(deps).sort(), ["invoke", "log"]);
  for (const leadOnly of ["groundingMode", "onProgress", "evaluateMission", "planDiscovery"]) {
    assertEquals(leadOnly in deps, false, `${leadOnly} is caller-shaped and must not be here`);
  }
});
