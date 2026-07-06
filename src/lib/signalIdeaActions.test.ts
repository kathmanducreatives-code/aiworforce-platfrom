import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ideaReviewStatus, buildTurnIntoCommand } from "./signalIdeaActions.ts";

Deno.test("Save persists 'saved' review status", () => {
  assertEquals(ideaReviewStatus("save"), "saved");
});

Deno.test("Ignore persists 'ignored' review status", () => {
  assertEquals(ideaReviewStatus("ignore"), "ignored");
});

Deno.test("turn-into command is draft-only and carries source", () => {
  const cmd = buildTurnIntoCommand("post", { title: "Cekura hiring", sourceUrl: "https://x.test/a" });
  assert(cmd.includes("draft only"));
  assert(cmd.includes("Cekura hiring"));
  assert(cmd.includes("https://x.test/a"));
});

Deno.test("no auto-post / auto-send language exists in the command", () => {
  const post = buildTurnIntoCommand("post", { title: "T" });
  const comment = buildTurnIntoCommand("comment", { title: "T" });
  for (const cmd of [post, comment]) {
    assert(!/auto-?post|publish|post it now|auto-?send|send it|auto-?comment/i.test(cmd), cmd);
  }
});
