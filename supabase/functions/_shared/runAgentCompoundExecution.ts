// Company-first EXECUTION composer — the single entry point run-agent invokes for
// a compound (company_first) request. Wires the real actor callers + persistence
// (INJECTED as deps) through the tested compound pipeline + adapters. No generic
// people fallback: a jobs failure is an explicit sourcing failure, not a global
// founder search (which would recreate the original defect).

import type { LeadEntityIntent } from "./leadEntityIntent.ts";
import { runCompoundSourcing, type CompoundLimits, type CompoundRunResult } from "./compoundSourcingPipeline.ts";
import { compoundJobsFromRawRows } from "./runAgentCompoundJobAdapter.ts";
import { buildScopedPeopleInput, compoundPeopleFromRows } from "./runAgentCompoundPeopleAdapter.ts";
import { buildCompoundPersistencePlan, type CompoundPersistencePlan } from "./runAgentCompoundPersistenceAdapter.ts";
import type { Vertical } from "./verticalQualification.ts";
import { buildJobsProviderInputs, JobSearchCompilationError, type JobsProviderVariantInput } from "./jobsProviderInput.ts";
import {
  newWriteBoundary, recordProviderInvocation, withEvidenceOnlyPersistence,
  type CompanyFirstWriteBoundary,
} from "./providerEvidenceMode.ts";

export interface CompoundExecutionDeps {
  /** Invoke the real bounded apify_jobs actor with a COMPILED, role-focused input
   * (never the user's sentence); returns RAW rows. */
  invokeJobs: (input: Record<string, unknown>, max: number) => Promise<unknown[]>;
  /** Invoke the real bounded, company-scoped apify_people_search actor; RAW rows. */
  invokePeople: (input: Record<string, unknown>, max: number) => Promise<unknown[]>;
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
  opts: { limits?: Partial<CompoundLimits>; vertical?: Vertical; now?: string; workspaceId?: string } = {},
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
      let variants: JobsProviderVariantInput[];
      try {
        variants = buildJobsProviderInputs(intent.job_search_spec, max);
      } catch (e) {
        compileError = e instanceof JobSearchCompilationError ? e.reason : String(e);
        return []; // FAIL CLOSED — never fall back to the raw query.
      }

      const rows: unknown[] = [];
      for (const v of variants) {
        if (rows.length >= max) break;                                   // shared ceiling
        if (deps.budgetProceed && !deps.budgetProceed()) { diagnostics.budgetStopped = true; break; }
        const remaining = max - rows.length;
        const input = withEvidenceOnlyPersistence({
          query: v.query, location: v.location,
          max_results: Math.min(v.max_results, remaining),
        });
        recordProviderInvocation(writeBoundary, input, `apify_jobs[${v._variant_keyword}]`);
        diagnostics.jobsInvoked = true;
        try {
          const got = await deps.invokeJobs(input, Math.min(v.max_results, remaining));
          diagnostics.jobVariants.push({ keyword: v.query, location: v.location, max_results: input.max_results });
          if (Array.isArray(got)) rows.push(...got);
        } catch (e) {
          // Per-variant failure is recorded; the whole run only fails if NOTHING ran.
          diagnostics.jobVariants.push({ keyword: v.query, location: v.location, max_results: input.max_results, error: String((e as Error)?.message ?? e) });
        }
      }
      if (rows.length === 0 && diagnostics.jobVariants.every((v) => v.error)) { jobsFailed = true; return []; }
      writeBoundary.rawProviderItems += rows.length;
      const jobs = compoundJobsFromRawRows(rows, max).jobs;
      writeBoundary.normalizedJobs += jobs.length;
      return jobs;
    },
    fetchPeopleForCompany: async (scope: import("./scopedPeopleSearch.ts").PeopleSearchScope, max: number) => {
      // Budget bound: people calls are already bounded by the verified-company count.
      if (deps.budgetProceed && !deps.budgetProceed()) { diagnostics.budgetStopped = true; return []; }
      diagnostics.peopleCalls++;
      const input = withEvidenceOnlyPersistence(buildScopedPeopleInput(scope, max));
      recordProviderInvocation(writeBoundary, input, "apify_people_search");
      let rows: unknown[];
      try { rows = await deps.invokePeople(input, max); }
      catch { return []; } // one company's failure never aborts the whole run
      const people = compoundPeopleFromRows(rows, max).people;
      writeBoundary.peopleResults += people.length;
      return people;
    },
  };

  const run = await runCompoundSourcing(intent, pipelineDeps, { limits: opts.limits, vertical: opts.vertical, now: opts.now });

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
  for (const plan of plans) {
    writeBoundary.persistenceAttempts += 1;
    const r = await deps.persist(plan);
    if (r.ok) writeBoundary.persistedRecords += 1;
    persisted.push({ ok: r.ok, accountId: r.accountId, leadCandidateId: r.leadCandidateId, reason: r.reason });
  }

  return { status: "ok", run, plans, persisted, diagnostics, writeBoundary };
}
