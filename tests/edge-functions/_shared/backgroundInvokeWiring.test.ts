// ARE THE CALL SITES ACTUALLY USING IT?
//
// `backgroundInvoke.ts` can be perfectly correct and perfectly unreachable —
// that is exactly how the GPT planner shipped fully tested and inert, and how
// this stall survived three live runs. The unit tests prove the helper behaves;
// only these prove that `orchestrate` and `run-agent` go through it.
//
// Source-level on purpose: it runs in CI with no database and no runtime, and
// it fails the moment someone reintroduces a floating `fetch` to a function.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));

const ORCH = await read("supabase/functions/orchestrate/index.ts");
const RUN = await read("supabase/functions/run-agent/index.ts");

/** Comments legitimately describe the old broken pattern. */
const stripComments = (s: string) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

Deno.test("1. both handoff sites go through invokeInBackground", () => {
  for (const [name, src] of [["orchestrate", ORCH], ["run-agent", RUN]] as const) {
    assert(
      /import \{ invokeInBackground, describeFailure \}/.test(src),
      `${name} must import the helper`,
    );
    assert(
      /invokeInBackground\(\{/.test(src),
      `${name} must actually call it, not merely import it`,
    );
  }
});

Deno.test("2. NO floating fetch to another edge function remains", () => {
  // THE REGRESSION GUARD. A bare `fetch(...)` to functions/v1 that nobody
  // awaits and nobody registers is the original defect. Every legitimate call
  // is either awaited or routed through the helper.
  for (const [name, src] of [["orchestrate", ORCH], ["run-agent", RUN]] as const) {
    const code = stripComments(src);
    const offenders = [...code.matchAll(/(^|[^.\w])fetch\(\s*`[^`]*functions\/v1\/[^`]*`/gm)]
      .filter((m) => {
        // `await fetch(...)` is fine — the caller is holding the request open.
        const before = code.slice(Math.max(0, m.index! - 12), m.index! + 1);
        return !/await\s*$/.test(before);
      })
      .map((m) => m[0].trim().slice(0, 70));

    assertEquals(
      offenders, [],
      `${name} has an unawaited fetch to another edge function. Use ` +
      `invokeInBackground so the runtime keeps the isolate alive and an HTTP ` +
      `error is observed instead of resolving silently.`,
    );
  }
});

Deno.test("3. a failed handoff marks the plan, so nothing sits in `executing`", () => {
  // The half that makes any future variant of this visible. Without it a
  // dropped handoff, a 401 and a crashed callee all look identical forever.
  for (const [name, src] of [["orchestrate", ORCH], ["run-agent", RUN]] as const) {
    const site = src.slice(src.indexOf("invokeInBackground({"));
    assert(/onFailure:/.test(site), `${name} must supply onFailure`);
    assert(
      /from\("task_plans"\)[\s\S]{0,160}status:\s*"failed"/.test(site),
      `${name}'s onFailure must mark the plan failed`,
    );
    assert(
      /event_type:\s*"plan_failed"/.test(site),
      `${name} must leave an activity row explaining why`,
    );
  }
});

Deno.test("4. the helper is never asked to carry the whole run", () => {
  // `invokeInBackground` must not be awaited at the call sites: run-agent
  // executes the entire step before responding, so awaiting it would hold the
  // user's request open past the function timeout and produce a 504 — the very
  // reason the original code was fire-and-forget.
  for (const [name, src] of [["orchestrate", ORCH], ["run-agent", RUN]] as const) {
    assertEquals(
      /await\s+invokeInBackground\(/.test(stripComments(src)), false,
      `${name} must NOT await the handoff — that reintroduces the timeout this ` +
      `pattern exists to avoid`,
    );
  }
});
