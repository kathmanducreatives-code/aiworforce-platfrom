// THE SECOND LIVE PARAPHRASE STUDY (run #24, commit fa57093, 2026-11-05): 165 recorded live
// answers, replayed through the CURRENT compiler. $0, no model call. Live, 107/165 (64.85 %)
// were correct; 54 failures had a CORRECT understanding and were compiled wrongly. This file
// pins the evidence-backed v3 fixes (missionUnderstanding.ts restatements, missionCriteria.ts
// industries, the actor-reference guard) against those exact answers.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission, scanProposalForViolations } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { restatesSize, restatesUnderstanding, restatesWindow } from "../../../supabase/functions/_shared/missionUnderstanding.ts";
import { compare, fullProposal, loadCases, summarise } from "../../../scripts/dev/interpretation-corpus.ts";

const study = JSON.parse(await Deno.readTextFile(new URL("../../../docs/benchmarks/live-paraphrase/2026-11-05-run24.json", import.meta.url)));
const cases = loadCases();
const replay = (r: { case: string; label: string; proposal?: unknown; error?: string }) => {
  const c = cases.find((x) => x.id === r.case)!;
  const q = c.phrasings.find((p) => p.label === r.label)!.query;
  if (!r.proposal) return [`no answer: ${r.error}`];
  try { return compare(c.expect, summarise(compileLeadMission({ originalUserQuery: q, proposal: r.proposal as never, requestedCount: 5, contract: "v3" }).final_mission as never)); }
  catch (e) { return [`compile: ${(e as Error).message}`]; }
};

Deno.test("run #24 replay: 161/165 correct, no live-correct reading regresses, no compiler failure left", () => {
  assertEquals([study.calls, study.correct, study.spent_usd], [165, 107, 0.211798], "the recorded run");
  const results = study.rows.map((r: never) => ({ r, mm: replay(r) }));
  const ok = results.filter((x: { mm: string[] }) => !x.mm.length).length;
  assertEquals(ok, 161);
  const regressed = results.filter((x: { r: { ok: boolean }; mm: string[] }) => x.r.ok && x.mm.length);
  assertEquals(regressed.length, 0, JSON.stringify(regressed.map((x: { r: { case: string; label: string } }) => `${x.r.case}/${x.r.label}`)));
  // What remains is the model's or the transport's, never a correct understanding compiled wrongly.
  const left = results.filter((x: { mm: string[] }) => x.mm.length).map((x: { r: { case: string; failure?: string; error?: string }; mm: string[] }) =>
    `${x.r.case}:${x.r.error === "incomplete_response" ? "transport" : x.mm[0].startsWith("compile: the request could not be compiled into a mission (needs_clarification") ? "clarification" : "understanding"}`).sort();
  assertEquals(left, ["M01:transport", "M01:transport", "M07:clarification", "M19:understanding"]);
});

// The live understanding of M07 ("Find US companies hiring Account Executives, not SDRs").
const M07 = { roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" },
  { span: "SDRs", title: "sales_development_representative", family: null, relation: "excluded" }],
  role_match: "any", places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
  industries: [], signals: [{ span: "hiring Account Executives", kind: "hiring", necessity: "required" }], signal_logic: "all", ambiguities: [], unsupported: [] };

Deno.test("restatement: same polarity only — a contradiction is never hidden", () => {
  assertEquals(restatesUnderstanding("SDRs", M07 as never, true), true, "excluding what the understanding excludes");
  assertEquals(restatesUnderstanding("AEs", M07 as never, true), false, "excluding a REQUIRED role is a contradiction");
  assertEquals(restatesUnderstanding("SDRs", M07 as never, false), false, "requiring an EXCLUDED role is a contradiction");
  assertEquals(restatesUnderstanding("account_executive", M07 as never, false), true, "the title id");
  assertEquals(restatesUnderstanding("hiring", M07 as never, false), true, "the signal kind");
  assertEquals(restatesUnderstanding("United States", M07 as never, false), true, "the place");
  assertEquals(restatesUnderstanding("BDRs", M07 as never, true), false, "never a different word");
  assertEquals(restatesUnderstanding("Salesforce admins", M07 as never, false), false);
});

Deno.test("restatement: size and window only when they equal what the mission already carries", () => {
  const r = { min: 10, max: 100 };
  assert(restatesSize("employee_count", ["10", "100"], r));
  assert(restatesSize("employee_range", [">=10", "<=100"], r));
  assert(restatesSize("company_size", { min: 10, max: 100 }, r));
  assert(!restatesSize("employee_count", ["10", "50"], r), "a different bound is a requirement of its own");
  assert(!restatesSize("revenue", ["10", "100"], r), "not a size field");
  assert(!restatesSize("employee_count", ["10", "100"], {}), "no stated range");
  assert(!restatesSize("employee_count", ["10 to 100"], r), "unparseable: kept");
  assert(restatesWindow("signal_recency_days", 30, [{ timeframe_days: 30 }]));
  assert(!restatesWindow("signal_recency_days", 14, [{ timeframe_days: 30 }]), "a different window is kept");
  assert(!restatesWindow("revenue", 30, [{ timeframe_days: 30 }]));
});

Deno.test("nothing uncovered is dropped: a stated requirement outside the understanding still compiles hard", () => {
  const q = "Find US companies hiring Account Executives, not SDRs, that use Salesforce.";
  const m = compileLeadMission({ originalUserQuery: q, requestedCount: 5, contract: "v3",
    proposal: fullProposal({ label: "t", query: q, proposal: { extra_hard: [{ field: "tech_stack", operator: "in", value: ["Salesforce"] }] }, understanding: M07 } as never, "v3") as never }).final_mission as never;
  assert(summarise(m).hard.includes("constraint"));
});

Deno.test("the user's own slash is not a forged actor reference; one the user did not type still is", () => {
  const user = "Find US companies hiring SDRs/BDRs.";
  assertEquals(scanProposalForViolations({ required_signal_terms: ["SDRs/BDRs"] }, user).filter((v) => v.kind === "actor_reference").length, 0);
  assertEquals(scanProposalForViolations({ required_signal_terms: ["harvestapi/linkedin-job-search"] }, user).filter((v) => v.kind === "actor_reference").length, 1);
});

Deno.test("v3 industries: a generic company word is not a hard industry; a split of an understood one stays hard", () => {
  const live = (id: string, label: string) => study.rows.find((r: { case: string; label: string; proposal?: unknown }) => r.case === id && r.label === label && r.proposal);
  for (const [id, label] of [["M21", "sales guys"], ["M23", "taking on more staff"]]) {
    const r = live(id, label);
    assertEquals(replay(r).filter((x: string) => x.includes("industry")), [], `${id}: "businesses" is not an industry`);
  }
  assertEquals(replay(live("M17", "formal")), [], "M17: \"saas\" (the compiler's split of B2B SaaS) stays a hard industry");
});
