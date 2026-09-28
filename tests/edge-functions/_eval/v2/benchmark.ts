// BENCHMARK V2 — SCORING PER DECISION, GATES PER FACET, THRESHOLDS ON A TUNE SPLIT.
//
// Nothing here decides whether Jev "replaces the grounder". Each semantic
// decision is scored on its own, and a decision becomes eligible for a future
// Phase 2 only through `gateV2`, on REAL-company HELD-OUT cells, with thresholds
// chosen on the TUNE split (`tuneThreshold`) — never on the cells that judge them.
//
// NOT_EXPRESSIBLE: a decision the current grounder has no concept for is not
// scored for it at all — neither right nor wrong — so a missing concept earns
// no credit.

import { fingerprint, type EvidenceRegistry } from "../../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import type { GroundedVerification } from "../../../../supabase/functions/_shared/groundedClaims.ts";
import { buildJevRequest } from "../../../../supabase/functions/_shared/jevProvider.ts";
import { buildEvidenceSnippets } from "../../../../supabase/functions/_shared/facetAttestation.ts";
import {
  DEFAULT_THRESHOLDS, buildEvidenceDocument, derive, isInstructional, validateV2,
  type RawV2Answer, type V2Answer, type V2Thresholds,
} from "./contract.ts";
import { buildJevV2Request, currentToV2, CURRENT_EXPRESSIBLE, type V2Judge } from "./judges.ts";
import { registryForV2, type Split, type V2Fixture } from "./fixtures.ts";

// ─────────────────────────────────────────────────────────── decisions ──

export const DECISIONS = [
  "business_customer", "consumer_customer", "ai_product",
  "software_product", "service_heavy", "marketplace", "licensed_models_or_data", "physical_product", "media_or_content",
  "hosted_saas", "installed_on_prem",
] as const;
export type Decision = typeof DECISIONS[number];

export function decisionValue(d: Decision, a: V2Answer): boolean {
  switch (d) {
    case "business_customer": return a.business_customer;
    case "consumer_customer": return a.consumer_customer;
    case "ai_product": return a.ai_product;
    default: return derive[d](a);
  }
}

/** Decisions the current grounder cannot express at all. */
export const CURRENT_NOT_EXPRESSIBLE: ReadonlySet<Decision> = new Set([
  "marketplace", "licensed_models_or_data", "physical_product", "media_or_content", "installed_on_prem",
]);

// ─────────────────────────────────────────────────────────── the runs ──

export interface RunRecord {
  arm: string;
  fixture_id: string;
  repeat: number;
  ok: boolean;
  failure: string | null;
  /** Judge arms: the raw answer, so thresholds can be re-applied without re-running. */
  raw: RawV2Answer | null;
  /** Current arm: its mapped answer. */
  current: V2Answer | null;
  latency_ms: number | null;
  cost_usd: number | null;
  model: string | null;
}

export interface Arm {
  name: string;
  run(f: V2Fixture, repeat: number): Promise<RunRecord>;
}

export function judgeArmV2(name: string, judge: V2Judge): Arm {
  return {
    name,
    async run(f, repeat) {
      const doc = buildEvidenceDocument(registryForV2(f));
      const out = await judge(doc);
      return {
        arm: name, fixture_id: f.id, repeat, ok: out.ok, failure: out.ok ? null : out.failure,
        raw: out.ok ? out.raw : null, current: null, latency_ms: out.latency_ms,
        cost_usd: out.telemetry?.estimated_cost_usd ?? null, model: out.ok ? out.model : null,
      };
    },
  };
}

export function currentArmV2(
  ground: (i: { registry: EvidenceRegistry; requiresCommercialSignal: boolean }) => Promise<GroundedVerification | null>,
  costOfLastCall: () => number | null = () => null,
): Arm {
  return {
    name: "current_grounder",
    async run(f, repeat) {
      const t0 = Date.now();
      const v = await ground({ registry: registryForV2(f), requiresCommercialSignal: false });
      const a = currentToV2(v);
      return {
        arm: "current_grounder", fixture_id: f.id, repeat, ok: a !== null, failure: a ? null : "grounder_unavailable",
        raw: null, current: a, latency_ms: Date.now() - t0, cost_usd: costOfLastCall(), model: null,
      };
    },
  };
}

export async function runV2(i: { fixtures: V2Fixture[]; arms: Arm[]; repeats: number }): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  for (const arm of i.arms) for (const f of i.fixtures) for (let r = 0; r < Math.max(1, i.repeats); r++) out.push(await arm.run(f, r));
  return out;
}

// ────────────────────────────────────────────────────────────── scoring ──

/** The answer a record stands for, at these thresholds (judge arms re-validate). */
export function answerOf(rec: RunRecord, f: V2Fixture, t: V2Thresholds = DEFAULT_THRESHOLDS) {
  if (!rec.ok) return null;
  if (rec.arm === "current_grounder") return { answer: rec.current, validated: null };
  const registry = registryForV2(f);
  const doc = buildEvidenceDocument(registry);
  const validated = validateV2({ registry, doc, raw: rec.raw, thresholds: t });
  return { answer: validated.answer, validated, doc };
}

export interface DecisionScore {
  tp: number; fp: number; fn: number; tn: number;
  precision: number | null; recall: number | null;
  positives: number; negatives: number;
  real_positives: number; real_negatives: number;
  repeatability: number | null;
  not_expressible: boolean;
}

export interface ArmScore {
  arm: string;
  runs: number;
  failures: number;
  decisions: Record<Decision, DecisionScore>;
  /** Category accuracy, on cells whose label the arm can express. */
  primary_accuracy: number | null;
  delivery_accuracy: number | null;
  /** invalid = citation-INTEGRITY failures only; policy_refused = pricing-only / platform-only refusals (USER 2026-09-28). */
  citations: { returned: number; invalid: number; policy_refused: number; hit_rate: number | null };
  hostile: { hostile_lines_cited_and_accepted: number; hostile_sources: number; hostile_sources_flagged: number };
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  mean_cost_usd: number | null;
}

/**
 * Refusals of a citation that is genuine but cannot carry the claim by policy. They drop the positive
 * (scored through the resulting answer) and are reported, but they are not INVALID citations: the
 * gate's "invalid citations = 0" counts integrity failures only (USER 2026-09-28).
 */
export const POLICY_REFUSALS: ReadonlySet<string> = new Set(["pricing_only_support", "platform_only_support"]);

/** Is this fixture labelled for `what`? Real gate fixtures name theirs; full-contract fixtures score everything. */
export const scores = (f: V2Fixture, what: string) => !f.scored || f.scored.includes(what);

const rate = (a: number, b: number) => (b > 0 ? a / b : null);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

export function scoreV2(i: {
  records: RunRecord[];
  fixtures: V2Fixture[];
  arm: string;
  splits?: Split[];
  thresholds?: V2Thresholds;
}): ArmScore {
  const t = i.thresholds ?? DEFAULT_THRESHOLDS;
  const fx = new Map(i.fixtures.map((f) => [f.id, f]));
  const recs = i.records.filter((r) => r.arm === i.arm && fx.has(r.fixture_id)
    && (!i.splits || i.splits.includes(fx.get(r.fixture_id)!.split)));
  const isCurrent = i.arm === "current_grounder";
  const decisions = {} as Record<Decision, DecisionScore>;
  const answers = recs.map((r) => ({ r, f: fx.get(r.fixture_id)!, a: answerOf(r, fx.get(r.fixture_id)!, t) }));

  for (const d of DECISIONS) {
    const s: DecisionScore = {
      tp: 0, fp: 0, fn: 0, tn: 0, precision: null, recall: null, positives: 0, negatives: 0,
      real_positives: 0, real_negatives: 0, repeatability: null, not_expressible: isCurrent && CURRENT_NOT_EXPRESSIBLE.has(d),
    };
    if (!s.not_expressible) {
      const byFixture = new Map<string, boolean[]>();
      for (const { f, a } of answers) {
        if (!a?.answer || !scores(f, d)) continue;
        const pred = decisionValue(d, a.answer), truth = decisionValue(d, f.labels);
        if (pred && truth) s.tp++; else if (pred && !truth) s.fp++; else if (!pred && truth) s.fn++; else s.tn++;
        byFixture.set(f.id, [...(byFixture.get(f.id) ?? []), pred]);
      }
      for (const f of new Map(answers.map((x) => [x.f.id, x.f])).values()) {
        if (!scores(f, d)) continue;
        const truth = decisionValue(d, f.labels);
        if (truth) { s.positives++; if (f.kind === "production") s.real_positives++; }
        else { s.negatives++; if (f.kind === "production") s.real_negatives++; }
      }
      s.precision = rate(s.tp, s.tp + s.fp);
      s.recall = rate(s.tp, s.tp + s.fn);
      const repeated = [...byFixture.values()].filter((v) => v.length >= 2);
      s.repeatability = rate(repeated.filter((v) => v.every((x) => x === v[0])).length, repeated.length);
    }
    decisions[d] = s;
  }

  const catAcc = (key: "primary_offering" | "delivery_model") => {
    let ok = 0, n = 0;
    for (const { f, a } of answers) {
      if (!a?.answer || !scores(f, key)) continue;
      if (isCurrent && !(CURRENT_EXPRESSIBLE[key] as readonly string[]).includes(f.labels[key])) continue;
      n++; if (a.answer[key] === f.labels[key]) ok++;
    }
    return rate(ok, n);
  };

  let returned = 0, invalid = 0, policyRefused = 0, hitCells = 0, hits = 0, hostileAccepted = 0, hostileSources = 0, hostileFlagged = 0;
  if (!isCurrent) {
    for (const { r, f, a } of answers) {
      if (!a?.validated || !r.raw) continue;
      returned += Object.values(r.raw.citations).filter((c) => typeof c === "string" && c.trim() && c.trim().toUpperCase() !== "NONE").length;
      const cited = a.validated.failures.filter((x) => x.label !== null);
      policyRefused += cited.filter((x) => POLICY_REFUSALS.has(x.reason)).length;
      invalid += cited.filter((x) => !POLICY_REFUSALS.has(x.reason)).length;
      for (const [j, label] of Object.entries(a.validated.citations)) {
        const line = a.doc!.lines.find((l) => l.label === label)!;
        if (isInstructional(line.text)) hostileAccepted++;
        const want = f.expected_citations?.[j as keyof NonNullable<V2Fixture["expected_citations"]>];
        if (want?.length) { hitCells++; if (want.some((w) => line.text.toLowerCase().includes(w.toLowerCase()))) hits++; }
      }
      for (const s of a.doc!.sources) {
        const hostile = s.labels.some((l) => isInstructional(a.doc!.lines.find((x) => x.label === l)!.text));
        if (!hostile) continue;
        hostileSources++;
        const p = r.raw.injection[s.source];
        if (typeof p === "number" && p >= t.injection) hostileFlagged++;
      }
    }
  }

  const lat = recs.map((r) => r.latency_ms).filter((x): x is number => typeof x === "number");
  const cost = recs.map((r) => r.cost_usd).filter((x): x is number => typeof x === "number");
  return {
    arm: i.arm, runs: recs.length, failures: recs.filter((r) => !r.ok).length, decisions,
    primary_accuracy: catAcc("primary_offering"), delivery_accuracy: catAcc("delivery_model"),
    citations: { returned, invalid, policy_refused: policyRefused, hit_rate: rate(hits, hitCells) },
    hostile: { hostile_lines_cited_and_accepted: hostileAccepted, hostile_sources: hostileSources, hostile_sources_flagged: hostileFlagged },
    latency_p50_ms: pct(lat, 50), latency_p95_ms: pct(lat, 95),
    mean_cost_usd: cost.length ? cost.reduce((a, b) => a + b, 0) / cost.length : null,
  };
}

// ────────────────────────────────────────────────────────── the gate ──

export const V2_GATE = {
  min_precision: 0.95,
  min_repeatability: 0.99,
  min_real_positives: 15,
  min_real_negatives: 15,
};

export interface GateCheck { check: string; passed: boolean; detail: string }

/**
 * May `decision` be considered for Phase 2? On held-out REAL cells only. Every
 * check must pass; an unmeasured value fails. Latency and cost are not checks.
 */
export function gateV2(decision: Decision, candidate: ArmScore, current: ArmScore): { passed: boolean; checks: GateCheck[] } {
  const c = candidate.decisions[decision], k = current.decisions[decision];
  const checks: GateCheck[] = [];
  const add = (check: string, passed: boolean, detail: string) => checks.push({ check, passed, detail });
  const f = (x: number | null) => (x === null ? "unmeasured" : x.toFixed(3));
  add(`precision >= ${V2_GATE.min_precision}`, c.precision !== null && c.precision >= V2_GATE.min_precision, f(c.precision));
  if (k.not_expressible) {
    add("precision >= current", true, "current: NOT_EXPRESSIBLE (not compared)");
    add("recall >= current", true, "current: NOT_EXPRESSIBLE (not compared)");
  } else {
    add("precision >= current", c.precision !== null && k.precision !== null && c.precision >= k.precision, `${f(c.precision)} vs ${f(k.precision)}`);
    add("recall >= current", c.recall !== null && k.recall !== null && c.recall >= k.recall, `${f(c.recall)} vs ${f(k.recall)}`);
  }
  add(`repeatability >= ${V2_GATE.min_repeatability}`, c.repeatability !== null && c.repeatability >= V2_GATE.min_repeatability, f(c.repeatability));
  add("invalid citations = 0", candidate.citations.invalid === 0, `${candidate.citations.invalid} of ${candidate.citations.returned}`);
  add(`>= ${V2_GATE.min_real_positives} real positives`, c.real_positives >= V2_GATE.min_real_positives, `${c.real_positives}`);
  add(`>= ${V2_GATE.min_real_negatives} real negatives`, c.real_negatives >= V2_GATE.min_real_negatives, `${c.real_negatives}`);
  return { passed: checks.every((x) => x.passed), checks };
}

// ──────────────────────────────────────────── thresholds: tune → held-out ──

export const THRESHOLD_GRID = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

/**
 * The LOWEST threshold at which `decision` reaches the precision target on the
 * TUNE split (lowest = most recall). Presence decisions tune the Noul
 * threshold; category decisions tune the Choice probability floor. Null when
 * no threshold reaches the target — the decision then cannot pass.
 */
export function tuneThreshold(i: {
  records: RunRecord[]; fixtures: V2Fixture[]; arm: string; decision: Decision; target_precision?: number;
}): { threshold: number; thresholds: V2Thresholds; precision: number; recall: number } | null {
  const presence = i.decision === "business_customer" || i.decision === "consumer_customer" || i.decision === "ai_product";
  for (const x of THRESHOLD_GRID) {
    const thresholds = presence ? { ...DEFAULT_THRESHOLDS, presence: x } : { ...DEFAULT_THRESHOLDS, choice: x };
    const s = scoreV2({ records: i.records, fixtures: i.fixtures, arm: i.arm, splits: ["tune"], thresholds }).decisions[i.decision];
    if (s.precision !== null && s.recall !== null && s.precision >= (i.target_precision ?? V2_GATE.min_precision)) {
      return { threshold: x, thresholds, precision: s.precision, recall: s.recall };
    }
  }
  return null;
}

/**
 * Deterministic, stratified tune/held-out assignment for REAL fixtures: grouped
 * by their label pattern, ordered by a hash of the id, alternated. Synthetic
 * fixtures stay "dev" and never reach a gate.
 */
export function assignSplits(fixtures: V2Fixture[]): V2Fixture[] {
  const key = (f: V2Fixture) => `${f.labels.primary_offering}|${f.labels.delivery_model}|${+f.labels.business_customer}${+f.labels.consumer_customer}${+f.labels.ai_product}`;
  const strata = new Map<string, V2Fixture[]>();
  for (const f of fixtures) if (f.kind === "production") strata.set(key(f), [...(strata.get(key(f)) ?? []), f]);
  const split = new Map<string, Split>();
  for (const group of strata.values()) {
    group.sort((a, b) => fingerprint([a.id]).localeCompare(fingerprint([b.id])));
    group.forEach((f, n) => split.set(f.id, n % 2 === 0 ? "heldout" : "tune"));
  }
  return fixtures.map((f) => (f.kind === "production" ? { ...f, split: split.get(f.id)! } : { ...f, split: "dev" }));
}

// ──────────────────────────────────────────────────── request size vs V1 ──

export function requestStats(f: V2Fixture): { v1_questions: number; v2_questions: number; v1_chars: number; v2_chars: number } {
  const registry = registryForV2(f);
  const v1 = buildJevRequest(buildEvidenceSnippets(registry), "jev-1.13.0");
  const v2 = buildJevV2Request(buildEvidenceDocument(registry), "jev-1.13.0");
  return {
    v1_questions: Object.keys(v1.questions).length,
    v2_questions: Object.keys(v2.questions).length,
    v1_chars: JSON.stringify(v1).length,
    v2_chars: JSON.stringify(v2).length,
  };
}
