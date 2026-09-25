// LEAD V2 — THE CANONICAL CLAIM REGISTRY AND THE EVIDENCE-GAP ROUTER.
//
// "Discovery finds companies. Verification proves claims. Evidence gaps choose
// the next route." (AGENTORY_EVIDENCE_FIRST_RESEARCH_VERIFICATION_PLAN §1)
//
// ── THE REGISTRY ────────────────────────────────────────────────────────────
//
// One record per canonical claim: which mission-criterion dimensions it
// answers, which evidence dimensions carry it, how long that evidence stays
// fresh, and which provider routes can VERIFY it for a company already in the
// pool. Support / contradiction semantics live where they always have — in
// `candidateEligibility` — and are not restated here; readiness lives in Actor
// Intelligence and is READ, never copied.
//
// ── THE ROUTER ──────────────────────────────────────────────────────────────
//
// For every PENDING candidate, each hard check still `unknown` is a gap. The
// router names the next route that could close it, or says why nothing can:
//
//   verify    a route is READY in Actor Intelligence, has not already answered
//             this company, AND the engine turns its result into a new
//             canonical decision for a pending claim (`canonical_executor`)
//   blocked   every route is not READY, already tried, or has no canonical
//             executor yet — recorded as a capability gap, never guessed past
//
// `canonical_executor` is the honest part: a route counts only when the engine
// turns its result into a new canonical decision. Firecrawl earned that flag in
// Phase C (`webEvidenceRegrounding`); the funding and team routes have not, so
// their gaps are still BLOCKED and continuation, which reads
// `with_executable_route`, will not pretend a verification slice could close
// them. Each P6–P9 route plugs in here: register it, prove its executor, and
// the same gate starts routing to it.
//
// `tried` keeps a route from being chosen twice for the same company: once the
// first-party pages are in the registry, re-buying them would return the same
// text, so a claim still pending AFTER the re-grounding is blocked — honestly,
// because no new evidence is available, not because nothing was tried.
//
// Pure. No provider, model or database.

import { PRODUCTION_READINESS, type ReadinessPolicy, type RouteReadinessDecision } from "./routeReadiness.ts";
import { EVIDENCE_VALIDITY_DAYS, type EvidenceDimension } from "./candidateObservation.ts";
import type { CompanyEvidenceGraph } from "./evidenceGraph.ts";

export const EVIDENCE_GAP_ROUTER_VERSION = "evidence-gap-router-v1" as const;

export interface ClaimRoute {
  /** Actor Intelligence key. */
  actor: string;
  capability: string;
  /** What the route reads, in words. */
  purpose: string;
  /** `source.actor` values on evidence this route produces — how "already answered" is known. */
  evidence_actors: readonly string[];
  /** The engine turns this route's result into a new canonical decision for a PENDING claim. */
  canonical_executor: boolean;
  executor_note: string;
  /**
   * A route that exists only as a FALLBACK: executable only once this actor has
   * answered for the company (an operation mark, or evidence it produced).
   */
  after_actor?: string;
  /**
   * Expected spend to answer ONE company through this route, from the actor
   * card(s). Among executable routes the cheapest is taken first (§23: "cheap
   * deterministic evidence before expensive routes").
   */
  cost_hint_usd: number;
}

export interface ClaimDefinition {
  claim: string;
  /** The mission-criterion dimensions this claim answers. */
  criterion_dimensions: readonly string[];
  evidence: readonly EvidenceDimension[];
  /** Days a proof stays fresh; null when it does not expire. */
  freshness_days: number | null;
  routes: readonly ClaimRoute[];
  /** The phase that delivers a verification route, when none exists yet. */
  deferred_to?: "P6" | "P7" | "P8" | "P9";
}

const LINKEDIN_DETAILS: ClaimRoute = {
  actor: "apify_linkedin_company_details", capability: "company_enrichment",
  purpose: "the company's LinkedIn record (locations, declared size band, description)",
  evidence_actors: ["linkedin", "apify_linkedin_company_details"],
  canonical_executor: true, executor_note: "in-slice enrichment of every investigated company",
  cost_hint_usd: 0.004,
};
const FIRST_PARTY_PAGES: ClaimRoute = {
  actor: "firecrawl", capability: "web_evidence",
  purpose: "the company's product, pricing and customers pages",
  evidence_actors: ["firecrawl", "firecrawl_scrape", "company_website"],
  // PHASE C: the pages now resolve the claim. `webEvidenceRegrounding` rebuilds
  // the registry with them, re-runs the grounder and re-decides the canonical
  // business model, so a route chosen here can actually close the gap.
  canonical_executor: true,
  executor_note: "first-party pages are re-grounded into the canonical business-model claim",
  // Three /scrape pages at the budgeting rate, plus a grounding call.
  cost_hint_usd: 0.0192,
};
const freshness = (d: EvidenceDimension): number | null => EVIDENCE_VALIDITY_DAYS[d] ?? null;

/**
 * THE FUNDING PAIR — ONE ROUTE, TWO PROVIDERS, NEITHER SUFFICIENT ALONE.
 *
 * Live pair probe, 2026-09-21 (Wordware, preserved in
 * `docs/audits/live-validation-2026-09-21/`):
 *
 *   atomus   3 dated rounds and `num_funding_rounds: 3` — COMPLETENESS, and
 *            not one source URL
 *   pvalyou  the same Seed round with 4 cited announcements — PROVENANCE, and
 *            a round count that is only what it holds
 *
 *   atomus alone  → PENDING (`required_stage_uncorroborated`)
 *   pvalyou alone → PENDING (`history_incomplete`)
 *   the pair      → PASS (complete history, latest verified round is Seed, cited)
 *
 * So the route names atomus and carries pvalyou beside it: the verifier calls
 * atomus first and buys pvalyou only when atomus cannot settle the claim alone
 * (`fundingStageVerifier`). Readiness decides whether it may run at all, which
 * is why promoting ONE of the two can never make this route answer — the
 * decision requires a citation, and only pvalyou or a discovered round has one.
 *
 * It answers two claims: the STAGE ("is it still Seed?") and RECENCY ("has it
 * raised lately?"), for a company we hold no rounds for. One we already have
 * rounds for is decided from those rounds and bought again for neither.
 */
const FUNDING_PAIR_ROUTE: ClaimRoute = {
  actor: "apify_funding_atomus", capability: "funding_verification",
  purpose: "the company's funding rounds, corroborated by cited announcements",
  evidence_actors: ["apify_funding_atomus", "apify_funding_pvalyou", "funding_corroboration"],
  canonical_executor: true,
  executor_note: "atomus completeness + pvalyou citations decide the funding claims (fundingStageVerifier)",
  // atomus always; pvalyou only when atomus cannot settle it alone.
  cost_hint_usd: 0.0235,
};

/**
 * THE CONDITIONAL PVALYOU RECENCY FALLBACK, as a route the router can see.
 *
 * Inside one funding-verifier call Atomus and the fallback happen together, so
 * the router never needed to know about it. The funding SCREEN reads Atomus for
 * a whole pool before admission; an admitted company then holds an Atomus
 * record and no Pvalyou answer, and without this route the pair route reads as
 * tried and the claim as BLOCKED — the fallback could never be reached. It is
 * executable only AFTER Atomus answered and while the claim is still unknown
 * (only unknown checks are gaps), never as a primary route: a company Atomus
 * has not read yet is routed to Atomus, the cheaper route, first.
 */
export const PVALYOU_RECENCY_FALLBACK_ROUTE: ClaimRoute = {
  actor: "apify_funding_pvalyou", capability: "funding_verification",
  purpose: "dated rounds from cited announcements, when Atomus answered without a decisive round",
  evidence_actors: ["apify_funding_pvalyou"],
  canonical_executor: true,
  executor_note: "conditional Atomus fallback (fundingStageVerifier); can PASS a recency claim, never FAIL one",
  after_actor: "apify_funding_atomus",
  cost_hint_usd: 0.0201,
};

export const CLAIM_REGISTRY: readonly ClaimDefinition[] = [
  {
    claim: "business_model", criterion_dimensions: ["industry", "business_model"],
    evidence: ["business_model", "industry"], freshness_days: null,
    routes: [LINKEDIN_DETAILS, FIRST_PARTY_PAGES],
  },
  { claim: "country", criterion_dimensions: ["geography"], evidence: ["geography"], freshness_days: null, routes: [LINKEDIN_DETAILS] },
  // "N–M employees" is the company's DECLARED size band (companySize.ts). The
  // LinkedIn associated-member count answers no claim here.
  { claim: "company_size", criterion_dimensions: ["company_size"], evidence: ["company_size_band"], freshness_days: freshness("company_size_band"), routes: [LINKEDIN_DETAILS] },
  {
    claim: "funding_stage", criterion_dimensions: ["company_stage"], evidence: ["funding", "company_stage"],
    freshness_days: freshness("funding"),
    routes: [FUNDING_PAIR_ROUTE],
  },
  {
    claim: "open_role", criterion_dimensions: ["hiring"], evidence: ["hiring", "job"], freshness_days: freshness("hiring"),
    routes: [{
      actor: "apify_linkedin_job_search", capability: "hiring_verification",
      purpose: "the company's open roles on LinkedIn", evidence_actors: ["apify_linkedin_job_search", "linkedin_jobs"],
      // The open-role CLAIM VERIFIER (`hiringClaimVerifier.ts`): per still-viable
      // candidate, after the cheap claims, with the mission's own role family.
      canonical_executor: true, executor_note: "open-role claim verifier (per viable candidate)",
      cost_hint_usd: 0.011,
    }],
  },
  {
    claim: "first_in_function", criterion_dimensions: [], evidence: ["team_composition", "marketing_function"],
    freshness_days: freshness("team_composition"), deferred_to: "P6",
    routes: [{
      actor: "apify_linkedin_company_employees", capability: "hiring_verification",
      purpose: "current staff in the function", evidence_actors: ["apify_linkedin_company_employees"],
      canonical_executor: false, executor_note: "opt-in actor; zero results are never proof",
      cost_hint_usd: 0.05,
    }],
  },
  {
    // DECIDED FROM ROUNDS WE ALREADY HOLD (`decideRecentlyFunded`), and routed
    // only for a company we hold none for: the same pair that answers the
    // stage answers "is there a recent round at all". A company whose rounds
    // discovery already bought is never bought again.
    claim: "recently_funded", criterion_dimensions: ["funding"], evidence: ["funding"],
    freshness_days: freshness("funding"), routes: [FUNDING_PAIR_ROUTE, PVALYOU_RECENCY_FALLBACK_ROUTE],
  },
  { claim: "product_launch", criterion_dimensions: ["product_launch"], evidence: ["product_launch"], freshness_days: freshness("product_launch"), routes: [], deferred_to: "P7" },
  { claim: "geographic_expansion", criterion_dimensions: ["expansion"], evidence: ["expansion"], freshness_days: freshness("expansion"), routes: [], deferred_to: "P7" },
  { claim: "social_activity", criterion_dimensions: ["social_activity"], evidence: [], freshness_days: null, routes: [], deferred_to: "P7" },
  { claim: "headcount_growth", criterion_dimensions: ["headcount_growth"], evidence: ["headcount_growth"], freshness_days: freshness("headcount_growth"), routes: [], deferred_to: "P8" },
  { claim: "leadership_change", criterion_dimensions: ["leadership_change"], evidence: ["leadership_change"], freshness_days: freshness("leadership_change"), routes: [], deferred_to: "P9" },
  { claim: "technology", criterion_dimensions: ["technology"], evidence: ["technology"], freshness_days: freshness("technology"), routes: [], deferred_to: "P9" },
];

export function claimFor(
  criterionDimension: string, registry: readonly ClaimDefinition[] = CLAIM_REGISTRY,
): ClaimDefinition | null {
  return registry.find((c) => c.criterion_dimensions.includes(criterionDimension)) ?? null;
}

export interface GapRoute {
  actor: string; capability: string; purpose: string; readiness: RouteReadinessDecision["readiness"];
  tried: boolean; executable: boolean; why: string;
  cost_hint_usd: number;
}

export interface EvidenceGap {
  criterion_id: string;
  dimension: string;
  claim: string | null;
  /** Why the check is still unknown, as eligibility said it. */
  missing: string;
  next: "verify" | "blocked";
  /** The route to take next, when `next` is `verify`. */
  route: GapRoute | null;
  /** Every route considered, with why it cannot be taken — the capability gap. */
  considered: GapRoute[];
}

/** The routes for a claim, judged for one company. */
function judgeRoutes(
  def: ClaimDefinition | null, graph: CompanyEvidenceGraph, attempted: ReadonlySet<string>,
  policy: ReadinessPolicy,
): GapRoute[] {
  if (!def) return [];
  // TRIED means the actor has already answered for this company on ANY
  // dimension: LinkedIn details that returned a size band but no HQ were
  // bought, and asking again returns the same page.
  const answered = new Set(graph.claims.flatMap((c) => c.sources));
  return def.routes.map((r) => {
    // THE ONE READINESS AUTHORITY: the same decision the planner, the verifier
    // runner and the spec compiler read (`routeReadiness.ts`).
    const decision = policy.decide(r.actor, r.capability);
    const readiness = decision.readiness;
    // …or a claim verifier has already answered through this route, whatever
    // its verdict: a PENDING funding stage writes no evidence item, and without
    // the mark the router would send the same company to the same verifier on
    // every slice (`verifyOpKey` in `claimVerifier`).
    const tried = attempted.has(r.actor) || r.evidence_actors.some((a) => answered.has(a));
    // A FALLBACK waits for the route it falls back from.
    const unlocked = !r.after_actor || attempted.has(r.after_actor) || answered.has(r.after_actor);
    const executable = decision.executable && !tried && r.canonical_executor && unlocked;
    const why = !decision.executable ? decision.reason
      : tried ? `${r.actor} already answered for this company`
      : !r.canonical_executor ? r.executor_note
      : !unlocked ? `only after ${r.after_actor} has answered for this company`
      : "ready";
    return { actor: r.actor, capability: r.capability, purpose: r.purpose, readiness, tried, executable, why, cost_hint_usd: r.cost_hint_usd };
  });
}

/** The gaps on one candidate's unknown hard checks. */
export function evidenceGapsFor(
  checks: ReadonlyArray<{ criterion_id: string; dimension: string; result: string; reason: string }>,
  graph: CompanyEvidenceGraph,
  registry: readonly ClaimDefinition[] = CLAIM_REGISTRY,
  /** Route actors a claim verifier has already answered through for this company. */
  attempted: ReadonlySet<string> = new Set(),
  /** Who may run (`routeReadiness.ts`). Production unless a probe says otherwise. */
  policy: ReadinessPolicy = PRODUCTION_READINESS,
): EvidenceGap[] {
  return checks.filter((c) => c.result === "unknown").map((c) => {
    const def = claimFor(c.dimension, registry);
    const considered = judgeRoutes(def, graph, attempted, policy);
    // CHEAPEST FIRST among the routes that can actually answer it.
    const route = [...considered].filter((r) => r.executable)
      .sort((a, b) => a.cost_hint_usd - b.cost_hint_usd)[0] ?? null;
    return {
      criterion_id: c.criterion_id, dimension: c.dimension, claim: def?.claim ?? null, missing: c.reason,
      next: route ? "verify" : "blocked", route, considered,
    };
  });
}

/**
 * CAN THIS PENDING CANDIDATE STILL REACH QUALIFICATION?
 *
 * The ONE viability rule, read by the verifier phase (`verificationTargets`)
 * and by continuation (`summarizeGaps` → `with_executable_route`) alike. A
 * candidate can progress only when EVERY unknown hard claim still has an
 * executable route that could close it. One blocked claim — funding Atomus
 * answered with no rounds and no complete history, and nothing else permitted
 * to ask — means no purchase on any OTHER claim can make it eligible.
 *
 * Canary 1156c062 (2026-09-24) is why this is one function: the verifier phase
 * refused to buy for How to AI on exactly this rule, while continuation counted
 * its open business-model and hiring gaps as work, re-queued it four times with
 * nothing to buy, and the queue ended `retry_budget_exhausted`.
 */
export function canStillQualify(gaps: readonly Pick<EvidenceGap, "next">[]): boolean {
  return gaps.length > 0 && gaps.every((g) => g.next === "verify");
}

export interface GapSummary {
  version: typeof EVIDENCE_GAP_ROUTER_VERSION;
  /** Pending candidates. */
  pending: number;
  /**
   * Pending candidates that can still reach qualification: every unknown hard
   * claim has an executable route (`canStillQualify`). What continuation reads.
   */
  with_executable_route: number;
  /** Pending candidates with at least one hard claim no executable route can close. */
  blocked: number;
  /** Unknown hard checks across pending candidates, by criterion dimension. */
  unresolved_hard_checks: Record<string, number>;
  /** Why the blocked gaps are blocked, by claim — the capabilities the mission lacks. */
  capability_gaps: Array<{ claim: string | null; dimension: string; routes: Array<{ actor: string; why: string }>; deferred_to: string | null; candidates: number }>;
}

export function summarizeGaps(pending: ReadonlyArray<{ gaps: readonly EvidenceGap[] }>): GapSummary {
  const unresolved: Record<string, number> = {};
  const capability = new Map<string, GapSummary["capability_gaps"][number]>();
  let executable = 0;
  for (const p of pending) {
    if (canStillQualify(p.gaps)) executable++;
    for (const g of p.gaps) {
      unresolved[g.dimension] = (unresolved[g.dimension] ?? 0) + 1;
      if (g.next !== "blocked") continue;
      const key = `${g.claim}|${g.dimension}`;
      const row = capability.get(key) ?? {
        claim: g.claim, dimension: g.dimension,
        routes: g.considered.map((r) => ({ actor: r.actor, why: r.why })),
        deferred_to: (g.claim ? CLAIM_REGISTRY.find((d) => d.claim === g.claim)?.deferred_to : null) ?? null,
        candidates: 0,
      };
      row.candidates++;
      capability.set(key, row);
    }
  }
  return {
    version: EVIDENCE_GAP_ROUTER_VERSION,
    pending: pending.length,
    with_executable_route: executable,
    blocked: pending.length - executable,
    unresolved_hard_checks: unresolved,
    capability_gaps: [...capability.values()],
  };
}
