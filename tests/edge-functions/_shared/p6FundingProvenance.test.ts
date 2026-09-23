// LEAD V2 P6 — BOTH PAID CALLS SURVIVE THE MERGE, AND SAY WHAT THEY PROVED.
//
// Canary abc316e8 (Wordware, 2026-09-23) bought two funding reads:
//
//   atomus   pc_03d345aead2bf83f116a0ea0d3   the rounds, and the TRUE count (3)
//   pvalyou  pc_ef441d8c24d849bdba77219e86   the Seed round's source URLs
//
// Both executed and settled, and the canonical evidence kept one of them: the
// merged funding record carried `provider_call_id: null` and the Seed PASS cited
// only pvalyou — while "no later round in a complete history" is atomus's.
//
// These tests pin the provenance model that replaced it:
//
//   a round        → `provenance`: who REPORTED it, who CITED it (role-exact)
//   a record       → `provider_call_ids`: every call it was built from;
//                    `completeness`: whose count licenses "no later round"
//   a verdict      → `value.provenance`: event sources, the completeness it
//                    relied on (PASS only), every material call; `derived_from`
//                    the funding-record evidence it read

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  corroborateFunding, decideCorroboratedFundingStage, fundingRecordEvidenceItem, fundingRecordsInGraph,
  normalizeAtomusFunding, normalizePvalyouFunding, stampFundingCall,
} from "../../../supabase/functions/_shared/fundingCorroboration.ts";
import {
  decideFundingStage, decideRecentlyFunded, dedupeCallIds, fundingDecisionProvenance, fundingStageEvidenceItem,
  recordCallIds, type FundingDecisionProvenance, type FundingRecordFact, type FundingRoundFact,
} from "../../../supabase/functions/_shared/fundingStageClaim.ts";
import { fundingStageVerifier } from "../../../supabase/functions/_shared/fundingStageVerifier.ts";
import type {
  VerificationTarget, VerifierCall, VerifierCallOutcome, VerifierDeps,
} from "../../../supabase/functions/_shared/claimVerifier.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";

const dir = "../../../docs/audits/live-validation-2026-09-21/";
const read = (f: string) => JSON.parse(Deno.readTextFileSync(new URL(dir + f, import.meta.url)));
const ATOMUS_ROW = read("probe_atomus.json")[0] as Record<string, unknown>;
const PVALYOU_ROW = read("probe_pvalyou.json")[0] as Record<string, unknown>;

const ATOMUS_CALL = "pc_03d345aead2bf83f116a0ea0d3";
const PVALYOU_CALL = "pc_ef441d8c24d849bdba77219e86";
const KEY = "https://www.linkedin.com/company/wordware";

const ATOMUS = stampFundingCall(normalizeAtomusFunding(ATOMUS_ROW).record!, ATOMUS_CALL);
const PVALYOU = stampFundingCall(normalizePvalyouFunding(PVALYOU_ROW).record!, PVALYOU_CALL);
const seedOf = (r: FundingRecordFact) => r.rounds.find((x) => /^seed/i.test(x.round_type ?? ""))!;
const prov = (item: EvidenceItem | null) => (item!.value as { provenance: FundingDecisionProvenance }).provenance;

// ═════════════════════════════════════════════════════════ the merge ══

Deno.test("PROVENANCE: stamping writes the call on the record, every round and its completeness", () => {
  assertEquals(ATOMUS.provider_call_id, ATOMUS_CALL);
  assertEquals(ATOMUS.provider_call_ids, [ATOMUS_CALL]);
  assert(ATOMUS.rounds.every((r) => r.provenance?.length === 1 && r.provenance[0].provider_call_id === ATOMUS_CALL));
  assert(ATOMUS.rounds.every((r) => r.provenance![0].role === "reported"), "atomus cites nothing, so it only reports");
  assertEquals(ATOMUS.completeness, {
    actor: "apify_funding_atomus", provider_call_id: ATOMUS_CALL,
    reported_round_count: 3, history_complete: null, complete: true,
  });
  assertEquals(PVALYOU.completeness, null, "pvalyou's count is never completeness");
  assertEquals(seedOf(PVALYOU).provenance, [{ actor: "apify_funding_pvalyou", provider_call_id: PVALYOU_CALL, role: "cited" }]);
});

Deno.test("PROVENANCE: both call ids survive corroboration; the merged record is never forced onto one", () => {
  const c = corroborateFunding({ atomus: ATOMUS, pvalyou: PVALYOU });
  assertEquals(c.conflicts, []);
  const r = c.record!;
  assertEquals(r.provider_call_id, null, "several calls, so no ONE call");
  assertEquals(r.provider_call_ids, [ATOMUS_CALL, PVALYOU_CALL]);
  assertEquals(recordCallIds(r), [ATOMUS_CALL, PVALYOU_CALL]);
});

Deno.test("PROVENANCE: the Seed EVENT is cited by pvalyou and only reported by atomus", () => {
  const merged = corroborateFunding({ atomus: ATOMUS, pvalyou: PVALYOU }).record!;
  const seed = seedOf(merged);
  assertEquals(seed.provenance, [
    { actor: "apify_funding_atomus", provider_call_id: ATOMUS_CALL, role: "reported" },
    { actor: "apify_funding_pvalyou", provider_call_id: PVALYOU_CALL, role: "cited" },
  ]);
  const citers = seed.provenance!.filter((p) => p.role === "cited").map((p) => p.actor);
  assertEquals(citers, ["apify_funding_pvalyou"], "atomus is never attached to a citation it did not supply");
  // The rounds only atomus holds are atomus's alone.
  const others = merged.rounds.filter((x) => x !== seed);
  assertEquals(others.length, 2);
  assert(others.every((x) => x.provenance!.every((p) => p.provider_call_id === ATOMUS_CALL)));
});

Deno.test("PROVENANCE: history COMPLETENESS is atomus's, and is withdrawn — not reassigned — on a conflict", () => {
  const agreed = corroborateFunding({ atomus: ATOMUS, pvalyou: PVALYOU }).record!;
  assertEquals(agreed.completeness?.provider_call_id, ATOMUS_CALL);
  assertEquals(agreed.completeness?.actor, "apify_funding_atomus");
  const laterRound: FundingRecordFact = stampFundingCall({
    ...normalizePvalyouFunding(PVALYOU_ROW).record!,
    rounds: [{ round_type: "Series A", announced_date: "2026-06-01", amount_usd: 1, investors: [], source_urls: ["https://x/a"], method: "provider_field" }],
  }, "pc_pv_later");
  const disputed = corroborateFunding({ atomus: ATOMUS, pvalyou: laterRound });
  assert(disputed.conflicts.length > 0);
  assertEquals(disputed.record!.completeness, null, "no source may claim a history two sources disagree on");
  assertEquals(disputed.record!.reported_round_count, null);
  assertEquals(disputed.record!.provider_call_ids, [ATOMUS_CALL, "pc_pv_later"], "the calls are still named");
});

Deno.test("PROVENANCE: merged records never lose a call — discovery, atomus and pvalyou together", () => {
  const discovered: FundingRecordFact = {
    provider: "apify", actor: "apify_funding_datahyena", rounds: [{
      round_type: "Seed", announced_date: "2024-11-20", amount_usd: 30_000_000, investors: [],
      source_urls: ["https://techcrunch.example/wordware"], method: "provider_field",
    }],
    reported_round_count: null, history_complete: false, observed_at: null, source_url: null,
    provider_call_id: "pc_discovery",
  };
  const r = corroborateFunding({ atomus: ATOMUS, pvalyou: PVALYOU, discovered: [discovered] }).record!;
  assertEquals(r.provider_call_ids, [ATOMUS_CALL, PVALYOU_CALL, "pc_discovery"]);
  assertEquals(seedOf(r).provenance!.map((p) => [p.provider_call_id, p.role]), [
    [ATOMUS_CALL, "reported"], [PVALYOU_CALL, "cited"], ["pc_discovery", "cited"],
  ]);
  // Citing records alone: no completeness, and several calls ⇒ no single call.
  const citingOnly = corroborateFunding({ atomus: null, pvalyou: PVALYOU, discovered: [discovered] }).record!;
  assertEquals([citingOnly.provider_call_id, citingOnly.provider_call_ids, citingOnly.completeness],
    [null, [PVALYOU_CALL, "pc_discovery"], null]);
});

Deno.test("PROVENANCE: duplicate call ids collapse, deterministically", () => {
  assertEquals(dedupeCallIds(["b", null, "a", "b", undefined, "a", "c"]), ["b", "a", "c"]);
  const dup = (id: string): FundingRecordFact => ({
    provider: "apify", actor: "apify_funding_datahyena",
    rounds: [{ round_type: "Seed", announced_date: "2024-11-21", amount_usd: null, investors: [], source_urls: ["https://u"], method: "provider_field" }],
    reported_round_count: null, history_complete: false, observed_at: null, source_url: null, provider_call_id: id,
  });
  const run = () => corroborateFunding({ atomus: ATOMUS, pvalyou: PVALYOU, discovered: [dup("pc_d"), dup("pc_d")] }).record!;
  const a = run(), b = run();
  assertEquals(a.provider_call_ids, [ATOMUS_CALL, PVALYOU_CALL, "pc_d"]);
  assertEquals(seedOf(a).provenance!.filter((p) => p.provider_call_id === "pc_d").length, 1, "one ref per (actor, call, role)");
  assertEquals(JSON.stringify(a), JSON.stringify(b), "same inputs, same provenance");
});

// ═════════════════════════════════════════════════════════ the verdict ══

function stageItems(required: string, atomus: FundingRecordFact | null, pvalyou: FundingRecordFact | null) {
  const { decision, corroboration } = decideCorroboratedFundingStage({ required_stage: required, atomus, pvalyou });
  const record = corroboration.record!;
  const supporting = fundingRecordEvidenceItem({ company_key: KEY, record, mission_id: "t", observed_at: "2026-09-23T11:57:19.813Z" });
  const item = fundingStageEvidenceItem({
    company_key: KEY, decision, record, mission_id: "t", provider_call_id: PVALYOU_CALL,
    observed_at: "2026-09-23T11:57:19.813Z", derived_from: [supporting.evidence_id],
  });
  return { decision, record, supporting, item };
}

Deno.test("VERDICT: Seed PASS cites the cited event, the complete history, and the record it read", () => {
  const { decision, supporting, item } = stageItems("seed", ATOMUS, PVALYOU);
  assertEquals(decision.verdict, "pass");
  const p = prov(item);
  // Which call proves the EVENT?
  assertEquals(p.events.length, 1);
  assertEquals(p.events[0].round_type, "seed");
  assertEquals(p.events[0].sources.filter((s) => s.role === "cited").map((s) => s.provider_call_id), [PVALYOU_CALL]);
  // Which call proves the history is COMPLETE?
  assertEquals(p.history_completeness?.provider_call_id, ATOMUS_CALL);
  assertEquals(p.history_completeness?.complete, true);
  // Every material call, and the evidence it rests on.
  assertEquals(p.provider_call_ids, [ATOMUS_CALL, PVALYOU_CALL]);
  assertEquals(item!.source.provider_call_ids, [ATOMUS_CALL, PVALYOU_CALL]);
  assertEquals(item!.source.provider_call_id, null, "two calls prove it; neither is forced to stand for both");
  assertEquals(item!.derived_from, [supporting.evidence_id]);
  assertEquals(supporting.source.provider_call_ids, [ATOMUS_CALL, PVALYOU_CALL]);
});

Deno.test("VERDICT: pre-seed FAIL cites the later (Seed) event from both sources; completeness is not claimed", () => {
  const { decision, item } = stageItems("pre-seed", ATOMUS, PVALYOU);
  assertEquals([decision.verdict, decision.reasons], ["fail", ["later_round_verified"]]);
  const p = prov(item);
  const seed = p.events.find((e) => e.round_type === "seed")!;
  assertEquals(seed.sources.map((s) => [s.provider_call_id, s.role]), [[ATOMUS_CALL, "reported"], [PVALYOU_CALL, "cited"]]);
  assertEquals(p.history_completeness, null, "a FAIL rests on the later round, not on the whole history");
  assertEquals(p.provider_call_ids, [ATOMUS_CALL, PVALYOU_CALL]);
});

Deno.test("VERDICT: a FAIL atomus settles alone cites atomus alone", () => {
  const seriesA = stampFundingCall({
    ...normalizeAtomusFunding(ATOMUS_ROW).record!,
    rounds: [{ round_type: "SERIES_A", announced_date: "2025-05-01", amount_usd: 1, investors: [], source_urls: [], method: "provider_field" }],
    reported_round_count: 1,
  }, "pc_atomus_only");
  const d = decideFundingStage({ required_stage: "seed", record: seriesA, pass_requires_source_url: true });
  const item = fundingStageEvidenceItem({ company_key: KEY, decision: d, record: seriesA, mission_id: "t", provider_call_id: "pc_atomus_only", observed_at: "x" });
  assertEquals(d.verdict, "fail");
  assertEquals(prov(item).provider_call_ids, ["pc_atomus_only"]);
  assertEquals(item!.source.provider_call_id, "pc_atomus_only", "one call proves it, so it is named directly");
});

Deno.test("VERDICT: PENDING writes no stage item and never claims completeness it lacks", () => {
  // atomus says 5 rounds and returned 3: a partial history.
  const partial = stampFundingCall({ ...normalizeAtomusFunding(ATOMUS_ROW).record!, reported_round_count: 5 }, ATOMUS_CALL);
  assertEquals(partial.completeness?.complete, false, "the count is recorded as PARTIAL, not as proof");
  const { decision, item, record } = stageItems("seed", partial, PVALYOU);
  assertEquals([decision.verdict, decision.reasons], ["pending", ["history_incomplete"]]);
  assertEquals(item, null);
  const p = fundingDecisionProvenance({ verdict: "pending", carrier_rounds: decision.carrier_rounds, record, relies_on_completeness: true });
  assertEquals(p.history_completeness, null, "PENDING claims no completeness, even when asked to");
  // pvalyou alone: no completeness exists at all.
  const alone = stageItems("seed", null, PVALYOU);
  assertEquals([alone.decision.verdict, alone.item, alone.record.completeness], ["pending", null, null]);
});

Deno.test("VERDICT: recency FAIL cites the complete history; recency PASS does not need it", () => {
  const record = corroborateFunding({ atomus: ATOMUS, pvalyou: PVALYOU }).record!;
  const fail = decideRecentlyFunded({ window_days: 180, records: [record], now: "2026-09-23T12:00:00Z" });
  assertEquals(fail.verdict, "fail");
  assertEquals(fail.provenance.history_completeness?.provider_call_id, ATOMUS_CALL);
  assertEquals(fail.provenance.provider_call_ids, [ATOMUS_CALL, PVALYOU_CALL]);
  const pass = decideRecentlyFunded({ window_days: 730, records: [record], now: "2026-09-23T12:00:00Z" });
  assertEquals(pass.verdict, "pass");
  assertEquals(pass.provenance.history_completeness, null);
  assert(pass.provenance.events.some((e) => e.sources.some((s) => s.provider_call_id === PVALYOU_CALL && s.role === "cited")));
  const pending = decideRecentlyFunded({ window_days: 180, records: [PVALYOU], now: "2026-09-23T12:00:00Z" });
  assertEquals([pending.verdict, pending.provenance.history_completeness], ["pending", null]);
});

// ══════════════════════════════════ end to end, and replay from the graph ══

type Row = Record<string, unknown>;
function wordwareRun() {
  const calls: VerifierCall[] = [];
  const deps: VerifierDeps = {
    call: (c) => {
      calls.push(c);
      const out: VerifierCallOutcome = c.actor_key === "apify_funding_atomus"
        ? { status: "ok", rows: [{ ...ATOMUS_ROW, input: (c.input.companies as string[])[0] } as Row], provider_call_id: ATOMUS_CALL }
        : { status: "ok", rows: [{ ...PVALYOU_ROW, query: (c.input.companies as string[])[0] } as Row], provider_call_id: PVALYOU_CALL };
      return Promise.resolve(out);
    },
    ready: () => true, now: () => "2026-09-23T11:57:19.813Z", log: () => {},
  };
  const t: VerificationTarget = {
    company_key: KEY, name: null, domain: "wordware.ai", linkedin_url: KEY,
    criterion: { criterion_id: "company_stage:seed", dimension: "company_stage", value: "seed" },
    graph: buildCompanyEvidenceGraph(KEY, []),
  };
  return { deps, calls, t };
}

Deno.test("END TO END: the verifier's finding names both purchases where an audit looks", async () => {
  const { deps, calls, t } = wordwareRun();
  const r = await fundingStageVerifier().verify([t], deps, { mission_id: "t", pending: [] });
  assertEquals(calls.map((c) => c.actor_key), ["apify_funding_atomus", "apify_funding_pvalyou"]);
  const f = r.findings[0];
  assertEquals(f.detail.verdict, "pass");
  assertEquals(f.item!.source.provider_call_ids, [ATOMUS_CALL, PVALYOU_CALL]);
  assertEquals(prov(f.item).history_completeness?.provider_call_id, ATOMUS_CALL);
  assertEquals(f.supporting!.map((s) => s.source.provider_call_ids), [[ATOMUS_CALL, PVALYOU_CALL]]);
  assertEquals(f.item!.derived_from, [f.supporting![0].evidence_id]);
});

Deno.test("REPLAY: the Evidence Graph alone reconstructs the verdict and why — no provider output", async () => {
  const { deps, t } = wordwareRun();
  const f = (await fundingStageVerifier().verify([t], deps, { mission_id: "t", pending: [] })).findings[0];
  // Round-trip through JSON: what a checkpoint or a task result holds.
  const items = JSON.parse(JSON.stringify([f.item, ...f.supporting!])) as EvidenceItem[];
  const graph = buildCompanyEvidenceGraph(KEY, items);

  // 1. The stage claim, and the evidence it says it was derived from, both in the graph.
  const stage = graph.claims.find((c) => c.dimension === "company_stage")!.current!;
  const derived = stage.derived_from.map((id) => graph.claims.flatMap((c) =>
    [c.current, ...c.supporting, ...c.conflicting, ...c.stale]).find((x) => x?.evidence_id === id));
  assert(derived.length === 1 && derived[0], "derived_from resolves inside the graph");

  // 2. The record the graph holds decides the same verdict, from nothing else.
  const [record] = fundingRecordsInGraph(graph);
  const again = decideFundingStage({ required_stage: "seed", record, pass_requires_source_url: true });
  assertEquals([again.verdict, again.reasons], ["pass", ["required_stage_verified_and_latest"]]);

  // 3. …and the same explanation of WHY: which call cited the event, which
  //    call proved the history complete.
  const replayed = fundingDecisionProvenance({
    verdict: again.verdict, carrier_rounds: again.carrier_rounds, record, relies_on_completeness: true,
  });
  assertEquals(replayed, prov(stage));
  assertEquals(replayed.events[0].sources.find((s) => s.role === "cited")?.provider_call_id, PVALYOU_CALL);
  assertEquals(replayed.history_completeness?.provider_call_id, ATOMUS_CALL);
});

Deno.test("COMPATIBILITY: an unstamped single-source record still names its one call", () => {
  const r: FundingRecordFact = {
    provider: "apify", actor: "apify_funding_datahyena",
    rounds: [{ round_type: "Series A", announced_date: "2025-01-01", amount_usd: null, investors: [], source_urls: ["https://u"], method: "provider_field" } as FundingRoundFact],
    reported_round_count: null, history_complete: false, observed_at: null, source_url: "https://u", provider_call_id: "pc_one",
  };
  const ev = fundingRecordEvidenceItem({ company_key: "k", record: r, mission_id: null, observed_at: "x" });
  assertEquals([ev.source.provider_call_id, ev.source.provider_call_ids], ["pc_one", ["pc_one"]]);
  const d = decideFundingStage({ required_stage: "seed", record: r, pass_requires_source_url: true });
  const item = fundingStageEvidenceItem({ company_key: "k", decision: d, record: r, mission_id: null, provider_call_id: "pc_one", observed_at: "x" });
  assertEquals(item!.source.provider_call_id, "pc_one");
  assertFalse(prov(item).history_completeness !== null, "a FAIL does not claim completeness");
});
