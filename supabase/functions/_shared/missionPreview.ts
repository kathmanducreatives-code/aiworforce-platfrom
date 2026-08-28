// WHAT WILL ACTUALLY RUN, DESCRIBED FROM WHAT WILL ACTUALLY RUN.
//
// ── THE DEFECT THIS EXISTS TO END ──────────────────────────────────────────
//
// A live run narrated itself as:
//
//   "I created a 5-step plan: Scout will source recruiting/staffing companies,
//    Aria will screen and rank, Hawk will verify top 3, Scribe will summarize,
//    Penn will draft outreach."
//
// Five named agents, five described steps. The plan row did hold five steps, so
// the sentence was not invented — but the plan carried NO MISSION, so no
// capability graph was ever built, Stage 0 assessed an empty mission, and
// `run-agent`'s preflight refused the whole thing before a single provider call.
// One task was created. It failed. Nothing Scout, Aria, Hawk, Scribe or Penn
// were said to be doing was ever going to happen.
//
// The narration came from the planner that wrote the step list. This one comes
// from `buildCapabilityGraph(mission)` — the graph the engine executes, built
// from the compiled mission, after Stage 0 has assessed it. If a capability is
// not in that graph it cannot be described, because it cannot run.
//
// ── AND WHY THE GAPS ARE PART OF THE PREVIEW ───────────────────────────────
//
// `projectToLeadMission` already records what it could not express, and Stage 0
// records what it cannot satisfy. A preview that showed only the steps would be
// a confident description of a narrower run than the user asked for. Both lists
// travel with it.
//
// Pure. No network, no database, no model — which is the point: a preview that
// needed a model call would be a second interpretation of the request.

import { CAPABILITY_REGISTRY, type CapabilityPlan } from "./leadCapabilityGraph.ts";
import type { LeadMissionV1 } from "./leadMission.ts";
import type { FeasibilityReport } from "./requestFeasibility.ts";
import type { LeadProjection } from "./projectToLeadMission.ts";
import type { DeclaredGap } from "./outcomeContract.ts";

export const MISSION_PREVIEW_VERSION = "mission-preview-v1" as const;

/** One step the engine will actually attempt. */
export interface PreviewStep {
  capability: string;
  /** The actors this step may reach. Empty means it buys nothing. */
  providers: string[];
  cost_units: number;
  /** Plain description, derived from the capability id — never from a model. */
  describes: string;
}

export interface MissionPreview {
  version: typeof MISSION_PREVIEW_VERSION;
  /** What the run is for, from the mission — not a rewritten sentence. */
  summary: string;
  steps: PreviewStep[];
  /** Sum of the graph's own per-step costs. */
  estimated_cost_units: number;
  /** True when at least one step can reach a provider. */
  spends: boolean;
  /** Stage 0's verdict. A preview for an infeasible mission says so. */
  feasible: boolean;
  /** What was asked for and will NOT be done. */
  gaps: DeclaredGap[];
  /** The narration, assembled from `steps` and nothing else. */
  narration: string;
}

/**
 * How each capability reads to a person.
 *
 * ── THE LABEL COMES FROM THE CAPABILITY, NOT FROM HERE ─────────────────────
 *
 * This was a hand-written table in this file, and it immediately drifted: a
 * live preview printed "then company brain qualification, then persistence"
 * because two capabilities in the graph had no entry. A second vocabulary for
 * naming the same things is a second thing to keep in sync, and the first live
 * run found the gap.
 *
 * `CAPABILITY_REGISTRY` already carries `label`, documented as "Human label for
 * the preview card". Reading it means a capability added to the graph arrives
 * in the preview already named, by whoever defined it.
 */
const describe = (capability: string): string => {
  const spec = (CAPABILITY_REGISTRY as Record<string, { label?: string }>)[capability];
  const label = spec?.label;
  // A capability with no label prints its own id rather than a friendly guess.
  // Seeing one in a preview is a prompt to name it where it is defined.
  return typeof label === "string" && label ? label.toLowerCase() : capability.replace(/_/g, " ");
};

/**
 * Build the preview.
 *
 * TOTAL. A mission with no plan, or one Stage 0 refused, still produces a
 * preview — one that says so. Returning nothing would leave the caller to
 * invent a sentence, which is the failure mode being removed.
 */
export function buildMissionPreview(
  mission: LeadMissionV1 | null,
  plan: CapabilityPlan | null,
  feasibility: FeasibilityReport | null,
  projection?: LeadProjection | null,
): MissionPreview {
  const steps: PreviewStep[] = (plan?.steps ?? []).map((s) => ({
    capability: String(s.capability),
    providers: [...(s.providers ?? [])],
    cost_units: s.cost_units ?? 0,
    describes: describe(String(s.capability)),
  }));

  const gaps: DeclaredGap[] = [
    // What the request asked for that the lead surface could not express.
    ...(projection?.unprojected ?? []).map((u) => ({
      code: `unrepresented:${u}`,
      detail: `I can't filter on ${u.replace(/^filter:|^requirement:/, "")} in this run`,
    })),
    // What Stage 0 says cannot be satisfied.
    ...(feasibility?.refusals ?? []).map((r) => ({
      code: `not_feasible:${String((r as { code?: unknown }).code ?? "refused")}`,
      detail: String((r as { reason?: unknown }).reason ?? "part of this can't be run"),
    })),
    ...(feasibility?.declared_gaps ?? []).map((g) => ({
      code: `stage0_gap:${String((g as { code?: unknown }).code ?? "gap")}`,
      detail: String((g as { detail?: unknown }).detail ?? "declared gap"),
    })),
  ];

  const spends = steps.some((s) => s.providers.length > 0);
  const count = mission?.requested_count ?? null;
  const known = mission?.company_profile?.known_companies ?? [];

  const summary = steps.length === 0
    ? "I couldn't turn that into anything I can run."
    : known.length > 0
    ? `Look into ${known.slice(0, 3).join(", ")}${known.length > 3 ? ` and ${known.length - 3} more` : ""}.`
    : `Find${count ? ` ${count}` : ""} ${mission?.requested_output === "contact_ready_leads"
      ? "companies and the people to contact there" : "companies"} matching your brief.`;

  // ── THE NARRATION IS THE STEP LIST, IN ORDER ────────────────────────────
  //
  // No agent names. The graph names CAPABILITIES, and which agent performs one
  // is an execution detail that can change without the plan changing — saying
  // "Scout will…" claims knowledge of an assignment the preview does not have.
  const narration = steps.length === 0
    ? "There's nothing I can run for this yet."
    : `Here's what I'd run: ${steps.map((s) => s.describes).join(", then ")}.`
      + (spends ? " This one uses credits." : " None of this costs credits.")
      + (gaps.length > 0
        ? ` Worth knowing: ${gaps.map((g) => g.detail).join("; ")}.`
        : "");

  return {
    version: MISSION_PREVIEW_VERSION,
    summary,
    steps,
    estimated_cost_units: plan?.estimated_cost_units ?? 0,
    spends,
    feasible: feasibility?.ok !== false && steps.length > 0,
    gaps,
    narration,
  };
}
