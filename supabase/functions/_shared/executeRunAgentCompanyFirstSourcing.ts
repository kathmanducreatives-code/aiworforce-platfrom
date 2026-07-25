// Runtime entry helper: adapts run-agent's real context to the tested compound
// execution composer for a COMPANY-FIRST request. Kept small + dependency-injected
// so the whole company-first runtime path is unit-testable with mocked runTool /
// database / persistence / clock, and so run-agent's handler stays thin.
//
// The real run-agent branch passes real closures over runTool + writeContactWith-
// VerifiedAccount; tests pass mocks. No provider/network import lives here.

import type { LeadEntityIntent } from "./leadEntityIntent.ts";
import { runAgentCompoundExecution, type CompoundExecutionDeps } from "./runAgentCompoundExecution.ts";
import type { CompoundLimits } from "./compoundSourcingPipeline.ts";
import type { Vertical } from "./verticalQualification.ts";
import { writeBoundaryHolds, type CompanyFirstWriteBoundary } from "./providerEvidenceMode.ts";

export type CompanyFirstStatus =
  | "completed" | "no_qualified_companies" | "partial" | "sourcing_failed"
  | "persistence_failed" | "unable_to_compile_job_search";

export interface CompanyFirstRuntimeDeps extends CompoundExecutionDeps {
  intent: LeadEntityIntent;
  workspaceId: string;
  planId?: string | null;
  taskId?: string | null;
  limits?: Partial<CompoundLimits>;
  vertical?: Vertical;
  now?: string;
  log?: (msg: string, meta?: unknown) => void;
}

export interface CompanyFirstResult {
  status: CompanyFirstStatus;
  /** The path ACTUALLY executed — for observability + result metadata. */
  executed_sourcing_mode: "company_first";
  counts: { rawJobs: number; verifiedCompanies: number; candidates: number; contact: number; watch: number; needsReview: number; reject: number; persisted: number };
  /** Safe per-lead summaries (no secrets, no raw provider dumps). */
  items: Array<{ company: string | null; person: string | null; verdict: string; accountId: string | null; leadCandidateId: string | null; jobUrl: string | null; whyNow: string | null; blockReasons: string[]; persisted: boolean }>;
  routing: {
    execution_mode: "company_first"; company_first: true; requested_person_role: string | null;
    /** Compiled provider plan + the ORIGINAL sentence, kept apart on purpose. */
    job_search_spec: { keyword_queries: string[]; location: string | null; company_vertical: string | null; compilation_status: string };
    original_user_query: string;
  };
  diagnostics: {
    jobsInvoked: boolean; peopleCalls: number; budgetStopped: boolean;
    jobVariants: Array<{ keyword: string; location: string | null; max_results: number; error?: string }>;
  };
  /** provider_side_writes MUST be 0; anything else is an invariant violation. */
  writeBoundary: CompanyFirstWriteBoundary;
  error?: string;
}

export async function executeRunAgentCompanyFirstSourcing(deps: CompanyFirstRuntimeDeps): Promise<CompanyFirstResult> {
  const log = deps.log ?? (() => {});
  const execDeps: CompoundExecutionDeps = {
    invokeJobs: deps.invokeJobs, invokePeople: deps.invokePeople, persist: deps.persist, budgetProceed: deps.budgetProceed,
  };
  const exec = await runAgentCompoundExecution(deps.intent, execDeps, {
    limits: deps.limits, vertical: deps.vertical, now: deps.now, workspaceId: deps.workspaceId,
  });
  log("compound execution finished", { status: exec.status, diagnostics: exec.diagnostics });

  let status: CompanyFirstStatus;
  if (exec.status === "unable_to_compile_job_search") status = "unable_to_compile_job_search";
  else if (exec.status === "sourcing_failed") status = "sourcing_failed";
  else if (exec.status === "no_jobs" || exec.status === "no_companies") status = "no_qualified_companies";
  else {
    const persistedOk = exec.persisted.filter((p) => p.ok).length;
    if (exec.persisted.length > 0 && persistedOk === 0) status = "persistence_failed";
    else if (persistedOk < exec.persisted.length) status = "partial";
    else status = "completed";
  }

  const candidates = exec.run?.candidates ?? [];
  const countVerdict = (v: string) => candidates.filter((c) => c.verdict === v).length;
  const items = candidates.map((c, i) => {
    const plan = exec.plans[i];
    const p = exec.persisted[i];
    return {
      company: c.account.name, person: c.person.name, verdict: c.verdict,
      accountId: p?.accountId ?? null, leadCandidateId: p?.leadCandidateId ?? null,
      jobUrl: c.jobEvidence.url, whyNow: c.verdict === "CONTACT" ? c.whyNow : null,
      blockReasons: plan?.blockReasons ?? [], persisted: !!p?.ok,
    };
  });

  return {
    status,
    executed_sourcing_mode: "company_first",
    counts: {
      rawJobs: exec.run?.diagnostics.rawJobs ?? 0,
      verifiedCompanies: exec.run?.diagnostics.verifiedCompanies ?? 0,
      candidates: candidates.length,
      contact: countVerdict("CONTACT"), watch: countVerdict("WATCH"), needsReview: countVerdict("NEEDS_REVIEW"), reject: countVerdict("REJECT"),
      persisted: exec.persisted.filter((p) => p.ok).length,
    },
    items,
    routing: {
      execution_mode: "company_first", company_first: true,
      requested_person_role: deps.intent.requested_person_role,
      job_search_spec: {
        keyword_queries: deps.intent.job_search_spec.keyword_queries,
        location: deps.intent.job_search_spec.location,
        company_vertical: deps.intent.job_search_spec.company_vertical,
        compilation_status: deps.intent.job_search_spec.compilation_status,
      },
      // Provenance only — this string is never a provider keyword.
      original_user_query: deps.intent.job_search_spec.original_query,
    },
    diagnostics: exec.diagnostics,
    writeBoundary: exec.writeBoundary,
    // An honest failure beats claiming clean persistence.
    error: exec.error ?? (writeBoundaryHolds(exec.writeBoundary) ? undefined : exec.writeBoundary.invariantViolation ?? undefined),
  };
}
