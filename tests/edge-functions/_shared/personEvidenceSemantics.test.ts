import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCanonicalStamp } from "../../../supabase/functions/_shared/leadCanonicalStamp.ts";
import { checkEvidenceInvariants, classifyEvidence, evidenceCategory } from "../../../supabase/functions/_shared/evidenceType.ts";
import { deriveCompanyIcp } from "../../../supabase/functions/_shared/companyBrainIcp.ts";

const icp = deriveCompanyIcp({ icp: { industries: ["B2B SaaS"], company_size: "10-150 employees", buyer_roles: ["Founder"] } });
const PERSON_URL = "https://www.linkedin.com/in/veraai";
const JOB_URL = "https://boards.greenhouse.io/acme/jobs/123";

// (9) Person LinkedIn URL is labeled person-profile evidence.
// THREE TESTS REMOVED in the Mission cutover. They covered
// `buildLeadAnalystSummary` in _shared/leadAnalyst.ts — the legacy analyst
// narrative generated inside run-agent's deleted legacy sourcing block. The
// evidence-semantics invariants below are unrelated to it and still apply.

Deno.test("person target: no profile_as_job violation for a person profile", () => {
  const s = buildCanonicalStamp({
    target_is_person: true,
    company: "VeraAI Technologies Inc.",
    source_url: PERSON_URL,
    job_title: "Co-Founder/COO",
    exact_hiring_signal: "Co-Founder/COO",
    signal_type: null,
    evidence_url: PERSON_URL,
    aria_overall_fit: 72,
    aria_confidence_score: 63,
  });
  assertEquals(s.run_trace.evidence_type, "person_profile");
  assert(!s.evidence_violations.includes("profile_as_job"), s.evidence_violations.join(","));
  assert(!s.evidence_violations.includes("title_as_signal"), s.evidence_violations.join(","));
});

// (13) identity_only_signal is still recorded honestly (auditable limitation).
Deno.test("person target: identity_only_signal remains an honest limitation", () => {
  const s = buildCanonicalStamp({
    target_is_person: true,
    company: "VeraAI Technologies Inc.",
    source_url: PERSON_URL,
    job_title: "Co-Founder/COO",
    evidence_url: PERSON_URL,
  });
  assert(s.evidence_violations.includes("identity_only_signal"), s.evidence_violations.join(","));
});

// Regression: company/role-family search (NOT person target) still flags a
// person profile misused as a hiring signal.
Deno.test("role-family search still flags profile_as_job for a misused profile", () => {
  const v = checkEvidenceInvariants({
    signal_evidence_type: "person_profile",
    signal_label: "hiring",
    requested_artifact_is_person: false,
  }).map((x) => x.code);
  assert(v.includes("profile_as_job"), v.join(","));
  assert(v.includes("identity_only_signal"), v.join(","));
});

// evidence categories keep identity, buying signal and job posting separate.
Deno.test("evidenceCategory separates identity / job / buying signals", () => {
  assertEquals(evidenceCategory(classifyEvidence({ url: PERSON_URL })), "person_identity");
  assertEquals(evidenceCategory(classifyEvidence({ url: JOB_URL })), "job_signal");
  assertEquals(evidenceCategory(classifyEvidence({ url: "https://techcrunch.com/2026/01/01/acme-raises-series-a" })), "buying_signal");
  assertEquals(evidenceCategory(classifyEvidence({ url: "https://www.linkedin.com/company/acme" })), "company_fit");
});
