// actorInputSchemas: the expected GENERIC input shape for every actor Scout can
// run. NOTE: Agentory's Apify layer (toolRegistry.execSourceWithApify) takes a
// generic input — { query, location, role_keywords, max_results, user_input } —
// and each actor's `input_adapter` maps that to the actor's real Apify schema.
// So the "input" the planner/validator produce here is that GENERIC shape, NOT
// raw actor JSON. This keeps a single source of truth (the input_adapter owns
// the actor-specific mapping) and prevents hallucinated actor fields.
//
// Grounded in toolRegistry APIFY_ACTORS input_adapters + actorRegistry entries.

export type ActorInputFieldType = "string" | "number" | "boolean" | "array" | "object";

export type ActorInputField = {
  name: string;
  type: ActorInputFieldType;
  required?: boolean;
  description: string;
  examples?: unknown[];
  default?: unknown;
  allowed_values?: unknown[];
  // For user_input.* sub-fields, the dotted path (e.g. "user_input.keywords").
  path?: string;
};

export type LeadSourceType =
  | "hiring_signal"
  | "people_profiles"
  | "linkedin_intent_posts"
  | "linkedin_comments"
  | "competitor_engagement"
  | "company_search"
  | "icp_search";

export type ActorInputSchema = {
  actor_key: string;
  label: string;
  purpose: string;
  source_type: LeadSourceType;
  // The generic execSourceWithApify source_type alias this maps to (jobs,
  // people_profiles, linkedin_engagement, linkedin_comments).
  apify_source_type: string;
  expected_entity_type: "account" | "contact" | "signal";

  fields: ActorInputField[];

  max_results_field: string;
  query_fields: string[];
  location_fields?: string[];
  role_fields?: string[];
  strict_fields?: string[];
  // user_input.* keys this actor actually consumes (everything else is stripped).
  allowed_user_input_keys: string[];

  examples: Array<{
    user_request: string;
    input: Record<string, unknown>;
  }>;
};

// Shared generic fields (present on every Apify generic input).
const GENERIC_MAX: ActorInputField = {
  name: "max_results", type: "number", required: true,
  description: "Number of results to request, capped by the actor's max_safe_results.",
  examples: [5, 10, 25],
};
const GENERIC_QUERY: ActorInputField = {
  name: "query", type: "string",
  description: "Concise, high-signal search query. Never a raw paragraph or the full user message.",
  examples: ["GTM B2B SaaS", "RevOps Series B SaaS"],
};
const GENERIC_LOCATION: ActorInputField = {
  name: "location", type: "string",
  description: "Normalized location (city/country). Omit for global.",
  examples: ["USA", "London", "Remote"],
};
const GENERIC_ROLES: ActorInputField = {
  name: "role_keywords", type: "array",
  description: "Normalized role aliases used to widen role matching.",
  examples: [["GTM", "Sales", "Growth", "Account Executive", "SDR"]],
};

export const ACTOR_INPUT_SCHEMAS: Record<string, ActorInputSchema> = {
  apify_jobs: {
    actor_key: "apify_jobs",
    label: "Apify Jobs (LinkedIn Jobs)",
    purpose: "Find companies hiring for a role (hiring-intent accounts).",
    source_type: "hiring_signal",
    apify_source_type: "jobs",
    expected_entity_type: "account",
    fields: [
      GENERIC_QUERY, GENERIC_LOCATION, GENERIC_ROLES, GENERIC_MAX,
      { name: "user_input.keywords", path: "user_input.keywords", type: "string",
        description: "Optional explicit job keyword string; falls back to role_keywords joined, then query." },
    ],
    max_results_field: "max_results",
    query_fields: ["query", "user_input.keywords"],
    location_fields: ["location"],
    role_fields: ["role_keywords"],
    strict_fields: ["location"],
    allowed_user_input_keys: ["keywords", "urls", "scrapeCompany"],
    examples: [
      { user_request: "Find 5 companies hiring GTM roles in B2B SaaS in USA",
        input: { query: "GTM B2B SaaS", location: "USA", role_keywords: ["GTM", "Sales", "Growth", "Account Executive", "SDR"], max_results: 5 } },
    ],
  },

  apify_people_search: {
    actor_key: "apify_people_search",
    label: "Apify People Search (LinkedIn profiles)",
    purpose: "Find individual decision-maker / founder profiles (contacts).",
    source_type: "people_profiles",
    apify_source_type: "people_profiles",
    expected_entity_type: "contact",
    fields: [
      GENERIC_QUERY, GENERIC_LOCATION, GENERIC_ROLES, GENERIC_MAX,
      { name: "user_input.keywords", path: "user_input.keywords", type: "array",
        description: "Optional persona/search keyword phrases." },
    ],
    max_results_field: "max_results",
    query_fields: ["query"],
    location_fields: ["location"],
    role_fields: ["role_keywords"],
    strict_fields: ["location"],
    allowed_user_input_keys: ["keywords"],
    examples: [
      { user_request: "Find 5 healthcare AI founders in London",
        input: { query: "healthcare AI founder", location: "London", role_keywords: ["Founder", "Co-founder", "CEO"], max_results: 5 } },
    ],
  },

  apify_linkedin_posts: {
    actor_key: "apify_linkedin_posts",
    label: "Apify LinkedIn Post Search",
    purpose: "Find LinkedIn posts / people showing buying intent or competitor engagement (signals).",
    source_type: "linkedin_intent_posts",
    apify_source_type: "linkedin_engagement",
    expected_entity_type: "signal",
    fields: [
      GENERIC_QUERY, GENERIC_ROLES, GENERIC_LOCATION, GENERIC_MAX,
      { name: "user_input.keywords", path: "user_input.keywords", type: "array",
        description: "Pain/intent phrases or competitor terms to search posts for." },
      { name: "user_input.topics", path: "user_input.topics", type: "array", description: "Optional topic phrases." },
      { name: "user_input.companies", path: "user_input.companies", type: "array", description: "Optional competitor/company names." },
    ],
    max_results_field: "max_results",
    query_fields: ["query", "user_input.keywords"],
    location_fields: ["location"],
    role_fields: ["role_keywords"],
    allowed_user_input_keys: ["keywords", "topics", "companies"],
    examples: [
      { user_request: "Find people talking about Clay alternatives",
        input: { query: "Clay alternatives", max_results: 5, user_input: { keywords: ["Clay alternative", "switching from Clay", "Clay vs", "data enrichment tool"], companies: ["Clay"] } } },
    ],
  },

  apify_linkedin_post_comments: {
    actor_key: "apify_linkedin_post_comments",
    label: "Apify LinkedIn Post Comments",
    purpose: "Extract commenters from a specific LinkedIn post (contacts/signals).",
    source_type: "linkedin_comments",
    apify_source_type: "linkedin_comments",
    expected_entity_type: "signal",
    fields: [
      GENERIC_MAX,
      { name: "user_input.postUrls", path: "user_input.postUrls", type: "array", required: true,
        description: "LinkedIn post URLs to pull commenters from. Required — never invent." },
    ],
    max_results_field: "max_results",
    query_fields: [],
    allowed_user_input_keys: ["postUrls", "targetUrls"],
    examples: [
      { user_request: "Find people commenting on https://linkedin.com/posts/x",
        input: { max_results: 20, user_input: { postUrls: ["https://linkedin.com/posts/x"] } } },
    ],
  },
};

// competitor_engagement and company_search/icp_search reuse existing actors.
export const SOURCE_TYPE_TO_ACTOR: Record<LeadSourceType, string> = {
  hiring_signal: "apify_jobs",
  company_search: "apify_jobs",
  icp_search: "apify_people_search",
  people_profiles: "apify_people_search",
  linkedin_intent_posts: "apify_linkedin_posts",
  competitor_engagement: "apify_linkedin_posts",
  linkedin_comments: "apify_linkedin_post_comments",
};

export function getActorInputSchema(actorKey: string | null | undefined): ActorInputSchema | null {
  if (!actorKey) return null;
  return ACTOR_INPUT_SCHEMAS[actorKey] ?? null;
}

export function schemaForSourceType(sourceType: LeadSourceType | string | null | undefined): ActorInputSchema | null {
  if (!sourceType) return null;
  const actor = SOURCE_TYPE_TO_ACTOR[sourceType as LeadSourceType];
  return actor ? (ACTOR_INPUT_SCHEMAS[actor] ?? null) : null;
}

// The full set of generic top-level keys execSourceWithApify accepts. Anything
// else the planner emits is an unknown field and must be stripped.
export const GENERIC_TOP_LEVEL_KEYS = ["query", "location", "role_keywords", "max_results", "user_input"] as const;
