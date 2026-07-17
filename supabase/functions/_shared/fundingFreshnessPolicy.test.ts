// Provider-free tests for the APPROVED funding freshness policy.
// Every clock is injected; no network, no provider.
//
// Regression anchor: the foundation shipped with two silently conflicting tables —
// evidenceContract's funding window (168h) and the SignalEvent policy (180d). The
// contract won, so "find recently funded B2B SaaS founders" only matched companies
// funded in the last SEVEN DAYS. These tests pin the approved decay bands and the
// single canonical authority that replaced the conflict.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadEntityIntent } from "./leadEntityIntent.ts";
import { compileEvidenceContract } from "./evidenceContract.ts";
import { compileTimingRequirement, evaluateTimingSufficiency } from "./timingAssessment.ts";
import { assessSignalStrength } from "./signalFreshness.ts";
import type { SignalEvent } from "./signalEvent.ts";
import {
  fundingBandForAgeDays, fundingBandSatisfiesAlone, resolveWindowHours,
  CANONICAL_TIMING_WINDOW_HOURS, EXPLICIT_WINDOW_DAYS, FUNDING_MAX_AGE_DAYS, DAYS,
} from "./timingFreshnessPolicy.ts";

const NOW = "2026-07-17T12:00:00.000Z";
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 24 * 3600_000).toISOString();
const BRAIN = { industries: ["B2B SaaS"], geography: "United States", company_size: "10-150 employees" };

const reqFor = (text: string) => compileTimingRequirement(compileEvidenceContract(compileLeadEntityIntent(text), BRAIN));

/** A provider-verified funding event that occurred `d` days ago. */
const funding = (d: number, o: Partial<SignalEvent> = {}): SignalEvent => ({
  signal_id: "f1", workspace_id: "w1",
  signal_type: "recent_funding", signal_category: "growth",
  company_ref: "co_acme",
  evidence_refs: [{ category: "funding_signal", sourceType: "public_web", sourceUrl: "https://acme.test/news", confidence: "high" }],
  occurred_at: daysAgo(d), observed_at: NOW,
  confidence: "high", verification: "provider_verified",
  dedupe_key: "", status: "active", sanitized: true,
  ...o,
});

/** A fresh, provider-verified sales-hiring signal (a legitimate combination partner). */
const salesHiring = (d: number): SignalEvent => ({
  signal_id: "h1", workspace_id: "w1",
  signal_type: "sales_hiring", signal_category: "gtm",
  company_ref: "co_acme",
  evidence_refs: [{ category: "job_signal", sourceType: "apify_actor", sourceUrl: "https://x.test/j/1", confidence: "high" }],
  occurred_at: daysAgo(d), observed_at: NOW,
  confidence: "high", verification: "provider_verified",
  dedupe_key: "", status: "active", sanitized: true,
});

const assess = (text: string, signals: SignalEvent[]) =>
  evaluateTimingSufficiency({ candidateId: "c1", requirement: reqFor(text), signals, now: NOW });

// ---- decay bands ----
Deno.test("funding decay bands: 0-30 strong · 31-90 medium · 91-180 weak_supporting · >180 stale", () => {
  assertEquals(fundingBandForAgeDays(0), "strong");
  assertEquals(fundingBandForAgeDays(30), "strong");
  assertEquals(fundingBandForAgeDays(31), "medium");
  assertEquals(fundingBandForAgeDays(90), "medium");
  assertEquals(fundingBandForAgeDays(91), "weak_supporting");
  assertEquals(fundingBandForAgeDays(180), "weak_supporting");
  assertEquals(fundingBandForAgeDays(181), "stale");
  // Only strong/medium may satisfy a funding requirement alone.
  assertEquals(fundingBandSatisfiesAlone("strong"), true);
  assertEquals(fundingBandSatisfiesAlone("medium"), true);
  assertEquals(fundingBandSatisfiesAlone("weak_supporting"), false);
  assertEquals(fundingBandSatisfiesAlone("stale"), false);
});

// ---- (1)(2) "funded this week" = 7 days ----
Deno.test("1: funding 3 days ago satisfies 'funded this week'", () => {
  const a = assess("Find B2B SaaS founders funded this week", [funding(3)]);
  assertEquals(a.decision, "timing_sufficient");
  assertEquals(a.signal_breakdown[0].satisfied, true);
  assertEquals(a.signal_breakdown[0].funding_band, "strong");
});

Deno.test("2/13: funding 10 days ago does NOT satisfy 'funded this week' (explicit stays stricter)", () => {
  const r = reqFor("Find B2B SaaS founders funded this week");
  assertEquals(r.maxAgeHoursByCategory.funding_signal, DAYS(7), "the explicit 7d window wins over the 180d policy");
  const a = assess("Find B2B SaaS founders funded this week", [funding(10)]);
  assertEquals(a.decision, "missing_timing_evidence");
  assertEquals(a.next_action, "signal_enrichment");
  assertEquals(a.stale_signal_ids, ["f1"]);
  // Still a strong BAND by age — it is the user's explicit window that excludes it.
  assertEquals(a.signal_breakdown[0].stale, true);
  assertEquals(a.signal_breakdown[0].applied_window_hours, DAYS(7));
});

// ---- (3) "funded this month" = 30 days ----
Deno.test("3: funding 20 days ago satisfies 'funded this month'", () => {
  const r = reqFor("Find B2B SaaS founders funded this month");
  assertEquals(r.maxAgeHoursByCategory.funding_signal, DAYS(30));
  const a = assess("Find B2B SaaS founders funded this month", [funding(20)]);
  assertEquals(a.decision, "timing_sufficient");
});

// ---- (4)(5)(6) "recently funded" = 90 days ----
Deno.test("4/5: funding 45 and 89 days ago satisfy 'recently funded'", () => {
  const r = reqFor("Find recently funded B2B SaaS founders");
  assertEquals(r.maxAgeHoursByCategory.funding_signal, DAYS(90), "recently ⇒ 90 days, not the old 7");

  const a45 = assess("Find recently funded B2B SaaS founders", [funding(45)]);
  assertEquals(a45.decision, "timing_sufficient");
  assertEquals(a45.signal_breakdown[0].funding_band, "medium");
  assertEquals(a45.signal_breakdown[0].satisfied, true);

  const a89 = assess("Find recently funded B2B SaaS founders", [funding(89)]);
  assertEquals(a89.decision, "timing_sufficient");
  assertEquals(a89.signal_breakdown[0].funding_band, "medium");
});

Deno.test("6: funding 91 days ago does not satisfy 'recently funded' alone", () => {
  const a = assess("Find recently funded B2B SaaS founders", [funding(91)]);
  assertEquals(a.decision, "missing_timing_evidence");
  assertEquals(a.next_action, "signal_enrichment");
});

// ---- (7)(9) weak_supporting ----
Deno.test("7: funding 120 days ago is weak_supporting", () => {
  const r = assessSignalStrength(funding(120), NOW);
  assertEquals(r.funding_band, "weak_supporting");
  assertEquals(r.strength, "weak");
  assertEquals(r.reason, "funding_band_weak_supporting");
  assertEquals(r.age_days, 120);
});

Deno.test("9: funding 120 days ago alone cannot establish 'hot right now'", () => {
  const a = assess("find me hot founders right now", [funding(120)]);
  assertEquals(a.decision, "missing_timing_evidence");
  assertEquals(a.next_action, "signal_enrichment");
  assertEquals(a.signal_breakdown[0].supporting_only, true, "it counts only as support");
  assertEquals(a.signal_breakdown[0].satisfied, false);
  assertEquals(a.strongest, "weak");
});

// ---- (8) valid combination ----
Deno.test("8: funding 120 days ago + fresh sales hiring satisfies combined timing", () => {
  // Hiring at 2 days is fresh under job_signal's existing 72h contract window.
  const a = assess("find me hot founders right now", [funding(120), salesHiring(2)]);
  assertEquals(a.decision, "timing_sufficient");
  // The weak funding contributed as support; the fresh hiring signal carried it.
  const f = a.signal_breakdown.find((b) => b.signal_id === "f1")!;
  const h = a.signal_breakdown.find((b) => b.signal_id === "h1")!;
  assertEquals(f.supporting_only, true);
  assertEquals(f.funding_band, "weak_supporting");
  assertEquals(h.satisfied, true, "fresh, verified sales hiring is a legitimate partner");
  assert(a.satisfied_categories.includes("job_signal"));
});

Deno.test("KNOWN DIVERGENCE (job_signal): the 72h contract window excludes a 10-day-old role", () => {
  // The approved combination example is "funding 120 days ago + current sales hiring
  // 10 days ago". It does NOT currently combine, because job_signal's contract window
  // is 72h while the SignalEvent policy allows sales_hiring for 60 days — the SAME
  // class of contract-vs-policy conflict that funding just had.
  //
  // The approved decision covered FUNDING ONLY, and other categories must retain
  // their shipped behaviour, so this is pinned and surfaced rather than widened
  // silently. Widening job_signal is a PRODUCT decision.
  const r = reqFor("find me hot founders right now");
  assertEquals(r.maxAgeHoursByCategory.job_signal, 72);

  const a = assess("find me hot founders right now", [funding(120), salesHiring(10)]);
  assertEquals(a.decision, "missing_timing_evidence");
  const h = a.signal_breakdown.find((b) => b.signal_id === "h1")!;
  assertEquals(h.stale, true, "10 days > the 72h job_signal contract window");
  assertEquals(h.applied_window_hours, 72);
});

// ---- (10)(11)(12) stale + occurred_at authority ----
Deno.test("10: funding 181 days ago is stale", () => {
  const r = assessSignalStrength(funding(181), NOW);
  assertEquals(r.funding_band, "stale");
  assertEquals(r.strength, "none");
  assertEquals(r.fresh, false);
  const a = assess("Find recently funded B2B SaaS founders", [funding(181)]);
  assertEquals(a.decision, "missing_timing_evidence");
});

Deno.test("11/12: funding observed today but occurred 8 months ago is stale — observed_at never overrides", () => {
  // Discovery time is TODAY; event time is ~240 days ago.
  const scrapedToday = funding(240, { observed_at: NOW });
  const r = assessSignalStrength(scrapedToday, NOW);
  assertEquals(r.funding_band, "stale");
  assertEquals(r.strength, "none");
  assertEquals(r.age_days, 240, "age is measured from occurred_at, not observed_at");

  const a = assess("find me hot founders right now", [scrapedToday]);
  assertEquals(a.decision, "missing_timing_evidence", "scraping an old round today must not fabricate urgency");

  // Proof it is occurred_at doing the work: same observed_at, recent event ⇒ strong.
  const recentSameObservation = funding(5, { observed_at: NOW });
  assertEquals(assessSignalStrength(recentSameObservation, NOW).funding_band, "strong");
});

// ---- (14) explicit 180-day window ----
Deno.test("14: 'funded in the last 6 months' allows evidence up to that stated limit", () => {
  const r = reqFor("Find B2B SaaS founders funded in the last 6 months");
  assertEquals(r.maxAgeHoursByCategory.funding_signal, DAYS(180));
  // 150 days is inside the stated window but only weak_supporting by band, so it
  // cannot satisfy a funding-specific requirement alone — truthful, not fabricated.
  const alone = assess("Find B2B SaaS founders funded in the last 6 months", [funding(150)]);
  assertEquals(alone.decision, "missing_timing_evidence");
  assertEquals(alone.signal_breakdown[0].stale, false, "within the stated window");
  assertEquals(alone.signal_breakdown[0].supporting_only, true);
  // Beyond the stated limit ⇒ stale.
  const beyond = assess("Find B2B SaaS founders funded in the last 6 months", [funding(200)]);
  assertEquals(beyond.stale_signal_ids, ["f1"]);
});

// ---- (15)(16) window isolation ----
Deno.test("15/16: job_signal's window is never applied to funding; each any-of category keeps its own", () => {
  const r = reqFor("find me hot founders right now");
  assertEquals(r.maxAgeHoursByCategory.job_signal, 72, "hiring stays at 72h");
  assertEquals(r.maxAgeHoursByCategory.funding_signal, DAYS(FUNDING_MAX_AGE_DAYS), "funding keeps 180d");
  assertEquals(r.maxAgeHoursByCategory.launch_signal, 168);
  assertEquals(r.maxAgeHoursByCategory.founder_activity_signal, 168);

  // A 5-day-old round would be wrongly aged out by job_signal's 72h window.
  const a = assess("find me hot founders right now", [funding(5)]);
  assertEquals(a.decision, "timing_sufficient");
  assertEquals(a.signal_breakdown[0].funding_band, "strong");
});

// ---- (17) generic ICP discovery ----
Deno.test("17: generic ICP discovery requires neither funding nor timing", () => {
  const r = reqFor("Find B2B SaaS founders in the United States");
  assertEquals(r.required, false);
  assertEquals(r.requiredCategories, []);
  const a = assess("Find B2B SaaS founders in the United States", []);
  assertEquals(a.decision, "timing_not_required");
  assertEquals(a.next_action, "none");
});

// ---- canonical authority: no conflicting tables ----
Deno.test("the contract and the signal policy share ONE canonical funding window", () => {
  assertEquals(CANONICAL_TIMING_WINDOW_HOURS.funding_signal, DAYS(180));
  assertEquals(CANONICAL_TIMING_WINDOW_HOURS.job_signal, 72);
  // The explicit user constraint is applied by the same resolver both sides use.
  assertEquals(resolveWindowHours({ category: "funding_signal", explicitWindow: "this_week" }), DAYS(7));
  assertEquals(resolveWindowHours({ category: "funding_signal", explicitWindow: "recently" }), DAYS(90));
  assertEquals(resolveWindowHours({ category: "funding_signal", explicitWindow: null }), DAYS(180));
  // A looser explicit window can never widen a stricter category ceiling.
  assertEquals(resolveWindowHours({ category: "job_signal", explicitWindow: "last_6_months" }), 72);
  assertEquals(EXPLICIT_WINDOW_DAYS.recently, 90);
});

// ---- typed intent compilation ----
Deno.test("explicit windows are compiled from TYPED intent, strictest first", () => {
  const week = compileLeadEntityIntent("Find founders funded this week");
  assertEquals(week.signals.find((s) => s.type === "funding")?.window, "this_week");

  const month = compileLeadEntityIntent("Find founders funded this month");
  assertEquals(month.signals.find((s) => s.type === "funding")?.window, "this_month");

  const six = compileLeadEntityIntent("Find founders funded in the last 6 months");
  assertEquals(six.signals.find((s) => s.type === "funding")?.window, "last_6_months");

  const recent = compileLeadEntityIntent("Find recently funded founders");
  assertEquals(recent.signals.find((s) => s.type === "funding")?.window, "recently");

  // No window stated ⇒ the general policy applies, not a guess.
  const none = compileLeadEntityIntent("Find founders who raised a seed round");
  assertEquals(none.signals.find((s) => s.type === "funding")?.window, undefined);

  // The window is recorded as immutable evidence on the intent.
  assert(week.evidence_spans.some((e) => e.field === "signal_window" && e.value === "this_week"));
});
