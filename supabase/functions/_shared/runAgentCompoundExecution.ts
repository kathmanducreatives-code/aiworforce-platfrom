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

export interface CompoundExecutionDeps {
  /** Invoke the real bounded apify_jobs actor; returns RAW rows. */
  invokeJobs: (query: string, max: number) => Promise<unknown[]>;
  /** Invoke the real bounded, company-scoped apify_people_search actor; RAW rows. */
  invokePeople: (input: Record<string, unknown>, max: number) => Promise<unknown[]>;
  /** Execute a persistence plan through the existing safe writer. */
  persist: (plan: CompoundPersistencePlan) => Promise<{ ok: boolean; accountId: string | null; contactId: string | null; leadCandidateId: string | null; reason?: string }>;
  /** True while further provider calls are within the soft/hard budget. */
  budgetProceed?: () => boolean;
}

export type CompoundExecutionStatus = "ok" | "sourcing_failed" | "no_jobs" | "no_companies";

export interface CompoundExecutionResult {
  status: CompoundExecutionStatus;
  run: CompoundRunResult | null;
  plans: CompoundPersistencePlan[];
  persisted: Array<{ ok: boolean; accountId: string | null; leadCandidateId: string | null; reason?: string }>;
  error?: string;
  diagnostics: { jobsInvoked: boolean; peopleCalls: number; budgetStopped: boolean };
}

export async function runAgentCompoundExecution(
  intent: LeadEntityIntent,
  deps: CompoundExecutionDeps,
  opts: { limits?: Partial<CompoundLimits>; vertical?: Vertical; now?: string; workspaceId?: string } = {},
): Promise<CompoundExecutionResult> {
  const diagnostics = { jobsInvoked: false, peopleCalls: 0, budgetStopped: false };
  let jobsFailed = false;

  const pipelineDeps = {
    fetchJobs: async (query: string, max: number) => {
      diagnostics.jobsInvoked = true;
      let rows: unknown[];
      try { rows = await deps.invokeJobs(query, max); }
      catch { jobsFailed = true; return []; }
      return compoundJobsFromRawRows(rows, max).jobs;
    },
    fetchPeopleForCompany: async (scope: import("./scopedPeopleSearch.ts").PeopleSearchScope, max: number) => {
      // Budget bound: people calls are already bounded by the verified-company count.
      if (deps.budgetProceed && !deps.budgetProceed()) { diagnostics.budgetStopped = true; return []; }
      diagnostics.peopleCalls++;
      let rows: unknown[];
      try { rows = await deps.invokePeople(buildScopedPeopleInput(scope, max), max); }
      catch { return []; } // one company's failure never aborts the whole run
      return compoundPeopleFromRows(rows, max).people;
    },
  };

  const run = await runCompoundSourcing(intent, pipelineDeps, { limits: opts.limits, vertical: opts.vertical, now: opts.now });

  if (jobsFailed) {
    return { status: "sourcing_failed", run: null, plans: [], persisted: [], error: "jobs_actor_failed", diagnostics };
  }
  if (run.diagnostics.rawJobs === 0) {
    return { status: "no_jobs", run, plans: [], persisted: [], diagnostics };
  }
  if (run.diagnostics.verifiedCompanies === 0) {
    return { status: "no_companies", run, plans: [], persisted: [], diagnostics };
  }

  // Persist each ranked candidate via the injected safe writer. No fallback.
  const plans: CompoundPersistencePlan[] = run.candidates.map((c) => buildCompoundPersistencePlan(c, opts.workspaceId ?? ""));
  const persisted: CompoundExecutionResult["persisted"] = [];
  for (const plan of plans) {
    const r = await deps.persist(plan);
    persisted.push({ ok: r.ok, accountId: r.accountId, leadCandidateId: r.leadCandidateId, reason: r.reason });
  }

  return { status: "ok", run, plans, persisted, diagnostics };
}
