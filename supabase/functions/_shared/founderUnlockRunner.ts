// THE ONLY PLACE PEOPLE ARE BOUGHT, AND IT RUNS FOR ONE COMPANY AT A TIME.
//
// Founder discovery stays ABSENT from automatic sourcing. `buildCapabilityGraph`
// never schedules `founder_discovery`, `employer_verification` or
// `contact_enrichment`, so they fall into `prohibited` and their Actors are
// refused for a sourcing plan. This module is the deliberate, separate, paid
// door — reached only after a user pressed Unlock on one named company and a
// reservation succeeded.
//
// WHY IT IS NOT `runCapabilityPlan`. The engine's people stages need a whole
// populated `EngineCompany` — verdicts, identity, enrichment, registry — which a
// later, standalone request does not have and would have to reconstruct from
// persisted fragments. Reconstructing a qualification in order to re-earn
// permission that was already earned is how a guard gets faked. The permission
// here comes from the pool row instead, proven server-side in
// `founderUnlockContract.ts`.
//
// EVERY PROVIDER CALL IS INJECTED, so the whole flow is exercised in tests with
// zero Actor runs.

import {
  compileHarvestCompanyEmployeesInput, compileHarvestProfileSearchInput,
  type CompiledActorCall,
} from "./hiringActorInputs.ts";
import {
  COMPANY_EMPLOYEES_SCRAPER_MODES, PROFILE_SEARCH_SCRAPER_MODES,
} from "./hiringActorCatalog.ts";
import {
  dedupePeople, normalizeHarvestPerson, type NormalizedHiringPerson,
} from "./hiringActorNormalizers.ts";

export const UNLOCK_RUNNER_VERSION = "founder-unlock-runner-v1" as const;

/** The Actors this door may open. Nothing else is reachable from here. */
export const UNLOCK_PROVIDERS = [
  "apify_linkedin_company_employees",
  "apify_people_search",
] as const;

export interface UnlockRunnerDeps {
  invoke: (call: CompiledActorCall<unknown>) => Promise<Record<string, unknown>[]>;
  verifyEmployer: (
    person: NormalizedHiringPerson, companyLinkedInUrl: string,
  ) => { verified: boolean; outcome: string };
  log?: (msg: string, meta?: unknown) => void;
}

export interface UnlockedPerson {
  full_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  current_employer: string | null;
  employer_verification: string;
}

export interface UnlockRunOutcome {
  /**
   * Did a provider actually execute? THE BILLING TURNS ON THIS. False means the
   * charge is zero no matter what else happened.
   */
  providerRan: boolean;
  providersUsed: string[];
  /** Everything the provider returned, before verification. */
  candidatesReturned: number;
  /** Survivors of employer verification. These are what the user receives. */
  people: UnlockedPerson[];
  failure: string | null;
}

const EMPTY = (failure: string | null): UnlockRunOutcome => ({
  providerRan: false, providersUsed: [], candidatesReturned: 0,
  people: [], failure,
});

/**
 * Find and verify decision-makers at ONE company.
 *
 * The employer check is not decoration: a people search returns profiles whose
 * stated employer may be stale or simply wrong, and an unverified row is a
 * person the user would email about a company they left. Only survivors are
 * returned, and only survivors are counted for billing — which is what makes
 * "we found nobody" cost the user nothing.
 */
export async function runFounderUnlock(
  deps: UnlockRunnerDeps,
  i: {
    companyLinkedInUrl: string;
    roles: readonly string[];
    maxPeople?: number;
  },
): Promise<UnlockRunOutcome> {
  const log = deps.log ?? (() => {});
  const url = String(i.companyLinkedInUrl ?? "").trim();
  if (!url) {
    // NOT A FAILURE TO CHARGE FOR. Refused before any provider, so the caller
    // releases the reservation in full.
    return EMPTY("no resolved company identity to search against");
  }
  const maxItems = Math.max(1, Math.min(10, i.maxPeople ?? 3));
  const roles = [...i.roles];
  const providersUsed: string[] = [];
  let rows: Record<string, unknown>[] = [];
  let providerRan = false;

  try {
    providersUsed.push("apify_linkedin_company_employees");
    providerRan = true;
    rows = await deps.invoke(compileHarvestCompanyEmployeesInput({
      companies: [url], jobTitles: roles, maxItems,
      // CHEAPEST VERIFIED MODE. The compiler forbids email-enrichment modes, so
      // a founder unlock can never silently become a paid email lookup — that
      // is a separate purchase the user has not made.
      profileScraperMode: COMPANY_EMPLOYEES_SCRAPER_MODES[0],
    }) as CompiledActorCall<unknown>);
  } catch (e) {
    log("unlock_primary_provider_failed", { error: String(e) });
    rows = [];
  }

  if (rows.length === 0) {
    // ONE APPROVED FALLBACK, SAME QUESTION. Both Actors are already approved
    // for this capability; this adds no new reach.
    try {
      providersUsed.push("apify_people_search");
      providerRan = true;
      rows = await deps.invoke(compileHarvestProfileSearchInput({
        currentCompanies: [url], currentJobTitles: roles, maxItems,
        profileScraperMode: PROFILE_SEARCH_SCRAPER_MODES[0],
      }) as CompiledActorCall<unknown>);
    } catch (e) {
      log("unlock_fallback_provider_failed", { error: String(e) });
      rows = [];
    }
  }

  const candidates = dedupePeople(
    rows.map((r) => normalizeHarvestPerson(r, "founder_unlock")));

  const people: UnlockedPerson[] = [];
  for (const p of candidates) {
    const v = deps.verifyEmployer(p, url);
    if (!v.verified) continue;
    people.push({
      full_name: p.full_name ?? null,
      title: p.title ?? null,
      linkedin_url: p.linkedin_url ?? null,
      current_employer: p.current_employer ?? null,
      employer_verification: v.outcome,
    });
  }

  log("unlock_complete", {
    provider_ran: providerRan, returned: candidates.length, verified: people.length,
  });

  return {
    providerRan,
    providersUsed,
    candidatesReturned: candidates.length,
    people,
    failure: providerRan && candidates.length === 0
      ? "the provider returned no candidates" : null,
  };
}
