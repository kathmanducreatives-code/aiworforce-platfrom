// Opener eligibility over the LEGACY decision-maker projection.
//
// Regression cover for the 2026-07-19 production batch: accounts displaying
// three verified people were all blocked with `blocked_missing_verified_person`
// because their decision-maker run predated the namespaced Workbench stage.
//
// All fixtures are SYNTHETIC. The model boundary is a stub that records its call
// count, so a blocked lead is PROVEN to cost nothing. No network, no database,
// no provider, no migration.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPersonalizationContext,
  assessOpenerEligibility,
  generateOpener,
  resolveOutputMode,
  DEFAULT_OUTPUT_MODE,
  type PersonalizationContext,
  type ModelBoundary,
} from "../../../supabase/functions/_shared/workbench/openerBackend.ts";
import { applyStageUpdate, emptyAccountState, type WorkbenchAccountState } from "../../../supabase/functions/_shared/workbench/accountState.ts";

const T = "2026-07-19T15:00:00.000Z";
const BRAIN = {
  positioning: "Synthetic positioning statement for tests.",
  product_summary: "A synthetic product summary.",
  target_outcomes: ["cut manual triage time"],
};

/** Research populated, decision-maker stage deliberately left `not_started`. */
function accountWithResearchOnly(): WorkbenchAccountState {
  return applyStageUpdate(emptyAccountState("lead-1"), "company_research", {
    status: "succeeded",
    payload: {
      summary: "Synthetic platform for logistics teams.",
      evidence_urls: ["https://synthetic.example/about"],
      missing_evidence: [],
      confidence: "high",
      usable: true,
    },
  }, T);
}

function legacyPerson(overrides: Record<string, unknown> = {}) {
  return {
    name: "Sample Person One",
    full_name: "Sample Person One",
    title: "VP Revenue",
    current_title: "VP Revenue",
    current_company_name: "Example Corp",
    linkedin_url: "https://example.test/in/sample-one",
    linkedinUrl: "https://example.test/in/sample-one",
    role_family: "executive_revenue",
    verification_status: "verified",
    verification_methods: ["company_linkedin_url"],
    company_match: { status: "verified", reason: "company_linkedin_url", matched_on: ["company_linkedin_url"] },
    confidence: "high",
    rank: 1,
    persisted: true,
    ...overrides,
  };
}

function ctxWithLegacy(legacy: unknown[]): PersonalizationContext {
  return buildPersonalizationContext({
    lead_candidate_id: "lead-1",
    company_name: "Example Corp",
    industry: "logistics",
    account: accountWithResearchOnly(),
    legacy_decision_makers: legacy,
    brain_profile: BRAIN,
  });
}

/** Records every invocation so "zero model calls" is an assertion, not a claim. */
function countingModel() {
  const calls = { n: 0 };
  const model: ModelBoundary = () => {
    calls.n += 1;
    return Promise.resolve({
      opener: "Saw the logistics platform work and wondered how your team handles triage today.",
      used_evidence_ids: ["research_1"],
    });
  };
  return { calls, model };
}

// -------------------------------------------------------------- eligibility ---

Deno.test("12. a verified legacy fallback permits eligibility", () => {
  const ctx = ctxWithLegacy([legacyPerson()]);
  assertEquals(ctx.person_resolution.source, "legacy_decision_makers");
  assertEquals(ctx.decision_maker?.verification_status, "verified");

  const e = assessOpenerEligibility(ctx, false);
  assert(e.status !== "blocked", `expected eligible, got ${e.reason_code}`);
});

Deno.test("the legacy person's real title is used, not the role family", () => {
  const ctx = ctxWithLegacy([legacyPerson()]);
  assertEquals(ctx.decision_maker?.current_title, "VP Revenue");
  assertEquals(ctx.decision_maker?.current_company_name, "Example Corp");
});

Deno.test("13. no person anywhere returns blocked_missing_verified_person", () => {
  const e = assessOpenerEligibility(ctxWithLegacy([]), false);
  assertEquals(e.status, "blocked");
  assertEquals(e.reason_code, "blocked_missing_verified_person");
});

Deno.test("14. a malformed person blocks with contract_invalid, not missing-person", () => {
  // Claims verification, carries no name — telling the user to "find a decision
  // maker" would send them to re-run a search that already succeeded.
  const e = assessOpenerEligibility(ctxWithLegacy([legacyPerson({ full_name: null, name: null })]), false);
  assertEquals(e.status, "blocked");
  assertEquals(e.reason_code, "blocked_person_contract_invalid");
});

Deno.test("an unverified legacy person still blocks", () => {
  const e = assessOpenerEligibility(ctxWithLegacy([legacyPerson({ verification_status: "likely" })]), false);
  assertEquals(e.status, "blocked");
  assertEquals(e.reason_code, "blocked_missing_verified_person");
});

// -------------------------------------------------------------- model spend ---

Deno.test("15. every blocked state invokes the model ZERO times", async () => {
  const cases: Array<[string, unknown[]]> = [
    ["no person", []],
    ["unverified", [legacyPerson({ verification_status: "likely" })]],
    ["malformed", [legacyPerson({ full_name: null, name: null })]],
  ];
  for (const [label, legacy] of cases) {
    const { calls, model } = countingModel();
    const ctx = ctxWithLegacy(legacy);
    const e = assessOpenerEligibility(ctx, false);
    assertEquals(e.status, "blocked", label);
    const res = await generateOpener(ctx, e, model);
    assertEquals(res.status, "blocked", label);
    assertEquals(calls.n, 0, `${label} must cost nothing`);
    assertEquals(res.model_calls, 0, label);
    assertEquals(res.sent, false, label);
  }
});

Deno.test("an eligible legacy-resolved lead DOES reach the model", async () => {
  const { calls, model } = countingModel();
  const ctx = ctxWithLegacy([legacyPerson()]);
  const e = assessOpenerEligibility(ctx, false);
  const res = await generateOpener(ctx, e, model);
  assertEquals(calls.n, 1);
  assertEquals(res.sent, false);
  assertEquals(res.approval_required, true);
});

// ---------------------------------------------------------- legacy contract ---

Deno.test("16. the full_draft legacy path is unchanged", () => {
  assertEquals(DEFAULT_OUTPUT_MODE, "full_draft");
  assertEquals(resolveOutputMode(undefined), "full_draft");
  assertEquals(resolveOutputMode("full_draft"), "full_draft");
  assertEquals(resolveOutputMode("something_else"), "full_draft");
  assertEquals(resolveOutputMode("personalized_opener"), "personalized_opener");
});

Deno.test("the namespaced stage still wins when it is populated", () => {
  const acct = applyStageUpdate(accountWithResearchOnly(), "decision_makers", {
    status: "succeeded",
    payload: {
      verified_count: 1,
      manual_review_count: 0,
      primary_full_name: "Namespaced Person",
      primary_linkedin_url: "https://example.test/in/namespaced",
      primary_role_family: "founder",
      primary_company_name: "Example Corp",
      primary_verification_methods: ["company_linkedin_url"],
      contact_id: "c1",
    },
  }, T);

  const ctx = buildPersonalizationContext({
    lead_candidate_id: "lead-1",
    company_name: "Example Corp",
    industry: "logistics",
    account: acct,
    legacy_decision_makers: [legacyPerson()],
    brain_profile: BRAIN,
  });

  assertEquals(ctx.person_resolution.source, "workbench_last_success");
  assertEquals(ctx.decision_maker?.full_name, "Namespaced Person");
});

Deno.test("no contact detail leaks into the context from the legacy record", () => {
  const ctx = ctxWithLegacy([legacyPerson({
    email: "someone@example.test",
    email_source_url: "https://example.test/contact",
  })]);
  const serialised = JSON.stringify(ctx);
  assert(!serialised.includes("@example.test"), "an email must never enter the opener context");
});
