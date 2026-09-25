// LEAD V2 P6 — THE FUNDING PAIR, REPLAYED ON THE LIVE PROBE IT WAS PROVEN ON.
//
// 2026-09-21, Wordware (wordware.ai), preserved verbatim in
// `docs/audits/live-validation-2026-09-21/`. The probe is what promoted the
// pair to EXPERIMENTAL, so the promotion is only as true as this file:
//
//   atomus   3 dated rounds, `num_funding_rounds: 3`  → COMPLETENESS, 0 citations
//   pvalyou  the same Seed round, 4 source URLs        → PROVENANCE, no count
//
// Neither answers the claim alone. Together they do. These tests read the real
// provider payloads — not fixtures written from a README — so a change to the
// normalizers, the merge window or the decision that would have broken the
// live run breaks here instead.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  corroborateFunding, decideCorroboratedFundingStage,
  normalizeAtomusFunding, normalizePvalyouFunding,
} from "../../../supabase/functions/_shared/fundingCorroboration.ts";
import { readinessOf } from "../../../supabase/functions/_shared/actorIntelligence.ts";
import { PRODUCTION_READINESS, readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { CLAIM_REGISTRY } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";

const dir = "../../../docs/audits/live-validation-2026-09-21/";
const read = (f: string) => JSON.parse(Deno.readTextFileSync(new URL(dir + f, import.meta.url)));
const ATOMUS = normalizeAtomusFunding(read("probe_atomus.json")[0]).record!;
const PVALYOU = normalizePvalyouFunding(read("probe_pvalyou.json")[0]).record!;
const ATOMUS_PAIR = "apify_funding_atomus|funding_verification";
const PVALYOU_PAIR = "apify_funding_pvalyou|funding_verification";

Deno.test("LIVE: what each provider actually returned for Wordware", () => {
  // atomus: the count IS the completeness, and there is not one citation.
  assertEquals(ATOMUS.reported_round_count, 3);
  assertEquals(ATOMUS.rounds.length, 3);
  assertEquals(ATOMUS.rounds.flatMap((r) => r.source_urls).length, 0, "atomus cites nothing");
  assertEquals(ATOMUS.rounds.map((r) => r.announced_date), ["2024-11-21", "2024-04-30", "2023-01-01"]);

  // pvalyou: citations, and a count that is only what it holds.
  assertEquals(PVALYOU.reported_round_count, null, "pvalyou's count is never completeness");
  const seed = PVALYOU.rounds.find((r) => /seed/i.test(r.round_type ?? ""))!;
  assertEquals(seed.announced_date, "2024-11-21");
  assertEquals(seed.source_urls.length, 4, "four cited announcements");
});

Deno.test("LIVE: the merge lends citations to the round atomus dated, and keeps completeness", () => {
  const c = corroborateFunding({ atomus: ATOMUS, pvalyou: PVALYOU });
  assertEquals(c.conflicts, [], "the two agree");
  assertEquals(c.corroborated_rounds, 1, "the Seed round is the one both hold");
  assertEquals(c.record!.reported_round_count, 3, "atomus's true count survives an agreement");
  const merged = c.record!.rounds.find((r) => /seed/i.test(r.round_type ?? ""))!;
  assertEquals(merged.announced_date, "2024-11-21");
  assertEquals(merged.source_urls.length, 4, "the dated round now cites");
  // pvalyou's accelerator carries no rung: it neither confirms nor contradicts.
  assertEquals(c.record!.rounds.length, 3, "no phantom round was appended");
});

Deno.test("LIVE: neither provider can answer alone — the pair is the verifier", () => {
  const alone = (i: { atomus: typeof ATOMUS | null; pvalyou: typeof PVALYOU | null }) =>
    decideCorroboratedFundingStage({ required_stage: "seed", ...i }).decision;
  const a = alone({ atomus: ATOMUS, pvalyou: null });
  assertEquals([a.verdict, a.reasons], ["pending", ["required_stage_uncorroborated"]]);
  const p = alone({ atomus: null, pvalyou: PVALYOU });
  assertEquals([p.verdict, p.reasons], ["pending", ["history_incomplete"]]);
  const pair = alone({ atomus: ATOMUS, pvalyou: PVALYOU });
  assertEquals([pair.verdict, pair.reasons], ["pass", ["required_stage_verified_and_latest"]]);
  assertEquals(pair.carrier_rounds.length, 1);
  assertEquals(pair.carrier_rounds[0].source_urls.length, 4, "the PASS rests on a cited round");
});

Deno.test("LIVE: the same evidence answers the other rungs honestly", () => {
  const d = (stage: string) =>
    decideCorroboratedFundingStage({ required_stage: stage, atomus: ATOMUS, pvalyou: PVALYOU }).decision;
  assertEquals(d("pre-seed").verdict, "fail", "a verified Seed is later than pre-seed");
  assertEquals(d("series-a").verdict, "pending", "nothing proves a Series A it has not raised");
  assertEquals(d("series-a").reasons, ["required_stage_not_verified"]);
});

// ── THE PROMOTION THE PROBE EARNED, AND THE ONE IT DID NOT ──────────────────

Deno.test("READINESS: the pair is READY together, with the spine canary named", () => {
  const a = readinessOf("apify_funding_atomus", "funding_verification");
  const p = readinessOf("apify_funding_pvalyou", "funding_verification");
  assertEquals([a.readiness, p.readiness], ["READY", "READY"],
    "promoted as a pair — never one without the other");
  for (const r of [a, p]) {
    // READY means live-proven THROUGH the spine: the 2026-09-23 canary, with
    // this half's own provider call named.
    assert(r.live_evidence?.includes("de24f92c") && r.live_evidence.includes("full spec spine"),
      `${r.actor}: the spine canary that proved it is named`);
    assert(/pc_[0-9a-f]{26}/.test(r.live_evidence ?? ""), `${r.actor}: its own provider call is named`);
    assert(r.gated_by?.includes("pair"), `${r.actor}: the record says it cannot answer alone`);
  }
});

Deno.test("READINESS: production runs the READY pair; an EXPERIMENTAL pair runs only where it is named", () => {
  const notReady = readinessPolicy({ overrides: {
    [ATOMUS_PAIR]: "EXPERIMENTAL", [PVALYOU_PAIR]: "EXPERIMENTAL",
  } });
  for (const pair of [ATOMUS_PAIR, PVALYOU_PAIR]) {
    const [actor, capability] = pair.split("|");
    assertEquals(PRODUCTION_READINESS.decide(actor, capability).via, "ready",
      `${actor} runs in an ordinary production mission`);
    assertFalse(notReady.decide(actor, capability).executable, `${actor}: EXPERIMENTAL is not a licence to run`);
    const allowed = readinessPolicy({ overrides: { [ATOMUS_PAIR]: "EXPERIMENTAL", [PVALYOU_PAIR]: "EXPERIMENTAL" },
      allow_experimental: [ATOMUS_PAIR, PVALYOU_PAIR] });
    assertEquals(allowed.decide(actor, capability).via, "experimental_allowed");
  }
});

Deno.test("READINESS: allowing ONE of the pair still cannot produce a PASS", () => {
  // The architectural guarantee, not merely a table convention: a PASS must
  // cite, and only pvalyou (or a discovered round) carries a citation; a FAIL
  // needs a later verified round, which only atomus's history can show.
  const atomusOnly = decideCorroboratedFundingStage({
    required_stage: "seed", atomus: ATOMUS, pvalyou: null,
  }).decision;
  assertEquals(atomusOnly.verdict, "pending");
  const pvalyouOnly = decideCorroboratedFundingStage({
    required_stage: "seed", atomus: null, pvalyou: PVALYOU,
  }).decision;
  assertEquals(pvalyouOnly.verdict, "pending");
});

Deno.test("THE ROUTE: one pair route answers both funding claims, and names both actors", () => {
  const stage = CLAIM_REGISTRY.find((c) => c.claim === "funding_stage")!;
  const recent = CLAIM_REGISTRY.find((c) => c.claim === "recently_funded")!;
  assertEquals(stage.routes.length, 1);
  // The pair route, and for recency only the conditional Pvalyou fallback,
  // which is locked until Atomus has answered (`after_actor`).
  assertEquals(recent.routes.length, 2, "recently_funded is routed, not deferred");
  assertEquals(recent.routes[1].actor, "apify_funding_pvalyou");
  assertEquals(recent.routes[1].after_actor, "apify_funding_atomus");
  assertEquals(stage.routes[0], recent.routes[0], "the same route object: one pair, two claims");
  const r = stage.routes[0];
  assertEquals(r.actor, "apify_funding_atomus");
  assert(r.evidence_actors.includes("apify_funding_pvalyou"), "pvalyou travels with it");
  assert(r.evidence_actors.includes("funding_corroboration"), "and the merged record answers for both");
  assertFalse("deferred_to" in recent && !!recent.deferred_to, "no longer deferred to P6");
});
