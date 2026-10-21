// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadConversationMemory } from "../../../supabase/functions/_shared/memoryReader.ts";
import { installStrictNetwork } from "../_helpers/strictNetwork.ts";

const setup = () => {
  const tables = {
    lead_candidates: [{
      id: "lead-A",
      workspace_id: "A",
      conversation_id: "chat-A",
      plan_id: null,
    }, {
      id: "lead-B",
      workspace_id: "B",
      conversation_id: "chat-B",
      plan_id: null,
    }],
    saved_outputs: [{
      id: "memory-B",
      workspace_id: "B",
      conversation_id: "chat-B",
      body: "PRIVATE_B_MEMORY",
    }],
    outreach_drafts: [
      {
        id: "draft-A",
        workspace_id: "A",
        lead_candidate_id: "lead-A",
        body: "PRIVATE_A_DRAFT",
      },
      {
        id: "other-conversation",
        workspace_id: "A",
        lead_candidate_id: "unrelated-lead",
        body: "WRONG_CONVERSATION",
      },
      {
        id: "unassociated",
        workspace_id: "A",
        lead_candidate_id: null,
        body: "UNASSOCIATED",
      },
      {
        id: "draft-B",
        workspace_id: "B",
        lead_candidate_id: "lead-B",
        body: "PRIVATE_B_DRAFT",
      },
      {
        id: "forged-B",
        workspace_id: "B",
        lead_candidate_id: "lead-A",
        body: "PRIVATE_B_FORGED",
      },
    ],
    accounts: [],
    contacts: [],
  };
  const n = installStrictNetwork({ tables, users: {} });
  const db = createClient(
    n.env("SUPABASE_URL")!,
    n.env("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      global: { fetch: n.fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return { n, db };
};
Deno.test("P2 memory: fresh conversation includes no workspace-wide draft text", async () => {
  const f = setup();
  const r = await loadConversationMemory({
    admin: f.db,
    workspace_id: "A",
    conversation_id: "new-chat",
  });
  assertEquals(r.outreach_drafts, []);
  assertEquals(r.has_any_memory, false);
  assertEquals(f.n.external, []);
  assert(
    !f.n.log.some((s) => s.includes("outreach_drafts")),
    "empty conversation does not query broad drafts",
  );
});
Deno.test("P2 memory: only drafts linked to this conversation selected leads, within its workspace", async () => {
  const f = setup();
  const r = await loadConversationMemory({
    admin: f.db,
    workspace_id: "A",
    conversation_id: "chat-A",
  });
  assertEquals(r.outreach_drafts.map((d) => d.id), ["draft-A"]);
  assertEquals(r.has_any_memory, true);
  assert(!JSON.stringify(r).includes("PRIVATE_B"));
  assert(!JSON.stringify(r).includes("UNASSOCIATED"));
  assert(!JSON.stringify(r).includes("WRONG_CONVERSATION"));
});
Deno.test("P2 memory: other client with overlapping identifiers cannot borrow A drafts", async () => {
  const f = setup();
  const r = await loadConversationMemory({
    admin: f.db,
    workspace_id: "B",
    conversation_id: "chat-B",
  });
  assertEquals(r.outreach_drafts.map((d) => d.id), ["draft-B"]);
  assert(!JSON.stringify(r).includes("PRIVATE_A"));
});
