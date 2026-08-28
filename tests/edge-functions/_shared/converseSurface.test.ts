import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  converseSystemPrompt, CONVERSE_UNAVAILABLE,
} from "../../../supabase/functions/_shared/converseSurface.ts";

Deno.test("the facts are not presented as a workspace inventory", () => {
  // LIVE, 2026-08-28: three conversation-scoped counters were handed over under
  // a heading that read `workspace_facts`, and a zero in one of them came back
  // as "I don't have any leads or prospects in the workspace yet. We're
  // starting from zero." — one turn after the workspace's 32 leads were named.
  const p = converseSystemPrompt({
    workspaceContext: "ICP: recruiting agencies.",
    facts: ["Leads this conversation has produced so far: 0."],
  });
  assertEquals(p.includes("workspace_facts"), false);
  assert(p.includes("<facts_you_were_given>"));
});

Deno.test("absence may not be inferred from a fact that was not given", () => {
  const p = converseSystemPrompt({ workspaceContext: null, facts: [] });
  assert(/never turn a fact you were not given into an absence/i.test(p));
  assert(/starting from zero/i.test(p),
    "the exact phrase that shipped is named so the rule cannot drift off it");
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
