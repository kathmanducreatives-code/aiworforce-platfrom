// S1 — a restated requirement is reconciled by its VALUE, never by its field name.
//
// Positive: the same requirement under any field spelling is one requirement.
// Negative: a different role (even in the same family), a specific title against a broad
// word, a count, a quantity field, a contradiction, an ambiguous number and a different
// industry are all KEPT — reconciliation never removes meaning.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { reconcileRestatements, roleIdentity } from "../../../supabase/functions/_shared/restatementReconciler.ts";
import { specFromMission } from "../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { BLANK } from "../../../scripts/dev/interpretation-fuzz.ts";

type Crit = { kind: string; dimension: string; value: unknown; time_window?: { days?: number } };
const US = { field: "geography", operator: "in", value: ["United States"], reason: "US" };

function compile(query: string, proposal: Record<string, unknown>, extra: Record<string, unknown>[]) {
  const m = compileLeadMission({
    originalUserQuery: query,
    proposal: { ...BLANK, ...proposal, hard_constraints: [US, ...extra] } as never,
    requestedCount: 5,
  }).final_mission as unknown as Record<string, unknown>;
  const criteria = (m.criteria ?? []) as Crit[];
  const hiring = criteria.find((c) => c.kind === "hard" && c.dimension === "hiring");
  const q = ((hiring?.value as { qualifier?: Record<string, string[]> })?.qualifier ?? {});
  const hardKeys = specFromMission(m as never, { defaultCount: 5 }).requirements.hard.map((h) => h.key);
  return { m, criteria, q, hardKeys, constraints: Object.keys((m.hard_constraints ?? {}) as object) };
}

const AE_Q = "Find 5 US companies actively hiring Account Executives.";
const AE_P = { required_signal_terms: ["Account Executive"] };
const SALES_Q = "Find 5 US B2B companies actively hiring salespeople.";
const SALES_P = { company_types: ["B2B"], required_signal_terms: ["salespeople"] };

Deno.test("roleIdentity: registered titles by id, other role words by family, nothing else", () => {
  assertEquals(roleIdentity("AEs"), "title:account_executive");
  assertEquals(roleIdentity("account execs"), "title:account_executive");
  assertEquals(roleIdentity("SDRs"), "title:sales_development_representative");
  assertEquals(roleIdentity("salespeople"), "family:gtm_sales");
  assertEquals(roleIdentity("fintech"), null);
});

Deno.test("S1: the same role under ANY field spelling is one requirement", () => {
  for (const field of ["signal role", "target_roles", "position", "job_function", "sales_role", "hiringRole", "role.title"]) {
    const r = compile(SALES_Q, SALES_P, [{ field, operator: "equals", value: "salespeople", reason: "x" }]);
    assert(!r.hardKeys.includes("unmappable"), field);
    assert(!r.constraints.includes(field), field);
    assertEquals(r.q.role_families, ["gtm_sales"], field);
  }
});

Deno.test("S1 negative: a different role is kept as its own requirement, even in the same family", () => {
  // SDR is not the AE the signal carries: kept, not merged by family.
  const sdr = compile(AE_Q, AE_P, [{ field: "target_role", operator: "equals", value: "SDRs", reason: "x" }]);
  assert(sdr.constraints.includes("target_role"));
  // A specific title against a broad word: "Account Executive" narrows "salespeople", kept.
  const ae = compile(SALES_Q, SALES_P, [{ field: "target_role", operator: "equals", value: "Account Executive", reason: "x" }]);
  assert(ae.constraints.includes("target_role"));
  // Another family.
  const eng = compile(SALES_Q, SALES_P, [{ field: "target_role", operator: "equals", value: "software engineers", reason: "x" }]);
  assert(eng.constraints.includes("target_role"));
});

Deno.test("S1 negative: a field that names ANOTHER subject vetoes — the same value is kept (review R2)", () => {
  for (const [field, operator, value] of [
    ["previous_employer_role", "equals", "Account Executive"], ["founder_background", "equals", "Account Executive"],
    ["anything_at_all", "equals", "Account Executive"], ["zz", "excludes", "SDRs"],
  ] as const) {
    const r = compile(AE_Q, AE_P, [{ field, operator, value, reason: "x" }]);
    assert(r.constraints.includes(field), `${field}: an unforeseen field must fail loudly, not vanish`);
  }
  const q = "Find 5 US companies hiring Account Executives in the last 30 days.";
  for (const [field, operator] of [["company_age_days", "within_days"], ["founded_within_days", "within_days"], ["hiring_signal_recency", "older_than_days"]]) {
    const r = compile(q, { ...AE_P, signal_recency_days: 30 }, [{ field, operator, value: 30, reason: "x" }]);
    assert(r.constraints.includes(field), field);
  }
  const fin = compile("Find 5 US fintech companies actively hiring Account Executives.", { company_types: ["fintech"], ...AE_P },
    [{ field: "revenue_source", operator: "equals", value: "fintech", reason: "x" }]);
  assert(fin.constraints.includes("revenue_source"));
});

Deno.test("S1 negative: counts, thresholds and quantity fields are never reconciled away", () => {
  for (const c of [
    { field: "target_role", operator: "at_least", value: "salespeople" },
    { field: "sales_headcount", operator: "equals", value: "salespeople" },
    { field: "open_roles", operator: "gte", value: 5 },
    { field: "employee_count", operator: "equals", value: "salespeople" },
  ]) {
    const r = compile(SALES_Q, SALES_P, [{ ...c, reason: "x" }]);
    assert(r.constraints.includes(c.field), JSON.stringify(c));
  }
});

Deno.test("S1: an exclusion restated under any name is never discarded — lifted if not yet carried", () => {
  // Only the constraint carries the exclusion: it is LIFTED onto the hiring signal.
  for (const field of ["negative_roles", "excluded_titles", "roles_to_avoid", "exclude"]) {
    const r = compile(AE_Q, AE_P, [{ field, operator: "excludes", value: "SDRs", reason: "x" }]);
    assert((r.q.excluded_role_terms ?? []).some((t) => roleIdentity(t) === "title:sales_development_representative"), field);
    assert(!(r.q.role_terms ?? []).some((t) => roleIdentity(t) === "title:sales_development_representative"), `${field}: inverted`);
    assert(!r.hardKeys.includes("unmappable"), field);
  }
});

Deno.test("S1 negative: excluding a role the mission requires is a contradiction, kept for the gate", () => {
  const r = compile(AE_Q, AE_P, [{ field: "negative_roles", operator: "excludes", value: "Account Executives", reason: "x" }]);
  assert(r.constraints.includes("negative_roles"));
  assert(!(r.q.excluded_role_terms ?? []).length);
});

Deno.test("S1: a window restated under any name is the signal's window; a different number is kept", () => {
  const q = "Find 5 US companies hiring Account Executives in the last 30 days.";
  const same = compile(q, { ...AE_P, signal_recency_days: 30 }, [{ field: "freshness", operator: "within_days", value: 30, reason: "x" }]);
  assert(!same.constraints.includes("freshness"));
  assert(!same.hardKeys.includes("unmappable"));
  const other = compile(q, { ...AE_P, signal_recency_days: 30 }, [{ field: "freshness", operator: "within_days", value: 14, reason: "x" }]);
  assert(other.constraints.includes("freshness"));
  // A number that is also a size bound is ambiguous: kept.
  const amb = compile("Find 5 US companies with 30–200 employees hiring Account Executives in the last 30 days.",
    { ...AE_P, signal_recency_days: 30, employee_range: { min: 30, max: 200 } },
    [{ field: "freshness", operator: "within_days", value: 30, reason: "x" }]);
  assert(amb.constraints.includes("freshness"));
});

Deno.test("S1: an industry restated under any name is the stated industry; another industry is kept", () => {
  const q = "Find 5 US fintech companies actively hiring Account Executives.";
  for (const field of ["sector", "niche", "domain", "category"]) {
    const r = compile(q, { company_types: ["fintech"], ...AE_P }, [{ field, operator: "equals", value: "Fintech", reason: "x" }]);
    assert(!r.constraints.includes(field), field);
    assert(r.criteria.some((c) => c.kind === "hard" && c.dimension === "industry" && /fintech/i.test(JSON.stringify(c.value))), field);
  }
  const other = compile(q, { company_types: ["fintech"], ...AE_P }, [{ field: "sector", operator: "equals", value: "insurtech", reason: "x" }]);
  assert(other.constraints.includes("sector"));
});

Deno.test("S1: reconciliation records every removal and lift by name", () => {
  const changes: string[] = [];
  const mission = {
    company_profile: { employee_range: {}, company_types: [] },
    required_signals: [{ type: "hiring", event: "hiring", qualifier: { role_terms: ["account executives"] } }],
    hard_constraints: { target_role: { operator: "equals", value: "AEs" }, excluded_titles: { operator: "excludes", value: "SDRs" } },
  } as never;
  const out = reconcileRestatements(mission, changes) as unknown as { hard_constraints: object };
  assertEquals(Object.keys(out.hard_constraints), []);
  assertEquals(changes.map((c) => c.split(":")[0]).sort(), ["hard_constraint_deduplicated->hiring", "hard_constraint_lifted->hiring.excluded"]);
});

Deno.test("D4: roles listed separately stay a list — no alternative is lost (quality run Z08's own words)", async () => {
  const { readSignalPhrases } = await import("../../../supabase/functions/_shared/leadMissionCompiler.ts");
  const terms = ["salespeople", "sales reps", "account executives", "AEs"];
  for (const phrases of [["funding", "hiring"], ["funding", "hiring AEs"]]) {
    const hiring = readSignalPhrases(phrases, terms).find((s) => s.type === "hiring") as { qualifier?: { role_terms?: string[]; role_match?: string } };
    const got = new Set((hiring.qualifier?.role_terms ?? []).map((t) => t.toLowerCase()));
    for (const t of ["salespeople", "sales reps", "account executives", "aes"]) assert(got.has(t), `${phrases}: lost ${t}`);
    assertEquals(hiring.qualifier?.role_match, "any");
  }
  // Two titles listed separately (corpus M05): both alternatives survive, never one.
  const m05 = readSignalPhrases(["hiring"], ["SDR", "Account Executive"])[0] as { qualifier?: { role_terms?: string[] } };
  assertEquals(new Set((m05.qualifier?.role_terms ?? []).map(roleIdentity)),
    new Set(["title:sales_development_representative", "title:account_executive"]));
});
