// Bounded people-search request planner + fallback sequence. Pure.
//
// Provider-independent: emits a canonical request that an adapter translates.
// No secrets, no actor tokens, no network. Every plan is bounded — an unbounded
// people search is how a "find the decision-maker" action turns into a bill and
// a list of strangers.

import type { DecisionMakerCompanyIdentity } from "./companyIdentity.ts";
import { TARGET_ROLE_FAMILIES, type DecisionMakerRoleFamily } from "./roleFamily.ts";

export type SearchStage =
  | "direct_known_person"
  | "company_employee_search"
  | "domain_people_search"
  | "stop";

export interface PeopleSearchPlan {
  provider: "apify";
  actor_key: string;
  stage: SearchStage;
  company_filters: { company_linkedin_url?: string; company_domain?: string; company_name?: string };
  title_filters: string[];
  seniority_filters: string[];
  geography_filters: string[];
  maximum_results: number;
  reason: string;
  identity_strength: DecisionMakerCompanyIdentity["identity_strength"];
}

/** Hard ceiling. A single lead never justifies a larger crawl. */
export const MAX_RESULTS_PER_LEAD = 25;

/** Canonical title filters derived from the target role families. */
export const TITLE_FILTERS: readonly string[] = [
  "founder", "co-founder", "ceo", "owner",
  "chief revenue officer", "cro",
  "vp sales", "head of sales",
  "vp growth", "head of growth",
  "head of revenue",
  "revenue operations", "sales operations",
] as const;

export const SENIORITY_FILTERS: readonly string[] = ["owner", "founder", "cxo", "vp", "director", "head"] as const;

export const PLANNED_ROLE_FAMILIES: readonly DecisionMakerRoleFamily[] = TARGET_ROLE_FAMILIES;

export type PlanResult =
  | { ok: true; plan: PeopleSearchPlan }
  | { ok: false; reason_code: "missing_company_identity"; message: string };

/**
 * Build the search plan for a given stage.
 *
 * Stage order is fixed and bounded:
 *   1. company_employee_search — uses the company LinkedIn URL (strongest key)
 *   2. domain_people_search    — uses the verified domain
 *   3. stop
 *
 * A name-only identity NEVER produces a plan: there would be no way to verify
 * whoever came back, so the honest answer is missing_company_identity.
 */
export function planPeopleSearch(
  identity: DecisionMakerCompanyIdentity,
  stage: Exclude<SearchStage, "direct_known_person" | "stop">,
  opts: {
    maxResults?: number;
    geography?: string[];
    /**
     * THE PERSONA THE USER ASKED FOR.
     *
     * ── WHY THIS IS A PARAMETER AND NOT A WIDER DEFAULT LIST ───────────────
     *
     * `TITLE_FILTERS` is a fixed founder/CEO/revenue-leader list, so "find the
     * VP Sales" and "find the Head of Marketing" both searched for the same
     * dozen titles. Widening the constant to cover every persona anyone might
     * ask for makes EVERY search broader and more expensive, and the actor's
     * `jobTitles` filter is fuzzy — its own `company_employees_fuzzy_titles`
     * defect returned a Finance Intern for a Founder query — so a longer list
     * returns more wrong people, not more right ones.
     *
     * Supplying the asked-for persona INSTEAD keeps each search small and on
     * target. Absent, the default list stands and behaviour is unchanged.
     *
     * The titles are a RETRIEVAL HINT and never a verdict: `classifyDecisionMakerRole`
     * and the employer check still decide who is accepted, exactly as before.
     */
    personaTitles?: string[];
  } = {},
): PlanResult {
  if (!identity.search_ready) {
    return {
      ok: false,
      reason_code: "missing_company_identity",
      message: "Verify the company domain or LinkedIn page first.",
    };
  }

  const maximum_results = Math.max(1, Math.min(opts.maxResults ?? MAX_RESULTS_PER_LEAD, MAX_RESULTS_PER_LEAD));
  // THE ASKED-FOR PERSONA, OR THE DEFAULT LADDER. Trimmed and de-duplicated,
  // and capped at the Actor's documented `jobTitles` limit of 50.
  const persona = (opts.personaTitles ?? [])
    .map((t) => String(t).trim()).filter((t) => t.length > 0);
  const title_filters: readonly string[] = persona.length > 0
    ? [...new Set(persona)].slice(0, 50)
    : TITLE_FILTERS;
  // Geography is only ever passed through when the caller supplies it. Guessing a
  // location silently excludes valid people.
  const geography_filters = Array.isArray(opts.geography) ? opts.geography.filter((g) => typeof g === "string" && g) : [];

  if (stage === "company_employee_search") {
    if (!identity.company_linkedin_url) {
      return {
        ok: false,
        reason_code: "missing_company_identity",
        message: "No verified company LinkedIn page for an employee search.",
      };
    }
    return {
      ok: true,
      plan: {
        provider: "apify",
        actor_key: "apify_linkedin_company_employees",
        stage,
        company_filters: { company_linkedin_url: identity.company_linkedin_url },
        title_filters: [...title_filters],
        seniority_filters: [...SENIORITY_FILTERS],
        geography_filters,
        maximum_results,
        reason: "company LinkedIn URL is the strongest verifiable company key",
        identity_strength: identity.identity_strength,
      },
    };
  }

  // domain_people_search
  if (!identity.domain) {
    return {
      ok: false,
      reason_code: "missing_company_identity",
      message: "No verified company domain for a people search.",
    };
  }
  return {
    ok: true,
    plan: {
      provider: "apify",
      actor_key: "apify_people_search",
      stage,
      company_filters: {
        company_domain: identity.domain,
        // Name is a refinement here, never the sole key.
        ...(identity.company_name ? { company_name: identity.company_name } : {}),
      },
      title_filters: [...title_filters],
      seniority_filters: [...SENIORITY_FILTERS],
      geography_filters,
      maximum_results,
      reason: "verified domain fallback after company-page search",
      identity_strength: identity.identity_strength,
    },
  };
}

/**
 * The bounded stage sequence for an identity. At most two provider attempts, in
 * strength order, then stop.
 */
export function fallbackStages(identity: DecisionMakerCompanyIdentity): SearchStage[] {
  const stages: SearchStage[] = ["direct_known_person"];
  if (identity.company_linkedin_url) stages.push("company_employee_search");
  if (identity.domain) stages.push("domain_people_search");
  stages.push("stop");
  return stages;
}
