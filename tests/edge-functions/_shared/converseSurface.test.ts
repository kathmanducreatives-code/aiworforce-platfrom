import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  converseSystemPrompt, CONVERSE_UNAVAILABLE,
} from "../../../supabase/functions/_shared/converseSurface.ts";
import {
  conversationFact, workspaceFact,
} from "../../../supabase/functions/_shared/groundedFacts.ts";

Deno.test("a conversation count is never presented as workspace truth", () => {
  // LIVE, 2026-08-28: three conversation-scoped counters were handed over under
  // a heading that read `workspace_facts`, and a zero in one of them came back
  // as "I don't have any leads or prospects in the workspace yet. We're
  // starting from zero." — one turn after the workspace's 32 leads were named.
  const p = converseSystemPrompt({
    workspaceContext: "ICP: recruiting agencies.",
    facts: [conversationFact("Leads this conversation has produced so far: 0.", "memory")],
  });
  assertEquals(p.includes("workspace_facts"), false);
  assert(/TRUE OF THIS CONVERSATION ONLY/.test(p),
    "the conversation-scoped group must be labelled as such");
  assertFalse(/TRUE OF THE WORKSPACE[\s\S]*this conversation has produced/.test(p),
    "a conversation fact must not appear under the workspace heading");
});

Deno.test("a workspace fact is grouped apart from a conversation fact", () => {
  const p = converseSystemPrompt({
    workspaceContext: null,
    facts: [
      conversationFact("Drafts this conversation produced: 0.", "memory"),
      workspaceFact("Company Brain onboarding complete: yes.", "brain"),
    ],
  });
  const ws = p.indexOf("TRUE OF THE WORKSPACE");
  const cv = p.indexOf("TRUE OF THIS CONVERSATION ONLY");
  assert(ws > 0 && cv > 0 && ws < cv, "both groups render, workspace first");
});

Deno.test("absence may not be inferred from a fact that was not given", () => {
  const p = converseSystemPrompt({ workspaceContext: null, facts: [] });
  assert(/a number you were not given is a number you do not know/i.test(p));
  assert(/starting from zero/i.test(p),
    "the exact phrase that shipped is named so the rule cannot drift off it");
  assert(/do not know what it holds — not that it is empty/i.test(p),
    "no facts must be stated as ignorance, never as an empty workspace");
});

Deno.test("an earlier turn's report is not contradicted", () => {
  const p = converseSystemPrompt({ workspaceContext: null });
  assert(/earlier turn in this conversation reported something/i.test(p));
});

Deno.test("no Company Brain is stated, never invented", () => {
  const p = converseSystemPrompt({ workspaceContext: null });
  assert(/Company Brain is not set up yet/.test(p));
  assert(/do not invent an ICP/.test(p));
});

Deno.test("the unavailable line reports a failure rather than greeting", () => {
  assertEquals(/^Hi[ —,]/.test(CONVERSE_UNAVAILABLE), false);
  assert(/couldn't/.test(CONVERSE_UNAVAILABLE));
});
