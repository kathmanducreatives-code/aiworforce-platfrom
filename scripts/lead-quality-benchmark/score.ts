// Secondary quality signals + the independent benchmark audit score (section 7/8).
//
// The benchmark score is deliberately tied to the hard-gate outcomes: each gate
// owns a fixed slice of the 100 points, so a FAILED hard gate forfeits its whole
// slice and can never reach the CONTACT threshold. Secondary ICP signals only
// contribute the small residual weight — they can never override a gate.

import { STALE_SIGNAL_DAYS } from "./hard-gates.ts";
import { parseDomain, isShortenerUrl } from "../../supabase/functions/_shared/apifyJobsNormalizer.ts";
import type { BenchmarkScore, GateReport, HardGateResult, NormalizedCandidate, SecondarySignals } from "./types.ts";

/** Score at/above which a fully-gate-passing lead may be CONTACT. */
export const CONTACT_THRESHOLD = 75;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const EARLY_STAGE_RE = /\b(seed|pre-seed|series [ab]\b|early[- ]stage|startup|founded 20(1[5-9]|2[0-6]))\b/i;
const FUNDING_RE = /\b(raised|funding|series [a-c]\b|seed round|venture|backed by)\b/i;
const PIPELINE_RE = /\b(pipeline|revenue|gtm|go[- ]to[- ]market|quota|forecast|outbound|new business)\b/i;
const B2B_RE = /\b(b2b|saas|platform|api|enterprise|software)\b/i;

export function computeSecondarySignals(n: NormalizedCandidate): SecondarySignals {
  const hay = [n.raw.companyName, n.raw.jobTitle, n.raw.jobDescriptionExcerpt, String(n.raw.rawMeta?.companyDescription ?? "")]
    .filter(Boolean).join(" ");
  const employees = Number(n.raw.rawMeta?.employeeCount ?? NaN);
  const fresh = n.evidenceFreshnessDays;

  const sizeFit = Number.isFinite(employees)
    ? (employees >= 5 && employees <= 500 ? 1 : employees <= 2000 ? 0.5 : 0.1)
    : 0.4;
  const recency = fresh == null ? 0.4 : fresh <= 30 ? 1 : fresh <= STALE_SIGNAL_DAYS ? 0.6 : 0.2;
  const evidenceQuality = clamp01(
    (n.evidenceUrl ? 0.5 : 0) +
    (n.evidenceUrl && !isShortenerUrl(n.evidenceUrl) ? 0.3 : 0) +
    (n.sourceDate ? 0.2 : 0),
  );
  const domainConfidence = clamp01(
    (n.canonicalDomain ? 0.6 : 0) +
    (n.canonicalDomain && parseDomain(n.canonicalDomain) && !/linkedin\.com/i.test(n.canonicalDomain) ? 0.4 : 0),
  );

  return {
    b2bRelevance: B2B_RE.test(hay) ? 1 : 0.3,
    companySizeFit: sizeFit,
    earlyOrGrowthStage: EARLY_STAGE_RE.test(hay) ? 1 : 0.4,
    recentFunding: FUNDING_RE.test(hay) ? 1 : 0,
    smallRevenueTeam: Number.isFinite(employees) && employees <= 200 ? 1 : 0.4,
    activeGtmHiring: PIPELINE_RE.test(hay) ? 1 : 0.4,
    founderLedSalesLikely: (n.raw.personName && Number.isFinite(employees) && employees <= 200) ? 1 : 0.4,
    pipelineNeed: PIPELINE_RE.test(hay) ? 1 : 0.3,
    signalRecency: recency,
    evidenceQuality,
    domainConfidence,
  };
}

function gateOf(gates: GateReport, id: HardGateResult["id"]): HardGateResult {
  return gates.gates.find((g) => g.id === id)!;
}

/** Map a gate outcome to a fraction of its point slice. */
function frac(g: HardGateResult, needsReviewFrac = 0.4): number {
  if (g.outcome === "pass") return 1;
  if (g.outcome === "needs_review") return needsReviewFrac;
  return 0;
}

/**
 * Independent 0–100 benchmark score. Weights (section 8):
 *   SaaS validity 15 · hiring signal 25 · US 15 · founder 15 · employer 15 ·
 *   evidence 10 · ICP 5.
 */
export function computeBenchmarkScore(gates: GateReport, secondary: SecondarySignals): BenchmarkScore {
  const saas = 15 * frac(gateOf(gates, "company_type"), 0.45);
  const hiring = 25 * frac(gateOf(gates, "hiring_signal"), 0.4);
  const us = 15 * frac(gateOf(gates, "us_relevance"), 0);
  const founder = 15 * frac(gateOf(gates, "founder_role"), 0.45);
  const employer = 15 * frac(gateOf(gates, "employer_match"), 0.3);
  const evidence = 10 * frac(gateOf(gates, "evidence"), 0.5) * (0.5 + 0.5 * secondary.evidenceQuality);
  const icp = 5 * clamp01(
    (secondary.b2bRelevance + secondary.companySizeFit + secondary.pipelineNeed + secondary.domainConfidence) / 4,
  );

  const components = {
    saas_validity: round2(saas),
    hiring_signal: round2(hiring),
    us_relevance: round2(us),
    founder_validity: round2(founder),
    employer_match: round2(employer),
    evidence: round2(evidence),
    icp_relevance: round2(icp),
  };
  const total = round2(Object.values(components).reduce((s, v) => s + v, 0));
  return { total, components };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
