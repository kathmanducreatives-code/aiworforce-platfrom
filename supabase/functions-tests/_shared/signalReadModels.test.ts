// Provider-free tests for the shared Signals / Content / Engagement read models.
// Contracts only — no UI, no content generation, no provider calls.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SignalEvent } from "../../functions/_shared/signalEvent.ts";
import {
  type EngagementEvent, type TopicInsight, type ContentOpportunity, type AudienceSegment,
  toSignalCard, engagementAdmissibility, canTopicInsightProveCandidateTiming,
  isCohortLevelOpportunity, freshnessBand, MIN_AUDIENCE_FOR_CONTENT,
  SIGNAL_CARD_FORBIDDEN_FIELDS,
} from "../../functions/_shared/signalReadModels.ts";

const NOW = "2026-07-17T12:00:00.000Z";
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3600_000).toISOString();

const sig = (o: Partial<SignalEvent> = {}): SignalEvent => ({
  signal_id: "s1", workspace_id: "w1",
  signal_type: "sales_hiring", signal_category: "gtm",
  company_ref: "co_acme",
  evidence_refs: [{ category: "job_signal", sourceType: "apify_actor", sourceUrl: "https://x.test/j/1", confidence: "high" }],
  occurred_at: hoursAgo(24), observed_at: NOW,
  confidence: "high", verification: "provider_verified",
  dedupe_key: "k", status: "active", sanitized: true,
  ...o,
});

// ---- (24) the read model leaks nothing ----
Deno.test("24: a SignalCard exposes no raw payload, PII or credentials", () => {
  const card = toSignalCard({
    signal: sig({
      // Even if a caller smuggles junk onto the event, the card must not carry it.
      normalized_value: { role: "AE", count: 2 },
      source_url: "https://x.test/j/1",
    }),
    title: "Acme is hiring account executives",
    entity_label: "Acme",
    why_it_matters: "They are building a sales team, which usually means a live GTM budget.",
    strength: "strong", icp_relevance: "strong", freshness_ratio: 0.9,
    related_candidate_count: 3,
  });
  const json = JSON.stringify(card);
  for (const f of SIGNAL_CARD_FORBIDDEN_FIELDS) {
    assert(!new RegExp(`"${f}"`, "i").test(json), `card must not expose "${f}"`);
  }
  assert(!/@|\+\d{7,}/.test(json), "no emails or phone numbers");
  assertEquals(card.entity_kind, "company");
  assertEquals(card.related_candidate_count, 3);
  assertEquals(card.freshness, "fresh");
  // Evidence references survive so a reviewer can trace the claim.
  assertEquals(card.evidence_refs.length, 1);
  assertEquals(card.evidence_refs[0].sourceUrl, "https://x.test/j/1");
  assertEquals(card.recommended_action, "review_lead");
});

Deno.test("no recommended action ever sends outreach", () => {
  const card = toSignalCard({
    signal: sig(), title: "t", entity_label: "Acme", why_it_matters: "w",
    strength: "strong", icp_relevance: "strong", freshness_ratio: 0.8,
    related_candidate_count: 1, recommended_action: "prepare_outreach_angle",
  });
  // "prepare" is the strongest permitted action — preparing is not sending.
  assertEquals(card.recommended_action, "prepare_outreach_angle");
  assert(!/send|deliver|dispatch/i.test(card.recommended_action));
});

Deno.test("freshness bands are derived from the freshness ratio", () => {
  assertEquals(freshnessBand(0.9), "fresh");
  assertEquals(freshnessBand(0.5), "fresh");
  assertEquals(freshnessBand(0.2), "aging");
  assertEquals(freshnessBand(0), "stale");
});

// ---- (25) TopicInsight references aggregated signals + evidence ----
Deno.test("25: a TopicInsight references aggregated signals and evidence, and names unsupported claims", () => {
  const insight: TopicInsight = {
    topic_id: "t1",
    topic: "Founders hiring their first sales team",
    supporting_signal_ids: ["s1", "s2", "s3"],
    supporting_evidence_refs: [
      { category: "job_signal", sourceType: "apify_actor", sourceUrl: "https://x.test/j/1", confidence: "high" },
      { category: "job_signal", sourceType: "apify_actor", sourceUrl: "https://x.test/j/2", confidence: "high" },
    ],
    matched_candidate_count: 4,
    confidence: "medium",
    freshness: "fresh",
    recurring_problem: "First sales hire ramps slowly without a repeatable process",
    safe_claims: ["Several founders in this cohort are hiring their first AE"],
    unsupported_claims: ["These founders are unhappy with their current tooling"],
  };
  assert(insight.supporting_signal_ids.length >= 3);
  assert(insight.supporting_evidence_refs.length > 0);
  assertEquals(insight.matched_candidate_count, 4);
  // The model forces the author to record what evidence does NOT support.
  assert(insight.unsupported_claims.length > 0);
});

// ---- (27) a content insight can never become candidate timing evidence ----
Deno.test("27: a TopicInsight can never be promoted into candidate timing evidence", () => {
  const insight: TopicInsight = {
    topic_id: "t1", topic: "Founders hiring sales",
    supporting_signal_ids: ["s1", "s2", "s3", "s4"],
    supporting_evidence_refs: [{ category: "job_signal", sourceType: "apify_actor", confidence: "high" }],
    matched_candidate_count: 12, confidence: "high", freshness: "fresh",
    safe_claims: [], unsupported_claims: [],
  };
  // Even a high-confidence, fresh, widely-matched insight is an AUDIENCE aggregate:
  // "several founders are hiring" is not proof that THIS founder is hot.
  assertEquals(canTopicInsightProveCandidateTiming(insight), false);
});

// ---- (26) ContentOpportunity ----
Deno.test("26: a ContentOpportunity carries matched audience count and evidence references", () => {
  const segment: AudienceSegment = {
    segment_id: "seg1", label: "US B2B SaaS founders building a sales team",
    icp_filters: { industries: ["B2B SaaS"], geographies: ["United States"], roles: ["Founder"] },
    candidate_ids: ["c1", "c2", "c3", "c4"],
    company_ids: ["co1", "co2", "co3", "co4"],
    signal_filters: ["gtm"],
  };
  const opp: ContentOpportunity = {
    opportunity_id: "o1", audience_segment: segment,
    suggested_topic: "What to fix before your first AE starts",
    why_now: "Four matched founders posted sales roles in the last 30 days",
    supporting_signal_ids: ["s1", "s2", "s3", "s4"],
    matched_audience_count: 4,
    recommended_angle: "Practical checklist from the founder's own experience",
    suggested_format: "linkedin_post",
    cta_options: ["Ask what broke for them", "Offer the checklist"],
    status: "proposed",
  };
  assertEquals(opp.matched_audience_count, 4);
  assertEquals(opp.supporting_signal_ids.length, 4);
  assertEquals(opp.audience_segment.candidate_ids.length, 4);
  assertEquals(opp.status, "proposed");
});

Deno.test("content opportunities are cohort-level, never one post per scraped lead", () => {
  assertEquals(isCohortLevelOpportunity({ matched_audience_count: MIN_AUDIENCE_FOR_CONTENT }), true);
  assertEquals(isCohortLevelOpportunity({ matched_audience_count: 1 }), false, "one lead is not an audience");
  assertEquals(isCohortLevelOpportunity({ matched_audience_count: 2 }), false);
});

// ---- (28) EngagementEvent admissibility ----
const eng = (o: Partial<EngagementEvent> = {}): EngagementEvent => ({
  engagement_id: "e1", workspace_id: "w1", kind: "linkedin_post_comment",
  person_ref: "p1", content_ref: "post_1",
  occurred_at: hoursAgo(2), observed_at: NOW,
  evidence_refs: [{ category: "founder_activity_signal", sourceType: "apify_actor", confidence: "medium" }],
  confidence: "medium", authorized: true,
  ...o,
});

Deno.test("28: an EngagementEvent is timing evidence only when source-backed, linked and authorized", () => {
  assertEquals(engagementAdmissibility(eng()).admissible, true);

  const anon = engagementAdmissibility(eng({ person_ref: null, company_ref: null }));
  assertEquals(anon.admissible, false);
  assert(anon.reasons.includes("unknown_entity"), "an anonymous like is not timing evidence");

  const unauth = engagementAdmissibility(eng({ authorized: false }));
  assertEquals(unauth.admissible, false);
  assert(unauth.reasons.includes("not_authorized"));

  const noProof = engagementAdmissibility(eng({ evidence_refs: [] }));
  assertEquals(noProof.admissible, false);
  assert(noProof.reasons.includes("no_supporting_evidence"));

  const noTime = engagementAdmissibility(eng({ occurred_at: "" }));
  assertEquals(noTime.admissible, false);
  assert(noTime.reasons.includes("missing_timestamp"));

  const lowConf = engagementAdmissibility(eng({ confidence: "low" }));
  assertEquals(lowConf.admissible, false);
  assert(lowConf.reasons.includes("low_confidence"));
});
