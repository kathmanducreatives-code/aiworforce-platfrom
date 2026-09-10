// A MODEL CALL THAT REPORTS NOTHING IS NOT CHEAP — IT IS INVISIBLE.
//
// ── THE DISTINCTION THIS EXISTS TO HOLD ─────────────────────────────────────
//
// `oneProviderSeam.test.ts` proves every provider `fetch` lives in an accounted
// FILE. That is necessary and it is not sufficient: `generateText` emits
// telemetry only through `opts.onModelCall`, so a caller that omits it routes
// through the accounted seam and still reports nothing. The seam exists; the
// call never hands it anything.
//
// This is not hypothetical. It has now happened four times:
//
//     aiProvider          emitted nothing until 8958550c
//     leadStrategy        emitted into `undefined`
//     chat-respond        orphaned, unpriced, no workspace
//     run-agent generic   every Scribe draft, every Penn rewrite — found while
//                         wiring CONTENT P0-2, fixed in the same change
//
// The reason it keeps happening is that the failure is SILENT and looks like
// success: the call works, the user gets an answer, and only the bill knows.
// `logProviderCall` does not close it — that writes `activity_feed`, which
// carries no tokens and no cost, while the workspace ceiling sums
// `lead_model_calls` (see _shared/modelSpendCeiling.ts).
//
// ZERO network, ZERO models, ZERO providers, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FUNCTIONS = new URL("../../../supabase/functions/", import.meta.url);

async function* walk(dir: URL, prefix = ""): AsyncGenerator<{ path: string; text: string }> {
  for await (const e of Deno.readDir(dir)) {
    const child = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
    if (e.isDirectory) yield* walk(child, `${prefix}${e.name}/`);
    else if (e.name.endsWith(".ts")) {
      yield { path: `${prefix}${e.name}`, text: await Deno.readTextFile(child) };
    }
  }
}

const FILES: { path: string; text: string }[] = [];
for await (const f of walk(FUNCTIONS)) FILES.push(f);

/**
 * `aiProvider.ts` IS the seam. `generateJson` there forwards `{ ...opts,
 * jsonMode: true }` into `generateText`, so the caller's `onModelCall` passes
 * straight through — a call site inside the provider module is plumbing, not a
 * consumer.
 */
const PROVIDER_MODULE = "_shared/aiProvider.ts";

/**
 * KNOWN-UNMETERED CALL SITES.
 *
 * EMPTY, and that is the point. It held eight files; every one now threads a
 * collector from whatever owns its run. An entry here is money the workspace
 * ceiling cannot see, so adding one is a deliberate, reviewable act — not a
 * default a new call site can fall into.
 */
const KNOWN_UNMETERED: Readonly<Record<string, string>> = Object.freeze({});

interface Site { path: string; line: number; fn: string; metered: boolean }

/** Call sites of generateText / generateJson, with the option object they pass. */
function callSites(path: string, src: string): Site[] {
  const out: Site[] = [];
  // BARE CALLS ONLY. `deps.generateJson({ system, user })` in
  // companyBrainResearch/generateBrainDraft.ts is an INJECTED dependency with a
  // different signature — that module imports no provider at all — and matching
  // it put a file on this list that cannot make a provider call. A member
  // expression is somebody else's seam, not aiProvider's.
  for (const m of src.matchAll(/(^|[^.\w])(generateText|generateJson)\s*\(\s*\{/g)) {
    const start = m.index! + m[0].length - 1;
    let depth = 0, i = start;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    const block = src.slice(start, i + 1);
    out.push({
      path,
      line: src.slice(0, m.index!).split("\n").length,
      fn: m[2],
      metered: block.includes("onModelCall"),
    });
  }
  return out;
}

const SITES: Site[] = FILES
  .filter((f) => f.path !== PROVIDER_MODULE)
  .flatMap((f) => callSites(f.path, f.text));

// ══════════ 1. the invariant ══════════════════════════════════════════════

Deno.test("the detector actually finds call sites", () => {
  // WITHOUT THIS THE INVARIANT IS VACUOUS. The regex was tightened once already
  // — to stop `deps.generateJson(...)` counting as a provider call — and a
  // tightening that matched nothing would turn every assertion below green.
  assert(
    SITES.length >= 13,
    `expected at least 13 model call sites, found ${SITES.length} — the detector is broken`,
  );
  for (const f of ["run-agent/index.ts", "pilot-chat/index.ts", "orchestrate/index.ts"]) {
    assert(SITES.some((s) => s.path === f), `no call site found in ${f}`);
  }
});

Deno.test("a module with no provider import is NOT a call site", () => {
  // companyBrainResearch/generateBrainDraft.ts calls `deps.generateJson({...})`
  // — an injected dependency of a different signature — and imports no provider
  // at all. It sat on the unmetered list for a call it cannot make.
  const draft = FILES.find((f) => f.path === "_shared/companyBrainResearch/generateBrainDraft.ts");
  assert(draft, "generateBrainDraft must exist");
  assert(
    !draft!.text.includes("aiProvider.ts"),
    "premise: this module reaches no provider directly",
  );
  assertEquals(
    SITES.filter((s) => s.path === "_shared/companyBrainResearch/generateBrainDraft.ts"), [],
    "an injected dependency must not be counted as a provider call site",
  );
});

Deno.test("THE INVARIANT: every model call site passes onModelCall, or is named", () => {
  const offenders = [...new Set(
    SITES.filter((s) => !s.metered).map((s) => s.path),
  )].filter((p) => !(p in KNOWN_UNMETERED)).sort();
  assertEquals(
    offenders, [],
    `these call ${"generateText"}/generateJson without an accounting seam: ` +
      `${offenders.join(", ")}. Pass \`onModelCall: collector.sink\` and drain ` +
      `the collector to the ledger — routing through aiProvider is not enough, ` +
      `it emits ONLY through that callback.`,
  );
});

Deno.test("THE LIST IS EMPTY, and must stay empty", () => {
  // It held eight files. Every one now threads a collector from whatever owns
  // its run: run-lead-action -> leadActionExecutor -> makeOpenerModel for the
  // opener boundary, and daily-brief, generate-company-brain-draft, orchestrate
  // and setup-company-brain each create and drain their own. The two planners
  // (actorInputPlanner, broadeningPlannerAdapter) have no production call site
  // and were given seams anyway, so reviving them cannot reintroduce a silent
  // unmetered call.
  assertEquals(
    Object.keys(KNOWN_UNMETERED).length, 0,
    "there is no longer any excuse for an unmetered model call — wire the collector",
  );
});

Deno.test("every allow-list entry still names a real, still-unmetered call site", () => {
  // An exception protecting nothing is how a real one hides later — the same
  // rot check `perplexityIsRetired.test.ts` carries.
  for (const p of Object.keys(KNOWN_UNMETERED)) {
    const sites = SITES.filter((s) => s.path === p);
    assert(sites.length > 0, `KNOWN_UNMETERED names "${p}", which has no model call site`);
    assert(
      sites.some((s) => !s.metered),
      `"${p}" is now fully metered — remove it from KNOWN_UNMETERED`,
    );
  }
});

// ══════════ 2. the path this change fixed ═════════════════════════════════

Deno.test("THE REGRESSION: run-agent's generic agent execution is metered", () => {
  // This is the path EVERY Scribe draft takes, and Penn's rewrites, and any
  // pilot step that falls through to a plain agent execution. It passed no
  // seam, so a content generation would have spent against a ceiling that
  // could not see it — reopening the hole CONTENT P0-2 was built on top of.
  const run = FILES.find((f) => f.path === "run-agent/index.ts");
  assert(run, "run-agent must exist");
  const sites = callSites(run!.path, run!.text);
  assert(sites.length > 0, "run-agent must still make a generic agent call");
  for (const s of sites) {
    assert(
      s.metered,
      `run-agent/index.ts:${s.line} calls ${s.fn} with no onModelCall`,
    );
  }
});

Deno.test("and the generic path drains what it collects", () => {
  // Collecting without draining is telemetry that never reaches the ledger —
  // the same shape of failure one layer further on.
  const run = FILES.find((f) => f.path === "run-agent/index.ts")!.text;
  assert(
    /genericModelCalls\s*=\s*new ModelCallCollector/.test(run),
    "the generic path must have its own collector",
  );
  assert(
    /genericModelCalls\.drain\(/.test(run),
    "the generic collector must be drained to the ledger",
  );
  // Drained before the error branch: a failed generation has still been paid
  // for, and recording only successes understates the bill exactly when
  // something is looping and failing.
  const collectAt = run.indexOf("genericModelCalls = new ModelCallCollector");
  const drainAt = run.indexOf("genericModelCalls.drain(");
  const errorAt = run.indexOf("if (apiError) {", collectAt);
  assert(drainAt > collectAt, "drain must follow collection");
  assert(
    errorAt < 0 || drainAt < errorAt,
    "the drain must happen before the error branch, or failed calls go unbilled",
  );
});

// ══════════ 2b. every collector is drained ════════════════════════════════

Deno.test("every function that collects also DRAINS to the ledger", () => {
  // A collector that is never drained is telemetry that reaches nothing — the
  // same failure one layer further on, and just as silent.
  const OWNERS = [
    "run-agent/index.ts",
    "pilot-chat/index.ts",
    "orchestrate/index.ts",
    "daily-brief/index.ts",
    "generate-company-brain-draft/index.ts",
    "setup-company-brain/index.ts",
    "run-lead-action/index.ts",
  ];
  for (const path of OWNERS) {
    const f = FILES.find((x) => x.path === path);
    assert(f, `${path} must exist`);
    assert(
      f!.text.includes("new ModelCallCollector("),
      `${path} must create a collector`,
    );
    assert(
      /\.drain\(/.test(f!.text),
      `${path} collects model telemetry but never drains it to the ledger`,
    );
    assert(
      f!.text.includes("createLedgerWriter("),
      `${path} must drain through the ledger writer`,
    );
  }
});

Deno.test("THE INJECTED SEAMS: shared modules accept a collector, never invent one", () => {
  // A library module must not create its own collector: it does not know the
  // workspace or the task, and guessing is how spend lands on the wrong bill.
  // It takes `onModelCall` from whoever owns the run.
  const INJECTED = [
    "_shared/workbench/openerModel.ts",
    "_shared/actorInputPlanner.ts",
    "_shared/broadeningPlannerAdapter.ts",
  ];
  for (const path of INJECTED) {
    const f = FILES.find((x) => x.path === path);
    assert(f, `${path} must exist`);
    assert(f!.text.includes("onModelCall"), `${path} must accept the seam`);
    assert(
      !f!.text.includes("new ModelCallCollector("),
      `${path} must NOT create its own collector — it cannot know whose spend this is`,
    );
  }
  // And the one that is reachable must actually be threaded to it.
  const exec = FILES.find((f) => f.path === "_shared/leadActionExecutor.ts")!;
  assert(
    /onModelCall: ctx\.onModelCall/.test(exec.text),
    "leadActionExecutor must forward the seam into makeOpenerModel",
  );
  const owner = FILES.find((f) => f.path === "run-lead-action/index.ts")!;
  assert(
    /onModelCall: modelCalls\.sink/.test(owner.text),
    "run-lead-action must supply the seam it owns",
  );
});

// ══════════ 3. logProviderCall is not accounting ══════════════════════════

Deno.test("nothing may treat logProviderCall as the model ledger", () => {
  // It writes `activity_feed` — no tokens, no cost. The ceiling sums
  // `lead_model_calls`. Confusing the two is what made the generic path look
  // instrumented for its whole life.
  const provider = FILES.find((f) => f.path === PROVIDER_MODULE);
  assert(provider, "aiProvider must exist");
  const body = provider!.text.slice(provider!.text.indexOf("export async function logProviderCall"));
  assert(
    body.includes('from("activity_feed")'),
    "logProviderCall still writes activity_feed — if that changed, this test's premise needs revisiting",
  );
  assert(
    !body.slice(0, 1200).includes("lead_model_calls"),
    "logProviderCall must not be mistaken for the model ledger",
  );
});
