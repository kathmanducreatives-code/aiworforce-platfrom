// Provider-free tests for the jobs → SignalEvent adapter.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyGtmRole, normalizeListingStatus, jobRecordToSignalEvent,
  JOBS_ACTOR_KEY, JOBS_ACTOR_ID, type NormalizedJobLike,
} from "../../functions/_shared/jobsSignalAdapter.ts";
import { evidenceCategoryForSignalType, validateSignalEvent } from "../../functions/_shared/signalEvent.ts";
import { getActorByKey } from "../../functions/_shared/actorRegistry.ts";

const NOW = "2026-07-17T12:00:00.000Z";
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86400_000).toISOString();
const job = (over: Partial<NormalizedJobLike> = {}): NormalizedJobLike => ({
  company: "Acme SaaS", jobTitle: "Account Executive",
  linkedinUrl: "https://www.linkedin.com/company/acme-saas",
  jobUrl: "https://www.linkedin.com/jobs/view/123", postedAt: daysAgo(10), raw: {}, ...over,
});

// (1)(2) canonical actor reused, not invented
Deno.test("1/2: adapter binds the canonical registry jobs actor (no new actor)", () => {
  assertEquals(JOBS_ACTOR_KEY, "apify_jobs");
  assertEquals(JOBS_ACTOR_ID, "curious_coder/linkedin-jobs-scraper");
  const reg = getActorByKey("apify_jobs");
  assert(reg, "apify_jobs must exist in ACTOR_REGISTRY");
  assertEquals(reg!.actor_id, JOBS_ACTOR_ID);
});

// (3)(4)(5)(6) title classification
Deno.test("3/4/5/6: title classification maps GTM families; unrelated ⇒ null", () => {
  assertEquals(classifyGtmRole("Account Executive"), "sales_hiring");
  assertEquals(classifyGtmRole("Head of Sales"), "sales_hiring");
  assertEquals(classifyGtmRole("Revenue Operations Manager"), "revops_hiring");
  assertEquals(classifyGtmRole("Sales Operations Lead"), "revops_hiring");   // RevOps wins over sales
  assertEquals(classifyGtmRole("Head of Growth"), "growth_hiring");
  assertEquals(classifyGtmRole("Demand Generation Manager"), "growth_hiring");
  // unrelated roles never become GTM hiring
  assertEquals(classifyGtmRole("Senior Backend Engineer"), null);
  assertEquals(classifyGtmRole("Registered Nurse"), null);
  assertEquals(classifyGtmRole(""), null);
});

Deno.test("3b: sales/revops/growth map to job_signal category", () => {
  for (const t of ["sales_hiring", "revops_hiring", "growth_hiring"] as const) {
    assertEquals(evidenceCategoryForSignalType(t), "job_signal");
  }
});

// (7)(8)(9) occurred_at behavior
Deno.test("7/8: occurred_at comes from postedAt; observed_at is the runtime clock", () => {
  const r = jobRecordToSignalEvent({ job: job({ postedAt: daysAgo(10) }), workspace_id: "ws", company_ref: "li:acme", observedAt: NOW });
  assert(r.signal);
  assertEquals(r.signal!.occurred_at, new Date(Date.parse(daysAgo(10))).toISOString());
  assertEquals(r.signal!.observed_at, NOW);
});

Deno.test("9: a job with no verifiable posting date cannot become a signal", () => {
  assertEquals(jobRecordToSignalEvent({ job: job({ postedAt: null }), workspace_id: "ws", company_ref: "li:acme", observedAt: NOW }).reason, "missing_occurred_at");
  assertEquals(jobRecordToSignalEvent({ job: job({ postedAt: "not-a-date" }), workspace_id: "ws", company_ref: "li:acme", observedAt: NOW }).reason, "missing_occurred_at");
});

// (10)(11)(12)(13) listing status
Deno.test("10/13: active requires positive source evidence; default is unknown", () => {
  assertEquals(normalizeListingStatus({ raw: {} }), "unknown");                 // absence ≠ active
  assertEquals(normalizeListingStatus({ raw: { active: true } }), "active");
  assertEquals(normalizeListingStatus({ raw: { status: "Actively hiring" } }), "active");
});

Deno.test("11/12: closed and expired are recognized from source status", () => {
  assertEquals(normalizeListingStatus({ raw: { closed: true } }), "closed");
  assertEquals(normalizeListingStatus({ raw: { status: "Position filled" } }), "closed");
  assertEquals(normalizeListingStatus({ raw: { expired: true } }), "expired");
  assertEquals(normalizeListingStatus({ raw: { status: "expired" } }), "expired");
});

// sanitization: no raw payload / PII on the signal
Deno.test("adapter output passes canonical signal validation and carries no raw payload", () => {
  const r = jobRecordToSignalEvent({ job: job({ raw: { email: "recruiter@acme.com", phone: "+1 415 555 0199", secret: "x" } }), workspace_id: "ws", company_ref: "li:acme", observedAt: NOW });
  assert(r.signal);
  assertEquals(validateSignalEvent(r.signal!).valid, true);
  const blob = JSON.stringify(r.signal);
  assert(!/recruiter@acme\.com|415 555 0199|"raw"|provider_payload/.test(blob), "leaked raw/PII");
  assertEquals(r.signal!.actor_key, JOBS_ACTOR_KEY);
  assertEquals(r.signal!.actor_id, JOBS_ACTOR_ID);
  assertEquals(r.signal!.verification, "provider_verified");
});

Deno.test("6b: an unrelated role is rejected (not_gtm_hiring), never a fabricated signal", () => {
  const r = jobRecordToSignalEvent({ job: job({ jobTitle: "Backend Engineer" }), workspace_id: "ws", company_ref: "li:acme", observedAt: NOW });
  assertEquals(r.rejected, true);
  assertEquals(r.reason, "not_gtm_hiring");
  assertEquals(r.signal, null);
});
