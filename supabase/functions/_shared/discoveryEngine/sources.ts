// Provider-neutral discovery sources.
//
// A SOURCE declares, as data, what it can do (`offers`), and implements one
// method, `run(capability, input)`, returning provider rows in the shared
// `ProviderCompany` / `ProviderPerson` shape (discoveryProviders/types.ts) plus
// dated signals. The planner reads only the declarations; the engine merges the
// rows with `mergeRecords`, so a fact from any provider keeps its provenance
// (provider, record id, source field, retrieval time) and disagreements surface
// as conflicts. No row is evidence of eligibility: the shared engine decides.
//
// Costs come from the providers' own published units: LeadOcean records per row
// (docs/LEADOCEAN_FINAL_VERDICT.md), Apify per-event prices from the actor
// catalogue (hiringActorCatalog.ts, BRONZE tier). Apollo is REGISTERED but not
// enabled: its offers are `planned` and the planner never selects a planned offer.

import type { ProviderCompany, ProviderId, ProviderPerson } from "../discoveryProviders/types.ts";
import { HIRING_ACTOR_CATALOG } from "../hiringActorCatalog.ts";
import type { Signal } from "../leadPipeline/signals.ts";
import type { DiscoverySpec } from "./spec.ts";
import type { DiscoveryRequirements } from "../discoveryProviders/types.ts";
import type { UsageLedger } from "../discoveryProviders/budget.ts";

export type Capability =
  /** People by role + firmographics (industry, size, HQ). */
  | "people_by_firmographics"
  /** Companies by firmographics. */
  | "companies_by_firmographics"
  /** Decision-makers at a given list of companies (seeds from another step). */
  | "people_at_companies"
  /** Companies with open roles matching titles, within a posting window. */
  | "companies_by_hiring"
  /** Companies whose own LinkedIn page posted about a topic. */
  | "companies_by_posts"
  /** Funding-stage / funding-recency narrowing (provider claim). */
  | "funding_filter"
  /** Technology-stack narrowing (provider claim). */
  | "technology_filter"
  /** The company record that can PROVE HQ and declared size under evidence authority. */
  | "company_record"
  /** Independent current-employment check of a decision-maker. */
  | "founder_relationship"
  /** Dated posts / jobs for already-known companies (ranking signals). */
  | "company_signals"
  /** Phone lookup — a separate, separately authorized step; never planned for discovery. */
  | "phone_lookup";

export type OfferRole = "discover" | "verify" | "signal" | "enrich";

export interface CapabilityOffer {
  capability: Capability;
  role: OfferRole;
  /** `available` offers can be planned; `planned` ones are declared but never selected. */
  status: "available" | "planned";
  /** What the provider returns: a claim, or a record that may prove a fact under authority rules. */
  evidence: "provider_claim" | "authority_candidate";
  freshness: "indexed_snapshot" | "live_page";
  /** Native filters applied by the provider for this capability. */
  filters: string[];
  /** Worst-case cost: `records` (LeadOcean) or `usd`. */
  cost: { unit: "record" | "usd"; perStart: number; perItem: number; minimum: number };
  actorKey?: string;
  /** Known limits, shown in the plan's explanation. */
  notes: string[];
}

export interface SourceDescriptor {
  id: ProviderId;
  label: string;
  /** `registered_disabled`: declared, never planned until validated. */
  status: "available" | "registered_disabled";
  reason: string | null;
  offers: CapabilityOffer[];
}

const actorCost = (key: string) => {
  const c = HIRING_ACTOR_CATALOG[key]?.cost_model;
  if (!c) throw new Error(`actor ${key} has no catalogued cost`);
  return { unit: "usd" as const, perStart: c.start_usd, perItem: c.per_result_usd ?? 0, minimum: c.minimum_total_usd ?? 0 };
};
const record = { unit: "record" as const, perStart: 0, perItem: 1, minimum: 0 };

export const SOURCE_REGISTRY: Readonly<Record<ProviderId, SourceDescriptor>> = Object.freeze({
  leadocean: {
    id: "leadocean", label: "LeadOcean", status: "available", reason: null,
    offers: [
      { capability: "people_by_firmographics", role: "discover", status: "available", evidence: "provider_claim", freshness: "indexed_snapshot", cost: record,
        filters: ["roles", "seniority", "industry", "employee_range", "geography_hq", "geography_person", "has_phone"],
        notes: ["HQ claim wrong for ~29% of companies; headcount understated for larger companies; founder band over-matches (final verdict)"] },
      { capability: "companies_by_firmographics", role: "discover", status: "available", evidence: "provider_claim", freshness: "indexed_snapshot", cost: record,
        filters: ["industry", "employee_range", "geography_hq", "company_type"], notes: [] },
      { capability: "people_at_companies", role: "discover", status: "available", evidence: "provider_claim", freshness: "indexed_snapshot", cost: record,
        filters: ["company_linkedin", "domain", "roles"], notes: ["one record per person returned"] },
      { capability: "funding_filter", role: "discover", status: "available", evidence: "provider_claim", freshness: "indexed_snapshot", cost: record,
        filters: ["funding_type", "last_funding_year"], notes: ["funding held for ~21% of companies; 'funded since 2025' includes public-company securities"] },
      { capability: "technology_filter", role: "discover", status: "available", evidence: "provider_claim", freshness: "indexed_snapshot", cost: record,
        filters: ["technologies"], notes: ["technology names ~25% coverage; rows list several CRMs at once"] },
      { capability: "phone_lookup", role: "enrich", status: "available", evidence: "provider_claim", freshness: "indexed_snapshot", cost: record,
        filters: [], notes: ["separate, separately authorized step; never part of discovery"] },
    ],
  },
  apify: {
    id: "apify", label: "Apify", status: "available", reason: null,
    offers: [
      { capability: "companies_by_hiring", role: "discover", status: "available", evidence: "provider_claim", freshness: "live_page", cost: actorCost("apify_linkedin_job_search"),
        actorKey: "apify_linkedin_job_search", filters: ["job_titles", "locations", "posted_within"],
        notes: ["job titles are a fuzzy search", "a staffing agency's posting is not its client's hiring", "no company-size input"] },
      { capability: "companies_by_posts", role: "discover", status: "available", evidence: "provider_claim", freshness: "live_page", cost: actorCost("apify_linkedin_post_search"),
        actorKey: "apify_linkedin_post_search", filters: ["search_queries", "posted_within"],
        notes: ["only posts authored by a COMPANY page name a company; a person's headline is not employment"] },
      { capability: "people_at_companies", role: "discover", status: "available", evidence: "provider_claim", freshness: "live_page", cost: actorCost("apify_linkedin_company_employees"),
        actorKey: "apify_linkedin_company_employees", filters: ["companies", "job_titles", "per_company_cap"],
        notes: ["member URLs are opaque ids", "job titles are fuzzy: the role classifier decides"] },
      { capability: "people_by_firmographics", role: "discover", status: "available", evidence: "provider_claim", freshness: "live_page", cost: actorCost("apify_people_search"),
        actorKey: "apify_people_search", filters: ["roles", "locations", "company_headcount"],
        notes: ["$0.10 minimum per run; no industry filter; no per-company cap — fallback only"] },
      { capability: "company_record", role: "verify", status: "available", evidence: "authority_candidate", freshness: "live_page",
        cost: { unit: "usd", perStart: 0.00005, perItem: 0.004, minimum: 0 }, actorKey: "apify_linkedin_company_details", filters: ["company_linkedin"],
        notes: ["proves HQ only with a single HQ-flagged location, size only with a declared band (evidence authority)"] },
      { capability: "founder_relationship", role: "verify", status: "available", evidence: "authority_candidate", freshness: "live_page", cost: actorCost("apify_linkedin_company_employees"),
        actorKey: "apify_linkedin_company_employees", filters: ["companies", "job_titles"], notes: ["ranking only; never a hard gate"] },
      { capability: "company_signals", role: "signal", status: "available", evidence: "provider_claim", freshness: "live_page",
        cost: { unit: "usd", perStart: 0.00105, perItem: 0.002, minimum: 0 }, filters: ["company_linkedin"], notes: ["optional; missing signals never block"] },
    ],
  },
  apollo: {
    id: "apollo", label: "Apollo", status: "registered_disabled",
    reason: "registered for the planned integration; not enabled until its access, permissions and capabilities are validated",
    // Declared from Apollo's public documentation (discoveryProviders/providers.ts); never planned while `planned`.
    offers: [
      { capability: "people_by_firmographics", role: "discover", status: "planned", evidence: "provider_claim", freshness: "indexed_snapshot",
        cost: { unit: "record", perStart: 0, perItem: 0, minimum: 0 }, filters: ["roles", "geography_hq", "employee_range"],
        notes: ["People API Search returned 403 on the current plan (2026-10-30): access unvalidated"] },
      { capability: "companies_by_firmographics", role: "discover", status: "planned", evidence: "provider_claim", freshness: "indexed_snapshot",
        cost: { unit: "record", perStart: 0, perItem: 1, minimum: 0 }, filters: ["geography_hq", "employee_range"], notes: ["1 credit per page; untested"] },
    ],
  },
});

export function offer(provider: ProviderId, capability: Capability): CapabilityOffer | null {
  return SOURCE_REGISTRY[provider].offers.find((o) => o.capability === capability) ?? null;
}

/** Worst-case cost of one step: records or USD. */
export function worstCost(o: CapabilityOffer, items: number): number {
  const v = o.cost.perStart + o.cost.perItem * items;
  return Math.round(Math.max(v, o.cost.minimum) * 1e6) / 1e6;
}

// ── Runtime interface every source implements ───────────────────────────────

export interface SeedCompany { key: string; name: string | null; domain: string | null; linkedinUrl: string | null }

export interface SourceRunInput {
  capability: Capability;
  stepId: string;
  spec: DiscoverySpec;
  requirements: DiscoveryRequirements;
  /** Companies a previous step found (for people_at_companies). */
  seeds: SeedCompany[];
  /** Hard ceiling for this step: records (LeadOcean) or items (Apify). */
  maxItems: number;
  /** Spend ceiling for this step, in the offer's unit. */
  maxCost: number;
  workspaceId: string;
  missionId: string;
  ledger: UsageLedger;
  now: Date;
}

export interface SourceRunResult {
  companies: ProviderCompany[];
  people: ProviderPerson[];
  signals: Signal[];
  /** In the offer's unit (records or USD). */
  spent: number;
  replayed: boolean;
  stopped: string | null;
  notes: string[];
}

export interface DiscoverySource {
  id: ProviderId;
  run(input: SourceRunInput): Promise<SourceRunResult>;
}

export const emptyResult = (notes: string[] = [], stopped: string | null = null): SourceRunResult =>
  ({ companies: [], people: [], signals: [], spent: 0, replayed: false, stopped, notes });
