// toolInputPlanner: turn a user prompt + intent into a concrete tool input plan.
// AI-first with a deterministic fallback parser that fills missing fields.

import { generateJson } from "./aiProvider.ts";
import {
  ACTOR_REGISTRY,
  getActorByKey,
  isActorRuntimeEnabled,
  summarizeRegistryForPrompt,
  PEOPLE_INTENT_RE,
  COMPANY_INTENT_RE,
  INDEED_INTENT_RE,
  ADVANCED_JOBS_INTENT_RE,
  ENRICHMENT_INTENT_RE,
  MULTIPAGE_CRAWL_INTENT_RE,
  LINKEDIN_PROFILE_URL_RE,
  URL_RE,
} from "./actorRegistry.ts";
import { getAgentorySystemPrompt, AGENTORY_SYSTEM_PROMPT_VERSION } from "./agentorySystemPrompt.ts";

export type ExecutionMode = "fast" | "deep" | "outreach";
export type ToolName = "source_with_apify" | "scrape_url" | "search_web" | null;
export type SourceType =
  | "jobs" | "advanced_jobs" | "indeed_jobs" | "website_content" | "custom_web"
  | "people_profiles" | "profile_enrichment" | "search" | null;

export interface ToolInput {
  /**
   * What the delegating route is asking orchestrate to stage.
   *
   * A plain string. It was `Intent | string`, where `Intent` was
   * `intentRouter`'s union — a classifier's vocabulary leaking into the wire
   * contract, so the type of a field orchestrate reads depended on a module that
   * read English. Every value is supplied by a route now.
   */
  intent: string;
  tool_name: ToolName;
  selected_actor_key: string | null;
  source_type: SourceType;
  query: string;
  role_keywords: string[];
  location: string | null;
  max_results: number;
  needs_enrichment: boolean;
  needs_outreach: boolean;
  execution_mode: ExecutionMode;
  confidence: number;
  missing_fields: string[];
  reason: string | null;
  ask_clarification?: boolean;
  clarification?: string;
  clarification_type?: "people_vs_companies" | "people_unavailable" | "people_vs_agency" | "generic";
  people_action?: ToolInput | null;
  companies_action?: ToolInput | null;
  agency_action?: ToolInput | null;
  // Advisory fields from Gemini intent normalization (non-breaking, optional).
  business_goal?: string;
  remote_ok?: boolean;
  seniority?: string | null;
}

// ---------- Deterministic fallback parser ----------

const LOCATIONS = [
  "london", "uk", "united kingdom", "us", "usa", "united states", "europe", "eu",
  "remote", "berlin", "paris", "dublin", "amsterdam", "nyc", "new york", "sf",
  "san francisco", "la", "los angeles", "boston", "austin", "seattle", "toronto",
  "singapore", "dubai", "tokyo", "sydney", "melbourne", "madrid", "barcelona",
];
const ROLES = [
  "engineer", "developer", "react", "frontend", "backend", "fullstack", "full-stack",
  "marketing", "marketer", "growth", "sales", "gtm", "sdr", "bdr", "designer",
  "product", "ops", "founder", "cto", "cmo", "ceo", "recruiter", "data", "ml", "ai",
];
const OUTREACH_WORDS = /\b(draft|outreach|email|message|dm|sequence|cold|reach out|follow up)\b/i;
const ENRICH_WORDS = /\b(enrich|analy[sz]e website|research|deep dive|score|top \d+)\b/i;
const SEND_WORDS = /\b(send|deliver|fire off)\b/i;

function clampForActor(actorKey: string | null, requested: number): number {
  const a = getActorByKey(actorKey);
  if (!a) return Math.max(1, Math.min(200, requested || 5));
  const def = a.default_max_results ?? a.default_max_pages ?? 5;
  const max = a.max_safe_results ?? a.max_safe_pages ?? 100;
  return Math.max(1, Math.min(max, requested || def));
}

// `fallbackParse` stood here: a regex reading of the sentence used when the
// planner's model call failed. A degraded second reader is still a second
// reader, and it had no callers left once the planner went.


// ── THE PLANNER IS GONE; THE CONTRACT REMAINS ───────────────────────────────
//
// `planToolInput` read the user's sentence — with a model, and with a regex
// table under it — to choose a tool and an actor. It was the THIRD reader of the
// same words, after `workflowClassifier` and Chat Brain, and the last one to
// speak won.
//
// Provider selection is not a language question. It is decided from a compiled
// mission by `buildCapabilityGraph` and the actor registry, and for the narrow
// surfaces from the route itself — a page gets Firecrawl because the reference
// IS a page, not because a regex found "http" in a sentence.
//
// `ToolInput` and the enums above STAY. They are the wire contract orchestrate
// and run-agent read, spoken by every route that delegates. Deleting this file
// for its name would have taken that contract with it.


export const COST_CAPS = {
  FIRECRAWL_ENRICH_MAX: 5,
  PENN_DRAFTS_MAX: 5,
  APIFY_MAX_RESULTS: 200,
} as const;
