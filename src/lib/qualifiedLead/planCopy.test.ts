// PART 2 — execution-plan and running-state copy.
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  executionStages, showsFastModeBadge, executionModeBadge, runningCopy,
  QUALIFIED_LEAD_STAGES, ACCOUNT_OPPORTUNITY_STAGES, COMPOUND_STAGE_NOTE,
} from "./planCopy.ts";

Deno.test("PART 2: a qualified-lead plan shows the six product stages", () => {
  assertEquals(executionStages("qualified_lead_sourcing").map((s) => s.label), [
    "Find companies with relevant hiring signals",
    "Verify company fit and supporting evidence",
    "Find Founder, Co-Founder or CEO",
    "Verify the person's current employer and role",
    "Prepare CONTACT-ready opportunities for review",
    "Continue sourcing when the requested quota remains",
  ]);
});

Deno.test("PART 2: the misleading provider-centric copy is gone", () => {
  const text = QUALIFIED_LEAD_STAGES.map((s) => s.label).join(" | ").toLowerCase();
  for (const bad of ["apify", "aria ranks signals", "fast mode", "find decision-makers next"]) {
    assertFalse(text.includes(bad), `qualified-lead plan still says "${bad}"`);
  }
});

Deno.test("PART 2: stages use real Agentory agent slugs", () => {
  for (const s of QUALIFIED_LEAD_STAGES) {
    assert(["scout", "aria", "pilot"].includes(s.agent), `unknown agent slug: ${s.agent}`);
  }
});

Deno.test("PART 2: the plan does not claim one paid provider call per stage", () => {
  assert(COMPOUND_STAGE_NOTE.includes("one compound sourcing round"));
  assert(COMPOUND_STAGE_NOTE.includes("not six separate provider calls"));
});

Deno.test("PART 2: Fast mode is never shown for a qualified-lead workflow", () => {
  assertFalse(showsFastModeBadge("qualified_lead_sourcing"));
  assertEquals(executionModeBadge("qualified_lead_sourcing", "fast"), "Company-first");
  assertFalse(runningCopy("qualified_lead_sourcing").toLowerCase().includes("fast"));
});

Deno.test("PART 2 regression: the account-only workflow keeps its existing fast-mode copy", () => {
  assertEquals(executionStages("account_opportunity_sourcing"), ACCOUNT_OPPORTUNITY_STAGES);
  assertEquals(executionStages(null), ACCOUNT_OPPORTUNITY_STAGES);
  assert(showsFastModeBadge("account_opportunity_sourcing"), "fast mode must still be available");
  assertEquals(executionModeBadge("account_opportunity_sourcing", "fast"), "fast");
  // The original provider-centric lines are intentionally preserved here.
  const text = ACCOUNT_OPPORTUNITY_STAGES.map((s) => s.label).join(" | ");
  assert(text.includes("Scout sources signals through Apify"));
  assert(text.includes("Aria ranks signals"));
});

Deno.test("PART 2: running copy names the current stage", () => {
  assertEquals(runningCopy("qualified_lead_sourcing", "verify_employer"), "Verify the person's current employer and role…");
  assertEquals(runningCopy("qualified_lead_sourcing", null), "Sourcing qualified leads…");
  assertEquals(runningCopy("account_opportunity_sourcing", "anything"), "Working…");
});
