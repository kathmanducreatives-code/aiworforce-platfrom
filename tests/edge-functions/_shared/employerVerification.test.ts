import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyCurrentEmployer, employerGateDisposition } from "../../../supabase/functions/_shared/employerVerification.ts";
import { resolveCompanyIdentity } from "../../../supabase/functions/_shared/companyIdentity.ts";

const acme = resolveCompanyIdentity({ name: "Acme", domain: "acme.com", linkedin_url: "https://linkedin.com/company/acme" });
const NOW = "2026-07-24T00:00:00Z";
const v = (p: Parameters<typeof verifyCurrentEmployer>[0]) => verifyCurrentEmployer(p, acme, { now: NOW }).outcome;

Deno.test("1. exact current match → verified_match", () => {
  assertEquals(v({ currentCompany: "Acme", currentCompanyDomain: "acme.com", isCurrent: true }), "verified_match");
});
Deno.test("2. domain-backed match → verified_match", () => {
  assertEquals(v({ currentCompany: "Acme HQ", currentCompanyDomain: "acme.com" }), "verified_match");
});
Deno.test("3. LinkedIn-company match → verified_match", () => {
  assertEquals(v({ currentCompanyLinkedinUrl: "https://www.linkedin.com/company/acme/", isCurrent: true }), "verified_match");
});
Deno.test("4. historical-only role → historical_only", () => {
  assertEquals(v({ currentCompany: "Acme", currentCompanyDomain: "acme.com", endDate: "2024-01-01" }), "historical_only");
});
Deno.test("5. similar name, no strong id → ambiguous", () => {
  assertEquals(v({ currentCompany: "Acme" }), "ambiguous");
});
Deno.test("6. conflicting current employer (strong) → verified_mismatch", () => {
  assertEquals(v({ currentCompany: "OtherCorp", currentCompanyDomain: "other.com" }), "verified_mismatch");
});
Deno.test("7. missing dates + no current marker (name only) → ambiguous", () => {
  assertEquals(v({ currentCompany: "Acme", title: "Founder" }), "ambiguous");
});
Deno.test("8. multiple current roles INCLUDING target → verified_match", () => {
  assertEquals(v({ currentCompany: "AdvisorCo", currentCompanyDomain: "advisor.com", otherCurrent: [{ name: "Acme", domain: "acme.com" }] }), "verified_match");
});
Deno.test("9. company alias with matching canonical domain → verified_match", () => {
  assertEquals(v({ currentCompany: "Acme Corporation", currentCompanyDomain: "acme.com" }), "verified_match");
});
Deno.test("10. person from another company → verified_mismatch", () => {
  assertEquals(v({ currentCompany: "Globex", currentCompanyDomain: "globex.com", isCurrent: true }), "verified_mismatch");
});
Deno.test("no evidence → insufficient_evidence", () => {
  assertEquals(v({}), "insufficient_evidence");
});
Deno.test("gate disposition maps outcomes correctly", () => {
  assertEquals(employerGateDisposition("verified_match"), "pass");
  assertEquals(employerGateDisposition("ambiguous"), "review");
  assertEquals(employerGateDisposition("insufficient_evidence"), "review");
  assertEquals(employerGateDisposition("historical_only"), "reject");
  assertEquals(employerGateDisposition("verified_mismatch"), "reject");
});
