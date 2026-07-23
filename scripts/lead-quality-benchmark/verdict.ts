// Benchmark verdict assignment (section 9).
//
// The ordering rule is strict:
//   REJECT       — any hard-gate FAIL, or a duplicate. Dominates everything.
//   CONTACT      — every hard gate PASS, score ≥ threshold, why-now supported,
//                  signal not stale, no mismatch.
//   WATCH        — plausible core relevance, but a non-critical factor needs
//                  more evidence, or timing is weak/stale, or why-now is unsupported.
//   NEEDS_REVIEW — genuinely ambiguous company/evidence; cannot safely decide.
//
// A failed hard gate can NEVER be CONTACT regardless of the model/benchmark score.

import { CONTACT_THRESHOLD } from "./score.ts";
import type { BenchmarkScore, BenchmarkVerdict, DuplicateStatus, GateReport, ReasonCode, WhyNowAudit } from "./types.ts";

export interface VerdictInput {
  gates: GateReport;
  score: BenchmarkScore;
  whyNow: WhyNowAudit;
  duplicateStatus: DuplicateStatus;
  /** The hiring signal is older than the staleness threshold. */
  stale: boolean;
  /** True when a why-now statement was produced at all. */
  hasWhyNow: boolean;
}

export function decideVerdict(v: VerdictInput): BenchmarkVerdict {
  if (v.duplicateStatus !== "unique") return "REJECT";
  if (v.gates.gates.some((g) => g.outcome === "fail")) return "REJECT";

  if (v.gates.allHardPass) {
    const whyNowOk = v.hasWhyNow ? v.whyNow.supported : false;
    if (v.score.total >= CONTACT_THRESHOLD && whyNowOk && !v.stale) return "CONTACT";
    return "WATCH";
  }

  // No fails, but at least one needs_review.
  const companyGate = v.gates.gates.find((g) => g.id === "company_type")!;
  const evidenceGate = v.gates.gates.find((g) => g.id === "evidence")!;
  if (companyGate.outcome === "needs_review" || evidenceGate.outcome === "needs_review") {
    return "NEEDS_REVIEW";
  }
  return "WATCH";
}

/** Collect the reason codes explaining a verdict, for the CSV/report. */
export function verdictReasonCodes(v: VerdictInput): ReasonCode[] {
  const codes = new Set<ReasonCode>();
  if (v.duplicateStatus === "duplicate_account") codes.add("duplicate_account");
  if (v.duplicateStatus === "duplicate_person") codes.add("duplicate_person");
  for (const g of v.gates.gates) {
    if (g.outcome !== "pass" && g.reasonCode) codes.add(g.reasonCode);
  }
  if (v.stale) codes.add("stale_hiring_signal");
  if (v.hasWhyNow && !v.whyNow.supported) codes.add("why_now_unsupported");
  return [...codes];
}
