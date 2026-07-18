// Runtime adapter between the tool/provider layer and the pure decision-maker
// engine. This is the ONLY place that knows about Apify actor input shapes.
//
// It exists because the legacy call site did:
//
//     return r.ok ? normalizePeopleSearchRows(r.data) : [];
//
// which collapsed "actor disabled", "timed out" and "crashed" into the same
// empty array — so every provider failure was reported to the user as
// "no decision-makers found". The tool result already carried `unavailable` and
// `error`; they were simply discarded. This adapter preserves them.

import type { PeopleSearchPlan } from "./searchPlanner.ts";
import type { ProviderResponse, ProviderStatus } from "./pipeline.ts";

/** Minimal shape of the runTool result we depend on (mirrors ToolResultLike). */
export interface ToolResultLike {
  ok: boolean;
  data?: unknown;
  unavailable?: boolean;
  error?: string;
}

export type RunToolLike = (toolName: string, input: unknown, ctx: unknown) => Promise<ToolResultLike>;

/** Sanitized adapter result. Never carries a raw provider error string upward. */
export interface AdapterResult {
  status: ProviderStatus;
  provider_attempted: boolean;
  provider_run_id: string | null;
  profiles: unknown[];
  returned_count: number;
  error_code: string | null;
}

/**
 * Classify a raw tool error into a sanitized code. The provider's own message is
 * never propagated — it can embed URLs, tokens and account identifiers.
 */
export function classifyToolFailure(res: ToolResultLike): { status: ProviderStatus; error_code: string } {
  if (res.unavailable === true) {
    return { status: "unavailable", error_code: "people_search_disabled" };
  }
  const raw = (res.error ?? "").toLowerCase();
  if (/timeout|timed out|etimedout|deadline/.test(raw)) {
    return { status: "timed_out", error_code: "provider_timed_out" };
  }
  if (/not configured|missing token|no actor|unauthorized|forbidden|401|403/.test(raw)) {
    return { status: "unavailable", error_code: "provider_not_configured" };
  }
  return { status: "failed", error_code: "provider_failed" };
}

/** Pull a run identifier out of the tool payload without touching the rest. */
export function extractRunId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  for (const key of ["run_id", "runId", "provider_run_id", "actor_run_id"]) {
    const v = d[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Locate the profile array in a tool payload, tolerating several envelopes. */
export function extractProfiles(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  for (const key of ["items", "profiles", "results", "people", "data"]) {
    const v = d[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/**
 * Translate a canonical people-search plan into the existing
 * `source_with_apify` tool input.
 *
 * `defer_persistence` and `attach_to_accounts:false` are preserved from the
 * legacy call site: the tool must never auto-write raw people into contacts —
 * persistence is decided per candidate by decidePersistence after verification.
 */
export function planToToolInput(plan: PeopleSearchPlan): Record<string, unknown> {
  const companyUrl = plan.company_filters.company_linkedin_url ?? null;

  // The company-employees actor (harvestapi/linkedin-company-employees) reads its
  // target from `companies[]` / `user_input.companyUrl` / a `query` containing a
  // company URL — NOT from `company_linkedin_url`. Sending only the latter left
  // companies empty, so the actor scraped nothing and returned 0 rows on every
  // call while still reporting success. Supply all three shapes it accepts.
  const companyTargeting = companyUrl
    ? {
      companies: [companyUrl],
      query: companyUrl,
      user_input: { companyUrl, jobTitles: plan.title_filters, maxItems: plan.maximum_results },
    }
    : {};

  return {
    tool_name: "source_with_apify",
    selected_actor_key: plan.actor_key,
    source_type: "people_profiles",
    company_linkedin_url: companyUrl,
    domain: plan.company_filters.company_domain ?? null,
    company_name: plan.company_filters.company_name ?? null,
    role_keywords: plan.title_filters,
    seniority: plan.seniority_filters,
    locations: plan.geography_filters,
    max_results: plan.maximum_results,
    defer_persistence: true,
    attach_to_accounts: false,
    ...companyTargeting,
  };
}

/**
 * Build the provider function the pipeline calls. `runTool` is injected, so
 * tests drive this with a stub and never touch the network or a provider.
 */
export function makePeopleSearchProvider(
  runTool: RunToolLike,
  toolCtx: unknown,
): (plan: PeopleSearchPlan) => Promise<ProviderResponse> {
  return async (plan: PeopleSearchPlan): Promise<ProviderResponse> => {
    const result = await runProviderPlan(plan, runTool, toolCtx);
    return {
      status: result.status,
      profiles: result.profiles as Record<string, unknown>[],
      run_id: result.provider_run_id,
      error_code: result.error_code,
    };
  };
}

/** Execute one plan and return a sanitized, status-preserving result. */
export async function runProviderPlan(
  plan: PeopleSearchPlan,
  runTool: RunToolLike,
  toolCtx: unknown,
): Promise<AdapterResult> {
  let res: ToolResultLike;
  try {
    res = await runTool("source_with_apify", planToToolInput(plan), toolCtx);
  } catch (_e) {
    // A thrown tool is an infrastructure failure, not an empty result. The
    // exception itself is deliberately not propagated or logged verbatim.
    return {
      status: "failed",
      provider_attempted: true,
      provider_run_id: null,
      profiles: [],
      returned_count: 0,
      error_code: "provider_failed",
    };
  }

  if (!res || res.ok !== true) {
    const { status, error_code } = classifyToolFailure(res ?? { ok: false });
    return {
      status,
      provider_attempted: true,
      provider_run_id: extractRunId(res?.data),
      profiles: [],
      returned_count: 0,
      error_code,
    };
  }

  const profiles = extractProfiles(res.data);
  return {
    status: "ok",
    provider_attempted: true,
    provider_run_id: extractRunId(res.data),
    profiles,
    returned_count: profiles.length,
    error_code: null,
  };
}
