// ACTION PREREQUISITES. ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recommendNextAction, isRecommendationDispatchable } from "./credits.ts";
import type { LeadTableRow } from "@/hooks/useLeadResults";

const row = (o: Partial<LeadTableRow> = {}): LeadTableRow => ({
  id: "r1", company: "Acme", website: "https://acme.com", domain_status: "ok",
  contact_status: "needs_contact", enrichment_status: "pending", draft_status: "none",
  ...o,
} as LeadTableRow);

Deno.test("22. zero qualified companies must NOT offer a dispatchable people search", () => {
  const rec = recommendNextAction([]);
  assertFalse(isRecommendationDispatchable(rec), "Find decision-makers must be disabled with no rows");
  assertEquals(rec.enabled, false);
  assertEquals(rec.unmet_prerequisite, "no_qualified_companies");
  assertEquals(rec.estimated_credits, 0);
});

Deno.test("22b. the disabled reason explains the Company Brain, not 'no rows yet'", () => {
  const rec = recommendNextAction([]);
  assert(rec.reason.includes("Company Brain"), `unhelpful reason: ${rec.reason}`);
  assert(rec.reason.toLowerCase().includes("sourcing"), "it should point at company sourcing");
  assertFalse(rec.reason === "No rows yet.");
});

Deno.test("28. qualified companies without contacts DO enable the people search", () => {
  const rec = recommendNextAction([row(), row({ id: "r2" })]);
  assertEquals(rec.action, "find_contacts");
  assert(isRecommendationDispatchable(rec), "with rows present the action must be dispatchable");
  assert(rec.estimated_credits > 0);
});

Deno.test("30. existing recommendations are unchanged and stay dispatchable", () => {
  // Contacts present, nothing enriched → research, as before.
  const rows = [row({ contact_status: "ok" }), row({ id: "r2", contact_status: "ok" })];
  const rec = recommendNextAction(rows);
  assertEquals(rec.action, "research_company");
  assert(isRecommendationDispatchable(rec));
  // `enabled` is optional, so pre-existing recommendations omit it and still pass.
  assertEquals(rec.enabled, undefined);
});
