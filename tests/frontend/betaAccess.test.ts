// THE BETA ACCESS CARD: FILE A REQUEST WHERE THE REFUSAL IS, THEN SAY WHERE IT STANDS.
//
// Pilot answers a paid Start from a workspace with no credits with the
// private-beta message (metadata.credits_required). The card under it files a
// `beta_access_requests` row as the signed-in member and then shows its status.
// PURE: the view function, and the wiring read from source.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { betaAccessView, isAlreadyRequested } from "../../src/lib/beta/betaAccess.ts";

const row = (status: string, credits: number | null = null) => ({
  id: "r1", status, credits_granted: credits, created_at: "2026-09-29T08:00:00Z",
  decided_at: status === "pending" ? null : "2026-09-29T09:00:00Z",
});

Deno.test("no request → the form; pending → no form, nothing to do; approved → how many credits and what next", () => {
  const none = betaAccessView(null);
  assertEquals([none.state, none.canRequest], ["none", true]);
  const pending = betaAccessView(row("pending"));
  assertEquals([pending.state, pending.canRequest], ["pending", false]);
  assert(pending.body.includes("2026-09-29"));
  const approved = betaAccessView(row("approved", 50));
  assertEquals([approved.state, approved.canRequest], ["approved", false]);
  assert(approved.body.includes("50 credits were added"));
  assert(approved.body.includes("Start the search again"));
  assert(betaAccessView(row("approved", 1)).body.includes("1 credit was added"));
});

Deno.test("declined → can ask again (a decline is not a ban)", () => {
  const v = betaAccessView(row("declined"));
  assertEquals([v.state, v.canRequest], ["declined", true]);
});

Deno.test("a second click while a request is open is 'already requested', not an error", () => {
  assert(isAlreadyRequested({ code: "23505" }));
  assertFalse(isAlreadyRequested({ code: "42501" }), "an RLS refusal is a real error");
  assertFalse(isAlreadyRequested(null));
});

Deno.test("WIRED: the card sits under Pilot's credits_required reply and files as the member, undecided", () => {
  const chat = Deno.readTextFileSync(new URL("../../src/components/chat/workspace/ChatView.tsx", import.meta.url));
  assert(chat.includes("{meta && meta.credits_required === true && <BetaAccessCard />}"));
  const card = Deno.readTextFileSync(new URL("../../src/components/chat/workspace/bubbles/BetaAccessCard.tsx", import.meta.url));
  const insert = card.slice(card.indexOf(".from('beta_access_requests').insert({"), card.indexOf("});", card.indexOf(".insert({")));
  assert(insert.includes("workspace_id: workspaceId") && insert.includes("requested_by: user.id"));
  assertFalse(/status|credits_granted|decided_at/.test(insert), "the browser never writes a decision (RLS would refuse it anyway)");
  const pilot = Deno.readTextFileSync(new URL("../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  assert(pilot.includes("metadata: { credits_required: true,"), "the marker the card keys on");
});
