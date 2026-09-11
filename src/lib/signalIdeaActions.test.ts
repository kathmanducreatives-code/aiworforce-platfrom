import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ideaReviewStatus, buildTurnIntoCommand, buildTurnIntoMetadata, buildSignalContextMetadata, signalContentSource } from "./signalIdeaActions.ts";

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

Deno.test("turn-into metadata carries the signal's real id and the format, as data", () => {
  const post = buildTurnIntoMetadata("post", { id: "sig-1" });
  assertEquals(post, { intent: "signal_to_content", signal_id: "sig-1", content_format: "linkedin_post" });
  assertEquals(buildTurnIntoMetadata("comment", { id: "sig-1" }).content_format, "linkedin_comment");
});

Deno.test("a CANONICAL feed signal is a signal source with its real FK", () => {
  const s = signalContentSource({ id: "sig-1", title: "T", store: "signal_events" });
  assertEquals(s.source_type, "signal");
  assertEquals(s.source_signal_id, "sig-1");
  assertEquals(s.metadata, {});
});

Deno.test("a LEGACY-ONLY feed signal is an idea about it: no fake FK, provenance kept", () => {
  for (const store of ["signals", undefined] as const) {
    const s = signalContentSource({ id: "legacy-9", title: " Old radar signal ", store });
    assertEquals(s.source_type, "idea", `store=${store}`);
    assertEquals(s.source_signal_id, null, "a legacy id must never reach source_signal_id");
    assertEquals(s.idea, "Old radar signal");
    assertEquals(s.metadata, { legacy_signal: { id: "legacy-9", title: "Old radar signal", store: "signals" } });
  }
  assertEquals(signalContentSource({ id: "x", title: null, store: "signals" }).idea, "An earlier signal");
});

Deno.test("signal context metadata carries the id and no intent", () => {
  assertEquals(buildSignalContextMetadata({ id: "sig-1" }), { signal_id: "sig-1" });
});
