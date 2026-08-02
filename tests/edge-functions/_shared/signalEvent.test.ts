// Provider-free tests for the SignalEvent contract, taxonomy and freshness.
// Pure: no network, no provider, no real clock (every time is injected).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type SignalEvent, type SignalType,
  validateSignalEvent, isTimingCapableSignal, isRiskSignal,
  signalCategoryOf, evidenceCategoryForSignalType, buildSignalDedupeKey,
} from "../../../supabase/functions/_shared/signalEvent.ts";
import {
  SIGNAL_FRESHNESS_POLICY, assessSignalStrength, isSignalFresh, signalAgeHours,
  windowHoursFor, strengthAtLeast,
} from "../../../supabase/functions/_shared/signalFreshness.ts";

const NOW = "2026-07-17T12:00:00.000Z";
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3600_000).toISOString();

const sig = (o: Partial<SignalEvent> = {}): SignalEvent => ({
  signal_id: "s1",
  workspace_id: "00000000-0000-0000-0000-000000000001",
  signal_type: "sales_hiring",
  signal_category: "gtm",
  company_ref: "co_acme",
  evidence_refs: [{ category: "job_signal", sourceType: "apify_actor", sourceUrl: "https://www.linkedin.com/jobs/view/1", confidence: "high" }],
  occurred_at: hoursAgo(24),
  observed_at: NOW,
  confidence: "high",
  verification: "provider_verified",
  dedupe_key: "k1",
  status: "active",
  sanitized: true,
  ...o,
});

// ---- (1) source-backed evidence required ----
Deno.test("1: a SignalEvent requires source-backed evidence and an entity", () => {
  assertEquals(validateSignalEvent(sig()).valid, true);

  const noEvidence = validateSignalEvent(sig({ evidence_refs: [] }));
  assertEquals(noEvidence.valid, false);
  assert(noEvidence.reasons.includes("no_supporting_evidence"));

  const noEntity = validateSignalEvent(sig({ company_ref: null, person_ref: null }));
  assertEquals(noEntity.valid, false);
  assert(noEntity.reasons.includes("no_entity_reference"));

  const noWhen = validateSignalEvent(sig({ occurred_at: "" }));
  assertEquals(noWhen.valid, false);
  assert(noWhen.reasons.includes("missing_occurred_at"));
});

// ---- (2) LLM inference / Brain constraint can never verify a signal ----
Deno.test("2: a signal cannot be verified from LLM inference or a Brain constraint alone", () => {
  const brainOnly = sig({
    verification: "provider_verified",
    evidence_refs: [{ category: "job_signal", sourceType: "company_brain", confidence: "high" }],
  });
  const r = validateSignalEvent(brainOnly);
  assertEquals(r.valid, false);
  assert(r.reasons.includes("unverified_inference"), "Brain constraints are not evidence");
  assertEquals(isTimingCapableSignal(brainOnly), false);

  // An unverified signal is never timing-capable even with provider backing.
  assertEquals(isTimingCapableSignal(sig({ verification: "unverified" })), false);
});

// ---- (3) raw payload / PII excluded ----
Deno.test("3: raw provider payloads and PII are rejected from normalized_value", () => {
  for (const key of ["raw", "provider_payload", "payload", "email", "phone", "token"]) {
    const r = validateSignalEvent(sig({ normalized_value: { [key]: "x" } }));
    assertEquals(r.valid, false, `${key} must be rejected`);
    assert(r.reasons.includes("raw_payload_present"));
  }
  const email = validateSignalEvent(sig({ normalized_value: { note: "contact ceo@acme.com" } }));
  assertEquals(email.valid, false);
  assert(email.reasons.includes("sensitive_value_present"));

  const phone = validateSignalEvent(sig({ normalized_value: { note: "call +1 415 555 1212" } }));
  assertEquals(phone.valid, false);
  assert(phone.reasons.includes("sensitive_value_present"));

  // A clean structured value is fine.
  assertEquals(validateSignalEvent(sig({ normalized_value: { role: "AE", count: 3 } })).valid, true);
});

// ---- (4) taxonomy is provider-independent and bridges to canonical categories ----
Deno.test("4: the taxonomy names no provider and maps onto canonical evidence categories", () => {
  const all: SignalType[] = [
    "recent_funding", "employee_growth", "market_expansion", "geographic_expansion",
    "sales_hiring", "revops_hiring", "growth_hiring", "new_revenue_leader", "outbound_initiative", "positioning_change",
    "product_launch", "major_release", "new_integration", "category_expansion",
    "founder_pipeline_post", "founder_outbound_post", "founder_customer_acquisition_post",
    "founder_hiring_post", "founder_problem_statement",
    "linkedin_connection_accepted", "linkedin_post_like", "linkedin_post_comment",
    "linkedin_post_reply", "direct_reply", "content_engagement",
    "person_left_company", "company_outside_icp", "role_changed", "company_inactive", "signal_became_stale",
  ];
  for (const t of all) {
    // No provider/actor identity leaks into the taxonomy itself.
    assert(!/apify|harvestapi|firecrawl|perplexity/i.test(t), `${t} must not name a provider`);
    assert(!!signalCategoryOf(t), `${t} needs a category`);
    const cat = evidenceCategoryForSignalType(t);
    if (isRiskSignal(t)) assertEquals(cat, null, "risk signals never prove timing");
    else assert(cat !== null, `${t} must bridge to a canonical evidence category`);
  }
  // The bridge lands on the SIX existing canonical timing categories only.
  assertEquals(evidenceCategoryForSignalType("recent_funding"), "funding_signal");
  assertEquals(evidenceCategoryForSignalType("sales_hiring"), "job_signal");
  assertEquals(evidenceCategoryForSignalType("product_launch"), "launch_signal");
  assertEquals(evidenceCategoryForSignalType("market_expansion"), "expansion_signal");
  assertEquals(evidenceCategoryForSignalType("new_revenue_leader"), "gtm_signal");
  assertEquals(evidenceCategoryForSignalType("founder_pipeline_post"), "founder_activity_signal");
});

// ---- (5) freshness uses an injected clock and keys on occurred_at ----
Deno.test("5: freshness is judged on occurred_at with an injected clock, not observed_at", () => {
  // Observed just now, but the event happened 300 days ago ⇒ STALE.
  const oldFunding = sig({
    signal_type: "recent_funding", signal_category: "growth",
    occurred_at: hoursAgo(24 * 300), observed_at: NOW,
    evidence_refs: [{ category: "funding_signal", sourceType: "public_web", confidence: "high" }],
  });
  assertEquals(isSignalFresh(oldFunding, NOW), false, "an 8-month-old round scraped today is not fresh");
  assertEquals(signalAgeHours(oldFunding, NOW), 24 * 300);

  // Same event inside the window ⇒ fresh.
  const recentFunding = sig({ signal_type: "recent_funding", occurred_at: hoursAgo(24 * 30) });
  assertEquals(isSignalFresh(recentFunding, NOW), true);

  // An explicit expires_at overrides the window.
  const expired = sig({ occurred_at: hoursAgo(1), expires_at: hoursAgo(0.5) });
  assertEquals(isSignalFresh(expired, NOW), false);
});

Deno.test("freshness windows differ by type: engagement decays fastest, funding lasts longest", () => {
  const p = SIGNAL_FRESHNESS_POLICY;
  assert(windowHoursFor("linkedin_post_like", p) < windowHoursFor("founder_pipeline_post", p));
  assert(windowHoursFor("founder_pipeline_post", p) < windowHoursFor("sales_hiring", p));
  assert(windowHoursFor("sales_hiring", p) < windowHoursFor("product_launch", p));
  assert(windowHoursFor("product_launch", p) < windowHoursFor("recent_funding", p));

  // A 20-day-old like is stale; a 20-day-old funding round is not.
  const like = sig({ signal_type: "linkedin_post_like", signal_category: "engagement", occurred_at: hoursAgo(24 * 20) });
  const fund = sig({ signal_type: "recent_funding", signal_category: "growth", occurred_at: hoursAgo(24 * 20) });
  assertEquals(isSignalFresh(like, NOW), false);
  assertEquals(isSignalFresh(fund, NOW), true);

  // The policy is overridable, not a magic number.
  const custom = { ...p, windowHours: { ...p.windowHours, linkedin_post_like: 24 * 60 } };
  assertEquals(isSignalFresh(like, NOW, custom), true);
});

// ---- (8) weak vs strong ----
Deno.test("8: a stale or unverified signal has no strength; fresh+verified+relevant is strong", () => {
  const strong = assessSignalStrength(sig(), NOW);
  assertEquals(strong.strength, "strong");
  assertEquals(strong.fresh, true);
  assertEquals(strong.components.provider_verified, true);

  const stale = assessSignalStrength(sig({ occurred_at: hoursAgo(24 * 365) }), NOW);
  assertEquals(stale.strength, "none");
  assertEquals(stale.reason, "signal_stale");

  // Self-reported (a founder's own post) is real but never above weak.
  const selfReported = assessSignalStrength(sig({
    signal_type: "founder_pipeline_post", signal_category: "founder_intent",
    verification: "self_reported", person_ref: "p_1",
    evidence_refs: [{ category: "founder_activity_signal", sourceType: "public_web", confidence: "medium" }],
  }), NOW);
  assertEquals(selfReported.strength, "weak");
  assertEquals(selfReported.reason, "not_provider_verified");

  // A risk signal never carries timing strength.
  const risk = assessSignalStrength(sig({ signal_type: "person_left_company", signal_category: "risk" }), NOW);
  assertEquals(risk.strength, "none");
  assertEquals(risk.reason, "risk_signal_never_proves_timing");

  assert(strengthAtLeast("strong", "moderate"));
  assert(!strengthAtLeast("weak", "moderate"));
});

Deno.test("strength is composed from named components, not one opaque score", () => {
  const r = assessSignalStrength(sig(), NOW);
  const c = r.components;
  assertEquals(typeof c.evidence_confidence, "string");
  assertEquals(typeof c.freshness_ratio, "number");
  assertEquals(typeof c.icp_relevance, "string");
  assertEquals(typeof c.relationship_strength, "string");
  assertEquals(typeof c.provider_verified, "boolean");
  assert(c.freshness_ratio > 0 && c.freshness_ratio <= 1);
  // A direct reply carries the strongest relationship.
  const reply = assessSignalStrength(sig({
    signal_type: "direct_reply", signal_category: "engagement", occurred_at: hoursAgo(2),
  }), NOW);
  assertEquals(reply.components.relationship_strength, "strong");
});

// ---- dedupe key ----
Deno.test("the dedupe key is source-independent and bucketed by occurred_at", () => {
  const common = {
    workspace_id: "w1", signal_type: "recent_funding" as SignalType,
    company_ref: "co_acme", occurred_at: hoursAgo(2),
  };
  // Same event, two sources, timestamps a few hours apart ⇒ same key.
  const a = buildSignalDedupeKey(common);
  const b = buildSignalDedupeKey({ ...common, occurred_at: hoursAgo(5) });
  assertEquals(a, b);
  // A different signal type is a different event.
  assert(a !== buildSignalDedupeKey({ ...common, signal_type: "sales_hiring" }));
  // A different company is a different event.
  assert(a !== buildSignalDedupeKey({ ...common, company_ref: "co_other" }));
  // An event discriminator keeps two distinct roles apart.
  const r1 = buildSignalDedupeKey({ ...common, signal_type: "sales_hiring", event_identity: "AE" });
  const r2 = buildSignalDedupeKey({ ...common, signal_type: "sales_hiring", event_identity: "SDR" });
  assert(r1 !== r2);
});
