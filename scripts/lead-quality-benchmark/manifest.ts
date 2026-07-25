// Run manifest, deterministic hashing, and baseline↔refined comparison.
//
// Hashing uses a synchronous FNV-1a over canonical (sorted-key) JSON so replay
// artifact hashes are stable and comparisons are deterministic without async
// crypto. No secrets ever enter a manifest — only public identifiers, counts,
// costs, and hashes.

import type { ApifyLimits, BenchmarkMode, RankedEvaluation } from "./types.ts";

export interface RunManifest {
  runId: string;
  query: string;
  gitSha: string | null;
  testSupabaseRef: string;
  workspaceId: string | null;
  mode: BenchmarkMode;
  actorIds: string[];
  actorRunIds: string[];
  providerLimits: ApifyLimits;
  apifyReportedSpendUsd: number;
  estimatedMaxUsd: number;
  modelCallCount: number;
  modelCallPurposes: string[];
  startedAt: string;
  finishedAt: string | null;
  artifactHashes: Record<string, string>;
}

/** Canonical JSON with sorted keys — the basis for stable hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** Deterministic FNV-1a hash (hex) of any JSON-serializable value. */
export function stableHash(value: unknown): string {
  const s = canonicalJson(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ------------------------------------------------------- run comparison ----

export interface RunComparison {
  leadsRemoved: string[];
  leadsAddedToTop10: string[];
  rankChanges: Array<{ candidateId: string; from: number | null; to: number | null }>;
  scoreChanges: Array<{ candidateId: string; from: number; to: number }>;
  hardGateChanges: Array<{ candidateId: string; from: boolean; to: boolean }>;
  falsePositivesFixed: string[];
  potentialFalseNegatives: string[];
}

function key(e: RankedEvaluation): string {
  return e.normalized.candidateId;
}

/** Compare a baseline ranking to a refined one. Pure + deterministic. */
export function compareRuns(baseline: RankedEvaluation[], refined: RankedEvaluation[]): RunComparison {
  const bBy = new Map(baseline.map((e) => [key(e), e]));
  const rBy = new Map(refined.map((e) => [key(e), e]));
  const top10 = (arr: RankedEvaluation[]) => new Set(arr.slice(0, 10).map(key));
  const bTop = top10(baseline);
  const rTop = top10(refined);

  const leadsRemoved = [...bTop].filter((k) => !rTop.has(k)).sort();
  const leadsAddedToTop10 = [...rTop].filter((k) => !bTop.has(k)).sort();

  const rankChanges: RunComparison["rankChanges"] = [];
  const scoreChanges: RunComparison["scoreChanges"] = [];
  const hardGateChanges: RunComparison["hardGateChanges"] = [];
  const falsePositivesFixed: string[] = [];
  const potentialFalseNegatives: string[] = [];

  for (const k of new Set([...bBy.keys(), ...rBy.keys()])) {
    const b = bBy.get(k);
    const r = rBy.get(k);
    const bRank = b?.finalRank ?? null;
    const rRank = r?.finalRank ?? null;
    if (bRank !== rRank) rankChanges.push({ candidateId: k, from: bRank, to: rRank });
    if (b && r && b.benchmarkScore.total !== r.benchmarkScore.total) {
      scoreChanges.push({ candidateId: k, from: b.benchmarkScore.total, to: r.benchmarkScore.total });
    }
    if (b && r && b.gates.allHardPass !== r.gates.allHardPass) {
      hardGateChanges.push({ candidateId: k, from: b.gates.allHardPass, to: r.gates.allHardPass });
    }
    // A false positive is fixed when a former CONTACT becomes non-CONTACT.
    if (b?.verdict === "CONTACT" && r && r.verdict !== "CONTACT") falsePositivesFixed.push(k);
    // A potential false negative is introduced when a former CONTACT is dropped
    // or downgraded but still passes all hard gates in the refined run.
    if (b?.verdict === "CONTACT" && r && r.verdict !== "CONTACT" && r.gates.allHardPass) {
      potentialFalseNegatives.push(k);
    }
  }

  return {
    leadsRemoved,
    leadsAddedToTop10,
    rankChanges: rankChanges.sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
    scoreChanges: scoreChanges.sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
    hardGateChanges: hardGateChanges.sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
    falsePositivesFixed: falsePositivesFixed.sort(),
    potentialFalseNegatives: potentialFalseNegatives.sort(),
  };
}
