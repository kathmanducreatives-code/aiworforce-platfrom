// CAN THIS GRAPH ACTUALLY ESTABLISH WHAT THE REQUEST PROMISES?
//
// The planner answers "what would I run". This answers the question that has to
// be true before any of it is bought:
//
//     for every material requirement the user stated, and for the output they
//     asked to receive, does the FINAL executable graph contain a step whose
//     declared providers can produce the proof?
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// "Find companies matching my ICP that are actively hiring sales roles" planned
// discovery -> identity -> enrichment -> qualification and bought nothing that
// could prove hiring. That was fixed at its own call site. The audit then found
// the same shape elsewhere with no guard at all:
//
//     "Find companies with headcount growth."
//       signals required : [headcount_change]
//       proves the signal: false
//       preflight ok     : true   blocked=[]
//
// `headcount_change` appears nowhere in ACTOR_EVIDENCE and `headcountGrowth.ts`
// reports `insufficient_evidence` by design — and four paid stages still
// scheduled. One-off `if (signal === "hiring")` branches cannot close that,
// because the defect is structural: nothing was comparing the requirement list
// against the graph's actual proving power.
//
// ── DERIVED, NOT TABULATED ─────────────────────────────────────────────────
//
// Every answer here comes from sources that already exist and are already
// maintained for other reasons:
//
//     ACTOR_EVIDENCE        what a provider can prove, for which population
//     CAPABILITY_REGISTRY   which providers a step runs, what artifact it makes
//     CLAIM_TO_EVENT        which artifact constitutes proof of which event
//
// There is exactly one new mapping in this file — `OUTPUT_REQUIRES_ARTIFACT` —
// and it is a semantic bridge nothing else in the codebase states: which
// artifact a requested_output is made of. It is five lines, it sits beside the
// output vocabulary it mirrors, and `outputVocabularyIsCovered` turns "someone
// added an output and forgot this" into a test failure rather than a silent
// pass.
//
// Pure. No network, no provider, no model call, no I/O.

import {
  CAPABILITY_REGISTRY,
  CLAIM_TO_EVENT,
  type CapabilityPlan,
} from "./leadCapabilityGraph.ts";
import {
  evidenceCoversPopulation,
  evidenceProducedBy,
} from "./actorEvidenceCapability.ts";
import { REQUESTED_OUTPUTS, type LeadMissionV1 } from "./leadMission.ts";

export const FEASIBILITY_VERSION = "request-feasibility-v1" as const;

/**
 * What the final graph can do about one stated requirement.
 *
 * Graded rather than boolean, because "unprovable" and "must refuse" are not
 * the same thing and conflating them breaks working behaviour. A mission asking
 * for hiring AND funding is served today by proving hiring and reporting
 * funding as a gap — no funding actor is called. That is correct: the user gets
 * the companies they can have, and is told plainly what could not be
 * established. Refusing the whole run would destroy value the request could
 * legitimately deliver.
 *
 * What is NOT acceptable is the same run reporting success as though funding
 * had been checked. So every gap is carried, named and surfaced.
 */
export type RequirementStatus =
  /** A scheduled capability's providers can prove it for this population. */
  | "satisfied"
  /** Nothing in the graph — or the catalogue — can prove it. */
  | "unsupported"
  /** Provable, but only for a cohort this request is not limited to. */
  | "population_mismatch"
  /** Producible, but only behind an explicit user unlock. Not a defect. */
  | "requires_unlock";

export interface RequirementAssessment {
  /** The user's own words for this requirement, where they exist. */
  requirement: string;
  status: RequirementStatus;
  /** The scheduled step that establishes it, when one does. */
  by_capability?: string;
  /** Why, in terms a person can act on. */
  message: string;
  detail: Record<string, unknown>;
}

export type FeasibilityRefusalCode =
  /**
   * E — not one stated signal requirement can be established. The request's
   * entire evidentiary premise is unmet, so any spend buys nothing that
   * answers it.
   */
  | "no_requirement_provable"
  /** B/H — the promised output has no production path anywhere. */
  | "output_unproducible";

export interface FeasibilityRefusal {
  code: FeasibilityRefusalCode;
  requirement: string;
  message: string;
  detail: Record<string, unknown>;
}

export interface FeasibilityReport {
  version: typeof FEASIBILITY_VERSION;
  /** False only when a refusal below must stop paid work. */
  ok: boolean;
  mission_cohort: string | null;
  /** Every stated signal requirement, graded. */
  requirements: RequirementAssessment[];
  /** The requested output, graded. */
  outputs: RequirementAssessment[];
  /** The BLOCKING subset. Empty means paid work may start. */
  refusals: FeasibilityRefusal[];
  /**
   * Requirements that will NOT be established by this run.
   *
   * The preview shows these, and execution may not report them as satisfied —
   * invariant H's raw material.
   */
  declared_gaps: string[];
}

/**
 * The artifact each requested output is MADE OF.
 *
 * Capability specs already declare what they `produces`; this says which of
 * those artifacts constitutes the deliverable. Without it a mission can promise
 * `contact_ready_leads` from a graph whose last step is `persistence` over
 * companies.
 */
const OUTPUT_REQUIRES_ARTIFACT: Readonly<Record<string, string>> = Object.freeze({
  qualified_companies: "qualification_verdict",
  enriched_companies: "company_evidence",
  contact_ready_leads: "contact_method",
  job_listings: "job_posting",
  social_posts: "company_activity_evidence",
});

/**
 * Every output in the vocabulary has a stated artifact.
 *
 * Read by the test suite. A new `RequestedOutput` with no entry above would
 * otherwise be feasible by default, which is the failure mode this module
 * exists to remove.
 */
export function outputVocabularyIsCovered(): { ok: boolean; missing: string[] } {
  const missing = REQUESTED_OUTPUTS.filter((o) => !(o in OUTPUT_REQUIRES_ARTIFACT));
  return { ok: missing.length === 0, missing: [...missing] };
}

/**
 * The cohort the plan's discovery is restricted to, or null for unrestricted.
 *
 * Read from the entry capability rather than the mission's prose: the entry is
 * what actually decides which companies enter the pool.
 */
export function missionCohortOf(plan: CapabilityPlan): string | null {
  return plan.entry_capability === "startup_company_discovery" ? "y_combinator" : null;
}

interface Step { capability: string; providers: string[] }

/**
 * Does this step establish `event`/`subject` for this population?
 *
 * `event`/`subject` arrive as plain strings because a MISSION may name a
 * requirement the evidence vocabulary does not have — `headcount_change` is
 * exactly that case, and refusing it is the point. They are widened at this
 * boundary rather than narrowed upstream: a value outside the union simply
 * matches no evidence, which is the correct answer.
 */
function stepProves(step: Step, event: string, subject: string, cohort: string | null): boolean {
  const ev = event as Parameters<typeof evidenceCoversPopulation>[1];
  const su = subject as Parameters<typeof evidenceCoversPopulation>[2];
  // Two declared routes, no inference:
  //   1. its PROVIDERS return evidence for that event (ACTOR_EVIDENCE), or
  //   2. its own declared artifact IS proof of that event (CLAIM_TO_EVENT),
  //      which still requires a provider behind it.
  if (evidenceCoversPopulation(step.providers, ev, su, cohort)) return true;
  const spec = CAPABILITY_REGISTRY[step.capability as keyof typeof CAPABILITY_REGISTRY];
  if (!spec) return false;
  return spec.produces.some((artifact) =>
    CLAIM_TO_EVENT[artifact] === event &&
    evidenceCoversPopulation(spec.providers, ev, su, cohort));
}

/** Can ANY capability in the catalogue produce this artifact, scheduled or not? */
function catalogueProduces(artifact: string): string[] {
  return Object.entries(CAPABILITY_REGISTRY)
    .filter(([, spec]) => (spec as { produces: string[] }).produces.includes(artifact))
    .map(([id]) => id);
}

/**
 * Assess whether `plan` can establish everything `mission` promises.
 *
 * Returns a report rather than throwing: the preflight decides what blocks, the
 * preview shows the grades, and tests read it directly.
 */
export function assessRequestFeasibility(
  mission: LeadMissionV1 | null,
  plan: CapabilityPlan | null,
): FeasibilityReport {
  const cohort = plan ? missionCohortOf(plan) : null;
  const report: FeasibilityReport = {
    version: FEASIBILITY_VERSION,
    ok: true,
    mission_cohort: cohort,
    requirements: [],
    outputs: [],
    refusals: [],
    declared_gaps: [],
  };
  // No mission or no plan is a different failure with its own preflight codes.
  // Saying it twice in two vocabularies makes the real reason harder to read.
  if (!mission || !plan) return report;

  const steps: Step[] = plan.steps.map((s) => ({
    capability: String(s.capability),
    providers: (s.providers ?? []).map(String),
  }));
  const allProviders = steps.flatMap((s) => s.providers);

  // ── grade every stated signal requirement ────────────────────────────────
  for (const sig of mission.required_signals ?? []) {
    const event = String(sig.event ?? sig.type ?? "").trim();
    if (!event) continue;
    const subject = String(sig.subject ?? "company");
    const phrase = String(sig.phrase ?? sig.type ?? event);
    const detail = { event, subject, mission_cohort: cohort };

    const by = steps.find((s) => stepProves(s, event, subject, cohort));
    if (by) {
      report.requirements.push({
        requirement: phrase, status: "satisfied", by_capability: by.capability,
        message: `Established by ${by.capability}.`, detail,
      });
      continue;
    }

    // Provable by something in this plan, but not for THESE companies. The
    // hiring bug's exact shape, now graded for every signal rather than one.
    const blindMatch = evidenceProducedBy(allProviders)
      .some((p) => p.event === event && p.subject === subject);
    if (blindMatch) {
      report.requirements.push({
        requirement: phrase, status: "population_mismatch",
        message:
          `"${event}" can only be proven here for a ${cohort ?? "restricted"} ` +
          `population, which this request is not limited to.`,
        detail,
      });
    } else {
      report.requirements.push({
        requirement: phrase, status: "unsupported",
        message:
          `Nothing scheduled can establish "${event}". No capability in this ` +
          `plan has a provider producing ${event}/${subject} evidence.`,
        detail: { ...detail, scheduled: steps.map((s) => s.capability) },
      });
    }
  }

  // ── grade the requested output ───────────────────────────────────────────
  const output = String(mission.requested_output ?? "");
  const needed = OUTPUT_REQUIRES_ARTIFACT[output];
  if (needed) {
    const scheduled = steps.find((s) => {
      const spec = CAPABILITY_REGISTRY[s.capability as keyof typeof CAPABILITY_REGISTRY];
      return !!spec && spec.produces.includes(needed);
    });
    const elsewhere = catalogueProduces(needed);
    if (scheduled) {
      report.outputs.push({
        requirement: `output:${output}`, status: "satisfied",
        by_capability: scheduled.capability,
        message: `Produced by ${scheduled.capability}.`,
        detail: { output, required_artifact: needed },
      });
    } else if (elsewhere.length > 0) {
      // DEFERRED, NOT IMPOSSIBLE.
      //
      // People stages are stripped from every automatic plan on purpose — that
      // is the spend boundary, and person work is a deliberate user action. So
      // a `contact_ready_leads` mission whose plan stops at companies is not
      // broken; it is staged. Refusing it would block the core Lead flow.
      // Naming it `requires_unlock` is what lets the preview say "explicit
      // unlock required" instead of promising contacts it will not fetch.
      report.outputs.push({
        requirement: `output:${output}`, status: "requires_unlock",
        message:
          `"${output}" needs ${elsewhere.join(" or ")}, which runs only after an ` +
          `explicit unlock. This run will produce the company stage.`,
        detail: { output, required_artifact: needed, unlocked_by: elsewhere },
      });
    } else {
      report.outputs.push({
        requirement: `output:${output}`, status: "unsupported",
        message:
          `Nothing in the capability catalogue produces ${needed}, so "${output}" ` +
          `cannot be delivered by any plan.`,
        detail: { output, required_artifact: needed },
      });
    }
  }

  // ── decide what BLOCKS ───────────────────────────────────────────────────
  //
  // Narrow on purpose. A gap is a thing to disclose; only two states make the
  // spend itself pointless or dishonest.
  const signalReqs = report.requirements;
  const anyProvable = signalReqs.some((r) => r.status === "satisfied");
  if (signalReqs.length > 0 && !anyProvable) {
    // Every stated requirement fails. Whatever this run buys, it cannot answer
    // the question that was asked.
    report.refusals.push({
      code: "no_requirement_provable",
      requirement: signalReqs.map((r) => r.requirement).join(", "),
      message:
        `This plan cannot establish ${signalReqs.length === 1 ? "the requirement" : "any requirement"} ` +
        `the request depends on: ${signalReqs.map((r) => r.message).join(" ")}`,
      detail: { requirements: signalReqs.map((r) => ({ r: r.requirement, s: r.status })) },
    });
  }
  for (const o of report.outputs) {
    if (o.status === "unsupported") {
      report.refusals.push({
        code: "output_unproducible", requirement: o.requirement,
        message: o.message, detail: o.detail,
      });
    }
  }

  report.declared_gaps = [...signalReqs, ...report.outputs]
    .filter((r) => r.status !== "satisfied")
    .map((r) => `${r.requirement} (${r.status})`);
  report.ok = report.refusals.length === 0;
  return report;
}
