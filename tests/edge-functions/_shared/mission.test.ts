// MISSION CONTRACT — original-instruction authority and geography provenance.
// ZERO network, ZERO provider calls, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMission, resolveGeographyAuthority, normalizeForDisplay, missionHash,
  authorityRank, higherAuthority, mayOverride, AUTHORITY_ORDER,
  MISSION_CONTRACT_VERSION, type BuildMissionInput,
} from "../../../supabase/functions/_shared/mission.ts";

const PRIMARY = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

function base(overrides: Partial<BuildMissionInput> = {}): BuildMissionInput {
  return {
    missionId: "m-1",
    department: "leads",
    workspaceId: "ws-1",
    originalInstruction: PRIMARY,
    environmentMode: "test",
    ...overrides,
  };
}

// ---- original instruction authority ----------------------------------------

Deno.test("1.A the original instruction is preserved VERBATIM", () => {
  const m = buildMission(base());
  assertEquals(m.original_instruction, PRIMARY);
  assertEquals(m.mission_version, MISSION_CONTRACT_VERSION);
});

Deno.test("1.B messy user text is preserved byte-for-byte, not tidied", () => {
  const messy = "  Find   founders\tof SaaS startups\n\nhiring Sales Operations  ";
  const m = buildMission(base({ originalInstruction: messy }));
  assertEquals(m.original_instruction, messy, "the raw instruction must not be trimmed or collapsed");
  // The tidied copy exists SEPARATELY and never replaces the original.
  assertEquals(m.normalized_instruction, "Find founders of SaaS startups hiring Sales Operations");
  assert(m.original_instruction !== m.normalized_instruction);
});

Deno.test("1.C the parser's reading is carried alongside, never merged into, the instruction", () => {
  const m = buildMission(base({
    parserContext: { hiring_role: { function: "sales_operations" }, geography: ["United States"] },
  }));
  assertEquals(m.original_instruction, PRIMARY);
  assertEquals((m.parser_context.hiring_role as Record<string, unknown>).function, "sales_operations");
});

Deno.test("1.D the authority order is fixed and the user's instruction outranks everything", () => {
  assertEquals(AUTHORITY_ORDER[0], "original_user_instruction");
  assertEquals(AUTHORITY_ORDER[AUTHORITY_ORDER.length - 1], "model_inference");
  assert(authorityRank("original_user_instruction") < authorityRank("icp_hard_constraint"));
  assert(authorityRank("icp_hard_constraint") < authorityRank("icp_soft_preference"));
  assert(authorityRank("icp_soft_preference") < authorityRank("company_brain"));
  assert(authorityRank("company_brain") < authorityRank("strategy_memory"));
  assert(authorityRank("strategy_memory") < authorityRank("model_inference"));

  assertEquals(higherAuthority("model_inference", "original_user_instruction"), "original_user_instruction");
  assert(mayOverride("model_inference", "original_user_instruction"));
  assertFalse(mayOverride("original_user_instruction", "model_inference"),
    "inference must never override the user's own words");
  assertFalse(mayOverride("icp_hard_constraint", "icp_hard_constraint"),
    "equal authority may not override");
});

// ---- geography -------------------------------------------------------------

Deno.test("2.A explicit user geography OUTRANKS parser inference", () => {
  // The live defect: "Show us founders in Germany" makes the parser say United States.
  const m = buildMission(base({
    originalInstruction: "Show us founders in Germany hiring RevOps",
    geography: {
      explicit_raw_locations: ["Germany"],
      parser_locations: ["United States"],   // what inferGeography actually returns
      source: "explicit_user",
      confidence: 1,
    },
  }));
  const r = resolveGeographyAuthority(m.geography_context);
  assertEquals(r.effective, ["Germany"]);
  assertEquals(r.authority, "original_user_instruction");
  assertFalse(r.effective.includes("United States"),
    "parser output must never contribute when the user named a location");
});

Deno.test("2.B an unresolved explicit location is RETAINED, never dropped", () => {
  const m = buildMission(base({
    geography: { explicit_raw_locations: ["Baden-Württemberg"], normalized_locations: [], source: "explicit_user", confidence: 0.4 },
  }));
  assertEquals(m.geography_context.unresolved_locations, ["Baden-Württemberg"]);
  const r = resolveGeographyAuthority(m.geography_context);
  assertEquals(r.effective, ["Baden-Württemberg"], "an unnormalizable location still governs");
  assert(r.hasUnresolvedExplicit);
});

Deno.test("2.C a partially resolved set keeps BOTH the normalized and the raw remainder", () => {
  const m = buildMission(base({
    geography: {
      explicit_raw_locations: ["Germany", "Baden-Württemberg"],
      normalized_locations: ["Germany"],
      source: "explicit_user", confidence: 0.7,
    },
  }));
  assertEquals(m.geography_context.unresolved_locations, ["Baden-Württemberg"]);
  const r = resolveGeographyAuthority(m.geography_context);
  assertEquals(r.effective.sort(), ["Baden-Württemberg", "Germany"]);
});

Deno.test("2.D no location is INVENTED when the parser is uncertain", () => {
  const m = buildMission(base({
    originalInstruction: "Find founders hiring RevOps",
    geography: { explicit_raw_locations: [], normalized_locations: [], parser_locations: [], source: "inferred", confidence: 0 },
  }));
  assertEquals(m.geography_context.explicit_raw_locations, []);
  assertEquals(m.geography_context.normalized_locations, []);
  assertEquals(resolveGeographyAuthority(m.geography_context).effective, []);
});

Deno.test("2.E parser geography is used ONLY when the user named none", () => {
  const m = buildMission(base({
    geography: { explicit_raw_locations: [], parser_locations: ["United States"], source: "inferred", confidence: 0.5 },
  }));
  const r = resolveGeographyAuthority(m.geography_context);
  assertEquals(r.effective, ["United States"]);
  assertEquals(r.authority, "model_inference", "parser-derived geography must be marked as inference");
});

Deno.test("2.F the four geography populations stay SEPARATE", () => {
  const m = buildMission(base({
    geography: {
      explicit_raw_locations: ["Germany"], normalized_locations: [],
      parser_locations: ["United States"], source: "explicit_user", confidence: 1,
    },
  }));
  const g = m.geography_context;
  assertEquals(g.explicit_raw_locations, ["Germany"]);
  assertEquals(g.parser_locations, ["United States"]);
  assertEquals(g.unresolved_locations, ["Germany"]);
  assertFalse(g.explicit_raw_locations.includes("United States"), "populations must never be merged");
});

// ---- bounding + determinism ------------------------------------------------

Deno.test("3.A list fields are de-duplicated and bounded", () => {
  const m = buildMission(base({
    icp: { industries: ["SaaS", "saas", "SAAS", ...Array.from({ length: 80 }, (_, i) => `Ind${i}`)] },
  }));
  assertEquals(m.icp.industries.filter((x) => x.toLowerCase() === "saas").length, 1);
  assert(m.icp.industries.length <= 40);
});

Deno.test("3.B a mission hashes deterministically", async () => {
  const a = await missionHash(buildMission(base()));
  const b = await missionHash(buildMission(base()));
  assertEquals(a, b);
  const c = await missionHash(buildMission(base({ originalInstruction: PRIMARY + " " })));
  assert(a !== c, "a different instruction must produce a different hash");
});

Deno.test("3.C budget and confidence are clamped, never negative", () => {
  const m = buildMission(base({
    budget: { maximum_calls: -5, maximum_estimated_cost_usd: -1, maximum_rounds: 2.9 },
    icp: { confidence: 5 },
    companyBrain: { confidence: -3 },
  }));
  assertEquals(m.budget.maximum_calls, 0);
  assertEquals(m.budget.maximum_estimated_cost_usd, 0);
  assertEquals(m.budget.maximum_rounds, 2);
  assertEquals(m.icp.confidence, 1);
  assertEquals(m.company_brain.confidence, 0);
});

Deno.test("3.D one canonical envelope serves every department", () => {
  for (const department of ["leads", "signals", "content"] as const) {
    const m = buildMission(base({ department }));
    assertEquals(m.department, department);
    assertEquals(m.mission_version, MISSION_CONTRACT_VERSION, "no department-specific contract version");
  }
});

Deno.test("3.E normalizeForDisplay never returns the empty string for real text", () => {
  assertEquals(normalizeForDisplay("  a   b  "), "a b");
  assertEquals(normalizeForDisplay(""), "");
});
