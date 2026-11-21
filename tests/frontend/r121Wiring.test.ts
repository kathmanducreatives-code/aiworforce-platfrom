// R1.2.1 · wiring of the two fixes in the app (source-level; the logic itself is
// tested in startedCards.test.ts and tests/edge-functions/_shared/conversationBinding.test.ts).
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (p: string) => Deno.readTextFile(new URL(`../../${p}`, import.meta.url));

Deno.test("New chat binds the conversation to the active workspace", async () => {
  const src = await read("src/hooks/useConversationActions.ts");
  const insert = src.slice(src.indexOf(".from('conversations' as any)"), src.indexOf(".select('id, agent_slug')"));
  assertStringIncludes(insert, ".insert({");
  assertStringIncludes(insert, "user_id: userId,");
  assertStringIncludes(insert, "workspace_id: workspaceId,");
  // And it refuses to create a chat with no workspace selected.
  assertStringIncludes(src, "if (!workspaceId) {");
});

Deno.test("the workflow card reads the Start outcome and never hard-codes 'Started' after a refusal", async () => {
  const card = await read("src/components/chat/workspace/bubbles/WorkflowConfirmationCard.tsx");
  assertStringIncludes(card, "startOutcome?: StartOutcome;");
  const refusedAt = card.indexOf("if (startOutcome === 'refused') {");
  const startedAt = card.indexOf("if (submitted || alreadyStarted) {");
  assert(refusedAt > 0 && refusedAt < startedAt, "the refused branch must come before the started branch");
  assertStringIncludes(card, "startLabel(payload.workflow_name, startOutcome, submitted)");
  assert(!card.includes("`Started ${payload.workflow_name}`"), "no hard-coded Started label left in the card");
  const view = await read("src/components/chat/workspace/ChatView.tsx");
  assertStringIncludes(view, "const startOutcomes = cardStartOutcomes(messages);");
  assertStringIncludes(view, "startOutcome={startOutcomes.get(m.id)}");
});
