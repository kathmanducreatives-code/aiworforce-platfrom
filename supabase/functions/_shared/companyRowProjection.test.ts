// Unit tests for the company-row projection — pure, no DB.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCompanyRowPersistencePlan, companyRowStage, companyRowKey } from "./companyRowProjection.ts";
import { resolveCompanyIdentity } from "./companyIdentity.ts";
import type { PendingDecisionMaker } from "./compoundSourcingPipeline.ts";

const strong = resolveCompanyIdentity({ name: "Vanta", domain: "vanta.com", location: "San Francisco, United States" });
const weak = resolveCompanyIdentity({ name: "Mystery Co" });

const job = {
  title: "Sales Operations Manager", company: "Vanta", companyDomain: "vanta.com",
  location: "San Francisco, United States", url: "https://j/vanta-1", postedDate: "2026-07-20T00:00:00Z",
};

function pending(over: Partial<PendingDecisionMaker> = {}): PendingDecisionMaker {
  return { company: strong, reason: "no_decision_maker_returned", jobEvidence: job, brainGate: "pass", ...over };
}

Deno.test("an identified company becomes a persistable account-stage row", () => {
  const plan = buildCompanyRowPersistencePlan(pending(), "ws-1");
  assertEquals(plan.persistable, true);
  assertEquals(plan.leadCandidate.lead_type, "account");
  assertEquals(plan.account?.domain, "vanta.com");
  assertEquals(plan.contact, null);
  assertEquals(plan.leadCandidate.raw.hiring_signal_url, "https://j/vanta-1");
  assertEquals(plan.leadCandidate.raw.company_brain_status, "qualified");
});

Deno.test("an unidentified company is never written as a Workbench row", () => {
  const plan = buildCompanyRowPersistencePlan(pending({ company: weak, reason: "company_identity_insufficient_for_scoped_search" }), "ws-1");
  assertEquals(plan.persistable, false);
  assertEquals(plan.account, null);
  assertEquals(plan.persistenceReason, "company_identity_unresolved");
});

Deno.test("a company row is never CONTACT and never quota-eligible", () => {
  for (const reason of ["no_decision_maker_returned", "decision_maker_unverified", "company_identity_insufficient_for_scoped_search"] as const) {
    const plan = buildCompanyRowPersistencePlan(pending({ reason }), "ws-1");
    assert(plan.verdict !== "CONTACT");
    assertEquals(plan.contactBlocked, true);
    assertEquals(plan.leadCandidate.raw.quota_eligible, false);
  }
});

Deno.test("stage reflects the strongest established fact", () => {
  assertEquals(companyRowStage(pending({ reason: "company_identity_insufficient_for_scoped_search" })), "company_resolution_pending");
  assertEquals(companyRowStage(pending({ brainGate: "unknown" })), "company_qualification_pending");
  assertEquals(companyRowStage(pending({ reason: "decision_maker_unverified" })), "decision_maker_unverified");
  assertEquals(companyRowStage(pending()), "decision_maker_search_pending");
});

Deno.test("company row key is stable and non-empty for an identified company", () => {
  assertEquals(companyRowKey(pending()), (strong.dedupeKey ?? "").toLowerCase());
  assert(companyRowKey(pending()).length > 0);
});
