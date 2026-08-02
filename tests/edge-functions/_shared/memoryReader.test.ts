import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isFollowUpReference, extractTopN } from "../../../supabase/functions/_shared/memoryReader.ts";

Deno.test("isFollowUpReference: matches common follow-ups", () => {
  for (const m of [
    "draft outreach to the top 5",
    "only keep early-stage SaaS",
    "enrich the top 3",
    "show me the best ones",
    "use the previous results",
    "save this lead",
    "filter to companies in NYC",
    "narrow to series A",
    "reach out to these people",
  ]) {
    assert(isFollowUpReference(m), `expected follow-up: ${m}`);
  }
});

Deno.test("isFollowUpReference: ignores fresh requests", () => {
  for (const m of [
    "find 20 companies hiring growth marketers in the US",
    "write a linkedin post about what we shipped",
    "what's the weather",
    "analyze https://stripe.com/jobs",
  ]) {
    assertEquals(isFollowUpReference(m), false, `expected NOT follow-up: ${m}`);
  }
});

Deno.test("extractTopN: parses N from 'top N' phrasing", () => {
  assertEquals(extractTopN("draft outreach to the top 5"), 5);
  assertEquals(extractTopN("enrich the top 3"), 3);
  assertEquals(extractTopN("draft outreach to these leads"), 5); // fallback
  assertEquals(extractTopN("draft outreach to the top 200", 5), 5); // out of range -> fallback
});
