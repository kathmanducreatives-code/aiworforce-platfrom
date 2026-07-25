// JOBS PROVIDER INPUT BUILDER — turns a CompiledJobSearchSpec into the exact
// input the `apify_jobs` actor supports, and nothing else.
//
// The actor's input_adapter (toolRegistry) resolves keywords as
//   user_input.keywords -> role_keywords.join(" ") -> query
// so we pass `query` (the canonical schema field, see actorInputSchemas.apify_jobs)
// plus an explicit `location`. One variant = one bounded search.
//
// Cost invariant: variants SHARE one raw-result ceiling. Three variants never cost
// three times a single search.

import { findRawQueryLeak, type CompiledJobSearchSpec } from "./jobSearchSpec.ts";

export interface JobsProviderVariantInput {
  /** Role-focused keyword string — the ONLY thing the provider searches on. */
  query: string;
  location: string | null;
  max_results: number;
  /** Provenance so a provider error names the variant that failed. */
  _variant_index: number;
  _variant_keyword: string;
}

export class JobSearchCompilationError extends Error {
  readonly code = "unable_to_compile_job_search";
  constructor(readonly reason: string) {
    super(`unable_to_compile_job_search:${reason}`);
    this.name = "JobSearchCompilationError";
  }
}

/** The provider must never be called for an uncompiled compound request. */
export function assertCompiledForProvider(spec: CompiledJobSearchSpec | null | undefined): CompiledJobSearchSpec {
  if (!spec) throw new JobSearchCompilationError("missing_job_search_spec");
  if (spec.compilation_status !== "compiled") {
    throw new JobSearchCompilationError(spec.insufficient_reason ?? spec.compilation_status);
  }
  if (!spec.keyword_queries.length) throw new JobSearchCompilationError("no_keyword_queries");
  const leak = findRawQueryLeak(spec);
  if (leak) throw new JobSearchCompilationError("raw_query_leak");
  return spec;
}

/**
 * Allocate ONE shared raw-result ceiling across the compiled keyword variants.
 * 25 across 3 variants → 9 / 8 / 8, never 25 / 25 / 25.
 */
export function buildJobsProviderInputs(
  spec: CompiledJobSearchSpec,
  totalMaxResults: number,
): JobsProviderVariantInput[] {
  const compiled = assertCompiledForProvider(spec);
  const total = Math.max(0, Math.floor(totalMaxResults));
  if (total === 0) return [];

  const keywords = compiled.keyword_queries.slice(0, Math.max(1, Math.min(compiled.keyword_queries.length, total)));
  const n = keywords.length;
  const base = Math.floor(total / n);
  let remainder = total % n;

  return keywords.map((kw, i) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return {
      query: kw,
      location: compiled.location,
      max_results: base + extra,
      _variant_index: i,
      _variant_keyword: kw,
    };
  });
}

/** Total planned provider results — must never exceed the shared ceiling. */
export function plannedResultTotal(inputs: JobsProviderVariantInput[]): number {
  return inputs.reduce((sum, i) => sum + i.max_results, 0);
}
