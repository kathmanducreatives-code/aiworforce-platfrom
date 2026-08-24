// SIGNALS COLLECTS ITS OWN INTELLIGENCE — THROUGH THE SHARED ENGINE.
//
// ── WHAT THIS ENDPOINT IS ───────────────────────────────────────────────────
//
// The thinnest possible caller. It authenticates, loads the workspace's
// monitoring subjects, and hands them to `runMonitoring`, which asks the SAME
// `runCapabilityPlan` Leads use through the SAME execution seam.
//
// It contains no actor name, no provider call, no credit arithmetic and no
// ledger write. Every one of those is inherited from `buildInvoker`, which is
// the whole point: Signals gets its own monitoring INTENT, never its own
// provider stack.
//
// ── WHY IT CANNOT WRITE LEAD ROWS ───────────────────────────────────────────
//
// Three independent reasons, none of which is a convention:
//   the plan carries no `persistence` step;
//   this file never imports the persistence bridge;
//   it spends under `monitoring_engine`, which the legacy writer refuses to
//   publish behind.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runTool } from "../_shared/toolRegistry.ts";
import { buildInvoker } from "../_shared/capabilityExecution.ts";
import { buildCapabilityGraph } from "../_shared/leadCapabilityGraph.ts";
import {
  runCapabilityPlan,
  type CapabilityEngineDeps, type CapabilityEngineOpts,
} from "../_shared/leadCapabilityEngine.ts";
import { makeGptDiscoveryPlanner } from "../_shared/gptDiscoveryPlanner.ts";
import {
  buildMissionEvaluationBinding,
} from "../_shared/missionEvaluationBinding.ts";
import { parseMissionEvaluationStrict } from "../_shared/missionEvaluation.ts";
import { writeSignalEventV2 } from "../_shared/signalsV2Writer.ts";
import { isSignalsV2Enabled } from "../_shared/signalsV2Flag.ts";
import { compileCompanyBrainContext } from "../_shared/companyBrainCompiler.ts";
import {
  runMonitoring, MONITORING_AUTHORITY,
} from "../_shared/monitoringRunner.ts";
import type { MonitoringSubjectInput } from "../_shared/monitoringMission.ts";
import type { ExistingEvidence } from "../_shared/monitoringPreflight.ts";

/**
 * THE CANDIDATE CEILING FOR ONE MONITORING PASS.
 *
 * Monitoring has no requested count — nobody ordered N companies — so the bound
 * has to come from somewhere, and an unbounded watch is an unbounded bill. This
 * is the ceiling for a pass, and it is also the evaluation budget: never more
 * model calls than companies.
 */
const MONITORING_MAX_CANDIDATES = 25;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── TWO CALLERS, AND ONLY TWO ─────────────────────────────────────────────
  //
  // A PERSON, from the app, holding their own JWT. Authorised by membership.
  //
  // THE SCHEDULER, holding the service role key and no user at all. This is not
  // a convenience: monitoring subjects carry a cadence, and a run fired by a
  // cadence has nobody signed in. A monitoring endpoint that could only be
  // invoked by a logged-in human could never actually monitor.
  //
  // The scheduler path is deliberately narrow — the bearer must BE the service
  // role key, which no browser ever holds — and it is the only path that skips
  // the membership check, because there is no member to check.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.slice("Bearer ".length).trim();
  const scheduled = SUPABASE_SERVICE_ROLE_KEY.length > 0 &&
    token === SUPABASE_SERVICE_ROLE_KEY;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  let userId: string | null = null;
  if (!scheduled) {
    const { data: userData, error: uerr } = await userClient.auth.getUser(token);
    if (uerr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
    userId = userData.user.id;
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is legal */ }
  const workspace_id = String(body.workspace_id ?? "");
  if (!workspace_id) return json({ error: "workspace_id required" }, 400);

  // MEMBERSHIP IS CHECKED SERVER-SIDE, BEFORE THE SERVICE CLIENT EXISTS. The
  // admin client below bypasses RLS, so a human caller's right to this
  // workspace has to be established while only their own token is in play.
  if (!scheduled) {
    const { data: member } = await userClient
      .from("workspace_members").select("workspace_id")
      .eq("workspace_id", workspace_id).eq("user_id", userId).maybeSingle();
    if (!member) return json({ error: "forbidden_workspace" }, 403);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── WHAT THIS WORKSPACE ASKED TO WATCH ────────────────────────────────────
  const { data: subjectRows, error: sErr } = await admin
    .from("monitoring_subjects")
    .select("subject_kind, identifier, label, signals, timeframe_days")
    .eq("workspace_id", workspace_id).eq("enabled", true);
  if (sErr) return json({ error: "subjects_unavailable", detail: sErr.message }, 500);

  const subjects: MonitoringSubjectInput[] = (subjectRows ?? []).map((r) => ({
    kind: r.subject_kind,
    identifier: r.identifier,
    label: r.label,
    signals: Array.isArray(r.signals) ? r.signals : [],
    timeframe_days: r.timeframe_days,
  }));
  if (subjects.length === 0) {
    // NOT AN ERROR. A workspace that has asked for nothing is not broken; it is
    // unconfigured, and saying so is more useful than an empty success.
    return json({
      ok: false, reason: "no_monitoring_subjects",
      message: "This workspace has no enabled monitoring subjects.",
    }, 200);
  }

  // ── THE ICP, FOR AN `icp` SUBJECT ─────────────────────────────────────────
  //
  // Same Company Brain, same compiler, same call shape Radar and Leads use. The
  // field renaming below is a translation, not a second definition: the brain
  // speaks `industries`/`maturity_stage`, the monitoring contract speaks
  // `verticals`/`stages`, and nothing here invents a value the brain lacks.
  const { data: brainRow } = await admin
    .from("company_brain").select("profile").eq("workspace_id", workspace_id).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const profile = (brainRow?.profile as any) ?? {};
  const brain = compileCompanyBrainContext({
    workspace_id, profile, signal_preferences: profile?.signal_preferences,
  });
  const sizeMin = brain.icp.company_size_min;
  const sizeMax = brain.icp.company_size_max;
  const icp = {
    verticals: brain.icp.industries ?? [],
    business_models: brain.icp.business_models ?? [],
    locations: brain.icp.locations ?? [],
    stages: brain.icp.maturity_stage ?? [],
    employee_range: (sizeMin != null || sizeMax != null)
      ? { ...(sizeMin != null ? { min: sizeMin } : {}), ...(sizeMax != null ? { max: sizeMax } : {}) }
      : null,
  };

  // ── THE SHARED EXECUTION SEAM ─────────────────────────────────────────────
  //
  // Identical to the one both Lead routes use. Only the authority differs, so
  // monitoring's spend is attributable to monitoring in the ledger.
  const baseCtx = {
    admin, workspace_id, agent_slug: "signals-monitor",
    agent_id: null, agent_name: "Signals Monitor",
    plan_id: null, task_id: null, user_id: userId,
    // Null on a scheduled run, and honestly so: nobody asked for it.
  };
  const invoke = buildInvoker({
    runTool,
    toolCtx: baseCtx,
    auditOwnership: () => ({
      execution_owner: "monitoring", planner_owner: "deterministic",
      planner_adapter: null, planner_outcome: null, planner_fallback_reason: null,
    }),
    persistenceAuthority: MONITORING_AUTHORITY,
    log: (msg, meta) => console.error(`[monitoring][${msg}]`, meta),
  });

  // ── WHY `planExecution` IS NOT WIRED ────────────────────────────────────
  //
  // It re-plans the CAPABILITY CHAIN at runtime. `monitoringPlanViolations`
  // checks the plan once, before any spend, and a planner that can amend the
  // chain afterwards could reintroduce a lead-only capability behind that
  // check. Its documented absence — "the graph's own authorised order" — is
  // exactly the order monitoring already validated, so omitting it keeps the
  // boundary check meaningful rather than advisory.

  const v2Enabled = isSignalsV2Enabled();

  const outcome = await runMonitoring(
    { workspace_id, subjects, icp },
    {
      buildPlan: buildCapabilityGraph,
      runPlan: async (mission, plan) => {
        // ── THE SAME ENGINE, THE SAME MODEL SEAMS ─────────────────────────
        //
        // Two of the engine's dependencies are not optional in practice, and
        // leaving them out would have produced a monitoring run that looked
        // healthy and found nothing:
        //
        //   `planDiscovery` — ABSENT IS A BLOCK, not a default. The engine
        //   returns `no_discovery_selector` and chooses no actors at all.
        //
        //   `evaluateMission` — the qualification authority. Absent, every
        //   company is held as insufficient evidence, `qualified_company_keys`
        //   is empty, and monitoring writes zero events.
        //
        // Both are the SAME shared factories `run-agent` wires. Reusing them is
        // the convergence working; re-implementing either would have been the
        // parallel Signals stack this phase exists to avoid.
        const evalBinding = buildMissionEvaluationBinding({
          workspaceId: workspace_id,
          // MONITORING HAS NO REQUESTED COUNT, so it has no quota-derived
          // shortlist. The candidate ceiling is the budget: never more calls
          // than companies, which is the same rule Leads apply.
          shortlistSize: MONITORING_MAX_CANDIDATES,
        });
        let evalCalls = 0;
        console.log("[monitoring][mission-evaluation][binding]", evalBinding.diagnostics);

        const run = await runCapabilityPlan(
          {
            invoke,
            // THE ENGINE'S OWN DIAGNOSTICS. Optional in the type, and its
            // absence is why the first live run reported "nothing completed"
            // with no explanation of what it had refused to do.
            log: (m, meta) => console.log(`[monitoring][engine] ${m}`, meta ?? ""),
            // Monitoring never runs `founder_discovery` — a lead-only
            // capability the boundary check rejects — so employer verification
            // has nothing to verify and is wired as a no-op rather than a
            // second implementation.
            verifyEmployer: () => ({ verified: false, outcome: "not_attempted" }),
            planDiscovery: makeGptDiscoveryPlanner({
              readEnv: (k) => { try { return Deno.env.get(k); } catch { return undefined; } },
              log: (m, meta) => console.log(`[monitoring][gpt-discovery] ${m}`, meta ?? ""),
            }, {
              brain: {
                positive_industries: icp.verticals ?? [],
                excluded_industries: [],
                employee_min: icp.employee_range?.min ?? null,
                employee_max: icp.employee_range?.max ?? null,
                required_geography: null,
                disqualifiers: brain.disqualifiers?.keywords ?? [],
                business_models: icp.business_models ?? [],
              },
              // Omitted, honestly: monitoring is watching, not filling an order.
            }),
            // `planExecution` IS DELIBERATELY OMITTED — see below.
            evaluateMission: evalBinding.evaluateMission
              ? async ({ input, registry, company_key }) => {
                if (evalCalls >= evalBinding.callsRemaining) {
                  console.log("[monitoring][mission-evaluation][budget-exhausted]", {
                    company_key, calls_made: evalCalls,
                  });
                  return null;
                }
                evalCalls++;
                const raw = await evalBinding.evaluateMission!(
                  input as unknown as Record<string, unknown>);
                const parsed = parseMissionEvaluationStrict(raw, registry);
                console.log("[monitoring][mission-evaluation]", {
                  company_key, parse_status: parsed.parse_status,
                  decision: parsed.evaluation.decision,
                });
                return parsed;
              }
              : undefined,
          } satisfies CapabilityEngineDeps,
          {
            mission, plan, maxCandidates: MONITORING_MAX_CANDIDATES,
          } as CapabilityEngineOpts,
        );
        // deno-lint-ignore no-explicit-any
        return run as any;
      },
      loadHeldEvidence: async (ws) => {
        // CROSS-ORIGIN BY CONSTRUCTION: no origin filter. Evidence a Lead
        // mission proved is exactly what must be reused rather than re-bought.
        const { data } = await admin
          .from("signal_events")
          .select("signal_type, occurred_at, occurred_at_basis, observed_at, origin, account_id, subject_type, subject_key, lifecycle_status")
          .eq("workspace_id", ws)
          .eq("lifecycle_status", "active")
          .order("observed_at", { ascending: false })
          .limit(500);
        return (data ?? []) as ExistingEvidence[];
      },
      writeEvent: async (input) => {
        // deno-lint-ignore no-explicit-any
        const r = await writeSignalEventV2({ admin, enabled: v2Enabled } as any, input as any);
        return {
          written: r.written === true,
          deduplicated: r.deduplicated === true,
          error_class: r.error_class ?? null,
        };
      },
      log: (msg, meta) => console.log(`[monitoring][${msg}]`, meta),
    },
  );

  // Stamp the run so a subject's cadence has a last-run to measure from.
  if (outcome.ok) {
    await admin.from("monitoring_subjects")
      .update({ last_run_at: new Date().toISOString() })
      .eq("workspace_id", workspace_id).eq("enabled", true);
  }

  return json({
    ...outcome,
    signals_v2_enabled: v2Enabled,
    workspace_id,
    invoked_by: scheduled ? "scheduler" : "user",
  }, outcome.ok ? 200 : 409);
});
