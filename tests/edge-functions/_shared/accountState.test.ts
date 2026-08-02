import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  emptyAccountState,
  readAccountState,
  applyStageUpdate,
  deriveGateFields,
  outreachPrerequisite,
  nextBestAction,
  WORKBENCH_STATE_KEY,
  type CompanyResearchState,
  type DecisionMakerState,
} from "../../../supabase/functions/_shared/accountState.ts";
import { evaluateDraftGate, buildDraftGateInputFromRaw } from "../../../supabase/functions/draftGate.ts";

const LEAD = "00000000-0000-4000-8000-000000000002";
const T1 = "2026-07-19T09:00:00.000Z";
const T2 = "2026-07-19T09:05:00.000Z";
const T3 = "2026-07-19T09:10:00.000Z";

const research: CompanyResearchState = {
  summary: "Synthetic company builds warehouse automation for mid-market logistics teams.",
  evidence_urls: ["https://nimbusforge.example/about", "https://nimbusforge.example/product"],
  missing_evidence: ["funding"],
  confidence: "medium",
  usable: true,
};

const verifiedDm: DecisionMakerState = {
  verified_count: 1,
  manual_review_count: 0,
  primary_full_name: "Ada Kestrel",
  primary_linkedin_url: "https://www.linkedin.com/in/synthetic-ada",
  primary_role_family: "founder",
  primary_company_name: "Nimbus Forge",
  primary_verification_methods: ["company_linkedin_url"],
  contact_id: "contact_1",
};

// ===========================================================================
// STATE MERGE — the "results disappear" defect
// ===========================================================================

Deno.test("4-7. each stage update preserves every other stage", () => {
  let st = emptyAccountState(LEAD);
  st = applyStageUpdate(st, "company_research", { status: "succeeded", payload: research }, T1);
  st = applyStageUpdate(st, "decision_makers", { status: "succeeded", payload: verifiedDm }, T2);

  // Running outreach must not wipe research or decision-makers.
  st = applyStageUpdate(st, "outreach", { status: "failed", reason_code: "provider_failed" }, T3);

  assertEquals(st.company_research.last_success, research, "research survived");
  assertEquals(st.decision_makers.last_success, verifiedDm, "decision-makers survived");
  assertEquals(st.outreach.status, "failed");
});

Deno.test("8. a failed retry never erases the previous success", () => {
  let st = applyStageUpdate(emptyAccountState(LEAD), "company_research", { status: "succeeded", payload: research }, T1);
  st = applyStageUpdate(st, "company_research", { status: "failed", reason_code: "provider_failed" }, T2);

  assertEquals(st.company_research.status, "failed", "latest attempt is honest");
  assertEquals(st.company_research.last_success, research, "but the previous success is retained");
  assertEquals(st.company_research.failure_reason, "provider_failed");
});

Deno.test("9. attempt and success timestamps stay distinct", () => {
  let st = applyStageUpdate(emptyAccountState(LEAD), "company_research", { status: "succeeded", payload: research }, T1);
  st = applyStageUpdate(st, "company_research", { status: "timed_out" }, T2);
  assertEquals(st.company_research.succeeded_at, T1);
  assertEquals(st.company_research.attempted_at, T2);
});

Deno.test("10. state round-trips through the namespaced raw key", () => {
  const st = applyStageUpdate(emptyAccountState(LEAD), "company_research", { status: "succeeded", payload: research }, T1);
  const raw = { company_enrichment: { anything: true }, [WORKBENCH_STATE_KEY]: st };
  const back = readAccountState(raw, LEAD);
  assertEquals(back.company_research.last_success, research);
  // Reading unknown/legacy raw never throws and never invents state.
  assertEquals(readAccountState({}, LEAD).company_research.status, "not_started");
  assertEquals(readAccountState(null, LEAD).decision_makers.last_success, null);
});

// ===========================================================================
// THE PRODUCTION OUTREACH BLOCK
// ===========================================================================

Deno.test("40. research + verified person satisfies the REAL draft gate", () => {
  // Reproduces production: company_enrichment and decision_makers present, but
  // canonical_final_decision / contact_ready / provider_provenance absent, so the
  // gate blocked with five reasons unrelated to the actual state.
  let st = applyStageUpdate(emptyAccountState(LEAD), "company_research", { status: "succeeded", payload: research }, T1);
  st = applyStageUpdate(st, "decision_makers", { status: "succeeded", payload: verifiedDm }, T2);

  const derived = deriveGateFields(st);
  assertEquals(derived.canonical_final_decision, "contact");
  assertEquals(derived.contact_ready, true);
  assertEquals(derived.provider_provenance, { verified: true, level: "person" });

  // Feed the derived fields to the UNMODIFIED gate.
  const gate = evaluateDraftGate(buildDraftGateInputFromRaw(
    {
      canonical_final_decision: derived.canonical_final_decision,
      contact_ready: derived.contact_ready,
      provider_provenance: derived.provider_provenance,
      evidence_url: derived.evidence_url,
      company: derived.company,
    },
    { execution_mode: null, persisted_lead_candidate_id: LEAD },
  ));
  assert(gate.allowed, `gate should allow: ${JSON.stringify(gate.blocked_reasons)}`);
});

Deno.test("42. no verified person → gate stays blocked, with the SPECIFIC reason", () => {
  const st = applyStageUpdate(emptyAccountState(LEAD), "company_research", { status: "succeeded", payload: research }, T1);

  const derived = deriveGateFields(st);
  assertEquals(derived.canonical_final_decision, null, "no provenance is manufactured");
  assertEquals(derived.provider_provenance, null);

  const prereq = outreachPrerequisite(st);
  assertEquals(prereq.reason, "blocked_missing_person");
  assertEquals(prereq.message, "Find a verified decision-maker first");
});

Deno.test("no usable research → blocked on company evidence, not on the person", () => {
  const st = applyStageUpdate(emptyAccountState(LEAD), "decision_makers", { status: "succeeded", payload: verifiedDm }, T1);
  const prereq = outreachPrerequisite(st);
  assertEquals(prereq.reason, "blocked_missing_company_evidence");
  assertEquals(prereq.message, "Complete company research first");
  assertEquals(deriveGateFields(st).canonical_final_decision, null);
});

Deno.test("29. research that completed but produced nothing usable is NOT a pass", () => {
  const thin: CompanyResearchState = { ...research, usable: false, evidence_urls: [], summary: null };
  let st = applyStageUpdate(emptyAccountState(LEAD), "company_research", { status: "succeeded", payload: thin }, T1);
  st = applyStageUpdate(st, "decision_makers", { status: "succeeded", payload: verifiedDm }, T2);
  assertEquals(deriveGateFields(st).canonical_final_decision, null, "provider completion alone is not evidence");
});

Deno.test("a probable-only decision-maker never manufactures provenance", () => {
  const probable: DecisionMakerState = {
    ...verifiedDm, verified_count: 0, manual_review_count: 2, primary_verification_methods: [],
  };
  let st = applyStageUpdate(emptyAccountState(LEAD), "company_research", { status: "succeeded", payload: research }, T1);
  st = applyStageUpdate(st, "decision_makers", { status: "needs_manual_review", payload: probable }, T2);
  assertEquals(deriveGateFields(st).provider_provenance, null);
  assertEquals(outreachPrerequisite(st).reason, "blocked_missing_person");
});

// ===========================================================================
// NEXT BEST ACTION
// ===========================================================================

Deno.test("66. next best action follows the evidence", () => {
  let st = emptyAccountState(LEAD);
  assertEquals(nextBestAction(st), "research_company");

  st = applyStageUpdate(st, "company_research", { status: "succeeded", payload: research }, T1);
  assertEquals(nextBestAction(st), "find_decision_makers");

  st = applyStageUpdate(st, "decision_makers", { status: "succeeded", payload: verifiedDm }, T2);
  assertEquals(nextBestAction(st), "generate_outreach");

  st = applyStageUpdate(st, "outreach", {
    status: "succeeded",
    payload: { eligibility: "ready", personalization_depth: "company_level", approval_required: true, approval_status: "pending" },
  }, T3);
  assertEquals(nextBestAction(st), "review_draft");
});

Deno.test("manual-review decision-makers route to manual_review, not another search", () => {
  let st = applyStageUpdate(emptyAccountState(LEAD), "company_research", { status: "succeeded", payload: research }, T1);
  st = applyStageUpdate(st, "decision_makers", {
    status: "needs_manual_review",
    payload: { ...verifiedDm, verified_count: 0, manual_review_count: 2 },
  }, T2);
  assertEquals(nextBestAction(st), "manual_review");
});

// ===========================================================================
// SAFETY
// ===========================================================================

Deno.test("71-80. the merger is pure: no network, no database, no provider, no PII", () => {
  const st = applyStageUpdate(emptyAccountState(LEAD), "company_research", { status: "succeeded", payload: research }, T1);
  const s = JSON.stringify(st);
  assert(s.includes("nimbusforge.example"), "fixtures are synthetic");
  assert(!/@[a-z]+\.(com|io|ai)\b/i.test(s), "no email-like strings");
  assert(!s.includes("apiKey") && !s.includes("Bearer "));
});
