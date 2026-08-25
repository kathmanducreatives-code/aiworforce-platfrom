// THE PAID-EXECUTION PREFLIGHT — prove the plan before spending on it.
//
// WHY THIS EXISTS.
//
// TEST task e8abeb8f-9503-4dfe-84cc-cfcbc6a416d4 spent credits on five
// harvestapi people searches for companies found on a LinkedIn JOB board, on a
// mission whose approved discovery source was memo23. Every guard built to stop
// exactly that was deployed and running. None of them fired.
//
// The reason is that all of them were conditioned on a mission being present:
//
//   persistedMission === null  ->  missionPlan === null
//                              ->  guardedInvoker(null, …) returns the RAW invoker
//                              ->  legacyLoopReachable(null, null) === reachable
//                              ->  the capability engine never runs
//
// The plan step carried an 18-field `tool_input` and no `lead_mission`, because
// the lead-intake path never attached one. So containment was OPT-IN, and the
// field that opts in was the field that went missing. An absent mission was
// read as "old task, be permissive" when it actually meant "we do not know what
// we are about to buy".
//
// THIS MODULE INVERTS THAT DEFAULT. Paid execution must be justified before the
// first call, not explained after it. No mission, no spend.
//
// It is also the source of the dry-run the UI shows before Start Workflow: the
// SAME record that authorises spending is the one the user sees, so the preview
// cannot describe a plan the backend will not execute.
//
// PURE. No network, provider, model or database access.

import type { LeadMissionV1 } from "./leadMission.ts";
import type { PlaybookAuthorization } from "./leadPlaybookExecution.ts";
import type { LeadIntelligenceCapabilities } from "./leadIntelligencePolicy.ts";
import type { ContractCompatibility } from "./leadRuntimeIdentity.ts";
import {
  CAPABILITY_REGISTRY, type CapabilityId, type CapabilityPlan,
} from "./leadCapabilityGraph.ts";
import { assessRequestFeasibility, type FeasibilityReport } from "./requestFeasibility.ts";

export const PREFLIGHT_VERSION = "paid-execution-preflight-v1" as const;

/** Providers that reach real people. Gated behind the whole company chain. */
export const PEOPLE_PROVIDERS: readonly string[] = [
  "apify_linkedin_company_employees",
  "apify_people_search",
];

/**
 * The company work that must be FINISHED before any person is bought.
 *
 * On the failed task, people search ran off raw job-board rows: no YC discovery,
 * no enrichment, no Brain verdict. Five companies were paid for on the strength
 * of a job posting alone, and two of them (Unity South APAC, SemiAnalysis) are
 * not the ICP at all.
 */
export const PEOPLE_PREREQUISITES: readonly CapabilityId[] = [
  "company_identity_resolution",
  "company_enrichment",
  "hiring_verification",
  "company_brain_qualification",
];

export type PreflightBlockCode =
  | "missing_mission"
  | "wrong_mission_authority"
  | "empty_capability_plan"
  | "entry_capability_mismatch"
  | "provider_not_in_capability"
  | "provider_not_capability_primary"
  | "provider_not_in_plan"
  | "input_validation_failed"
  | "provider_not_permitted_for_capability"
  | "people_provider_before_qualification"
  | "mission_lacks_qualification_contract"
  | "inconsistent_intelligence_configuration"
  | "mission_compilation_failed"
  | "incompatible_planner_contract"
  | "mission_not_model_compiled"
  /**
   * The scheduled plan does not execute the research playbook that was
   * selected from the Mission. See `authorizePlaybookExecution`.
   */
  | "playbook_not_authorized"
  /**
   * The final graph cannot establish a material requirement, or cannot produce
   * the output the mission promises. See `requestFeasibility`.
   */
  | "request_not_feasible";

export class PaidExecutionBlockedError extends Error {
  readonly code: PreflightBlockCode;
  readonly detail: Record<string, unknown>;
  constructor(code: PreflightBlockCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "PaidExecutionBlockedError";
    this.code = code;
    this.detail = detail;
  }
}

/** The record persisted BEFORE the first paid call, and shown as the dry run. */
export interface PaidExecutionPreflight {
  version: typeof PREFLIGHT_VERSION;
  mission_authority: "lead_mission_v1" | "legacy_carrier_union" | "none";
  original_user_query: string | null;
  entry_capability: CapabilityId | null;
  ordered_capabilities: CapabilityId[];
  first_capability: CapabilityId | null;
  first_provider: string | null;
  /** The exact compiled input the first provider would receive. */
  first_provider_input: unknown;
  first_provider_input_valid: boolean;
  input_errors: string[];
  estimated_cost_units: number;
  /** Populated only when the preflight FAILED. Empty means paid work may start. */
  blocked: Array<{ code: PreflightBlockCode; message: string }>;
  /**
   * Whether the graph can prove what the request promises.
   *
   * Carried on the record — not just folded into `blocked` — because the
   * workflow preview shows the SATISFIED list too: "verified by
   * hiring_verification" is what makes the card's promise checkable by the
   * person reading it.
   */
  feasibility: FeasibilityReport;
  ok: boolean;
}

export interface BuildPreflightInput {
  mission: LeadMissionV1 | null;
  plan: CapabilityPlan | null;
  /** Compiled first call, if the caller has already compiled one. */
  firstProvider?: string | null;
  firstProviderInput?: unknown;
  /** Compile result for the first call: `ok:false` means the input is invalid. */
  firstProviderCompileOk?: boolean;
  firstProviderErrors?: string[];
  /**
   * The workspace's resolved intelligence capabilities.
   *
   * Optional so every existing caller and test keeps working unchanged; absent
   * means the two architecture checks simply do not apply.
   */
  intelligence?: LeadIntelligenceCapabilities | null;
  /**
   * Result of checking the planner's contract version against this executor's.
   *
   * Optional so existing callers and tests are unaffected; absent means the
   * compatibility check simply does not apply.
   */
  contract?: ContractCompatibility | null;
  /**
   * The playbook boundary's verdict on this plan.
   *
   * Optional so every existing caller and test keeps working unchanged; absent
   * means the boundary was not consulted and this check does not apply. When
   * present and `applies: false` — every non-hiring mission in this phase — it
   * is inert by construction.
   */
  playbook?: PlaybookAuthorization | null;
}

function isStartupMission(m: LeadMissionV1): boolean {
  return m.company_profile.stages.some((s) => /startup|seed|series a|early/i.test(s));
}

/** Missions whose whole purpose is to decide that somebody QUALIFIES. */
function isQualifyingMission(m: LeadMissionV1): boolean {
  return m.mission_type === "qualified_lead_sourcing" ||
    m.requested_output === "contact_ready_leads" ||
    m.requested_output === "qualified_companies";
}

export interface QualificationContract {
  ok: boolean;
  /** The discriminators the mission actually supplies. Empty ⇒ none. */
  sources: string[];
  detail: string;
}

/**
 * DOES THIS MISSION SAY HOW ANYTHING QUALIFIES?
 *
 * Task 44b82535 spent 9 cost units and returned nothing because the answer was
 * no and nobody asked. Its mission was STRUCTURALLY perfect — mission present,
 * plan non-empty, entry capability matched, first input valid — so this
 * preflight returned `ok: true` and authorised the spend. It was also
 * semantically empty: `required_signals: []`, `required_capabilities: []`,
 * `directives: null`, and a company profile consisting of the single vertical
 * "b2b saas".
 *
 * That mission cannot fail. Every B2B SaaS company on earth satisfies it
 * equally, so no evidence could ever separate a good answer from a bad one and
 * the money was spent finding companies that could never be qualified.
 *
 * THE QUESTION THIS ASKS is deliberately not "did GPT run" or "is there a
 * hiring signal". Either would be wrong: a deterministic mission naming
 * explicit companies is perfectly answerable, and forcing a hiring requirement
 * onto every lead query would make hiring Actors run for missions that never
 * wanted them. The question is narrower — is there ANY discriminator that
 * evidence could be gathered against?
 *
 * A bare vertical plus a job title is NOT one. It describes a category, not a
 * reason to contact a particular company today.
 */
export function missionQualificationContract(m: LeadMissionV1): QualificationContract {
  const sources: string[] = [];

  // A commercial/timing signal — hiring, funding, expansion, anything.
  if (m.required_signals.length > 0) {
    sources.push(`required_signals:${m.required_signals.map((s) => s.type).join("|")}`);
  }
  // The compiler's explicit evidence contract.
  const evidence = m.directives?.required_evidence ?? [];
  if (evidence.length > 0) sources.push(`required_evidence:${evidence.length}`);

  // The user named the companies. "Is it one of these?" is a complete
  // qualification contract on its own, and needs no signal at all.
  if ((m.company_profile.known_companies?.length ?? 0) > 0) {
    sources.push("known_companies");
  }
  // An explicitly required evidence-producing capability.
  const evidenceCaps = m.required_capabilities.filter((c) => {
    const spec = CAPABILITY_REGISTRY[c];
    return !!spec && (spec.produces?.length ?? 0) > 0;
  });
  if (evidenceCaps.length > 0) sources.push(`required_capabilities:${evidenceCaps.join("|")}`);

  if (sources.length > 0) {
    return { ok: true, sources, detail: "the mission defines what evidence qualifies" };
  }
  return {
    ok: false,
    sources: [],
    detail:
      "the mission names no signal, no required evidence, no known companies and " +
      "no evidence capability — nothing collected could decide that a company qualifies",
  };
}

/**
 * Build the preflight record.
 *
 * Always returns a record — a BLOCKED preflight is still evidence, and the
 * failed task is the argument for persisting it: that run produced no route
 * telemetry at all, so the only way to learn what it intended was to read five
 * Actor payloads after the money was gone.
 */
export function buildPaidExecutionPreflight(i: BuildPreflightInput): PaidExecutionPreflight {
  const blocked: PaidExecutionPreflight["blocked"] = [];
  const block = (code: PreflightBlockCode, message: string) => blocked.push({ code, message });

  const mission = i.mission;
  const plan = i.plan;

  if (!mission) {
    block("missing_mission",
      "no LeadMissionV1 on this task; paid execution is refused because nothing states what is being bought");
  }
  const ordered = plan?.steps.map((s) => s.capability) ?? [];
  if (plan && ordered.length === 0) {
    block("empty_capability_plan", "the capability plan has no steps");
  }
  if (mission && !plan) {
    block("empty_capability_plan", "a mission was supplied without a capability plan");
  }

  const firstCapability = plan?.steps[0]?.capability ?? null;
  if (plan && firstCapability && plan.entry_capability !== firstCapability) {
    block("entry_capability_mismatch",
      `entry_capability "${plan.entry_capability}" is not the first step "${firstCapability}"`);
  }

  const provider = i.firstProvider ?? null;
  if (provider && firstCapability) {
    const approved = CAPABILITY_REGISTRY[firstCapability].providers;
    if (!approved.includes(provider)) {
      block("provider_not_in_capability",
        `provider "${provider}" is not approved for capability "${firstCapability}" (approved: ${approved.join(", ") || "none"})`);
    } else // ── REMOVED: "THE FIRST CALL MUST BE THE REGISTRY'S PRIMARY" ──────────
      //
      // The second copy of actor selection living in the validator. Its concern
      // was real — a breadth source should not OPEN a run, it earns its call
      // from what the primary returned — but that ordering is now decided by
      // the strategy's own `role` and enforced when `validateDiscoveryStrategy`
      // sorts primary → breadth → fallback. Pinning the REGISTRY's primary here
      // overrode GPT's choice of opener.
      //
      // It refused the first live 2-lead run: GPT named
      // `apify_linkedin_company_search` as primary, which is registered for
      // this capability and is the better opener when the request says "AI" —
      // memo23's `industries` enum has no such value. The related worry, a
      // company search opening with no query to search for, has its own guard
      // ("a company search named without a query is skipped, not called").
          if (plan && !plan.allowed_providers.includes(provider)) {
      block("provider_not_in_plan",
        `provider "${provider}" is not in this mission's allowed providers`);
    }
  }

  // ── PLANNER AND EXECUTOR MUST SPEAK THE SAME CONTRACT ──────────────────
  //
  // They are different Edge Functions with independently bundled `_shared`, so
  // they can legitimately be different BUILDS — that is allowed and normal.
  // What is not allowed is different CONTRACT GENERATIONS: a mission whose
  // shape this executor does not understand must not be spent against, and a
  // mission carrying no contract version at all came from a bundle predating
  // this guard and cannot be assumed compatible.
  if (i.contract && !i.contract.ok) {
    block("incompatible_planner_contract", i.contract.detail);
  }

  // ── THE ARCHITECTURE MUST BE WHOLE ─────────────────────────────────────
  //
  // A workspace half-way into the new architecture is not a rollout state, it
  // is a broken one. My Company ran with semantic classification ON and the
  // compiler, grounded Brain, pool evaluation and rounds all OFF — and spent
  // real money in that configuration. Failing closed here costs a refused run;
  // proceeding cost task 44b82535.
  if (i.intelligence && i.intelligence.mode === "inconsistent") {
    block("inconsistent_intelligence_configuration", i.intelligence.reason);
  }

  // ── COMPILATION FAILED, SO THE MISSION IS NOT THE ONE WE PLANNED FOR ────
  //
  // The distinction that matters, and the reason this is not the blunt rule
  // "no GPT mission, no spend": a workspace whose compiler is OFF is MEANT to
  // run a deterministic mission, and blocking it would break every legitimate
  // deterministic workflow. A workspace whose compiler is ON and which still
  // holds no directives had its compilation FAIL — and silently continuing is
  // exactly the downgrade into paid generic sourcing this exists to stop.
  //
  // `directives` is the provenance marker: only the model-compiled path sets it.
  // ── DIRECTIVES ARE NOT PROOF THE MODEL RAN ──────────────────────────────
  //
  // `compileLeadMission` emits a directives object on the deterministic path
  // too, so the check below (`!mission.directives`) can pass on a mission the
  // model never touched. Live task dc87ffa1 was exactly that: directives
  // present, hiring signal present, confidence 0.6, `parser_source`
  // deterministic_fallback.
  //
  // Under `new_architecture` the model is the point. A mission it did not
  // contribute to is a degraded plan, and spending on one while calling it
  // GPT-compiled is the confusion this whole investigation kept running into.
  if (mission && i.intelligence?.expects_compiled_mission &&
    mission.mission_parser_source !== undefined &&
    mission.mission_parser_source === "deterministic_fallback") {
    block("mission_not_model_compiled",
      "this workspace runs the model-compiled architecture, but the mission's " +
      "parser_source is 'deterministic_fallback' — the model did not contribute, " +
      "and a deterministic plan must not be spent against as though it had");
  }

  if (mission && i.intelligence?.expects_compiled_mission && !mission.directives) {
    block("mission_compilation_failed",
      "this workspace runs the compiled-mission architecture, but the mission " +
      "carries no compiler directives — compilation failed and the deterministic " +
      "fallback must not be spent against");
  }

  // ── NO QUALIFICATION CONTRACT, NO SPEND ────────────────────────────────
  //
  // Checked BEFORE the route rules below, because a mission that cannot
  // qualify anything is not a routing problem — no route would rescue it. This
  // is the guard task 44b82535 needed and did not have: it passed every
  // structural check here and bought 94 companies it could never assess.
  if (mission && isQualifyingMission(mission)) {
    const contract = missionQualificationContract(mission);
    if (!contract.ok) {
      block("mission_lacks_qualification_contract", contract.detail);
    }
  }

  // ── REMOVED: "A STARTUP MISSION MUST BEGIN AT memo23" ────────────────────
  //
  // This was the last surviving copy of `startup ⇒ YC`. Selection was taken off
  // it in Commit 3, but it lived on here as a VALIDATION rule, so the validator
  // was still choosing the actor — just by refusing every other one.
  //
  // It failed the first live 2-lead run (plan ddfd3af6, 2026-08-17 17:00) with
  // two blocks: entry was `general_company_discovery`, and the first provider
  // was `apify_linkedin_company_search`. Both were GPT's choices, and the second
  // is a GOOD one: memo23's `industries` enum has no "AI" value, so the YC
  // scraper cannot express "AI startups" at all. This rule would have forced the
  // run onto the one actor that cannot ask the question, which is how the
  // 2026-08-17 audit ended at 0 qualified.
  //
  // The validator's job is to reject what is unsafe or unexecutable, never to
  // pick. What replaces it is that narrower check: the first paid provider must
  // be REGISTERED for the capability it is about to serve. An unregistered or
  // mis-purposed actor is still refused; a registered alternative is now
  // allowed, and `discovery_strategy` records which one GPT chose and why.
  // ── THE MISSION AND THE PLAN MUST BE ABOUT THE SAME THING ───────────────
  //
  // Not actor selection — an ENTITY check. A mission asking for companies handed
  // a plan that opens at `job_discovery` is not a routing preference, it is two
  // different requests, and it is what the old memo23 pin was really catching
  // when it fired on a job plan.
  //
  // Deliberately narrow: it names a KIND of capability, never an actor, so any
  // registered company-discovery capability — `startup_company_discovery`,
  // `general_company_discovery` — is equally acceptable and GPT keeps the
  // choice between them.
  if (
    mission && plan?.entry_capability &&
    mission.requested_output !== "job_listings" &&
    /^job_/.test(plan.entry_capability)
  ) {
    block("entry_capability_mismatch",
      `this mission asks for companies but the plan opens at ` +
      `"${plan.entry_capability}"`);
  }

  if (mission && provider && plan?.entry_capability) {
    const permitted = plan.allowed_providers ?? [];
    if (permitted.length > 0 && !permitted.includes(provider)) {
      block("provider_not_permitted_for_capability",
        `"${provider}" is not registered for "${plan.entry_capability}"; ` +
        `permitted: ${permitted.join(", ")}`);
    }
  }

  // ── THE SELECTED PLAYBOOK MUST BE THE ONE ABOUT TO RUN ──────────────────
  //
  // `buildCapabilityGraph` chooses its entry from a mix of mission fields that
  // predates the playbook vocabulary, so the two can disagree — and the shape
  // of that disagreement is a run that reports success having discovered
  // nothing, because the capability it entered at is one the engine skips.
  //
  // Inert unless the boundary GOVERNS the run, which in this phase means a
  // hiring-only selection. Every other mission returns `applies: false` and
  // reaches this line unchanged.
  if (i.playbook?.applies && !i.playbook.authorized) {
    block("playbook_not_authorized", i.playbook.reason);
  }

  // ── CAN THIS GRAPH PROVE WHAT THE REQUEST PROMISES? ────────────────────
  //
  // Last, because it is the only check that reads the FINAL step list — every
  // block above can still change what is scheduled. A requirement with no
  // proof path is not a weak plan, it is a false one: it would spend on
  // discovery, enrichment and qualification and then report success for a fact
  // nothing investigated.
  const feasibility = assessRequestFeasibility(mission, plan);
  for (const r of feasibility.refusals) {
    block("request_not_feasible", `${r.requirement} — ${r.message}`);
  }

  const inputValid = i.firstProviderCompileOk !== false;
  if (!inputValid) {
    block("input_validation_failed",
      `the first provider input failed validation: ${(i.firstProviderErrors ?? []).join("; ") || "unspecified"}`);
  }

  return {
    version: PREFLIGHT_VERSION,
    mission_authority: mission ? "lead_mission_v1" : "none",
    original_user_query: mission?.original_user_query ?? null,
    entry_capability: plan?.entry_capability ?? null,
    ordered_capabilities: ordered,
    first_capability: firstCapability,
    first_provider: provider,
    first_provider_input: i.firstProviderInput ?? null,
    first_provider_input_valid: inputValid,
    input_errors: i.firstProviderErrors ?? [],
    estimated_cost_units: plan?.estimated_cost_units ?? 0,
    blocked,
    feasibility,
    ok: blocked.length === 0,
  };
}

/**
 * THE GATE. Throws before the first paid call when the preflight did not pass.
 *
 * Throwing rather than returning a flag is the whole point. The previous design
 * logged its objections correctly and spent the money anyway.
 */
export function assertPaidExecutionAllowed(p: PaidExecutionPreflight): void {
  if (p.ok) return;
  const first = p.blocked[0];
  throw new PaidExecutionBlockedError(
    first.code,
    `paid execution refused (${p.blocked.length} block${p.blocked.length === 1 ? "" : "s"}): ` +
      p.blocked.map((b) => `${b.code}: ${b.message}`).join(" | "),
    { preflight: p },
  );
}

export interface PeopleGateState {
  completed_capabilities: readonly CapabilityId[];
  qualified_company_keys: readonly string[];
}

/**
 * May a people/founder provider run yet?
 *
 * Requires the ENTIRE company chain to have completed AND at least one company
 * to carry a Brain PASS. A qualified company is the only thing that makes a
 * person worth buying; the failed task bought five people against zero.
 */
export function peopleProviderBlocked(
  provider: string, state: PeopleGateState,
): { blocked: boolean; reason: string } {
  if (!PEOPLE_PROVIDERS.includes(provider)) return { blocked: false, reason: "not a people provider" };

  const missing = PEOPLE_PREREQUISITES.filter((c) => !state.completed_capabilities.includes(c));
  if (missing.length > 0) {
    return {
      blocked: true,
      reason: `people provider "${provider}" requires completed ${missing.join(", ")}`,
    };
  }
  if (state.qualified_company_keys.length === 0) {
    return {
      blocked: true,
      reason: `people provider "${provider}" requires at least one company with a Company Brain pass; none qualified`,
    };
  }
  return { blocked: false, reason: "company chain complete and at least one company qualified" };
}

export function assertPeopleProviderAllowed(provider: string, state: PeopleGateState): void {
  const r = peopleProviderBlocked(provider, state);
  if (!r.blocked) return;
  throw new PaidExecutionBlockedError(
    "people_provider_before_qualification", r.reason,
    { provider, completed: [...state.completed_capabilities], qualified: state.qualified_company_keys.length },
  );
}

// ------------------------------------------------------------- dry run ------

export interface PreflightDryRun {
  mission_summary: string;
  capability_order: string[];
  first_provider: string | null;
  input_summary: string;
  estimated_cost_units: number;
  ok: boolean;
  blocked_reasons: string[];
  /**
   * ── WHAT THIS RUN WILL AND WILL NOT ESTABLISH ────────────────────────────
   *
   * The capability list alone says what will RUN; it does not say what will be
   * PROVEN, and those came apart badly enough to be worth showing separately.
   * A card listing four steps for "companies hiring sales roles" looked
   * complete while proving no hiring at all.
   *
   * `proves` names the step behind each requirement so the promise is
   * checkable. `will_not_establish` is the honest other half — a requirement
   * this plan cannot serve, disclosed before the user pays rather than
   * discovered in the results.
   */
  proves: Array<{ requirement: string; by_capability: string }>;
  will_not_establish: Array<{ requirement: string; status: string; why: string }>;
  /** Outputs staged behind an explicit user unlock, with what unlocks them. */
  requires_unlock: Array<{ requirement: string; why: string }>;
}

/**
 * The user-facing dry run, projected from the SAME record that gates spending.
 *
 * Deliberately derived rather than composed separately: a preview assembled from
 * its own inputs is how the confirmation card came to show "SaaS startups" while
 * the backend sourced job boards.
 */
export function preflightDryRun(p: PaidExecutionPreflight): PreflightDryRun {
  const inp = p.first_provider_input as Record<string, unknown> | null;
  const summary = inp && typeof inp === "object"
    ? Object.entries(inp)
      .filter(([k]) => !k.startsWith("_"))
      .slice(0, 6)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.slice(0, 3).join(", ")}]` : String(v)}`)
      .join(", ")
    : "(no provider input compiled)";

  return {
    mission_summary: p.original_user_query ?? "(no mission)",
    capability_order: [...p.ordered_capabilities],
    first_provider: p.first_provider,
    input_summary: summary,
    estimated_cost_units: p.estimated_cost_units,
    ok: p.ok,
    blocked_reasons: p.blocked.map((b) => `${b.code}: ${b.message}`),
    proves: [...p.feasibility.requirements, ...p.feasibility.outputs]
      .filter((r) => r.status === "satisfied" && r.by_capability)
      .map((r) => ({ requirement: r.requirement, by_capability: r.by_capability! })),
    will_not_establish: [...p.feasibility.requirements, ...p.feasibility.outputs]
      .filter((r) => r.status === "unsupported" || r.status === "population_mismatch")
      .map((r) => ({ requirement: r.requirement, status: r.status, why: r.message })),
    requires_unlock: [...p.feasibility.requirements, ...p.feasibility.outputs]
      .filter((r) => r.status === "requires_unlock")
      .map((r) => ({ requirement: r.requirement, why: r.message })),
  };
}
