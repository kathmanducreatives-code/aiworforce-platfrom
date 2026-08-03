// A Company Brain that approves and forbids the same positioning must stop
// generation BEFORE the model.
//
// Production (workspace e510c1a6, Brain updated 2026-07-20 15:58) carries talent
// vocabulary in BOTH `positioning.use_cases` (approved, and therefore fed to the
// model as a usable claim) and `positioning.avoid_positioning` (forbidden). The
// generator silently used the approved side and shipped positioning the same
// Brain bans.
//
// Choosing a side is guessing at intent. Blocking costs the user one message;
// guessing wrong ships banned messaging.
//
// All fixtures SYNTHETIC. The model boundary counts calls, so "zero model calls"
// is proven rather than asserted.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPersonalizationContext,
  assessOpenerEligibility,
  generateOpener,
  buildOpenerStagePayload,
  type ModelBoundary,
} from "../../../supabase/functions/_shared/workbench/openerBackend.ts";
import { applyStageUpdate, emptyAccountState, mergeStage, type WorkbenchAccountState } from "../../../supabase/functions/_shared/workbench/accountState.ts";

const T = "2026-07-21T10:00:00.000Z";

/** The production shape: the SAME vocabulary approved and forbidden. */
const CONFLICTING_BRAIN = {
  company_name: "Contradictory Co",
  company_summary: "A synthetic company summary.",
  positioning: {
    offer: "passive talent discovery and candidate intelligence",
    use_cases: ["passive talent discovery for hiring teams"],
    avoid_positioning: ["never position us around passive talent discovery"],
  },
  target_outcomes: ["help teams hire faster"],
};

/** Coherent pipeline tenant — nothing approved is also forbidden. */
const COHERENT_PIPELINE_BRAIN = {
  company_name: "Northwind Signals",
  company_summary: "Northwind Signals helps lean teams build qualified pipeline.",
  positioning: {
    offer: "signal-based account research and qualification",
    use_cases: ["comparing how account qualification is structured"],
    avoid_positioning: ["never claim guaranteed revenue"],
  },
  target_outcomes: ["turn buying signals into a reviewed shortlist"],
};

/** Coherent RECRUITING tenant — talent language approved and NOT forbidden. */
const COHERENT_RECRUITING_BRAIN = {
  company_name: "Larkspur Talent",
  company_summary: "Larkspur Talent runs candidate sourcing for hiring teams.",
  positioning: {
    offer: "passive talent discovery and candidate intelligence",
    use_cases: ["reviewing a candidate sourcing workflow"],
    avoid_positioning: ["never claim guaranteed placements"],
  },
  target_outcomes: ["shorten the hiring workflow"],
};

const PERSON = [{
  full_name: "Sample Person",
  current_title: "Chief Revenue Officer",
  current_company_name: "Example Corp",
  linkedin_url: "https://example.test/in/sample",
  role_family: "executive_revenue",
  verification_status: "verified",
  verification_methods: ["company_linkedin_url"],
  company_match: { status: "verified" },
  rank: 1,
  persisted: true,
}];

function accountState(): WorkbenchAccountState {
  return applyStageUpdate(emptyAccountState("lead-1"), "company_research", {
    status: "succeeded",
    payload: {
      summary: "Example Corp builds synthetic widgets.",
      evidence_urls: ["https://example.test/about"],
      missing_evidence: [], confidence: "high", usable: true,
    },
  }, T);
}

function ctxFor(brain: unknown, brainUpdatedAt = "2026-07-20T15:58:17.205Z") {
  return buildPersonalizationContext({
    lead_candidate_id: "lead-1",
    company_name: "Example Corp",
    industry: "security",
    account: accountState(),
    legacy_decision_makers: PERSON,
    brain_profile: brain,
    saved_icp: brain,
    company_brain_id: "workspace-1",
    company_brain_updated_at: brainUpdatedAt,
  });
}

function countingModel() {
  const calls = { n: 0 };
  const fn: ModelBoundary = () => {
    calls.n += 1;
    return Promise.resolve({
      opener: "Some opener. Worth comparing notes?",
      used_evidence_ids: ["research_1"],
      used_seller_claim_ids: ["seller_claim_1"],
    });
  };
  return { calls, fn };
}

// ------------------------------------------------------------- the block -----

Deno.test("1. an approved claim that the SAME Brain forbids blocks generation", () => {
  const e = assessOpenerEligibility(ctxFor(CONFLICTING_BRAIN), false);
  assertEquals(e.status, "blocked");
  assertEquals(e.reason_code, "blocked_company_brain_conflict");
});

Deno.test("2. a blocked conflict makes ZERO model calls", async () => {
  const ctx = ctxFor(CONFLICTING_BRAIN);
  const e = assessOpenerEligibility(ctx, false);
  const { calls, fn } = countingModel();
  const r = await generateOpener(ctx, e, fn);

  assertEquals(r.status, "blocked");
  assertEquals(r.reason_code, "blocked_company_brain_conflict");
  assertEquals(calls.n, 0, "a misconfigured Brain must cost nothing");
  assertEquals(r.model_calls, 0);
  assertEquals(r.provider_attempted, false);
  // No generic fallback, no new opener.
  assertEquals(r.opener, undefined);
  assertEquals(r.sent, false);
});

Deno.test("3. the previous valid opener survives a blocked attempt", () => {
  const ctx = ctxFor(CONFLICTING_BRAIN);
  const e = assessOpenerEligibility(ctx, false);

  const previous = { status: "succeeded", opener: "A previously approved message. Worth a look?" };
  const merged = mergeStage(
    { status: "succeeded", reason_code: null, last_success: previous, attempted_at: T, succeeded_at: T, failure_reason: null },
    { status: "failed", reason_code: e.reason_code, payload: null },
    "2026-07-21T11:00:00.000Z",
  );

  // The good draft is kept; only the ATTEMPT status changes.
  assertEquals((merged.last_success as { opener: string }).opener, previous.opener);
  assertEquals(merged.reason_code, "blocked_company_brain_conflict");
});

Deno.test("4. diagnostics carry ids and concepts, never prompt text", () => {
  const e = assessOpenerEligibility(ctxFor(CONFLICTING_BRAIN), false);
  const d = e.brain_conflict!;
  assert(d.conflicting_claim_ids.length > 0, "the offending claim is identified");
  assert(d.conflicting_claim_ids.every((id) => /^seller_claim_\d+$/.test(id)));
  assert(d.conflicting_prohibited.length > 0);
  assert(d.overlapping_concepts.length >= 2, "normalized overlapping concepts are reported");

  // 9. Brain version provenance travels with the block.
  assertEquals(d.company_brain_id, "workspace-1");
  assertEquals(d.company_brain_updated_at, "2026-07-20T15:58:17.205Z");

  // No prompt, no system text, no full claim bodies beyond the overlap terms.
  const blob = JSON.stringify(d).toLowerCase();
  assert(!blob.includes("you write one short"), "system prompt leaked");
  assert(!blob.includes("=== seller context"), "prompt scaffolding leaked");
});

// -------------------------------------------------- coherent Brains proceed --

Deno.test("5. a coherent PIPELINE Brain is not blocked", () => {
  const e = assessOpenerEligibility(ctxFor(COHERENT_PIPELINE_BRAIN), false);
  assert(e.reason_code !== "blocked_company_brain_conflict", `blocked: ${e.reason_code}`);
});

Deno.test("6/7. a coherent RECRUITING Brain is not blocked — no global word ban", () => {
  // The SAME talent vocabulary that blocks the contradictory tenant is perfectly
  // valid here, because this Brain approves it and does not forbid it.
  const ctx = ctxFor(COHERENT_RECRUITING_BRAIN);
  const e = assessOpenerEligibility(ctx, false);
  assert(e.reason_code !== "blocked_company_brain_conflict", `blocked: ${e.reason_code}`);
  assert(
    JSON.stringify(ctx.seller_claims).toLowerCase().includes("talent"),
    "recruiting language remains an approved claim for this tenant",
  );
});

Deno.test("8. incidental wording overlap does NOT falsely block", () => {
  const e = assessOpenerEligibility(ctxFor({
    company_name: "Sample Co",
    company_summary: "A synthetic summary.",
    positioning: { offer: "account research for revenue teams" },
    // Shares only the single common word "revenue".
    prohibited_claims: ["never claim guaranteed revenue"],
  }), false);
  assert(e.reason_code !== "blocked_company_brain_conflict", `false positive: ${e.reason_code}`);
});

// ---------------------------------------------------- corrected Brain works --

Deno.test("10. a CORRECTED Brain generates again, with a CTA", async () => {
  // The same tenant after the talent language is removed from approved fields.
  const corrected = {
    company_name: "Corrected Co",
    company_summary: "Corrected Co helps lean teams build qualified pipeline.",
    positioning: {
      offer: "signal-based account research and qualification",
      use_cases: ["comparing how account qualification is structured"],
      avoid_positioning: ["never position us around passive talent discovery"],
    },
    target_outcomes: ["turn buying signals into a reviewed shortlist"],
  };
  const ctx = ctxFor(corrected);
  const e = assessOpenerEligibility(ctx, false);
  assert(e.reason_code !== "blocked_company_brain_conflict", `still blocked: ${e.reason_code}`);

  const { calls, fn } = countingModel();
  const r = await generateOpener(ctx, e, fn);
  assertEquals(r.status, "succeeded");
  assertEquals(calls.n, 1, "a coherent Brain reaches the model exactly once");
  assert(r.opener?.includes("?"), "the generated message carries a next step");

  // And the CTA survives into what is persisted.
  const payload = buildOpenerStagePayload(r, T);
  assert(payload.opener?.includes("?"));
  assertEquals(payload.sent, false);
});
