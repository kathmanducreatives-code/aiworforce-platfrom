// LEAD V2 P0 — CAN THE ENGINE ACTUALLY EXECUTE THIS CAPABILITY?
//
// `isCapabilitySupported` answers a narrower question: "has anyone refuted this
// capability's evidence claim?". It returns true for `product_launch_discovery`,
// `expansion_signal_discovery`, `technology_verification` and
// `company_post_verification` — and the engine executes none of them. The graph
// entered those capabilities, the engine finished them as `skipped_no_input` or
// `unhandled capability: …`, the pool came back empty, and feasibility still
// reported the signal `satisfied` (see
// `docs/lead-v2/LEAD_V2_CURRENT_SIGNAL_TARGETING_AUDIT.md`).
//
// This table records, per capability, the execution primitives the final plan
// (`LEAD_V2_SIGNAL_FIRST_FINAL_IMPLEMENTATION_PLAN.md`, anchor enablement
// contract) requires before a capability may be scheduled or claimed:
//
//   provider available · verified contract · engine executor · normalizer ·
//   entity extraction (for discovery)
//
// It is a DECLARATION checked by tests, not inferred at runtime: the engine sets
// (`ENGINE_DRIVEN_DISCOVERY`, `ENGINE_DRIVEN_SIGNAL_VERIFICATION` and the
// explicit `cap === …` branches) and the actor catalog are compared against it in
// `p0ExecutabilityRegistry.test.ts`, so the table cannot drift from the code it
// describes.
//
// ENFORCEMENT IS OPT-IN (`executabilityGateFor`). Only Lead V2 workspaces run
// with the gate enforced. Signals monitoring and V1 keep their existing plans
// byte-for-byte (pinned by `p0LegacyContract.test.ts`).
//
// Pure. No network, no provider, no model call.

import type { CapabilityId } from "./leadCapabilityGraph.ts";
import { resolveLeadExecutionEngine, type EnvReader } from "./leadExecutionEngine.ts";

export const CAPABILITY_EXECUTABILITY_VERSION = "capability-executability-v1" as const;

export type ExecutabilityState =
  /** Every primitive present; the engine runs it end to end. */
  | "executable"
  /** Runs, but only part of what it claims (e.g. verification without discovery). */
  | "partially_supported"
  /** A provider exists but has no verified V2 contract/card, or none exists. */
  | "needs_provider_work"
  /** Provider rows exist but no canonical company can be extracted from them. */
  | "needs_extraction_work"
  /** Provider and contract exist but the engine has no executor. */
  | "needs_engine_work"
  /** Nothing in the system can do it. */
  | "unsupported";

export interface ExecutionPrimitives {
  /** A registered provider exists (true when the capability needs none). */
  provider_available: boolean;
  /** Every provider it runs has a V2 catalog card and verified input contract. */
  verified_contract: boolean;
  /** The engine has a branch that executes it. */
  engine_executor: boolean;
  /** Provider rows are normalised into engine shapes. */
  normalizer: boolean;
  /** Discovery only: rows yield a canonical company. `n/a` otherwise. */
  entity_extraction: boolean | "partial" | "n/a";
}

export interface CapabilityExecutability {
  capability: CapabilityId;
  state: ExecutabilityState;
  primitives: ExecutionPrimitives;
  /** Known execution limitations of an executable capability. */
  limitations: readonly string[];
  /** Why, in one sentence a person can act on. */
  reason: string;
}

const P = (
  provider_available: boolean, verified_contract: boolean, engine_executor: boolean,
  normalizer: boolean, entity_extraction: ExecutionPrimitives["entity_extraction"],
): ExecutionPrimitives => ({
  provider_available, verified_contract, engine_executor, normalizer, entity_extraction,
});

const PEOPLE_STAGE = "people stage: offered after qualification, never scheduled automatically";

export const CAPABILITY_EXECUTABILITY: Readonly<Record<CapabilityId, CapabilityExecutability>> =
  Object.freeze({
    startup_company_discovery: {
      capability: "startup_company_discovery", state: "executable",
      primitives: P(true, true, true, true, true),
      limitations: ["YC-cohort sources: funding stage is not provable from a batch"],
      reason: "memo23 / solidcode / LinkedIn company search, engine-driven discovery",
    },
    general_company_discovery: {
      capability: "general_company_discovery", state: "executable",
      primitives: P(true, true, true, true, true),
      limitations: [],
      reason: "company directory / search, engine-driven discovery",
    },
    known_company_resolution: {
      capability: "known_company_resolution", state: "executable",
      primitives: P(true, true, true, true, true),
      limitations: [],
      reason: "resolves companies the user supplied; no provider needed",
    },
    job_discovery: {
      capability: "job_discovery", state: "executable",
      primitives: P(true, true, true, true, true),
      limitations: [
        "LinkedIn job search only: no company-size input, so size is read from each employer's declared band (plausible until enrichment)",
        "staffing-agency postings are dropped by a deterministic guard, not by the provider",
        "the four job-board Actors remain uncarded and are never selected",
      ],
      reason:
        "LinkedIn job search (P3, verified 2026-09-16): the employer's LinkedIn page, website " +
        "and headcount arrive on each posting, engine-driven discovery",
    },
    funding_signal_discovery: {
      capability: "funding_signal_discovery", state: "executable",
      primitives: P(true, true, true, true, true),
      limitations: [
        "discovery only: it cannot verify funding for a company found another way",
      ],
      reason: "datahyena funding rounds, engine-driven discovery",
    },
    expansion_signal_discovery: {
      capability: "expansion_signal_discovery", state: "needs_extraction_work",
      primitives: P(true, true, false, true, false),
      limitations: [],
      reason:
        "news articles carry no canonical company, so expansion evidence cannot yet start " +
        "a search; the engine skips this step",
    },
    product_launch_discovery: {
      capability: "product_launch_discovery", state: "needs_extraction_work",
      primitives: P(true, true, false, true, false),
      limitations: [],
      reason:
        "news articles carry no canonical company, so launch evidence cannot yet start " +
        "a search; the engine has no executor for this step",
    },
    company_identity_resolution: {
      capability: "company_identity_resolution", state: "executable",
      primitives: P(true, true, true, true, "n/a"),
      limitations: [],
      reason: "LinkedIn company search, domain-confirmed",
    },
    company_enrichment: {
      capability: "company_enrichment", state: "executable",
      primitives: P(true, true, true, true, "n/a"),
      limitations: [],
      reason: "LinkedIn company details",
    },
    hiring_verification: {
      capability: "hiring_verification", state: "executable",
      primitives: P(true, true, true, true, "n/a"),
      limitations: ["company-scoped: verifies hiring for companies it is given, cannot find employers"],
      reason: "embedded YC open jobs or company-scoped LinkedIn job search",
    },
    expansion_signal_verification: {
      capability: "expansion_signal_verification", state: "executable",
      primitives: P(true, true, true, true, "n/a"),
      limitations: ["only Google News is executed; LinkedIn company posts are listed but not run"],
      reason: "Google News per named company",
    },
    company_post_verification: {
      capability: "company_post_verification", state: "needs_engine_work",
      primitives: P(true, true, false, true, "n/a"),
      limitations: [],
      reason: "LinkedIn company posts are carded, but the engine has no executor for this step",
    },
    product_launch_verification: {
      capability: "product_launch_verification", state: "executable",
      primitives: P(true, true, true, true, "n/a"),
      limitations: ["only Google News is executed; LinkedIn company posts are listed but not run"],
      reason: "Google News per named company",
    },
    technology_verification: {
      capability: "technology_verification", state: "needs_engine_work",
      primitives: P(true, true, false, false, "n/a"),
      limitations: ["BuiltWith maps a known domain to technologies; it cannot find companies by technology"],
      reason: "BuiltWith is carded, but the engine has no executor for this step",
    },
    company_brain_qualification: {
      capability: "company_brain_qualification", state: "executable",
      primitives: P(true, true, true, true, "n/a"),
      limitations: [],
      reason: "deterministic + model qualification; no provider",
    },
    founder_discovery: {
      capability: "founder_discovery", state: "executable",
      primitives: P(true, true, true, true, "n/a"),
      limitations: [PEOPLE_STAGE],
      reason: "people search / company employees, unlock-gated",
    },
    employer_verification: {
      capability: "employer_verification", state: "executable",
      primitives: P(true, true, true, true, "n/a"),
      limitations: [PEOPLE_STAGE],
      reason: "deterministic employer match; no provider",
    },
    contact_enrichment: {
      capability: "contact_enrichment", state: "executable",
      primitives: P(true, true, true, true, "n/a"),
      limitations: [PEOPLE_STAGE],
      reason: "profile enrichment, unlock-gated",
    },
    job_deduplication: {
      capability: "job_deduplication", state: "executable",
      primitives: P(true, true, true, true, "n/a"),
      limitations: [],
      reason: "job rows are deduplicated by job id, and employers by LinkedIn company, during job discovery",
    },
    persistence: {
      capability: "persistence", state: "executable",
      primitives: P(true, true, true, true, "n/a"),
      limitations: [],
      reason: "writes results to the Workbench; no provider",
    },
  });

export function capabilityExecutability(id: CapabilityId): CapabilityExecutability {
  return CAPABILITY_EXECUTABILITY[id];
}

/** Unknown ids are never executable. */
export function isCapabilityExecutable(id: string): boolean {
  const e = (CAPABILITY_EXECUTABILITY as Record<string, CapabilityExecutability | undefined>)[id];
  return e?.state === "executable";
}

export function executabilityStateOf(id: string): ExecutabilityState {
  const e = (CAPABILITY_EXECUTABILITY as Record<string, CapabilityExecutability | undefined>)[id];
  return e?.state ?? "unsupported";
}

// ── WHO RUNS WITH THE GATE ENFORCED ──────────────────────────────────────────

export type ExecutabilityGateMode = "enforce" | "legacy";

/** `off`/`legacy` disables the gate everywhere (rollback). Unset = on for V2. */
export const EXECUTABILITY_GATE_ENV = "LEAD_V2_EXECUTABILITY_GATE";

const defaultRead: EnvReader = (k) => {
  try { return Deno.env.get(k); } catch { return undefined; }
};

/**
 * The gate mode for a lead mission in this workspace.
 *
 * Enforced only where Lead V2 owns execution — the same allowlist orchestrate
 * uses to route to the V2 worker — so V1 workspaces keep today's plans exactly.
 * Signals monitoring never calls this: it pins `legacy` through
 * `monitoringRetrievalPort.ts`.
 */
export function executabilityGateFor(
  workspaceId: string | null | undefined, read: EnvReader = defaultRead,
  /** The V2 queue is executing this mission (the worker) — V2 by definition. */
  ownedByV2Queue = false,
): ExecutabilityGateMode {
  const flag = (read(EXECUTABILITY_GATE_ENV) ?? "").trim().toLowerCase();
  if (flag === "off" || flag === "legacy") return "legacy";
  if (ownedByV2Queue) return "enforce";
  return resolveLeadExecutionEngine(workspaceId, read) === "v2_worker" ? "enforce" : "legacy";
}
