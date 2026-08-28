import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  toBrainTurns, TURN_MAX_CHARS,
} from "../../../supabase/functions/_shared/conversationTurns.ts";

Deno.test("newest-first rows become oldest-first turns", () => {
  // POSITION IS THE WHOLE POINT. "the second company" is resolved by position
  // against the most recent result message; a transcript in the wrong order
  // puts the oldest list last and points the follow-up at the wrong turn.
  const turns = toBrainTurns([
    { role: "user", content: "Which of those look strongest?" },
    { role: "assistant", content: "32 leads saved." },
    { role: "user", content: "What leads do I currently have?" },
  ]);
  assertEquals(turns.map((t) => t.content), [
    "What leads do I currently have?",
    "32 leads saved.",
    "Which of those look strongest?",
  ]);
});

Deno.test("only the two roles a person would see survive", () => {
  const turns = toBrainTurns([
    { role: "system", content: "internal" },
    { role: "tool", content: "provider payload" },
    { role: "assistant", content: "kept" },
  ]);
  assertEquals(turns.map((t) => t.role), ["assistant"]);
});

Deno.test("empty and missing content is dropped, not sent as a blank turn", () => {
  assertEquals(toBrainTurns([
    { role: "user", content: "   " },
    { role: "assistant", content: null },
    { role: "user" },
  ]), []);
});

Deno.test("a long turn is truncated so one preview cannot crowd out the rest", () => {
  const [turn] = toBrainTurns([{ role: "assistant", content: "x".repeat(5000) }]);
  assertEquals(turn.content.length, TURN_MAX_CHARS + 1);
  assertEquals(turn.content.endsWith("…"), true);
});

Deno.test("no rows is an empty transcript, never a throw", () => {
  assertEquals(toBrainTurns(null), []);
  assertEquals(toBrainTurns(undefined), []);
  assertEquals(toBrainTurns([]), []);
});
