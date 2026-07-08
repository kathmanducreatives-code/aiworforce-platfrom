import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "./companyBrainCompiler.ts";

function has(list: string[], needle: string): boolean {
  return list.some((x) => x.toLowerCase() === needle.toLowerCase());
}

const agentoryProfile = {
  company: { name: "Agentory", category: "AI SaaS", description: "AI workforce OS for founders building B2B pipeline", stage: "seed", team_size: "2-5", location: "US" },
  icp: {
    buyer_roles: ["Founder", "RevOps", "Head of Growth"],
    company_size: "10-150 employees",
    industries: ["B2B SaaS", "AI SaaS"],
    geography: "US",
    pain_points: ["pipeline before hiring"],
    disqualifiers: ["manufacturing", "hospital"],
  },
  gtm: { motion: "founder-led sales", current_tools: ["Clay", "Apollo"] },
  positioning: { promise: "pipeline before payroll", proof_points: ["case study"], avoid_positioning: ["AI SDR", "replace your team"] },
  brand_voice: { tone: "direct", avoid: ["hype"] },
  competitors: { known: ["Clay", "Apollo"], adjacent: ["Instantly"] },
  goals: { hiring: "Founding AE" },
};
const agentoryPrefs = { hiring_roles: ["Founding AE"], competitors: ["Clay"], linkedin_topics: ["founder-led sales"], workflow_topics: ["outbound automation"] };

Deno.test("1. structured Brain → expected industries, buyer titles, triggers, disqualifiers", () => {
  const c = compileCompanyBrainContext({ workspace_id: "ws", profile: agentoryProfile, signal_preferences: agentoryPrefs });
  assert(has(c.icp.industries, "B2B SaaS") && has(c.icp.industries, "AI SaaS"));
  assert(has(c.buyer_personas.titles, "Founder") && has(c.buyer_personas.titles, "RevOps"));
  assert(has(c.buying_triggers.hiring, "Founding AE"));
  assert(has(c.disqualifiers.industries, "manufacturing") && has(c.disqualifiers.industries, "hospital"));
  assertEquals(c.icp.company_size_min, 10);
  assertEquals(c.icp.company_size_max, 150);
  assertEquals(c.meta.confidence, "strong");
});

Deno.test("2. free-text-only Brain works but confidence is weak", () => {
  const c = compileCompanyBrainContext({ workspace_id: "ws", profile: { company: { description: "B2B SaaS platform for founders" } } });
  assertEquals(c.meta.confidence, "weak");
  assert(c.meta.warnings.length > 0);
  // SaaS context still detected from description → useful expansions, not fabricated ICP industries.
  assert(has(c.icp.categories, "B2B SaaS"));
  assertEquals(c.icp.industries, []); // never invents structured industries
});

Deno.test("3. Brain-specified disqualifiers are preserved (not replaced by defaults)", () => {
  const c = compileCompanyBrainContext({ workspace_id: "ws", profile: { icp: { industries: ["B2B SaaS"], buyer_roles: ["Founder"], company_size: "10-150", disqualifiers: ["manufacturing", "hospital", "university"] } } });
  assertEquals(c.disqualifiers.industries, ["manufacturing", "hospital", "university"]);
});

Deno.test("4. generic Operations Manager is a negative title unless RevOps/GTM context exists", () => {
  const noRevenue = compileCompanyBrainContext({ workspace_id: "ws", profile: { company: { category: "productivity software", description: "a tool for teams" }, icp: { buyer_roles: ["Founder"], industries: ["software"], company_size: "10-50" } } });
  assert(has(noRevenue.buyer_personas.negative_title_keywords, "Operations Manager"), "should be negative without revenue context");

  const withRevenue = compileCompanyBrainContext({ workspace_id: "ws", profile: { icp: { buyer_roles: ["RevOps", "Sales Operations"], industries: ["B2B SaaS"], company_size: "10-150" } } });
  assert(!has(withRevenue.buyer_personas.negative_title_keywords, "Operations Manager"), "should NOT be negative with RevOps context");
  // hard non-revenue titles are always negative
  assert(has(withRevenue.buyer_personas.negative_title_keywords, "Plant Manager"));
});

Deno.test("5. empty Brain → conservative context with warnings, no fake ICP", () => {
  const c = compileCompanyBrainContext({ workspace_id: "ws", profile: {} });
  assertEquals(c.meta.confidence, "weak");
  assert(c.meta.warnings.length > 0);
  assertEquals(c.icp.industries, []);
  assertEquals(c.icp.categories, []); // no SaaS context → no fabricated categories
  assertEquals(c.buyer_personas.titles, []);
  // safe default disqualifiers still applied
  assert(has(c.disqualifiers.industries, "manufacturing"));
});

Deno.test("6. Agentory-style Brain compiles into SaaS/revenue target terms", () => {
  const c = compileCompanyBrainContext({ workspace_id: "ws", profile: agentoryProfile, signal_preferences: agentoryPrefs });
  assert(has(c.icp.categories, "B2B SaaS") && has(c.icp.categories, "revenue operations software"));
  assert(has(c.competitors_and_tools.watchlist, "Clay") && has(c.competitors_and_tools.watchlist, "Attio"));
  assert(has(c.query_strategy.hiring_role_terms, "SDR") || has(c.query_strategy.hiring_role_terms, "Founding Account Executive"));
  assert(has(c.buyer_personas.titles, "Revenue Leader"));
  // matched_from evidence recorded
  assert(Object.keys(c.meta.matched_from).length > 0);
});
