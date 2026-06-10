// toolInputPlanner: turn a user prompt + intent into a concrete tool input plan.
// AI-first with a deterministic fallback parser that fills missing fields.

import { generateJson } from "./aiProvider.ts";
import type { Intent } from "./intentRouter.ts";
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
  intent: Intent | string;
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
  if (!a) return Math.max(1, Math.min(200, requested || 25));
  const def = a.default_max_results ?? a.default_max_pages ?? 25;
  const max = a.max_safe_results ?? a.max_safe_pages ?? 100;
  return Math.max(1, Math.min(max, requested || def));
}

export function fallbackParse(prompt: string, intent: Intent | string): ToolInput {
  const t = prompt.toLowerCase();

  const numMatch = t.match(/\b(\d{1,4})\b/);
  let max_results = numMatch ? Math.max(1, Math.min(200, parseInt(numMatch[1], 10))) : 25;

  let location: string | null = null;
  for (const loc of LOCATIONS) {
    const re = new RegExp(`\\b${loc.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (re.test(t)) {
      location = loc.replace(/\b\w/g, (c) => c.toUpperCase());
      break;
    }
  }

  const role_keywords: string[] = [];
  for (const r of ROLES) {
    if (new RegExp(`\\b${r}\\b`, "i").test(t)) role_keywords.push(r);
  }

  const needs_outreach = OUTREACH_WORDS.test(t) || SEND_WORDS.test(t);
  const needs_enrichment = ENRICH_WORDS.test(t);

  // Decide tool/actor from text shape.
  let tool_name: ToolName = null;
  let selected_actor_key: string | null = null;
  let source_type: SourceType = null;
  let reason: string | null = null;

  const hasUrl = URL_RE.test(prompt);
  const hasLinkedInProfile = LINKEDIN_PROFILE_URL_RE.test(prompt);
  const mentionsIndeed = INDEED_INTENT_RE.test(prompt);
  const mentionsAdvanced = ADVANCED_JOBS_INTENT_RE.test(prompt);
  const mentionsCrawl = MULTIPAGE_CRAWL_INTENT_RE.test(prompt);
  const mentionsEnrichment = ENRICHMENT_INTENT_RE.test(prompt);

  if (hasLinkedInProfile && mentionsEnrichment) {
    tool_name = "source_with_apify";
    selected_actor_key = "apify_profile_enrichment";
    source_type = "profile_enrichment";
    reason = "LinkedIn profile URL + enrichment intent — profile enrichment actor.";
  } else if (hasUrl && mentionsCrawl) {
    tool_name = "source_with_apify";
    selected_actor_key = "apify_website_content";
    source_type = "website_content";
    reason = "URL + multi-page crawl intent — Apify website content crawler.";
  } else if (intent === "analyze_url" || hasUrl) {
    tool_name = "scrape_url";
    selected_actor_key = "firecrawl_scrape_url";
    reason = "Prompt contains a URL — Firecrawl is the right tool for page extraction.";
  } else if (mentionsIndeed) {
    tool_name = "source_with_apify";
    selected_actor_key = "apify_indeed_jobs";
    source_type = "indeed_jobs";
    reason = "User asked for Indeed / non-LinkedIn — Indeed Jobs actor.";
  } else if (mentionsAdvanced && COMPANY_INTENT_RE.test(prompt)) {
    tool_name = "source_with_apify";
    selected_actor_key = "apify_advanced_linkedin_jobs";
    source_type = "advanced_jobs";
    reason = "Advanced/boolean LinkedIn job search requested.";
  } else if (
    PEOPLE_INTENT_RE.test(prompt)
    && !COMPANY_INTENT_RE.test(prompt)
  ) {
    tool_name = "source_with_apify";
    selected_actor_key = "apify_people_search";
    source_type = "people_profiles";
    reason = "Explicit individual/people/profile language — LinkedIn Profile Search actor.";
  } else if (
    intent === "source_signals" ||
    COMPANY_INTENT_RE.test(prompt) ||
    /\b(find|source|leads|prospects|candidates|engineers?|developers?|marketers?|people)\b/i.test(prompt)
  ) {
    tool_name = "source_with_apify";
    selected_actor_key = "apify_jobs";
    source_type = "jobs";
    reason = "Hiring/role/location prompt — LinkedIn Jobs actor returns companies hiring for the role.";
  } else if (intent === "daily_brief" || intent === "content") {
    tool_name = "search_web";
    selected_actor_key = "search_web";
    source_type = "search";
    reason = "Broad/current information request — falls to search_web (may be unavailable).";
  }

  let execution_mode: ExecutionMode = "fast";
  if (needs_outreach) execution_mode = "outreach";
  else if (needs_enrichment) execution_mode = "deep";

  const missing_fields: string[] = [];
  if (intent === "source_signals") {
    if (role_keywords.length === 0 && !/\b(hiring|company|companies|jobs?|founders?|leads?)\b/i.test(prompt)) {
      missing_fields.push("role_keywords");
    }
    if (!location && /\b(remote|anywhere|global)\b/i.test(prompt) === false && prompt.split(/\s+/).length < 5) {
      missing_fields.push("location");
    }
  }

  const tokens = prompt.trim().split(/\s+/).length;
  let confidence = 0.5;
  if (tool_name) confidence += 0.2;
  if (role_keywords.length > 0) confidence += 0.15;
  if (location) confidence += 0.1;
  if (tokens < 3) confidence -= 0.3;
  if (missing_fields.length > 0) confidence -= 0.1;
  confidence = Math.max(0, Math.min(1, confidence));

  max_results = clampForActor(selected_actor_key, max_results);

  return {
    intent,
    tool_name,
    selected_actor_key,
    source_type,
    query: prompt,
    role_keywords,
    location,
    max_results,
    needs_enrichment,
    needs_outreach,
    execution_mode,
    confidence,
    missing_fields,
    reason,
  };
}

// ---------- AI planner ----------

const ACTOR_KEYS = Object.keys(ACTOR_REGISTRY).join("|");

const PLANNER_JSON_TAIL = `You are the tool/actor selection planner. Convert the user prompt into a JSON
plan describing which actor/tool to run. Use the actor_registry above as the
authoritative list — never invent actors not listed.

Return ONLY this JSON (no prose, no markdown):
{
  "intent": "source_companies|source_jobs|source_people|profile_enrichment|analyze_url|crawl_website|broad_search|draft_outreach|send_requires_approval|content|daily_brief|simple_chat|unclear",
  "selected_tool": "source_with_apify|scrape_url|search_web|none",
  "selected_actor_key": "${ACTOR_KEYS}|null",
  "source_type": "jobs|advanced_jobs|indeed_jobs|website_content|custom_web|people_profiles|profile_enrichment|search|null",
  "query": "literal search intent",
  "role_keywords": ["lowercase role words"],
  "location": "primary location or null",
  "max_results": 1-200,
  "needs_enrichment": boolean,
  "needs_outreach": boolean,
  "execution_mode": "fast|deep|outreach",
  "confidence": 0.0-1.0,
  "missing_fields": ["field names"],
  "requires_clarification": boolean,
  "clarification_question": "string or null",
  "reason": "one-sentence rationale"
}

Routing rules (apply in order):
1. LinkedIn profile URL + enrichment language -> "apify_profile_enrichment".
2. Any URL + multi-page crawl / "with apify" -> "apify_website_content".
3. Any URL otherwise -> "firecrawl_scrape_url".
4. "Indeed" / "avoid LinkedIn" -> "apify_indeed_jobs".
5. "advanced LinkedIn search" / "boolean search" + hiring/company words -> "apify_advanced_linkedin_jobs".
6. Niche directory / custom job board -> "apify_custom_web".
7. Explicit individual people / candidate profiles / "find <role> profiles" -> "apify_people_search". If that actor is DISABLED, set requires_clarification=true and offer companies-hiring fallback.
8. Hiring / companies / jobs / roles / openings / GTM/SDR/BDR -> "apify_jobs".
9. Ambiguous "Find N <role>s in <location>" without "companies hiring" or "individual profiles" -> requires_clarification=true. Pre-select "apify_jobs".
10. Broad market/news with no actor fit -> "search_web".

Never pick a DISABLED actor as the final answer without setting requires_clarification=true. needs_outreach implies execution_mode="outreach"; needs_enrichment implies "deep". Default max_results=25; clamp to the actor's max_safe_results.`;

function buildPlannerSystemPrompt(): string {
  return getAgentorySystemPrompt({
    taskType: "tool_parameter_extraction",
    currentAgent: "pilot",
    actorRegistrySummary: summarizeRegistryForPrompt(),
  }) + "\n\n" + PLANNER_JSON_TAIL;
}

export async function planToolInput(
  prompt: string,
  intent: Intent | string,
  companyBrain?: Record<string, unknown> | null,
): Promise<ToolInput> {
  const fb = fallbackParse(prompt, intent);

  const ai = await generateJson({
    taskType: "tool_input_planning",
    systemPrompt: buildPlannerSystemPrompt(),
    messages: [
      {
        role: "user",
        content: `USER PROMPT: ${prompt}\n\nDETECTED INTENT: ${intent}\n\nCOMPANY BRAIN: ${
          companyBrain ? JSON.stringify(companyBrain).slice(0, 2000) : "(empty)"
        }`,
      },
    ],
    temperature: 0.1,
    maxTokens: 700,
    jsonMode: true,
    functionName: "toolInputPlanner",
  });

  let merged: ToolInput = fb;

  if (ai.ok && ai.json && typeof ai.json === "object") {
    const o = ai.json as Record<string, any>;
    const aiActorKey = typeof o.selected_actor_key === "string" ? o.selected_actor_key : null;
    const aiTool = typeof o.selected_tool === "string" ? o.selected_tool : (typeof o.tool_name === "string" ? o.tool_name : null);
    merged = {
      intent: typeof o.intent === "string" ? o.intent : fb.intent,
      tool_name: (aiTool === "source_with_apify" || aiTool === "scrape_url" || aiTool === "search_web")
        ? aiTool
        : fb.tool_name,
      selected_actor_key: aiActorKey && getActorByKey(aiActorKey) ? aiActorKey : fb.selected_actor_key,
      source_type: (o.source_type as SourceType) ?? fb.source_type,
      query: typeof o.query === "string" && o.query.trim() ? o.query : fb.query,
      role_keywords: Array.isArray(o.role_keywords) && o.role_keywords.length > 0
        ? (o.role_keywords as string[]).map((s) => String(s).toLowerCase())
        : fb.role_keywords,
      location: typeof o.location === "string" && o.location.trim() ? o.location : fb.location,
      max_results: typeof o.max_results === "number"
        ? Math.max(1, Math.min(200, Math.floor(o.max_results)))
        : fb.max_results,
      needs_enrichment: typeof o.needs_enrichment === "boolean" ? o.needs_enrichment : fb.needs_enrichment,
      needs_outreach: typeof o.needs_outreach === "boolean" ? o.needs_outreach : fb.needs_outreach,
      execution_mode: (o.execution_mode === "fast" || o.execution_mode === "deep" || o.execution_mode === "outreach")
        ? o.execution_mode
        : fb.execution_mode,
      confidence: typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : fb.confidence,
      missing_fields: Array.isArray(o.missing_fields) ? (o.missing_fields as string[]) : fb.missing_fields,
      reason: typeof o.reason === "string" && o.reason.trim() ? o.reason : fb.reason,
      ask_clarification: o.requires_clarification === true ? true : undefined,
      clarification: typeof o.clarification_question === "string" && o.clarification_question.trim()
        ? o.clarification_question
        : undefined,
    };
  }

  if (merged.needs_outreach) merged.execution_mode = "outreach";
  else if (merged.needs_enrichment && merged.execution_mode === "fast") merged.execution_mode = "deep";

  // ---- Validate selected_actor_key / disabled-actor handling ----
  const actor = getActorByKey(merged.selected_actor_key);
  if (actor) {
    if (!isActorRuntimeEnabled(actor)) {
      const msg = actor.missing_message ?? `Actor "${actor.key}" is not configured.`;
      switch (actor.key) {
        case "apify_advanced_linkedin_jobs": {
          // Silent fallback to standard LinkedIn jobs.
          merged.selected_actor_key = "apify_jobs";
          merged.tool_name = "source_with_apify";
          merged.source_type = "jobs";
          merged.reason = `${msg} Falling back to LinkedIn Jobs.`;
          break;
        }
        case "apify_indeed_jobs": {
          merged.ask_clarification = true;
          merged.clarification = merged.clarification
            ?? `${msg} Should I use LinkedIn Jobs instead?`;
          merged.selected_actor_key = "apify_jobs";
          merged.tool_name = "source_with_apify";
          merged.source_type = "jobs";
          merged.reason = msg;
          break;
        }
        case "apify_people_search": {
          merged.ask_clarification = true;
          merged.clarification = merged.clarification
            ?? `${msg} Want me to find companies hiring those roles instead?`;
          merged.selected_actor_key = null;
          merged.tool_name = null;
          merged.source_type = null;
          merged.reason = msg;
          break;
        }
        case "apify_profile_enrichment": {
          merged.ask_clarification = true;
          merged.clarification = merged.clarification ?? msg;
          merged.selected_actor_key = null;
          merged.tool_name = null;
          merged.source_type = null;
          merged.reason = msg;
          break;
        }
        case "apify_website_content":
        case "apify_custom_web": {
          merged.ask_clarification = true;
          if (URL_RE.test(prompt)) {
            merged.clarification = merged.clarification
              ?? `${msg} I can try Firecrawl on that URL instead.`;
            merged.selected_actor_key = "firecrawl_scrape_url";
            merged.tool_name = "scrape_url";
            merged.source_type = null;
          } else {
            merged.clarification = merged.clarification ?? msg;
            merged.selected_actor_key = null;
            merged.tool_name = null;
            merged.source_type = null;
          }
          merged.reason = msg;
          break;
        }
        default: {
          // Generic disabled — fall back to firecrawl on URL else jobs.
          if (URL_RE.test(prompt)) {
            merged.selected_actor_key = "firecrawl_scrape_url";
            merged.tool_name = "scrape_url";
            merged.source_type = null;
          } else {
            merged.selected_actor_key = "apify_jobs";
            merged.tool_name = "source_with_apify";
            merged.source_type = "jobs";
          }
          merged.reason = `${msg} Falling back to ${merged.selected_actor_key}.`;
        }
      }
    } else {
      merged.tool_name = actor.tool_name;
      if (actor.source_type) merged.source_type = actor.source_type as SourceType;
    }
  }

  // ---- People-intent guard (independent of AI) ----
  const explicitPeople = PEOPLE_INTENT_RE.test(prompt)
    && !/\bhiring\b|\bcompan(?:y|ies)\b|\bjobs?\b/i.test(prompt);
  const peopleActorEnabled = isActorRuntimeEnabled(ACTOR_REGISTRY.apify_people_search);
  if (explicitPeople && !peopleActorEnabled) {
    const msg = ACTOR_REGISTRY.apify_people_search.missing_message!;
    merged.ask_clarification = true;
    merged.clarification = merged.clarification
      ?? `${msg} Want me to find companies hiring for that role instead?`;
    merged.clarification_type = "people_unavailable";
    merged.selected_actor_key = null;
    merged.tool_name = null;
    merged.source_type = null;
    merged.reason = msg;
  }

  // ---- Ambiguous role+location (case-insensitive, location-aware) ----
  const hasRoleWord = /\b(engineers?|developers?|marketers?|designers?|founders?|recruiters?|sales|sdrs?|bdrs?|people)\b/i.test(prompt);
  const hasLocationHint = !!merged.location || /\bin\s+[\w-]+/i.test(prompt);
  const ambiguousRoleLoc =
    !explicitPeople
    && hasRoleWord
    && hasLocationHint
    && !COMPANY_INTENT_RE.test(prompt)
    && !/\bindividual\b/i.test(prompt);
  if (ambiguousRoleLoc) {
    const role = (merged.role_keywords[0] ?? "people");
    const loc = merged.location ?? "that location";
    const peopleOption = peopleActorEnabled
      ? `individual ${role} profiles`
      : `individual ${role} profiles (not configured yet)`;
    if (!merged.ask_clarification) {
      merged.ask_clarification = true;
      merged.clarification = `Do you want ${peopleOption}, or companies hiring ${role}s in ${loc}?`;
    }
    // Always tag people_vs_companies for ambiguous role+location, even if the
    // AI planner also set ask_clarification without a clarification_type.
    merged.clarification_type = "people_vs_companies";
    // Do NOT pre-commit a tool while waiting on the user.
    merged.selected_actor_key = null;
    merged.tool_name = null;
    merged.source_type = null;
    merged.reason = merged.reason ?? "Ambiguous role+location prompt — awaiting people-vs-companies clarification.";
  }

  // ---- Build people_action / companies_action when a clarification is pending ----
  // Trigger when the clarification is explicitly typed, OR when we're asking a
  // clarification on a prompt that has both a role word and a location hint
  // (covers AI-planner clarifications that didn't set clarification_type).
  const shouldBuildClarificationActions =
    merged.ask_clarification && (
      merged.clarification_type === "people_vs_companies"
      || merged.clarification_type === "people_unavailable"
      || (hasRoleWord && hasLocationHint)
    );
  if (shouldBuildClarificationActions && !merged.clarification_type) {
    merged.clarification_type = "people_vs_companies";
  }
  if (shouldBuildClarificationActions) {
    const baseRoleKw = merged.role_keywords;
    const baseLoc = merged.location;
    const baseQuery = (baseRoleKw.length > 0 ? baseRoleKw.join(" ") : prompt).slice(0, 200);
    const baseMax = merged.max_results || 10;

    const companies_action: ToolInput = {
      intent: "source_companies_hiring",
      tool_name: "source_with_apify",
      selected_actor_key: "apify_jobs",
      source_type: "jobs",
      query: baseQuery,
      role_keywords: baseRoleKw,
      location: baseLoc,
      max_results: clampForActor("apify_jobs", baseMax),
      needs_enrichment: merged.needs_enrichment,
      needs_outreach: merged.needs_outreach,
      execution_mode: merged.execution_mode,
      confidence: 0.8,
      missing_fields: [],
      reason: "Resolved from clarification: companies hiring.",
    };
    merged.companies_action = companies_action;

    if (peopleActorEnabled) {
      merged.people_action = {
        intent: "source_people_profiles",
        tool_name: "source_with_apify",
        selected_actor_key: "apify_people_search",
        source_type: "people_profiles",
        query: baseQuery,
        role_keywords: baseRoleKw,
        location: baseLoc,
        max_results: clampForActor("apify_people_search", baseMax),
        needs_enrichment: merged.needs_enrichment,
        needs_outreach: merged.needs_outreach,
        execution_mode: merged.execution_mode,
        confidence: 0.8,
        missing_fields: [],
        reason: "Resolved from clarification: individual profiles.",
      };
    } else {
      merged.people_action = null;
    }
  }

  // Low-confidence sourcing clarification gate.
  if (
    !merged.ask_clarification
    && merged.intent === "source_signals"
    && merged.confidence < 0.65
    && merged.missing_fields.length > 0
  ) {
    merged.ask_clarification = true;
    const need = merged.missing_fields.includes("role_keywords") && merged.missing_fields.includes("location")
      ? "What kind of leads (role/company type) and where (location)?"
      : merged.missing_fields.includes("role_keywords")
      ? "Which role or industry should I focus on?"
      : "Which location should I focus on?";
    merged.clarification = need;
  }

  // Final per-actor result cap.
  merged.max_results = clampForActor(merged.selected_actor_key, merged.max_results);

  return merged;
}

// Hard caps used by run-agent.
export const COST_CAPS = {
  FIRECRAWL_ENRICH_MAX: 5,
  PENN_DRAFTS_MAX: 5,
  APIFY_MAX_RESULTS: 200,
} as const;
