// CANARY SESSION 2 — WHY THREE HIRING-VERIFIED COMPANIES COULD NEVER QUALIFY.
//
// GitHub Actions run 41051862651, queue 763fc2b9-63fb-40be-a3d0-0cd3dded59b1,
// "Find one US company hiring Account Executives that raised funding within
// the last six months." The fixture is the run's real gpt-5.6-luna proposal,
// verbatim from its public canary-session artifact (kickoff/kickoff.json).
//
// The proposal restated the hiring signal in `hard_constraints`
// (`hiring currently_hiring "Account Executives"`). That compiled to a second
// HARD criterion with dimension `constraint`, which no evidence dimension
// answers, so every candidate kept an unknown hard check with no route,
// `canStillQualify` was false for all three, and the funding verifier (Atomus)
// was never targeted. The D7 gate passed it because the criterion's status was
// "ok". No network, no database.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { prepareKickoff, type KickoffInput } from "../../../scripts/test-project/real-gpt/prepareKickoff.ts";
import { judgeDemoFundingInterpretation } from "../../../scripts/test-project/real-gpt/demoFundingJudge.ts";
import { deriveMissionCriteria, restatesHiringSignal } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { canStillQualify, evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { EVIDENCE_GRAPH_VERSION } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { restatesFundingWindow } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { assessRequestFeasibility } from "../../../supabase/functions/_shared/requestFeasibility.ts";
import { evaluatorAnswered, notEvaluated, FALLBACK_INSUFFICIENT } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

const read = (p: string) => Deno.readTextFileSync(new URL(`../../../${p}`, import.meta.url));
const REAL_PROPOSAL = JSON.parse(read("docs/launch/proposals/canary-session-2-real-gpt-proposal.json"));
const CANARY_CATALOG = JSON.parse(read("docs/launch/proposals/smoke-catalog-canary-funding.json"));

const canaryInput = (proposal: unknown): KickoffInput => ({
  scenario: "canary_funding", project_ref: "abcdefghijklmnopqrst",
  workspace_id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222",
  queue_id: "33333333-3333-4333-8333-333333333333", plan_id: "44444444-4444-4444-8444-444444444444",
  pricing_version: "contract", catalog: CANARY_CATALOG.approved_quotes,
  prices: { jobs_maximum_microusd: 4000, details_maximum_microusd: 4050, atomus_maximum_microusd: 10550,
    observed_at: "2026-10-28T00:00:00Z", source: "test" },
  compile: () => Promise.resolve(structuredClone(proposal)),
});

type Crit = { id: string; kind: string; dimension: string; status?: string };
const hardOf = (m: { criteria?: unknown }) => ((m.criteria ?? []) as Crit[]).filter((c) => c.kind === "hard");

Deno.test("canary 2: the real proposal compiles to exactly geography, hiring and funding as hard — no hard `constraint`", async () => {
  const k = await prepareKickoff(canaryInput(REAL_PROPOSAL));
  const hard = hardOf(k.compiled_mission as never);
  assertEquals(hard.map((c) => c.dimension).sort(), ["funding", "geography", "hiring"]);
  assertEquals(k.interpretation.map((v) => `${v.id}:${v.result}`),
    ["D1:PASS", "D2:PASS", "D3:PASS", "D4:PASS", "D5:PASS", "D6:PASS", "D7:PASS"]);
});

Deno.test("canary 2: D7 FAILS a hard criterion no evidence dimension answers, even with status ok", async () => {
  const k = await prepareKickoff(canaryInput(REAL_PROPOSAL));
  const m = structuredClone(k.compiled_mission) as { criteria: Crit[] };
  m.criteria.push({ id: "constraint:_field_hiring_value_account_executives_", kind: "hard", dimension: "constraint", status: "ok" });
  const d7 = judgeDemoFundingInterpretation(m as never, 1).find((v) => v.id === "D7")!;
  assertEquals(d7.result, "FAIL");
  // A TARGET constraint only ranks: never a D7 failure.
  m.criteria[m.criteria.length - 1].kind = "target";
  assertEquals(judgeDemoFundingInterpretation(m as never, 1).find((v) => v.id === "D7")!.result, "PASS");
});

Deno.test("canary 2: with hiring and geography proven, the funding gap is the only one and it routes to the verifier", async () => {
  const k = await prepareKickoff(canaryInput(REAL_PROPOSAL));
  const criteria = deriveMissionCriteria(k.compiled_mission as never, PRODUCTION_READINESS).filter((c) => c.kind === "hard");
  // As the canary's evaluator would have it with HQ read: hiring and geography
  // proven, everything else still unknown (a `constraint` stays unknown forever).
  const proven = new Set(["hiring", "geography"]);
  const checks = criteria.map((c) => ({
    criterion_id: c.id, dimension: c.dimension,
    result: proven.has(c.dimension) ? "pass" : "unknown",
    reason: proven.has(c.dimension) ? "proven" : "no evidence yet",
  }));
  const graph = { version: EVIDENCE_GRAPH_VERSION, company_key: "k", claims: [], gaps: [], conflicts: [], item_count: 0 };
  const gaps = evidenceGapsFor(checks, graph as never);
  assertEquals(gaps.map((g) => g.dimension), ["funding"]);
  assertEquals(gaps[0].next, "verify");
  assertEquals(gaps[0].route?.actor, "apify_funding_atomus");
  assert(canStillQualify(gaps), "the candidate can still qualify, so the verification phase targets it");
});

Deno.test("restatesHiringSignal: only an equal restatement of the one hiring signal is skipped", () => {
  const sig = [{ type: "hiring", event: "hiring", qualifier: { role_terms: ["account executives"] } }] as never;
  // The canary's own entry, and its obvious spellings.
  assert(restatesHiringSignal("hiring", { operator: "currently_hiring", value: "Account Executives" }, sig));
  assert(restatesHiringSignal("hiring", { operator: "currently_hiring", value: "Account Executive" }, sig));
  assert(restatesHiringSignal("hiring_roles", { operator: "in", value: ["account executives"] }, sig));
  // A different role, an extra role, an exclusion, an unknown operator or field: kept.
  assert(!restatesHiringSignal("hiring", { operator: "currently_hiring", value: "SDRs" }, sig));
  assert(!restatesHiringSignal("hiring", { operator: "currently_hiring", value: ["Account Executives", "SDRs"] }, sig));
  assert(!restatesHiringSignal("hiring", { operator: "not_hiring", value: "Account Executives" }, sig));
  assert(!restatesHiringSignal("hiring", { operator: "greater_than", value: "Account Executives" }, sig));
  assert(!restatesHiringSignal("sales_headcount", { operator: "equals", value: "Account Executives" }, sig));
  // No hiring signal, or two: nothing is assumed.
  assert(!restatesHiringSignal("hiring", { operator: "currently_hiring", value: "Account Executives" }, [] as never));
  assert(!restatesHiringSignal("hiring", { operator: "currently_hiring", value: "Account Executives" },
    [...(sig as unknown[]), ...(sig as unknown[])] as never));
});

// ── THE ROOT FIXES, EACH ON ITS OWN (fault-injection targets) ────────────────

Deno.test("a genuinely DISTINCT stated requirement is kept hard — and disclosed as unprovable, never 'ok'", async () => {
  const k = await prepareKickoff(canaryInput(REAL_PROPOSAL));
  const m = structuredClone(k.compiled_mission) as unknown as LeadMissionV1;
  // A requirement the user could state that no evidence dimension answers.
  m.original_user_query = "Find one US company hiring Account Executives with at least 11 SDRs that raised funding within the last six months.";
  m.hard_constraints = { ...m.hard_constraints, sales_headcount: { operator: ">=", value: "11 SDRs" } } as never;
  delete (m as { criteria?: unknown }).criteria;
  const c = deriveMissionCriteria(m, PRODUCTION_READINESS).find((x) => x.dimension === "constraint")!;
  assert(c, "kept: it is not a restatement");
  assertEquals([c.kind, c.status], ["hard", "unprovable_today"]);
  const f = assessRequestFeasibility(m, buildCapabilityGraph(m, { executability: "enforce", readiness: PRODUCTION_READINESS }),
    { executability: "enforce", readiness: PRODUCTION_READINESS });
  assert((f.constraints ?? []).some((x) => x.requirement === c.id && x.status === "unsupported"), "disclosed at approval by name");
  assertEquals(judgeDemoFundingInterpretation({ ...m, criteria: deriveMissionCriteria(m, PRODUCTION_READINESS) } as never, 1)
    .find((v) => v.id === "D7")!.result, "FAIL");
});

Deno.test("restatesFundingWindow: only the same window on a funding field is a restatement", () => {
  const sig = [{ type: "funding", event: "funding", timeframe_days: 180 }] as never;
  assert(restatesFundingWindow("funding_event", { operator: "announced_within_last_days", value: 180 }, sig));
  assert(restatesFundingWindow("funding_event", { operator: "within_days", value: "180" }, sig));
  assert(!restatesFundingWindow("funding_event", { operator: "announced_within_last_days", value: 90 }, sig), "a different window");
  assert(!restatesFundingWindow("funding_amount", { operator: ">=", value: 180 }, sig), "an amount is another requirement");
  assert(!restatesFundingWindow("funding_event", { operator: "greater_than", value: 180 }, sig));
  assert(!restatesFundingWindow("funding_event", { operator: "within_days", value: 180 }, [] as never));
});

Deno.test("the company-details route is 'tried' only by the company record, never by a job row's LinkedIn label", () => {
  // The evidence registry labels ANY LinkedIn-derived field "linkedin" — the
  // job-search row's company location included (leadEvidenceRegistry).
  const claim = (actor: string) => ({
    dimension: "geography", sources: [actor], current: null, supporting: [], conflicting: [], stale: [],
  });
  const graph = (actor: string) =>
    ({ version: EVIDENCE_GRAPH_VERSION, company_key: "k", claims: [claim(actor)], gaps: [], conflicts: [], item_count: 1 });
  const check = [{ criterion_id: "geography:united_states", dimension: "geography", result: "unknown", reason: "hq not established" }];
  const jobRow = evidenceGapsFor(check, graph("linkedin") as never)[0];
  assertEquals([jobRow.next, jobRow.route?.actor], ["verify", "apify_linkedin_company_details"]);
  const fetched = evidenceGapsFor(check, graph("apify_linkedin_company_details") as never)[0];
  assertEquals(fetched.next, "blocked", "a fetched record is not bought again");
});

Deno.test("evaluatorAnswered: a failed call's placeholder and notEvaluated are never an evaluation", () => {
  const unparsed = { ...FALLBACK_INSUFFICIENT, criterion_verdicts: [
    { criterion_id: "a", result: "unknown" as const, reason: "not_an_object", evidence: [], origin: "unparsed" as const },
  ] };
  assertEquals(evaluatorAnswered(unparsed), false);
  assertEquals(evaluatorAnswered({ ...FALLBACK_INSUFFICIENT }), false, "no rows, the fallback's own reasoning");
  assertEquals(evaluatorAnswered(notEvaluated("budget spent")), false);
  assertEquals(evaluatorAnswered(null), false);
  const answered = { ...FALLBACK_INSUFFICIENT, reasoning: "funding is not established", criterion_verdicts: [
    { criterion_id: "a", result: "unknown" as const, reason: "no round supplied", evidence: [], origin: "abstained" as const },
  ] };
  assertEquals(evaluatorAnswered(answered), true, "a model's own 'unknown' IS an answer");
});
