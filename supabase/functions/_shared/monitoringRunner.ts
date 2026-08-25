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

import { missionHash, type LeadMissionV1 } from "./leadMission.ts";
import {
  compileMonitoringMission, monitoringPlanViolations,
  type MonitoringMissionInput, type MonitoringSubjectInput,
} from "./monitoringMission.ts";
import { filterCollectableSignals } from "./signalCollectability.ts";
import {
  preflight, summarisePreflight,
  type ExistingEvidence, type PlannedInvestigation, type PreflightDecision,
} from "./monitoringPreflight.ts";

export const MONITORING_RUNNER_VERSION = "monitoring-runner-v1" as const;

/** The authority monitoring spends under. Recognised as engine-owned. */
export const MONITORING_AUTHORITY = "monitoring_engine" as const;

/**
 * The prefix `known_company_resolution` gives a supplied company's id.
 *
 * Restated rather than imported to keep this module free of engine internals;
 * `monitoringRunner.test.ts` asserts the two agree.
 */
const SUPPLIED_ID_PREFIX = "mission_supplied:";

export interface MonitoringRunDeps {
  /** Builds the plan. The SAME builder Leads use. */
  buildPlan: (mission: LeadMissionV1) => {
    steps: Array<{ capability: string }>;
    offered_capabilities?: string[];
  };
  /**
   * Runs it. The SAME engine Leads use, with the shared execution seam.
   *
   * `resume` carries what an earlier invocation already paid for. See
   * `loadRunState` for what monitoring may and may not resume.
   */
  runPlan: (mission: LeadMissionV1, plan: unknown, resume: unknown | null) => Promise<{
    companies: Array<{
      key: string;
      company: { company_name: string | null; canonical_domain: string | null;
                 linkedin_company_url: string | null;
                 /** Set by `known_company_resolution` for a company the mission NAMED. */
                 external_source_id?: string | null };
      verdict?: string | null;
      signal_assessments?: Array<{ signal: string; verdict: string; evidence_ids: readonly string[] }>;
    }>;
    state: { qualified_company_keys: string[]; completed_capabilities: string[] };
  }>;
  /**
   * THE EXECUTION STATE AN EARLIER INVOCATION LEFT BEHIND.
   *
   * ── WHAT MONITORING MAY RESUME, AND WHAT IT MAY NOT ──────────────────────
   *
   * A Lead continuation restores two things: capability-level completion, and
   * the per-company records that make that completion meaningful. Monitoring
   * persists only the first — it has no per-company store — so honouring
   * `completed_capabilities` would skip stages whose RESULTS are gone, leaving
   * hiring verification with a company pool that has no identities.
   *
   * So a monitoring resume keeps exactly one thing: `pending_runs`. That is the
   * part that is expensive to lose — a provider run that started, was billed,
   * and finished after the tool stopped polling. The engine adopts its id
   * instead of starting a second one. Everything else re-runs, which for a
   * named company is free until enrichment.
   *
   * Null on the first pass, and null is the ordinary case.
   */
  loadRunState?: (workspaceId: string, missionHash: string) => Promise<unknown | null>;
  /** Persist the state this pass produced, for the next one. */
  saveRunState?: (
    workspaceId: string, missionHash: string, state: unknown, pendingRuns: number,
  ) => Promise<void>;
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
  | "plan_violates_monitoring_boundary"
  /**
   * THE ENGINE COULD NOT RUN — and that is a report, not a crash.
   *
   * The shared engine throws for conditions monitoring does not control: a
   * blocked discovery selector, an exhausted model quota, a provider that
   * refused. Letting those escape turned a run into an opaque 500 with the
   * cause visible only in the logs. A monitoring pass that could not collect is
   * a legitimate outcome, and it must SAY SO — a scheduler reading `ok: false`
   * with a reason can back off; a scheduler reading a 500 cannot tell an
   * out-of-credit account from a bug.
   */
  | "execution_failed";

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
export const CANONICAL_TYPE_FOR: Readonly<Record<string, { type: string; category: string }>> =
  Object.freeze({
    hiring: { type: "sales_hiring", category: "gtm" },
    funding: { type: "recent_funding", category: "growth" },
    expansion: { type: "market_expansion", category: "growth" },
    product_launch: { type: "product_launch", category: "product" },
    // NO CANONICAL TYPE EXISTS for a technology reading or for "the company
    // posted something", so neither can become an event and both are refused
    // by `signalCollectability` before anything is spent. `headcount_change`
    // has a type and no capability. All three are listed nowhere rather than
    // mapped to an approximation — a signal filed under the wrong type is
    // worse than a signal nobody collected.
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

  // ── WHAT CAN ACTUALLY BE COLLECTED, DECIDED BEFORE ANYTHING IS COMPILED ──
  //
  // A subject naming `funding`, `expansion`, `product_launch`, `technology` or
  // `post` used to compile cleanly, plan cleanly and run — resolving identity,
  // paying to enrich, reaching qualification, and establishing nothing, because
  // the capability that would prove the signal is either not scheduled for that
  // subject kind or not driven by the engine at all. The run reported `ok` and
  // the feed stayed empty.
  //
  // `signalCollectability` asks the real graph and the real engine-driven list,
  // so an uncollectible signal never reaches a plan and never costs anything —
  // and the subject is dropped with the reason, which is the whole difference
  // between an honest refusal and silence.
  const uncollectible: MonitoringRunOutcome["dropped_subjects"] = [];
  const collectableSubjects = input.subjects.map((s) => {
    const f = filterCollectableSignals(s.signals, s.kind);
    for (const d of f.dropped) {
      uncollectible.push({
        kind: s.kind, identifier: s.identifier ?? null,
        reason: `${d.event}: ${d.reason}`,
      });
    }
    return { ...s, signals: f.kept };
  });
  if (uncollectible.length > 0) log("monitoring_signals_uncollectible", { dropped: uncollectible });

  const compiled = compileMonitoringMission({ ...input, subjects: collectableSubjects });
  // The reasons a signal could not be collected travel with the run, whether or
  // not anything survived to be monitored.
  compiled.dropped.push(...uncollectible);
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
  //
  // The engine's failures are reported, never swallowed and never re-raised.
  // Nothing is written on this path: a run that could not collect has no
  // evidence, so there is no partial feed to publish.
  // ── WHAT AN EARLIER PASS LEFT IN FLIGHT ──────────────────────────────────
  const hash = await missionHash(compiled.mission);
  const stored = deps.loadRunState
    ? await deps.loadRunState(input.workspace_id, hash)
    : null;
  const resume = resumableState(stored, hash);
  if (resume) {
    log("monitoring_resume", {
      mission_hash: hash,
      pending_runs: (resume.pending_runs as Array<{ capability: string; run_id: string }>)
        .map((r) => `${r.capability}:${r.run_id}`),
    });
  }

  let run: Awaited<ReturnType<MonitoringRunDeps["runPlan"]>>;
  try {
    run = await deps.runPlan(compiled.mission, plan, resume);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log("monitoring_execution_failed", { detail });
    return {
      ok: false, refusal: "execution_failed", reason: detail,
      accepted_subjects: compiled.accepted.length, dropped_subjects: compiled.dropped,
      completed_capabilities: [], preflight: pre,
      events: { attempted: 0, written: 0, deduplicated: 0, failed: 0 },
      boundaries: { lead_steps_scheduled: [], authority: MONITORING_AUTHORITY },
    };
  }

  // ── KEEP WHAT THIS PASS PAID FOR ─────────────────────────────────────────
  //
  // Written before the events, deliberately: a pending provider run is money
  // already spent, and losing its id costs more than losing this pass's feed.
  if (deps.saveRunState) {
    const pending = (run.state as { pending_runs?: unknown[] }).pending_runs ?? [];
    await deps.saveRunState(input.workspace_id, hash, run.state, pending.length);
  }

  // ── WRITE CANONICAL EVENTS ───────────────────────────────────────────────
  //
  // ── WHICH COMPANIES MAY PRODUCE ONE, AND WHY IT DEPENDS ON THE SUBJECT ───
  //
  // This required `verdict === "pass"` for every company, and the reason was
  // sound for the case it was written against: an ICP monitor DISCOVERS
  // companies, and without a fit verdict its feed would be everything it looked
  // at rather than what changed.
  //
  // Live run 2026-08-24 showed it is the wrong question for a NAMED subject.
  // The evaluator was asked whether Vercel satisfies a mission whose ICP is
  // empty — because a `competitor` subject states no verticals, stages or
  // locations — and answered `insufficient_evidence`, which is correct. There
  // was no fit question to answer: the workspace had already answered it by
  // naming the company.
  //
  // So the gate is the subject's, not one rule for both:
  //
  //   ICP subject     — the company must QUALIFY. It was discovered, and fit is
  //                     precisely what is in doubt.
  //   NAMED subject   — the SIGNAL must be evidenced. Fit was decided when the
  //                     workspace chose to watch this company.
  //
  // Both still require a verified or plausible signal verdict, and those come
  // from `assessSignals`, which is computed from what actually RAN — so a
  // signal nobody investigated can never produce an event either way.
  const events = { attempted: 0, written: 0, deduplicated: 0, failed: 0 };
  const qualified = new Set(run.state.qualified_company_keys);

  /**
   * The subject a company came from, or null if the engine discovered it.
   *
   * Matched on `external_source_id`, which `known_company_resolution` sets to
   * the supplied string verbatim. Matching on the company's domain or name
   * instead would fail for a subject identified by LinkedIn URL, which carries
   * neither.
   */
  const subjectFor = (c: { company: { external_source_id?: string | null } }) => {
    const id = String(c.company.external_source_id ?? "");
    if (!id.startsWith(SUPPLIED_ID_PREFIX)) return null;
    const raw = id.slice(SUPPLIED_ID_PREFIX.length);
    return compiled.accepted.find((s) =>
      (s.identifier ?? "").trim().toLowerCase() === raw) ?? null;
  };

  for (const c of run.companies) {
    const subject = subjectFor(c);
    // A discovered company still has to qualify. A named one does not.
    if (!subject && !qualified.has(c.key)) continue;

    for (const a of c.signal_assessments ?? []) {
      if (a.verdict !== "verified" && a.verdict !== "plausible") continue;
      const event = a.signal.split("/")[0];
      const canon = CANONICAL_TYPE_FOR[event];
      if (!canon) continue;

      // ── THE SUBJECT MODEL, CARRIED THROUGH ───────────────────────────────
      //
      // This wrote `subject_type: "company"` for everything, which erases the
      // distinction Phase 2 exists to hold: a competitor is not an account.
      //
      // And the KEY has to be the one the pre-flight asks with. It read the
      // company's domain or name; the pre-flight reads the subject's own
      // identifier. For a subject named by LinkedIn URL the first is null and
      // the two could never match, so held evidence would never be found and
      // every pass would re-buy what the last one proved.
      const subjectType = subject?.kind === "competitor" ? "competitor" : "company";
      const subjectKey = subject
        ? canonicalise(subject.identifier)
        : canonicalise(c.company.canonical_domain ?? c.company.company_name);
      if (!subjectKey) {
        log("monitoring_event_skipped_no_subject", { company: c.key });
        continue;
      }

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
          subject_type: subjectType,
          subject_key: subjectKey,
          dedupe_key: `monitor|${subjectType}|${subjectKey}|${canon.type}`,
          verification_status: "unverified",
          lifecycle_status: "active",
          normalized_value: {
            // THE NAME A READER WILL RECOGNISE. A company supplied by LinkedIn
            // URL carries no name of its own until enrichment, and a feed row
            // reading `null` is useless. The subject's label is what the
            // workspace called it, so it is the honest fallback — never a name
            // derived from the URL, which would be a guess.
            company_name: c.company.company_name ?? subject?.label ?? null,
            signal: a.signal,
            verdict: a.verdict,
            subject_kind: subject?.kind ?? "discovered",
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


/**
 * The part of a stored state a monitoring pass may act on.
 *
 * Two checks, both refusals rather than repairs: the state must be the version
 * this code understands, and it must belong to THIS question — the engine
 * re-checks the hash too, and a mismatch there silently discards the state,
 * which would make a resumed run look like a fresh one for no stated reason.
 *
 * What survives is `pending_runs` alone. `completed_capabilities` is
 * deliberately dropped: monitoring keeps no per-company records, so a skipped
 * stage would leave the pool without the results that stage produced.
 */
export function resumableState(
  stored: unknown, expectedHash: string,
): Record<string, unknown> | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Record<string, unknown>;
  if (typeof s.version !== "string" || !s.version.startsWith("capability-execution-state-")) {
    return null;
  }
  if (s.mission_hash !== expectedHash) return null;
  const pending = Array.isArray(s.pending_runs) ? s.pending_runs : [];
  if (pending.length === 0) return null;

  // THE STORED STATE, KEPT WHOLE — with one field emptied.
  //
  // Returning a hand-built subset was the first attempt and it was wrong twice
  // over: the engine spreads this object and reads `provider_attempts`, so a
  // partial state crashed the run; and the accounting it carries —
  // `provider_attempts`, `accumulated_cost_units` — is the TRUE record of what
  // this question has already cost and must not be reset to zero by a resume.
  //
  // `completed_capabilities` is the one thing that cannot be honoured. See the
  // note on `loadRunState`: monitoring keeps no per-company records, so a stage
  // marked complete would be skipped while the results it produced are gone.
  return {
    ...s,
    provider_attempts: Array.isArray(s.provider_attempts) ? s.provider_attempts : [],
    pending_runs: pending,
    completed_capabilities: [],
  };
}
