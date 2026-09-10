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
 * KNOWN-UNMETERED CALL SITES, AND WHY THEY SURVIVE.
 *
 * Every one of these spends real money that the workspace ceiling cannot see.
 * They are recorded rather than fixed because each needs a collector threaded
 * from whatever owns its run, and doing that blind — in the same change as a
 * content feature — is how a wrong `workspace_id` gets attributed to somebody
 * else's bill.
 *
 * THIS LIST MAY SHRINK AND MUST NEVER GROW. The number below is pinned, so a
 * new unmetered call site fails this test rather than appearing in a month's
 * invoice.
 */
const KNOWN_UNMETERED: Readonly<Record<string, string>> = Object.freeze({
  "_shared/actorInputPlanner.ts": "Apify input planning; needs the lead run's collector",
  "_shared/broadeningPlannerAdapter.ts": "ICP broadening; needs the lead run's collector",
  "_shared/companyBrainResearch/generateBrainDraft.ts": "company brain draft; onboarding path",
  "_shared/workbench/openerModel.ts": "Penn opener boundary; injected, so the seam belongs on ModelBoundary",
  "daily-brief/index.ts": "scheduled brief; no user request to attribute to",
  "generate-company-brain-draft/index.ts": "onboarding draft",
  "orchestrate/index.ts": "planner call; orchestrate has no collector at all",
  "setup-company-brain/index.ts": "onboarding, two call sites",
});

interface Site { path: string; line: number; fn: string; metered: boolean }

/** Call sites of generateText / generateJson, with the option object they pass. */
function callSites(path: string, src: string): Site[] {
  const out: Site[] = [];
  for (const m of src.matchAll(/\b(generateText|generateJson)\s*\(\s*\{/g)) {
    const start = m[0].length + m.index! - 1;
    let depth = 0, i = start;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    const block = src.slice(start, i + 1);
    out.push({
      path,
      line: src.slice(0, m.index!).split("\n").length,
      fn: m[1],
      metered: block.includes("onModelCall"),
    });
  }
  return out;
}

const SITES: Site[] = FILES
  .filter((f) => f.path !== PROVIDER_MODULE)
  .flatMap((f) => callSites(f.path, f.text));

// ══════════ 1. the invariant ══════════════════════════════════════════════

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

Deno.test("the known-unmetered list may shrink, never grow", () => {
  assertEquals(
    Object.keys(KNOWN_UNMETERED).length, 8,
    "a new unmetered model call is a regression — wire it to a collector instead",
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
