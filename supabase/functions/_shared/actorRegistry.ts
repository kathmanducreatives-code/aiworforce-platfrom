// Actor Intelligence Layer.
// Single source of truth for which Apify actor / external tool to use per intent.
// Used by toolInputPlanner (Gemini) to choose the right actor, and by
// toolRegistry / run-agent to resolve `selected_actor_key` -> actor_id.

export type ActorEntry = {
  key: string;
  tool_name: "source_with_apify" | "scrape_url" | "search_web";
  provider?: string;
  actor_id: string | null;
  source_type: string | null;
  label: string;
  enabled: boolean;
  best_for: string[];
  not_for: string[];
  example_user_requests?: string[];
  output_type: string;
  default_max_results?: number;
  max_safe_results?: number;
  compliance_level: string;
  missing_message?: string;
  required_env?: string;
};

export const ACTOR_REGISTRY: Record<string, ActorEntry> = {
  apify_jobs: {
    key: "apify_jobs",
    tool_name: "source_with_apify",
    actor_id: "curious_coder/linkedin-jobs-scraper",
    source_type: "jobs",
    label: "LinkedIn Jobs Scraper",
    enabled: true,
    best_for: [
      "finding companies hiring for specific roles",
      "job openings by keyword and location",
      "hiring intent signals",
      "companies hiring engineers/marketers/GTM/sales roles",
    ],
    not_for: [
      "finding individual people profiles",
      "finding founder phone numbers",
      "finding candidate contact details",
      "scraping LinkedIn profiles",
    ],
    example_user_requests: [
      "Find companies hiring marketing roles in London",
      "Find SaaS companies hiring GTM roles in the US",
      "Find companies hiring engineers in London",
    ],
    output_type: "job_posts_and_hiring_companies",
    default_max_results: 25,
    max_safe_results: 100,
    compliance_level: "public_jobs",
    required_env: "APIFY_API_TOKEN",
  },
  apify_indeed_jobs: {
    key: "apify_indeed_jobs",
    tool_name: "source_with_apify",
    actor_id: "curious_coder/indeed-scraper",
    source_type: "indeed_jobs",
    label: "Indeed Jobs Scraper",
    enabled: false,
    best_for: ["Indeed job listings", "non-LinkedIn hiring signals", "backup job source"],
    not_for: ["individual people profiles", "private contact data"],
    output_type: "job_posts_and_hiring_companies",
    default_max_results: 25,
    compliance_level: "public_jobs",
    required_env: "APIFY_API_TOKEN",
  },
  apify_website_content: {
    key: "apify_website_content",
    tool_name: "source_with_apify",
    actor_id: "apify/website-content-crawler",
    source_type: "website_content",
    label: "Website Content Crawler",
    enabled: false,
    best_for: [
      "crawling multiple pages from a website",
      "extracting clean Markdown/text for LLM use",
      "website content fallback if Firecrawl fails",
      "knowledge-base style website extraction",
    ],
    not_for: ["job search", "people search"],
    output_type: "website_markdown_content",
    compliance_level: "public_web",
    required_env: "APIFY_API_TOKEN",
  },
  apify_custom_web: {
    key: "apify_custom_web",
    tool_name: "source_with_apify",
    actor_id: "apify/web-scraper",
    source_type: "custom_web",
    label: "Generic Web Scraper",
    enabled: false,
    best_for: [
      "custom directories",
      "niche job boards",
      "special websites where no dedicated actor exists",
    ],
    not_for: ["broad search by default", "people/private data without consent"],
    output_type: "custom_structured_results",
    compliance_level: "public_web_custom",
    required_env: "APIFY_API_TOKEN",
  },
  firecrawl_scrape_url: {
    key: "firecrawl_scrape_url",
    tool_name: "scrape_url",
    provider: "firecrawl",
    actor_id: null,
    source_type: null,
    label: "Firecrawl",
    enabled: true,
    best_for: [
      "specific URL extraction",
      "company website analysis",
      "careers page analysis",
      "pricing/about/customer page extraction",
      "single-page or small-site enrichment",
    ],
    not_for: ["broad search", "finding people across the web"],
    output_type: "page_markdown_and_summary",
    compliance_level: "public_web",
    required_env: "FIRECRAWL_API_KEY",
  },
  search_web: {
    key: "search_web",
    tool_name: "search_web",
    provider: "gemini_or_lovable_search",
    actor_id: null,
    source_type: "search",
    label: "Gemini/Lovable Search",
    enabled: false,
    best_for: [
      "broad current web search",
      "market updates",
      "competitor news",
      "discovery when no structured actor fits",
    ],
    not_for: ["claiming current facts if grounded search is unavailable"],
    output_type: "search_results_with_citations",
    compliance_level: "public_search",
  },
  people_profile_actor: {
    key: "people_profile_actor",
    tool_name: "source_with_apify",
    actor_id: null,
    source_type: "people_profiles",
    label: "People/Profile Actor",
    enabled: false,
    best_for: [
      "finding individual candidates",
      "finding engineer profiles",
      "finding founder profiles",
      "people search",
    ],
    not_for: [],
    output_type: "people_profiles",
    compliance_level: "requires_explicit_opt_in",
    missing_message:
      "Individual people/profile sourcing is not configured yet. I can find companies hiring those roles using the jobs actor.",
  },
};

export function getActorByKey(key: string | null | undefined): ActorEntry | null {
  if (!key) return null;
  return ACTOR_REGISTRY[key] ?? null;
}

export function isActorRuntimeEnabled(entry: ActorEntry): boolean {
  if (!entry.enabled) return false;
  if (entry.required_env) {
    try {
      // @ts-ignore Deno global at runtime in edge functions
      if (typeof Deno !== "undefined" && !Deno.env.get(entry.required_env)) return false;
    } catch { /* ignore */ }
  }
  return true;
}

export function getEnabledActors(): ActorEntry[] {
  return Object.values(ACTOR_REGISTRY).filter(isActorRuntimeEnabled);
}

export function summarizeRegistryForPrompt(): string {
  return Object.values(ACTOR_REGISTRY).map((a) => {
    const status = isActorRuntimeEnabled(a) ? "ENABLED" : "DISABLED";
    const lines = [
      `- ${a.key} [${status}] tool=${a.tool_name}${a.actor_id ? ` actor=${a.actor_id}` : ""}${a.source_type ? ` source_type=${a.source_type}` : ""}`,
      `  label: ${a.label}`,
      `  best_for: ${a.best_for.join("; ")}`,
    ];
    if (a.not_for.length > 0) lines.push(`  not_for: ${a.not_for.join("; ")}`);
    if (a.example_user_requests?.length) lines.push(`  examples: ${a.example_user_requests.join(" | ")}`);
    if (!a.enabled && a.missing_message) lines.push(`  missing: ${a.missing_message}`);
    return lines.join("\n");
  }).join("\n\n");
}

// Disambiguation regexes used by the planner fallback.
export const PEOPLE_INTENT_RE =
  /\b(individual|specific)\s+(people|candidates?|profiles?|persons?)\b|\b(individual\s+\w+\s+(profiles?|candidates?))\b|\b(profile|profiles|phone numbers?|emails?|linkedin profiles?)\b/i;
export const COMPANY_INTENT_RE =
  /\b(compan(?:y|ies)|hiring|hir(?:e|es|ed)|jobs?|roles?|openings?|careers?|recruit)/i;
export const AMBIGUOUS_ROLE_RE =
  /\b(find|source|get|show)\b.*\b(engineers?|developers?|marketers?|designers?|founders?|recruiters?|sales|sdrs?|bdrs?|people)\b/i;
