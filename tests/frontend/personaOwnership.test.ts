// PILOT SPEAKS UNLESS THE BACKEND SAYS OTHERWISE.
//
// ── WHAT WAS HAPPENING ─────────────────────────────────────────────────────
//
// `resolveAgentFromMetadata` declined `pilot` as a fallback and called
// `inferAgentFromContent(content)` — a regex over the message's own text. So
// the speaker of a message was decided by what the message happened to say.
//
// Both observed live, on rows the backend attributed to `pilot`:
//
//   "I created a 5-step plan: Scout will source…"  -> matched "scout" -> Lyra
//   "• outreach — competitor activity"             -> matched "outreach" -> Mira
//
// The second is the clearest: a `signal_events` row whose `subject_key` is
// literally "outreach" appeared in a list, and Pilot became Mira. Neither was a
// handoff, and the backend had recorded the truth on every row.
//
// ── WHY THESE ARE SOURCE ASSERTIONS ────────────────────────────────────────
//
// `agentResolver` imports through the `@/` alias, which Vite resolves and the
// Deno test runner does not. Rather than add a second module resolution just to
// import it, the invariant is asserted where it lives: the resolver's own body
// must not consult the message text.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(
  new URL("../../src/lib/agentResolver.ts", import.meta.url));

/** The body of one exported function, comments stripped. */
function fnBody(name: string): string {
  const start = SRC.indexOf(`export function ${name}`);
  assert(start > 0, `${name} must exist`);
  const rest = SRC.slice(start);
  const body = rest.slice(0, rest.indexOf("\n}\n") + 3);
  return body.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
}

Deno.test("1. the resolver never guesses a speaker from message text", () => {
  const body = fnBody("resolveAgentFromMetadata");
  assertEquals(/inferAgentFromContent\(/.test(body), false,
    "a message naming Scout, or listing a signal about a company called " +
    "'outreach', must not change who is shown as speaking");
});

Deno.test("2. an unattributed message falls back to Pilot", () => {
  const body = fnBody("resolveAgentFromMetadata");
  assert(/return PILOT_PROFILE;/.test(body),
    "Pilot is the coordinator and the default speaker");
  assert(/if \(fallbackSlug\) return resolveAgent\(fallbackSlug\);/.test(body),
    "and a slug the backend supplied is honoured, including 'pilot'");
});

Deno.test("3. explicit metadata attribution still wins", () => {
  // A real handoff is recorded by the backend and must still be shown — that is
  // the case the product does want.
  const body = fnBody("resolveAgentFromMetadata");
  assert(/meta\.agent_id \?\? meta\.agent_slug/.test(body),
    "an explicitly attributed message is still attributed");
});

Deno.test("4. the content guesser is marked as not for attribution", () => {
  // It survives because `inferAgentFromAction` shares its vocabulary and some
  // non-chat activity surfaces still label rows by action. The deprecation note
  // is what stops it being reconnected to chat by the next reader.
  assert(/@deprecated[\s\S]{0,400}?export function inferAgentFromContent/.test(SRC),
    "the text guesser must carry a deprecation note explaining what it is not for");
});
