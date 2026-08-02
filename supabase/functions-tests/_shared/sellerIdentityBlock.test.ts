// A Company Brain whose seller IDENTITY disagrees with itself must stop
// generation BEFORE the model — and must NEVER name the seller after the stale
// legacy value.
//
// Production (workspace e510c1a6): profile.company_name = "goji" (legacy flat,
// contaminated by a gojiberry.ai research run) while profile.company.name =
// "Agentory" (current nested). The old flat-first resolution named the seller
// "goji". This suite proves the resolver reports "Agentory", the eligibility
// gate BLOCKS, and the block costs zero model calls.
//
// All fixtures SYNTHETIC. The model boundary counts calls, so "zero model calls"
// is proven rather than asserted.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPersonalizationContext,
  assessOpenerEligibility,
  generateOpener,
  buildGenerationProvenance,
  buildOpenerStagePayload,
  type ModelBoundary,
} from "../../functions/_shared/openerBackend.ts";
import { applyStageUpdate, emptyAccountState, mergeStage, type WorkbenchAccountState } from "../../functions/_shared/accountState.ts";

const T = "2026-07-21T10:00:00.000Z";

/** The production shape: nested Agentory, stale flat "goji" from a competitor. */
const CONTAMINATED_BRAIN = {
  company_name: "goji",
  website_url: "https://gojiberry.ai",
  linkedin_company_url: "https://linkedin.com/company/goji",
  company: {
    name: "Agentory",
    website_url: "https://agentory.space",
    linkedin_url: "https://linkedin.com/company/agentory",
  },
  company_summary: "Agentory runs an AI workforce platform for lean go-to-market teams.",
  positioning: {
    offer: "an AI workforce platform for go-to-market teams",
    use_cases: ["comparing how outbound is structured"],
  },
  target_outcomes: ["turn buying signals into a reviewed shortlist"],
};

/** Same tenant, identity corrected: no stale flat value. */
const CLEAN_BRAIN = {
  company: {
    name: "Agentory",
    website_url: "https://agentory.space",
  },
  company_summary: "Agentory runs an AI workforce platform for lean go-to-market teams.",
  positioning: {
    offer: "an AI workforce platform for go-to-market teams",
    use_cases: ["comparing how outbound is structured"],
  },
  target_outcomes: ["turn buying signals into a reviewed shortlist"],
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

function ctxFor(brain: unknown) {
  return buildPersonalizationContext({
    lead_candidate_id: "lead-1",
    company_name: "Example Corp",
    industry: "security",
    account: accountState(),
    legacy_decision_makers: PERSON,
    brain_profile: brain,
    saved_icp: brain,
    company_brain_id: "workspace-1",
    company_brain_updated_at: "2026-07-21T09:00:00.000Z",
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

Deno.test("9. seller=Agentory, legacy flat=goji resolves to Agentory, never goji", () => {
  const ctx = ctxFor(CONTAMINATED_BRAIN);
  assertEquals(ctx.seller_identity.companyName, "Agentory");
  assertEquals(ctx.seller.seller_company_name, "Agentory");
  assert(ctx.seller_identity.companyName!.toLowerCase() !== "goji");
});

Deno.test("4/5. a conflicting seller identity blocks generation", () => {
  const e = assessOpenerEligibility(ctxFor(CONTAMINATED_BRAIN), false);
  assertEquals(e.status, "blocked");
  assertEquals(e.reason_code, "blocked_seller_identity_conflict");
  assert(e.seller_identity_conflict);
  assert(e.seller_identity_conflict!.conflicting_fields.includes("company_name"));
});

Deno.test("6. a blocked identity conflict makes ZERO model calls", async () => {
  const ctx = ctxFor(CONTAMINATED_BRAIN);
  const e = assessOpenerEligibility(ctx, false);
  const { calls, fn } = countingModel();
  const r = await generateOpener(ctx, e, fn);

  assertEquals(r.status, "blocked");
  assertEquals(r.reason_code, "blocked_seller_identity_conflict");
  assertEquals(calls.n, 0, "a contaminated identity must cost nothing");
  assertEquals(r.model_calls, 0);
  assertEquals(r.provider_attempted, false);
  assertEquals(r.opener, undefined, "no fallback message");
  assertEquals(r.sent, false);
});

Deno.test("7. the previous valid opener survives a blocked identity attempt", () => {
  const e = assessOpenerEligibility(ctxFor(CONTAMINATED_BRAIN), false);
  const previous = { status: "succeeded", opener: "A previously approved message. Worth a look?" };
  const merged = mergeStage(
    { status: "succeeded", reason_code: null, last_success: previous, attempted_at: T, succeeded_at: T, failure_reason: null },
    { status: "failed", reason_code: e.reason_code, payload: null },
    "2026-07-21T11:00:00.000Z",
  );
  assertEquals((merged.last_success as { opener: string }).opener, previous.opener);
  assertEquals(merged.reason_code, "blocked_seller_identity_conflict");
});

Deno.test("34. diagnostics carry ids + normalized values, never prompt or full Brain", () => {
  const e = assessOpenerEligibility(ctxFor(CONTAMINATED_BRAIN), false);
  const d = e.seller_identity_conflict!;
  assert(d.conflicting_paths.includes("company_name"));
  assert(d.normalized_values.includes("goji"), "the offending value is identified");
  assertEquals(d.company_brain_id, "workspace-1");
  assertEquals(d.company_brain_updated_at, "2026-07-21T09:00:00.000Z");
  assert(/^[0-9a-f]{8}$/.test(d.identity_hash));

  const blob = JSON.stringify(d).toLowerCase();
  assert(!blob.includes("you write one short"), "system prompt leaked");
  assert(!blob.includes("=== seller context"), "prompt scaffolding leaked");
  assert(!blob.includes("ai workforce platform"), "full Brain positioning leaked");
});

// ---------------------------------------------------- clean identity works ---

Deno.test("a coherent identity is not blocked and reaches the model once", async () => {
  const ctx = ctxFor(CLEAN_BRAIN);
  const e = assessOpenerEligibility(ctx, false);
  assert(e.reason_code !== "blocked_seller_identity_conflict", `blocked: ${e.reason_code}`);

  const { calls, fn } = countingModel();
  const r = await generateOpener(ctx, e, fn);
  assertEquals(r.status, "succeeded");
  assertEquals(calls.n, 1);
});

// --------------------------------------------------------- 30-32. provenance --

Deno.test("30/31/32. a generation stamps brain + seller-identity provenance", async () => {
  const ctx = ctxFor(CLEAN_BRAIN);
  const e = assessOpenerEligibility(ctx, false);
  const { fn } = countingModel();
  const r = await generateOpener(ctx, e, fn);

  const prov = buildGenerationProvenance({ ctx, result: r, now: T });
  assertEquals(prov.company_brain_id, "workspace-1");                       // 30
  assertEquals(prov.company_brain_updated_at, "2026-07-21T09:00:00.000Z"); // 30
  assertEquals(prov.seller_company_name_used, "Agentory");                 // 31
  assertEquals(prov.seller_domain_used, "agentory.space");
  assertEquals(prov.seller_identity_source, "nested");                     // 31
  assert(/^[0-9a-f]{8}$/.test(prov.seller_identity_hash));
  assert(prov.approved_seller_claim_ids.length > 0);                       // 32
  assert(prov.claim_field_paths.length > 0);                              // 32
  assertEquals(prov.generator_contract_version, "opener-v1");

  // And provenance travels into the persisted payload.
  const payload = buildOpenerStagePayload(r, T, prov);
  assertEquals(payload.generation_provenance?.seller_company_name_used, "Agentory");
});

// ------------------------------------------------------- 25. multi-tenant -----

Deno.test("25. two workspaces keep different seller identities", () => {
  const a = ctxFor(CLEAN_BRAIN);
  const b = buildPersonalizationContext({
    lead_candidate_id: "lead-2",
    company_name: "Example Corp",
    industry: "security",
    account: accountState(),
    legacy_decision_makers: PERSON,
    brain_profile: { company: { name: "Northwind Signals", website_url: "https://northwind.example" } },
    saved_icp: {},
    company_brain_id: "workspace-2",
    company_brain_updated_at: "2026-07-21T09:00:00.000Z",
  });
  assertEquals(a.seller_identity.companyName, "Agentory");
  assertEquals(b.seller_identity.companyName, "Northwind Signals");
  assert(a.seller_identity.identityHash !== b.seller_identity.identityHash);
});
