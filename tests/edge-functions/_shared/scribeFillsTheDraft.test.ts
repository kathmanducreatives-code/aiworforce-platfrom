// SCRIBE'S OUTPUT REACHES THE OBJECT THE USER CAN OPEN.
//
// ── CONTENT P0-2 ────────────────────────────────────────────────────────────
//
// `writeScribeContent` has existed, and been careful, for a long time:
// `cleanScribeOutput` strips ```json fences, parses structured output and falls
// back safely on a parse failure. It had never run. Production carries 106
// `scout` tasks, 1 `aria`, and zero `scribe` — nothing had ever created one.
//
// It also wrote only `saved_outputs`, which is an append-only record with no
// status and no version child. A draft written there cannot be edited,
// reopened or approved, which is why Content produced nothing durable even
// though this writer was sitting behind it.
//
// So P0-2 is two things: something finally creates a scribe task, and the
// result lands in `content_item` — the object CONTENT P0-1 added.
//
// ZERO network, ZERO models, ZERO providers, ZERO database.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SHARED = new URL("../../../supabase/functions/_shared/", import.meta.url);
const WRITER = await Deno.readTextFile(new URL("memoryWriter.ts", SHARED));

/** The body of `writeScribeContent`, so neighbouring writers cannot satisfy these. */
const SCRIBE = (() => {
  const start = WRITER.indexOf("async function writeScribeContent");
  assert(start > 0, "writeScribeContent must exist");
  const end = WRITER.indexOf("\n}", start);
  return WRITER.slice(start, end);
})();

Deno.test("scribe is still the agent content dispatches to", () => {
  // CONTENT P1-2: the registry maps Mira -> penn (the OUTREACH writer, which
  // persists outreach_drafts) while the page rendered scribe's avatar under
  // Mira's name. Content belongs to scribe; if that gate moves, the Content
  // surface is addressing an agent that does not write content.
  assert(
    /if \(slug === "scribe"\)\s*\{\s*await writeScribeContent/.test(WRITER),
    "writeMemoryFromAgentResult must dispatch scribe to writeScribeContent",
  );
});

Deno.test("THE POINT OF P0-2: a generated draft reaches content_item", () => {
  assert(
    SCRIBE.includes('.from("content_item")'),
    "writeScribeContent must write the durable object, not only saved_outputs — " +
      "a saved_outputs row cannot be edited, reopened or approved",
  );
  assert(
    SCRIBE.includes('.from("saved_outputs")'),
    "and must still write saved_outputs, which other surfaces read",
  );
});

Deno.test("THE CROSS-TENANT GUARD: the update is scoped by workspace, not id alone", () => {
  // `content_item_id` arrives from the CLIENT through `tool_input`, and this
  // writer holds the service role, which bypasses RLS. Matching on id alone
  // would let a forged id overwrite another tenant's draft — the same class of
  // mistake as `ops_stuck_run_archive`, arriving from the other direction.
  const upd = SCRIBE.slice(SCRIBE.indexOf('.from("content_item")'));
  assert(upd.includes(".eq(\"id\", cl.content_item_id)"), "must target the named draft");
  assert(
    upd.includes('.eq("workspace_id", ctx.workspace_id)'),
    "must ALSO constrain workspace_id — the service role does not get RLS",
  );
});

Deno.test("generation is a proposal: it lands in review, never approved", () => {
  // The page's stated contract is approval-first. A generated draft is the
  // agent's suggestion; writing it straight to `approved` would let an
  // unreviewed model output through the queue that exists to catch it.
  const upd = SCRIBE.slice(SCRIBE.indexOf('.from("content_item")'));
  assert(upd.includes('status: "in_review"'), "a generated draft must land in review");
  assert(!upd.includes('status: "approved"'), "generation must never approve its own output");
});

Deno.test("filling a draft is opt-in, so other scribe paths are unaffected", () => {
  // Guarded on the id being present. A scribe run from anywhere else — the
  // content-engagement loop behind `orchestrate`, say — still writes
  // saved_outputs only, and touches no content_item it was not given.
  assert(
    /if \(cl\?\.content_item_id\)/.test(SCRIBE),
    "the content_item write must be guarded on an id actually being supplied",
  );
});

Deno.test("a failed content_item write does not fail the run", () => {
  // The generation has already been paid for and saved_outputs already has it.
  // Throwing here would turn a bookkeeping miss into a failed task.
  const upd = SCRIBE.slice(SCRIBE.indexOf('.from("content_item")'));
  assert(
    /console\.warn\("\[memoryWriter\] content_item update failed:/.test(upd),
    "a failed update must be logged, not thrown",
  );
  assert(!/throw /.test(upd), "writeScribeContent must not throw on a content_item failure");
});

Deno.test("run-agent still routes scribe results to the writer", () => {
  // The dispatch is gated on an explicit slug list in run-agent. Dropping
  // "scribe" there would silence content generation with no error anywhere.
  const RUN = Deno.readTextFileSync(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assert(
    /agent_slug === "aria" \|\| agent_slug === "penn" \|\| agent_slug === "scribe"/.test(RUN),
    "run-agent must still hand scribe results to writeMemoryFromAgentResult",
  );
  assert(
    /content_loop: \(tool_input_body\?\.content_loop/.test(RUN),
    "run-agent must still forward tool_input.content_loop, which carries content_item_id",
  );
});
