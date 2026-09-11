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

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SHARED = new URL("../../../supabase/functions/_shared/", import.meta.url);
const WRITER = await Deno.readTextFile(new URL("memoryWriter.ts", SHARED));

/**
 * The Scribe writer FAMILY, so neighbouring writers cannot satisfy these:
 * `writeScribeContent`, the one `fillContentItem` update every Content path
 * shares, and the engagement-comment seam that creates items at write time.
 */
const SCRIBE = (() => {
  const body = (name: string) => {
    const start = WRITER.indexOf(`async function ${name}`);
    assert(start > 0, `${name} must exist`);
    return WRITER.slice(start, WRITER.indexOf("\n}", start));
  };
  return ["writeScribeContent", "fillContentItem", "writeEngagementCommentItems"].map(body).join("\n");
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
  assert(upd.includes('.eq("id", itemId)'), "must target the named draft");
  // EVERY id-targeted content_item statement is ALSO workspace-scoped.
  const byId = upd.split('.eq("id", itemId)').length - 1;
  const scoped = upd.split('.eq("id", itemId)\n    .eq("workspace_id", ctx.workspace_id)').length - 1;
  assertEquals(scoped, byId, "must ALSO constrain workspace_id — the service role does not get RLS");
});

Deno.test("generation is a proposal: it lands in draft, never approved", () => {
  // The page's stated contract is approval-first. A generated draft is the
  // agent's suggestion; writing it straight to `approved` would let an
  // unreviewed model output through the review it exists to receive.
  //
  // It used to land in `in_review`. Content V1 removed that state — nothing
  // ever transitioned out of it, because V1 has no reviewer and no publishing —
  // so `draft` is now the only pre-approval state, and it carries the same
  // meaning: a human has not accepted this yet.
  const upd = SCRIBE.slice(SCRIBE.indexOf('.from("content_item")'));
  assert(upd.includes('status: "draft"'), "a generated draft must land unapproved");
  assert(!upd.includes('status: "approved"'), "generation must never approve its own output");
  assert(
    !upd.includes('status: "in_review"'),
    "in_review is no longer a valid status — the CHECK constraint would reject it",
  );
});

Deno.test("THE PROVENANCE: a generation is recorded as one", () => {
  // The version trigger copies `last_generation_source` onto the version row,
  // which is the only way history can tell a first draft, a regeneration and a
  // hand edit apart.
  const upd = SCRIBE.slice(SCRIBE.indexOf('.from("content_item")'));
  assert(
    upd.includes('last_generation_source: cl.regenerate ? "scribe_regeneration" : "scribe_generation"'),
    "the writer must record which kind of generation this was",
  );
});

Deno.test("metadata is MERGED, never replaced", () => {
  // The row carries the brief it was created with, and a regeneration reads it
  // back. Overwriting the whole jsonb would erase the only record of what the
  // draft was asked to be — and make the second draft answer a different
  // question from the first.
  const upd = SCRIBE.slice(SCRIBE.indexOf('.from("content_item")'));
  assert(upd.includes("...prior"), "the existing metadata must be spread into the update");
  assert(
    /\.select\("metadata"\)/.test(SCRIBE),
    "which means it has to be read first",
  );
});

Deno.test("filling a draft is opt-in, so other scribe paths are unaffected", () => {
  // Guarded on the id being present: a run fills only a content_item it was
  // given. The engagement loop's comment step has none, so it CREATES its own
  // items per post (`writeEngagementCommentItems`) rather than filling one.
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
