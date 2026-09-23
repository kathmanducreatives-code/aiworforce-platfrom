// LEAD V2 P4 — ACTOR INTELLIGENCE: CONTRACT, PLAYBOOK, READINESS, PERFORMANCE.
//
// The actor card (`hiringActorCatalog.ts`) is the CONTRACT: inputs, enums,
// limits, cost model. The research playbooks are the PLAYBOOK. What was missing
// is READINESS — whether a route through this actor has actually run live in
// V2 under the ProviderCallSpec spine — and PERFORMANCE, which is measured,
// never asserted.
//
// Readiness is code-owned. A route controller (GPT) may only add a route whose
// actor/capability pair is READY here; anything else is refused before a spec
// is compiled. The classes are the P4 brief's:
//   READY                  carded, executable, live-proven in V2
//   EXPERIMENTAL           live once, not yet trusted: runs only when explicitly allowed
//   CARDED_BUT_NOT_LIVE    carded and executable, never run live in V2
//   LEGACY_ONLY            exists only in the V1 tool registry, uncarded
//   NEEDS_CONTRACT_WORK    no verified input/output contract
//   NEEDS_EXTRACTION_WORK  runs, but its rows are not normalized into evidence
//   NEEDS_PROVIDER_WORK    the provider is gated (opt-in, credential, approval)
//   NOT_PRESENT            not in the repo at all
//
// `live_evidence` names the canary that proved a READY pair. Performance starts
// EMPTY: `observedRoutePerformance` fills it from wave summaries a real mission
// produced. Nothing here is a benchmark.
//
// Pure.

import { hiringActorCard } from "./hiringActorCatalog.ts";

export const ACTOR_INTELLIGENCE_VERSION = "actor-intelligence-v1" as const;

export type ActorReadiness =
  | "READY" | "EXPERIMENTAL" | "CARDED_BUT_NOT_LIVE" | "LEGACY_ONLY" | "NEEDS_CONTRACT_WORK"
  | "NEEDS_EXTRACTION_WORK" | "NEEDS_PROVIDER_WORK" | "NOT_PRESENT";

export interface ActorReadinessRecord {
  /** Repo key, or the store id when the actor is not in the repo. */
  actor: string;
  capability: string;
  readiness: ActorReadiness;
  reason: string;
  /** The live run that proved it. Required for READY. */
  live_evidence: string | null;
  /** Mission conditions under which a READY pair still refuses (e.g. cohort named). */
  gated_by?: string;
}

export const ACTOR_READINESS: readonly ActorReadinessRecord[] = Object.freeze([
  { actor: "apify_linkedin_job_search", capability: "job_discovery", readiness: "READY",
    reason: "P3 job-first route; employer URL/website/headcount from the row", live_evidence: "canary 2a215d44 (2026-09-17)" },
  { actor: "apify_linkedin_job_search", capability: "hiring_verification", readiness: "READY",
    reason: "company-scoped open-role check", live_evidence: "canary 03f4c9c6 (2026-09-17)" },
  { actor: "apify_linkedin_company_search", capability: "company_identity_resolution", readiness: "READY",
    reason: "guarded name search when no LinkedIn URL is known", live_evidence: "P2 canaries (2026-09-16)" },
  { actor: "apify_linkedin_company_search", capability: "general_company_discovery", readiness: "CARDED_BUT_NOT_LIVE",
    reason: "carded for company_discovery; never run as a V2 discovery route", live_evidence: null },
  { actor: "apify_linkedin_company_details", capability: "company_enrichment", readiness: "READY",
    reason: "headcount/industry/HQ by LinkedIn URL", live_evidence: "canary 2a215d44 (2026-09-17)" },
  { actor: "apify_yc_companies_memo23", capability: "startup_company_discovery", readiness: "READY",
    reason: "YC directory with open jobs", live_evidence: "P2 canaries (2026-09-16)", gated_by: "mission names the YC cohort" },
  { actor: "apify_yc_companies_solidcode", capability: "startup_company_discovery", readiness: "CARDED_BUT_NOT_LIVE",
    reason: "carded (low confidence); never run live in V2", live_evidence: null, gated_by: "mission names the YC cohort" },
  { actor: "apify_funding_rounds_datahyena", capability: "funding_signal_discovery", readiness: "CARDED_BUT_NOT_LIVE",
    reason: "carded and executable; not run under the V2 spec spine (per-record billing, the highest in the catalog — see its card); hybrid is P6", live_evidence: null },
  // ── THE FUNDING PAIR ──────────────────────────────────────────────────────
  //
  // EXPERIMENTAL, together. The live pair probe of 2026-09-21 (Wordware,
  // preserved under `docs/audits/live-validation-2026-09-21/`) proved the
  // PROVIDER CONTRACT end to end: atomus returned 3 dated rounds with
  // `num_funding_rounds: 3` and no citation; pvalyou returned the same Seed
  // round with 4 cited announcements and no trustworthy count; merged on the
  // same rung inside the date window they produce one complete, cited record,
  // and `decideCorroboratedFundingStage` answers seed PASS / pre-seed FAIL.
  // Alone, each answers PENDING — atomus `required_stage_uncorroborated`,
  // pvalyou `history_incomplete`.
  //
  // What that probe did NOT do is run the route through this pipeline: the
  // same day's mission (task 3bc526e2, local stack) recorded the funding
  // verifier as `irrelevant`, because the mission carried no hard funding
  // claim, so no ProviderCallSpec, ledger row or gap-routed target exists for
  // it yet. READY means live-proven THROUGH the spine; this is not that, and
  // calling it READY would make the table lie.
  //
  // ── 2026-09-22: THE DECISION IS PROVEN; THE PURCHASE PATH WAS NOT ─────
  //
  // Known-company canary, task 3f082b22 (local stack, Pilot-compiled mission
  // "Qualify https://www.linkedin.com/company/wordware. It must have raised
  // Seed funding within the last 2 years."): a HARD company_stage:seed claim
  // → claim plan `verifiable` → the funding verifier selected from the gap →
  // atomus run jYxeaTmdOcUMqEDpH (3 dated rounds, reported_round_count 3) →
  // pvalyou run 1PD7p3cn1lmi1AS54 (the Seed round, 4 cited announcements,
  // basic tier) → corroborated record, 0 conflicts → funding_stage PASS
  // (`required_stage_verified_and_latest`, cited) → recently_funded read from
  // the same record (730d PASS, 180d FAIL — no repurchase) → eligible →
  // Workbench `worth_considering`. No funding discovery, no datahyena call.
  //
  // It was briefly marked READY on that evidence, and that was premature. The
  // two purchases did not go through the spine every other provider call
  // does: no ProviderCallSpec was compiled, `guardedInvoker` was not on the
  // path, and their `lead_execution_calls` rows carry no provider_call_id, no
  // spec estimate and no settlement (the company-details call in the same run
  // has all three). The verifier path now compiles, guards and settles like
  // the engine (`verifierCallSpec.ts`, `ledgerBoundCall`); READY waits for a
  // canary whose two ledger rows show exactly that.
  //
  // ── 2026-09-23: READY, TOGETHER, ON A CANARY THAT SHOWS THE WHOLE SPINE ─
  //
  // Final bounded canary, task de24f92c (local stack, same mission, run budget
  // provider_usd 0.05 / max_candidates 1, no datahyena). For EACH half:
  // ProviderCallSpec compiled against the $0.05 ceiling → readiness → USD
  // preflight → guardedInvoker → provider_call_id → execution → estimate →
  // receipt settlement, in the trace in that order (spec_compiled →
  // call_reserved → call_executed → call_settled):
  //
  //   atomus   pc_63b19ebacfe08a580f927ad584  run xs9xxoJ9V4yjBztbG
  //            estimate = actual = settled = $0.0036, stable, variance 0
  //   pvalyou  pc_cb2607ae06ad8429f0823fdf05  run 9a9kcGDEgRTcmZTtQ
  //            estimate = actual = settled = $0.0201, stable, variance 0
  //
  // and the canonical evidence names both, each for what it proved: the Seed
  // event reported by atomus and CITED by pvalyou (blog.wordware.ai), the
  // history's completeness (3 of 3 rounds) atomus's; funding_stage PASS cites
  // both calls and derives from the funding record. recently_funded 730d PASS
  // / 180d FAIL from the same record; eligible; Workbench worth_considering at
  // $0.0278 provider (= the ledger's receipts) + $0.002656 model.
  //
  // THE UNIT IS THE ROUTE, NOT EITHER ACTOR, whatever the class: neither can
  // SETTLE the claim alone, and that is enforced by the decision, not by this
  // table. atomus carries no citation, so it can never PASS; pvalyou's count is
  // only what it holds, so it can never make a history complete or a FAIL. The
  // live domain-only canary (task 65c5793d: no LinkedIn identity, so atomus
  // could not run) proved exactly that — pvalyou alone settled PENDING.
  { actor: "apify_funding_atomus", capability: "funding_verification", readiness: "READY",
    reason: "atomus/linkedin-company-scraper: dated rounds and a TRUE round count (completeness), no citations — half the pair",
    live_evidence: "final canary task de24f92c (2026-09-23, Wordware): pc_63b19ebacfe08a580f927ad584 run xs9xxoJ9V4yjBztbG, full spec spine, settled $0.0036 = estimate; completeness 3/3 cited in the Seed PASS",
    gated_by: "the funding pair: a PASS needs pvalyou's or discovery's citation, so atomus alone can only answer PENDING (or a later-round FAIL)" },
  { actor: "apify_funding_pvalyou", capability: "funding_verification", readiness: "READY",
    reason: "pvalyou/company-record: per-round source URLs (provenance), a round count that is only what it holds, slow cold reads — half the pair",
    live_evidence: "final canary task de24f92c (2026-09-23, Wordware): pc_cb2607ae06ad8429f0823fdf05 run 9a9kcGDEgRTcmZTtQ, full spec spine, settled $0.0201 = estimate; the Seed event's citation in the PASS",
    gated_by: "the funding pair: without atomus's completeness pvalyou alone can only answer PENDING" },
  { actor: "apify_linkedin_company_employees", capability: "hiring_verification", readiness: "NEEDS_PROVIDER_WORK",
    reason: "opt-in only at the tool layer (apify_actor_disabled_by_default); first-hire team check refused live", live_evidence: null },
  { actor: "apify_people_search", capability: "founder_discovery", readiness: "NEEDS_PROVIDER_WORK",
    reason: "opt-in only at the tool layer", live_evidence: null },
  { actor: "apify_linkedin_profile_enrichment", capability: "contact_enrichment", readiness: "CARDED_BUT_NOT_LIVE",
    reason: "carded; contact stage not exercised by V2 canaries", live_evidence: null },
  { actor: "apify_google_news", capability: "expansion_signal_verification", readiness: "CARDED_BUT_NOT_LIVE",
    reason: "carded and executable as verification; never run live in V2", live_evidence: null },
  { actor: "apify_google_news", capability: "expansion_signal_discovery", readiness: "NEEDS_EXTRACTION_WORK",
    reason: "articles are not normalized into company candidates", live_evidence: null },
  { actor: "apify_google_news", capability: "product_launch_discovery", readiness: "NEEDS_EXTRACTION_WORK",
    reason: "articles are not normalized into company candidates", live_evidence: null },
  { actor: "apify_linkedin_company_posts", capability: "company_post_verification", readiness: "NEEDS_EXTRACTION_WORK",
    reason: "capability needs engine work; posts are not claims yet", live_evidence: null },
  { actor: "apify_linkedin_profile_posts", capability: "founder_led_gtm", readiness: "NEEDS_EXTRACTION_WORK",
    reason: "carded; no founder-led-GTM claim extraction", live_evidence: null },
  { actor: "apify_linkedin_post_search", capability: "social_discovery", readiness: "NEEDS_EXTRACTION_WORK",
    reason: "carded; posts are not normalized into company candidates", live_evidence: null },
  { actor: "apify_builtwith_technology", capability: "technology_verification", readiness: "NEEDS_EXTRACTION_WORK",
    reason: "capability needs engine work (not executable)", live_evidence: null },
  { actor: "firecrawl", capability: "web_evidence", readiness: "READY",
    reason: "careers/about pages under webEvidenceSpec; cost derived, not receipted", live_evidence: "canary 2a215d44 (2026-09-17)" },
  { actor: "crawlworks/linkedin-jobs-scraper", capability: "job_discovery", readiness: "LEGACY_ONLY",
    reason: "V1 registry key apify_linkedin_jobs_crawlworks; uncarded", live_evidence: null },
  { actor: "automation-lab/indeed-scraper", capability: "job_discovery", readiness: "LEGACY_ONLY",
    reason: "V1 Indeed registry entry; uncarded", live_evidence: null },
  { actor: "parseforge/career-site-jobs-scraper", capability: "job_discovery", readiness: "NOT_PRESENT",
    reason: "not in the repo", live_evidence: null },
  { actor: "solidscrape/indeed-jobs-scraper", capability: "job_discovery", readiness: "NOT_PRESENT",
    reason: "not in the repo", live_evidence: null },
]);

export function readinessOf(actor: string, capability: string): ActorReadinessRecord {
  return ACTOR_READINESS.find((r) => r.actor === actor && r.capability === capability) ?? {
    actor, capability,
    readiness: hiringActorCard(actor) ? "CARDED_BUT_NOT_LIVE" : "NOT_PRESENT",
    reason: hiringActorCard(actor) ? "no readiness record for this capability" : "not in the actor catalog",
    live_evidence: null,
  };
}

// Whether a route through a pair may RUN is decided in `routeReadiness.ts`,
// the one readiness authority; this table only declares each pair's class.

/** Measured route performance. Empty until a real mission reports a wave. */
export interface ObservedRoutePerformance {
  actor: string;
  capability: string;
  missions: number;
  rows: number;
  new_companies: number;
  merged_companies: number;
  hard_pass: number;
  settled_usd: number;
}

export function observedRoutePerformance(
  waves: ReadonlyArray<{ routes: ReadonlyArray<{ actor_key: string; capability: string; rows: number; new_companies: number; merged_into_existing: number; hard_pass: number; cost_settled_usd: number }> }>,
): ObservedRoutePerformance[] {
  const out = new Map<string, ObservedRoutePerformance>();
  for (const w of waves) {
    for (const r of w.routes) {
      const k = `${r.actor_key}|${r.capability}`;
      const p = out.get(k) ?? { actor: r.actor_key, capability: r.capability, missions: 0, rows: 0, new_companies: 0, merged_companies: 0, hard_pass: 0, settled_usd: 0 };
      p.missions = 1;
      p.rows += r.rows; p.new_companies += r.new_companies; p.merged_companies += r.merged_into_existing;
      p.hard_pass += r.hard_pass; p.settled_usd += r.cost_settled_usd;
      out.set(k, p);
    }
  }
  return [...out.values()];
}
