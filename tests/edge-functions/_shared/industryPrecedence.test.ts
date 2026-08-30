// A GENERIC DEFAULT MAY NOT NEGATE AN EXPLICIT TARGET.
//
// ── WHAT THIS COST, IN THE 2026-08-30 ACCEPTANCE RUN ───────────────────────
//
// The mission asked for "5 recruiting or staffing companies". The workspace ICP
// lists BOTH "B2B SaaS (founder-led or small teams)" AND "Recruiting / Talent
// Acquisition / Staffing Agencies". The SaaS half tripped `hasSaasContext`,
// which folds SOFTWARE_ICP_DISQUALIFIERS — "staffing", "recruiting agency",
// "staffing and recruiting" — into the exclusion list unconditionally.
//
// So the workspace targeted and excluded the same category, and Storm4,
// Talentoma and Storm3 were rejected `excluded_industry` before the Company
// Brain ran. Same shape as the `staffing_or_aggregator` defect fixed in
// 55177564, one gate later.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  categoryTokens, namesSameCategory, resolveIndustryExclusions,
} from "../../../supabase/functions/_shared/industryPrecedence.ts";
import {
  SOFTWARE_ICP_DISQUALIFIERS,
} from "../../../supabase/functions/_shared/companyBrainIcp.ts";

/** This workspace's real ICP industries, verbatim. */
const WORKSPACE_ICP = [
  "B2B SaaS (founder-led or small teams)",
  "Recruiting / Talent Acquisition / Staffing Agencies",
];

// ══ THE FOUR REQUIRED CASES ═══════════════════════════════════════════════

Deno.test("1. B2B SaaS + STAFFING TARGET — the generic exclusion is suppressed", () => {
  const r = resolveIndustryExclusions({
    mission_verticals: ["recruiting", "staffing"],
    workspace_target_industries: WORKSPACE_ICP,
    workspace_explicit_exclusions: [],
    generic_exclusions: [...SOFTWARE_ICP_DISQUALIFIERS],
  });
  for (const t of ["staffing", "staffing agency", "recruiting agency",
                   "recruitment agency", "staffing and recruiting"]) {
    assert(!r.exclusions.includes(t), `"${t}" must not survive: ${r.exclusions.join(", ")}`);
  }
  // AND THE REST OF THE LIST IS UNTOUCHED. Suppressing the category that was
  // asked for must not disarm the whole software-ICP guard.
  for (const t of ["pharmaceutical", "chemicals", "packaging", "lab testing"]) {
    assert(r.exclusions.includes(t), `"${t}" must survive`);
  }
  assertEquals(r.suppressed.length, 5);
  assertEquals(r.suppressed[0].source, "mission_verticals");
});

Deno.test("2. B2B SaaS ONLY — every generic exclusion stands", () => {
  const r = resolveIndustryExclusions({
    mission_verticals: [],
    workspace_target_industries: ["B2B SaaS (founder-led or small teams)"],
    workspace_explicit_exclusions: [],
    generic_exclusions: [...SOFTWARE_ICP_DISQUALIFIERS],
  });
  assertEquals(r.suppressed.length, 0);
  assertEquals(r.exclusions.length, SOFTWARE_ICP_DISQUALIFIERS.length);
  assert(r.exclusions.includes("staffing"),
    "with no staffing target, the software-ICP reject is exactly right");
});

Deno.test("3. STAFFING TARGET + EXPLICIT STAFFING DISQUALIFIER — rejection is kept", () => {
  // Two EXPLICIT statements in conflict. This fails closed: silently overriding
  // a standing business rule is a worse failure than refusing a run, and the
  // contradiction is the workspace's to resolve.
  const r = resolveIndustryExclusions({
    mission_verticals: ["recruiting", "staffing"],
    workspace_target_industries: WORKSPACE_ICP,
    workspace_explicit_exclusions: ["staffing and recruiting"],
    generic_exclusions: [...SOFTWARE_ICP_DISQUALIFIERS],
  });
  assert(r.exclusions.includes("staffing and recruiting"),
    "an explicit workspace exclusion is never suppressed by a mission");
  assertEquals(r.explicit_kept, ["staffing and recruiting"]);
  // The generic copies are still suppressed — only the explicit one governs, so
  // a refusal can cite the standing rule rather than an inferred default.
  assert(!r.suppressed.some((x) => x.term === "staffing and recruiting" &&
    r.explicit_kept.includes(x.term) === false));
});

Deno.test("4. SAAS COMPANIES RECRUITING ENGINEERS — a hiring verb is not a target", () => {
  // The mission's VERTICALS are what count. "recruiting" as a hiring signal
  // lives in the query and in required_signals, and reading it here would
  // disable a workspace's industry constraints on the strength of a verb.
  const r = resolveIndustryExclusions({
    mission_verticals: ["b2b saas"],
    workspace_target_industries: ["B2B SaaS (founder-led or small teams)"],
    workspace_explicit_exclusions: [],
    generic_exclusions: [...SOFTWARE_ICP_DISQUALIFIERS],
  });
  assertEquals(r.suppressed.length, 0);
  assert(r.exclusions.includes("recruiting agency"),
    "a SaaS mission that happens to search hiring signals still excludes agencies");
});

// ══ THE MATCHER ═══════════════════════════════════════════════════════════

Deno.test("a shared GENERIC word is not a shared category", () => {
  // Without the generic-token filter, "analytical services" and "financial
  // services" match on "services" and every exclusion collapses.
  assertEquals(namesSameCategory("analytical services", "financial services"), false);
  assertEquals(namesSameCategory("packaging solutions", "software solutions"), false);
  assertEquals(namesSameCategory("recruiting agency", "consulting agency"), false);
});

Deno.test("a real shared category matches in both directions", () => {
  assert(namesSameCategory("staffing", "Recruiting / Talent Acquisition / Staffing Agencies"));
  assert(namesSameCategory("staffing and recruiting", "recruiting"));
  assert(namesSameCategory("recruiting agency", "recruiting"));
});

Deno.test("short and generic tokens are never category names", () => {
  assertEquals(categoryTokens("IT services"), []);
  assertEquals(categoryTokens("the group"), []);
  // Stemmed: "staffing" and "staff" are one category, "agency" is generic.
  assertEquals(categoryTokens("staffing agency"), ["staff"]);
});

Deno.test("STEMMING UNIFIES INFLECTIONS AND NOTHING ELSE", () => {
  // The reason it exists: "recruitment agency" survived a mission whose vertical
  // was "recruiting", because the two share no literal token.
  assert(namesSameCategory("recruitment agency", "recruiting"));
  assert(namesSameCategory("recruiter", "recruiting"));
  assert(namesSameCategory("staffing", "staff augmentation"));
  // And it must not collapse genuinely different categories.
  for (const [a, b] of [
    ["pharmaceutical", "packaging"], ["chemicals", "clinical laboratory"],
    ["lab testing", "software development"], ["staffing", "b2b saas"],
    ["packaging", "pharma"], ["environmental testing", "financial services"],
  ] as const) {
    assertEquals(namesSameCategory(a, b), false, `${a} vs ${b}`);
  }
});

Deno.test("no explicit intent means nothing is suppressed", () => {
  const r = resolveIndustryExclusions({ generic_exclusions: ["staffing", "pharma"] });
  assertEquals(r.exclusions, ["staffing", "pharma"]);
  assertEquals(r.suppressed.length, 0);
});

Deno.test("a workspace TARGET alone suppresses, with no mission at all", () => {
  // The Radar and monitoring paths have no mission; the workspace's own stated
  // target industries must still outrank an inferred default.
  const r = resolveIndustryExclusions({
    workspace_target_industries: WORKSPACE_ICP,
    generic_exclusions: ["staffing", "pharma"],
  });
  assertEquals(r.exclusions, ["pharma"]);
  assertEquals(r.suppressed[0].source, "workspace_target_industries");
});

// ══ THE WIRING ════════════════════════════════════════════════════════════

const strip = (src: string) => src.split("\n").filter((l) => {
  const t = l.trim();
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}).join("\n");
const RUN_AGENT = strip(Deno.readTextFileSync(new URL(
  "../../../supabase/functions/run-agent/index.ts", import.meta.url)));
const COMPILER = strip(Deno.readTextFileSync(new URL(
  "../../../supabase/functions/_shared/companyBrainCompiler.ts", import.meta.url)));

Deno.test("the compiler reports WHERE each exclusion came from", () => {
  assert(COMPILER.includes("industries_explicit: brainDisqualifiers"),
    "explicit workspace exclusions must be separable");
  assert(/industries_generic: uniq\(\[/.test(COMPILER),
    "and the inferred ones must be separable too");
  assert(COMPILER.includes("industries: disqIndustries"),
    "the merged list stays, so existing consumers are unaffected");
});

Deno.test("the policy is built from the RESOLVED exclusions", () => {
  assert(RUN_AGENT.includes("disqualifier_industries: industryExclusions.exclusions"),
    "the effective policy must consume the resolved list");
  assertEquals(RUN_AGENT.split("resolveIndustryExclusions({").length - 1, 1,
    "resolved once, so no two consumers can see different exclusions");
});

Deno.test("suppressing an exclusion is logged", () => {
  assert(RUN_AGENT.includes("[run-agent][industry-precedence] generic exclusions suppressed"));
});

Deno.test("the resolver reads mission VERTICALS, never the raw query", () => {
  const block = RUN_AGENT.slice(RUN_AGENT.indexOf("resolveIndustryExclusions({"));
  const call = block.slice(0, block.indexOf("});"));
  assert(call.includes("company_profile?.verticals"), "verticals are the input");
  assert(!/original_user_query|user_instruction|\binput\b/.test(call),
    "the raw request must not reach this decision");
});
