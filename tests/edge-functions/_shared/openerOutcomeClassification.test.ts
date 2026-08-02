// The personalized-opener path classifies itself. Re-deriving its status here is
// what turned four correctly-blocked leads into "Provider or persistence failed"
// in the 2026-07-19 production batch.
//
// Synthetic payloads only — no network, database, provider or model.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyLeadOutcome } from "../../supabase/functions/_shared/leadActionOutcome.ts";

/** A per_lead row exactly as the opener path emits it. */
function openerRow(status: string, reason_code: string, extra: Record<string, unknown> = {}) {
  return {
    lead_candidate_id: "lead-1",
    output_mode: "personalized_opener",
    status,
    reason_code,
    sent: false,
    approval_required: true,
    ...extra,
  };
}

Deno.test("17. a blocked opener stays blocked and keeps its reason_code", () => {
  const r = classifyLeadOutcome("generate_outreach", openerRow("blocked", "blocked_missing_verified_person"));
  assertEquals(r.status, "blocked");
  assertEquals(r.reason_code, "blocked_missing_verified_person");
});

Deno.test("every canonical blocker survives classification unchanged", () => {
  const codes = [
    "blocked_missing_verified_person",
    "blocked_missing_company_brain",
    "blocked_missing_company_research",
    "blocked_icp_disqualified",
    "blocked_person_contract_invalid",
  ];
  for (const code of codes) {
    const r = classifyLeadOutcome("generate_outreach", openerRow("blocked", code));
    assertEquals(r.status, "blocked", code);
    assertEquals(r.reason_code, code, code);
  }
});

Deno.test("19. an unavailable provider stays unavailable, not failed", () => {
  const r = classifyLeadOutcome("generate_outreach", openerRow("unavailable", "provider_not_configured"));
  assertEquals(r.status, "unavailable");
  assertEquals(r.reason_code, "provider_not_configured");
});

Deno.test("20. a timeout stays timed_out, not failed", () => {
  const r = classifyLeadOutcome("generate_outreach", openerRow("timed_out", "provider_timed_out"));
  assertEquals(r.status, "timed_out");
  assertEquals(r.reason_code, "provider_timed_out");
});

Deno.test("21. a validation failure keeps failed_validation as its reason", () => {
  // The coarse status is `failed`, but the REASON is what the UI keys copy on —
  // so "did not pass safety checks" is never reported as a provider fault.
  const r = classifyLeadOutcome("generate_outreach", openerRow("failed_validation", "failed_validation"));
  assertEquals(r.status, "failed");
  assertEquals(r.reason_code, "failed_validation");
});

Deno.test("22. a persistence failure keeps persistence_failed as its reason", () => {
  const r = classifyLeadOutcome("generate_outreach", openerRow("persistence_failed", "persistence_failed"));
  assertEquals(r.status, "failed");
  assertEquals(r.reason_code, "persistence_failed");
});

Deno.test("a succeeded opener classifies as succeeded", () => {
  const r = classifyLeadOutcome("generate_outreach", openerRow("succeeded", "opener_ready_for_approval"));
  assertEquals(r.status, "succeeded");
  assertEquals(r.reason_code, "opener_ready_for_approval");
});

Deno.test("an unrecognised opener status is a contract error, not a provider fault", () => {
  const r = classifyLeadOutcome("generate_outreach", openerRow("who_knows", "???"));
  assertEquals(r.status, "failed");
  assertEquals(r.reason_code, "opener_contract_error");
});

Deno.test("a blocked opener is never reported as provider_failed", () => {
  const r = classifyLeadOutcome("generate_outreach", openerRow("blocked", "blocked_missing_verified_person"));
  assertEquals(r.reason_code === "provider_failed", false);
});

// ---------------------------------------------------- legacy full_draft path --

Deno.test("16. the legacy full_draft vocabulary is untouched", () => {
  // No `output_mode: personalized_opener`, so the legacy branches must still own
  // classification exactly as before.
  const ready = classifyLeadOutcome("generate_outreach", {
    lead_candidate_id: "lead-1",
    status: "draft_needs_approval",
  });
  assertEquals(ready.status, "succeeded");
  assertEquals(ready.reason_code, "draft_ready_for_approval");

  const gated = classifyLeadOutcome("generate_outreach", {
    lead_candidate_id: "lead-1",
    status: "blocked_draft_gate",
    blocked_reasons: ["verified decision maker required"],
  });
  assertEquals(gated.status, "blocked");
  assertEquals(gated.reason_code, "verified_decision_maker_required");

  const insufficient = classifyLeadOutcome("generate_outreach", {
    lead_candidate_id: "lead-1",
    status: "insufficient_context",
  });
  assertEquals(insufficient.status, "blocked");
  assertEquals(insufficient.reason_code, "evidence_required");

  const unknown = classifyLeadOutcome("generate_outreach", { lead_candidate_id: "lead-1", status: "kaboom" });
  assertEquals(unknown.status, "failed");
  assertEquals(unknown.reason_code, "provider_failed");
});

Deno.test("an explicit full_draft mode also uses the legacy vocabulary", () => {
  const r = classifyLeadOutcome("generate_outreach", {
    lead_candidate_id: "lead-1",
    output_mode: "full_draft",
    status: "draft_needs_approval",
  });
  assertEquals(r.status, "succeeded");
  assertEquals(r.reason_code, "draft_ready_for_approval");
});
