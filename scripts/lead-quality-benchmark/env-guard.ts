// Hard runtime environment guard.
//
// The benchmark refuses to run against anything other than the TEST project
// (zbwsbnqqpkvdhqwavjke). It terminates BEFORE any provider request when it
// detects the production ref, an unknown project, a missing TEST workspace
// identity, missing required credentials, or unbounded Apify settings.
//
// This module is PURE: it takes credential *presence* as booleans (never the
// values) plus the resolved project ref + limits, and returns an accept/reject
// decision with human-readable blockers. The CLI wrapper (run.ts) reads the
// real environment and feeds presence booleans in — secrets never enter here.

import {
  APIFY_HARD_CAP_USD,
  type ApifyLimits,
  type BenchmarkMode,
  type Environment,
  PROD_PROJECT_REF,
  TEST_PROJECT_REF,
} from "./types.ts";

export function resolveEnvironment(projectRef: string | null): Environment {
  if (projectRef === PROD_PROJECT_REF) return "production";
  if (projectRef === TEST_PROJECT_REF) return "test";
  return "unknown";
}

export interface PreflightInput {
  mode: BenchmarkMode;
  /** Resolved Supabase project ref (NOT a secret — it is a public identifier). */
  projectRef: string | null;
  /** Presence booleans only. The guard never receives the actual values. */
  hasSupabaseUrl: boolean;
  hasSupabaseAnonKey: boolean;
  hasApifyToken: boolean;
  /** A resolved, non-empty TEST workspace id was supplied. */
  hasWorkspaceId: boolean;
  /** The bounded provider limits the run will use. */
  limits: ApifyLimits;
  /** Estimated maximum spend in USD, from the budget estimator. */
  estimatedMaxUsd: number;
}

export interface PreflightResult {
  ok: boolean;
  environment: Environment;
  /** Empty when ok. Each entry is a distinct, non-sensitive reason. */
  blockers: string[];
}

/** True when every limit is a positive, finite, bounded integer. */
export function limitsAreBounded(limits: ApifyLimits): boolean {
  const vals = [
    limits.rawMaxResults,
    limits.verifyMaxAccounts,
    limits.founderLookupMaxAccounts,
    limits.founderCandidatesPerAccount,
    limits.finalRankedMax,
  ];
  return vals.every((v) => Number.isInteger(v) && v > 0 && v <= 1000);
}

/**
 * Decide whether the benchmark may proceed. Live and dry-run both require the
 * TEST environment and bounded limits; live additionally requires every
 * credential + a workspace identity to be present. Replay is offline and only
 * requires that we are NOT pointed at production.
 */
export function assertBenchmarkPreflight(input: PreflightInput): PreflightResult {
  const environment = resolveEnvironment(input.projectRef);
  const blockers: string[] = [];

  // Production is forbidden in every mode.
  if (environment === "production") {
    blockers.push(
      "Refusing to run: resolved project is PRODUCTION. This benchmark is TEST-only.",
    );
  }

  // Replay is fully offline: as long as we are not on production, allow it.
  if (input.mode === "replay") {
    return { ok: blockers.length === 0, environment, blockers };
  }

  // dry-run + live must be pointed at TEST specifically.
  if (environment === "unknown") {
    blockers.push(
      `Refusing to run: project ref ${input.projectRef ?? "(none)"} is not the canonical TEST project.`,
    );
  } else if (environment !== "test") {
    blockers.push(`Refusing to run: environment is ${environment}, expected test.`);
  }

  if (!limitsAreBounded(input.limits)) {
    blockers.push("Refusing to run: Apify provider limits are missing or unbounded.");
  }

  if (input.estimatedMaxUsd > APIFY_HARD_CAP_USD) {
    blockers.push(
      `Refusing to run: estimated max spend $${input.estimatedMaxUsd.toFixed(2)} exceeds the $${APIFY_HARD_CAP_USD.toFixed(2)} hard cap.`,
    );
  }

  // Credentials + workspace identity are only strictly required for LIVE, which
  // actually issues provider calls. dry-run validates everything EXCEPT the
  // presence of live credentials so it can be run in any environment.
  if (input.mode === "live") {
    if (!input.hasSupabaseUrl) blockers.push("Missing required credential: TEST Supabase URL.");
    if (!input.hasSupabaseAnonKey) blockers.push("Missing required credential: TEST Supabase anon key.");
    if (!input.hasApifyToken) blockers.push("Missing required credential: Apify API token.");
    if (!input.hasWorkspaceId) blockers.push("Missing TEST workspace identity.");
  }

  return { ok: blockers.length === 0, environment, blockers };
}
