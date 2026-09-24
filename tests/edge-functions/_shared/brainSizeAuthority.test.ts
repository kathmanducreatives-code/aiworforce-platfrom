// A WORKSPACE RULE THAT NOTHING ENFORCED.
//
// ── THE FAILURE ────────────────────────────────────────────────────────────
//
// Run fafd9912 carried, verbatim:
//
//   company_brain_policy: {
//     size: { min: 1, max: 150, source: "explicit_numeric",
//             confirmation_required: false },
//     enforced: true,
//     hard_constraints: ["employee_count", "industry", "business_model"] }
//
// The workspace had stated, explicitly and numerically, that it does not sell
// above 150 people. The free pre-pass then computed, for 27 of 29 companies,
//
//   size_status: "above_max"
//   reasons: ["exact headcount 29946 exceeds the maximum — excluded before
//             identity resolution and enrichment, which is two paid calls
//             this row already answered"]
//   exclusion: null          ← and let every one of them through
//
// The run paid to enrich eleven and to run a hiring search on three, including
// "Confidential Careers" (29,946) and "Stealth Startup" (37,306).
//
// ── THE CAUSE ──────────────────────────────────────────────────────────────
//
// `resolveEmployeeBounds` decided enforceability from `mission_owns` alone. The
// four-tier model documents "2 BRAIN HARD — an axis the Mission never mentions
// — absolute", but `employee_range` was filed tier 3 ALWAYS, so tier 2 was
// unreachable on this axis and `hard_constraints` — computed and persisted on
// every run — was read by nothing.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQualificationContext, resolveEmployeeBounds,
} from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import {
  admittedCandidateCount, isPlaceholderEmployerName, prequalifyDiscoveredCompanies, prequalifyNormalizedCompany,
} from "../../../supabase/functions/_shared/leadGenericPrequalification.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";

const MISSION = parseLeadMissionDeterministic(
  "Find 3 companies matching my ICP that are actively hiring sales roles.", {});
const CTX = buildQualificationContext(MISSION as never);

/** The live policy, as `company_brain_policy` recorded it. */
const BRAIN_HARD = {
  employee_min: 1, employee_max: 150,
  hard_constraints: ["employee_count", "industry", "business_model"],
};
/** The same bounds with no hardness declared — a preference. */
const BRAIN_SOFT = { employee_min: 1, employee_max: 150 };

Deno.test("a Brain that declared employee_count HARD may reject", () => {
  const b = resolveEmployeeBounds(CTX, BRAIN_HARD);
  assertEquals(b.enforceable, true);
  assertEquals(b.source, "brain_hard");
  assertEquals([b.min, b.max], [1, 150]);
});

Deno.test("a Brain that only PREFERS a size still may not reject", () => {
  // Tier 3, unchanged. This is the behaviour
  // `missionQualificationAuthority.test.ts` pins, and it must survive.
  const b = resolveEmployeeBounds(CTX, BRAIN_SOFT);
  assertEquals(b.enforceable, false);
  assertEquals(b.source, "brain_advisory");
  assertEquals([b.min, b.max], [1, 150], "the bound still survives for RANKING");
});

Deno.test("the Mission still outranks a hard Brain bound", () => {
  // Tier 1. A user who names a range in this request governs it, even against
  // a workspace rule — the conflict is resolved in the Mission's favour.
  const sized = {
    ...MISSION,
    company_profile: {
      ...(MISSION as unknown as Record<string, Record<string, unknown>>).company_profile,
      employee_range: { min: 1, max: 50 },
    },
  };
  const b = resolveEmployeeBounds(buildQualificationContext(sized as never), BRAIN_HARD);
  assertEquals(b.source, "mission");
  assertEquals(b.max, 50, "the Mission's ceiling, not the Brain's 150");
});

Deno.test("hard_constraints without a size bound changes nothing", () => {
  const b = resolveEmployeeBounds(CTX, {
    employee_min: null, employee_max: null, hard_constraints: ["employee_count"],
  });
  assertEquals(b.source, "none");
  assertEquals(b.enforceable, false, "a declared rule with no number is not a rule");
});

Deno.test("an unrelated hard constraint does not make size enforceable", () => {
  const b = resolveEmployeeBounds(CTX, {
    ...BRAIN_SOFT, hard_constraints: ["industry", "business_model"],
  });
  assertEquals(b.enforceable, false);
  assertEquals(b.source, "brain_advisory");
});

// ── WHAT IT DOES TO THE COMPANIES THAT ACTUALLY COST MONEY ────────────────
//
// CORRECTED 2026-09-24 (companySize.ts). The figures below were once read as
// staff; `employeeCount` is LinkedIn ASSOCIATED MEMBERS and the band is the
// company's DECLARED size. Under the Brain's hard 1-150:
//
//   * the four placeholder-employer pages are removed on IDENTITY — the member
//     count used to keep them out by accident, and may not any more;
//   * every real company declares 51-200, which only partly overlaps 1-150, so
//     size is unsettled — none ruled in, none ruled out, all investigable;
//   * nothing is excluded, for free or otherwise, on a member count.

const bandOf = (b: string) => {
  const [min, max] = b.split("-").map(Number);
  return { min, max, source: "linkedin_declared" as const };
};
const company = (name: string, members: number, band: string) => ({
  external_source_id: `li:${name}`, company_name: name,
  canonical_domain: `${name.toLowerCase().replace(/\W+/g, "")}.com`,
  linkedin_company_url: `https://www.linkedin.com/company/${name}`,
  website: null, description: "a company", provider_industry: null,
  industry_ids: [], linkedin_associated_member_count: members, company_size_band: bandOf(band),
  employee_range_advisory: null,
  geography: null, company_type: null, startup_evidence: null, hiring_status: null,
  source_provenance: "harvestapi/linkedin-company-search",
  field_trust: { company_name: "direct", linkedin_associated_member_count: "direct", company_size_band: "direct" },
  missing_fields: [], raw_ref: null,
} as never);

/** The real pool: LinkedIn associated members, and the band each DECLARES. */
const LIVE_POOL = [
  ["Confidential Careers", 29946, "2-10"],
  ["Stealth Startup", 37306, "11-50"],
  ["Freelance | Self-Employed", 414811, "2-10"],
  ["Empresa Confidencial", 14495, "51-200"],
  ["micro1", 9225, "51-200"],
  ["Hugging Face", 1037, "51-200"],
  ["Crossing Hurdles", 302, "51-200"],
  ["Hire Feed", 84, "51-200"],
  ["Blue Signal Search", 100, "51-200"],
] as const;
const PLACEHOLDERS = ["Confidential Careers", "Stealth Startup", "Freelance | Self-Employed", "Empresa Confidencial"];
const REAL = ["micro1", "Hugging Face", "Crossing Hurdles", "Hire Feed", "Blue Signal Search"];

Deno.test("the live pool: placeholder employer pages are removed on identity; real companies stay investigable on an unsettled band", () => {
  const bounds = resolveEmployeeBounds(CTX, BRAIN_HARD);
  const res = prequalifyDiscoveredCompanies(LIVE_POOL.map(([n, c, b]) => company(n, c, b)),
    { min: bounds.min, max: bounds.max }, { size_enforceable: bounds.enforceable });
  assertEquals(res.excluded.map((e) => e.name).sort(), [...PLACEHOLDERS].sort());
  assert(res.excluded.every((e) => /placeholder employer page/.test(e.reason)));
  assertEquals(res.companies.map((c) => c.name).sort(), [...REAL].sort());
  for (const c of res.companies) {
    // Declared 51-200 against 1-150: it may be inside, it may not — PENDING.
    assertEquals([c.size_status, c.exclusion, c.eligible], ["size_unverified", null, true], c.name);
    assert(c.reasons.some((r) => /only partly overlaps/.test(r)), c.reasons.join(" | "));
  }
  // Discovery sizes its pool on the admitted count: an unsettled band is not a
  // reported mismatch, so all five real companies count.
  assertEquals(admittedCandidateCount(LIVE_POOL.map(([n, c, b]) => company(n, c, b)),
    { min: bounds.min, max: bounds.max }, { size_enforceable: bounds.enforceable }), 5);
});

Deno.test("…and WITHOUT a LinkedIn identity only a DECLARED band wholly outside excludes free — never a member count", () => {
  const bounds = resolveEmployeeBounds(CTX, BRAIN_HARD);
  for (const [n, c, b] of LIVE_POOL.filter(([n]) => REAL.includes(n))) {
    const row = { ...(company(n, c, b) as Record<string, unknown>), linkedin_company_url: null } as never;
    const v = prequalifyNormalizedCompany(row, { min: bounds.min, max: bounds.max }, { size_enforceable: bounds.enforceable });
    assertEquals(v.exclusion, null, `${n}: ${c} members exclude nothing`);
  }
  const wholly = { ...(company("Bigco", 90, "201-500") as Record<string, unknown>), linkedin_company_url: null } as never;
  assertEquals(prequalifyNormalizedCompany(wholly, { min: bounds.min, max: bounds.max },
    { size_enforceable: bounds.enforceable }).exclusion, "employee_size");
});

Deno.test("placeholder detection is exact-name only — a real company containing the word is untouched", () => {
  for (const n of PLACEHOLDERS) assert(isPlaceholderEmployerName(n), n);
  for (const n of ["Confidential Computing Inc", "Stealth Security", "Freelance Hub", "Self Employed Tax Co"]) {
    assert(!isPlaceholderEmployerName(n), n);
  }
});

Deno.test("the same pool under a PREFERENCE keeps everyone eligible", () => {
  // The regression guard for tier 3: a workspace that never declared the rule
  // must see exactly the old behaviour, ranked but never excluded.
  const bounds = resolveEmployeeBounds(CTX, BRAIN_SOFT);
  for (const [n, c, b] of LIVE_POOL) {
    const v = prequalifyNormalizedCompany(company(n, c, b),
      { min: bounds.min, max: bounds.max }, { size_enforceable: bounds.enforceable });
    assertEquals(v.eligible, true, n);
    assertEquals(v.exclusion, null, n);
  }
});

// ── A NON-LINKEDIN ADVISORY SIZE IS STILL NEVER A SIZE FACT ───────────────

Deno.test("a company with ONLY advisory size text is never excluded by it", () => {
  // Enforcing the Brain's rule must not turn a provider's size WORDING (a YC
  // team size, a funding bucket) into a declared band.
  const advisoryOnly = { ...(company("Somebody", 0, "2-10") as never as Record<string, unknown>),
    company_size_band: null, linkedin_associated_member_count: null,
    employee_range_advisory: "yc_self_reported:4" } as never;
  const v = prequalifyNormalizedCompany(advisoryOnly, { min: 1, max: 150 },
    { size_enforceable: true });
  assertEquals(v.size_status, "size_unverified");
  assertEquals(v.eligible, true, "an unverified size may not exclude anyone");
  assertEquals(v.exclusion, null);
  assert(
    v.reasons.some((r) => /not a declared band and may\s+not exclude anyone/.test(r)),
    v.reasons.join(" | "),
  );
});

// ── THE CALL SITES ────────────────────────────────────────────────────────

Deno.test("run-agent hands the Brain's hard_constraints to the engine", () => {
  const RUN = Deno.readTextFileSync(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assert(RUN.includes("hard_constraints: effectivePolicy.provenance.hard_constraints ?? []"));
});

Deno.test("the engine hands them to the free pre-pass", () => {
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  assert(ENGINE.includes("hard_constraints: opts.brain?.hard_constraints ?? null"));
  assert(ENGINE.includes("hard_constraints: size.hard_constraints ?? null"),
    "and applyPrequalification must forward them to resolveEmployeeBounds");
});
