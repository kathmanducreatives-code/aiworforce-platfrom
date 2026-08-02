import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyLeadOutcome,
  summarizeDirectAction,
  emptyDirectActionSummary,
} from "../../functions/_shared/leadActionOutcome.ts";

const LEAD = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------
// FIND_DECISION_MAKERS — the provider-layer distinctions must survive
// classification. Collapsing them is what produced an undifferentiated "0/4".
// ---------------------------------------------------------------------------

Deno.test("verified decision-maker → succeeded", () => {
  const o = classifyLeadOutcome("find_decision_makers", {
    lead_candidate_id: LEAD, decision_makers: [{ name: "Jane Doe", title: "CEO" }],
  });
  assertEquals(o.status, "succeeded");
  assertEquals(o.reason_code, "decision_maker_found");
  assertEquals(o.lead_candidate_id, LEAD);
  assertEquals(o.retryable, false);
});

Deno.test("people search disabled → unavailable (HTTP 200 business outcome)", () => {
  const o = classifyLeadOutcome("find_decision_makers", { people_search_disabled: true, decision_makers: [] });
  assertEquals(o.status, "unavailable");
  assertEquals(o.reason_code, "people_search_disabled");
  // Not retryable: retrying changes nothing until an env flag changes.
  assertEquals(o.retryable, false);
});

Deno.test("zero results → no_match, distinct from a provider failure", () => {
  const o = classifyLeadOutcome("find_decision_makers", { decision_makers: [], rejected_count: 0 });
  assertEquals(o.status, "no_match");
  assertEquals(o.reason_code, "provider_no_results");
});

Deno.test("candidates found but all rejected → company_match_failed, not no results", () => {
  const o = classifyLeadOutcome("find_decision_makers", { decision_makers: [], rejected_count: 5 });
  assertEquals(o.status, "no_match");
  assertEquals(o.reason_code, "company_match_failed");
});

Deno.test("missing company identity is structured, not a generic failure", () => {
  const o = classifyLeadOutcome("find_decision_makers", { missing_company_identity: true, decision_makers: [] });
  assertEquals(o.status, "missing_company_identity");
  assertEquals(o.reason_code, "company_linkedin_url_missing");
});

Deno.test("needs_manual_review outranks emptiness — there IS something to look at", () => {
  const o = classifyLeadOutcome("find_decision_makers", { needs_manual_review: true, decision_makers: [] });
  assertEquals(o.status, "needs_manual_review");
  assertEquals(o.reason_code, "employment_unverified");
});

Deno.test("provider timeout is retryable and never a crash", () => {
  const o = classifyLeadOutcome("find_decision_makers", { status: "timed_out" });
  assertEquals(o.status, "timed_out");
  assertEquals(o.retryable, true);
});

Deno.test("persistence failure is reported as failed, not silently succeeded", () => {
  const o = classifyLeadOutcome("find_decision_makers", { status: "persistence_failed" });
  assertEquals(o.status, "failed");
  assertEquals(o.reason_code, "persistence_failed");
  assertEquals(o.retryable, true);
});

// ---------------------------------------------------------------------------
// RESEARCH_COMPANY
// ---------------------------------------------------------------------------

Deno.test("research: enriched → succeeded", () => {
  const o = classifyLeadOutcome("research_company", { status: "enriched" });
  assertEquals(o.status, "succeeded");
  assertEquals(o.reason_code, "company_enriched");
});

Deno.test("research: blocked on a missing website → missing_company_identity", () => {
  const o = classifyLeadOutcome("research_company", {
    status: "blocked", blocked_reason: "no company website/domain — enrichment blocked",
  });
  assertEquals(o.status, "missing_company_identity");
  assertEquals(o.reason_code, "company_domain_missing");
});

Deno.test("research: blocked for another reason stays blocked, not misfiled as identity", () => {
  const o = classifyLeadOutcome("research_company", { status: "blocked", blocked_reason: "robots_txt_disallowed" });
  assertEquals(o.status, "blocked");
  assertEquals(o.reason_code, "robots_txt_disallowed");
});

Deno.test("research: needs_verification → needs_manual_review", () => {
  const o = classifyLeadOutcome("research_company", { status: "needs_verification" });
  assertEquals(o.status, "needs_manual_review");
});

// ---------------------------------------------------------------------------
// GENERATE_OUTREACH — approval-gated; blocked prerequisites stay blocked.
// ---------------------------------------------------------------------------

Deno.test("outreach: draft awaiting approval → succeeded (never 'sent')", () => {
  const o = classifyLeadOutcome("generate_outreach", { status: "draft_needs_approval", draft_id: "d1" });
  assertEquals(o.status, "succeeded");
  assertEquals(o.reason_code, "draft_ready_for_approval");
});

Deno.test("outreach: no verified decision-maker → blocked on that prerequisite", () => {
  const o = classifyLeadOutcome("generate_outreach", {
    status: "blocked_draft_gate", blocked_reasons: ["no_verified_decision_maker"],
  });
  assertEquals(o.status, "blocked");
  assertEquals(o.reason_code, "verified_decision_maker_required");
});

Deno.test("outreach: missing evidence → blocked, and never retryable-as-is", () => {
  const o = classifyLeadOutcome("generate_outreach", { status: "insufficient_context", missing_context: ["company_evidence"] });
  assertEquals(o.status, "blocked");
  assertEquals(o.reason_code, "evidence_required");
  assertEquals(o.retryable, false);
});

// ---------------------------------------------------------------------------
// SUMMARY RECONCILIATION
// ---------------------------------------------------------------------------

Deno.test("summary counts reconcile with per_lead", () => {
  const rows = [
    classifyLeadOutcome("find_decision_makers", { decision_makers: [{ name: "A" }] }),
    classifyLeadOutcome("find_decision_makers", { decision_makers: [] }),
    classifyLeadOutcome("find_decision_makers", { people_search_disabled: true }),
    classifyLeadOutcome("find_decision_makers", { status: "failed" }),
  ];
  const s = summarizeDirectAction(rows, 4);
  assertEquals(s.requested, 4);
  assertEquals(s.succeeded, 1);
  assertEquals(s.no_match, 1);
  assertEquals(s.unavailable, 1);
  assertEquals(s.failed, 1);

  const categorised = Object.entries(s)
    .filter(([k]) => k !== "requested")
    .reduce((n, [, v]) => n + v, 0);
  assertEquals(categorised, rows.length, "every per_lead row lands in exactly one category");
});

Deno.test("requested can exceed categorised rows, surfacing a dropped lead", () => {
  const s = summarizeDirectAction([classifyLeadOutcome("research_company", { status: "enriched" })], 3);
  assertEquals(s.requested, 3);
  assertEquals(s.succeeded, 1);
});

Deno.test("an empty batch is all zeros, never a phantom success", () => {
  const s = summarizeDirectAction([], 0);
  assertEquals(s, emptyDirectActionSummary(0));
  assertEquals(s.succeeded, 0);
});
