// AN AGENT IS RESOLVED WITHIN A WORKSPACE, NEVER BY SLUG ALONE.
//
// ── THE REGRESSION THIS ENCODES ─────────────────────────────────────────────
//
// Every sourcing run failed at the first step with:
//
//   404 agent_not_found
//   "JSON object requested, multiple (or no) rows returned"
//
// run-agent resolved the agent with `.eq("slug", agent_slug).maybeSingle()` and
// no workspace filter. That held exactly as long as agents lived in ONE sentinel
// workspace, where `scout` identified a single row globally.
//
// Seeding agents per workspace — the fix for users opening the app to an empty
// roster — made slugs deliberately non-unique ACROSS workspaces. `scout` then
// matched two rows, `maybeSingle()` treats that as an error, and the run died
// before it created a task. So one fix's correct behaviour became another's
// broken precondition, with nothing tying the two together.
//
// ── IT IS ALSO AN ISOLATION BUG ─────────────────────────────────────────────
//
// Worth stating separately, because it would survive a fix aimed only at the
// error: an unscoped lookup can resolve `scout` to ANOTHER workspace's agent row
// and execute the step under it. That is wrong even when exactly one row comes
// back — it just fails silently instead of loudly. The workspace filter is the
// correctness fix; not erroring is a side effect.
//
// Source-level, so it runs in CI with no database and fails the moment someone
// reintroduces a global-by-slug lookup.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const RUN = await Deno.readTextFile(
  new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
);

/** The agent-resolution statement, comments removed. */
function agentQueryBlock(): string {
  const start = RUN.indexOf('let agentQuery = supabase.from("agents")');
  assert(start > -1, "the agent resolution query must still exist");
  return RUN.slice(start, start + 500).replace(/^\s*\/\/.*$/gm, "");
}

Deno.test("1. the agent query is scoped to the workspace", () => {
  const block = agentQueryBlock();
  assert(
    /\.eq\("workspace_id",\s*workspace_id\)/.test(block),
    "resolving an agent by slug alone matches every workspace's copy — scope it " +
    "with .eq(\"workspace_id\", workspace_id)",
  );
});

Deno.test("2. the scope is applied before the slug/id branch, so both are covered", () => {
  // Attaching the filter inside only the slug branch would leave the `agent_id`
  // fallback able to reach another workspace's row.
  const block = agentQueryBlock();
  const ws = block.indexOf('.eq("workspace_id"');
  const slug = block.indexOf("if (agent_slug)");
  assert(ws > -1 && slug > -1);
  assert(
    ws < slug,
    "the workspace filter must be on the base query, not inside one branch — " +
    "otherwise the agent_id fallback stays unscoped",
  );
});

Deno.test("3. workspace_id is proven present before the lookup uses it", () => {
  // A filter on an undefined value would silently match nothing, turning this
  // into a different 404. The guard must come FIRST.
  const guard = RUN.indexOf('if (!workspace_id) return json({ error: "missing_required_fields" }, 400);');
  const query = RUN.indexOf('let agentQuery = supabase.from("agents")');
  assert(guard > -1, "run-agent must reject a request with no workspace_id");
  assert(
    guard < query,
    "the workspace_id guard must run BEFORE the agent lookup that filters on it",
  );
});

Deno.test("4. no lookup anywhere resolves an agent by slug alone", () => {
  // The generalisation. This is a bug CLASS: any query keyed on a slug that is
  // only unique per workspace has the same defect.
  const code = RUN.replace(/^\s*\/\/.*$/gm, "");
  const offenders = [...code.matchAll(/from\("agents"\)[\s\S]{0,300}?maybeSingle\(\)/g)]
    .filter((m) => !/\.eq\("workspace_id"/.test(m[0]))
    .map((m) => m[0].slice(0, 80));

  assertEquals(
    offenders, [],
    "an agents lookup reaching maybeSingle() without a workspace filter will " +
    "match one row per workspace and error as soon as a second workspace exists",
  );
});
