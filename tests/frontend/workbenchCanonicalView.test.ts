// LEAD V2 P5 — THE WORKBENCH RENDERS THE BACKEND'S DECISION; IT NEVER MAKES ONE.
//
// Canaries c584fd77 / d7012ba5 showed the header and the tabs reading a legacy
// counter (Brain `verdict === "pass"`) while `workbench_mission_view` said
// something else. The UI now reads the canonical view when a run wrote one:
// the counts, the tab each company lands in, and the hard checks with their
// evidence. A legacy run (no view) reads exactly as before.
//
// PURE.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalSummary, describeHardCheck, readMissionView,
} from "../../src/lib/workbench/missionView.ts";
import { canonicalEvaluationRows, readEvaluationRows } from "../../src/lib/workbench/evaluationRows.ts";
import { bucketFor } from "../../src/lib/workbench/leadTabs.ts";
import { readWorkbenchProgress } from "../../src/lib/workbench/workbenchProgress.ts";

const check = (dimension: string, result: string, reason: string, prov: Record<string, unknown> | null = null) => ({
  criterion_id: `hard_${dimension}`, dimension, result, reason, provenance: prov,
});
const bmProv = {
  evidence_id: "grd_acme_business_model", dimension: "business_model", status: "proven", method: "model_extraction",
  confidence: "medium", actor: "grounded_evidence_evaluation", grounding_decision: "review", business_model_decision: "accepted",
  url: "https://acme.com/about", excerpt: "Acme is a SaaS platform for finance teams",
};
const lead = (key: string, bucket: string, label: string | null, checks: unknown[], missing: string[] = []) => ({
  company: { key, name: key.toUpperCase(), domain: `${key}.com`, linkedin_url: null },
  label, bucket, found_by: ["job_discovery"], hard_checks: {}, hard_check_details: checks,
  why_surfaced: [], key_evidence: [], missing_evidence: missing, caveats: [], evidence_coverage: 0.5,
});

const VIEW = {
  version: "workbench-mission-view-v1", stage: "complete",
  counts: {
    discovered: 6, screened_out: 1, investigating: 1, identity_unresolved: 0, pending: 1,
    exact_match: 1, strong_opportunity: 0, worth_considering: 0, low_priority: 0, ineligible: 2,
  },
  leads: [
    lead("acme", "exact_match", "EXACT MATCH", [check("industry", "pass", "business model b2b_saas", bmProv)]),
    lead("pend", "pending", null, [check("industry", "unknown", "business model not yet verified")], ["business model"]),
    lead("cons", "ineligible", null, [check("industry", "fail", "business model consumer", { ...bmProv, evidence_id: "grd_cons" })]),
    lead("big", "ineligible", null, [check("company_size", "fail", "headcount 151 outside 1–150")]),
    lead("scr", "screened_out", null, []),
    lead("wip", "investigating", null, [], ["hiring"]),
  ],
};
// A legacy counter that disagrees — exactly what the canaries showed.
const RESULT = {
  workbench_mission_view: VIEW,
  workbench_progress: {
    stage: "qualification", accounts_found: 40, evaluated: 12, qualified_companies: 0, identity_unresolved: 7,
    eligible_opportunities: 3, exclusion_reasons: {}, identity_resolved: 5, companies_enriched: 4, hiring_verified: 2,
    decision_makers_verified: 0, open_jobs_evaluated: 9, shortlisted: 3, in_progress: false, awaiting_external_run: false,
  },
  workbench_evaluation_rows: [{ company_name: "LEGACY", status: "qualified" }],
};

Deno.test("readMissionView reads the backend view, keeps every hard-check provenance field", () => {
  const v = readMissionView(RESULT)!;
  assertEquals(v.leads.length, 6);
  const pass = v.leads[0].hard_check_details[0];
  assertEquals(pass.result, "pass");
  assertEquals(pass.provenance, bmProv, "status, method, confidence, actor, both decisions, the URL and the quote");
  assertEquals(readMissionView({}), null, "legacy run: no view");
  assertEquals(readMissionView({ workbench_mission_view: { counts: null, leads: [] } }), null, "malformed view is ignored");
});

Deno.test("header counts come from the canonical counts, not the legacy counter", () => {
  const s = canonicalSummary(readMissionView(RESULT)!.counts);
  assertEquals([s.discovered, s.qualified, s.pending, s.ineligible, s.screenedOut, s.undecided], [6, 1, 1, 2, 1, 1]);
  const p = readWorkbenchProgress(RESULT)!;
  assertEquals([p.accounts_found, p.qualified_companies, p.evaluated, p.identity_unresolved], [6, 1, 4, 0]);
});

Deno.test("legacy runs (no view) read exactly as before", () => {
  const { workbench_mission_view: _v, ...legacy } = RESULT;
  const p = readWorkbenchProgress(legacy)!;
  assertEquals([p.accounts_found, p.qualified_companies, p.evaluated, p.identity_unresolved], [40, 0, 12, 7]);
  const rows = readEvaluationRows(legacy);
  assertEquals(rows.length, 1);
  assertFalse("canonical" in rows[0] && rows[0].canonical !== undefined, "legacy rows carry no canonical decision");
});

Deno.test("evaluation rows are the non-surfaced canonical companies, with the backend's bucket and evidence", () => {
  const rows = readEvaluationRows(RESULT);
  assertEquals(rows.map((r) => r.company_name), ["PEND", "CONS", "BIG", "SCR", "WIP"], "surfaced leads are lead rows, never evaluation rows");
  assertEquals(rows, canonicalEvaluationRows(readMissionView(RESULT)!));
  const by = (n: string) => rows.find((r) => r.company_name === n)!;
  assertEquals(by("PEND").status, "held_for_evidence", "pending is a question, not a rejection");
  assertEquals(by("CONS").status, "not_qualified");
  assertEquals(by("WIP").status, "deferred");
  assert(by("WIP").resumable);
  assertEquals(by("PEND").canonical?.missing_evidence, ["business model"]);
  assertEquals(by("CONS").canonical?.hard_check_details[0].provenance?.business_model_decision, "accepted");
  assert(rows.every((r) => r.decision_source === "p5_canonical_eligibility"));
});

Deno.test("the tab is the backend's bucket — the UI never re-qualifies", () => {
  const tab = (name: string) => bucketFor(readEvaluationRows(RESULT).find((r) => r.company_name === name)! as never);
  assertEquals([tab("PEND"), tab("CONS"), tab("BIG"), tab("SCR"), tab("WIP")],
    ["in_review", "rejected", "rejected", "rejected", "not_reached"]);
  // A row the legacy resolver would call qualified stays where the backend put it.
  const row = { ...readEvaluationRows(RESULT)[0], status: "qualified", qualification_level: "contact_ready" };
  assertEquals(bucketFor(row as never), "in_review");
});

Deno.test("a hard check reads as one line with its evidence source and business-model decision", () => {
  const v = readMissionView(RESULT)!;
  assertEquals(describeHardCheck(v.leads[0].hard_check_details[0]),
    "PASS — business model b2b_saas (proven · model extraction · medium confidence · grounded evidence evaluation · grounding review · business model accepted)");
  assertEquals(describeHardCheck(v.leads[1].hard_check_details[0]), "PENDING — business model not yet verified (no evidence)");
});
