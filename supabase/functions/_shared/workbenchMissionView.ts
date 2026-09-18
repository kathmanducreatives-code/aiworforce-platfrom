// LEAD V2 P5 — ONE PROJECTION OWNS EVERY NUMBER.
//
// The Workbench read three independent count sources — `progress`, the
// portfolio and the evaluation rows — and they disagreed, so a run could show
// "10 discovered" beside "0 evaluated · 3 qualified" and no row explained the
// other seven. The plan's answer is one view: each discovered company lands in
// EXACTLY ONE bucket, and the buckets sum to `discovered` by construction.
//
//   discovered
//     ├── screened_out          the cheap gate ruled it out before paid work
//     ├── identity_unresolved   nothing could say which company it is
//     ├── investigating         still being worked; no eligibility yet
//     ├── ineligible            a hard criterion is disproven (a disposition)
//     ├── pending               a hard criterion is unknown — "needs verification"
//     └── exact_match · strong_opportunity · worth_considering · low_priority
//
// The label buckets hold only ELIGIBLE candidates, and the order above is the
// order the bucket is chosen in, so a company cannot be counted twice.
//
// `legacyCountsFrom` derives the old keys from this same view — the migration
// contract: the legacy surfaces keep working, but they stop being a second
// source of truth.
//
// Pure.

import type { CompanyEvidenceGraph } from "./evidenceGraph.ts";
import type { MissionCriterion } from "./missionCriteria.ts";
import type { ResearchWaveSummary } from "./researchFeedback.ts";
import {
  evaluateEligibility, type CheckProvenance, type CheckResult, type EligibilityResult,
} from "./candidateEligibility.ts";
import {
  applyReasoning, computeCeiling, deterministicReasons, type Label, type ReasonedLabel, type ReasonedSentence,
} from "./opportunityLabel.ts";

export const WORKBENCH_MISSION_VIEW_VERSION = "workbench-mission-view-v1" as const;

export type MissionStage =
  | "planning" | "retrieving" | "completing_evidence" | "reasoning" | "complete" | "stopped";

export type Bucket =
  | "screened_out" | "identity_unresolved" | "investigating" | "ineligible" | "pending" | Label;

export interface MissionCandidate {
  company_key: string;
  name: string | null;
  domain: string | null;
  linkedin_url: string | null;
  /** Route ids that found it (P4 `found_by`). */
  found_by: string[];
  /** The cheap gate's reason, when it ruled the candidate out before paid work. */
  screened_out: string | null;
  identity_resolved: boolean;
  /** False while the candidate is still waiting for its stages. */
  investigated: boolean;
  graph: CompanyEvidenceGraph;
  next_action?: string | null;
}

export interface WorkbenchLead {
  company: { key: string; name: string | null; domain: string | null; linkedin_url: string | null };
  label: Label | null;
  bucket: Bucket;
  found_by: string[];
  hard_checks: Record<string, CheckResult>;
  /**
   * P5.2 — each hard check with the evidence it rests on: status, method,
   * confidence, actor and the grounding decision. What a pass or fail MEANS.
   */
  hard_check_details: Array<{
    criterion_id: string; dimension: string; result: CheckResult; reason: string;
    provenance: CheckProvenance | null;
  }>;
  why_surfaced: ReasonedSentence[];
  key_evidence: Array<{ dimension: string; value: unknown; status: string; sources: string[]; evidence_id: string | null }>;
  missing_evidence: string[];
  caveats: string[];
  evidence_coverage: number;
  signal_strength: number;
  next_action: string | null;
}

export interface WorkbenchCounts {
  discovered: number;
  screened_out: number;
  investigating: number;
  identity_unresolved: number;
  pending: number;
  exact_match: number;
  strong_opportunity: number;
  worth_considering: number;
  low_priority: number;
  ineligible: number;
}

export interface WorkbenchMissionView {
  version: typeof WORKBENCH_MISSION_VIEW_VERSION;
  mission: {
    requested_count: number;
    execution_limit: number | null;
    criteria: Array<{ id: string; label: string; kind: MissionCriterion["kind"]; source: string; window: string | null; status: string }>;
    unsupported: string[];
  };
  stage: MissionStage;
  counts: WorkbenchCounts;
  leads: WorkbenchLead[];
  routes: Array<{
    route_id: string; anchor: string; spend_usd: number; raw: number; unique: number;
    duplicates: number; hard_eligible: number; useful: number; stop_reason: string | null;
  }>;
  cost: {
    provider_settled_usd: number; provider_pending_usd: number; model_usd: number;
    unknown_cost_calls: number; credits: number;
  };
}

export interface ViewInput {
  mission: { requested_count: number; execution_limit: number | null; anchor: string | null };
  criteria: readonly MissionCriterion[];
  unsupported?: readonly string[];
  candidates: readonly MissionCandidate[];
  stage: MissionStage;
  waves?: readonly ResearchWaveSummary[];
  cost?: Partial<WorkbenchMissionView["cost"]>;
  /** A reasoner's proposals by company key. Absent ⇒ code's own reasons. */
  reasoning?: Record<string, { label?: unknown; why_surfaced?: unknown } | undefined>;
}

/** Which bucket a candidate belongs to. First match wins, so exactly one. */
export function bucketOf(
  c: MissionCandidate, eligibility: EligibilityResult, label: Label | null,
): Bucket {
  if (c.screened_out) return "screened_out";
  if (!c.identity_resolved) return "identity_unresolved";
  if (eligibility.eligibility === "ineligible") return "ineligible";
  if (!c.investigated) return "investigating";
  if (eligibility.eligibility === "pending") return "pending";
  return label ?? "low_priority";
}

function keyEvidence(graph: CompanyEvidenceGraph): WorkbenchLead["key_evidence"] {
  return graph.claims
    .filter((c) => c.current)
    .slice(0, 8)
    .map((c) => ({
      dimension: c.dimension, value: c.current!.value, status: c.current!.status,
      sources: c.sources, evidence_id: c.current!.evidence_id,
    }));
}

function caveatsFor(graph: CompanyEvidenceGraph, r: ReasonedLabel, e: EligibilityResult): string[] {
  const out: string[] = [];
  for (const dim of graph.conflicts) out.push(`sources disagree about ${dim.replace(/_/g, " ")}`);
  for (const claim of graph.claims) {
    if (!claim.current && claim.stale.length > 0) out.push(`the only ${claim.dimension.replace(/_/g, " ")} evidence has expired`);
  }
  if (r.dropped_a_level) out.push("the reasoner's explanation cited no real evidence, so the label was lowered");
  if (r.capped_from) out.push(`the reasoner proposed ${r.capped_from.replace(/_/g, " ")}; the evidence supports no more than this`);
  if (e.eligibility === "pending") out.push("a required fact is still unproven — this is not a match yet");
  return [...new Set(out)].slice(0, 6);
}

export function buildWorkbenchMissionView(i: ViewInput): WorkbenchMissionView {
  const counts: WorkbenchCounts = {
    discovered: i.candidates.length, screened_out: 0, investigating: 0, identity_unresolved: 0,
    pending: 0, exact_match: 0, strong_opportunity: 0, worth_considering: 0, low_priority: 0, ineligible: 0,
  };
  const leads: WorkbenchLead[] = [];

  for (const c of i.candidates) {
    const eligibility = evaluateEligibility(i.criteria, c.graph);
    const ceiling = computeCeiling({ criteria: i.criteria, graph: c.graph, eligibility, anchor: i.mission.anchor });
    const proposal = i.reasoning?.[c.company_key];
    const reasoned = applyReasoning(ceiling, proposal ?? null);
    const why = reasoned.why_surfaced.length > 0 || proposal
      ? reasoned.why_surfaced
      : deterministicReasons(ceiling, c.graph);
    const bucket = bucketOf(c, eligibility, reasoned.label);
    counts[bucket] += 1;

    leads.push({
      company: { key: c.company_key, name: c.name, domain: c.domain, linkedin_url: c.linkedin_url },
      // A bucket that is not a label is not a lead label either — `pending` and
      // `ineligible` are dispositions, and the UI must not render them as matches.
      label: bucket === "exact_match" || bucket === "strong_opportunity" ||
        bucket === "worth_considering" || bucket === "low_priority" ? reasoned.label : null,
      bucket,
      found_by: c.found_by,
      hard_checks: eligibility.hard_checks,
      hard_check_details: eligibility.checks.filter((x) => x.kind === "hard").map((x) => ({
        criterion_id: x.criterion_id, dimension: x.dimension, result: x.result, reason: x.reason,
        provenance: x.provenance,
      })),
      why_surfaced: why,
      key_evidence: keyEvidence(c.graph),
      missing_evidence: reasoned.missing_evidence,
      caveats: caveatsFor(c.graph, reasoned, eligibility),
      evidence_coverage: ceiling.evidence_coverage,
      signal_strength: ceiling.signal_strength,
      next_action: c.next_action ?? null,
    });
  }

  // Ranking: label first, then coverage, then signal strength — deterministic,
  // and separate from the label itself.
  const order: Bucket[] = ["exact_match", "strong_opportunity", "worth_considering", "low_priority", "pending", "investigating", "identity_unresolved", "ineligible", "screened_out"];
  leads.sort((a, b) =>
    order.indexOf(a.bucket) - order.indexOf(b.bucket) ||
    b.evidence_coverage - a.evidence_coverage ||
    b.signal_strength - a.signal_strength ||
    a.company.key.localeCompare(b.company.key));

  const lastWave = i.waves?.[i.waves.length - 1];
  const routes = (lastWave?.routes ?? []).map((r) => ({
    route_id: r.route_id ?? `${r.capability}:${r.actor_key}`,
    anchor: r.capability,
    spend_usd: r.cost_settled_usd,
    raw: r.rows,
    unique: r.new_companies,
    duplicates: r.merged_into_existing,
    hard_eligible: r.hard_pass,
    // Useful = a candidate this route found that reached a surfaced label.
    useful: leads.filter((l) => l.label !== null && l.found_by.includes(r.route_id ?? "")).length,
    stop_reason: r.status === "stopped" ? "route_stopped" : null,
  }));

  return {
    version: WORKBENCH_MISSION_VIEW_VERSION,
    mission: {
      requested_count: i.mission.requested_count,
      execution_limit: i.mission.execution_limit,
      criteria: i.criteria.filter((c) => c.status === "ok").map((c) => ({
        id: c.id, label: c.label, kind: c.kind, source: c.source,
        window: c.time_window ? `last ${c.time_window.days} days` : null,
        status: c.status,
      })),
      unsupported: [...(i.unsupported ?? [])],
    },
    stage: i.stage,
    counts,
    leads,
    routes,
    cost: {
      provider_settled_usd: i.cost?.provider_settled_usd ?? lastWave?.cost.settled_usd ?? 0,
      provider_pending_usd: i.cost?.provider_pending_usd ??
        round4(Math.max(0, (lastWave?.cost.committed_usd ?? 0) - (lastWave?.cost.settled_usd ?? 0))),
      model_usd: i.cost?.model_usd ?? 0,
      unknown_cost_calls: i.cost?.unknown_cost_calls ?? 0,
      credits: i.cost?.credits ?? 0,
    },
  };
}

/** Every bucket except `discovered`, which they sum to. */
export function countsAreExclusive(c: WorkbenchCounts): boolean {
  const parts = c.screened_out + c.identity_unresolved + c.investigating + c.pending +
    c.exact_match + c.strong_opportunity + c.worth_considering + c.low_priority + c.ineligible;
  return parts === c.discovered;
}

/**
 * The legacy keys, DERIVED from the view rather than counted again.
 *
 * `qualified` is the surfaced labels; `unknown_pending_evidence` is `pending`,
 * which the old projection conflated with rejection; `rejected` is only what a
 * hard criterion actually disproved.
 */
export function legacyCountsFrom(v: WorkbenchMissionView): {
  discovered: number; evaluated: number; qualified: number; rejected: number;
  unknown_pending_evidence: number; screened_out: number;
} {
  const c = v.counts;
  const qualified = c.exact_match + c.strong_opportunity + c.worth_considering + c.low_priority;
  return {
    discovered: c.discovered,
    evaluated: qualified + c.pending + c.ineligible,
    qualified,
    rejected: c.ineligible,
    unknown_pending_evidence: c.pending,
    screened_out: c.screened_out,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
