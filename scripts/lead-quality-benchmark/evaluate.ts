// Per-candidate benchmark evaluation + run-level dedup and ranking.
//
// This is the deterministic audit layer. It NEVER overwrites Agentory's own
// score/decision — those are preserved on `agentory` and reported separately —
// and it adds an independent gate report, benchmark score, verdict, why-now and
// outreach-angle audits, duplicate status, and inflation/under-ranking warnings.

import { runHardGates, STALE_SIGNAL_DAYS } from "./hard-gates.ts";
import { computeBenchmarkScore, computeSecondarySignals, CONTACT_THRESHOLD } from "./score.ts";
import { auditWhyNow } from "./why-now-audit.ts";
import { auditOutreachAngle } from "./outreach-angle-audit.ts";
import { decideVerdict, verdictReasonCodes, type VerdictInput } from "./verdict.ts";
import { rankEvaluations } from "./rank.ts";
import { normalizeCandidate } from "./normalize.ts";
import type {
  AgentoryOutput,
  BenchmarkEvaluation,
  DuplicateStatus,
  NormalizedCandidate,
  RankedEvaluation,
  RawCandidate,
  ReasonCode,
} from "./types.ts";

export interface EvaluateOptions {
  asOf: string;
  agentoryByCandidateId?: Record<string, AgentoryOutput>;
}

/** Assign duplicate status across a run, in stable rawItemIndex order. */
export function assignDuplicateStatus(normalized: NormalizedCandidate[]): Map<string, DuplicateStatus> {
  const ordered = [...normalized].sort((a, b) => a.raw.rawItemIndex - b.raw.rawItemIndex);
  const seenAccount = new Set<string>();
  const seenPerson = new Set<string>();
  const out = new Map<string, DuplicateStatus>();

  for (const n of ordered) {
    const k = n.duplicateKeys;
    // Prefer strong account keys (domain, company LinkedIn). Name-only is a
    // fallback used ONLY when no strong key exists — so distinct companies with
    // similar names are never collapsed.
    const strongAccount = k.accountByDomain ?? k.accountByLinkedin;
    const accountKey = strongAccount ?? k.accountByNameFallback;
    const strongPerson = k.personByLinkedin;
    const personKey = strongPerson ?? k.personByCompanyNameFallback;

    if (accountKey && seenAccount.has(accountKey)) {
      out.set(n.candidateId, "duplicate_account");
      continue;
    }
    if (personKey && seenPerson.has(personKey)) {
      out.set(n.candidateId, "duplicate_person");
      continue;
    }
    if (accountKey) seenAccount.add(accountKey);
    if (personKey) seenPerson.add(personKey);
    out.set(n.candidateId, "unique");
  }
  return out;
}

export function evaluateCandidate(
  n: NormalizedCandidate,
  duplicateStatus: DuplicateStatus,
  agentory: AgentoryOutput | null,
): BenchmarkEvaluation {
  const gates = runHardGates(n);
  const secondary = computeSecondarySignals(n);
  const benchmarkScore = computeBenchmarkScore(gates, secondary);
  const whyNow = auditWhyNow(agentory?.whyNow ?? null, n);
  const outreachAngle = auditOutreachAngle(agentory?.outreachAngle ?? null, n);
  const stale = n.evidenceFreshnessDays != null && n.evidenceFreshnessDays > STALE_SIGNAL_DAYS;

  const vin: VerdictInput = {
    gates,
    score: benchmarkScore,
    whyNow,
    duplicateStatus,
    stale,
    hasWhyNow: Boolean(agentory?.whyNow),
  };
  const verdict = decideVerdict(vin);

  const scoreDiff = agentory?.score != null ? round2(benchmarkScore.total - agentory.score) : null;
  const agentoryPositive = isAgentoryPositive(agentory);
  const inflationWarning = agentoryPositive && (verdict === "REJECT" || gates.gates.some((g) => g.outcome === "fail"));
  const underRankWarning = verdict === "CONTACT" && agentory != null && !agentoryPositive;

  return {
    normalized: n,
    gates,
    secondary,
    benchmarkScore,
    verdict,
    whyNow,
    outreachAngle,
    duplicateStatus,
    agentory,
    scoreDiff,
    inflationWarning,
    underRankWarning,
  };
}

/** Full pipeline: normalize → dedup → evaluate → rank. Deterministic. */
export function evaluateRun(raws: RawCandidate[], opts: EvaluateOptions): RankedEvaluation[] {
  const normalized = raws.map((r) => normalizeCandidate(r, { asOf: opts.asOf }));
  const dupMap = assignDuplicateStatus(normalized);
  const evals = normalized.map((n) =>
    evaluateCandidate(
      n,
      dupMap.get(n.candidateId) ?? "unique",
      opts.agentoryByCandidateId?.[n.candidateId] ?? null,
    ),
  );
  return rankEvaluations(evals);
}

/** Reason codes for a single evaluation (for CSV export). */
export function evaluationReasonCodes(e: BenchmarkEvaluation): ReasonCode[] {
  const codes = verdictReasonCodes({
    gates: e.gates,
    score: e.benchmarkScore,
    whyNow: e.whyNow,
    duplicateStatus: e.duplicateStatus,
    stale: e.normalized.evidenceFreshnessDays != null && e.normalized.evidenceFreshnessDays > STALE_SIGNAL_DAYS,
    hasWhyNow: Boolean(e.agentory?.whyNow),
  });
  if (e.inflationWarning && !codes.includes("score_inflation")) codes.push("score_inflation");
  return codes;
}

function isAgentoryPositive(a: AgentoryOutput | null): boolean {
  if (!a) return false;
  const dec = (a.decision ?? "").toLowerCase();
  if (/(contact|qualified|approved|strong|ready)/.test(dec)) return true;
  if (a.score != null && a.score >= CONTACT_THRESHOLD) return true;
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
