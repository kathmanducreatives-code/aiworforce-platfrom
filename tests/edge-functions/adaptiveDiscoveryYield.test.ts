// DISCOVERY MUST FINISH ON CANDIDATES IT CAN USE, NOT ON ROWS IT BOUGHT.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Run 7e71d8bc asked for 5 UK B2B SaaS companies, 20–200 employees, hiring
// sales roles. LinkedIn company search returned 50 rows; sixteen of them were
// outside the mission's own employee range. Discovery stopped anyway, because
// the only question it asked was `companies.length >= maxCandidates`, and 50
// rows is 50 rows whatever is in them.
//
// Two things followed. The pool was never widened — `shouldRunSelection` gives
// `breadth` a pool that is not yet big enough, and it was handed the row count,
// so a pool of unusable rows read as full. And when the frontier was spent,
// `decideAutoContinuation` called it `frontier_exhausted` and ended a request
// that was 5 short with pages of the same source still unread.
//
// ZERO network, ZERO DB, ZERO provider calls.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  admittedCandidateCount, prequalifyDiscoveredCompanies,
  mergePrequalification, emptyPrequalificationResult,
} from "../../supabase/functions/_shared/leadGenericPrequalification.ts";
import { decideAutoContinuation } from "../../supabase/functions/_shared/leadAutoContinuation.ts";
import { shouldRunSelection } from "../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import {
  ADMITTED_PER_OWED_LEAD, MINIMUM_ADMITTED_TARGET, MAX_RAW_ROWS_PER_ADMITTED,
} from "../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  acceptedInputFields, compileActorInput,
} from "../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import { hiringActorCard } from "../../supabase/functions/_shared/hiringActorCatalog.ts";
import {
  buildCheckpoint, readCheckpointDiscoveryState,
} from "../../supabase/functions/_shared/leadResumeState.ts";
import type { NormalizedHiringCompany } from "../../supabase/functions/_shared/hiringActorNormalizers.ts";

/** A normalized row with a trusted exact headcount, as `full` mode returns. */
function company(
  name: string, employees: number | null,
): NormalizedHiringCompany {
  return {
    external_source_id: `linkedin:${name}`,
    company_name: name,
    canonical_domain: `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
    linkedin_company_url: `https://www.linkedin.com/company/${name.toLowerCase()}`,
    website: null,
    description: `${name} does something`,
    provider_industry: "Software Development",
    industry_ids: [],
    employee_count: employees,
    employee_range_advisory: null,
    geography: "London, England, United Kingdom",
    company_type: null,
    startup_evidence: null,
    hiring_status: null,
    source_provenance: "harvestapi/linkedin-company-search",
    field_trust: { employee_count: "direct" as const },
    missing_fields: [],
    raw_ref: { actor_key: "apify_linkedin_company_search", source_id: name },
  } as unknown as NormalizedHiringCompany;
}

/** The 7e71d8bc shape: 50 rows, 34 inside 20–200. */
function poolOf(inRange: number, outOfRange: number): NormalizedHiringCompany[] {
  const out: NormalizedHiringCompany[] = [];
  for (let i = 0; i < inRange; i++) out.push(company(`InRange${i}`, 50 + i));
  for (let i = 0; i < outOfRange; i++) out.push(company(`TooBig${i}`, 5000 + i));
  return out;
}

const BOUNDS = { min: 20, max: 200 };
const ENFORCED = { size_enforceable: true };

/** The engine's own formula, restated so the tests bind to it. */
const targetFor = (owedLeads: number, rawCeiling: number) =>
  Math.min(rawCeiling,
    Math.max(MINIMUM_ADMITTED_TARGET, owedLeads * ADMITTED_PER_OWED_LEAD));

Deno.test("5 requested + 34 admitted does NOT paginate", () => {
  // ── THE REGRESSION MISSION, AND THE REASON FIX A EXISTS ──────────────────
  //
  // `maxCandidates` is `requestedLeadCount * 10` and has always counted RAW
  // ROWS. Reading it as an ADMITTED target made 34 usable companies look like a
  // shortfall against 50 and bought page two before a single one had been
  // investigated. 34 admitted for a five-lead request is nearly seven times
  // cover; the pool is not the constraint and widening it is spend with nothing
  // to buy.
  const pool = poolOf(34, 16);
  assertEquals(pool.length, 50);
  const admitted = admittedCandidateCount(pool, BOUNDS, ENFORCED);
  assertEquals(admitted, 34);

  const rawCeiling = Math.max(10, 5 * 10);
  assertEquals(rawCeiling, 50, "the raw-row allowance is unchanged");
  const target = targetFor(5, rawCeiling);
  assertEquals(target, 20, "5 owed leads x 4 admitted each");

  assert(admitted >= target, "34 admitted satisfies a target of 20");
  assert(
    !shouldRunSelection({ role: "breadth" } as never, admitted, target),
    "no second source while the admitted pool is already sufficient",
  );
});

Deno.test("admitted below the target CAN paginate", () => {
  // Twelve admitted against a target of twenty is a genuine shortfall, and the
  // roles become reachable exactly as they should.
  const pool = poolOf(12, 38);
  const admitted = admittedCandidateCount(pool, BOUNDS, ENFORCED);
  assertEquals(admitted, 12);
  const target = targetFor(5, 50);
  assert(admitted < target);
  assert(
    shouldRunSelection({ role: "breadth" } as never, admitted, target),
    "a breadth actor must earn its call on a genuinely thin pool",
  );
});

Deno.test("the admitted target never exceeds the raw-row allowance", () => {
  // A large request must not set a target no amount of paging could reach.
  const rawCeiling = Math.max(10, 1 * 10);
  assertEquals(targetFor(1, rawCeiling), MINIMUM_ADMITTED_TARGET,
    "a single-lead request still wants a handful to choose between");
  assert(targetFor(100, 50) <= 50, "clamped by the raw allowance");
});

Deno.test("no mission range — size may not reject, behaviour unchanged", () => {
  const pool = poolOf(34, 16);
  // `size_enforceable: false` is what a missionless run passes. Every row is a
  // candidate, exactly as before this change existed.
  assertEquals(admittedCandidateCount(pool, {}, { size_enforceable: false }), 50);
});

Deno.test("admission never consults geography", () => {
  // Same rows, one with a US-only geography string. Presence semantics are
  // unchanged by this work and HQ filtering is not introduced: the only thing
  // that may reject here is the employee range.
  const uk = company("Alpha", 100);
  const us = { ...company("Beta", 100), geography: "San Francisco, California, US" };
  assertEquals(
    admittedCandidateCount([uk, us] as NormalizedHiringCompany[], BOUNDS, ENFORCED),
    2,
    "a non-UK geography must not reduce the admitted count",
  );
});

Deno.test("pool exhausted + quota unmet + routes remain — replenishment", () => {
  const d = decideAutoContinuation({
    qualified: 3, requestedCount: 5,
    frontierRemaining: 0,
    continuationsUsed: 1, maxContinuations: 10,
    costUnitsUsed: 10, maxCostUnits: 1000,
    barrenSlices: 0, providerFailed: false,
    discoveryRoutesRemain: true,
  });
  assert(d.continue, "a spent pool with sources left is not a finished request");
  assertEquals(d.reason, "replenishment_required");
});

Deno.test("pool exhausted + no routes left — terminal exhaustion", () => {
  const d = decideAutoContinuation({
    qualified: 3, requestedCount: 5,
    frontierRemaining: 0,
    continuationsUsed: 1, maxContinuations: 10,
    costUnitsUsed: 10, maxCostUnits: 1000,
    barrenSlices: 0, providerFailed: false,
    discoveryRoutesRemain: false,
  });
  assert(!d.continue);
  assertEquals(d.reason, "frontier_exhausted");
});

Deno.test("absent route state keeps the previous terminal behaviour", () => {
  // A checkpoint from before this field existed. Unknown must read as "no".
  const d = decideAutoContinuation({
    qualified: 3, requestedCount: 5,
    frontierRemaining: 0,
    continuationsUsed: 1, maxContinuations: 10,
    costUnitsUsed: 10, maxCostUnits: 1000,
    barrenSlices: 0, providerFailed: false,
  });
  assert(!d.continue);
  assertEquals(d.reason, "frontier_exhausted");
});

Deno.test("replenishment never outranks quota or a ceiling", () => {
  const base = {
    requestedCount: 5, frontierRemaining: 0,
    maxContinuations: 10, costUnitsUsed: 10, maxCostUnits: 1000,
    barrenSlices: 0, providerFailed: false, discoveryRoutesRemain: true,
  };
  assertEquals(
    decideAutoContinuation({ ...base, qualified: 5, continuationsUsed: 1 }).reason,
    "quota_met", "a met quota stops even with routes available");
  const ceiling = decideAutoContinuation({
    ...base, qualified: 3, continuationsUsed: 10,
  });
  assert(!ceiling.continue, "the continuation ceiling still binds");
  assertEquals(ceiling.reason, "continuation_ceiling");
  const cost = decideAutoContinuation({
    ...base, qualified: 3, continuationsUsed: 1,
    costUnitsUsed: 1000, maxCostUnits: 1000,
  });
  assert(!cost.continue, "the cost ceiling still binds");
  assertEquals(cost.reason, "cost_ceiling");
});

Deno.test("pagination fields survive compilation", () => {
  const card = hiringActorCard("apify_linkedin_company_search");
  assert(card, "the company search card must exist");
  const accepted = acceptedInputFields(card!);
  for (const f of ["startPage", "takePages", "maxItems"]) {
    assert(accepted.includes(f), `${f} must be an accepted input`);
  }
  const { input, dropped } = compileActorInput(card!, {
    locations: ["United Kingdom"], companySize: ["11-50", "51-200"],
    industryIds: ["4", "6"], scraperMode: "full", startPage: 2,
  }, 50);
  assertEquals(
    dropped.filter((d) => d.field === "startPage").length, 0,
    "startPage was dropped with a reason the live schema contradicts",
  );
  assertEquals(input.startPage, 2);
});

Deno.test("a different page is a different question", () => {
  // Same actor, same filters, one page on. The compiled inputs must differ, or
  // the operation identity would collide and page 2 would be adopted as page 1.
  const card = hiringActorCard("apify_linkedin_company_search")!;
  const base = { locations: ["United Kingdom"], scraperMode: "full" };
  const p1 = compileActorInput(card, { ...base, startPage: 1 }, 50).input;
  const p2 = compileActorInput(card, { ...base, startPage: 2 }, 50).input;
  assert(
    JSON.stringify(p1) !== JSON.stringify(p2),
    "page 2 must not hash to page 1",
  );
});

Deno.test("checkpoint carries discovery source state through a resume", () => {
  const cp = buildCheckpoint({
    now: Date.now(), deadlineAt: Date.now() + 1000, remainingMs: 1000,
    lastCompletedCapability: null, nextPendingCapability: null,
    companies: [], reason: "execution_deadline_checkpoint",
    discoverySourceState: {
      sources_attempted: ["apify_linkedin_company_search"],
      pages_taken: { apify_linkedin_company_search: 2 },
      admitted: 34, raw_rows: 50, pool_target: 50,
      exhausted: false, stop_reason: "pass_limit",
    },
  });
  // THE ALLOWLIST TRAP: written and declared is not enough, it must read back.
  const back = readCheckpointDiscoveryState({ lead_resume_checkpoint: cp });
  assert(back, "source state must survive the JSON boundary");
  assertEquals(back!.pages_taken["apify_linkedin_company_search"], 2,
    "a resume that forgets the page restarts at page one");
  assertEquals(back!.exhausted, false);
  assertEquals(back!.admitted, 34);
});

Deno.test("an unreadable exhausted flag stops rather than spends", () => {
  const back = readCheckpointDiscoveryState({
    lead_resume_checkpoint: {
      version: (buildCheckpoint({
        now: 0, deadlineAt: 0, remainingMs: 0,
        lastCompletedCapability: null, nextPendingCapability: null,
        companies: [], reason: "all_work_complete",
      })).version,
      discovery_source_state: { sources_attempted: ["x"] },
    },
  });
  assert(back);
  assertEquals(back!.exhausted, true, "unknown must default to stopping");
});

Deno.test("merge across pages dedupes rather than double-counting", () => {
  // Page 1 and page 2 overlapping by ten rows. The admitted count must not
  // inflate, or replenishment would stop on companies it already held.
  const page1 = poolOf(20, 5);
  const page2 = [...page1.slice(15), ...poolOf(0, 0), ...[
    company("Fresh1", 40), company("Fresh2", 60), company("Fresh3", 80),
  ]];
  const merged = mergePrequalification(
    emptyPrequalificationResult(),
    prequalifyDiscoveredCompanies([...page1, ...page2], BOUNDS, ENFORCED),
  );
  assertEquals(merged.eligible_companies, 23,
    "20 in-range from page 1 plus 3 fresh, with the overlap counted once");
});
