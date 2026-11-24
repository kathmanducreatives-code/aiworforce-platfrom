// A COMPANY THE PIPELINE QUALIFIED DOES NOT MAKE ITS CONTACT A VERIFIED BUYER.
//
// S2 identity review (2026-11-01): LeadOcean returned "Co-founder" / "Principal
// Co-founder" contacts at two companies Apify verified. The company verdict is real;
// the person's role and current employment are the provider's claim. The lead library
// called any contact with a LinkedIn URL "verified", so these would have shown as
// contact-ready. A contact the pipeline wrote now follows the pipeline's own status
// (src/lib/leadLibrary/contactVerification.ts, used by canonicalLeadView.contactView).
//
// PURE.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contactIsVerified, pipelineRoleVerification } from "../../src/lib/leadLibrary/contactVerification.ts";
import { projectPipelineLead } from "../../supabase/functions/_shared/leadPipeline/projection.ts";

const pipelineContact = (status: string) => ({
  email: null, linkedin_url: "https://www.linkedin.com/in/synthetic-person",
  raw: { agentory_pipeline: { role_family_source: "provider_title_claim", verification: { status, employment: "provider_consistent", role: "provider_title_claim", sources: ["leadocean"] } } },
});

Deno.test("a pipeline contact with only a provider title is not verified, even with a LinkedIn URL", () => {
  assertEquals(contactIsVerified(pipelineContact("requires_role_verification")), false);
  assertEquals(contactIsVerified(pipelineContact("employment_mismatch")), false);
  assertEquals(contactIsVerified(pipelineContact("verified")), true, "only an independent verification counts");
});

Deno.test("contacts the pipeline did not write keep their existing rule", () => {
  assertEquals(contactIsVerified({ email: null, linkedin_url: "https://www.linkedin.com/in/x", raw: {} }), true);
  assertEquals(contactIsVerified({ email: "a@b.example", linkedin_url: null, raw: null }), true);
  assertEquals(contactIsVerified({ email: null, linkedin_url: null }), false);
  assertEquals(pipelineRoleVerification({}), null);
});

Deno.test("the ATLAS row the pipeline projects is read back as unverified", () => {
  const row = projectPipelineLead({
    version: "lead-pipeline-v1", leadKey: "k", existingLeadIds: [], icpId: "spec:x",
    company: { key: "k", name: "Harmony", domain: "harmony.example", linkedinUrl: "https://www.linkedin.com/company/harmony-one", providerCompanyIds: [], employeeCount: null, industry: [], hq: { country: "US", region: null, city: "Mountain View", source: "apify_linkedin_company_details" }, description: null },
    person: { key: "p", name: "Synthetic Person", title: "Co-founder", linkedinUrl: "https://www.linkedin.com/in/synthetic-person", providerPersonId: "1", roleFamily: "founder", hasPhoneFlag: null,
      verification: { employment: "provider_consistent", role: "provider_title_claim", status: "requires_role_verification", sources: ["leadocean"] } },
    statuses: { discovery: "new", screening: "passed", qualification: "eligible", enrichment: "not_requested", outreachReadiness: "not_ready" },
    screeningReasons: [], qualification: null, canonicalRecord: "read", signals: [],
    rank: { leadKey: "k", version: "lead-pipeline-ranking-v1", eligibility: "eligible", lane: "queue", score: 1, factors: [], explanation: "x" },
    phone: null, outreachBlockers: [], provenance: { walkId: "w", planHash: "h", runAt: "2026-11-01T00:00:00Z", providers: ["apify", "leadocean"] },
  } as never, { workspaceId: "ws", values: [] })!;
  assertEquals(row.lead_candidate.status, "qualified", "the company is qualified");
  assertEquals(row.lead_candidate.next_action, "verify_contact_role");
  assertEquals(contactIsVerified(row.contact!), false, "its contact is not a verified buyer");
});
