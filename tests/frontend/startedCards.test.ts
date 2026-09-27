// A STARTED CARD STAYS STARTED — AND ITS START NAMES THE CARD.
//
// Conversation 38e904cb, 2026-09-27: one workflow card's Start reached
// pilot-chat twice and ran two paid missions. The server now refuses a repeat
// by the card's message id (startIdempotency.test.ts). These hold the client
// half: the Start carries that id, and a card the conversation shows as
// started never offers Start again — whatever its component state, because a
// remount resets component state and the conversation does not.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { startedCardIds } from "../../src/lib/chat/startedCards.ts";
import { buildStartWorkflowPayload } from "../../src/lib/qualifiedLead/contract.ts";

const card = (id: string) => ({ id, role: "assistant", metadata: { type: "workflow_confirmation" } });
const startOf = (id: string | null) => ({
  id: `start-${id ?? "legacy"}-${Math.random()}`, role: "user",
  metadata: { confirmed: true, action_source: "lead_intake_card", ...(id ? { confirmation_message_id: id } : {}) },
});

Deno.test("a card named by a Start is started", () => {
  const ids = startedCardIds([card("c1"), startOf("c1")]);
  assertEquals([...ids], ["c1"]);
});

Deno.test("a card with no Start is not started", () => {
  const typed = { id: "u", role: "user", metadata: {} };
  const plan = { id: "p", role: "assistant", metadata: { type: "execution_plan" } };
  assertEquals(startedCardIds([card("c1"), typed, plan]).size, 0);
});

Deno.test("an older Start that names no card belongs to the card above it, never past a later card", () => {
  // The 38e904cb shape before this fix: card, Start, Start, all unnamed.
  assertEquals([...startedCardIds([card("c1"), startOf(null), startOf(null)])], ["c1"]);
  // A later card is a new request; an unnamed Start above it is not its Start.
  const ids = startedCardIds([card("c1"), startOf(null), card("c2")]);
  assert(ids.has("c1"));
  assertFalse(ids.has("c2"), "c2 has not been started");
});

Deno.test("a named Start marks exactly the card it names, even an earlier one", () => {
  const ids = startedCardIds([card("c1"), card("c2"), startOf("c1")]);
  assertEquals([...ids], ["c1"]);
});

Deno.test("a lead brief is not a Start", () => {
  // LeadIntakeCard shares the action source but sends no `confirmed`.
  const brief = { id: "b", role: "user", metadata: { action_source: "lead_intake_card", lead_request: {} } };
  assertEquals(startedCardIds([card("c1"), brief]).size, 0);
});

Deno.test("the Start payload carries the card's message id, and only when there is one", () => {
  const payload = {
    workflow_id: "find_qualified_leads", workflow_name: "Check 1 company", original_instruction: "Check 1 company: Fuse AI",
    inputs: {}, agent_team: [], lead_mission: { version: "lead-mission-v1" },
  // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(buildStartWorkflowPayload(payload, {}, "card-1").metadata.confirmation_message_id, "card-1");
  assertFalse("confirmation_message_id" in buildStartWorkflowPayload(payload, {}).metadata);
  assertFalse("confirmation_message_id" in buildStartWorkflowPayload(payload, {}, null).metadata);
  assertEquals(buildStartWorkflowPayload(payload, {}, "card-1").metadata.confirmed, true, "still a confirmed Start");
});

Deno.test("the card is wired to both: it sends its id and obeys the conversation", async () => {
  const view = await Deno.readTextFile(
    new URL("../../src/components/chat/workspace/ChatView.tsx", import.meta.url));
  assert(/const startedCards = startedCardIds\(messages\)/.test(view));
  assert(/<WorkflowConfirmationCard[\s\S]*?messageId=\{m\.id\}[\s\S]*?alreadyStarted=\{startedCards\.has\(m\.id\)\}/.test(view),
    "ChatView passes the card its message id and whether the conversation shows it started");

  const cardSrc = await Deno.readTextFile(
    new URL("../../src/components/chat/workspace/bubbles/WorkflowConfirmationCard.tsx", import.meta.url));
  assert(cardSrc.includes("buildStartWorkflowPayload(payload, inputs, messageId)"), "Start sends the card id");
  assert(/if \(blocked \|\| routingMismatch \|\| submitted \|\| alreadyStarted\) return;/.test(cardSrc),
    "a started card's Start does nothing, even if it were pressed");
  assert(/if \(submitted \|\| alreadyStarted\) \{\s*return \(/.test(cardSrc),
    "and a started card renders no Start button at all");
});
