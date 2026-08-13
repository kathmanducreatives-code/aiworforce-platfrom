// THE SHARED MISSION-EVALUATOR STUB FOR ENGINE TESTS.
//
// WHY EVERY ENGINE TEST NOW NEEDS ONE.
//
// Before the Phase 4 inversion, `leadCapabilityEngine` could qualify a company
// on its own: a deterministic gate pass was written out as if a classifier had
// produced it —
//
//     { company_fit: "pass", confidence: 0.8,
//       supporting_evidence: ["deterministic gates passed"] }
//
// — so a test that supplied no model dependency still saw companies qualify,
// and `company_brain_qualification` still reported evidence_satisfied.
//
// That fabrication is gone. The evaluator is now the only thing that can decide
// a Mission is satisfied, so a run with no evaluator qualifies NOBODY — by
// design. `evaluation_path` becomes `model_unavailable` and `decision_source`
// becomes `insufficient_evidence`, which is the honest answer and the whole
// point of the architecture.
//
// The consequence for tests is mechanical: any engine test whose subject is
// something OTHER than evaluator availability — capability ordering, provider
// choice, founder-discovery containment, Workbench projection — must now supply
// an evaluator, or it is really testing "what happens with no evaluator" by
// accident.
//
// This module is that evaluator. It is deliberately NOT a blanket "yes":
// `parseMissionEvaluationStrict` still runs, so a stub that cites an evidence_id
// which is not in the registry, or an excerpt that is not a verbatim substring
// of its source text, is downgraded exactly as a real model's output would be.
// A test cannot use this fixture to smuggle an ungrounded pass.
//
// PURE. No network, no provider, no model.

import {
  parseMissionEvaluationStrict,
} from "../../../supabase/functions/_shared/missionEvaluation.ts";
import type { CapabilityEngineDeps } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

/** Counts evaluator invocations so a test can assert one call per eligible company. */
export interface EvaluatorRecorder {
  evaluatorCalls: number;
  /** Company keys, in call order. */
  evaluated: string[];
}

export function newEvaluatorRecorder(): EvaluatorRecorder {
  return { evaluatorCalls: 0, evaluated: [] };
}

export interface StubEvaluatorOptions {
  /** Overrides the verdict. Defaults to a grounded pass. */
  mission_fit?: "pass" | "review" | "fail";
  icp_fit?: "strong" | "plausible" | "weak";
  hiring_fit?: "verified" | "plausible" | "absent";
  confidence?: number;
  match_score?: number;
  /**
   * Cite no evidence at all. `parseMissionEvaluationStrict` must then downgrade
   * a claimed pass to review — the rule that stops an ungrounded model answer
   * from qualifying anyone.
   */
  citeNothing?: boolean;
  /** Return unparseable output, so the caller sees insufficient_evidence. */
  unparseable?: boolean;
  recorder?: EvaluatorRecorder;
}

/**
 * An evaluator that answers from the company's OWN evidence registry.
 *
 * It finds a real job-evidence item and cites its real `evidence_id` with a
 * verbatim slice of its real `source_text`. That is what makes the resulting
 * pass survive the strict parser — the same bar a live model has to clear.
 */
export function stubMissionEvaluator(
  opts: StubEvaluatorOptions = {},
): NonNullable<CapabilityEngineDeps["evaluateMission"]> {
  return ({ registry, company_key }) => {
    if (opts.recorder) {
      opts.recorder.evaluatorCalls += 1;
      opts.recorder.evaluated.push(company_key);
    }
    if (opts.unparseable) {
      return Promise.resolve(parseMissionEvaluationStrict("not json at all", registry));
    }

    // Cite the company's own job evidence, verbatim.
    const job = registry.items.find((x) =>
      x.evidence_type === "job_posting" || x.evidence_type === "yc_job");
    const source = String(job?.source_text ?? "");
    const matched = (!opts.citeNothing && job && source)
      ? [{
        requirement: "hiring the requested role",
        evidence_id: job.evidence_id,
        // A VERBATIM prefix — anything else is dropped by the strict parser.
        excerpt: source.slice(0, Math.min(20, source.length)),
      }]
      : [];

    return Promise.resolve(parseMissionEvaluationStrict({
      mission_fit: opts.mission_fit ?? "pass",
      icp_fit: opts.icp_fit ?? "strong",
      hiring_fit: opts.hiring_fit ?? "verified",
      confidence: opts.confidence ?? 0.9,
      match_score: opts.match_score ?? 85,
      matched_requirements: matched,
      failed_requirements: [],
      reasoning: "the company satisfies the mission",
      rejection_reasons: [],
      evidence_quality: "strong",
      unknown_fields: [],
      next_action: null,
    }, registry));
  };
}
