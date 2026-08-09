// THE VISIBLE PLAN FOR A QUALIFIED-LEAD MISSION.
//
// Until now the user saw "Scout will source signals via apify, Aria will rank
// signals" — orchestrate's generic sourcing template — persisted BEFORE Claude
// ever ran. Claude was called later, inside run-agent, and could only rewrite the
// internal keyword list. Whatever it decided, the plan on screen was the same
// generic two-step template, and the run's REAL contract (five CONTACT-ready
// founders, hiring evidence, employer verification, stop-at-five) was invisible.
//
// This module turns an ALREADY-VALIDATED outcome into the plan the user sees. It
// is deliberately not a planner:
//
//   * it never calls a model — `planInitialLeadSourcing` owns that
//   * it never validates — `validateStrategy` / `reviewStrategyTitles` own that
//   * it never routes — `routeQualifiedLead` owns that
//
// It receives what those authorities already decided and renders it. That is why
// adding it introduces no second planner and no second router.
//
// PURE. No network, model, database or environment access.

import { canonicalJson, sha256Hex } from "../../planHash.ts";
import type { LeadInitialStrategy } from "./leadStrategy.ts";

export const QUALIFIED_LEAD_PLAN_VERSION = "qualified-lead-visible-plan-1.0.0";

/** Where the plan on screen actually came from. Shown, never inferred. */
/**
 * Which adapter produced the authoritative plan.
 *
 * `gpt_validated` joined this union when initial planning consolidated onto ONE
 * call site. Before that, the GPT adapter was invoked inside run-agent and its
 * output never became a plan artifact at all — so a GPT-planned task persisted a
 * plan row that said `deterministic_registry` while the run executed GPT's
 * titles. The artifact is now the only record of what was planned, so it has to
 * be able to say GPT.
 */
export type AuthoritativePlanSource =
  | "claude_validated"
  | "gpt_validated"
  | "deterministic_registry";

/** The bounded facts the summary is allowed to state. All from the contract. */
export interface QualifiedLeadPlanContract {
  requestedCount: number;
  decisionMakerRoles: string[];
  hiringRoles: string[];
  companyVertical: string | null;
  companyStage: string | null;
  geography: string | null;
  currentEmployerRequired: boolean;
}

/**
 * What orchestrate persists so run-agent need not plan again.
 *
 * Carried inside `steps[0].metadata` — `task_plans` has no metadata column and
 * this PR adds no migration, while per-step metadata is already an opaque bag
 * every existing consumer ignores.
 */
export interface QualifiedLeadPlanArtifact {
  version: typeof QUALIFIED_LEAD_PLAN_VERSION;
  plan_source: AuthoritativePlanSource;
  /** Present only for `claude_validated`. */
  strategy: LeadInitialStrategy | null;
  strategy_hash: string | null;
  /** The titles that will actually be searched. */
  approved_titles: string[];
  contract: QualifiedLeadPlanContract;
  /** Why the deterministic plan is authoritative, when it is. */
  fallback_reason: string | null;
  /** Safe planner provenance. No prompts, no reasoning, no credentials. */
  planner: Record<string, unknown> | null;

  // ── GPT ADAPTER OUTPUT ───────────────────────────────────────────────────
  //
  // Present only for `gpt_validated`. These three carried run-agent's routing
  // decisions when the GPT adapter was invoked there; consolidating planning
  // onto one call site means they must travel ON the artifact instead, or a
  // GPT-planned task would silently lose its source order and route on the way
  // to the executor. Optional so every existing persisted artifact still parses.
  /** The validated GPT plan. Consumed by `gptAdaptiveStrategyBinding`. */
  strategy_plan?: unknown;
  /** Ordered capability keys the strategist chose. */
  source_order?: string[];
  /** The hiring route the strategist chose, validated downstream as before. */
  route?: string | null;

  // ── OWNERSHIP, RECORDED ON THE PLAN ──────────────────────────────────────
  //
  // The one field that makes "which planner planned this task?" answerable from
  // the plan row alone, including on a resume that carries no request body.
  planning_owner?: string;
  planned_at?: string;
}

/** Stable identity for a persisted plan artifact. */
export async function planArtifactHash(a: Omit<QualifiedLeadPlanArtifact, "planner">): Promise<string> {
  return await sha256Hex(canonicalJson({
    v: a.version, source: a.plan_source, strategy: a.strategy_hash,
    titles: [...a.approved_titles].sort(), contract: a.contract,
  }));
}

// ------------------------------------------------------------- the summary ---

function list(items: string[], max = 3): string {
  const kept = items.filter(Boolean).slice(0, max);
  if (kept.length === 0) return "";
  if (kept.length === 1) return kept[0];
  return `${kept.slice(0, -1).join(", ")} or ${kept[kept.length - 1]}`;
}

/**
 * The one-line summary shown beside the plan.
 *
 * Built from the CONTRACT, so it states what the run will actually deliver — the
 * count, who is returned, which companies qualify, and what evidence is required.
 * The generic "Source → rank" wording cannot describe any of that, which is why
 * it must not be used for these missions.
 */
export function buildQualifiedLeadPlanSummary(
  contract: QualifiedLeadPlanContract,
  source: AuthoritativePlanSource,
): string {
  const who = list(contract.decisionMakerRoles) || "decision-makers";
  const company = [contract.companyStage, contract.companyVertical].filter(Boolean).join(" ") || "target";
  const where = contract.geography ? ` in ${contract.geography}` : "";
  const hiring = list(contract.hiringRoles);
  const evidence = hiring ? ` hiring ${hiring}` : "";
  // NAME THE ADAPTER THAT ACTUALLY PLANNED. A two-way test would have labelled a
  // GPT-validated plan "Deterministic plan", which is the plan summary telling
  // the user something untrue about how their plan was made.
  const prefix = source === "claude_validated"
    ? "Claude-planned"
    : source === "gpt_validated"
    ? "GPT-planned"
    : "Deterministic plan";
  return `${prefix}: ${contract.requestedCount} CONTACT-ready ${who} at ${company} companies${where}${evidence}.`;
}

// --------------------------------------------------------------- the steps ---

export interface QualifiedLeadPlanStep {
  step_index: number;
  agent_slug: string;
  description: string;
  instruction: string;
  expected_output: string;
  success_criteria: string;
  requires_approval: boolean;
  tool_needed?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The steps a qualified-Lead mission actually performs.
 *
 * Four stages, because that is what the runtime does: find the hiring evidence,
 * qualify the company against the Brain, find and verify the decision-maker, then
 * stop at the quota or report an honest partial. The old two-step template
 * ("source signals", "rank signals") described neither the company gate nor the
 * employer verification nor the stopping rule.
 *
 * Everything the model contributed is SEMANTIC. No Actor id, no provider name and
 * no provider JSON appears here, because Agentory maps capabilities to Actors and
 * this only renders what was approved.
 */
export function buildQualifiedLeadPlanSteps(args: {
  contract: QualifiedLeadPlanContract;
  artifact: QualifiedLeadPlanArtifact;
  originalInstruction: string;
  /** Threaded onto step 0 exactly as the generic planner does. */
  toolInput?: Record<string, unknown> | null;
}): QualifiedLeadPlanStep[] {
  const { contract, artifact } = args;
  const who = list(contract.decisionMakerRoles) || "decision-makers";
  const hiring = list(contract.hiringRoles) || "the requested roles";
  const capabilities = artifact.strategy
    ? [...new Set(artifact.strategy.searches.map((s) => s.capability_key))]
    : [];
  const sourceNote = artifact.plan_source === "claude_validated"
    ? `Claude-approved source strategy: ${capabilities.join(", ") || "approved hiring sources"}.`
    : artifact.plan_source === "gpt_validated"
    // The GPT adapter states its choice as an ordered capability list rather than
    // a `strategy.searches` block, so its note is built from `source_order`.
    ? `GPT-approved source strategy: ${(artifact.source_order ?? []).join(", ") || "approved hiring sources"}.`
    : `Deterministic approved sources (${artifact.fallback_reason ?? "no model plan was used"}).`;

  return [
    {
      step_index: 0,
      agent_slug: "scout",
      description: `Find companies hiring ${hiring}`,
      instruction: `${args.originalInstruction}\n\n${sourceNote}`,
      expected_output: "Companies with current, source-backed hiring evidence.",
      success_criteria: "Every company carries a dated hiring signal from an approved source.",
      requires_approval: false,
      tool_needed: "source_with_apify",
      metadata: {
        ...(args.toolInput ? { tool_input: args.toolInput } : {}),
        // THE PERSISTED AUTHORITY. run-agent reads this and does not re-plan.
        qualified_lead_plan: artifact,
      },
    },
    {
      step_index: 1,
      agent_slug: "scout",
      description: "Qualify each company against the Company Brain",
      instruction: "Apply the workspace ICP: size, stage, industry and business model. A strong hiring signal never buys past the gate.",
      expected_output: "Only companies that clear every hard constraint.",
      success_criteria: "Rejected companies are recorded with a reason and never reach people search.",
      requires_approval: false,
    },
    {
      step_index: 2,
      agent_slug: "scout",
      description: `Find and verify ${who}`,
      instruction: contract.currentEmployerRequired
        ? `Find ${who} inside each qualified company and verify they currently work there.`
        : `Find ${who} inside each qualified company.`,
      expected_output: "Decision-makers bound to a verified company with a contact method.",
      success_criteria: "Only current employees with a reachable contact method count.",
      requires_approval: false,
    },
    {
      step_index: 3,
      agent_slug: "aria",
      description: `Deliver ${contract.requestedCount} CONTACT-ready leads or an honest partial`,
      instruction: `Stop at ${contract.requestedCount} CONTACT-ready people. Jobs, signals and companies never count toward the quota.`,
      expected_output: `Up to ${contract.requestedCount} CONTACT-ready leads, or fewer with the reason stated.`,
      success_criteria: "The reported count is CONTACT-ready people only.",
      requires_approval: false,
    },
  ];
}

// ------------------------------------------- the plan orchestrate RETURNS ---

/**
 * A step in the shape orchestrate's HTTP response uses.
 *
 * pilot-chat announces the plan from `task_title`. The qualified-Lead steps above
 * do not carry one — they name the stage in `description` — so the mapping happens
 * here. Doing it here rather than in pilot-chat keeps that renderer generic and
 * leaves every other workflow's announcement untouched.
 */
export interface ResponsePlanStep {
  agent_slug: string;
  task_title: string;
  [key: string]: unknown;
}

export interface OrchestrateResponsePlan {
  plan_summary: string;
  steps: ResponsePlanStep[];
}

/**
 * The plan orchestrate RETURNS, as distinct from the one it persists.
 *
 * PR #116 made the validated qualified-Lead plan authoritative for `task_plans`
 * and for the run-agent kickoff, but orchestrate kept RETURNING the generic
 * template it had built beforehand. pilot-chat announces from the response, so the
 * user was told "Scout will source signals via apify, Aria will rank signals"
 * while a different — correct — four-step plan sat in the database. Production run
 * `4ec43c1d-f2fc-4131-9b01-a60b608abca9` is exactly that split.
 *
 * The authoritative plan wins whenever there is one, INCLUDING when it is the
 * labelled deterministic fallback: a plan Claude was not allowed to author is
 * still the plan that will execute, and saying so is the honest thing to show.
 *
 * With no qualified-Lead plan — every non-Lead workflow, and every workspace not
 * opted in — the caller's own plan is returned BY REFERENCE, so legacy behaviour
 * is literally unchanged rather than merely equivalent.
 *
 * PURE. No network, model, database or environment access.
 */
export function buildOrchestrateResponsePlan(
  qlPlan: { summary: string; steps: QualifiedLeadPlanStep[] } | null | undefined,
  parsed: OrchestrateResponsePlan,
): OrchestrateResponsePlan {
  if (!qlPlan) return parsed;
  return {
    plan_summary: qlPlan.summary,
    steps: qlPlan.steps.map((step) => ({ ...step, task_title: step.description })),
  };
}

/** Read the persisted artifact back off a plan's steps. Null when absent. */
/** Where an authoritative plan artifact was found. */
export type LeadPlanArtifactSource = "request_body" | "persisted_plan_row" | "absent";

export interface LoadedLeadPlan {
  artifact: QualifiedLeadPlanArtifact | null;
  source: LeadPlanArtifactSource;
  /** Why nothing was found. Null on success. */
  missing_reason: string | null;
}

/**
 * Find the plan this task must execute — body first, then the persisted row.
 *
 * ── THE RESUME WINDOW THIS CLOSES ────────────────────────────────────────────
 *
 * run-agent used to read the artifact from `body.qualified_lead_plan` and
 * nowhere else. On the first invocation orchestrate threads it, so the artifact
 * was present and the runtime reused it. On a CONTINUATION the body is
 * reconstructed from a continuation token and carries no artifact — so the
 * lookup returned null, the planner selector saw `hasPersistedPlan: false`, and
 * the task planned AGAIN, with a different adapter than the one that produced
 * the plan the user approved.
 *
 * That was silent. Nothing compared the two plans, and the second one won.
 *
 * The artifact is already persisted on `task_plans.steps[].metadata`, which is
 * where `readPlanArtifact` reads it from — the durable copy existed all along
 * and simply was not consulted. Reading it here makes a plan IMMUTABLE for the
 * life of a run: once a task has a planner owner and an accepted plan, every
 * later invocation loads that same plan. Re-planning is not merely discouraged,
 * it has nowhere to happen.
 *
 * `readPlanSteps` is injected so this is testable with no database.
 */
export async function loadAuthoritativeLeadPlan(args: {
  /** `body.qualified_lead_plan` — present on the first invocation. */
  bodyArtifact: unknown;
  /** The plan row to fall back to. Null when the task has no plan. */
  planId: string | null;
  /** Returns the persisted `steps` array for a plan id, or null. */
  readPlanSteps: (planId: string) => Promise<unknown>;
}): Promise<LoadedLeadPlan> {
  const fromBody = readPlanArtifact([{ metadata: { qualified_lead_plan: args.bodyArtifact } }]);
  if (fromBody) return { artifact: fromBody, source: "request_body", missing_reason: null };

  if (!args.planId) {
    return { artifact: null, source: "absent", missing_reason: "no_plan_id_on_request" };
  }

  let steps: unknown = null;
  try {
    steps = await args.readPlanSteps(args.planId);
  } catch (e) {
    // A read failure must not silently look like "this task was never planned",
    // because that is the state that used to trigger re-planning.
    return {
      artifact: null, source: "absent",
      missing_reason: `plan_row_read_failed:${String((e as Error)?.message ?? e).slice(0, 80)}`,
    };
  }

  const fromRow = readPlanArtifact(steps);
  if (fromRow) return { artifact: fromRow, source: "persisted_plan_row", missing_reason: null };

  // A genuinely unplanned task. This is the ordinary case for every workspace
  // with no planner adapter enabled, and it is NOT an error: the deterministic
  // ladder owns those runs and always has.
  return { artifact: null, source: "absent", missing_reason: "no_artifact_on_plan_row" };
}

export function readPlanArtifact(steps: unknown): QualifiedLeadPlanArtifact | null {
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    const a = (step as { metadata?: { qualified_lead_plan?: unknown } })?.metadata?.qualified_lead_plan;
    if (a && typeof a === "object" && (a as { version?: string }).version === QUALIFIED_LEAD_PLAN_VERSION) {
      return a as QualifiedLeadPlanArtifact;
    }
  }
  return null;
}
