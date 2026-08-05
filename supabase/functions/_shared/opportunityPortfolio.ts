// A PORTFOLIO IS NOT A PILE OF LEADS.
//
// "Find 100 leads" used to mean "return 100 contact-ready leads", so a run that
// found 18 genuinely hot companies and 40 plausible ones reported failure and
// delivered almost nothing. The number the user asks for and the number of
// people you can email today are different quantities, and collapsing them makes
// both useless.
//
// Two targets, always separate:
//
//   requested_opportunity_count    ranked Workbench opportunities, 1-100.
//                                  Tier A, B and C all count.
//   requested_contact_ready_count  fully qualified, decision-maker-ready leads.
//                                  Best effort unless explicitly demanded.
//
// THE PORTFOLIO IS FILLED IN TIER ORDER, and never with filler. A shortfall is
// reported honestly — 73 delivered against 100 requested, with the reason —
// because padding the count with companies that fail the quality floor is how a
// list becomes generic and the user stops trusting any of it.
//
// PURE. No network, no provider, no database.

import type { SignalTier } from "./commercialSignalPolicy.ts";

export const PORTFOLIO_VERSION = "opportunity-portfolio-v1" as const;

export const MAX_OPPORTUNITY_COUNT = 100;

// --------------------------------------------------------------- targets ----

export interface PortfolioTargets {
  /** Ranked opportunities requested. Always present, clamped to 1-100. */
  requested_opportunity_count: number;
  /** Contact-ready leads requested. Null when the user did not ask. */
  requested_contact_ready_count: number | null;
  /**
   * The legacy field, preserved verbatim.
   *
   * Existing callers and persisted rows still carry `requested_lead_count`, and
   * changing what it means underneath them would silently rewrite the contract
   * of every stored run. It is normalized INTO the two fields above, never
   * replaced by them.
   */
  requested_lead_count: number;
  /** How the two targets were derived, for audit. */
  interpretation: "explicit_both" | "qualified_means_contact_ready" | "opportunities_only" | "legacy_lead_count";
}

const clamp = (n: number) => Math.max(1, Math.min(MAX_OPPORTUNITY_COUNT, Math.trunc(n)));

/**
 * Read the two targets out of the user's own sentence.
 *
 * "Find 100 leads"                       → 100 opportunities, contact-ready unspecified
 * "Find 100 qualified leads"             → 100 opportunities, 100 contact-ready
 * "Find 100 opportunities with at least
 *  20 contact-ready founders"            → 100 opportunities, 20 contact-ready
 */
export function interpretTargets(
  query: string, legacyLeadCount: number,
): PortfolioTargets {
  const q = String(query ?? "").toLowerCase();
  const legacy = clamp(legacyLeadCount || 5);

  // An explicit secondary number: "with at least 20 contact-ready founders".
  const secondary = q.match(
    /(?:at least|minimum of|min)\s+(\d{1,3})\s*(?:contact[- ]ready|qualified|verified)?/);
  // ADJECTIVES SIT BETWEEN THE NUMBER AND THE NOUN. "100 qualified leads" and
  // "100 US B2B SaaS companies" both name a hundred of something; a pattern that
  // demanded the noun immediately after the digits read neither, and silently
  // fell back to the legacy count of 5.
  const primary = q.match(
    /(\d{1,3})\s+(?:[a-z0-9/&+.-]+\s+){0,5}?(?:companies|opportunities|leads|results|accounts|prospects)/);

  const opportunities = primary ? clamp(Number(primary[1])) : legacy;

  if (secondary) {
    return {
      requested_opportunity_count: opportunities,
      requested_contact_ready_count: clamp(Number(secondary[1])),
      requested_lead_count: legacy,
      interpretation: "explicit_both",
    };
  }
  // "QUALIFIED leads" is a demand for qualification, not just volume.
  if (/\bqualified\b|\bcontact[- ]ready\b/.test(q)) {
    return {
      requested_opportunity_count: opportunities,
      requested_contact_ready_count: opportunities,
      requested_lead_count: legacy,
      interpretation: "qualified_means_contact_ready",
    };
  }
  if (primary) {
    return {
      requested_opportunity_count: opportunities,
      requested_contact_ready_count: null,
      requested_lead_count: legacy,
      interpretation: "opportunities_only",
    };
  }
  return {
    requested_opportunity_count: legacy,
    requested_contact_ready_count: null,
    requested_lead_count: legacy,
    interpretation: "legacy_lead_count",
  };
}

// ---------------------------------------------------------- quality floor ----

export interface PortfolioCandidate {
  company_key: string;
  company_name: string;
  domain: string | null;
  tier: SignalTier | null;
  /** An explicit Company Brain outcome, when one exists. */
  brain: "qualified" | "review" | "reject" | null;
  identity_status: "verified_match" | "unresolved" | "rejected_mismatch";
  active: boolean;
  geography_ok: boolean;
  b2b_use_case: boolean;
  has_factual_signal: boolean;
  source_evidence: boolean;
  source_url: string | null;
  contact_ready: boolean;
  /** Which broadening round produced it. */
  round: number | null;
  score: number;
}

export type FloorFailure =
  | "duplicate" | "inactive" | "consumer_only" | "wrong_geography"
  | "identity_mismatch" | "no_factual_signal" | "no_source_evidence"
  | "brain_reject" | "no_tier";

/**
 * Does this candidate deserve a place in the portfolio?
 *
 * A Tier C company may carry an UNRESOLVED LinkedIn identity — its source
 * identity and domain can still be credible. It may NOT carry a REJECTED
 * mismatch, because that is a positive finding that the identity is wrong.
 */
export function floorFailure(c: PortfolioCandidate): FloorFailure | null {
  if (!c.active) return "inactive";
  if (c.identity_status === "rejected_mismatch") return "identity_mismatch";
  if (!c.geography_ok) return "wrong_geography";
  if (!c.b2b_use_case) return "consumer_only";
  if (!c.has_factual_signal) return "no_factual_signal";
  if (!c.source_evidence) return "no_source_evidence";
  if (c.brain === "reject") return "brain_reject";
  if (c.tier === null) return "no_tier";
  return null;
}

// -------------------------------------------------------------- the build ----

export type OpportunityState =
  | "qualified" | "review" | "identity_unresolved_watch" | "watch";

export interface PortfolioEntry extends PortfolioCandidate {
  rank: number;
  state: OpportunityState;
  /** Never true for anything below an explicit Brain pass. */
  actionable: boolean;
  reason: string;
}

export interface PortfolioResult {
  version: typeof PORTFOLIO_VERSION;
  targets: PortfolioTargets;
  entries: PortfolioEntry[];
  counts: {
    delivered: number;
    tier_a: number; tier_b: number; tier_c: number;
    qualified: number; review: number; watch: number;
    contact_ready: number;
    rejected_by_floor: number;
  };
  shortfall: {
    opportunities: number;
    opportunity_reason: string | null;
    contact_ready: number;
    contact_ready_reason: string | null;
  };
  excluded: Array<{ company_key: string; company_name: string; failure: FloorFailure }>;
}

const TIER_RANK: Record<SignalTier, number> = { A: 0, B: 1, C: 2 };

function stateFor(c: PortfolioCandidate): OpportunityState {
  if (c.brain === "qualified") return "qualified";
  if (c.identity_status === "unresolved") return "identity_unresolved_watch";
  if (c.brain === "review") return "review";
  return c.tier === "C" ? "watch" : "review";
}

/**
 * Fill the portfolio: every genuine Tier A first, then Tier B, then Tier C.
 *
 * Deduplicated by `company_key` across every round and provider. Nothing that
 * fails the quality floor is admitted, whatever the shortfall — a number met
 * with filler is a worse answer than an honest gap.
 */
export function buildPortfolio(
  candidates: readonly PortfolioCandidate[],
  targets: PortfolioTargets,
  opts: { sourcesExhausted?: boolean } = {},
): PortfolioResult {
  const excluded: PortfolioResult["excluded"] = [];
  const seen = new Set<string>();
  const eligible: PortfolioCandidate[] = [];

  for (const c of candidates) {
    if (seen.has(c.company_key)) {
      excluded.push({ company_key: c.company_key, company_name: c.company_name, failure: "duplicate" });
      continue;
    }
    seen.add(c.company_key);
    const fail = floorFailure(c);
    if (fail) {
      excluded.push({ company_key: c.company_key, company_name: c.company_name, failure: fail });
      continue;
    }
    eligible.push(c);
  }

  eligible.sort((a, b) =>
    TIER_RANK[a.tier as SignalTier] - TIER_RANK[b.tier as SignalTier] ||
    (b.brain === "qualified" ? 1 : 0) - (a.brain === "qualified" ? 1 : 0) ||
    b.score - a.score ||
    a.company_name.localeCompare(b.company_name));

  const entries: PortfolioEntry[] = eligible
    .slice(0, targets.requested_opportunity_count)
    .map((c, i) => {
      const state = stateFor(c);
      return {
        ...c, rank: i + 1, state,
        // ACTIONABLE MEANS AN EXPLICIT BRAIN PASS AND A VERIFIED IDENTITY.
        // Nothing else may enter people discovery.
        actionable: state === "qualified" && c.identity_status === "verified_match",
        reason: state === "qualified"
          ? "Passed the Company Brain with a verified identity."
          : state === "identity_unresolved_watch"
          ? "Credible company and signal, but the LinkedIn identity is unresolved."
          : state === "review"
          ? "Likely fit; one or more non-critical facts are still unknown."
          : "Relevant signal, held for review.",
      };
    });

  const counts = {
    delivered: entries.length,
    tier_a: entries.filter((e) => e.tier === "A").length,
    tier_b: entries.filter((e) => e.tier === "B").length,
    tier_c: entries.filter((e) => e.tier === "C").length,
    qualified: entries.filter((e) => e.state === "qualified").length,
    review: entries.filter((e) => e.state === "review").length,
    watch: entries.filter((e) => e.state === "watch" || e.state === "identity_unresolved_watch").length,
    contact_ready: entries.filter((e) => e.contact_ready && e.actionable).length,
    rejected_by_floor: excluded.length,
  };

  const oppShort = Math.max(0, targets.requested_opportunity_count - counts.delivered);
  const crTarget = targets.requested_contact_ready_count;
  const crShort = crTarget == null ? 0 : Math.max(0, crTarget - counts.contact_ready);

  return {
    version: PORTFOLIO_VERSION,
    targets, entries, counts,
    shortfall: {
      opportunities: oppShort,
      opportunity_reason: oppShort === 0 ? null
        : opts.sourcesExhausted
        ? `only ${counts.delivered} companies met the quality floor after all allowed rounds; sources exhausted`
        : `only ${counts.delivered} companies met the quality floor so far`,
      contact_ready: crShort,
      contact_ready_reason: crShort === 0 ? null
        : `${counts.contact_ready} of ${crTarget} reached contact-ready; the rest lack an explicit Company Brain pass or a verified decision-maker`,
    },
    excluded,
  };
}

/**
 * Which companies may consume paid people-search budget?
 *
 * Tier A and B AFTER an explicit Brain pass. Tier C never — spending
 * people-search budget on a watch item is exactly the waste the tiers exist to
 * prevent.
 */
export function founderSearchEligible(p: PortfolioResult): PortfolioEntry[] {
  return p.entries.filter((e) => e.actionable && e.tier !== "C");
}
