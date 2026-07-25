// SANITIZED fixture from live TEST run `lead-quality-sales-ops-us-20260725T150059Z`
// (task 51f0bef1, run-agent v95, isolated QA workspace).
//
// Contains only: the request sentence, the expected COMPILED provider inputs, and
// the public company/job-title strings the unfiltered search returned. No personal
// data, no emails, no phone numbers, no provider payloads, no run/tracking ids,
// no credentials.
//
// What the run showed: the runtime sent the whole sentence as LinkedIn keywords,
// so 25 unrelated postings came back and every one was correctly rejected by the
// job-family gate — 0 qualified companies.

export const LIVE_RUN_REGRESSION = {
  run_id: "lead-quality-sales-ops-us-20260725T150059Z",
  request: "Founders of SaaS startups hiring Sales Operations in the United States",

  /** BEFORE — what actually reached the provider (the defect). */
  defective_provider_input: {
    query: "Founders of SaaS startups hiring Sales Operations in the United States",
    max_results: 25,
  },

  /** AFTER — role-focused and location-aware, sharing one result ceiling. */
  expected_provider_inputs: [
    { keywords: "Sales Operations", location: "United States" },
    { keywords: "Revenue Operations", location: "United States" },
    { keywords: "GTM Operations", location: "United States" },
  ],

  /** Public job titles the unfiltered search returned; all must fail the gate. */
  rejected_job_titles: [
    "Customer Service Representative - Remote",
    "Account Executive",
    "Registered Nurse",
    "Software Engineer",
    "Warehouse Associate",
  ],

  /** Public company names that must NOT become leads without qualification. */
  rejected_company_names: [
    "Sundayy", "Careerscape", "Talent Bridge Dominicana", "Hired", "Handshake",
  ],

  observed: { rawJobs: 25, verifiedCompanies: 0, candidates: 0, persistedByPlan: 0, providerSideWrites: 20 },
} as const;
