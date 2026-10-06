// RC02 — "OR" MEANS ANY OF (quality run 2026-10-06, Fix Wave 1 step 5).
//
// "AI or developer-tools" and "Series A or Series B" are ONE requirement that any
// alternative satisfies. These tests pin the three halves of that rule and the
// false positives it must not create:
//
//   reading      only values the sentence joins by "or" (or a comma / slash in
//                such a list) become alternatives; "and" and adjacency do not
//   eligibility  hard criteria sharing `any_of` pass when one alternative passes,
//                fail only when every alternative fails; a criterion without
//                `any_of` keeps "worst result wins"
//   stage        a stage set ("series_a|series_b") is decided as one claim
//
// Pure. No network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type MissionCriterion, readFundedStageIntent, readStageIntent,
} from "../../../supabase/functions/_shared/missionCriteria.ts";
import { evaluateEligibility, checkCriterion } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { decideFundingStage, stageRequirement } from "../../../supabase/functions/_shared/fundingStageClaim.ts";

const NOW = new Date("2026-10-06T12:00:00.000Z");
let seq = 0;
const ev = (dimension: string, value: unknown, over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  evidence_id: `ev_${dimension}_${++seq}`, company_key: "c1", dimension, value, status: "proven",
  source: { provider: "apify", actor: "apify_linkedin_company_details", provider_call_id: "pc_1", url: null, excerpt: null },
  method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high",
  derived_from: [], mission_id: "t", origin: "lead_mission", ...over,
} as EvidenceItem);
const graphOf = (items: EvidenceItem[]) => buildCompanyEvidenceGraph("c1", items, { now: NOW });
const hard = (dimension: string, value: string, any_of?: string[]): MissionCriterion => ({
  id: `${dimension}:${value}`, kind: "hard", dimension, value, label: `${dimension}: ${value}`, source: "user_explicit",
  user_phrase: value, rationale: "", status: "ok", ...(any_of ? { any_of } : {}),
} as MissionCriterion);

// ── reading ─────────────────────────────────────────────────────────────────

Deno.test("RC02 reading: stages joined by 'or' are alternatives; joined by 'and' they are not", () => {
  assertEquals(readFundedStageIntent("Find companies that raised Seed or Series A.")?.alternatives, ["seed", "series_a"]);
  assertEquals(readFundedStageIntent("Find AI companies that raised Series A or Series B.")?.alternatives, ["series_a", "series_b"]);
  // Reading order, not pattern order: the first alternative is the one written first.
  assertEquals(readFundedStageIntent("Find companies that raised Series B or Seed.")?.alternatives, ["series_b", "seed"]);
  assertEquals(readFundedStageIntent("Find companies that raised Seed and Series A.")?.alternatives, undefined);
  assertEquals(readFundedStageIntent("Find companies that raised Series A.")?.alternatives, undefined);
  assertEquals(readStageIntent("Find seed or Series A companies.")?.alternatives, ["seed", "series_a"]);
});

// ── eligibility ─────────────────────────────────────────────────────────────

Deno.test("RC02 eligibility: one passing alternative satisfies the group and leaves no gap", () => {
  const anyOf = ["AI", "developer-tools"];
  const criteria = [hard("industry", "AI", anyOf), hard("industry", "developer-tools", anyOf)];
  const e = evaluateEligibility(criteria, graphOf([ev("business_model", "Artificial Intelligence")]));
  assertEquals(e.eligibility, "eligible");
  assertEquals(e.hard_checks.industry, "pass");
  assertEquals(e.gaps, [], "a satisfied group routes no purchase for its other alternatives");
  assert(e.checks.every((c) => c.result === "pass"));
});

Deno.test("RC02 eligibility: the group fails only when every alternative fails", () => {
  const anyOf = ["Germany", "France"];
  const criteria = [hard("geography", "Germany", anyOf), hard("geography", "France", anyOf)];
  assertEquals(evaluateEligibility(criteria, graphOf([ev("geography", "Paris, France")])).eligibility, "eligible");
  const toronto = evaluateEligibility(criteria, graphOf([ev("geography", "Toronto, ON, Canada")]));
  assertEquals(toronto.eligibility, "ineligible");
  assertEquals(toronto.disproven.length, 2);
});

Deno.test("RC02 eligibility: an unresolved group stays pending, and its failed alternatives cannot reject", () => {
  const anyOf = ["AI", "recruiting agencies"];
  const criteria = [hard("industry", "AI", anyOf), hard("industry", "recruiting agencies", anyOf)];
  // "Software Development" contradicts "recruiting agencies" but cannot settle "AI".
  const e = evaluateEligibility(criteria, graphOf([ev("business_model", "Software Development")]));
  assertEquals(e.eligibility, "pending");
  assertEquals(e.disproven, []);
});

Deno.test("RC02 eligibility: criteria WITHOUT any_of keep 'worst result wins' (a real AND)", () => {
  // "B2B SaaS" compiles to b2b saas + saas: refinements, not alternatives.
  const criteria = [hard("industry", "AI"), hard("industry", "developer-tools")];
  const e = evaluateEligibility(criteria, graphOf([ev("business_model", "Artificial Intelligence")]));
  assertEquals(e.eligibility, "pending", "AI passes, developer-tools is still open, and both are required");
});

// ── stage ───────────────────────────────────────────────────────────────────

const record = (rounds: Array<[string, string]>) => ({
  provider: "atomus", history_complete: true, reported_round_count: rounds.length,
  rounds: rounds.map(([round_type, announced_at]) => ({ round_type, announced_at, source_urls: ["https://news.example/r"], method: "provider_field" })),
}) as never;

Deno.test("RC02 stage: 'Series A or Series B' is decided as one set on the round ladder", () => {
  const set = "series_a|series_b";
  assertEquals(decideFundingStage({ required_stage: set, record: record([["seed", "2023-01-01"], ["series_a", "2025-01-01"]]) }).verdict, "pass");
  assertEquals(decideFundingStage({ required_stage: set, record: record([["series_a", "2024-01-01"], ["series_b", "2025-06-01"]]) }).verdict, "pass");
  const later = decideFundingStage({ required_stage: set, record: record([["series_b", "2024-01-01"], ["series_c", "2025-06-01"]]) });
  assertEquals([later.verdict, later.required_stage], ["fail", "series-a|series-b"]);
  assertEquals(decideFundingStage({ required_stage: set, record: record([["seed", "2025-01-01"]]) }).verdict, "pending");
  // A single rung decides exactly as before.
  assertEquals(decideFundingStage({ required_stage: "series_a", record: record([["series_a", "2024-01-01"], ["series_b", "2025-06-01"]]) }).verdict, "fail");
});

Deno.test("RC02 stage: a claim decided for the set answers the set criterion, and only that", () => {
  const c = { ...hard("company_stage", "series_a|series_b"), any_of: ["series_a", "series_b"] } as MissionCriterion;
  assertEquals(stageRequirement(c), "series_a|series_b");
  const claim = (required_stage: string, verdict: "pass" | "fail") =>
    ev("company_stage", { claim: "funding_stage", required_stage, verdict, explanation: `decided ${required_stage}` },
      { method: "deterministic_derivation" });
  assertEquals(checkCriterion(c, graphOf([claim("series-a|series-b", "pass")])).result, "pass");
  assertEquals(checkCriterion(c, graphOf([claim("series-b|series-a", "fail")])).result, "fail", "the set is unordered");
  assertEquals(checkCriterion(c, graphOf([claim("series-a", "pass")])).result, "unknown",
    "a claim decided for one rung does not answer the set");
});
