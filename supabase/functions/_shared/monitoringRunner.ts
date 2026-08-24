// MONITORING, RUN THROUGH THE SHARED ENGINE.
//
// ── WHAT MAKES THIS A THIN CALLER AND NOT A SECOND STACK ────────────────────
//
// It owns no providers, no credit logic, no ledger writes and no actor
// knowledge. It compiles monitoring subjects into a mission, asks the SAME
// `runCapabilityPlan` Leads use — through the SAME `buildInvoker` seam — and
// turns what comes back into `signal_events`.
//
// Everything that costs money or touches an actor is inherited. If this file
// ever grows a provider call, the convergence has failed.
//
// ── THE TWO BOUNDARIES IT ENFORCES ──────────────────────────────────────────
//
//   NO LEAD ROWS. It spends under `monitoring_engine`, which the legacy
//   writer's guard recognises as engine-owned and refuses to publish behind;
//   its plan carries no `persistence` step; and it never calls the persistence
//   bridge. Three independent reasons, because one would be a convention.
//
//   NO RE-PURCHASE. Every planned investigation goes through the cross-origin
//   pre-flight first, so evidence a Lead mission proved an hour ago is reused
//   rather than bought again.
//
// PURE ORCHESTRATION. Engine, store and writer are all injected.

import type { LeadMissionV1 } from "./leadMission.ts";
import {
  compileMonitoringMission, monitoringPlanViolations,
  type MonitoringMissionInput, type MonitoringSubjectInput,
} from "./monitoringMission.ts";
import {
  preflight, summarisePreflight,
  type ExistingEvidence, type PlannedInvestigation, type PreflightDecision,
} from "./monitoringPreflight.ts";

export const MONITORING_RUNNER_VERSION = "monitoring-runner-v1" as const;

/** The authority monitoring spends under. Recognised as engine-owned. */
export const MONITORING_AUTHORITY = "monitoring_engine" as const;

export interface MonitoringRunDeps {
  /** Builds the plan. The SAME builder Leads use. */
  buildPlan: (mission: LeadMissionV1) => {
    steps: Array<{ capability: string }>;
    offered_capabilities?: string[];
  };
  /** Runs it. The SAME engine Leads use, with the shared execution seam. */
  runPlan: (mission: LeadMissionV1, plan: unknown) => Promise<{
    companies: Array<{
      key: string;
      company: { company_name: string | null; canonical_domain: string | null;
                 linkedin_company_url: string | null };
      verdict?: string | null;
      signal_assessments?: Array<{ signal: string; verdict: string; evidence_ids: readonly string[] }>;
    }>;
    state: { qualified_company_keys: string[]; completed_capabilities: string[] };
  }>;
  /** Evidence already held, for the pre-flight. Never written by this module. */
  loadHeldEvidence: (workspaceId: string) => Promise<ExistingEvidence[]>;
  /** Writes one canonical event. Owned by `signalsV2Writer`. */
  writeEvent: (input: Record<string, unknown>) => Promise<{
    written: boolean; deduplicated?: boolean; error_class?: string | null;
  }>;
  log?: (msg: string, meta?: unknown) => void;
}

export type MonitoringRefusal =
  | "no_usable_subjects"
  | "plan_violates_monitoring_boundary";

export interface MonitoringRunOutcome {
  ok: boolean;
  refusal: MonitoringRefusal | null;
  reason: string;
  /** Which subjects were watched, and which were dropped and why. */
  accepted_subjects: number;
  dropped_subjects: Array<{ kind: string; identifier: string | null; reason: string }>;
  /** The capabilities that actually ran. */
  completed_capabilities: string[];
  /** Reuse accounting — how much spend the pre-flight avoided, and from where. */
  preflight: ReturnType<typeof summarisePreflight>;
  events: { attempted: number; written: number; deduplicated: number; failed: number };
  /** Proof, carried in the result rather than assumed. */
  boundaries: { lead_steps_scheduled: string[]; authority: string };
}

/**
 * Which canonical signal type a mission signal produces.
 *
 * Narrow and explicit. A hiring signal proves `sales_hiring`; there is no
 * default, because a signal with no canonical type must produce no event rather
 * than a plausible-looking one.
 */
const CANONICAL_TYPE_FOR: Readonly<Record<string, { type: string; category: string }>> =
  Object.freeze({
    hiring: { type: "sales_hiring", category: "gtm" },
    funding: { type: "recent_funding", category: "growth" },
    expansion: { type: "market_expansion", category: "growth" },
    product_launch: { type: "product_launch", category: "product" },
    headcount_change: { type: "employee_growth", category: "growth" },
  });

/**
 * Run one monitoring pass.
 *
 * The order is deliberate: compile, CHECK THE BOUNDARY, pre-flight, execute,
 * write. The boundary check happens before anything is spent, so a plan that
 * would have behaved like a sourcing run costs nothing to refuse.
 */
export async function runMonitoring(
  input: MonitoringMissionInput, deps: MonitoringRunDeps,
): Promise<MonitoringRunOutcome> {
  const log = deps.log ?? (() => {});
  const empty = summarisePreflight([]);

  const compiled = compileMonitoringMission(input);
  if (!compiled.ok || !compiled.mission) {
    return {
      ok: false, refusal: "no_usable_subjects", reason: compiled.reason,
      accepted_subjects: compiled.accepted.length, dropped_subjects: compiled.dropped,
      completed_capabilities: [], preflight: empty,
      events: { attempted: 0, written: 0, deduplicated: 0, failed: 0 },
      boundaries: { lead_steps_scheduled: [], authority: MONITORING_AUTHORITY },
    };
  }

  const plan = deps.buildPlan(compiled.mission);

  // ── THE BOUNDARY, CHECKED BEFORE ANY SPEND ───────────────────────────────
  const violations = monitoringPlanViolations(plan);
  if (violations.length > 0) {
    log("monitoring_boundary_violation", { violations });
    return {
      ok: false, refusal: "plan_violates_monitoring_boundary",
      reason: violations.join("; "),
      accepted_subjects: compiled.accepted.length, dropped_subjects: compiled.dropped,
      completed_capabilities: [], preflight: empty,
      events: { attempted: 0, written: 0, deduplicated: 0, failed: 0 },
      boundaries: {
        lead_steps_scheduled: plan.steps.map((s) => s.capability)
          .filter((c) => violations.some((v) => v.startsWith(c))),
        authority: MONITORING_AUTHORITY,
      },
    };
  }

  // ── PRE-FLIGHT: WHAT DO WE ALREADY KNOW? ─────────────────────────────────
  const held = await deps.loadHeldEvidence(input.workspace_id);
  const decisions: PreflightDecision[] = [];
  for (const s of compiled.accepted) {
    for (const sig of s.signals) {
      const planned: PlannedInvestigation = {
        // A named subject is asked about by identity; an ICP subject is a
        // cohort question, which held evidence cannot answer.
        subject_type: s.kind === "competitor" ? "competitor"
          : s.kind === "tracked_company" ? "company" : null,
        subject_key: s.kind === "icp" ? null : canonicalise(s.identifier),
        event: sig.event,
        subject: sig.subject ?? "company",
        timeframe_days: s.timeframe_days ?? input.default_timeframe_days ?? null,
      };
      decisions.push(preflight(planned, held));
    }
  }
  const pre = summarisePreflight(decisions);
  log("monitoring_preflight", pre);

  // ── EXECUTE THROUGH THE SHARED ENGINE ────────────────────────────────────
  const run = await deps.runPlan(compiled.mission, plan);

  // ── WRITE CANONICAL EVENTS ───────────────────────────────────────────────
  //
  // Only for companies that QUALIFIED and only for signals that were actually
  // evidenced. A monitoring run that wrote an event per discovered company
  // would be a feed of everything it looked at, not of what changed.
  const events = { attempted: 0, written: 0, deduplicated: 0, failed: 0 };
  const qualified = new Set(run.state.qualified_company_keys);

  for (const c of run.companies) {
    if (!qualified.has(c.key)) continue;
    for (const a of c.signal_assessments ?? []) {
      if (a.verdict !== "verified" && a.verdict !== "plausible") continue;
      const event = a.signal.split("/")[0];
      const canon = CANONICAL_TYPE_FOR[event];
      if (!canon) continue;

      events.attempted++;
      try {
        const res = await deps.writeEvent({
          workspace_id: input.workspace_id,
          origin: "scheduled_monitor",
          signal_type: canon.type,
          signal_category: canon.category,
          // NO SOURCE TIME IS INVENTED. The engine's evidence carries dates
          // where a provider reported one; this stage does not, so it says so
          // rather than writing the run time.
          occurred_at: null,
          occurred_at_basis: "unknown",
          subject_type: "company",
          subject_key: canonicalise(
            c.company.canonical_domain ?? c.company.company_name),
          dedupe_key: `monitor|${c.key}|${canon.type}`,
          verification_status: "unverified",
          lifecycle_status: "active",
          normalized_value: {
            company_name: c.company.company_name,
            signal: a.signal,
            verdict: a.verdict,
          },
        });
        if (res.written) events.written++;
        else if (res.deduplicated) events.deduplicated++;
        else events.failed++;
      } catch (e) {
        events.failed++;
        log("monitoring_event_write_failed", { company: c.key, error: String(e) });
      }
    }
  }

  return {
    ok: true, refusal: null,
    reason: `monitored ${compiled.accepted.length} subject(s); ` +
      `${pre.reused} investigation(s) reused, ${pre.investigating} bought`,
    accepted_subjects: compiled.accepted.length,
    dropped_subjects: compiled.dropped,
    completed_capabilities: run.state.completed_capabilities,
    preflight: pre,
    events,
    boundaries: { lead_steps_scheduled: [], authority: MONITORING_AUTHORITY },
  };
}

/** Lowercase slug. Mirrors `canonicalSubjectKey` without importing a cycle. */
function canonicalise(raw: string | null | undefined): string {
  return (raw ?? "").toString().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
    .replace(/^-+|-+$/g, "") || "unknown";
}
