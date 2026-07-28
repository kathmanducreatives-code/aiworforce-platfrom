import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractLeadSearchIntent } from "./leadSearchIntent.ts";

Deno.test("Part1 #1/#2/#3/#4: AI SaaS + recently funded + SDR/GTM + outbound parses correctly", () => {
  const i = extractLeadSearchIntent({ message: "Find 5 AI SaaS companies recently funded hiring SDRs or GTM roles for outbound" });
  assertEquals(i.requested_count, 5);
  assert(i.must_have_categories.includes("AI SaaS"));
  assert(i.company_categories.includes("B2B SaaS"));
  assert(i.role_terms.includes("SDR") && i.role_terms.includes("Sales Development Representative"));
  assert(i.role_terms.some((r) => /GTM|Go-to-Market/.test(r)));
  assertEquals(i.motion_terms.includes("outbound"), true);
  assertEquals(i.funding_required, true);
  assert(i.trigger_terms.includes("recently funded"));
  assert(i.trigger_terms.includes("hiring"));
});

Deno.test("Part1 #5: Company Brain disqualifiers attach; no funding claim invented", () => {
  const i = extractLeadSearchIntent({
    message: "Find 5 SaaS companies hiring RevOps",
    brain: { disqualifiers: ["manufacturing", "pharma"], industries: ["B2B SaaS"] },
  });
  assert(i.hard_disqualifiers.includes("manufacturing"));
  assert(i.hard_disqualifiers.includes("pharma"));
  assertEquals(i.funding_required, false);
  assert(i.role_terms.includes("Revenue Operations"));
});

Deno.test("Part1: US location group; small size; second example", () => {
  const i = extractLeadSearchIntent({ message: "Find 5 small B2B SaaS companies in the US hiring Founding AE or RevOps" });
  assertEquals(i.requested_count, 5);
  assert(i.must_have_categories.includes("B2B SaaS"));
  assert(i.role_terms.includes("Founding Account Executive"));
  assert(i.role_terms.includes("Revenue Operations"));
  assert(i.location_groups.includes("US"));
  assertEquals(i.company_size_preference?.max, 150);
});

Deno.test("Part1: 'US + EU' captured as TWO groups (never one location)", () => {
  const i = extractLeadSearchIntent({ message: "Find 10 AI SaaS companies hiring SDRs in US + EU" });
  assertEquals(i.requested_count, 10);
  assertEquals(i.location_groups.sort(), ["EU", "US"]);
});

Deno.test("Part1 #6: empty/vague query falls back to Company Brain", () => {
  const i = extractLeadSearchIntent({ message: "find me some leads", brain: { industries: ["AI SaaS"], buyer_roles: ["Head of Growth"], geography: "United States", disqualifiers: ["staffing agency"] } });
  assertEquals(i.requested_count, 5);
  assert(i.company_categories.includes("AI SaaS"));
  assert(i.role_terms.includes("Head of Growth"));
  assert(i.location_groups.includes("US"));
  assert(i.hard_disqualifiers.includes("staffing agency"));
});

Deno.test("Part1: never relax the must-have category; default disqualifiers when Brain has none", () => {
  const i = extractLeadSearchIntent({ message: "Find 5 AI SaaS companies hiring SDRs" });
  assertEquals(i.relaxation_allowed.category, false);
  assert(i.relaxation_allowed.location && i.relaxation_allowed.exact_role);
  assert(i.hard_disqualifiers.includes("manufacturing")); // default set
});
