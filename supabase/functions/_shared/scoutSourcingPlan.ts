// Composition layer that wires the tested query/intent/tier modules into the
// live Scout sourcing path (Parts 3/5). Pure / import-free (except the sibling
// pure modules) so run-agent's change stays thin and this stays fully testable.

import {
  extractLeadSearchIntent, leadSearchIntentFromMission,
  type BrainForIntent, type LeadSearchIntent, type MissionForSearchIntent,
} from "./leadSearchIntent.ts";
import { buildProviderQueries, type ProviderQuery } from "./leadProviderQueryBuilder.ts";
import { classifyLeadTier, summarizeShortage, type CandidateForTier, type TierResult } from "./leadMatchTier.ts";

export interface ScoutQueryPlan {
  intent: LeadSearchIntent;
  provider_queries: ProviderQuery[];
  primary: { keywords: string; location: string };
  locations: string[];
}

/** Map the loaded Company Brain (profile.icp + fields) into the intent parser's shape. */
export function brainToIntent(brain: unknown): BrainForIntent | null {
  const b = (brain && typeof brain === "object") ? brain as Record<string, any> : null;
  if (!b) return null;
  const icp = (b.icp && typeof b.icp === "object") ? b.icp as Record<string, any> : b;
  const arr = (v: unknown): string[] | undefined => Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : undefined;
  return {
    industries: arr(icp.industries) ?? arr(icp.target_industries),
    disqualifiers: arr(icp.disqualifiers),
    excluded_industries: arr(icp.avoided_industries) ?? arr(icp.excluded_industries),
    geography: icp.geography ?? icp.target_geography ?? undefined,
    company_size: typeof icp.company_size === "string" ? icp.company_size : undefined,
    buyer_roles: arr(icp.buyer_roles) ?? arr(icp.target_buyers),
  };
}

/**
 * Plan structured Scout queries for a jobs search. Returns null for a too-vague
 * request (no category AND no role) so the legacy keyword builder keeps handling
 * generic searches unchanged. Never a mega keyword string; never an ambiguous
 * "US + EU" location.
 */
export function planScoutQueries(opts: {
  instruction: string;
  brain?: unknown;
  /**
   * The canonical Mission for this request, when the task carries one.
   *
   * With it, the search intent is PROJECTED from decided fields. Without it —
   * a missionless legacy task — the instruction is parsed, which is the only
   * reading available there. The plan's output overwrites the jobs actor's
   * query and location and feeds the lead tiering, so this is the difference
   * between the Mission deciding what gets searched and a regex deciding it.
   */
  mission?: MissionForSearchIntent | null;
}): ScoutQueryPlan | null {
  const intent = opts.mission
    ? leadSearchIntentFromMission(opts.mission, brainToIntent(opts.brain))
    : extractLeadSearchIntent({ message: opts.instruction ?? "", brain: brainToIntent(opts.brain) });
  if (intent.must_have_categories.length === 0 && intent.role_terms.length === 0) return null; // legacy path
  const provider_queries = buildProviderQueries(intent);
  if (provider_queries.length === 0) return null;
  return {
    intent,
    provider_queries,
    primary: { keywords: provider_queries[0].keywords, location: provider_queries[0].location },
    locations: [...new Set(provider_queries.map((q) => q.location))],
  };
}

/** Per-attempt query/location — rotate through the structured queries so the
 *  adaptive loop covers strict → relaxed tiers and every split location. */
export function attemptQuery(plan: ScoutQueryPlan, attemptIndex: number): ProviderQuery {
  const q = plan.provider_queries[Math.max(0, attemptIndex) % plan.provider_queries.length];
  return q;
}

export interface TierCounters {
  requested_count: number;
  raw_results_reviewed: number;
  accepted_count: number;
  strict_matches: number;
  secondary_matches: number;
  rejected_count: number;
  relaxation_steps_used: string[];
  reason_not_filled?: string;
}

export interface AcceptedItemLite { raw?: Record<string, any> | null; company?: string | null; source_url?: string | null; title?: string | null }

function toCandidate(it: AcceptedItemLite): CandidateForTier {
  const raw = (it.raw && typeof it.raw === "object") ? it.raw : {};
  return {
    company: it.company ?? raw.company_name ?? null,
    industries: Array.isArray(raw.industries) ? raw.industries : null,
    company_description: raw.company_description ?? null,
    job_title: it.title ?? raw.job_title ?? null,
    job_description: raw.job_description ?? null,
    source_url: it.source_url ?? raw.source_url ?? raw.job_url ?? null,
    funding_proof_url: raw.funding_source_url ?? raw.funding_proof_url ?? null,
    employee_count: typeof raw.employee_count === "number" ? raw.employee_count : null,
  };
}

/**
 * Label the (gate-accepted) leads with match tiers + the funding contract, and
 * compute transparent counters + an honest shortage summary. Additive: it labels
 * and reports; it does not overturn the proof gate's accept/reject decision.
 */
export function tierAndCount(acceptedItems: AcceptedItemLite[], reviewedCount: number, intent: LeadSearchIntent): {
  labels: TierResult[]; counters: TierCounters; summary: string;
} {
  const labels = (acceptedItems ?? []).map((it) => classifyLeadTier(toCandidate(it), intent));
  const strict_matches = labels.filter((l) => l.match_tier === "strict").length;
  const secondary_matches = labels.filter((l) => l.match_tier === "secondary").length;
  const accepted_count = strict_matches + secondary_matches;
  const relax = new Set<string>();
  for (const l of labels) for (const r of l.relaxations) relax.add(r);
  const rejected_count = Math.max(0, reviewedCount - accepted_count);

  const counters: TierCounters = {
    requested_count: intent.requested_count,
    raw_results_reviewed: reviewedCount,
    accepted_count,
    strict_matches,
    secondary_matches,
    rejected_count,
    relaxation_steps_used: [...relax],
  };
  if (accepted_count < intent.requested_count) {
    counters.reason_not_filled = `Found ${accepted_count} qualified lead${accepted_count === 1 ? "" : "s"} out of ${reviewedCount} reviewed. I did not fill the remaining ${intent.requested_count - accepted_count} because the rest were off-ICP (non-SaaS / disqualified industries) or lacked proof.`;
  }
  const summary = summarizeShortage({
    ...counters, accepted: [], // summarizeShortage only reads counter fields
  } as unknown as Parameters<typeof summarizeShortage>[0]);
  return { labels, counters, summary };
}
