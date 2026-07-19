import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  emptyAccountView,
  mergeWorkbenchStage,
  mergeBatch,
  nextAction,
  STAGE_FOR_ACTION,
  type WorkbenchAccountView,
} from "./workbenchAccountView.ts";
import {
  buildIcpSnapshot,
  buildWhyRelevant,
  assessIcpCompleteness,
  icpFitLine,
  topFitReasons,
  NO_TRIGGER_COPY,
  type SavedIcp,
  type AccountFacts,
} from "./icpSnapshot.ts";

const LEAD = "lead-1";
const OTHER = "lead-2";
const T1 = "2026-07-19T10:00:00.000Z";
const T2 = "2026-07-19T10:05:00.000Z";
const T3 = "2026-07-19T10:10:00.000Z";

const research = { status: "succeeded" as const, summary: "Synthetic platform for logistics teams.", evidence_count: 4, missing_evidence: ["funding"], confidence: "high", usable: true };
const dmView = { status: "succeeded" as const, primary_decision_maker: { full_name: "Ada Kestrel", linkedin_url: "https://www.linkedin.com/in/synthetic-ada", role_family: "founder", verification_status: "verified", verification_methods: ["company_linkedin_url"], rank: 1, rank_reasons: [], persisted: true }, additional_decision_makers: [], verified_count: 1, manual_review_count: 0, rejected_count: 0 };

function withResearchAndDm(): WorkbenchAccountView {
  let v = mergeWorkbenchStage(emptyAccountView(LEAD), {
    stage: "company_research", lead_candidate_id: LEAD, status: "succeeded", payload: research, now: T1,
  });
  v = mergeWorkbenchStage(v, {
    stage: "decision_makers", lead_candidate_id: LEAD, status: "succeeded", payload: dmView as never, now: T2,
  });
  return v;
}

// ===========================================================================
// 11H — NON-DISRUPTIVE STATE
// ===========================================================================

Deno.test("1-3. research survives outreach succeeding, blocking AND failing", () => {
  for (const st of ["succeeded", "blocked", "failed"] as const) {
    const v = mergeWorkbenchStage(withResearchAndDm(), {
      stage: "outreach", lead_candidate_id: LEAD, status: st, payload: { status: st }, now: T3,
    });
    assertEquals(v.company_research.last_success, research, `research lost after outreach ${st}`);
    assertEquals(v.decision_makers.last_success, dmView as never, `decision-makers lost after outreach ${st}`);
  }
});

Deno.test("4 + 7. research and decision-makers survive each other", () => {
  const v = withResearchAndDm();
  assertEquals(v.company_research.last_success, research);
  assertEquals(v.decision_makers.last_success, dmView as never);
});

Deno.test("6. outreach survives a research retry", () => {
  let v = mergeWorkbenchStage(withResearchAndDm(), {
    stage: "outreach", lead_candidate_id: LEAD, status: "succeeded", payload: { status: "draft" }, now: T2,
  });
  v = mergeWorkbenchStage(v, {
    stage: "company_research", lead_candidate_id: LEAD, status: "failed", reason_code: "provider_failed", now: T3,
  });
  assertEquals(v.outreach.last_success, { status: "draft" }, "outreach discarded by a research retry");
});

Deno.test("14 + 24. a failed retry preserves the last success — no destructive replacement", () => {
  const v = mergeWorkbenchStage(withResearchAndDm(), {
    stage: "company_research", lead_candidate_id: LEAD, status: "failed", reason_code: "provider_failed", payload: null, now: T3,
  });
  assertEquals(v.company_research.attempt?.status, "failed", "latest attempt is honest");
  assertEquals(v.company_research.last_success, research, "previous success retained");
  assertEquals(v.company_research.attempt?.succeeded_at, T1, "success timestamp unchanged");
  assertEquals(v.company_research.attempt?.attempted_at, T3);
});

Deno.test("8. the ICP snapshot survives every action type", () => {
  const icp = buildIcpSnapshot(
    { has_verified_decision_maker: true, verified_buyer_role_family: "founder", industry: "logistics", research_usable: true, evidence_ids: ["e1"] },
    { industries: ["logistics"], buyer_roles: ["founder"] },
  );
  let v: WorkbenchAccountView = { ...withResearchAndDm(), icp_snapshot: icp };
  for (const stage of ["outreach", "decision_makers", "contact_enrichment"] as const) {
    v = mergeWorkbenchStage(v, { stage, lead_candidate_id: LEAD, status: "failed", now: T3 });
    assertEquals(v.icp_snapshot, icp, `ICP lost after ${stage}`);
  }
});

Deno.test("21. no stage becomes undefined when another updates", () => {
  const v = mergeWorkbenchStage(withResearchAndDm(), {
    stage: "outreach", lead_candidate_id: LEAD, status: "succeeded", payload: { status: "draft" }, now: T3,
  });
  for (const k of ["company_research", "decision_makers", "contact_enrichment", "outreach"] as const) {
    assert(v[k] !== undefined, `${k} became undefined`);
    assert(v[k].attempt !== undefined || v[k].last_success !== undefined);
  }
});

Deno.test("17-18. batch results merge per lead without cross-contamination", () => {
  const views = { [LEAD]: withResearchAndDm() };
  const next = mergeBatch(views, [
    { stage: "outreach", lead_candidate_id: LEAD, status: "succeeded", payload: { status: "draft" }, now: T3 },
    { stage: "company_research", lead_candidate_id: OTHER, status: "failed", now: T3 },
  ]);
  assertEquals(next[LEAD].company_research.last_success, research, "lead-1 research untouched by lead-2");
  assertEquals(next[OTHER].company_research.last_success, null);
  assertEquals(next[LEAD].outreach.last_success, { status: "draft" });
});

Deno.test("19-20. an action maps to exactly ONE stage", () => {
  assertEquals(STAGE_FOR_ACTION.research_company, "company_research");
  assertEquals(STAGE_FOR_ACTION.find_decision_makers, "decision_makers");
  assertEquals(STAGE_FOR_ACTION.generate_outreach, "outreach");
});

// ===========================================================================
// NEXT ACTION — recommended, never triggered
// ===========================================================================

Deno.test("60-63. next action follows the evidence", () => {
  assertEquals(nextAction(emptyAccountView(LEAD)), "research_company");

  const partial = mergeWorkbenchStage(emptyAccountView(LEAD), {
    stage: "company_research", lead_candidate_id: LEAD, status: "succeeded",
    payload: { ...research, usable: false }, now: T1,
  });
  assertEquals(nextAction(partial), "resolve_missing_evidence");

  const researched = mergeWorkbenchStage(emptyAccountView(LEAD), {
    stage: "company_research", lead_candidate_id: LEAD, status: "succeeded", payload: research, now: T1,
  });
  assertEquals(nextAction(researched), "find_decision_makers");
  assertEquals(nextAction(withResearchAndDm()), "generate_outreach");
});

Deno.test("62. a hard exclusion recommends stop", () => {
  const excluded = buildIcpSnapshot(
    { has_verified_decision_maker: true, industry: "gambling", research_usable: true, evidence_ids: [] },
    { industries: ["logistics"], disqualifiers: ["gambling"] },
  );
  const v: WorkbenchAccountView = { ...withResearchAndDm(), icp_snapshot: excluded };
  assertEquals(excluded.status, "excluded");
  assertEquals(nextAction(v), "stop");
});

// ===========================================================================
// ICP SNAPSHOT — honest about what it can and cannot assess
// ===========================================================================

const savedIcp: SavedIcp = {
  industries: ["logistics", "supply chain"],
  company_size: ["50-200"],
  geographies: ["Europe"],
  buyer_roles: ["founder", "revenue"],
  disqualifiers: ["gambling"],
};

const baseFacts: AccountFacts = {
  industry: "logistics",
  company_size_label: "50-200",
  geography: "Europe",
  verified_buyer_role_family: "founder",
  has_verified_decision_maker: true,
  research_usable: true,
  research_confidence: "high",
  evidence_ids: ["e1", "e2"],
};

Deno.test("15 + 19. the SAVED ICP is used, never generic defaults", () => {
  const s = buildIcpSnapshot(baseFacts, savedIcp);
  assertEquals(s.uses_saved_icp, true);
  const none = buildIcpSnapshot(baseFacts, null);
  assertEquals(none.uses_saved_icp, false);
  assertEquals(none.status, "insufficient_evidence", "no saved ICP must not invent an assessment");
});

Deno.test("18. incomplete ICP coverage is reported truthfully", () => {
  // Production's saved ICP defines industries/size/geo/buyer_roles but NOT
  // buying_moments — the assessment must say so rather than paper over it.
  const c = assessIcpCompleteness(savedIcp);
  assertEquals(c.complete, false);
  assert(c.undefined_criteria.includes("buying_moments"));
  assert(c.defined.includes("industries"));
});

Deno.test("20 + 29. matched criteria carry a reason and evidence", () => {
  const s = buildIcpSnapshot(baseFacts, savedIcp);
  assert(s.matched_criteria.length >= 2);
  for (const m of s.matched_criteria) {
    assert(m.criterion.length > 0);
    assert(m.reason.length > 0, "every positive reason must be explainable");
  }
  assertEquals(s.status, "strong_fit");
});

Deno.test("21. company size is only matched when evidence exists — never inferred", () => {
  const noSize = buildIcpSnapshot({ ...baseFacts, company_size_label: null, employee_count: null }, savedIcp);
  assert(noSize.missing_criteria.some((m) => /size not verified/.test(m)));
  assert(!noSize.matched_criteria.some((m) => m.criterion === "Company size"));
});

Deno.test("22-23. buyer fit uses the VERIFIED decision-maker", () => {
  assertEquals(buildIcpSnapshot(baseFacts, savedIcp).buyer_fit.status, "verified");

  const noPerson = buildIcpSnapshot({ ...baseFacts, has_verified_decision_maker: false }, savedIcp);
  assertEquals(noPerson.buyer_fit.status, "missing");

  const probable = buildIcpSnapshot({ ...baseFacts, has_verified_decision_maker: false, manual_review_count: 2 }, savedIcp);
  assertEquals(probable.buyer_fit.status, "probable");

  const mismatch = buildIcpSnapshot({ ...baseFacts, verified_buyer_role_family: "engineering" }, savedIcp);
  assertEquals(mismatch.buyer_fit.status, "mismatch");
});

Deno.test("25 + 34. no saved buying moment → missing, never invented", () => {
  const s = buildIcpSnapshot(baseFacts, savedIcp);
  assertEquals(s.buying_moment_fit.status, "missing");
  assert(/no buying moments defined/i.test(s.buying_moment_fit.reason ?? ""));
  const why = buildWhyRelevant(s);
  assertEquals(why.why_now, undefined, "no fabricated timing reason");
  assertEquals(NO_TRIGGER_COPY, "No verified current trigger");
});

Deno.test("26-27. a disqualifier overrides an otherwise strong fit", () => {
  const s = buildIcpSnapshot({ ...baseFacts, industry: "gambling" }, savedIcp);
  assertEquals(s.status, "excluded");
  assertEquals(s.score, undefined, "an excluded account gets no score");
  assert(s.disqualifiers.length > 0);
});

Deno.test("28. insufficient evidence produces NO score", () => {
  const s = buildIcpSnapshot({ ...baseFacts, research_usable: false }, savedIcp);
  assertEquals(s.status, "insufficient_evidence");
  assertEquals(s.score, undefined);
  assertEquals(icpFitLine(s), "ICP fit: Insufficient evidence");
});

Deno.test("a supported fit shows its score alongside the label", () => {
  const s = buildIcpSnapshot(baseFacts, savedIcp);
  assert(typeof s.score === "number");
  assert(/^ICP fit: \d+ \/ 100 · /.test(icpFitLine(s)), icpFitLine(s));
});

Deno.test("39. at most three fit reasons reach the compact cell", () => {
  const s = buildIcpSnapshot(baseFacts, savedIcp);
  assert(topFitReasons(s).length <= 3);
});

// ===========================================================================
// WHY RELEVANT
// ===========================================================================

Deno.test("31-32 + 35. why-relevant is grounded, never invented", () => {
  const s = buildIcpSnapshot(baseFacts, savedIcp);
  const why = buildWhyRelevant(s);
  assert(why.why_this_company, "company relevance comes from ICP matches");
  assert(why.why_this_person, "person relevance requires a verified buyer");
  assertEquals(why.support_level, "company_level");
  const text = JSON.stringify(why).toLowerCase();
  for (const invented of ["urgent", "struggling", "pain point", "raised", "funding"]) {
    assert(!text.includes(invented), `invented signal leaked: ${invented}`);
  }
});

Deno.test("no verified person → no why-this-person claim", () => {
  const s = buildIcpSnapshot({ ...baseFacts, has_verified_decision_maker: false }, savedIcp);
  assertEquals(buildWhyRelevant(s).why_this_person, undefined);
});

// ===========================================================================
// SAFETY
// ===========================================================================

Deno.test("76-79. fixtures are synthetic and expose no PII, payloads or secrets", () => {
  const s = JSON.stringify(buildIcpSnapshot(baseFacts, savedIcp));
  assert(!/@[a-z]+\.(com|io|ai)\b/i.test(s));
  assert(!s.includes("apiKey") && !s.includes("Bearer "));
});
