// THE PAYLOAD SENT MUST BE THE PAYLOAD COMPILED.
//
// Production task 2425ec4f-7d8c-4a05-8c93-597b051db10b (2026-07-30) resolved the
// Crawlworks LinkedIn actor correctly, compiled a correct Crawlworks-native
// payload, and then sent a Curious-Coder payload instead. Apify replied
// "Input is not valid: Field input.jobsToFetch is required".
//
// Both fixtures below are verbatim production evidence: the compiled input from
// `tool_calls.input_json.input`, and the key set Apify actually received from
// `tool_calls.output_json.payload_keys`.
//
// OFFLINE ONLY. No provider, no model, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateFinalActorPayload, finalPayloadDiagnostics, isValidatedCapability,
  FINAL_PAYLOAD_VALIDATOR_VERSION,
} from "../../functions/_shared/finalActorPayload.ts";

/** Verbatim from production `tool_calls.input_json.input` — the CORRECT payload. */
const COMPILED_CRAWLWORKS = {
  query: "Sales Operations OR Revenue Operations OR GTM Operations",
  hybrid: false, onSite: true, remote: false, fullTime: true,
  location: "United States", jobsToFetch: 18,
  timePostedRange: "", enrichCompanyDetails: true,
};

/** Verbatim from production `tool_calls.output_json.payload_keys` — what Apify got. */
const CURIOUS_CODER_LEAK = {
  urls: ["https://www.linkedin.com/jobs/search/?keywords=Sales+Operations"],
  count: 25, scrapeCompany: true, useIncognitoMode: false, splitByLocation: false,
};

/** Verbatim from production — the Indeed payload that succeeded. */
const COMPILED_INDEED = {
  query: "Sales Operations OR Revenue Operations OR GTM Operations",
  country: "US", jobType: "", location: "United States",
  maxItems: 27, datePosted: "", includeDescription: true,
};

// ============================== 22. the compiled payload is accepted =========

Deno.test("21./22. the correct Crawlworks payload passes final validation", () => {
  const v = validateFinalActorPayload("linkedin_job_discovery", COMPILED_CRAWLWORKS);
  assert(v.ok, v.violations.join(","));
  assertEquals(v.actorId, "crawlworks/linkedin-jobs-scraper");
  assertEquals(v.schemaVerifiedOn, "official:2026-07-30");
  assertEquals(v.violations, []);
});

Deno.test("20. the correct Indeed payload passes final validation", () => {
  const v = validateFinalActorPayload("indeed_job_discovery", COMPILED_INDEED);
  assert(v.ok, v.violations.join(","));
  assertEquals(v.actorId, "automation-lab/indeed-scraper");
});

// ==================== 3./22./26. the production failure is caught locally ====

Deno.test("3./26. the Curious-Coder leak is rejected before Apify is called", () => {
  const v = validateFinalActorPayload("linkedin_job_discovery", CURIOUS_CODER_LEAK);
  assertFalse(v.ok, "the exact production payload must not be sendable");
  // The missing field Apify itself named.
  assert(v.violations.includes("missing_required:jobsToFetch"), v.violations.join(","));
  // And the positive signal that another vendor's serializer produced it.
  assert(v.violations.some((x) => x.startsWith("foreign_serializer_key:")), v.violations.join(","));
  for (const k of ["urls", "count", "scrapeCompany", "useIncognitoMode", "splitByLocation"]) {
    assert(v.violations.includes(`foreign_serializer_key:${k}`), `${k} not flagged`);
  }
});

Deno.test("29. the same titles compiled for a different capability do not collide", () => {
  // Indeed's payload is invalid FOR CRAWLWORKS and vice versa, even though both
  // carry the identical `query`. The capability, not the query, decides.
  assertFalse(validateFinalActorPayload("linkedin_job_discovery", COMPILED_INDEED).ok);
  assertFalse(validateFinalActorPayload("indeed_job_discovery", COMPILED_CRAWLWORKS).ok);
  const crossed = validateFinalActorPayload("indeed_job_discovery", COMPILED_CRAWLWORKS);
  assert(crossed.violations.includes("foreign_serializer_key:jobsToFetch"));
});

Deno.test("4./27. a payload missing every required field is rejected", () => {
  const v = validateFinalActorPayload("linkedin_job_discovery", {});
  assertFalse(v.ok);
  assert(v.violations.includes("empty_payload"));
  assert(v.violations.includes("missing_required_any_of:searchUrls|query"));
  assert(v.violations.includes("missing_required:jobsToFetch"));
  // Non-objects are rejected too, not coerced.
  assertFalse(validateFinalActorPayload("linkedin_job_discovery", null).ok);
  assertFalse(validateFinalActorPayload("linkedin_job_discovery", ["query"]).ok);
});

Deno.test("Crawlworks accepts searchUrls as the alternative to query", () => {
  const v = validateFinalActorPayload("linkedin_job_discovery", {
    searchUrls: ["https://www.linkedin.com/jobs/search/?keywords=Revenue+Operations"],
    jobsToFetch: 20,
  });
  assert(v.ok, v.violations.join(","));
});

// ------------------------------- legacy paths stay untouched -----------------

Deno.test("an unknown capability passes — legacy apify_jobs is unaffected", () => {
  const v = validateFinalActorPayload(null, CURIOUS_CODER_LEAK);
  assert(v.ok, "the legacy jobs workflow must not be validated by this gate");
  assertEquals(v.actorId, null);
  assertEquals(v.schemaVerifiedOn, null);
  // Still reports the key names for the audit trail.
  assert(v.payloadKeys.includes("scrapeCompany"));
  assert(validateFinalActorPayload("apify_jobs", CURIOUS_CODER_LEAK).ok);
  assertFalse(isValidatedCapability("apify_jobs"));
});

Deno.test("every dynamic capability has a rule, and Glassdoor is covered", () => {
  for (const cap of [
    "indeed_job_discovery", "linkedin_job_discovery", "glassdoor_job_discovery",
    "yc_job_discovery", "ats_job_verification",
  ]) {
    assert(isValidatedCapability(cap), `${cap} has no rule`);
  }
  // Glassdoor shares `source_type: "jobs"` with Crawlworks, so it was on course to
  // fail identically. The same leak is caught for it.
  const v = validateFinalActorPayload("glassdoor_job_discovery", CURIOUS_CODER_LEAK);
  assertFalse(v.ok);
  assert(v.violations.some((x) => x.startsWith("foreign_serializer_key:")));
});

// ------------------------------------------ diagnostics are safe ------------

Deno.test("diagnostics carry key names and codes only — no values, no secrets", () => {
  const d = finalPayloadDiagnostics(validateFinalActorPayload("linkedin_job_discovery", COMPILED_CRAWLWORKS));
  assertEquals(d.final_schema_validation, "passed");
  assertEquals(d.validator_version, FINAL_PAYLOAD_VALIDATOR_VERSION);
  assertEquals(d.capability_key, "linkedin_job_discovery");

  const blob = JSON.stringify(d).toLowerCase();
  // The compiled query VALUE must not travel in diagnostics — only its key.
  assertFalse(blob.includes("sales operations or revenue"));
  for (const forbidden of ["apify_api_token", "bearer ", "authorization"]) {
    assertFalse(blob.includes(forbidden), `${forbidden} leaked`);
  }
  assert((d.final_payload_keys as string[]).includes("jobsToFetch"));
});
