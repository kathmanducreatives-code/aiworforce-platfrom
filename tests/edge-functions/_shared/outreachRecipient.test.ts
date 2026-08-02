// The opener must persist the ONE recipient it generated for.
//
// Regression cover for a QA export where a message generated for one person was
// displayed against another (generated for Kenneth, displayed Amy). The opener
// stage payload previously recorded no recipient at all, so the row and CSV each
// re-derived their own from different sources.
//
// Synthetic fixtures. No network, database, provider or model.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canonicalRecipient, recipientMatchesDisplayedContact } from "../../supabase/functions/_shared/outreachRecipient.ts";
import {
  buildPersonalizationContext,
  assessOpenerEligibility,
  generateOpener,
  buildOpenerStagePayload,
  type ModelBoundary,
  type OpenerDecisionMaker,
} from "../../supabase/functions/_shared/openerBackend.ts";
import { applyStageUpdate, emptyAccountState, type WorkbenchAccountState } from "../../supabase/functions/_shared/accountState.ts";
import type { ResolvedPerson } from "../../supabase/functions/_shared/decisionMakerResolver.ts";

const T = "2026-07-20T12:00:00.000Z";

const BRAIN = {
  company_name: "Northwind Signals",
  company_summary: "Northwind Signals finds buying signals for revenue teams.",
  positioning: { offer: "account qualification", promise: "qualify accounts faster" },
  target_outcomes: ["cut manual account qualification time"],
};

/** A verified person with a persisted contact_id — the one the opener writes to. */
const PERSON = [{
  full_name: "Kenneth Pouliot",
  current_title: "Director of Revenue Operations",
  current_company_name: "Harmonic Security",
  linkedin_url: "https://example.test/in/kenneth",
  role_family: "executive_revenue",
  verification_status: "verified",
  verification_methods: ["company_linkedin_url"],
  company_match: { status: "verified" },
  contact_id: "contact-kenneth",
  rank: 1,
  persisted: true,
}];

function accountState(): WorkbenchAccountState {
  return applyStageUpdate(emptyAccountState("lead-1"), "company_research", {
    status: "succeeded",
    payload: {
      summary: "Harmonic Security is an AI governance company.",
      evidence_urls: ["https://prospect.example/about"],
      missing_evidence: [], confidence: "high", usable: true,
    },
  }, T);
}

function ctx() {
  return buildPersonalizationContext({
    lead_candidate_id: "lead-1",
    company_name: "Harmonic Security",
    industry: "security",
    account: accountState(),
    legacy_decision_makers: PERSON,
    brain_profile: BRAIN,
    saved_icp: BRAIN,
  });
}

const model: ModelBoundary = () => Promise.resolve({
  opener: "Kenneth, saw the RevOps search at Harmonic. We help revenue teams qualify accounts faster.",
  used_evidence_ids: ["research_1"],
  used_seller_claim_ids: ["seller_claim_1"],
});

// --------------------------------------------------------- the pure resolver --

Deno.test("canonicalRecipient records the person that entered the prompt", () => {
  const dm: OpenerDecisionMaker = {
    first_name: "Kenneth", full_name: "Kenneth Pouliot",
    current_title: "Director of Revenue Operations",
    current_company_name: "Harmonic Security", role_family: "executive_revenue",
    verification_status: "verified", verification_methods: ["company_linkedin_url"],
  };
  const resolved = { contact_id: "contact-kenneth" } as ResolvedPerson;
  const r = canonicalRecipient(dm, resolved);
  assertEquals(r.selected_contact_id, "contact-kenneth");
  assertEquals(r.selected_recipient_name, "Kenneth Pouliot");
  assertEquals(r.selected_recipient_first_name, "Kenneth");
  assertEquals(r.selected_recipient_title, "Director of Revenue Operations");
  assertEquals(r.selected_recipient_role_family, "executive_revenue");
});

Deno.test("a null decision-maker yields an empty recipient, not a crash", () => {
  const r = canonicalRecipient(null, null);
  assertEquals(r.selected_contact_id, null);
  assertEquals(r.selected_recipient_name, null);
});

Deno.test("title falls back to role_family when no title is present", () => {
  const dm: OpenerDecisionMaker = {
    first_name: "Kenneth", full_name: "Kenneth Pouliot", current_title: null,
    current_company_name: "Harmonic Security", role_family: "executive_revenue",
    verification_status: "verified", verification_methods: [],
  };
  assertEquals(canonicalRecipient(dm, null).selected_recipient_title, "executive_revenue");
});

// --------------------------------------------------- end-to-end persistence --

Deno.test("a generated opener persists the recipient it was written for", async () => {
  const c = ctx();
  const e = assessOpenerEligibility(c, false);
  const result = await generateOpener(c, e, model);
  assertEquals(result.status, "succeeded");
  assertEquals(result.recipient?.selected_recipient_name, "Kenneth Pouliot");
  assertEquals(result.recipient?.selected_contact_id, "contact-kenneth");

  // And the STAGE PAYLOAD — what actually lands in raw.agentory_workbench —
  // carries it, so the row and CSV read one canonical value.
  const payload = buildOpenerStagePayload(result, T);
  assertEquals(payload.selected_recipient_name, "Kenneth Pouliot");
  assertEquals(payload.selected_recipient_title, "Director of Revenue Operations");
  assertEquals(payload.selected_contact_id, "contact-kenneth");
  assertEquals(payload.selected_recipient_role_family, "executive_revenue");
});

Deno.test("the persisted recipient matches the resolver's rank-1 person", async () => {
  // The recipient recorded on the draft must be exactly the decision-maker the
  // resolver chose — never a separately-derived contact.
  const c = ctx();
  const e = assessOpenerEligibility(c, false);
  const result = await generateOpener(c, e, model);
  assertEquals(result.recipient?.selected_recipient_name, c.decision_maker?.full_name);
});

// ------------------------------------------------------------- mismatch aid --

Deno.test("a displayed contact with a different id is flagged as a mismatch", () => {
  const recipient = canonicalRecipient(
    {
      first_name: "Kenneth", full_name: "Kenneth Pouliot", current_title: "RevOps",
      current_company_name: "Harmonic", role_family: "executive_revenue",
      verification_status: "verified", verification_methods: [],
    },
    { contact_id: "contact-kenneth" } as ResolvedPerson,
  );
  // Amy is a different persisted contact — the exact production symptom.
  assertEquals(recipientMatchesDisplayedContact(recipient, { contact_id: "contact-amy", full_name: "Amy Zhu" }), false);
  // The same person matches.
  assertEquals(recipientMatchesDisplayedContact(recipient, { contact_id: "contact-kenneth" }), true);
});

Deno.test("a name-only comparison still catches a different person", () => {
  const recipient = canonicalRecipient(
    {
      first_name: "Kenneth", full_name: "Kenneth Pouliot", current_title: "RevOps",
      current_company_name: "Harmonic", role_family: "executive_revenue",
      verification_status: "verified", verification_methods: [],
    },
    null, // no contact_id on either side
  );
  assertEquals(recipientMatchesDisplayedContact(recipient, { full_name: "Amy Zhu" }), false);
  assertEquals(recipientMatchesDisplayedContact(recipient, { full_name: "kenneth pouliot" }), true);
});

Deno.test("no displayed contact is not treated as a mismatch", () => {
  const recipient = canonicalRecipient(
    {
      first_name: "Kenneth", full_name: "Kenneth Pouliot", current_title: "RevOps",
      current_company_name: "Harmonic", role_family: "executive_revenue",
      verification_status: "verified", verification_methods: [],
    },
    null,
  );
  assert(recipientMatchesDisplayedContact(recipient, null));
  assert(recipientMatchesDisplayedContact(recipient, {}));
});

// --------------------------------------------------------------- provenance --

Deno.test("a blocked opener persists no recipient (nothing was written)", async () => {
  const noPerson = buildPersonalizationContext({
    lead_candidate_id: "lead-1", company_name: "Harmonic Security", industry: "security",
    account: accountState(), legacy_decision_makers: [], brain_profile: BRAIN, saved_icp: BRAIN,
  });
  const e = assessOpenerEligibility(noPerson, false);
  const result = await generateOpener(noPerson, e, model);
  assertEquals(result.status, "blocked");
  assertEquals(result.recipient, undefined);
  const payload = buildOpenerStagePayload(result, T);
  assertEquals(payload.selected_recipient_name, null);
  assertEquals(payload.selected_contact_id, null);
});
