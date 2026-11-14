// R1.1 · the ORION draft marker: a draft is always shown as text only and not sent.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ORION_DRAFT_CHIP_TEXT, readOrionDraft } from "../../src/lib/chat/orionDraft.ts";

Deno.test("draft marker: reads the server's text-only draft metadata", () => {
  const d = readOrionDraft({ orion_draft: { version: "orion-draft-v1", kinds: ["campaign", "linkedin_post", "cold_email", "video_script"],
    text_only: true, delegated: false, sent: false } });
  assertEquals(d?.labels, ["Campaign concept", "LinkedIn post", "Cold email", "Video script"]);
});
Deno.test("draft marker: absent, malformed or not text-only → no marker", () => {
  for (const m of [null, {}, { orion_draft: null }, { orion_draft: "x" }, { orion_draft: { kinds: ["linkedin_post"] } },
    { orion_draft: { text_only: "true", kinds: [] } }]) assertEquals(readOrionDraft(m), null);
});
Deno.test("draft marker: unknown kinds are dropped, never rendered", () => {
  assertEquals(readOrionDraft({ orion_draft: { text_only: true, kinds: ["<script>", 3, "follow_up"] } })?.kinds, ["follow_up"]);
  assertEquals(readOrionDraft({ orion_draft: { text_only: true, kinds: [] } })?.labels, ["Draft"]);
});
Deno.test("draft marker: the fixed text says nothing was sent and execution is off", () => {
  assert(/nothing sent or published/.test(ORION_DRAFT_CHIP_TEXT));
  assert(/execution is off/.test(ORION_DRAFT_CHIP_TEXT));
});
Deno.test("ChatView renders the draft chip from metadata", async () => {
  const src = await Deno.readTextFile(new URL("../../src/components/chat/workspace/ChatView.tsx", import.meta.url));
  assert(src.includes("{meta?.orion_draft && <OrionDraftChip metadata={meta} />}"));
});
