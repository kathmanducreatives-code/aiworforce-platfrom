// Company-first EXECUTION composer — the single entry point run-agent invokes for
// a compound (company_first) request. Wires the real actor callers + persistence
// (INJECTED as deps) through the tested compound pipeline + adapters. No generic
// people fallback: a jobs failure is an explicit sourcing failure, not a global
// founder search (which would recreate the original defect).

import type { LeadEntityIntent } from "./leadEntityIntent.ts";
import { runCompoundSourcing, type CompoundLimits, type CompoundRunResult } from "./compoundSourcingPipeline.ts";
import type { CompanyBrainHardConstraints } from "./companyIcpFilter.ts";
import { compoundJobsFromRawRows } from "./runAgentCompoundJobAdapter.ts";
import { buildScopedPeopleInput, compoundPeopleFromRows } from "./runAgentCompoundPeopleAdapter.ts";
import { buildCompoundPersistencePlan, type CompoundPersistencePlan } from "./runAgentCompoundPersistenceAdapter.ts";
import type { Vertical } from "./verticalQualification.ts";
import { assertCompiledForProvider, JobSearchCompilationError } from "./jobsProviderInput.ts";
import { buildCuriousCoderLinkedInJobsInput, buildLinkedInJobsSearchUrls } from "./curiousCoderJobsInput.ts";
import { stampIdempotencyKey } from "./durableIdempotency.ts";
import {
  newWriteBoundary, recordProviderInvocation, buildProviderEnvelope,
  type CompanyFirstWriteBoundary,
} from "./providerEvidenceMode.ts";

export interface CompoundExecutionDeps {
  /** Invoke apify_jobs with a COMPLETE provider envelope (wrapper controls at the
   * top level, actor-native `urls`/`count` under `input`); returns RAW rows. */
  invokeJobs: (envelope: Record<string, unknown>, max: number) => Promise<unknown[]>;
  /** Invoke the company-scoped apify_people_search actor with its envelope. */
  invokePeople: (envelope: Record<string, unknown>, max: number) => Promise<unknown[]>;
  /** Execute a persistence plan through the existing safe writer. */
  persist: (plan: CompoundPersistencePlan) => Promise<{ ok: boolean; accountId: string | null; contactId: string | null; leadCandidateId: string | null; reason?: string }>;
  /** True while further provider calls are within the soft/hard budget. */
  budgetProceed?: () => boolean;
}

export type CompoundExecutionStatus =
  | "ok" | "sourcing_failed" | "no_jobs" | "no_companies" | "unable_to_compile_job_search";

export interface CompoundExecutionResult {
  status: CompoundExecutionStatus;
  run: CompoundRunResult | null;
  plans: CompoundPersistencePlan[];
  persisted: Array<{ ok: boolean; accountId: string | null; leadCandidateId: string | null; reason?: string }>;
  error?: string;
  diagnostics: {
    jobsInvoked: boolean; peopleCalls: number; budgetStopped: boolean;
    /** The compiled variants actually sent to the provider (provenance). */
    jobVariants: Array<{ keyword: string; location: string | null; max_results: number; error?: string }>;
  };
  /** Counters proving no provider-side lead writes happened. */
  writeBoundary: CompanyFirstWriteBoundary;
}

export async function runAgentCompoundExecution(
  intent: LeadEntityIntent,
  deps: CompoundExecutionDeps,
  opts: {
    limits?: Partial<CompoundLimits>; vertical?: Vertical; now?: string; workspaceId?: string;
    /** Round-scoped broadened keywords from the quota controller. */
    keywordQueriesOverride?: string[];
    /** When false the caller (the controller) owns persistence. */
    persistCandidates?: boolean;
    /** Durable paid-call key; recorded in tool_calls.input_json. */
    idempotencyKey?: string;
    /** Builds a per-company durable key for each scoped people call. */
    peopleIdempotencyKey?: (companyKey: string) => string;
    /** Skip a people call whose durable key already completed. */
    peopleCallCompleted?: (key: string) => boolean;
    /** Company Brain HARD constraints. Absent => not enforced (legacy callers). */
    brainConstraints?: CompanyBrainHardConstraints | null;
    brainPolicyHash?: string | null;
  } = {},
): Promise<CompoundExecutionResult> {
  const diagnostics: CompoundExecutionResult["diagnostics"] =
    { jobsInvoked: false, peopleCalls: 0, budgetStopped: false, jobVariants: [] };
  const writeBoundary = newWriteBoundary();
  let jobsFailed = false;
  let compileError: string | null = null;

  const pipelineDeps = {
    // NOTE: the pipeline's `query` argument is deliberately IGNORED. The provider
    // search comes from the compiled job_search_spec — the raw sentence is never a
    // keyword (2026-07-25 live defect).
    fetchJobs: async (_query: string, max: number) => {
      let spec;
      try {
        spec = assertCompiledForProvider(intent.job_search_spec);
      } catch (e) {
        compileError = e instanceof JobSearchCompilationError ? e.reason : String(e);
        return []; // FAIL CLOSED — never fall back to the raw query.
      }
      if (deps.budgetProceed && !deps.budgetProceed()) { diagnostics.budgetStopped = true; return []; }

      // `count` is a RUN-level cap that spans every URL, so all compiled keyword
      // variants go out in ONE invocation sharing the single ceiling — never one
      // full-limit run per variant.
      // The round controller may supply a broadened (still gate-qualifying) set.
      const roundKeywords = opts.keywordQueriesOverride?.length ? opts.keywordQueriesOverride : spec.keyword_queries;
      const urls = buildLinkedInJobsSearchUrls(roundKeywords, spec.location);
      const native = buildCuriousCoderLinkedInJobsInput({ urls, maxResults: max });
      const envelope0 = buildProviderEnvelope("apify_jobs", native as unknown as Record<string, unknown>, max);
      const envelope = opts.idempotencyKey ? stampIdempotencyKey(envelope0 as unknown as Record<string, unknown>, opts.idempotencyKey) : (envelope0 as unknown as Record<string, unknown>);
      recordProviderInvocation(writeBoundary, envelope, "apify_jobs");
      diagnostics.jobsInvoked = true;
      for (const kw of spec.keyword_queries) {
        diagnostics.jobVariants.push({ keyword: kw, location: spec.location, max_results: native.count });
      }

      let rows: unknown[] = [];
      try {
        const got = await deps.invokeJobs(envelope as unknown as Record<string, unknown>, max);
        rows = Array.isArray(got) ? got : [];
      } catch (e) {
        jobsFailed = true;
        for (const v of diagnostics.jobVariants) v.error = String((e as Error)?.message ?? e);
        return [];
      }
      writeBoundary.rawProviderItems += rows.length;
      const jobs = compoundJobsFromRawRows(rows, max).jobs;   // shared ceiling enforced here
      writeBoundary.normalizedJobs += jobs.length;
      return jobs;
    },
    fetchPeopleForCompany: async (scope: import("./scopedPeopleSearch.ts").PeopleSearchScope, max: number) => {
      // Budget bound: people calls are already bounded by the verified-company count.
      if (deps.budgetProceed && !deps.budgetProceed()) { diagnostics.budgetStopped = true; return []; }
      diagnostics.peopleCalls++;
      // Native Harvest fields under `input`; the per-company ceiling at the TOP
      // level, which is the only place source_with_apify reads max_results from.
      const native = buildScopedPeopleInput(scope, max, intent.job_search_spec.requested_person_roles);
      const env0 = buildProviderEnvelope("apify_people_search", native, max);
      // EVERY provider call carries a durable key — jobs AND each company-scoped
      // people call (the 2026-07-26 run stamped jobs only).
      const pKey = opts.peopleIdempotencyKey?.(scope.companyDedupeKey ?? scope.companyName ?? "unknown");
      if (pKey && opts.peopleCallCompleted?.(pKey)) return [];   // already paid for
      const envelope = pKey ? stampIdempotencyKey(env0 as unknown as Record<string, unknown>, pKey) : (env0 as unknown as Record<string, unknown>);
      recordProviderInvocation(writeBoundary, envelope, "apify_people_search");
      let rows: unknown[];
      try { rows = await deps.invokePeople(envelope as unknown as Record<string, unknown>, max); }
      catch { return []; } // one company's failure never aborts the whole run
      const people = compoundPeopleFromRows(rows, max).people;
      writeBoundary.peopleResults += people.length;
      return people;
    },
  };

  const run = await runCompoundSourcing(intent, pipelineDeps, {
    limits: opts.limits, vertical: opts.vertical, now: opts.now,
    // Company Brain hard gate. Threaded, never re-derived here.
    brainConstraints: opts.brainConstraints ?? null, brainPolicyHash: opts.brainPolicyHash ?? null,
  });

  writeBoundary.verifiedCompanies = run.diagnostics.verifiedCompanies;

  if (compileError) {
    return { status: "unable_to_compile_job_search", run: null, plans: [], persisted: [], error: compileError, diagnostics, writeBoundary };
  }
  if (jobsFailed) {
    return { status: "sourcing_failed", run: null, plans: [], persisted: [], error: "jobs_actor_failed", diagnostics, writeBoundary };
  }
  if (run.diagnostics.rawJobs === 0) {
    return { status: "no_jobs", run, plans: [], persisted: [], diagnostics, writeBoundary };
  }
  if (run.diagnostics.verifiedCompanies === 0) {
    return { status: "no_companies", run, plans: [], persisted: [], diagnostics, writeBoundary };
  }

  // Persist each ranked candidate via the injected safe writer. No fallback.
  const plans: CompoundPersistencePlan[] = run.candidates.map((c) => buildCompoundPersistencePlan(c, opts.workspaceId ?? ""));
  writeBoundary.qualifiedCandidates = run.candidates.filter((c) => c.verdict !== "REJECT").length;
  writeBoundary.rejectedCandidates = run.candidates.filter((c) => c.verdict === "REJECT").length;
  const persisted: CompoundExecutionResult["persisted"] = [];
  if (opts.persistCandidates !== false) {
    for (const plan of plans) {
      // HARD GATE (Part G): REJECT/SKIP are diagnostics only — zero account,
      // contact and lead_candidate writes. Checked BEFORE any insert.
      if (!plan.persistable) {
        persisted.push({ ok: false, accountId: null, leadCandidateId: null, reason: plan.persistenceReason });
        continue;
      }
      writeBoundary.persistenceAttempts += 1;
      const r = await deps.persist(plan);
      if (r.ok) writeBoundary.persistedRecords += 1;
      persisted.push({ ok: r.ok, accountId: r.accountId, leadCandidateId: r.leadCandidateId, reason: r.reason });
    }
  }

  return { status: "ok", run, plans, persisted, diagnostics, writeBoundary };
}
