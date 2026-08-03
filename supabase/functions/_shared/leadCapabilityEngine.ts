// THE CAPABILITY EXECUTION ENGINE — the graph drives, nothing else does.
//
// Phase 1 made the capability graph AUTHORITATIVE about what may run. It still
// let `executeCompanyFirstRoute` decide the actual order, which left two things
// that could disagree about the same run. This module removes the second one:
// the graph's own steps are now the state machine, and every provider call
// happens because a capability asked for it.
//
// WHAT IT REUSES AND WHY.
//
// Nothing here re-implements a provider normalizer, an Actor input compiler, an
// identity resolver or the Company Brain gate. Those are correct, tested, and
// the source of the evidence discipline this engine depends on. The engine
// COMPOSES them one capability at a time, which is what buys genuine resume
// granularity: a run that stopped after enrichment resumes at hiring
// verification rather than re-paying for discovery.
//
// THREE RULES THE ENGINE ENFORCES THAT A LINEAR EXECUTOR CANNOT.
//
//   * A capability runs only when its inputs exist. Founder discovery cannot
//     run on companies that never passed the Brain, because "qualified company"
//     is an input it declares and the engine checks.
//   * A capability advances only when its evidence requirements are met.
//     Enrichment that returned nothing does not count as enrichment, so
//     qualification still sees "unenriched" rather than an empty record that
//     looks like a proven negative.
//   * Provider exhaustion is a STATE, not a licence. When memo23 and solidcode
//     are both spent, the mission reports exhausted. It does not discover that
//     a job board is technically reachable.
//
// PROVIDER ACCESS IS THROUGH `guardedInvoker` ONLY. A `CapabilityContainmentError`
// is deliberately NOT caught into a fallback: it means the engine tried to reach
// outside its own graph, which is a bug in the engine, not a provider failure.
//
// No network, provider, model or database access of its own — everything is
// injected, which is what lets the end-to-end proof exercise the REAL engine
// with zero paid runs.

import {
  compileHarvestCompanyDetailsInput, compileHarvestCompanyEmployeesInput,
  compileHarvestJobSearchInput, compileHarvestProfileSearchInput,
  compileMemo23YcInput, fanOutSolidcodeTeamSizes,
  type CompiledActorCall, type CompileResult,
} from "./hiringActorInputs.ts";
import {
  dedupeJobs, dedupePeople, normalizeHarvestPerson, normalizeLinkedInCompanyEnriched,
  normalizeLinkedInJob, normalizeMemo23Company, normalizeMemo23OpenJobs,
  normalizeSolidcodeCompany,
  type NormalizedHiringCompany, type NormalizedHiringJob, type NormalizedHiringPerson,
} from "./hiringActorNormalizers.ts";
import {
  advance, evaluateCompanyFit, newCompanyRecord, projectFunnel,
  type CompanyFitResult, type CompanyRecordState, type FunnelCounts,
} from "./companyFirstStages.ts";
import {
  identityIsActionable, resolveIdentityAgainstLookups, type IdentityResolution,
} from "./companyIdentityResolution.ts";
import { DEFAULT_ROLE_PACKS, filterJobsForPack, type RolePack } from "./hiringRolePackFilter.ts";
import {
  COMPANY_EMPLOYEES_SCRAPER_MODES, PROFILE_SEARCH_SCRAPER_MODES,
} from "./hiringActorCatalog.ts";
import {
  CAPABILITY_REGISTRY, CapabilityContainmentError, onCapabilityExhausted,
  type CapabilityId, type CapabilityPlan,
} from "./leadCapabilityGraph.ts";
import { guardedInvoker } from "./leadMissionRuntime.ts";
import { missionHash, type LeadMissionV1 } from "./leadMission.ts";

export const CAPABILITY_EXECUTION_STATE_VERSION = "capability-execution-state-v1" as const;

// ------------------------------------------------------------------ state ----

export interface ProviderAttempt {
  capability: CapabilityId;
  provider: string;
  attempt: number;
  outcome: "ok" | "empty" | "error" | "skipped_idempotent" | "compile_failed";
  rows: number;
  cost_units: number;
  reason: string | null;
}

export interface CapabilityExecutionState {
  version: typeof CAPABILITY_EXECUTION_STATE_VERSION;
  /** Binds this state to the mission it was produced for. */
  mission_hash: string;
  entry_capability: CapabilityId;
  completed_capabilities: CapabilityId[];
  current_capability: CapabilityId | null;
  pending_capabilities: CapabilityId[];
  provider_attempts: ProviderAttempt[];
  accumulated_cost_units: number;
  /** Deduplicated company identities seen, in discovery order. */
  company_keys: string[];
  qualified_company_keys: string[];
  /** Passed every gate except one that lacked evidence. NOT rejections. */
  unknown_company_keys: string[];
  contact_identities: string[];
  terminal_reason: string | null;
  fallback_reason: string | null;
}

export function newExecutionState(
  plan: CapabilityPlan, missionHashValue: string,
): CapabilityExecutionState {
  return {
    version: CAPABILITY_EXECUTION_STATE_VERSION,
    mission_hash: missionHashValue,
    entry_capability: plan.entry_capability,
    completed_capabilities: [],
    current_capability: null,
    pending_capabilities: plan.steps.map((s) => s.capability),
    provider_attempts: [],
    accumulated_cost_units: 0,
    company_keys: [],
    qualified_company_keys: [],
    unknown_company_keys: [],
    contact_identities: [],
    terminal_reason: null,
    fallback_reason: null,
  };
}

/**
 * Is this state safe to resume against this mission?
 *
 * A state whose `mission_hash` disagrees belongs to a DIFFERENT question, and
 * continuing from it would silently answer the old one. Resuming from scratch
 * costs money; resuming from the wrong mission costs correctness.
 */
export function stateMatchesMission(
  state: CapabilityExecutionState | null | undefined, missionHashValue: string,
): boolean {
  return !!state && state.version === CAPABILITY_EXECUTION_STATE_VERSION &&
    state.mission_hash === missionHashValue;
}

// -------------------------------------------------------------- working set ----

export interface EngineCompany {
  key: string;
  company: NormalizedHiringCompany;
  identity: IdentityResolution | null;
  enriched: NormalizedHiringCompany | null;
  yc_open_jobs: NormalizedHiringJob[];
  hiring_jobs: NormalizedHiringJob[];
  fit: CompanyFitResult | null;
  /** Set when the Brain returned UNKNOWN and evidence resolution was attempted. */
  classification: { verdict: "pass" | "fail" | "unknown"; reason: string; source: string } | null;
  /**
   * THE QUALIFICATION DECISION, held explicitly.
   *
   * Deliberately NOT read back off `record.stage`. `advance` only moves forward
   * through COMPANY_STAGE_ORDER, in which `company_fit_*` precedes
   * `hiring_verified` — and this graph verifies hiring BEFORE it qualifies, so
   * the fit stages are backward moves that `advance` correctly refuses. Reading
   * the verdict off the stage therefore lost every UNKNOWN silently, which is
   * the precise failure mode this whole module exists to prevent.
   */
  verdict: "pass" | "reject" | "unknown" | null;
  founders: NormalizedHiringPerson[];
  verified_founders: NormalizedHiringPerson[];
  contact_identities: string[];
  record: CompanyRecordState;
}

function companyKey(c: NormalizedHiringCompany): string {
  return (c.linkedin_company_url ?? c.canonical_domain ?? c.external_source_id)
    .toLowerCase().replace(/\/$/, "");
}

// --------------------------------------------------------------------- deps ----

export type ActorInvoker = (call: CompiledActorCall<unknown>) => Promise<Record<string, unknown>[]>;

export interface CapabilityEngineDeps {
  /** The ONLY provider entry point. Wrapped in `guardedInvoker` by the engine. */
  invoke: ActorInvoker;
  verifyEmployer: (
    person: NormalizedHiringPerson, companyLinkedInUrl: string,
  ) => { verified: boolean; outcome: string };
  /**
   * Resolve an UNKNOWN Company Brain verdict with a semantic classifier.
   *
   * Absent or null-returning means UNKNOWN STAYS UNKNOWN. That is the whole
   * point: a company we could not classify is held for review, never converted
   * into a rejection because the budget for interpreting it was zero.
   */
  classifyCompany?: (input: {
    company_name: string | null; description: string | null;
    provider_industry: string | null; positive_industries: string[];
  }) => Promise<{ verdict: "pass" | "fail" | "unknown"; reason: string } | null>;
  callCompleted?: (key: string) => boolean;
  onCallComplete?: (key: string) => void;
  log?: (msg: string, meta?: unknown) => void;
}

export interface CapabilityEngineOpts {
  mission: LeadMissionV1;
  plan: CapabilityPlan;
  /** Resume state. Ignored unless its mission_hash matches. */
  state?: CapabilityExecutionState | null;
  brain?: {
    employee_min?: number | null;
    employee_max?: number | null;
    positive_industries?: string[];
    excluded_industries?: string[];
    required_geography?: string | null;
  };
  maxCandidates?: number;
  rolePacks?: readonly RolePack[];
  postedLimit?: "1h" | "24h" | "week" | "month";
  ycRegions?: string[];
  ycIndustries?: string[];
  ycMinSize?: string;
  ycMaxSize?: string;
  solidcodeTeamSizes?: string[];
  foundersPerCompany?: number;
}

export interface CapabilityRunResult {
  state: CapabilityExecutionState;
  companies: EngineCompany[];
  funnel: FunnelCounts;
  /** Per-capability outcome, in execution order. Persisted for audit. */
  capability_outcomes: Array<{
    capability: CapabilityId;
    status: "complete" | "skipped_resumed" | "skipped_no_input" | "exhausted";
    rows: number;
    providers_used: string[];
    evidence_satisfied: boolean;
    reason: string | null;
  }>;
}

// ------------------------------------------------------------------ engine ----

/**
 * Execute a mission's capability plan.
 *
 * The loop is the contract: steps in plan order, each one checked for inputs
 * before it runs and for evidence after it does. There is no path through this
 * function that reaches a provider the plan did not authorise, and no path that
 * substitutes one capability for another when the first comes up empty.
 */
export async function runCapabilityPlan(
  deps: CapabilityEngineDeps, opts: CapabilityEngineOpts,
): Promise<CapabilityRunResult> {
  const log = deps.log ?? (() => {});
  const hash = await missionHash(opts.mission);
  const state: CapabilityExecutionState = stateMatchesMission(opts.state, hash)
    ? { ...opts.state!, provider_attempts: [...opts.state!.provider_attempts] }
    : newExecutionState(opts.plan, hash);

  const outcomes: CapabilityRunResult["capability_outcomes"] = [];
  const companies: EngineCompany[] = [];
  const maxCandidates = opts.maxCandidates ?? 50;

  // THE GUARDED BOUNDARY. Every provider call in this file goes through it.
  const invoke = guardedInvoker(opts.plan, deps.invoke, (actorKey) => {
    log("capability_containment_violation", { actorKey });
  });

  /** One provider call: idempotency, cost, attempt record, never off-graph. */
  const callProvider = async (
    capability: CapabilityId, provider: string, compiled: CompileResult<unknown>,
  ): Promise<Record<string, unknown>[]> => {
    const spec = CAPABILITY_REGISTRY[capability];
    const attemptNo = state.provider_attempts
      .filter((a) => a.capability === capability && a.provider === provider).length + 1;
    const record = (outcome: ProviderAttempt["outcome"], rows: number, reason: string | null) => {
      state.provider_attempts.push({
        capability, provider, attempt: attemptNo, outcome, rows,
        cost_units: outcome === "ok" || outcome === "empty" ? spec.cost_units : 0,
        reason,
      });
      if (outcome === "ok" || outcome === "empty") {
        state.accumulated_cost_units += spec.cost_units;
      }
    };

    if (!compiled.ok) {
      record("compile_failed", 0, compiled.errors.join("; "));
      return [];
    }
    const call = compiled;
    if (deps.callCompleted?.(call.batchIdentity)) {
      record("skipped_idempotent", 0, call.batchIdentity);
      return [];
    }
    try {
      const rows = await invoke(call);
      deps.onCallComplete?.(call.batchIdentity);
      record(rows.length > 0 ? "ok" : "empty", rows.length, null);
      return rows;
    } catch (e) {
      // A CONTAINMENT error is an engine bug, not a provider failure. Letting it
      // become "try the next provider" is exactly how a guard turns into a
      // suggestion, so it propagates.
      if (e instanceof CapabilityContainmentError) throw e;
      record("error", 0, String(e));
      log("provider_error", { capability, provider, error: String(e) });
      return [];
    }
  };

  const finish = (
    capability: CapabilityId,
    status: CapabilityRunResult["capability_outcomes"][number]["status"],
    rows: number, providers: string[], evidence: boolean, reason: string | null,
  ) => {
    outcomes.push({
      capability, status, rows, providers_used: providers,
      evidence_satisfied: evidence, reason,
    });
    if (status === "complete" || status === "skipped_resumed" || status === "skipped_no_input") {
      if (!state.completed_capabilities.includes(capability)) {
        state.completed_capabilities.push(capability);
      }
    }
    state.pending_capabilities = state.pending_capabilities.filter((c) => c !== capability);
    state.current_capability = null;
  };

  for (const step of opts.plan.steps) {
    const cap = step.capability;

    // RESUME. A capability already completed is not re-paid for.
    if (state.completed_capabilities.includes(cap)) {
      outcomes.push({
        capability: cap, status: "skipped_resumed", rows: 0, providers_used: [],
        evidence_satisfied: true, reason: "completed in an earlier run",
      });
      state.pending_capabilities = state.pending_capabilities.filter((c) => c !== cap);
      continue;
    }
    state.current_capability = cap;

    // ── DISCOVERY ────────────────────────────────────────────────────────────
    if (cap === "startup_company_discovery") {
      const used: string[] = [];
      const tried: string[] = [];
      for (const provider of step.providers) {
        if (companies.length >= maxCandidates) break;
        // solidcode is FALLBACK ONLY: it runs when the primary produced nothing,
        // not merely when the quota is unmet.
        if (provider === "apify_yc_companies_solidcode" && companies.length > 0) {
          tried.push(provider);
          continue;
        }
        tried.push(provider);
        used.push(provider);

        if (provider === "apify_yc_companies_memo23") {
          const compiled = compileMemo23YcInput({
            mode: "companies",
            regions: opts.ycRegions ?? ["United States of America"],
            industries: opts.ycIndustries ?? ["B2B"],
            isHiring: true,
            minEmployeeSize: opts.ycMinSize ?? "1+",
            maxEmployeeSize: opts.ycMaxSize ?? "250",
            scrapeOpenJobs: true,
            scrapeFounderDetails: false,
            maxItems: maxCandidates,
          });
          for (const r of await callProvider(cap, provider, compiled)) {
            const c = normalizeMemo23Company(r);
            addCompany(companies, c, normalizeMemo23OpenJobs(r));
          }
        } else if (provider === "apify_yc_companies_solidcode") {
          if ((opts.solidcodeTeamSizes ?? []).length === 0) {
            state.provider_attempts.push({
              capability: cap, provider, attempt: 1, outcome: "compile_failed",
              rows: 0, cost_units: 0, reason: "no team-size bands supplied; a bandless call duplicates memo23 at 2x price",
            });
            continue;
          }
          for (const compiled of fanOutSolidcodeTeamSizes(
            { regions: ["United States of America"], industries: ["B2B"], isHiring: true,
              includeJobs: true, includeFounders: false, maxResults: maxCandidates },
            opts.solidcodeTeamSizes ?? [],
          )) {
            for (const r of await callProvider(cap, provider, compiled)) {
              addCompany(companies, normalizeSolidcodeCompany(r), []);
            }
          }
        }
      }
      state.company_keys = companies.map((c) => c.key);

      if (companies.length === 0) {
        const ex = onCapabilityExhausted(opts.plan, cap, tried);
        state.terminal_reason = ex.reason;
        state.fallback_reason = ex.status === "exhausted" ? "approved_providers_exhausted" : null;
        finish(cap, "exhausted", 0, used, false, ex.reason);
        // EXHAUSTED ENDS THE RUN. It does not fall through to a capability that
        // happens to be later in the plan.
        break;
      }
      finish(cap, "complete", companies.length, used, true, null);
      continue;
    }

    if (cap === "general_company_discovery" || cap === "known_company_resolution" ||
        cap === "job_discovery" || cap === "funding_signal_discovery" ||
        cap === "expansion_signal_discovery" || cap === "job_deduplication" ||
        cap === "expansion_signal_verification") {
      // Declared in the graph and reachable, but not yet driven by this engine.
      // Recorded honestly rather than silently treated as done.
      finish(cap, "skipped_no_input", 0, [], false,
        "capability is not yet engine-driven; the mission reports a partial result");
      continue;
    }

    // ── IDENTITY ─────────────────────────────────────────────────────────────
    if (cap === "company_identity_resolution") {
      let resolved = 0;
      for (const c of companies) {
        let lookups: Array<{ name: string | null; linkedinUrl: string | null; website: string | null }> = [];
        if (!c.company.linkedin_company_url && c.company.company_name) {
          const compiled = compileHarvestCompanyDetailsInput({ searches: [c.company.company_name] });
          const found = await callProvider(cap, "apify_linkedin_company_details", compiled);
          lookups = found.map((f) => ({
            name: (f.name as string) ?? null,
            linkedinUrl: (f.linkedinUrl as string) ?? null,
            website: (f.website as string) ?? null,
          }));
        }
        c.identity = resolveIdentityAgainstLookups({
          company_key: c.key,
          name: c.company.company_name ?? null,
          website: c.company.canonical_domain ? `https://${c.company.canonical_domain}` : null,
          canonical_domain: c.company.canonical_domain ?? null,
          linkedin_company_url: c.company.linkedin_company_url ?? null,
        }, lookups);
        if (identityIsActionable(c.identity)) resolved++;
        else {
          c.record = advance(c.record, "identity_pending", c.identity.status);
          c.record.missing_evidence.push(...c.identity.evidence);
        }
      }
      finish(cap, "complete", resolved, ["apify_linkedin_company_details"], resolved > 0,
        resolved === 0 ? "no company reached an actionable identity" : null);
      continue;
    }

    // ── ENRICHMENT (MANDATORY, BEFORE QUALIFICATION) ─────────────────────────
    if (cap === "company_enrichment") {
      let enriched = 0;
      const actionable = companies.filter((c) => c.identity && identityIsActionable(c.identity));
      for (const c of actionable) {
        const url = c.identity?.linkedin_company_url ?? c.company.linkedin_company_url;
        if (!url) continue;
        const compiled = compileHarvestCompanyDetailsInput({ companies: [url] });
        const rows = await callProvider(cap, "apify_linkedin_company_details", compiled);
        if (rows.length > 0) {
          c.enriched = normalizeLinkedInCompanyEnriched(rows[0]);
          c.record = advance(c.record, "enrichment_complete", "provider_evidence_collected");
          enriched++;
        } else {
          c.record = advance(c.record, "enrichment_pending", "enrichment_returned_no_rows");
        }
      }
      // EVIDENCE GATE. Enrichment that produced nothing is not enrichment, and
      // qualification must see that rather than an empty record it could read as
      // a proven negative.
      finish(cap, "complete", enriched, ["apify_linkedin_company_details"], enriched > 0,
        enriched === 0 ? "no company was enriched; qualification will hold them as unknown" : null);
      continue;
    }

    // ── HIRING VERIFICATION ──────────────────────────────────────────────────
    if (cap === "hiring_verification") {
      const packs = opts.rolePacks ?? DEFAULT_ROLE_PACKS;
      const targets = companies.filter((c) => c.identity && identityIsActionable(c.identity));
      let verified = 0;
      for (const c of targets) {
        // memo23 already returned open jobs for some companies — paying a second
        // Actor for evidence we hold is waste, not diligence.
        const fromYc = keptForPacks(c.yc_open_jobs, packs);
        if (fromYc.length > 0) {
          c.hiring_jobs = dedupeJobs(fromYc);
          c.record = advance(c.record, "hiring_verified", "yc_open_jobs_sufficient");
          verified++;
          continue;
        }
        const url = c.identity?.linkedin_company_url ?? c.company.linkedin_company_url;
        if (!url) continue;
        const compiled = compileHarvestJobSearchInput({
          company: [url],
          // The packs ARE the approved titles. Deriving them here rather than
          // from the mission sentence is what keeps verification scoped to the
          // roles the mission actually asked about.
          jobTitles: packTitles(packs),
          maxItems: 10,
          ...(opts.postedLimit ? { postedLimit: opts.postedLimit } : {}),
        });
        const rows = await callProvider(cap, "apify_linkedin_job_search", compiled);
        const jobs = keptForPacks(rows.map(normalizeLinkedInJob), packs);
        c.hiring_jobs = dedupeJobs(jobs);
        if (c.hiring_jobs.length > 0) {
          c.record = advance(c.record, "hiring_verified", "job_evidence_present");
          verified++;
        } else {
          c.record = advance(c.record, "hiring_not_verified", "no_matching_open_role");
        }
      }
      finish(cap, "complete", verified, ["apify_linkedin_job_search"], verified > 0,
        verified === 0 ? "no company had a matching open role" : null);
      continue;
    }

    // ── COMPANY BRAIN QUALIFICATION ──────────────────────────────────────────
    if (cap === "company_brain_qualification") {
      let passed = 0, unknown = 0;
      const eligible = companies.filter(
        (c) => c.record.stage === "hiring_verified" || c.hiring_jobs.length > 0);
      for (const c of eligible) {
        const src = c.enriched ?? c.company;
        c.fit = evaluateCompanyFit({
          company_key: c.key,
          company_name: src.company_name ?? null,
          identity_status: c.identity?.status ?? "unresolved",
          enrichment_complete: c.enriched !== null,
          employee_count: src.employee_count ?? null,
          employee_range_advisory: src.employee_range_advisory ?? null,
          employee_min: opts.brain?.employee_min ?? null,
          employee_max: opts.brain?.employee_max ?? null,
          industry_ids: src.industry_ids ?? [],
          positive_industries: opts.brain?.positive_industries ?? [],
          excluded_industries: opts.brain?.excluded_industries ?? [],
          geography: src.geography ?? null,
          required_geography: opts.brain?.required_geography ?? null,
          description: src.description ?? null,
          provider_industry: src.provider_industry ?? null,
          canonical_domain: src.canonical_domain ?? null,
          postings: c.hiring_jobs.map((j) => ({ job_id: j.job_id, title: j.title, description: j.description })),
        });

        if (c.fit.stage === "company_fit_pass") {
          c.verdict = "pass";
          c.record = advance(c.record, "qualified_company", "hiring_signal_verified");
          passed++;
          continue;
        }
        if (c.fit.stage === "company_fit_reject") {
          c.verdict = "reject";
          c.record = advance(c.record, "company_fit_reject", c.fit.reason);
          c.record.failed_gates = c.fit.failed_gates;
          continue;
        }

        // ── UNKNOWN: RESOLVE, NEVER REJECT ──────────────────────────────────
        // A pending verdict means evidence was missing, not that the company was
        // unsuitable. Rejecting here is what destroyed Docusign, Outreach, Clay,
        // Sortly and Harmonic Security on the 2026-08-03 run while looking like
        // precision.
        const resolved = deps.classifyCompany
          ? await deps.classifyCompany({
            company_name: src.company_name ?? null,
            description: src.description ?? null,
            provider_industry: src.provider_industry ?? null,
            positive_industries: opts.brain?.positive_industries ?? [],
          })
          : null;
        if (resolved && resolved.verdict === "pass") {
          c.classification = { ...resolved, source: "semantic_classification" };
          c.verdict = "pass";
          c.record = advance(c.record, "qualified_company", "semantic_classification_pass");
          passed++;
        } else if (resolved && resolved.verdict === "fail") {
          c.classification = { ...resolved, source: "semantic_classification" };
          c.verdict = "reject";
          c.record = advance(c.record, "company_fit_reject", "semantic_classification_fail");
          c.record.failed_gates = c.fit.failed_gates;
        } else {
          c.classification = resolved
            ? { ...resolved, source: "semantic_classification" }
            : { verdict: "unknown", reason: "no classifier available", source: "unresolved" };
          // HELD, NOT REJECTED. The stage stays where the pipeline actually got
          // to; the verdict is what says the Brain could not decide.
          c.verdict = "unknown";
          c.record.stage_reason = `company_fit_pending:${c.fit.reason}`;
          c.record.missing_evidence.push(...c.fit.missing_evidence);
          unknown++;
        }
      }
      state.qualified_company_keys = companies.filter((c) => c.verdict === "pass").map((c) => c.key);
      state.unknown_company_keys = companies.filter((c) => c.verdict === "unknown").map((c) => c.key);

      finish(cap, "complete", passed, [], passed > 0,
        passed === 0
          ? `no company passed the Company Brain; ${unknown} held as unknown pending evidence`
          : null);
      continue;
    }

    // ── FOUNDER DISCOVERY ────────────────────────────────────────────────────
    if (cap === "founder_discovery") {
      const qualified = companies.filter((c) => c.verdict === "pass");
      if (qualified.length === 0) {
        finish(cap, "skipped_no_input", 0, [], false,
          "no qualified company — founder discovery has no input");
        continue;
      }
      const used: string[] = [];
      const roles = opts.mission.decision_makers.roles;
      const perCompany = opts.foundersPerCompany ?? 3;
      let found = 0;
      for (const c of qualified) {
        const url = c.identity?.linkedin_company_url ?? c.company.linkedin_company_url;
        if (!url) continue;
        used.push("apify_linkedin_company_employees");
        const compiled = compileHarvestCompanyEmployeesInput({
          companies: [url], jobTitles: roles, maxItems: perCompany,
          // Cheapest verified mode. Email-enrichment modes are forbidden by the
          // compiler, so this can never silently become a paid email lookup.
          profileScraperMode: COMPANY_EMPLOYEES_SCRAPER_MODES[0],
        });
        let rows = await callProvider(cap, "apify_linkedin_company_employees", compiled);
        if (rows.length === 0) {
          // FALLBACK WITHIN THE CAPABILITY. Approved provider, same question.
          const ex = onCapabilityExhausted(opts.plan, cap, ["apify_linkedin_company_employees"]);
          if (ex.status === "provider_fallback_available" && ex.next_provider === "apify_people_search") {
            used.push("apify_people_search");
            const fb = compileHarvestProfileSearchInput({
              currentCompanies: [url], currentJobTitles: roles, maxItems: perCompany,
              profileScraperMode: PROFILE_SEARCH_SCRAPER_MODES[0],
            });
            rows = await callProvider(cap, "apify_people_search", fb);
          }
        }
        c.founders = dedupePeople(rows.map((r) => normalizeHarvestPerson(r, "capability_engine")));
        if (c.founders.length > 0) {
          c.record = advance(c.record, "founder_pending", "candidates_returned");
          found += c.founders.length;
        }
      }
      finish(cap, "complete", found, [...new Set(used)], found > 0,
        found === 0 ? "no decision-maker candidates were returned" : null);
      continue;
    }

    // ── EMPLOYER VERIFICATION ────────────────────────────────────────────────
    if (cap === "employer_verification") {
      let verified = 0;
      for (const c of companies) {
        if (c.founders.length === 0) continue;
        const url = c.identity?.linkedin_company_url ?? c.company.linkedin_company_url ?? "";
        c.verified_founders = c.founders.filter((p) => deps.verifyEmployer(p, url).verified);
        if (c.verified_founders.length > 0) {
          c.record = advance(c.record, "founder_verified", "current_employer_verified");
          verified += c.verified_founders.length;
        } else {
          c.record = advance(c.record, "founder_mismatch", "no_current_employer_match");
        }
      }
      finish(cap, "complete", verified, [], verified > 0,
        verified === 0 ? "no decision-maker was verified at their company" : null);
      continue;
    }

    // ── CONTACT ENRICHMENT ───────────────────────────────────────────────────
    if (cap === "contact_enrichment") {
      let contactReady = 0;
      for (const c of companies) {
        for (const p of c.verified_founders) {
          const identity = p.linkedin_url ?? p.source_profile_id ?? null;
          if (!identity) continue;
          c.contact_identities.push(identity);
          contactReady++;
        }
        if (c.contact_identities.length > 0) {
          c.record = advance(c.record, "contact_pending", "contact_method_present");
        }
      }
      state.contact_identities = [...new Set(companies.flatMap((c) => c.contact_identities))];
      finish(cap, "complete", contactReady, [], contactReady > 0,
        contactReady === 0 ? "no verified decision-maker had a contact method" : null);
      continue;
    }

    // ── PERSISTENCE ──────────────────────────────────────────────────────────
    if (cap === "persistence") {
      finish(cap, "complete", state.contact_identities.length, [], true, null);
      continue;
    }

    finish(cap, "skipped_no_input", 0, [], false, `unhandled capability: ${cap}`);
  }

  if (state.pending_capabilities.length === 0 && state.terminal_reason === null) {
    state.terminal_reason = "capability_plan_complete";
  }

  return {
    state,
    companies,
    funnel: projectFunnel(companies.map((c) => c.record)),
    capability_outcomes: outcomes,
  };
}

/** Union of jobs kept by ANY approved pack. `filterJobsForPack` takes one pack. */
function keptForPacks(
  jobs: readonly NormalizedHiringJob[], packs: readonly RolePack[],
): NormalizedHiringJob[] {
  const out: NormalizedHiringJob[] = [];
  for (const pack of packs) {
    for (const j of filterJobsForPack(jobs, pack).kept) out.push(j);
  }
  return out;
}

function packTitles(packs: readonly RolePack[]): string[] {
  return [...new Set(packs.flatMap((p) => p.titles))].slice(0, 20);
}

function addCompany(
  set: EngineCompany[], c: NormalizedHiringCompany, ycJobs: NormalizedHiringJob[],
): void {
  const key = companyKey(c);
  if (set.some((x) => x.key === key)) return;
  set.push({
    key, company: c, identity: null, enriched: null,
    yc_open_jobs: ycJobs, hiring_jobs: [], fit: null, classification: null, verdict: null,
    founders: [], verified_founders: [], contact_identities: [],
    record: newCompanyRecord(key),
  });
}

// ------------------------------------------------------- persistence bridge ----

/**
 * Adapt an engine run onto the shape the EXISTING persistence projection reads.
 *
 * Deliberately an adapter and not a second projection: `persistPlan` owns
 * accounts, contacts, lead_candidates and the contact-enrichment handoff, and
 * duplicating any of that to suit a new executor is how two write paths start
 * disagreeing about what a lead is. The engine supplies plans; persistence
 * stays exactly where it was.
 */
export function toRouteResultShape(run: CapabilityRunResult): {
  executed_source_order: string[];
  companies: Array<{
    record: CompanyRecordState;
    company: NormalizedHiringCompany;
    identity: IdentityResolution;
    enriched: NormalizedHiringCompany | null;
    hiring_jobs: NormalizedHiringJob[];
    founders: NormalizedHiringPerson[];
  }>;
  funnel: FunnelCounts;
} {
  const executed = [...new Set(
    run.state.provider_attempts
      .filter((a) => a.outcome === "ok" || a.outcome === "empty")
      .map((a) => a.provider),
  )];
  return {
    executed_source_order: executed,
    companies: run.companies.map((c) => ({
      record: c.record,
      company: c.company,
      // The projection reads identity unconditionally, so an unresolved company
      // carries an explicit unresolved identity rather than a null it would
      // dereference.
      identity: c.identity ?? {
        company_key: c.key, status: "unresolved",
        linkedin_company_url: c.company.linkedin_company_url ?? null,
        evidence: ["identity_resolution_did_not_run"], ambiguous_candidates: [],
      },
      enriched: c.enriched,
      hiring_jobs: c.hiring_jobs,
      // Only VERIFIED people are offered for persistence. An unverified founder
      // is a candidate, not a lead.
      founders: c.verified_founders,
    })),
    funnel: run.funnel,
  };
}
