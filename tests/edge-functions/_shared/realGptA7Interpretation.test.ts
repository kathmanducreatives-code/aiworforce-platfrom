// The first real-GPT A7 run (2026-10-27) failed interpretation checks I2, I5,
// I6 and I7 on a proposal whose meaning was right and whose shape the compiler
// misread. These tests pin the compiler fixes against that proposal, judged by
// the UNCHANGED I1–I8 assertions, and pin that a proposal whose meaning is
// wrong still fails them.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalDisallowedBroadening,
  compileLeadMission,
  type GptMissionProposal,
} from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { normalizeProposedVerticals } from "../../../supabase/functions/_shared/leadMission.ts";
import { readSignalPhrase } from "../../../supabase/functions/_shared/missionSignalDescriptor.ts";
import { judgeRealGptRun, type Json } from "../../../scripts/test-project/real-gpt/realGptJudge.ts";
import { A7_MISSION as A7, prepareKickoff } from "../../../scripts/test-project/real-gpt/prepareKickoff.ts";

/** The proposal the model returned in the first real-GPT run, field for field. */
function realProposal(): GptMissionProposal {
  return {
    requested_opportunity_count: 1, requested_contact_ready_count: null,
    company_types: ["B2B", "software", "company"],
    geographies: ["United States"], geography_is_hard: true,
    employee_range: { min: 11, max: 50 },
    decision_maker_roles: [],
    hard_constraints: [
      { field: "geography", operator: "equals", value: "US", reason: "The company must be in the US." },
      { field: "company_type", operator: "matches", value: ["B2B", "software"], reason: "The company must be a B2B software company." },
      { field: "employee_range", operator: "declared_band_equals", value: ["11–50"], reason: "The company must have a current declared 11–50 employee band." },
      { field: "hiring_signal", operator: "has_open_role", value: "Account Executive", reason: "The company must have an open Account Executive posting." },
      { field: "hiring_signal_recency", operator: "within_days", value: 30, reason: "The Account Executive posting must be dated within 30 days." },
    ],
    soft_preferences: [],
    preferred_signals: ["open Account Executive posting"],
    required_signal_terms: ["current declared 11–50 employee band", "open Account Executive posting", "dated within 30 days"],
    signal_recency_days: 30,
    adjacent_signals: [], excluded_signals: [],
    allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
    disallowed_broadening: ["geography", "company type", "employee range", "Account Executive role", "30-day posting recency"],
    required_evidence: [
      "Evidence that the company is a B2B software company",
      "Evidence of US location, with location scope clarified before qualification",
      "A current declared 11–50 employee band",
      "An open Account Executive posting",
      "A posting date within the last 30 days",
    ],
    required_capabilities: ["general_company_discovery", "embedded_hiring_evidence", "company_semantic_evaluation"],
    preferred_source_strategy: ["company_profile_first", "evidence_reuse_first"],
    evaluation_instructions: "Return one qualified company only if all hard constraints are supported by evidence.",
    founder_unlock_recommended: false, confidence: 0.95, unknowns: [], known_companies: [],
  } as unknown as GptMissionProposal;
}

const compile = (p: GptMissionProposal, query = A7) =>
  compileLeadMission({ originalUserQuery: query, proposal: p, requestedCount: 1 }).final_mission as unknown as Json;
const verdicts = (m: Json) =>
  Object.fromEntries(judgeRealGptRun({ lead_mission: m }).filter((v) => v.question === "I").map((v) => [v.id, v]));
const hard = (m: Json) => (m.criteria as Json[]).filter((c) => c.kind === "hard");
const withChange = (f: (p: Json) => void) => {
  const p = realProposal() as unknown as Json;
  f(p);
  return p as unknown as GptMissionProposal;
};

// ── THE REAL PROPOSAL ─────────────────────────────────────────────────────────

Deno.test("real run: the first real-GPT proposal now compiles to I1–I8 PASS", () => {
  const v = verdicts(compile(realProposal()));
  for (const id of ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8"]) {
    assertEquals(v[id]?.result, "PASS", `${id}: ${v[id]?.observed}`);
  }
});

Deno.test("real run: exactly the four stated hard criteria — no fragment, no duplicate, no 'company' industry", () => {
  const m = compile(realProposal());
  assertEquals(hard(m).map((c) => c.dimension).sort(), ["company_size", "geography", "hiring", "industry"]);
  assertEquals(hard(m).find((c) => c.dimension === "industry")!.value, "B2B software");
  assertEquals((m.criteria as Json[]).filter((c) => c.dimension === "constraint"), []);
});

Deno.test("real run: the hiring criterion keeps the user's role and window, and no size or date clause as a role", () => {
  const m = compile(realProposal());
  const h = hard(m).find((c) => c.dimension === "hiring")!;
  assertEquals(h.value.qualifier.role_terms, ["account executive"]);
  assertEquals(h.value.qualifier.role_families, ["gtm_sales"]);
  assertEquals(h.time_window.days, 30);
});

// ── I2: company types ────────────────────────────────────────────────────────

Deno.test("I2: fragments the request writes contiguously are rejoined, spelled as the request spells them", () => {
  assertEquals(normalizeProposedVerticals(A7, ["B2B", "software", "company"]), ["B2B software"]);
  assertEquals(normalizeProposedVerticals(A7, ["b2b", "software"]), ["B2B software"]);
  assertEquals(normalizeProposedVerticals(A7, ["B2B software"]), ["B2B software"], "an already-whole phrase is unchanged");
  assertEquals(normalizeProposedVerticals("Find B2B-software firms", ["B2B", "software"]), ["B2B-software"]);
});

Deno.test("I2 negative: fragments the request writes apart stay apart; nothing is merged into a phrase it never wrote", () => {
  const q = "Find fintech and software companies in the US";
  assertEquals(normalizeProposedVerticals(q, ["fintech", "software"]), ["fintech", "software"]);
  assertEquals(normalizeProposedVerticals(A7, ["software", "B2B"]), ["software", "B2B"], "out of order is not contiguous");
  assertEquals(normalizeProposedVerticals("Find AI startups hiring", ["AI", "startup"]), ["AI", "startup"],
    "a partial word ('startup' in 'startups') is not a match");
});

Deno.test("I2: a bare entity noun is no industry and is dropped; real types beside it are kept", () => {
  assertEquals(normalizeProposedVerticals("Find companies hiring", ["companies"]), []);
  assertEquals(normalizeProposedVerticals("Find a fintech firm", ["fintech", "firm"]), ["fintech"]);
  assertEquals(normalizeProposedVerticals("Find a staffing business", ["staffing business"]), ["staffing business"],
    "a noun inside a real type is not stripped");
});

Deno.test("I2 negative: a wrong industry still fails I2 — normalisation never invents the user's phrase", () => {
  const v = verdicts(compile(withChange((p) => { p.company_types = ["fintech"]; })));
  assertEquals(v.I2.result, "FAIL");
});

Deno.test("I2 negative: a broadened industry ('software' alone) still fails I2", () => {
  const v = verdicts(compile(withChange((p) => { p.company_types = ["software"]; })));
  assertEquals(v.I2.result, "FAIL");
});

// ── I5: the hiring role ──────────────────────────────────────────────────────

Deno.test("I5: an 'open X posting' keeps the user's role term", () => {
  assertEquals(readSignalPhrase("open Account Executive posting")?.qualifier?.role_terms, ["account executive"]);
  assertEquals(readSignalPhrase("an open Account Executive posting dated within 30 days.")?.qualifier?.role_terms,
    ["account executive"]);
  assertEquals(readSignalPhrase("open Account Executive role")?.qualifier?.role_terms, ["account executive"]);
  assertEquals(readSignalPhrase("hiring Account Executive")?.qualifier?.role_terms, ["account executive"]);
});

Deno.test("I5: several roles are each their own term — none dropped, none fused into one", () => {
  assertEquals(readSignalPhrase("hiring Account Executives and SDRs")?.qualifier?.role_terms, ["account executives", "sdrs"]);
  const d = readSignalPhrase("open Account Executive and SDR postings");
  assertEquals(d?.type, "hiring", "several roles sharing one noun are still job postings, not a person posting");
  assertEquals(d?.qualifier?.role_terms, ["account executive", "sdr"]);
});

Deno.test("I5 negative: a clause that is not a role never becomes a role term", () => {
  assertEquals(readSignalPhrase("hiring account executives and based in texas")?.qualifier?.role_terms, ["account executives"]);
  assertEquals(readSignalPhrase("currently hiring")?.qualifier?.role_terms, undefined);
  assertEquals(readSignalPhrase("open roles")?.qualifier?.role_terms, undefined);
  assertEquals(readSignalPhrase("an open LinkedIn posting about AI")?.type, "post", "a person posting is still a post");
});

Deno.test("I5 negative: the opening itself is never a role ('a dated open job posting')", () => {
  const d = readSignalPhrase("a dated open job posting");
  assertEquals(d?.type, "hiring");
  assertEquals(d?.qualifier?.role_terms, undefined);
  assertEquals(readSignalPhrase("companies with open roles postings")?.qualifier?.role_terms, undefined);
});

Deno.test("I5: list items read as titles — no leading 'for'/'other', no trailing 'roles'", () => {
  assertEquals(readSignalPhrase("companies hiring for Sales Operations, Revenue Operations, or GTM Operations")?.qualifier?.role_terms,
    ["sales operations", "revenue operations", "gtm operations"]);
  assertEquals(readSignalPhrase("actively hiring SDRs, BDRs, Account Executives, or other sales roles.")?.qualifier?.role_terms,
    ["sdrs", "bdrs", "account executives", "sales"]);
  assertEquals(readSignalPhrase("companies hiring Sales Operations and RevOps roles")?.qualifier?.role_terms, ["sales operations", "revops"]);
});

Deno.test("I5 negative: a wrong date window still fails I5", () => {
  for (const days of [60, 7]) {
    const v = verdicts(compile(withChange((p) => {
      p.signal_recency_days = days;
      p.hard_constraints = (p.hard_constraints as Json[]).filter((c) => c.field !== "hiring_signal_recency");
    })));
    assertEquals(v.I5.result, "FAIL", `a ${days}-day window is not the user's 30`);
  }
});

Deno.test("I5 negative: a wrong role still fails I5", () => {
  const v = verdicts(compile(withChange((p) => {
    p.preferred_signals = ["open SDR posting"];
    p.required_signal_terms = ["open SDR posting"];
  })));
  assertEquals(v.I5.result, "FAIL");
});

// ── I6: duplicate hard criteria ──────────────────────────────────────────────

Deno.test("I6: a constraint restating a represented dimension with the SAME values is not repeated", () => {
  const m = compile(realProposal());
  const fields = (m.criteria as Json[]).filter((c) => c.dimension === "constraint").map((c) => c.value.field);
  assertEquals(fields, []);
});

Deno.test("I6 negative: a restated dimension with DIFFERENT values is kept, never silently dropped", () => {
  const m = compile(withChange((p) => {
    p.hard_constraints = [
      { field: "employee_range", operator: "declared_band_equals", value: ["51–200"], reason: "" },
      { field: "hiring_signal", operator: "has_open_role", value: "Sales Development Representative", reason: "" },
      { field: "hiring_signal_recency", operator: "within_days", value: 60, reason: "" },
    ];
  }));
  const fields = (m.criteria as Json[]).filter((c) => c.dimension === "constraint").map((c) => c.value.field).sort();
  assertEquals(fields, ["employee_range", "hiring_signal", "hiring_signal_recency"]);
});

Deno.test("I6 negative: another fact carrying the same number is never read as the hiring window or the size", () => {
  const m = compile(withChange((p) => {
    p.hard_constraints = [
      { field: "founded_within_days", operator: "within_days", value: 30, reason: "" },
      { field: "revenue_size", operator: "equals", value: ["11–50"], reason: "" },
    ];
  }));
  const fields = (m.criteria as Json[]).filter((c) => c.dimension === "constraint").map((c) => c.value.field).sort();
  assertEquals(fields, ["founded_within_days", "revenue_size"]);
});

Deno.test("I6 negative: an exclusion restating a dimension is never dropped", () => {
  const m = compile(withChange((p) => {
    p.hard_constraints = [{ field: "employee_range", operator: "not_in", value: ["11–50"], reason: "" }];
  }));
  assert((m.criteria as Json[]).some((c) => c.dimension === "exclusion" && c.value.field === "employee_range"));
});

Deno.test("I6 negative: a request-stated constraint on another dimension still makes I6 fail", () => {
  const v = verdicts(compile(withChange((p) => {
    p.hard_constraints = [{ field: "revenue", operator: "equals", value: "software", reason: "" }];
  })));
  assertEquals(v.I6.result, "FAIL");
});

// ── I7: broadening vocabulary ────────────────────────────────────────────────

Deno.test("I7: the real run's prose is read onto the canonical dimensions", () => {
  const changes: string[] = [];
  assertEquals(
    canonicalDisallowedBroadening(
      ["geography", "company type", "employee range", "Account Executive role", "30-day posting recency"], changes),
    ["geography", "industry", "size", "role", "recency"],
  );
  assert(changes.includes("disallowed_broadening_canonical:Account Executive role->role"), "every rewrite is recorded");
  assert(!changes.some((c) => c.startsWith("disallowed_broadening_canonical:geography")), "a canonical word is not a rewrite");
});

Deno.test("I7: names already in use elsewhere map onto the same vocabulary", () => {
  assertEquals(canonicalDisallowedBroadening(["geographies", "company_types", "employee_range", "role_families"]),
    ["geography", "industry", "size", "role"]);
  assertEquals(canonicalDisallowedBroadening(["geography", "business_model"]), ["geography", "business_model"]);
});

Deno.test("I7 negative: an entry naming no dimension is kept verbatim; nothing is added", () => {
  assertEquals(canonicalDisallowedBroadening(["consumer apps"]), ["consumer apps"]);
  assertEquals(canonicalDisallowedBroadening(["company_types", "geographies", "hiring_status"]),
    ["industry", "geography", "hiring_status"]);
  assertEquals(canonicalDisallowedBroadening([]), []);
});

Deno.test("I7 negative: a proposal that never forbade role broadening still fails I7", () => {
  const v = verdicts(compile(withChange((p) => { p.disallowed_broadening = ["geography", "company type", "employee range"]; })));
  assertEquals(v.I7.result, "FAIL");
  assertEquals(JSON.parse(v.I7.observed), ["geography", "industry", "size"]);
});

// ── THE OTHER CHECKS STILL CATCH A WIDENED SIZE OR PLACE ─────────────────────

Deno.test("negative: a widened size still fails I4", () => {
  const v = verdicts(compile(withChange((p) => { p.employee_range = { min: 11, max: 200 }; })));
  assertEquals(v.I4.result, "FAIL");
});

// ── THROUGH THE PREPARER, AS THE PAID RUN GOES ───────────────────────────────

Deno.test("preparer: the real proposal passes the interpretation gate, and kickoff.json keeps the proposal as it arrived", async () => {
  const catalog = JSON.parse(Deno.readTextFileSync(
    new URL("../../../docs/launch/proposals/smoke-catalog-two-actor.json", import.meta.url))).approved_quotes;
  const k = await prepareKickoff({
    workspace_id: crypto.randomUUID(), user_id: crypto.randomUUID(), queue_id: crypto.randomUUID(),
    plan_id: crypto.randomUUID(), pricing_version: "offline-v1", catalog,
    prices: { jobs_maximum_microusd: 5000, details_maximum_microusd: 5000,
      observed_at: new Date().toISOString(), source: "synthetic offline fixture" },
    compile: () => Promise.resolve(realProposal()),
  });
  assertEquals(k.interpretation.filter((v) => v.result !== "PASS"), []);
  assertEquals((k.gpt_proposal as Json).company_types, ["B2B", "software", "company"], "the raw proposal, not the repaired one");
  assert(k.validator_changes.includes("disallowed_broadening_canonical:employee range->size"));
});
