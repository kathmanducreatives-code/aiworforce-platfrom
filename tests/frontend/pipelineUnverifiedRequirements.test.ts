// ATLAS SHOWS AN UNESTABLISHED REQUIREMENT AS UNVERIFIED — NOT MET, NOT FAILED.
//
// "Only include verified B2B companies": no discovery provider establishes a business
// model, so the shared engine records `business_model: unknown` and the lead is
// written `new`, not `qualified`. The lead library now surfaces those requirements
// (`qualification.unverifiedRequirements`, "Needs verification" in the drawer) and
// marks the lead for review. A preference ("US B2B companies") is never a check, so
// it is never shown as met or failed. Verified company identity and hiring, and the
// contact's own role verification, stay separate statuses.
//
// PURE.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contactIsVerified, pipelineUnverifiedRequirements } from "../../src/lib/leadLibrary/contactVerification.ts";

const leadRaw = (checks: { dimension: string; result: string }[]) => ({
  agentory_pipeline: { qualification: { checks: checks.map((c) => ({ criterion_id: `${c.dimension}:x`, ...c })), gaps: checks.filter((c) => c.result === "unknown").map((c) => c.dimension) } },
});

Deno.test("a required B2B with no evidence is listed as needing verification", () => {
  const raw = leadRaw([{ dimension: "business_model", result: "unknown" }, { dimension: "geography", result: "pass" }, { dimension: "hiring", result: "pass" }]);
  assertEquals(pipelineUnverifiedRequirements(raw), ["business_model"]);
});

Deno.test("proven identity and hiring are not 'unverified'; a preference is never a check", () => {
  const raw = leadRaw([{ dimension: "geography", result: "pass" }, { dimension: "hiring", result: "pass" }]);
  assertEquals(pipelineUnverifiedRequirements(raw), [], "B2B as a preference does not appear at all");
});

Deno.test("rows the pipeline did not write, and malformed rows, show nothing", () => {
  for (const raw of [null, undefined, {}, { agentory_pipeline: {} }, { agentory_pipeline: { qualification: { checks: "x" } } }, "text"]) {
    assertEquals(pipelineUnverifiedRequirements(raw), []);
  }
});

Deno.test("a contact is still verified only by the pipeline's own role verification — never by a URL or email", () => {
  const unverifiedContact = { email: "person@company.example", linkedin_url: "https://www.linkedin.com/in/someone",
    raw: { agentory_pipeline: { verification: { status: "requires_role_verification" } } } };
  assert(!contactIsVerified(unverifiedContact), "a LinkedIn URL and an email prove nothing about role or employment");
  assert(contactIsVerified({ ...unverifiedContact, raw: { agentory_pipeline: { verification: { status: "verified" } } } }));
});
