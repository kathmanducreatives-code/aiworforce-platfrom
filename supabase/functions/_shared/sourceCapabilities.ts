// sourceCapabilities: the single source of truth for "can Agentory actually run
// this lead source right now?". Every visible Lead Source Selector option maps
// to one capability with a configured provider/actor, field contract, caps, and
// an honest unavailable state + fallback. `configured` is computed at RUNTIME
// from actorRegistry (env-gated), so the UI never shows an option as fully
// active when its actor isn't enabled.
//
// Main product rule: if a source option is shown, it either runs or clearly
// says setup is needed — it never silently reroutes to jobs or reopens the
// selector.

import { getActorByKey, isActorRuntimeEnabled } from "./actorRegistry.ts";

export type CapabilitySourceType =
  | "icp_search"
  | "hiring_signal"
  | "linkedin_intent_posts"
  | "linkedin_comments"
  | "competitor_engagement"
  | "people_profiles"
  | "company_search"
  | "decision_makers";

export type SourceCapability = {
  source_type: CapabilitySourceType;
  label: string;
  entity_type: "account" | "contact" | "signal" | "mixed";
  enabled: boolean;            // intended to be offered at all
  primary_actor_key?: string;  // actor that must be runtime-enabled to be "configured"
  // For icp_search the configured-state can be satisfied by EITHER route.
  any_of_actor_keys?: string[];
  fallback_actor_keys?: string[];
  required_fields: string[];
  optional_fields: string[];
  max_results_default: number;
  max_results_cap: number;
  estimated_cost_per_5?: number; // best-effort planning estimate (USD); see research notes
  unavailable_message: string;
  fallback_action?: string;      // capability id to offer when this one is unconfigured
  output_contract: { required_fields: string[]; optional_fields: string[] };
};

// Static definitions. `configured` is computed separately (runtime/env-gated).
const CAPABILITIES: Record<CapabilitySourceType, SourceCapability> = {
  hiring_signal: {
    source_type: "hiring_signal", label: "Hiring signals", entity_type: "account", enabled: true,
    primary_actor_key: "apify_jobs",
    required_fields: ["target_role"], optional_fields: ["industry", "location", "stage", "count"],
    max_results_default: 5, max_results_cap: 100, estimated_cost_per_5: 0.05,
    unavailable_message: "Hiring signals needs the LinkedIn Jobs actor, which isn't configured.",
    output_contract: { required_fields: ["company", "title", "source_url"], optional_fields: ["location", "posted_at"] },
  },
  company_search: {
    source_type: "company_search", label: "Company / category search", entity_type: "account", enabled: true,
    // Reuses the Jobs actor today (companies hiring in a category) → always available
    // as account opportunities. A dedicated Maps/company actor is a future upgrade.
    primary_actor_key: "apify_jobs",
    fallback_actor_keys: ["apify_google_search"],
    required_fields: ["company_category"], optional_fields: ["industry", "location", "count"],
    max_results_default: 5, max_results_cap: 100, estimated_cost_per_5: 0.05,
    unavailable_message: "Company / category search needs the Jobs or company actor, which isn't configured.",
    output_contract: { required_fields: ["company", "source_url"], optional_fields: ["domain", "location", "category"] },
  },
  icp_search: {
    source_type: "icp_search", label: "ICP / normal leads", entity_type: "mixed", enabled: true,
    // ICP resolves to company_search (account-first) or people_profiles; configured
    // as long as EITHER route is available (company route via Jobs is always on).
    any_of_actor_keys: ["apify_jobs", "apify_people_search"],
    fallback_actor_keys: ["apify_jobs"],
    required_fields: [], optional_fields: ["target_role", "company_category", "industry", "location", "count", "mode"],
    max_results_default: 5, max_results_cap: 50, estimated_cost_per_5: 0.05,
    unavailable_message: "ICP search needs a company or people actor, which isn't configured.",
    fallback_action: "company_search",
    output_contract: { required_fields: ["company"], optional_fields: ["title", "source_url", "domain", "location"] },
  },
  linkedin_intent_posts: {
    source_type: "linkedin_intent_posts", label: "LinkedIn intent posts", entity_type: "signal", enabled: true,
    primary_actor_key: "apify_linkedin_posts",
    required_fields: ["topic"], optional_fields: ["industry", "location", "count"],
    max_results_default: 5, max_results_cap: 20, estimated_cost_per_5: 0.08,
    unavailable_message: "LinkedIn intent posts needs the LinkedIn post-search actor, which isn't configured.",
    output_contract: { required_fields: ["source_url"], optional_fields: ["name", "title", "company"] },
  },
  competitor_engagement: {
    source_type: "competitor_engagement", label: "Competitor engagement", entity_type: "signal", enabled: true,
    primary_actor_key: "apify_linkedin_posts",
    fallback_actor_keys: ["apify_linkedin_post_comments"],
    required_fields: ["competitors"], optional_fields: ["topic", "industry", "count"],
    max_results_default: 5, max_results_cap: 20, estimated_cost_per_5: 0.08,
    unavailable_message: "Competitor engagement needs the LinkedIn post-search actor, which isn't configured.",
    fallback_action: "linkedin_intent_posts",
    output_contract: { required_fields: ["source_url"], optional_fields: ["name", "title", "company"] },
  },
  people_profiles: {
    source_type: "people_profiles", label: "Founder / profile search", entity_type: "contact", enabled: true,
    primary_actor_key: "apify_people_search",
    fallback_actor_keys: ["apify_linkedin_posts"],
    required_fields: ["target_role"], optional_fields: ["company_category", "industry", "location", "count"],
    max_results_default: 5, max_results_cap: 25, estimated_cost_per_5: 0.20,
    unavailable_message: "Profile search isn't configured yet. I can search account opportunities first, then find decision-makers once the people provider is enabled.",
    fallback_action: "company_search",
    output_contract: { required_fields: ["name", "source_url"], optional_fields: ["title", "company", "location"] },
  },
  linkedin_comments: {
    source_type: "linkedin_comments", label: "LinkedIn comments / engagement", entity_type: "signal", enabled: true,
    primary_actor_key: "apify_linkedin_post_comments",
    fallback_actor_keys: ["apify_linkedin_posts"],
    required_fields: [], optional_fields: ["post_url", "topic", "count"],
    max_results_default: 5, max_results_cap: 50, estimated_cost_per_5: 0.10,
    unavailable_message: "Comment/engagement scraping isn't configured. I can search LinkedIn intent posts on the same topic instead.",
    fallback_action: "linkedin_intent_posts",
    output_contract: { required_fields: ["source_url"], optional_fields: ["name", "title"] },
  },
  decision_makers: {
    source_type: "decision_makers", label: "Find decision-makers", entity_type: "contact", enabled: true,
    primary_actor_key: "apify_people_search",
    required_fields: [], optional_fields: ["persona"],
    max_results_default: 5, max_results_cap: 25, estimated_cost_per_5: 0.20,
    unavailable_message: "Finding decision-makers needs a people-search provider, which isn't configured yet. I can keep these as account opportunities or draft an account-level template instead.",
    fallback_action: "company_search",
    output_contract: { required_fields: ["name", "title", "source_url"], optional_fields: ["company", "location"] },
  },
};

function actorConfigured(key: string | undefined): boolean {
  if (!key) return false;
  const a = getActorByKey(key);
  return !!a && isActorRuntimeEnabled(a);
}

export type ResolvedCapability = SourceCapability & { configured: boolean };

/** Capability + runtime `configured` (env-gated). icp_search is configured when
 *  ANY of its routes is available; everything else needs its primary actor. */
export function getSourceCapability(sourceType: string | null | undefined): ResolvedCapability | null {
  // Accept the leadIntake alias `linkedin_posts` for `linkedin_intent_posts`.
  const key = (sourceType === "linkedin_posts" ? "linkedin_intent_posts" : sourceType) as CapabilitySourceType;
  const cap = CAPABILITIES[key];
  if (!cap) return null;
  const configured = cap.any_of_actor_keys
    ? cap.any_of_actor_keys.some(actorConfigured)
    : actorConfigured(cap.primary_actor_key);
  return { ...cap, configured };
}

export function isSourceConfigured(sourceType: string | null | undefined): boolean {
  return getSourceCapability(sourceType)?.configured ?? false;
}

/** All capabilities with runtime `configured` — for the selector + QA reports. */
export function listSourceCapabilities(): ResolvedCapability[] {
  return (Object.keys(CAPABILITIES) as CapabilitySourceType[]).map((k) => getSourceCapability(k)!);
}
