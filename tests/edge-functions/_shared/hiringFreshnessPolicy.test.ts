// Provider-free tests for the APPROVED hiring (job_signal) freshness policy.
// Every clock is injected; no network, no provider.
//
// Regression anchor: the foundation shipped with job_signal at a 72h contract window
// while the SignalEvent policy allowed sales_hiring for 60 days — the same
// contract-vs-policy divergence funding had. A verified sales role posted 10 days ago
// was treated as stale despite being plainly current hiring intent.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadEntityIntent } from "../../supabase/functions/_shared/leadEntityIntent.ts";
import { compileEvidenceContract } from "../../supabase/functions/_shared/evidenceContract.ts";
import { compileTimingRequirement, evaluateTimingSufficiency } from "../../supabase/functions/_shared/timingAssessment.ts";
import { assessSignalStrength } from "../../supabase/functions/_shared/signalFreshness.ts";
import type { SignalEvent } from "../../supabase/functions/_shared/signalEvent.ts";
import {
  jobBandForAgeDays, jobBandSatisfiesAlone, listingStatusIsDead, resolveWindowHours,
  CANONICAL_TIMING_WINDOW_HOURS, JOB_MAX_AGE_DAYS, JOB_DEFAULT_REQUIREMENT_DAYS,
  FUNDING_MAX_AGE_DAYS, DAYS,
} from "../../supabase/functions/_shared/timingFreshnessPolicy.ts";

const NOW = "2026-07-17T12:00:00.000Z";
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 24 * 3600_000).toISOString();
const BRAIN = { industries: ["B2B SaaS"], geography: "United States", company_size: "10-150 employees" };

const reqFor = (text: string) => compileTimingRequirement(compileEvidenceContract(compileLeadEntityIntent(text), BRAIN));
const assess = (text: string, signals: SignalEvent[]) =>
  evaluateTimingSufficiency({ candidateId: "c1", requirement: reqFor(text), signals, now: NOW });

/** A provider-verified sales role posted `d` days ago. */
const hiring = (d: number, o: Partial<SignalEvent> = {}): SignalEvent => ({
  signal_id: "h1", workspace_id: "w1",
  signal_type: "sales_hiring", signal_category: "gtm",
  company_ref: "co_acme",
  evidence_refs: [{ category: "job_signal", sourceType: "apify_actor", sourceUrl: "https://x.test/j/1", confidence: "high" }],
  occurred_at: daysAgo(d), observed_at: NOW,
  confidence: "high", verification: "provider_verified",
  dedupe_key: "", status: "active", sanitized: true,
  ...o,
});

const funding = (d: number): SignalEvent => ({
  signal_id: "f1", workspace_id: "w1",
  signal_type: "recent_funding", signal_category: "growth",
  company_ref: "co_acme",
  evidence_refs: [{ category: "funding_signal", sourceType: "public_web", sourceUrl: "https://acme.test/news", confidence: "high" }],
  occurred_at: daysAgo(d), observed_at: NOW,
  confidence: "high", verification: "provider_verified",
  dedupe_key: "", status: "active", sanitized: true,
});

// ---- bands ----
Deno.test("hiring decay bands: 0-7 strong · 8-30 medium · 31-60 weak_supporting · >60 stale", () => {
  assertEquals(jobBandForAgeDays(0), "strong");
  assertEquals(jobBandForAgeDays(7), "strong");
  assertEquals(jobBandForAgeDays(8), "medium");
  assertEquals(jobBandForAgeDays(30), "medium");
  assertEquals(jobBandForAgeDays(31), "weak_supporting");
  assertEquals(jobBandForAgeDays(60), "weak_supporting");
  assertEquals(jobBandForAgeDays(61), "stale");
  assertEquals(jobBandSatisfiesAlone("strong"), true);
  assertEquals(jobBandSatisfiesAlone("medium"), true);
  assertEquals(jobBandSatisfiesAlone("weak_supporting"), false);
  assertEquals(jobBandSatisfiesAlone("stale"), false);
});

// ---- (1) strong ----
Deno.test("1: hiring posted 2 days ago is strong", () => {
  const r = assessSignalStrength(hiring(2), NOW);
  assertEquals(r.freshness_band, "strong");
  assertEquals(r.strength, "strong");
  assertEquals(r.reason, "job_band_strong");
  assertEquals(r.age_days, 2);
});

// ---- (2)(3) "hiring this week" = 7 days ----
Deno.test("2: hiring posted 6 days ago satisfies 'hiring this week'", () => {
  const r = reqFor("Find B2B SaaS founders hiring sales this week");
  assertEquals(r.maxAgeHoursByCategory.job_signal, DAYS(7));
  const a = assess("Find B2B SaaS founders hiring sales this week", [hiring(6)]);
  assertEquals(a.decision, "timing_sufficient");
  assertEquals(a.signal_breakdown[0].satisfied, true);
  assertEquals(a.signal_breakdown[0].freshness_band, "strong");
});

Deno.test("3: hiring posted 10 days ago does NOT satisfy 'hiring this week'", () => {
  const a = assess("Find B2B SaaS founders hiring sales this week", [hiring(10)]);
  assertEquals(a.decision, "missing_timing_evidence");
  assertEquals(a.stale_signal_ids, ["h1"]);
  assertEquals(a.signal_breakdown[0].applied_window_hours, DAYS(7), "the explicit 7d window wins");
});

// ---- (4)(5)(6) "currently hiring" = 30 days (the default) ----
Deno.test("4: hiring posted 10 days ago satisfies 'currently hiring' — the divergence this fixes", () => {
  const r = reqFor("Find B2B SaaS companies currently hiring sales people");
  assertEquals(r.maxAgeHoursByCategory.job_signal, DAYS(30), "was 72h; a 10-day-old role was wrongly stale");
  const a = assess("Find B2B SaaS companies currently hiring sales people", [hiring(10)]);
  assertEquals(a.decision, "timing_sufficient");
  assertEquals(a.signal_breakdown[0].freshness_band, "medium");
  assertEquals(a.signal_breakdown[0].satisfied, true);
});

Deno.test("5: hiring posted 29 days ago satisfies 'currently hiring'", () => {
  const a = assess("Find B2B SaaS companies currently hiring sales people", [hiring(29)]);
  assertEquals(a.decision, "timing_sufficient");
  assertEquals(a.signal_breakdown[0].freshness_band, "medium");
});

Deno.test("6: hiring posted 31 days ago does not independently satisfy the default 'currently hiring'", () => {
  const a = assess("Find B2B SaaS companies currently hiring sales people", [hiring(31)]);
  assertEquals(a.decision, "missing_timing_evidence");
  assertEquals(a.next_action, "signal_enrichment");
  assertEquals(a.signal_breakdown[0].stale, true, "outside the 30d default requirement window");
});

Deno.test("'recently hiring' means 30 days, not funding's 90", () => {
  const r = reqFor("Find B2B SaaS founders recently hiring sales people");
  assertEquals(r.maxAgeHoursByCategory.job_signal, DAYS(30));
  assertEquals(assess("Find B2B SaaS founders recently hiring sales people", [hiring(20)]).decision, "timing_sufficient");
  assertEquals(assess("Find B2B SaaS founders recently hiring sales people", [hiring(45)]).decision, "missing_timing_evidence");
});

// ---- (7)(8) weak_supporting + explicit 60-day window ----
Deno.test("7: hiring posted 45 days ago is weak_supporting", () => {
  const r = assessSignalStrength(hiring(45), NOW);
  assertEquals(r.freshness_band, "weak_supporting");
  assertEquals(r.strength, "weak");
  assertEquals(r.reason, "job_band_weak_supporting");
});

Deno.test("8: hiring posted 45 days ago satisfies an explicit 'last 60 days' requirement", () => {
  const r = reqFor("Find B2B SaaS founders hiring sales in the last 60 days");
  assertEquals(r.explicitWindow, "last_60_days");
  assertEquals(r.maxAgeHoursByCategory.job_signal, DAYS(60), "the user widened to the retention ceiling");
  const a = assess("Find B2B SaaS founders hiring sales in the last 60 days", [hiring(45)]);
  assertEquals(a.decision, "timing_sufficient", "the user declared 60 days acceptable");
  assertEquals(a.signal_breakdown[0].freshness_band, "weak_supporting");
  assertEquals(a.signal_breakdown[0].satisfied, true);
});

// ---- (9) stale ----
Deno.test("9: hiring posted 61 days ago is stale", () => {
  const r = assessSignalStrength(hiring(61), NOW);
  assertEquals(r.freshness_band, "stale");
  assertEquals(r.strength, "none");
  assertEquals(r.fresh, false);
  // Even an explicit 60-day request cannot resurrect it.
  const a = assess("Find B2B SaaS founders hiring sales in the last 60 days", [hiring(61)]);
  assertEquals(a.decision, "missing_timing_evidence");
});

// ---- (10)(11)(12) listing status ----
Deno.test("10: a verified CLOSED listing is stale even when posted yesterday", () => {
  const closed = assessSignalStrength(hiring(1, { listing_status: "closed" }), NOW);
  assertEquals(closed.strength, "none");
  assertEquals(closed.reason, "listing_closed");
  assertEquals(closed.fresh, false);
  assertEquals(closed.freshness_band, "stale", "age never overrides a verified closed status");

  const expired = assessSignalStrength(hiring(1, { listing_status: "expired" }), NOW);
  assertEquals(expired.strength, "none");
  assertEquals(expired.reason, "listing_closed");

  const a = assess("Find B2B SaaS companies currently hiring sales people", [hiring(1, { listing_status: "closed" })]);
  assertEquals(a.decision, "missing_timing_evidence");
  assertEquals(a.signal_breakdown[0].listing_status, "closed");

  assertEquals(listingStatusIsDead("closed"), true);
  assertEquals(listingStatusIsDead("expired"), true);
  assertEquals(listingStatusIsDead("active"), false);
  assertEquals(listingStatusIsDead("unknown"), false);
});

Deno.test("11: a verified ACTIVE listing is represented truthfully", () => {
  const r = assessSignalStrength(hiring(2, { listing_status: "active" }), NOW);
  assertEquals(r.listing_status, "active");
  assertEquals(r.strength, "strong");
  const a = assess("Find B2B SaaS companies currently hiring sales people", [hiring(2, { listing_status: "active" })]);
  assertEquals(a.decision, "timing_sufficient");
  assertEquals(a.signal_breakdown[0].listing_status, "active");
});

Deno.test("12: unknown listing status relies only on occurred_at", () => {
  // Unknown ⇒ the band alone decides; it neither strengthens nor kills the signal.
  const unknown = assessSignalStrength(hiring(2, { listing_status: "unknown" }), NOW);
  const absent = assessSignalStrength(hiring(2), NOW);
  assertEquals(unknown.strength, absent.strength);
  assertEquals(unknown.freshness_band, absent.freshness_band);
  // An old role with unknown status is still stale by age.
  assertEquals(assessSignalStrength(hiring(61, { listing_status: "unknown" }), NOW).freshness_band, "stale");
});

// ---- (13) observed_at never refreshes ----
Deno.test("13: observed_at never refreshes an old hiring event", () => {
  const scrapedToday = hiring(90, { observed_at: NOW });
  const r = assessSignalStrength(scrapedToday, NOW);
  assertEquals(r.age_days, 90, "age is measured from occurred_at");
  assertEquals(r.freshness_band, "stale");
  assertEquals(r.strength, "none");
  const a = assess("Find B2B SaaS companies currently hiring sales people", [scrapedToday]);
  assertEquals(a.decision, "missing_timing_evidence");
});

// ---- (14)(15)(16) combination ----
Deno.test("14: funding 120 days ago + hiring 10 days ago satisfies the approved combination", () => {
  const a = assess("find me hot founders right now", [funding(120), hiring(10)]);
  assertEquals(a.decision, "timing_sufficient");
  const f = a.signal_breakdown.find((b) => b.signal_id === "f1")!;
  const h = a.signal_breakdown.find((b) => b.signal_id === "h1")!;
  assertEquals(f.freshness_band, "weak_supporting");
  assertEquals(f.supporting_only, true, "aged funding contributes as support");
  assertEquals(h.freshness_band, "medium");
  assertEquals(h.satisfied, true, "the current hiring signal carries the combination");
  assertEquals(a.supporting_signal_ids, ["f1"]);
});

Deno.test("15: funding 120 days ago alone remains insufficient for hot_opportunity", () => {
  const a = assess("find me hot founders right now", [funding(120)]);
  assertEquals(a.decision, "missing_timing_evidence");
  assertEquals(a.next_action, "signal_enrichment");
});

Deno.test("16: funding 120d + hiring 45d does NOT automatically become sufficient", () => {
  // Neither event is current. Two not-current events must never combine into
  // fabricated urgency — a combination needs at least one genuinely CURRENT signal.
  const a = assess("find me hot founders right now", [funding(120), hiring(45)]);
  assertEquals(a.decision, "missing_timing_evidence");
  assertEquals(a.next_action, "signal_enrichment");
  for (const b of a.signal_breakdown) assertEquals(b.satisfied, false);

  // The two are excluded at DIFFERENT layers, and the breakdown says which:
  //  - funding 120d is inside its 180d window but age-degraded ⇒ support only
  //  - hiring 45d is outside the hot request's 30d default window ⇒ stale here
  //    (it is weak_supporting by RETENTION, which an explicit "last 60 days" would use)
  const f = a.signal_breakdown.find((b) => b.signal_id === "f1")!;
  const h = a.signal_breakdown.find((b) => b.signal_id === "h1")!;
  assertEquals(f.freshness_band, "weak_supporting");
  assertEquals(f.supporting_only, true);
  assertEquals(f.stale, false);
  assertEquals(h.stale, true);
  assertEquals(h.applied_window_hours, DAYS(30));
  assertEquals(a.strongest, "weak");
});

Deno.test("two AGE-DEGRADED weak signals never stack into hot, even inside their windows", () => {
  // Both inside their own windows and both weak_supporting: funding 120d (180d window)
  // and hiring 45d under an explicit 60-day window. The explicit window authorizes the
  // hiring signal for a NAMED hiring request, but a bare "hot right now" states no
  // window, so neither may carry it and they must not stack.
  const a = assess("find me hot founders right now", [funding(120), funding(150)]);
  assertEquals(a.decision, "missing_timing_evidence", "two aged rounds are not urgency");
});

// ---- (17)(18)(19) window isolation ----
Deno.test("17/18/19: job and funding windows never cross-apply; any-of keeps type-specific windows", () => {
  const r = reqFor("find me hot founders right now");
  assertEquals(r.maxAgeHoursByCategory.job_signal, DAYS(JOB_DEFAULT_REQUIREMENT_DAYS));
  assertEquals(r.maxAgeHoursByCategory.funding_signal, DAYS(FUNDING_MAX_AGE_DAYS));
  assertEquals(r.maxAgeHoursByCategory.launch_signal, 168);
  assertEquals(r.maxAgeHoursByCategory.founder_activity_signal, 168);

  // A 40-day-old round is medium (funding's window), while a 40-day-old role is not.
  assertEquals(assessSignalStrength(funding(40), NOW).freshness_band, "medium");
  assertEquals(assessSignalStrength(hiring(40), NOW).freshness_band, "weak_supporting");

  assertEquals(CANONICAL_TIMING_WINDOW_HOURS.job_signal, DAYS(30));
  assertEquals(CANONICAL_TIMING_WINDOW_HOURS.funding_signal, DAYS(180));
});

// ---- (20)(21)(22) intent compilation ----
Deno.test("20: generic ICP discovery does not require hiring", () => {
  const r = reqFor("Find B2B SaaS founders in the United States");
  assertEquals(r.required, false);
  assertEquals(r.requiredCategories, []);
  assertEquals(assess("Find B2B SaaS founders in the United States", []).decision, "timing_not_required");
});

Deno.test("21: 'currently hiring sales' compiles a job_signal requirement", () => {
  const r = reqFor("Find B2B SaaS companies currently hiring sales people");
  assertEquals(r.required, true);
  assert(r.requiredCategories.includes("job_signal"));
  assertEquals(r.explicitWindow, null, "no explicit window ⇒ the 30d default applies");
});

Deno.test("22: 'hiring in the last 60 days' compiles the explicit 60-day window", () => {
  const intent = compileLeadEntityIntent("Find founders hiring sales in the last 60 days");
  assertEquals(intent.signals.find((s) => s.type === "hiring")?.window, "last_60_days");
  assert(intent.evidence_spans.some((e) => e.field === "signal_window" && e.value === "last_60_days"));
  const r = reqFor("Find founders hiring sales in the last 60 days");
  assertEquals(r.maxAgeHoursByCategory.job_signal, DAYS(60));
});

// ---- canonical authority ----
Deno.test("one authority resolves hiring windows; retention caps an over-wide request", () => {
  assertEquals(resolveWindowHours({ category: "job_signal", explicitWindow: null }), DAYS(30));
  assertEquals(resolveWindowHours({ category: "job_signal", explicitWindow: "this_week" }), DAYS(7));
  assertEquals(resolveWindowHours({ category: "job_signal", explicitWindow: "this_month" }), DAYS(30));
  assertEquals(resolveWindowHours({ category: "job_signal", explicitWindow: "recently" }), DAYS(30));
  assertEquals(resolveWindowHours({ category: "job_signal", explicitWindow: "last_60_days" }), DAYS(60));
  // Asking for 6 months of hiring is capped at the 60-day retention ceiling.
  assertEquals(resolveWindowHours({ category: "job_signal", explicitWindow: "last_6_months" }), DAYS(JOB_MAX_AGE_DAYS));
  // Funding is untouched by the hiring policy.
  assertEquals(resolveWindowHours({ category: "funding_signal", explicitWindow: "recently" }), DAYS(90));
  assertEquals(resolveWindowHours({ category: "funding_signal", explicitWindow: null }), DAYS(180));
});
