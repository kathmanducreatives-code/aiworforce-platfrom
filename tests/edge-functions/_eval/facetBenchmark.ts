// THE FACET BENCHMARK — THREE ARMS, ONE EVIDENCE SET, ONE SCORING.
//
//   A  current grounder   today's canonical path: the grounder's answer, verified,
//                         read by `businessModelDecision`. Offline it replays
//                         RECORDED production answers (Fuse has three); live it
//                         calls the real grounder.
//   B  gpt_fixed          our own model, asked the SAME fixed facet questions
//                         with snippet ids (`gptFacetJudge`)
//   C  jev                TypeSafe's Jev, the same questions (`jevProvider`)
//
// B exists so that a win for C is a win for Jev and not merely for the question
// format. Every arm's answer goes through the same deterministic validation.
//
// Pure scoring; the arms decide whether anything touches a network. Offline
// tests use scripted judges and recorded answers only.

import type { EvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import {
  ATTESTED_FACETS, buildEvidenceSnippets, currentGrounderView, validateFacetAnswers,
  type AttestedFacet, type FacetVerdict, type RawFacetAnswers,
} from "../../../supabase/functions/_shared/facetAttestation.ts";
import {
  businessModelDecision, parseGroundedResult, verifyGroundedResult, type GroundedVerification,
} from "../../../supabase/functions/_shared/groundedClaims.ts";
import type { FacetJudge } from "../../../supabase/functions/_shared/jevProvider.ts";
import { registryFor, type FacetFixture } from "./facetFixtures.ts";

export interface ArmRun {
  ok: boolean;
  failure: string | null;
  verdicts: Record<AttestedFacet, FacetVerdict> | null;
  /** Texts of the snippets / quotes each verdict rests on, after validation. */
  support_texts: Partial<Record<AttestedFacet, string[]>>;
  /** Ids the arm cited (support + contradiction), and how many validation discarded. */
  returned_ids: number;
  invalid_ids: number;
  latency_ms: number | null;
  cost_usd: number | null;
}

export interface Arm {
  name: string;
  /** Null when this arm cannot run on this fixture (e.g. nothing recorded). */
  run(f: FacetFixture, repeat: number): Promise<ArmRun | null>;
}

const NO_ID = new Set(["", "none", "null", "n/a"]);
function countIds(a: RawFacetAnswers): number {
  let n = 0;
  for (const f of ATTESTED_FACETS) {
    for (const v of [a[f]?.support, a[f]?.contradiction]) {
      const list = Array.isArray(v) ? v : v == null ? [] : [v];
      n += list.filter((x) => typeof x === "string" && !NO_ID.has(x.trim().toLowerCase())).length;
    }
  }
  return n;
}

/** Arms B and C: any facet judge, validated exactly as the shadow validates it. */
export function judgeArm(name: string, judge: FacetJudge): Arm {
  return {
    name,
    async run(f) {
      const reg = registryFor(f);
      const snippets = buildEvidenceSnippets(reg);
      const out = await judge({ snippets });
      if (!out.ok) {
        return {
          ok: false, failure: out.failure, verdicts: null, support_texts: {}, returned_ids: 0, invalid_ids: 0,
          latency_ms: out.latency_ms, cost_usd: out.telemetry?.estimated_cost_usd ?? null,
        };
      }
      const att = validateFacetAnswers({ registry: reg, snippets, answers: out.answers });
      const textOf = (id: string) => snippets.snippets.find((s) => s.snippet_id === id)?.text ?? "";
      return {
        ok: true, failure: null,
        verdicts: Object.fromEntries(ATTESTED_FACETS.map((x) => [x, att.facets[x].verdict])) as Record<AttestedFacet, FacetVerdict>,
        support_texts: Object.fromEntries(ATTESTED_FACETS.map((x) => [x, att.facets[x].supporting_snippet_ids.map(textOf)])),
        returned_ids: countIds(out.answers),
        invalid_ids: att.failures.filter((x) => x.snippet_id !== null).length,
        latency_ms: out.latency_ms, cost_usd: out.telemetry?.estimated_cost_usd ?? null,
      };
    },
  };
}

function grounderRun(v: GroundedVerification | null, latency: number | null, cost: number | null): ArmRun {
  if (!v) {
    return { ok: false, failure: "grounder_unavailable", verdicts: null, support_texts: {}, returned_ids: 0, invalid_ids: 0, latency_ms: latency, cost_usd: cost };
  }
  const view = currentGrounderView(v);
  const quotes = businessModelDecision(v).quotes.map((q) => q.excerpt);
  // The grounder cites per CLAIM; each validated or rejected claim is one citation.
  const cited = v.validated_claims.length + v.rejected_claims.length;
  return {
    ok: true, failure: null, verdicts: view.facets,
    support_texts: Object.fromEntries(ATTESTED_FACETS.map((x) => [x, view.facets[x] === "states" ? quotes : []])),
    returned_ids: cited,
    // A grounder claim citing an unknown id or a paraphrase is REJECTED — the
    // grounder's equivalent of an invalid snippet id.
    invalid_ids: v.rejected_claims.filter((r) => r.reason === "unknown_evidence_id" || r.reason === "excerpt_not_found" || r.reason === "wrong_company").length,
    latency_ms: latency, cost_usd: cost,
  };
}

/** Arm A, offline: replays recorded production grounder answers. Repeat r uses answer r mod n. */
export function recordedGrounderArm(): Arm {
  return {
    name: "current_grounder",
    async run(f, repeat) {
      if (!f.recorded_grounder) return null;
      const reg = registryFor(f);
      const answers = f.recorded_grounder(reg);
      if (answers.length === 0) return null;
      const v = verifyGroundedResult({ registry: reg, result: parseGroundedResult(answers[repeat % answers.length]) });
      return grounderRun(v, null, null);
    },
  };
}

/** Arm A, live: the real grounder binding's `groundCompany`. */
export function liveGrounderArm(
  ground: (i: { registry: EvidenceRegistry; requiresCommercialSignal: boolean }) => Promise<GroundedVerification | null>,
  costOfLastCall: () => number | null = () => null,
): Arm {
  return {
    name: "current_grounder",
    async run(f) {
      const reg = registryFor(f);
      const t0 = Date.now();
      const v = await ground({ registry: reg, requiresCommercialSignal: false });
      return grounderRun(v, Date.now() - t0, costOfLastCall());
    },
  };
}

// ────────────────────────────────────────────────────────────── scoring ──

export interface ArmMetrics {
  arm: string;
  runs: number;
  failures: number;
  failure_rate: number;
  scored_cells: number;
  facet_accuracy: number | null;
  per_facet_accuracy: Partial<Record<AttestedFacet, number>>;
  false_pass_rate: number | null;
  false_contradiction_rate: number | null;
  repeatability: number | null;
  invalid_snippet_id_rate: number | null;
  support_hit_rate: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  mean_cost_usd: number | null;
  /** Ambiguous cells, reported not scored: how often the arm matched the author's label. */
  ambiguous_matches: number;
  ambiguous_cells: number;
  /** Cells whose verdict differs from the current grounder's, where both answered. */
  disagreement_vs_current: number | null;
  /** Hostile fixtures on which the arm asserted any facet the label says is not stated. */
  hostile_false_passes: number;
}

export interface BenchmarkReport {
  fixtures: string[];
  repeats: number;
  arms: ArmMetrics[];
  runs: Record<string, Record<string, ArmRun[]>>;
}

const rate = (num: number, den: number) => (den > 0 ? num / den : null);

function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

export async function runBenchmark(i: {
  fixtures: FacetFixture[];
  arms: Arm[];
  repeats: number;
}): Promise<BenchmarkReport> {
  const repeats = Math.max(1, Math.trunc(i.repeats));
  const runs: Record<string, Record<string, ArmRun[]>> = {};
  for (const arm of i.arms) {
    runs[arm.name] = {};
    for (const f of i.fixtures) {
      const list: ArmRun[] = [];
      for (let r = 0; r < repeats; r++) {
        const out = await arm.run(f, r);
        if (out) list.push(out);
      }
      if (list.length > 0) runs[arm.name][f.id] = list;
    }
  }

  const byId = new Map(i.fixtures.map((f) => [f.id, f]));
  const current = runs["current_grounder"] ?? {};
  const metrics: ArmMetrics[] = i.arms.map((arm) => {
    const perFixture = runs[arm.name];
    let total = 0, failures = 0, scored = 0, correct = 0;
    let notStatesLabels = 0, falsePass = 0, notContraLabels = 0, falseContra = 0;
    let stableCells = 0, repeatCells = 0, returned = 0, invalid = 0, supportCells = 0, supportHits = 0;
    let ambMatch = 0, ambCells = 0, disagreeCells = 0, compareCells = 0, hostileFalse = 0;
    const perFacet: Record<string, { c: number; n: number }> = {};
    const latencies: number[] = [];
    const costs: number[] = [];

    for (const [fid, list] of Object.entries(perFixture)) {
      const f = byId.get(fid)!;
      const ambiguous = new Set(f.ambiguous ?? []);
      for (const run of list) {
        total++;
        if (run.latency_ms !== null) latencies.push(run.latency_ms);
        if (run.cost_usd !== null) costs.push(run.cost_usd);
        returned += run.returned_ids;
        invalid += run.invalid_ids;
        if (!run.ok || !run.verdicts) { failures++; continue; }
        let hostileHit = false;
        for (const facet of ATTESTED_FACETS) {
          const pred = run.verdicts[facet], label = f.labels[facet];
          if (ambiguous.has(facet)) {
            ambCells++;
            if (pred === label) ambMatch++;
            continue;
          }
          scored++;
          if (pred === label) correct++;
          const pf = perFacet[facet] ??= { c: 0, n: 0 };
          pf.n++;
          if (pred === label) pf.c++;
          if (label !== "states") { notStatesLabels++; if (pred === "states") { falsePass++; if (f.hostile) hostileHit = true; } }
          if (label !== "contradicts") { notContraLabels++; if (pred === "contradicts") falseContra++; }
          const expected = f.expected_support?.[facet];
          if (label === "states" && pred === "states" && expected && expected.length > 0) {
            supportCells++;
            const texts = (run.support_texts[facet] ?? []).map((t) => t.toLowerCase());
            if (texts.some((t) => expected.some((e) => t.includes(e.toLowerCase())))) supportHits++;
          }
        }
        if (hostileHit) hostileFalse++;
      }
      const ok = list.filter((r) => r.ok && r.verdicts);
      if (ok.length >= 2) {
        for (const facet of ATTESTED_FACETS) {
          repeatCells++;
          if (ok.every((r) => r.verdicts![facet] === ok[0].verdicts![facet])) stableCells++;
        }
      }
      const cur = (current[fid] ?? []).find((r) => r.ok && r.verdicts);
      const mine = ok[0];
      if (arm.name !== "current_grounder" && cur && mine) {
        for (const facet of ATTESTED_FACETS) {
          compareCells++;
          if ((mine.verdicts![facet] === "states") !== (cur.verdicts![facet] === "states")) disagreeCells++;
        }
      }
    }

    return {
      arm: arm.name,
      runs: total,
      failures,
      failure_rate: rate(failures, total) ?? 0,
      scored_cells: scored,
      facet_accuracy: rate(correct, scored),
      per_facet_accuracy: Object.fromEntries(Object.entries(perFacet).map(([k, v]) => [k, v.c / v.n])),
      false_pass_rate: rate(falsePass, notStatesLabels),
      false_contradiction_rate: rate(falseContra, notContraLabels),
      repeatability: rate(stableCells, repeatCells),
      invalid_snippet_id_rate: rate(invalid, returned),
      support_hit_rate: rate(supportHits, supportCells),
      latency_p50_ms: percentile(latencies, 50),
      latency_p95_ms: percentile(latencies, 95),
      mean_cost_usd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
      ambiguous_matches: ambMatch,
      ambiguous_cells: ambCells,
      disagreement_vs_current: rate(disagreeCells, compareCells),
      hostile_false_passes: hostileFalse,
    };
  });

  return { fixtures: i.fixtures.map((f) => f.id), repeats, arms: metrics, runs };
}

// ─────────────────────────────────────────────────────────── the gate ──

export interface GateThresholds {
  min_repeatability: number;
  max_invalid_id_rate: number;
  /** Candidate p95 latency must be at most this fraction of the baseline's. */
  max_latency_ratio: number;
  /** Candidate mean cost must be at most this fraction of the baseline's. */
  max_cost_ratio: number;
}

export const DEFAULT_GATE: GateThresholds = {
  min_repeatability: 0.99,
  max_invalid_id_rate: 0.01,
  max_latency_ratio: 0.5,
  max_cost_ratio: 0.5,
};

export interface GateCheck { check: string; passed: boolean; detail: string }

/**
 * May `candidate` influence production? Every check must pass, and a metric
 * that could not be measured FAILS its check — authority is never granted on
 * an absence of evidence. Cheaper alone never passes: quality checks come first
 * and are independent of cost.
 */
export function successGate(candidate: ArmMetrics, baseline: ArmMetrics, t: GateThresholds = DEFAULT_GATE): {
  passed: boolean;
  checks: GateCheck[];
} {
  const checks: GateCheck[] = [];
  const cmp = (check: string, a: number | null, b: number | null, ok: (a: number, b: number) => boolean) => {
    if (a === null || b === null) {
      checks.push({ check, passed: false, detail: `not measurable (candidate ${a}, baseline ${b})` });
    } else {
      checks.push({ check, passed: ok(a, b), detail: `candidate ${a.toFixed(4)} vs baseline ${b.toFixed(4)}` });
    }
  };
  cmp("false PASS rate not worse", candidate.false_pass_rate, baseline.false_pass_rate, (a, b) => a <= b);
  cmp("false contradiction rate not worse", candidate.false_contradiction_rate, baseline.false_contradiction_rate, (a, b) => a <= b);
  cmp("accuracy meets or beats", candidate.facet_accuracy, baseline.facet_accuracy, (a, b) => a >= b);
  cmp(`repeatability >= ${t.min_repeatability}`, candidate.repeatability, t.min_repeatability, (a, b) => a >= b);
  cmp(`invalid snippet-id rate <= ${t.max_invalid_id_rate}`, candidate.invalid_snippet_id_rate ?? 0, t.max_invalid_id_rate, (a, b) => a <= b);
  cmp(`p95 latency <= ${t.max_latency_ratio}x baseline`, candidate.latency_p95_ms, baseline.latency_p95_ms, (a, b) => a <= b * t.max_latency_ratio);
  cmp(`mean cost <= ${t.max_cost_ratio}x baseline`, candidate.mean_cost_usd, baseline.mean_cost_usd, (a, b) => a <= b * t.max_cost_ratio);
  checks.push({
    check: "no false PASS on hostile evidence",
    passed: candidate.hostile_false_passes === 0,
    detail: `${candidate.hostile_false_passes} hostile fixture run(s) asserted an unstated facet`,
  });
  return { passed: checks.every((c) => c.passed), checks };
}
