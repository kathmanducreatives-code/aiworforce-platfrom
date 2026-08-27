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
  prequalifyNormalizedCompany,
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

const company = (name: string, employee_count: number, band: string) => ({
  external_source_id: `li:${name}`, company_name: name,
  canonical_domain: `${name.toLowerCase().replace(/\W+/g, "")}.com`,
  linkedin_company_url: `https://www.linkedin.com/company/${name}`,
  website: null, description: "a company", provider_industry: null,
  industry_ids: [], employee_count, employee_range_advisory: band,
  geography: null, company_type: null, startup_evidence: null, hiring_status: null,
  source_provenance: "harvestapi/linkedin-company-search",
  field_trust: { company_name: "direct", employee_count: "direct",
    employee_range_advisory: "unsafe" },
  missing_fields: [], raw_ref: null,
} as never);

/** The real pool, with the exact counts and self-reported bands it carried. */
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

Deno.test("the live pool: only the two genuinely in-range companies stay eligible", () => {
  const bounds = resolveEmployeeBounds(CTX, BRAIN_HARD);
  const verdicts = LIVE_POOL.map(([n, c, b]) => ({
    name: n,
    v: prequalifyNormalizedCompany(company(n, c, b), { min: bounds.min, max: bounds.max },
      { size_enforceable: bounds.enforceable }),
  }));
  assertEquals(
    verdicts.filter((x) => x.v.eligible).map((x) => x.name),
    ["Hire Feed", "Blue Signal Search"],
    "84 and 100 are inside 1-150; nothing else in that pool was",
  );
  for (const x of verdicts.filter((x) => !x.v.eligible)) {
    assertEquals(x.v.exclusion, "employee_size", x.name);
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

// ── THE ADVISORY BAND IS STILL NEVER A HEADCOUNT ──────────────────────────

Deno.test("a company with ONLY an advisory band is never excluded by it", () => {
  // The user's constraint, pinned: enforcing the Brain's rule must not turn the
  // self-reported band into evidence. "Freelance | Self-Employed" self-reports
  // 2-10 and has 414,811 members — believing the band would have ADMITTED it.
  const noExact = { ...(company("Freelance", 0, "2-10") as never as Record<string, unknown>),
    employee_count: null } as never;
  const v = prequalifyNormalizedCompany(noExact, { min: 1, max: 150 },
    { size_enforceable: true });
  assertEquals(v.size_status, "size_unverified");
  assertEquals(v.eligible, true, "an unverified size may not exclude anyone");
  assertEquals(v.exclusion, null);
  assert(
    v.reasons.some((r) => /declared unsafe and may\s+not exclude anyone/.test(r)),
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
