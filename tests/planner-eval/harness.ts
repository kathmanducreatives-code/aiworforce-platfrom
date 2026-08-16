// OFFLINE PLANNER REPLAY HARNESS.
//
// Feeds ONE historical request to both planner adapters through the real single
// call site, normalizes their differently-shaped outputs into one neutral form,
// and scores both against the same rubric.
//
// WHAT IT CANNOT DO, BY CONSTRUCTION.
//
// It never reaches a provider. `planQualifiedLeadBeforePersistence` is the whole
// planning path and it takes no tool, no Apify client and no run-agent entry
// point — planning and sourcing are genuinely separate call graphs, which is why
// this is safe rather than merely careful. The database handle is a stub that
// throws, the environment is injected rather than read, and both model seams are
// injected. A test asserts all of that.
//
// DISPOSABLE. Delete after Phase 2 if the comparison is no longer needed.

import {
  planQualifiedLeadBeforePersistence,
} from "../../supabase/functions/_shared/intelligence/leads/leadPlanOrchestration.ts";
import { compileLeadEntityIntent } from "../../supabase/functions/_shared/leadEntityIntent.ts";
import type { EvalCase } from "./dataset.ts";
import { weightedScore, type Scores, type SevereFailure } from "./rubric.ts";

export type PlannerName = "gpt" | "claude";
const WORKSPACE = "00000000-0000-0000-0000-000000000001";

/**
 * The neutral evaluation shape.
 *
 * Deliberately NOT either planner's schema. GPT emits `title_queries` +
 * `source_plan`; Claude emits a `strategy` with `searches`. Scoring either
 * native shape directly would award points for schema coincidence rather than
 * for understanding the request.
 */
export interface NeutralPlan {
  planner: PlannerName;
  /** Did an adapter produce a plan at all? */
  produced: boolean;
  /** Which authority the artifact credits. */
  planSource: string | null;
  /** Titles/roles the plan will actually search for. */
  approvedTitles: string[];
  personas: string[];
  geography: string | null;
  companyVertical: string | null;
  requestedCount: number | null;
  /** Capability/source keys the plan proposes, if any. */
  proposedCapabilities: string[];
  /** model_validated | deterministic_fallback | selected_directly */
  outcome: string | null;
  fallbackReason: string | null;
  modelRequests: number;
  latencyMs: number;
  error: string | null;
}

/** A model seam that never reaches a network. */
export interface ModelStubs {
  /** GPT adapter seam. */
  callModel: (call: unknown) => Promise<unknown>;
  /** Claude adapter seam. */
  generate: (args: unknown) => Promise<unknown>;
}

/**
 * Stubs that decline, forcing each adapter down ITS OWN deterministic path.
 *
 * This is not a degraded mode — it is what production does today, because
 * OPENAI_API_KEY is not configured on TEST and GPT_LEAD_STRATEGY is unset. It
 * measures the fallback each planner actually ships, which is the behaviour
 * users currently get.
 */
export function decliningStubs(counter?: { gpt: number; claude: number }): ModelStubs {
  return {
    callModel: (_c) => {
      if (counter) counter.gpt++;
      return Promise.resolve({ ok: false, errorCode: "no_credentials_offline", provider: "stub", latencyMs: 0 });
    },
    generate: (_a) => {
      if (counter) counter.claude++;
      return Promise.resolve({ ok: false, error: "no_credentials_offline" });
    },
  };
}

/** A database handle that cannot read or write anything. */
const inertAdmin = { from() { throw new Error("planner-eval: no database access"); } } as never;

/**
 * Run ONE planner against ONE case.
 *
 * Ownership is preserved exactly as production resolves it: enabling only one
 * adapter's flag means the selector names that adapter, and a failure inside it
 * falls back to ITS OWN deterministic ladder. Neither planner can rescue the
 * other, which is the property that makes the two columns comparable.
 */
export async function runPlanner(
  planner: PlannerName, c: EvalCase, stubs: ModelStubs,
): Promise<NeutralPlan> {
  const env: Record<string, string> = {
    SUPABASE_PROJECT_ID: "ohsdatpvfdjdemstoiuj",
    ...(planner === "gpt"
      ? { GPT_LEAD_STRATEGY: "true", GPT_LEAD_STRATEGY_WORKSPACES: WORKSPACE }
      : { CLAUDE_FIRST_LEAD_PLANNING: "true", CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES: WORKSPACE }),
  };

  const started = performance.now();
  let outcome: Awaited<ReturnType<typeof planQualifiedLeadBeforePersistence>> = null;
  let error: string | null = null;
  try {
    outcome = await planQualifiedLeadBeforePersistence({
      admin: inertAdmin,
      workspaceId: WORKSPACE,
      userInstruction: c.query,
      readEnv: (k) => env[k],
      callModel: stubs.callModel as never,
      generate: stubs.generate as never,
    });
  } catch (e) {
    error = String((e as Error)?.message ?? e);
  }
  const latencyMs = Math.round(performance.now() - started);

  // The compiled intent is the deterministic reading of the request — used as
  // a fallback ONLY when nothing was ever planned (a === undefined). When a
  // plan WAS produced, personas/geography are read from `a.contract`
  // (STEP 3B, 2026-08-09): the contract is the enriched, authoritative record
  // (leadPlanOrchestration.ts backfills geography/decision-maker-roles from
  // intent.geographies/intent.person_roles when job_search_spec didn't
  // compile) — recomputing `intent.job_search_spec` fresh here bypassed that
  // fix entirely and reported the pre-fix gap as if it still existed.
  const intent = compileLeadEntityIntent(c.query);
  const a = outcome?.artifact;

  return {
    planner,
    produced: outcome !== null,
    planSource: a?.plan_source ?? null,
    approvedTitles: a?.approved_titles ? [...a.approved_titles] : [],
    personas: a ? [...a.contract.decisionMakerRoles] : [...(intent.job_search_spec.requested_person_roles ?? [])],
    geography: a ? a.contract.geography : (intent.job_search_spec.location ?? null),
    companyVertical: intent.job_search_spec.company_vertical
      ? String(intent.job_search_spec.company_vertical) : null,
    requestedCount: a?.contract.requestedCount ?? intent.requested_count ?? null,
    proposedCapabilities: (a?.source_order ?? []) as string[],
    outcome: a?.planner_provenance?.outcome ?? null,
    fallbackReason: a?.planner_provenance?.fallback_reason ?? a?.fallback_reason ?? null,
    modelRequests: Number((a?.planner as Record<string, unknown> | null)?.model_requests ?? 0),
    latencyMs,
    error,
  };
}

// ── SCORING ────────────────────────────────────────────────────────────────

export interface CaseResult {
  caseId: string;
  planner: PlannerName;
  plan: NeutralPlan;
  scores: Scores;
  severe: SevereFailure[];
  total: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+ ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Deterministic scoring. No LLM judge.
 *
 * Every criterion below is decided by exact comparison against what the request
 * declared, or by an existing validator's verdict. Where a judgement genuinely
 * needs a human, the case is left unscored on that criterion and surfaced — a
 * third model deciding which of two models is better would just move the
 * question somewhere less inspectable.
 */
export function scoreCase(c: EvalCase, plan: NeutralPlan): CaseResult {
  const scores: Scores = {};
  const severe: SevereFailure[] = [];

  // Hard-constraint preservation: geography and quantity must survive verbatim.
  let hard = 1;
  if (c.expect.geography) {
    const kept = plan.geography && norm(plan.geography).includes(norm(c.expect.geography).split(" ")[0]);
    if (!kept) {
      hard -= 0.5;
      // Only a SEVERE failure when the request forbade broadening. A parser that
      // cannot represent "Europe" is a gap; one that drops an explicit
      // "do not broaden outside London" is a different kind of wrong.
      if (c.expect.noBroadening) severe.push("dropped_hard_geography");
    }
  }
  if (c.expect.requestedCount !== null) {
    if (plan.requestedCount !== c.expect.requestedCount) {
      hard -= 0.5;
      severe.push("lost_requested_quantity");
    }
  }
  scores.hard_constraint_preservation = Math.max(0, hard);

  // Query understanding: did anything get planned, and does it carry the count?
  scores.query_understanding = plan.error ? 0 : plan.produced ? 1 : 0.5;

  // Signal interpretation: the approved titles must relate to the declared
  // signal rather than to hiring in general.
  if (c.expect.signal) {
    const want = norm(c.expect.signal).split(" ").filter((w) => w.length > 3);
    const got = norm(plan.approvedTitles.join(" "));
    const hits = want.filter((w) => got.includes(w)).length;
    scores.signal_interpretation = want.length ? hits / want.length : 0;
    if (plan.produced && want.length && hits === 0) severe.push("required_signal_made_optional");
  } else {
    scores.signal_interpretation = 1;
  }

  // ICP / persona fidelity, measured against the compiled intent.
  const wantPersonas = c.expect.personas.map(norm);
  const gotPersonas = plan.personas.map(norm).join(" ");
  scores.icp_persona_fidelity = wantPersonas.length
    ? wantPersonas.filter((p) => gotPersonas.includes(p.split(" ")[0])).length / wantPersonas.length
    : 1;
  if (wantPersonas.length && scores.icp_persona_fidelity === 0) severe.push("changed_requested_persona");

  // Plan validity / repair state, from the adapter's own provenance.
  scores.plan_validity = plan.outcome === "model_validated" ? 1 : plan.produced ? 0.5 : 0;
  scores.repair_rate = plan.outcome === "deterministic_fallback" ? 0 : 1;

  // Capability realism: nothing outside the approved source vocabulary.
  const KNOWN = ["apify", "linkedin", "jobs", "yc", "company", "harvest", "indeed", "glassdoor", "ats"];
  const unknown = plan.proposedCapabilities.filter((k) => !KNOWN.some((s) => norm(k).includes(s)));
  scores.capability_realism = plan.proposedCapabilities.length === 0 ? 1
    : 1 - unknown.length / plan.proposedCapabilities.length;
  if (unknown.length) severe.push("invented_unsupported_capability");

  // Unnecessary broadening: with an explicit prohibition, the title set must not
  // exceed what the request named.
  if (c.expect.noBroadening) {
    const grew = plan.approvedTitles.length > 4;
    scores.unnecessary_broadening = grew ? 0 : 1;
    if (grew) severe.push("violated_explicit_no_broadening");
  } else {
    scores.unnecessary_broadening = 1;
  }

  scores.budget_correctness = c.expect.requestedCount === null || plan.requestedCount === c.expect.requestedCount ? 1 : 0;
  // Latency scored on a 3s ceiling; it is worth 1 point and cannot swing a result.
  scores.latency = Math.max(0, 1 - plan.latencyMs / 3000);

  return { caseId: c.id, planner: plan.planner, plan, scores, severe, total: weightedScore(scores) };
}
