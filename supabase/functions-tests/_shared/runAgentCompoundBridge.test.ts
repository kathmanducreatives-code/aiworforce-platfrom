import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isCompanyFirstRequest, compoundContactCeiling, clampToCeiling } from "../../functions/_shared/runAgentCompoundBridge.ts";
import { compileLeadEntityIntent } from "../../functions/_shared/leadEntityIntent.ts";

Deno.test("company-first detection", () => {
  assertEquals(isCompanyFirstRequest(compileLeadEntityIntent("Founders of SaaS startups hiring Sales Operations in the US")), true);
  assertEquals(isCompanyFirstRequest(compileLeadEntityIntent("Find founders in Austin")), false);
});

const base = { companyGateRequired: true, hasVerifiedAccount: true, employer: "verified_match" as const, jobEvidenceUrl: "https://j/1", personRoleMatch: true as const };

Deno.test("fully verified compound candidate may CONTACT", () => {
  assertEquals(compoundContactCeiling(base), "contact");
});
Deno.test("accountless compound candidate can never CONTACT", () => {
  assertEquals(compoundContactCeiling({ ...base, hasVerifiedAccount: false }), "needs_review");
});
Deno.test("off-company / historical employer → reject", () => {
  assertEquals(compoundContactCeiling({ ...base, employer: "verified_mismatch" }), "reject");
  assertEquals(compoundContactCeiling({ ...base, employer: "historical_only" }), "reject");
});
Deno.test("ambiguous / insufficient / unevaluated employer → needs_review", () => {
  assertEquals(compoundContactCeiling({ ...base, employer: "ambiguous" }), "needs_review");
  assertEquals(compoundContactCeiling({ ...base, employer: "insufficient_evidence" }), "needs_review");
  assertEquals(compoundContactCeiling({ ...base, employer: null }), "needs_review");
});
Deno.test("missing job evidence / wrong role → reject", () => {
  assertEquals(compoundContactCeiling({ ...base, jobEvidenceUrl: null }), "reject");
  assertEquals(compoundContactCeiling({ ...base, personRoleMatch: false }), "reject");
});
Deno.test("non-compound request is uncapped", () => {
  assertEquals(compoundContactCeiling({ ...base, companyGateRequired: false, hasVerifiedAccount: false }), "contact");
});
Deno.test("clampToCeiling never lets a score exceed the ceiling", () => {
  assertEquals(clampToCeiling("contact", "reject"), "reject");
  assertEquals(clampToCeiling("contact", "needs_review"), "needs_review");
  assertEquals(clampToCeiling("reject", "contact"), "reject"); // a lower proposal stays low
});
