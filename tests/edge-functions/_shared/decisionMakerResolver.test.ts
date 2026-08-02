// Canonical decision-maker resolution for outreach eligibility.
//
// Every fixture here is SYNTHETIC. No real person, company, profile URL or
// provider payload appears in this file, and nothing in it touches a network,
// a database or a model.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveVerifiedDecisionMakerForOutreach,
  type WorkbenchDecisionMakerStage,
} from "../../../supabase/functions/_shared/decisionMakerResolver.ts";

// ------------------------------------------------------------------ fixtures --

/** A legacy `raw.decision_makers` entry that SHOULD be accepted. */
function legacyVerified(overrides: Record<string, unknown> = {}) {
  return {
    name: "Sample Person One",
    full_name: "Sample Person One",
    title: "VP Revenue",
    current_title: "VP Revenue",
    current_company_name: "Example Corp",
    linkedinUrl: "https://example.test/in/sample-one",
    linkedin_url: "https://example.test/in/sample-one",
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

function stage(overrides: Partial<WorkbenchDecisionMakerStage> = {}): WorkbenchDecisionMakerStage {
  return { status: "not_started", last_success: null, ...overrides };
}

const NAMESPACED_SUCCESS = {
  verified_count: 2,
  primary_full_name: "Namespaced Person",
  primary_linkedin_url: "https://example.test/in/namespaced",
  primary_role_family: "founder",
  primary_company_name: "Example Corp",
  primary_verification_methods: ["company_domain"],
  contact_id: "contact-1",
};

// -------------------------------------------------------- namespaced source ---

Deno.test("1. namespaced verified last_success is preferred over legacy", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage({ status: "succeeded", last_success: NAMESPACED_SUCCESS }),
    legacyDecisionMakers: [legacyVerified()],
  });
  assertEquals(r.status, "verified");
  assertEquals(r.source, "workbench_last_success");
  assertEquals(r.person?.full_name, "Namespaced Person");
});

Deno.test("10. a failed latest attempt does not erase a valid last_success", () => {
  // mergeStage keeps last_success across a later failure; the resolver must read
  // it rather than the failed attempt status.
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage({ status: "failed", last_success: NAMESPACED_SUCCESS }),
    legacyDecisionMakers: [],
  });
  assertEquals(r.status, "verified");
  assertEquals(r.source, "workbench_last_success");
});

Deno.test("a recorded namespaced success that cannot be read back is contract_invalid", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage({
      status: "succeeded",
      last_success: { ...NAMESPACED_SUCCESS, primary_full_name: null },
    }),
    // It must NOT silently degrade into a legacy lookup.
    legacyDecisionMakers: [legacyVerified()],
  });
  assertEquals(r.status, "contract_invalid");
  assertEquals(r.reason_code, "blocked_person_contract_invalid");
});

// ------------------------------------------------------- legacy fallback -----

Deno.test("2. namespaced not_started falls back to a verified legacy result", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [legacyVerified()],
  });
  assertEquals(r.status, "verified");
  assertEquals(r.source, "legacy_decision_makers");
  assertEquals(r.person?.role_family, "executive_revenue");
});

Deno.test("3. the highest-ranked verified legacy person is selected", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [
      legacyVerified({ full_name: "Rank Three", name: "Rank Three", rank: 3 }),
      legacyVerified({ full_name: "Rank One", name: "Rank One", rank: 1 }),
      legacyVerified({ full_name: "Rank Two", name: "Rank Two", rank: 2 }),
    ],
  });
  assertEquals(r.person?.full_name, "Rank One");
});

Deno.test("11. the fallback source is reported truthfully", () => {
  const viaLegacy = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [legacyVerified()],
  });
  assertEquals(viaLegacy.source, "legacy_decision_makers");

  const none = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [],
  });
  assertEquals(none.source, "none");
});

Deno.test("legacy aliases normalise to canonical fields", () => {
  // Only the legacy alias spellings are present.
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [{
      name: "Alias Only",
      title: "Head of Sales",
      linkedinUrl: "https://example.test/in/alias",
      verification_status: "verified",
      verification_methods: ["company_linkedin_url"],
      company_match: { status: "verified" },
      rank: 1,
      persisted: true,
    }],
  });
  assertEquals(r.status, "verified");
  assertEquals(r.person?.full_name, "Alias Only");
  assertEquals(r.person?.linkedin_url, "https://example.test/in/alias");
  assertEquals(r.person?.current_title, "Head of Sales");
});

// ------------------------------------------------- legacy acceptance rules ----

Deno.test("4. an unverified legacy person is rejected", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [legacyVerified({ verification_status: "likely" })],
  });
  assertEquals(r.status, "missing");
  assertEquals(r.reason_code, "blocked_missing_verified_person");
});

Deno.test("5. an off-company legacy person is rejected", () => {
  // Verified identity, UNVERIFIED employer — person-exists is not works-there.
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [legacyVerified({ company_match: { status: "likely" } })],
  });
  assertEquals(r.status, "contract_invalid");
});

Deno.test("6. a malformed legacy person returns contract_invalid", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    // Claims verification but carries no name.
    legacyDecisionMakers: [legacyVerified({ full_name: null, name: null })],
  });
  assertEquals(r.status, "contract_invalid");
  assertEquals(r.reason_code, "blocked_person_contract_invalid");
});

Deno.test("7. a contact_id alone is insufficient", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [{ contact_id: "contact-9", persisted: true }],
  });
  assertEquals(r.status, "missing");
});

Deno.test("8. a profile URL alone is insufficient", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [{ linkedin_url: "https://example.test/in/bare" }],
  });
  assertEquals(r.status, "missing");
});

Deno.test("a legacy person without provider provenance is rejected", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [legacyVerified({ persisted: false })],
  });
  assertEquals(r.status, "contract_invalid");
});

Deno.test("a non-http profile URL is rejected", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [legacyVerified({
      linkedin_url: "javascript:alert(1)",
      linkedinUrl: "not-a-url",
      evidence_url: null,
    })],
  });
  assertEquals(r.status, "contract_invalid");
});

// ------------------------------------------------------------- no person -----

Deno.test("9. no person returns missing", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage(),
    legacyDecisionMakers: [],
  });
  assertEquals(r.status, "missing");
  assertEquals(r.source, "none");
  assertEquals(r.reason_code, "blocked_missing_verified_person");
});

Deno.test("a decided namespaced no_match is respected over a stale legacy array", () => {
  // A newer authoritative rejection outranks an older stored success.
  const r = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: stage({ status: "no_match" }),
    legacyDecisionMakers: [legacyVerified()],
  });
  assertEquals(r.status, "missing");
  assertEquals(r.source, "none");
});

Deno.test("absent state on both sides returns missing", () => {
  const r = resolveVerifiedDecisionMakerForOutreach({});
  assertEquals(r.status, "missing");
});
