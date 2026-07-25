// LIVE runner — bounded TEST invocation of the real Agentory pipeline.
//
// The live path invokes the REAL run-agent Edge Function on the TEST project as
// the sourcing pipeline entrypoint, captures the raw provider output + Agentory's
// own results, and NEVER invokes any outreach action. It is written with injected
// dependencies (invokeRunAgent) so it is fully testable offline and so it can
// never accidentally reach production or a provider during dry-run/replay.
//
// It DOES NOT run in this environment: the env guard blocks it whenever TEST
// credentials/workspace are absent (see env-guard.ts). That is by design — a
// paid live run must be an explicit, credentialed, one-time operation.

import { TEST_PROJECT_REF } from "./types.ts";
import type { AgentoryOutput, ApifyLimits, RawCandidate } from "./types.ts";

/**
 * The ONLY lead actions this benchmark is allowed to trigger. Sourcing +
 * decision-maker lookup + company research. Outreach of every kind is excluded.
 */
export const ALLOWED_LEAD_ACTIONS = new Set<string>([
  "source_with_apify",
  "find_decision_makers",
  "research_company",
]);

/** Actions the benchmark must NEVER trigger. */
export const FORBIDDEN_LEAD_ACTIONS = new Set<string>([
  "generate_outreach",
  "regenerate_outreach",
  "approve_outreach",
  "send_outreach",
  "send_email",
  "send_linkedin",
  "start_campaign",
  "power_dialer",
  "make_call",
]);

export function assertActionAllowed(action: string): void {
  if (FORBIDDEN_LEAD_ACTIONS.has(action)) {
    throw new Error(`Refusing forbidden action '${action}': the benchmark never performs outreach.`);
  }
  if (!ALLOWED_LEAD_ACTIONS.has(action)) {
    throw new Error(`Refusing unknown action '${action}': not in the benchmark allow-list.`);
  }
}

/**
 * Build the run-agent endpoint for the TEST project ONLY. Refuses any ref other
 * than the canonical TEST ref, so the live path can never contact production.
 */
export function buildRunAgentEndpoint(projectRef: string): string {
  if (projectRef !== TEST_PROJECT_REF) {
    throw new Error(`Refusing to build an endpoint for '${projectRef}': TEST project only.`);
  }
  return `https://${projectRef}.supabase.co/functions/v1/run-agent`;
}

/** Keep only rows belonging to the run's workspace (multi-tenant safety). */
export function filterRowsToWorkspace<T extends { workspace_id?: string | null }>(rows: T[], workspaceId: string): T[] {
  return rows.filter((r) => r.workspace_id === workspaceId);
}

// ------------------------------------------------------------ live orchestration

export interface RunAgentInvocation {
  action: string;
  workspaceId: string;
  toolInput: Record<string, unknown>;
}

export interface RunAgentResponse {
  rawCandidates: RawCandidate[];
  agentoryByCandidateId: Record<string, AgentoryOutput>;
  actorRunIds: string[];
  reportedSpendUsd: number;
  modelCallCount: number;
}

export interface LiveRunnerDeps {
  projectRef: string;
  workspaceId: string;
  limits: ApifyLimits;
  /** Injected transport to the TEST run-agent function. */
  invokeRunAgent: (inv: RunAgentInvocation) => Promise<RunAgentResponse>;
  /** Live spend probe, used to enforce the soft/hard caps between calls. */
  onSpend?: (usd: number) => void;
}

/**
 * Execute the bounded sourcing action against TEST. Validates the action is
 * allowed and the endpoint is TEST-only BEFORE any transport call.
 */
export async function runLiveSourcing(deps: LiveRunnerDeps): Promise<RunAgentResponse> {
  assertActionAllowed("source_with_apify");
  // Constructing the endpoint doubles as a TEST-only assertion.
  buildRunAgentEndpoint(deps.projectRef);

  const inv: RunAgentInvocation = {
    action: "source_with_apify",
    workspaceId: deps.workspaceId,
    toolInput: {
      query_intent: "founders_saas_hiring_sales_ops_us",
      max_results: deps.limits.rawMaxResults,
      max_accounts_verified: deps.limits.verifyMaxAccounts,
      max_founder_lookups: deps.limits.founderLookupMaxAccounts,
      max_founder_candidates_per_account: deps.limits.founderCandidatesPerAccount,
      benchmark: true,
    },
  };
  const res = await deps.invokeRunAgent(inv);
  deps.onSpend?.(res.reportedSpendUsd);
  // Never trust cross-tenant rows.
  const scoped = filterRowsToWorkspace(
    res.rawCandidates.map((c) => ({ ...c, workspace_id: deps.workspaceId })),
    deps.workspaceId,
  );
  return { ...res, rawCandidates: scoped as unknown as RawCandidate[] };
}
