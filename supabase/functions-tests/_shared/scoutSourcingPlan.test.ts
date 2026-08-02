import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planScoutQueries, attemptQuery, tierAndCount, brainToIntent } from "../../functions/_shared/scoutSourcingPlan.ts";
import { extractLeadSearchIntent } from "../../functions/_shared/leadSearchIntent.ts";
import type { AcceptedItemLite } from "../../functions/_shared/scoutSourcingPlan.ts";

const badQuery = "Find 5 AI SaaS companies recently funded hiring SDRs or GTM roles for outbound in US + EU";

Deno.test("wire #1: live plan no longer builds the mega keyword string", () => {
  const plan = planScoutQueries({ instruction: badQuery })!;
  assert(plan.provider_queries.length >= 3);
  assert(plan.provider_queries.every((q) => q.keywords.split(" ").length <= 6));
  assert(!plan.provider_queries.some((q) => /Business Development.*Demand Generation.*Revenue.*software/i.test(q.keywords)));
  assert(/AI SaaS/i.test(plan.primary.keywords));
});

Deno.test("wire #2: 'US + EU' never a single location; split into concrete locations", () => {
  const plan = planScoutQueries({ instruction: badQuery })!;
  assert(plan.primary.location !== "US + EU" && plan.primary.location !== "EU" && plan.primary.location !== "US");
  assert(plan.locations.includes("United States"));
  assert(plan.locations.some((l) => /United Kingdom|Germany|Netherlands|France/.test(l)));
  assert(!plan.locations.includes("US + EU"));
});

Deno.test("wire #3/#4: multiple ProviderQuery runs with strict/relaxed/broad tiers", () => {
  const plan = planScoutQueries({ instruction: badQuery })!;
  const tiers = new Set(plan.provider_queries.map((q) => q.intent_tier));
  assert(tiers.has("strict"));
  assert(plan.provider_queries.length >= 3);
  // rotating attempts cover different queries + locations
  const a0 = attemptQuery(plan, 0), a1 = attemptQuery(plan, 1);
  assert(a0.keywords !== a1.keywords || a0.location !== a1.location);
  // strict tier requires funding proof (user asked recently funded)
  assert(plan.provider_queries.some((q) => q.intent_tier === "strict" && q.required_evidence.includes("recent_funding_proof")));
});

Deno.test("wire #10: vague query → null (legacy keyword path unchanged)", () => {
  assertEquals(planScoutQueries({ instruction: "find me leads please" }), null);
  // but with a brain ICP it plans
  assert(planScoutQueries({ instruction: "find me leads", brain: { icp: { industries: ["AI SaaS"], buyer_roles: ["Head of Growth"] } } }) !== null);
});

Deno.test("brainToIntent maps profile.icp fields", () => {
  const b = brainToIntent({ icp: { industries: ["B2B SaaS"], disqualifiers: ["pharma"], geography: "United States", buyer_roles: ["RevOps"] } })!;
  assertEquals(b.industries, ["B2B SaaS"]);
  assert(b.disqualifiers?.includes("pharma"));
});

// ---- tierAndCount over gate-accepted items (Parts 3/5 reporting) ----
const intent = extractLeadSearchIntent({ message: badQuery });
const item = (company: string, industries: string[], title: string, funded = false): AcceptedItemLite => ({
  company, title, source_url: `https://x/${company}`,
  raw: { company_name: company, industries, job_title: title, company_description: `${industries.join(" ")} company`, job_description: "outbound", ...(funded ? { funding_source_url: "https://tc/x" } : {}) },
});

Deno.test("wire #6/#8/#9: strict/secondary counters + funding downgrade + shortage summary", () => {
  const accepted = [
    item("Alpha", ["Software Development"], "SDR", true),   // strict (funding proof)
    item("Beta", ["Software Development"], "SDR"),           // secondary (no funding)
    item("Gamma", ["Software Development"], "GTM Lead"),     // secondary
  ];
  const { counters, summary, labels } = tierAndCount(accepted, 40, intent);
  assertEquals(counters.requested_count, 5);
  assertEquals(counters.raw_results_reviewed, 40);
  assertEquals(counters.accepted_count, 3);
  assertEquals(counters.strict_matches, 1);
  assertEquals(counters.secondary_matches, 2);
  assertEquals(counters.rejected_count, 37);
  assert(counters.relaxation_steps_used.includes("funding_relaxed"));
  assert(counters.reason_not_filled && /did not fill/i.test(counters.reason_not_filled));
  assert(/reviewed 40 raw/i.test(summary) && /1 strict/i.test(summary) && /2 secondary/i.test(summary));
  // Beta labeled secondary with missing funding proof (never "recently funded")
  const beta = labels[1];
  assertEquals(beta.match_tier, "secondary");
  assert(beta.missing_evidence.includes("recent funding proof"));
});

Deno.test("wire #5/#7: only 2 safe accepted → returns 2 + shortage (off-ICP never fills)", () => {
  // gate would already have dropped WuXi/SGS; here accepted has just 2 SaaS leads.
  const accepted = [item("Flatpay", ["Software Development", "Financial Services"], "SDR"), item("LOX", ["Software Development"], "Growth Lead")];
  const { counters } = tierAndCount(accepted, 42, intent);
  assertEquals(counters.accepted_count, 2);
  assertEquals(counters.strict_matches, 0);
  assert(counters.reason_not_filled && /out of 42 reviewed/i.test(counters.reason_not_filled));
});
