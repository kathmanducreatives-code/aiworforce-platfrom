// ONE OBJECT THAT ANSWERS "WHY DID AGENTORY DO THIS?"
//
// ── THE QUESTION THIS EXISTS FOR ─────────────────────────────────────────────
//
// The 2026-08-18 forensic audit of run 25f3ff57 took a database session, seven
// SQL queries across two Supabase projects, a `git show` of the deployed commit,
// and a regex sweep of a 4,900-line engine — to establish a fact the run itself
// had recorded and then scattered:
//
//   the mission asked for `startup_company_discovery`
//   the gate APPROVED it            (`capability_decision.rejected: []`)
//   the router ran `general_company_discovery` instead
//
// Every piece was persisted. No single row contained the contradiction, so
// nobody could see it.
//
// ── WHAT MAKES A TRACE ANSWERABLE ────────────────────────────────────────────
//
// Not more fields. The pieces below are ORDERED as the decisions were made, and
// each one carries WHO made it — `gpt`, `code`, or `provider`. That is the axis
// the audit actually needed: not "what happened" but "who chose this, and what
// did they choose it over".
//
// So every entry answers three things:
//   * what was decided
//   * who decided it
//   * what it was decided INSTEAD OF, when something was rejected or skipped
//
// A field that cannot answer the third is usually a metric, and metrics belong
// in `funnel`.
//
// PURE. No network, model or database access — it reads state and shapes it.

import type { LeadMissionV1 } from "./leadMission.ts";
import type { CapabilityPlan } from "./leadCapabilityGraph.ts";

export const LEAD_RUN_TRACE_VERSION = "lead-run-trace-v1" as const;

/** Who made a decision. The axis the audit could not reconstruct. */
export type DecisionOwner = "gpt" | "code" | "provider";

export interface TraceInput {
  mission: LeadMissionV1;
  graph: CapabilityPlan;
  /** `CapabilityExecutionState`, read structurally so this module stays pure. */
  state: {
    discovery_strategy?: Record<string, unknown>;
    execution_plan?: Record<string, unknown> | null;
    terminal_reason?: string | null;
    fallback_reason?: string | null;
    provider_attempts?: Array<{
      capability: string; provider: string; attempt: number;
      outcome: string; rows: number; cost_units: number; reason?: string | null;
    }>;
    accumulated_cost_units?: number;
  };
  capability_outcomes: Array<{
    capability: string;
    status: string;
    rows: number;
    providers_used: string[];
    evidence_satisfied: boolean;
    reason: string | null;
  }>;
  /** `ModelRoutingLedger.summary()`. */
  model_routing?: Record<string, unknown> | null;
  funnel?: Record<string, unknown> | null;
  /** Why the run ended, in the quota controller's words. */
  stopped?: { reason: string; detail?: string | null } | null;
  qualified?: number;
  requested?: number;
}

export interface LeadRunTrace {
  version: typeof LEAD_RUN_TRACE_VERSION;
  [k: string]: unknown;
}

/**
 * Assemble the trace.
 *
 * Defensive throughout: every field is optional at the source, and a trace that
 * throws while explaining a failed run would be the worst possible time to
 * throw. A missing piece is reported as missing.
 */
export function buildLeadRunTrace(i: TraceInput): LeadRunTrace {
  const m = i.mission;
  const plan = i.state.execution_plan as
    | { steps?: Array<Record<string, unknown>>; reasoning?: string; source?: string;
        violations?: string[]; amended_after_discovery?: boolean;
        amended_reasoning?: string }
    | null
    | undefined;

  const attempts = i.state.provider_attempts ?? [];

  return {
    version: LEAD_RUN_TRACE_VERSION,

    // ── 1. WHAT WAS ASKED ────────────────────────────────────────────────
    request: {
      original_user_query: m.original_user_query,
      requested_count: m.requested_count,
      requested_output: m.requested_output,
    },

    // ── 2. HOW IT WAS UNDERSTOOD, and by whom ────────────────────────────
    mission: {
      decided_by: (m.mission_parser_source === "gpt_validated"
        ? "gpt"
        : "code") as DecisionOwner,
      parser_source: m.mission_parser_source,
      mission_type: m.mission_type,
      target_entity: m.target_entity,
      company_profile: m.company_profile,
      required_signals: m.required_signals,
      required_signal_terms: m.required_signal_terms,
      // WHAT THE RUN HAD TO PROVE. The single most useful line when a run
      // returns zero: it names the evidence every later stage is judged against.
      required_evidence: m.directives?.required_evidence ?? [],
      hard_constraints: (m as { hard_constraints?: unknown }).hard_constraints ?? null,
      evaluation_instructions: m.directives?.evaluation_instructions ?? null,
    },

    // ── 3. WHICH STAGES WERE AUTHORISED, and why that entry ──────────────
    capability_graph: {
      decided_by: "code" as DecisionOwner,
      entry_capability: i.graph.entry_capability,
      routing_reason: i.graph.routing_reason,
      // Facts the router knows and the model cannot infer. These used to be
      // branches that silently rewrote the plan.
      advisories: i.graph.routing_advisories,
      steps: i.graph.steps.map((s) => ({
        capability: s.capability, reason: s.reason, providers: s.providers,
      })),
      prohibited: i.graph.prohibited,
    },

    // ── 4. THE CHAIN GPT PLANNED ─────────────────────────────────────────
    execution_plan: plan
      ? {
        decided_by: "gpt" as DecisionOwner,
        source: plan.source ?? null,
        reasoning: plan.reasoning ?? null,
        steps: plan.steps ?? [],
        validator_violations: plan.violations ?? [],
        amended_after_discovery: plan.amended_after_discovery ?? false,
        amendment_reasoning: plan.amended_reasoning ?? null,
      }
      : {
        decided_by: "code" as DecisionOwner,
        source: null,
        note:
          "no execution plan was produced; the run followed the capability " +
          "graph's own authorised order",
      },

    // ── 5. WHICH ACTORS DISCOVERY CHOSE, and what was refused ────────────
    discovery_strategy: i.state.discovery_strategy ?? null,

    // ── 6. EVERY PROVIDER CALL, with what it cost and returned ───────────
    provider_calls: {
      decided_by: "provider" as DecisionOwner,
      total: attempts.length,
      cost_units: i.state.accumulated_cost_units ?? 0,
      calls: attempts.map((a) => ({
        capability: a.capability,
        actor: a.provider,
        attempt: a.attempt,
        outcome: a.outcome,
        rows: a.rows,
        cost_units: a.cost_units,
        reason: a.reason ?? null,
      })),
    },

    // ── 7. WHAT EACH STAGE DID — INCLUDING WHAT IT SKIPPED AND WHY ───────
    //
    // `skipped` is separated deliberately. A stage that did not run is the
    // hardest thing to notice in a trace and the most common cause of a
    // surprising result, and "skipped" with no reason beside it is exactly the
    // silence this whole module exists to remove.
    stages: i.capability_outcomes.map((o) => ({
      capability: o.capability,
      status: o.status,
      rows: o.rows,
      actors_used: o.providers_used,
      evidence_satisfied: o.evidence_satisfied,
      reason: o.reason,
    })),
    skipped_stages: i.capability_outcomes
      .filter((o) => o.status === "skipped_no_input" || o.status === "exhausted")
      .map((o) => ({
        capability: o.capability, status: o.status,
        reason: o.reason ?? "(no reason recorded — this is a bug)",
      })),

    // ── 8. WHICH MODEL RAN WHICH STAGE, AND WHY THAT TIER ────────────────
    model_routing: i.model_routing ?? null,

    // ── 9. THE OUTCOME, AND WHY IT ENDED ─────────────────────────────────
    outcome: {
      qualified: i.qualified ?? null,
      requested: i.requested ?? m.requested_count ?? null,
      met_request: i.qualified != null && i.requested != null
        ? i.qualified >= i.requested
        : null,
      funnel: i.funnel ?? null,
      terminal_reason: i.state.terminal_reason ?? null,
      fallback_reason: i.state.fallback_reason ?? null,
      stopped: i.stopped ?? null,
    },
  };
}

/**
 * The one-screen version, for a log line or a support reply.
 *
 * Not a substitute for the trace — a summary that cannot be wrong is a summary
 * that says nothing. This states the decisions in order and stops.
 */
export function describeLeadRunTrace(t: LeadRunTrace): string[] {
  const g = t.capability_graph as { entry_capability?: string; routing_reason?: string };
  const p = t.execution_plan as {
    decided_by?: string; source?: string;
    steps?: Array<{ capability?: string; actor_key?: string | null }>;
  };
  const o = t.outcome as {
    qualified?: number | null; requested?: number | null; terminal_reason?: string | null;
  };
  const req = t.request as { original_user_query?: string };
  const skipped = (t.skipped_stages ?? []) as Array<{ capability: string; reason: string }>;

  return [
    `request: ${req.original_user_query ?? "(none)"}`,
    `entry: ${g.entry_capability ?? "(none)"} — ${g.routing_reason ?? ""}`,
    `plan (${p.decided_by ?? "?"}/${p.source ?? "none"}): ${
      (p.steps ?? []).map((s) => `${s.capability}:${s.actor_key ?? "-"}`).join(" → ") || "(none)"
    }`,
    ...skipped.map((s) => `skipped ${s.capability}: ${s.reason}`),
    `outcome: ${o.qualified ?? "?"} of ${o.requested ?? "?"} qualified` +
      (o.terminal_reason ? ` — ${o.terminal_reason}` : ""),
  ];
}
