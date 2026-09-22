// LEAD V2 P6 — A STAGE IS AN ORDERING OVER VERIFIED ROUNDS, NOT A STRING.
//
// §12's decision table, and §30's invariants:
//
//   verified Seed + no later round => support
//   later Series A/B/C            => contradiction
//   unknown funding               => pending
//
// The mutants these must catch (§31): "funding unknown becomes Seed" and
// "substring match gives false positive".
//
// PURE — no provider, no network, no clock.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideFundingStage, fundingStageEvidenceItem, isVerifiedRound, normalizeRoundType,
  stageRank, type FundingRecordFact, type FundingRoundFact,
} from "../../../supabase/functions/_shared/fundingStageClaim.ts";
import { checkCriterion } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { CLAIM_REGISTRY } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { PRODUCTION_READINESS, readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { readinessOf } from "../../../supabase/functions/_shared/actorIntelligence.ts";
import { HIRING_ACTOR_CATALOG } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import { ACTOR_INPUT_CONTRACTS } from "../../../supabase/functions/_shared/actorInputContracts.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";

const NOW = "2026-09-19T12:00:00.000Z";

const round = (o: Partial<FundingRoundFact> & { round_type: string | null }): FundingRoundFact => ({
  announced_date: "2026-03-01", amount_usd: 2_500_000, investors: ["Acme Ventures"],
  source_urls: ["https://techcrunch.com/seed"], method: "provider_field", ...o,
});
const record = (o: Partial<FundingRecordFact> & { rounds: FundingRoundFact[] }): FundingRecordFact => ({
  provider: "apify", actor: "some_funding_actor", reported_round_count: o.rounds.length,
  history_complete: true, observed_at: NOW, source_url: null, ...o,
});

// ── §30: verified Seed + no later round => support ────────────────────────────

Deno.test("verified seed with a complete history and no later round PASSES", () => {
  const d = decideFundingStage({
    required_stage: "seed",
    record: record({ rounds: [round({ round_type: "Pre-Seed", amount_usd: 500_000 }), round({ round_type: "Seed" })] }),
  });
  assertEquals(d.verdict, "pass");
  assertEquals(d.highest_verified_stage, "seed");
  assertEquals(d.reasons, ["required_stage_verified_and_latest"]);
  // It cites the seed round, not the pre-seed one.
  assertEquals(d.carrier_rounds.map((r) => normalizeRoundType(r.round_type)), ["seed"]);
});

Deno.test("funding that carries no rung never blocks a PASS", () => {
  // A bridge, a SAFE, venture debt and a secondary sale are all AFTER the seed
  // in time and none of them is a later STAGE.
  const d = decideFundingStage({
    required_stage: "seed",
    record: record({ rounds: [
      round({ round_type: "seed" }), round({ round_type: "bridge" }),
      round({ round_type: "SAFE" }), round({ round_type: "Post-IPO Debt" }),
      round({ round_type: "secondary_market" }),
    ] }),
  });
  assertEquals(d.verdict, "pass");
});

// ── §30: later Series A/B/C => contradiction ─────────────────────────────────

Deno.test("a verified later round FAILS, and needs no complete history to do it", () => {
  const d = decideFundingStage({
    required_stage: "seed",
    record: record({
      rounds: [round({ round_type: "seed" }), round({ round_type: "series-b", amount_usd: 40_000_000 })],
      // The provider holds more rounds than it returned: PASS would be
      // impossible here, but a FAIL only needs the round it did return.
      reported_round_count: 9, history_complete: false,
    }),
  });
  assertEquals([d.verdict, d.reasons[0]], ["fail", "later_round_verified"]);
  assertEquals(d.carrier_rounds.map((r) => normalizeRoundType(r.round_type)), ["series-b"]);
});

Deno.test("an UNVERIFIED later round withholds the pass but never fails", () => {
  const d = decideFundingStage({
    required_stage: "seed",
    record: record({ rounds: [
      round({ round_type: "seed" }),
      // No citation of any kind: a bare assertion of a Series A.
      round({ round_type: "series-a", announced_date: null, source_urls: [] }),
    ] }),
  });
  assertEquals([d.verdict, d.reasons[0]], ["pending", "later_round_unverified"]);
  assertEquals(d.highest_unverified_stage, "series-a");
});

// ── §30: unknown funding => pending. §31 mutant: "funding unknown becomes Seed" ─

Deno.test("MUTANT — unknown funding must never become a stage", () => {
  const cases: Array<[string, FundingRecordFact | null]> = [
    ["no record at all", null],
    ["a record with no rounds", record({ rounds: [] })],
    ["rounds with no usable type", record({ rounds: [round({ round_type: "Venture Round" }), round({ round_type: null })] })],
  ];
  for (const [what, rec] of cases) {
    const d = decideFundingStage({ required_stage: "seed", record: rec });
    assertEquals(d.verdict, "pending", what);
    // And the pending claim writes NOTHING — an `unknown` item in the graph is
    // something eligibility could mistake for an answer.
    if (rec) {
      assertEquals(fundingStageEvidenceItem({
        company_key: "c", decision: d, record: rec, mission_id: "m",
        provider_call_id: null, observed_at: NOW,
      }), null, what);
    }
  }
});

Deno.test("a model-extracted round type is corroboration, never the classifier", () => {
  // §12: Firecrawl "should not be the primary funding-stage classifier".
  const d = decideFundingStage({
    required_stage: "seed",
    record: record({ rounds: [round({ round_type: "seed", method: "model_extraction" })] }),
  });
  assertEquals(d.verdict, "pending");
  assert(d.reasons.includes("model_extraction_only"));
  assert(d.corroborated_by_model);
  // The same page read as a Series C cannot fail the claim either.
  const f = decideFundingStage({
    required_stage: "seed",
    record: record({ rounds: [round({ round_type: "series-c", method: "model_extraction" })] }),
  });
  assertEquals(f.verdict, "pending");
});

Deno.test("a partial history cannot PASS — 'no later round' is a claim about rounds we have not seen", () => {
  // Exactly the memo23 probe: round types readable, 10 of 25 rounds returned.
  const d = decideFundingStage({
    required_stage: "seed",
    record: record({ rounds: [round({ round_type: "seed" })], reported_round_count: 25, history_complete: null }),
  });
  assertEquals([d.verdict, d.reasons[0]], ["pending", "history_incomplete"]);
  assert(d.explanation.includes("25"));

  // And a provider that simply does not say is treated the same way.
  const silent = decideFundingStage({
    required_stage: "seed",
    record: record({ rounds: [round({ round_type: "seed" })], reported_round_count: null, history_complete: null }),
  });
  assertEquals([silent.verdict, silent.reasons[0]], ["pending", "history_incomplete"]);
});

Deno.test("an earlier verified round is not the asked-for stage and not a contradiction", () => {
  const d = decideFundingStage({
    required_stage: "seed", record: record({ rounds: [round({ round_type: "pre-seed" })] }),
  });
  assertEquals([d.verdict, d.reasons[0]], ["pending", "required_stage_not_verified"]);
  assertEquals(d.highest_verified_stage, "pre-seed");
});

Deno.test("a stage that is not a funding round is refused, not answered", () => {
  for (const want of ["bootstrapped", "growth-stage startup", "", null]) {
    const d = decideFundingStage({
      required_stage: want, record: record({ rounds: [round({ round_type: "seed" })] }),
    });
    assertEquals([d.verdict, d.reasons[0]], ["pending", "unrequestable_stage"], String(want));
    assertEquals(d.required_stage, null);
  }
});

// ── Nothing but rounds can reach the decision ────────────────────────────────

Deno.test("the decision reads rounds ONLY — age, size and branding are not parameters", () => {
  // §12: "Do not infer stage from company age, branding, team size, or GPT
  // intuition." The guarantee here is structural: the only inputs are the
  // required stage and a funding record, so there is nothing else to infer from.
  const keys = Object.keys(record({ rounds: [] })).sort();
  assertEquals(keys, [
    "actor", "history_complete", "observed_at", "provider",
    "reported_round_count", "rounds", "source_url",
  ]);
  const roundKeys = Object.keys(round({ round_type: "seed" })).sort();
  assertEquals(roundKeys, [
    "amount_usd", "announced_date", "investors", "method", "round_type", "source_urls",
  ]);
});

Deno.test("round labels normalize by rung, and the ladder orders them", () => {
  assertEquals(normalizeRoundType("Series A"), "series-a");
  assertEquals(normalizeRoundType("series_a"), "series-a");
  assertEquals(normalizeRoundType("PreSeed"), "pre-seed");
  assertEquals(normalizeRoundType("secondary_market"), "secondary");
  assertEquals(normalizeRoundType("something new"), "unknown");
  assert((stageRank("series-b") as number) > (stageRank("series-a") as number));
  assert((stageRank("series-a") as number) > (stageRank("seed") as number));
  assert((stageRank("seed") as number) > (stageRank("pre-seed") as number));
  // Non-ordinal funding has no rung at all.
  for (const t of ["bridge", "debt", "grant", "safe", "secondary", "unknown"]) assertEquals(stageRank(t), null);
  assertEquals(isVerifiedRound(round({ round_type: "seed", announced_date: null, source_urls: [] })), false);
  assertEquals(isVerifiedRound(round({ round_type: "seed", source_urls: [] })), true); // dated
});

// ── The claim reaches eligibility as a verdict, not as text ──────────────────

const criterion = (value: string): MissionCriterion => ({
  id: "company_stage:seed", dimension: "company_stage", kind: "hard", value,
  source: "user", label: `stage ${value}`,
} as MissionCriterion);

function graphWith(decisionValue: unknown, status: "proven" | "disproven") {
  return buildCompanyEvidenceGraph("c", [{
    evidence_id: "fnd_c_funding_stage", company_key: "c", dimension: "company_stage",
    value: decisionValue, status,
    source: { provider: "apify", actor: "some_funding_actor", provider_call_id: null, url: null, excerpt: null },
    method: "deterministic_derivation", observed_at: NOW, valid_until: null,
    confidence: "high", derived_from: [], mission_id: "m", origin: "lead_mission",
  }], { now: new Date(NOW) });
}

Deno.test("a PASS item passes the stage criterion and a FAIL item fails it, by verdict", () => {
  const rec = record({ rounds: [round({ round_type: "seed" })] });
  const pass = fundingStageEvidenceItem({
    company_key: "c", decision: decideFundingStage({ required_stage: "seed", record: rec }),
    record: rec, mission_id: "m", provider_call_id: null, observed_at: NOW,
  })!;
  assertEquals([pass.dimension, pass.status, pass.method], ["company_stage", "proven", "deterministic_derivation"]);
  // Stable identity: a better reading REPLACES this claim rather than stacking.
  assertEquals(pass.evidence_id, "fnd_c_funding_stage");
  assertEquals(checkCriterion(criterion("seed"), graphWith(pass.value, "proven")).result, "pass");

  const failRec = record({ rounds: [round({ round_type: "seed" }), round({ round_type: "series-b" })] });
  const fail = fundingStageEvidenceItem({
    company_key: "c", decision: decideFundingStage({ required_stage: "seed", record: failRec }),
    record: failRec, mission_id: "m", provider_call_id: null, observed_at: NOW,
  })!;
  assertEquals(fail.status, "disproven");
  const check = checkCriterion(criterion("seed"), graphWith(fail.value, "disproven"));
  assertEquals(check.result, "fail");
  assert(check.reason.includes("series-b"));
});

Deno.test("MUTANT — a stage label must not pass by substring", () => {
  // The pre-P6 path compared "seed" against JSON text. A record that merely
  // MENTIONS seed while being a Series C must not pass.
  const value = {
    claim: "funding_stage", required_stage: "seed", verdict: "fail",
    latest_verified_stage: "series-c", explanation: "a verified series-c round is later than seed",
  };
  assertEquals(checkCriterion(criterion("seed"), graphWith(value, "disproven")).result, "fail");
  // And a verdict decided for a DIFFERENT stage does not answer this criterion.
  const other = { ...value, required_stage: "series-a", verdict: "pass" };
  const r = checkCriterion(criterion("seed"), graphWith(other, "proven"));
  assertEquals(r.result, "unknown");
});

Deno.test("a missing funding claim leaves the criterion unknown — absence is never a fail", () => {
  const empty = buildCompanyEvidenceGraph("c", [], { now: new Date(NOW) });
  assertEquals(checkCriterion(criterion("seed"), empty).result, "unknown");
});

// ── The route is carded honestly and stays non-executable ────────────────────

Deno.test("a funding route executes once a verifier is proven LIVE — readiness, not the executor, is the gate", () => {
  // P6 built the executor (`fundingStageVerifier`), so the route carries
  // `canonical_executor: true`. Actor Intelligence is what opens it: the pair
  // was EXPERIMENTAL after the 2026-09-21 probe (live data, outside this
  // pipeline) and became READY after the 2026-09-22 known-company canary ran a
  // HARD funding claim through the spine (task 3f082b22).
  const claim = CLAIM_REGISTRY.find((c) => c.claim === "funding_stage")!;
  assertEquals(claim.routes.map((r) => [r.actor, r.canonical_executor]), [["apify_funding_atomus", true]]);
  assertEquals(readinessOf("apify_funding_atomus", "funding_verification").readiness, "READY");
  assertEquals(readinessOf("apify_funding_pvalyou", "funding_verification").readiness, "READY");
  assert(PRODUCTION_READINESS.decide("apify_funding_atomus", "funding_verification").executable);
  assert(PRODUCTION_READINESS.decide("apify_funding_pvalyou", "funding_verification").executable);
  // The gate is still readiness: take it away and the route closes again.
  const notReady = readinessPolicy({ overrides: {
    "apify_funding_atomus|funding_verification": "EXPERIMENTAL",
    "apify_funding_pvalyou|funding_verification": "EXPERIMENTAL",
  } });
  assertFalse(notReady.decide("apify_funding_atomus", "funding_verification").executable,
    "EXPERIMENTAL is not a licence to run");
});

Deno.test("the datahyena card carries the price and schema the Store actually publishes", () => {
  const card = HIRING_ACTOR_CATALOG.apify_funding_rounds_datahyena;
  // Re-read live 2026-09-19: BRONZE $0.07/result since 2026-09-12, was $0.045.
  assertEquals(card.cost_model.per_result_usd, 0.07);
  assertEquals(card.cost_model.events_usd?.result, 0.07);
  assertEquals(card.schema_build, "store-modified-2026-09-18");
  assertEquals(card.last_verified_at, "2026-09-19");
  // Fields the live schema has, and fields it does NOT have.
  assert(card.supported_filters.includes("enrichedOnly"));
  for (const gone of ["country", "industryGroup"]) {
    assertEquals(card.supported_filters.includes(gone), false, gone);
  }
  const contract = ACTOR_INPUT_CONTRACTS.apify_funding_rounds_datahyena;
  const names = contract.fields.map((f) => f.name);
  assert(names.includes("enrichedOnly"));
  for (const gone of ["country", "industryGroup"]) assertEquals(names.includes(gone), false, gone);
  // The catalog price and the contract's stated price must not drift apart.
  assert(contract.quality.note.includes("$0.07"));
});
