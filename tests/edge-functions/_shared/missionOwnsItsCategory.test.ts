// THE REQUEST AND THE EXCLUSION NAMED THE SAME CATEGORY.
//
// ── WHAT THIS COST, FROM THE 2026-08-30 RUN ────────────────────────────────
//
// Mission: "Find 5 recruiting or staffing companies that fit my ICP and are
// actively hiring sales roles." — `company_profile.verticals: [recruiting,
// staffing]`. Lineage 862e81be paid for discovery, enrichment and a job search,
// verified hiring at three companies, and reported:
//
//   reached_evaluation 3, decided_by_model 0, fabricated_reject 3
//   Storm4 / Talentoma / Storm3 → company_fit_reject : staffing_or_aggregator
//
// Every one of the five root-cause fixes worked and the run still could not
// return a lead, because `evaluateCompanyFit` rejected the ICP for being the
// ICP. `CompanyFitInput` carried no mission field at all, so the gate could not
// have known.
//
// The evidence module's own header always said it "does not reject anything —
// the Company Brain makes the exclusion decision". The gate contradicted it.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ATTRIBUTION_SIGNAL_CODES, IDENTITY_SIGNAL_CODES, attributionOnlyStatus,
  extractAggregatorEvidence, missionTargetsIntermediaries,
} from "../../../supabase/functions/_shared/companyAggregatorEvidence.ts";
import { evaluateCompanyFit } from "../../../supabase/functions/_shared/companyFirstStages.ts";

/** Storm4 as production enriched it: LinkedIn industry 104. */
const STAFFING_FIRM = {
  company_name: "Storm4",
  industry_ids: [{ id: "104", name: "Staffing and Recruiting" }],
  description: "We connect climate tech companies with talent.",
  canonical_domain: "storm4.com",
  postings: [{ job_id: "1", title: "Sales Development Representative",
               description: "Join our own sales team in London." }],
};

const fit = (over: Record<string, unknown> = {}) => evaluateCompanyFit({
  company_key: "https://www.linkedin.com/company/storm4",
  company_name: STAFFING_FIRM.company_name,
  identity_status: "verified_match",
  enrichment_complete: true,
  employee_count: 60,
  employee_range_advisory: null,
  industry_ids: STAFFING_FIRM.industry_ids,
  description: STAFFING_FIRM.description,
  canonical_domain: STAFFING_FIRM.canonical_domain,
  postings: STAFFING_FIRM.postings,
  ...over,
});

// ── THE REGRESSION ITSELF ───────────────────────────────────────────────────

Deno.test("STORM4 IS NO LONGER REJECTED FOR BEING WHAT WAS ASKED FOR", () => {
  const rejected = fit();
  assertEquals(rejected.stage, "company_fit_reject");
  assertEquals(rejected.reason, "staffing_or_aggregator");

  const asked = fit({ mission_targets_intermediaries: true });
  assert(asked.stage !== "company_fit_reject",
    `a staffing mission must not reject a staffing firm, got ${asked.reason}`);
  assert(!asked.failed_gates.includes("staffing_or_aggregator"));
});

Deno.test("A SAAS MISSION STILL REJECTS IT — the gate is suspended, not deleted", () => {
  // The check exists because a benchmark produced founder outreach to a job
  // board. Nothing about this fix may weaken that.
  const r = fit({ mission_targets_intermediaries: false });
  assertEquals(r.stage, "company_fit_reject");
  assertEquals(r.reason, "staffing_or_aggregator");
});

Deno.test("omitting the flag is exactly the old behaviour", () => {
  assertEquals(fit().reason, fit({ mission_targets_intermediaries: false }).reason);
});

// ── THE HALF THAT STILL REJECTS ─────────────────────────────────────────────

Deno.test("A CLIENT'S ROLE IS STILL NOT PROOF THIS COMPANY IS HIRING", () => {
  // The distinction the fix turns on. A staffing firm is a valid target; a
  // posting describing an unnamed third-party employer is still misattributed,
  // and that must reject for every mission alike.
  const misattributed = fit({
    mission_targets_intermediaries: true,
    postings: [
      { job_id: "1", title: "AE", description: "Our client is a leading company in oncology." },
      { job_id: "2", title: "SDR", description: "The hiring company operates warehouse fulfillment." },
    ],
  });
  assertEquals(misattributed.stage, "company_fit_reject");
  assertEquals(misattributed.reason, "staffing_or_aggregator");
});

Deno.test("the two families are scored by the same thresholds", () => {
  // `attributionOnlyStatus` reuses the whole-set rule, so a subset can never be
  // judged more or less harshly than the whole.
  const one = extractAggregatorEvidence({
    company_name: "X", postings: [
      { job_id: "1", description: "our client is a leading company" }],
  });
  assertEquals(attributionOnlyStatus(one), "possible", "one weak attribution signal");

  const two = extractAggregatorEvidence({
    company_name: "X", postings: [
      { job_id: "1", description: "our client is a leading company" },
      { job_id: "2", description: "the hiring company is in banking and payments" }],
  });
  assertEquals(attributionOnlyStatus(two), "supported", "two agree");
});

Deno.test("EVERY SIGNAL BELONGS TO EXACTLY ONE FAMILY", () => {
  // A signal in neither list is silently ignored by the exemption; a signal in
  // both is scored twice. Either way the split stops meaning what it says.
  const emitted = extractAggregatorEvidence({
    company_name: "Wildly Different Name",
    industry_ids: [{ id: "104", name: "Staffing and Recruiting" }],
    provider_industry: "Staffing and Recruiting",
    description: "a staffing agency and job board that connects job seekers",
    canonical_domain: "totallyunrelated.com",
    postings: [
      { job_id: "1", description: "our client is a leading company in oncology" },
      { job_id: "2", description: "the employer is in supply chain and freight" },
    ],
  }).signals.map((s) => s.code);
  assert(emitted.length >= 5, `expected a broad sample, got ${emitted.join(",")}`);
  for (const code of emitted) {
    const inIdentity = IDENTITY_SIGNAL_CODES.includes(code);
    const inAttribution = ATTRIBUTION_SIGNAL_CODES.includes(code);
    assert(inIdentity !== inAttribution, `${code} must be in exactly one family`);
  }
});

// ── WHO COUNTS AS ASKING ────────────────────────────────────────────────────

Deno.test("THE PRODUCTION MISSION'S OWN VERTICALS ANSWER YES", () => {
  const m = missionTargetsIntermediaries({ mission_verticals: ["recruiting", "staffing"] });
  assertEquals(m.targets, true);
  assert(m.matched.includes("recruiting") && m.matched.includes("staffing"));
});

Deno.test("a SaaS mission answers no", () => {
  assertEquals(missionTargetsIntermediaries(
    { mission_verticals: ["b2b saas", "fintech"] }).targets, false);
  assertEquals(missionTargetsIntermediaries({ mission_verticals: [] }).targets, false);
  assertEquals(missionTargetsIntermediaries({}).targets, false);
});

Deno.test("phrases containing the category still count", () => {
  for (const v of ["recruitment agencies", "executive search firms", "staffing services"]) {
    assertEquals(missionTargetsIntermediaries({ mission_verticals: [v] }).targets, true, v);
  }
});

Deno.test("A SHORT VERTICAL MAY NOT MATCH BY ACCIDENT", () => {
  // Without the length floor, "it" is a substring of "recruiting" and every
  // IT-services mission would silently lose the gate.
  for (const v of ["it", "hr", "ai", "ent"]) {
    assertEquals(missionTargetsIntermediaries({ mission_verticals: [v] }).targets, false, v);
  }
});

// ── THE WIRING ──────────────────────────────────────────────────────────────

const ENGINE = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
const code = ENGINE.split("\n")
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

Deno.test("the engine actually passes the mission to the gate", () => {
  assert(/mission_targets_intermediaries:\s*targetsIntermediaries\.targets/.test(code),
    "the flag must reach evaluateCompanyFit");
  assert(code.includes("missionTargetsIntermediaries({"),
    "and be computed from the mission");
});

Deno.test("it is resolved ONCE for the run, like the employee bounds", () => {
  // Computed per company it could differ between two companies in one run,
  // which is not a thing a property of the mission may do.
  assertEquals(code.split("missionTargetsIntermediaries({").length - 1, 1);
});

Deno.test("suspending a hard gate is logged", () => {
  assert(code.includes("aggregator_gate_suspended_for_mission"),
    "an operator must be able to see why staffing firms were returned");
});
