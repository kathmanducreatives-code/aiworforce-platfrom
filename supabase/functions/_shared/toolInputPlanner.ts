// toolInputPlanner: turn a user prompt + intent into a concrete tool input plan.
// AI-first with a deterministic fallback parser that fills missing fields.
//
// Used by pilot-chat before delegating to orchestrate. The result is persisted on
// the plan/task so run-agent doesn't have to re-parse the prompt.

import { generateJson } from "./aiProvider.ts";
import type { Intent } from "./intentRouter.ts";
import {
  ACTOR_REGISTRY,
  getActorByKey,
  isActorRuntimeEnabled,
  summarizeRegistryForPrompt,
  PEOPLE_INTENT_RE,
  COMPANY_INTENT_RE,
} from "./actorRegistry.ts";

export type ExecutionMode = "fast" | "deep" | "outreach";
export type ToolName = "source_with_apify" | "scrape_url" | "search_web" | null;
export type SourceType = "jobs" | "indeed_jobs" | "website_content" | "custom_web" | "people_profiles" | "search" | null;

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
const ENRICH_WORDS = /\b(enrich|analy[sz]e website|research|deep dive|score|profile)\b/i;
const SEND_WORDS = /\b(send|deliver|fire off)\b/i;

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

  if (intent === "analyze_url" || /https?:\/\//.test(prompt)) {
    tool_name = "scrape_url";
    selected_actor_key = "firecrawl_scrape_url";
    reason = "Prompt contains a URL — Firecrawl is the right tool for page extraction.";
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

const PLANNER_PROMPT = `You are the tool/actor selection planner for ScreeningPilot.
Convert the user prompt into a JSON plan describing which actor/tool to run.

ACTOR REGISTRY (authoritative — never invent actors not listed here):
${summarizeRegistryForPrompt()}

Return ONLY this JSON shape (no prose, no markdown):
{
  "intent": "source_companies|source_jobs|source_people|analyze_url|broad_search|draft_outreach|send_requires_approval|content|daily_brief|simple_chat|unclear",
  "selected_tool": "source_with_apify|scrape_url|search_web|none",
  "selected_actor_key": "apify_jobs|apify_indeed_jobs|apify_website_content|apify_custom_web|firecrawl_scrape_url|search_web|people_profile_actor|null",
  "source_type": "jobs|indeed_jobs|website_content|custom_web|people_profiles|search|null",
  "query": "the user's literal search intent",
  "role_keywords": ["lowercase role words"],
  "location": "primary location string or null",
  "max_results": 1-200,
  "needs_enrichment": boolean,
  "needs_outreach": boolean,
  "execution_mode": "fast|deep|outreach",
  "confidence": 0.0-1.0,
  "missing_fields": ["names of fields you couldn't infer"],
  "requires_clarification": boolean,
  "clarification_question": "string or null",
  "reason": "one-sentence rationale for the selected actor/tool"
}

Selection rules:
- Match the prompt to the actor whose best_for fits and not_for does NOT fit.
- A URL anywhere in the prompt -> selected_actor_key="firecrawl_scrape_url", selected_tool="scrape_url".
- Hiring / companies / roles / jobs / openings language -> selected_actor_key="apify_jobs".
- People / individual profiles / candidates / founders / phone numbers / emails / LinkedIn profiles -> intent="source_people", selected_actor_key="people_profile_actor". Because that actor is DISABLED, set requires_clarification=true and use clarification_question to ask whether to instead find companies hiring for that role (via apify_jobs).
- Ambiguous "Find N <role>s in <location>" without "companies hiring" or "individual profiles" -> set requires_clarification=true and ask: "Do you want individual <role> profiles, or companies hiring <role>s in <location>? I can currently source companies/jobs via Apify Jobs." Still suggest selected_actor_key="apify_jobs" as the proceed-if-confirmed default.
- needs_outreach implies execution_mode="outreach"; needs_enrichment implies "deep".
- send_email / "send the outreach" -> intent="send_requires_approval".
- Default max_results = 25 unless user specifies a number.
- Never pick a DISABLED actor as the final answer without setting requires_clarification=true.`;

export async function planToolInput(
  prompt: string,
  intent: Intent | string,
  companyBrain?: Record<string, unknown> | null,
): Promise<ToolInput> {
  const fb = fallbackParse(prompt, intent);

  const ai = await generateJson({
    taskType: "tool_input_planning",
    systemPrompt: PLANNER_PROMPT,
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

  // Hard rule: outreach implies deep pipeline.
  if (merged.needs_outreach) merged.execution_mode = "outreach";
  else if (merged.needs_enrichment && merged.execution_mode === "fast") merged.execution_mode = "deep";

  merged.max_results = Math.max(1, Math.min(200, merged.max_results || 25));

  // Validate selected_actor_key. If disabled or unknown, fall back.
  const actor = getActorByKey(merged.selected_actor_key);
  if (actor) {
    if (!isActorRuntimeEnabled(actor)) {
      // Disabled actor selected → either ask clarification (people) or fall back to jobs.
      if (actor.key === "people_profile_actor") {
        merged.ask_clarification = true;
        merged.clarification = merged.clarification
          ?? `${actor.missing_message ?? "That actor is not configured."} Want me to find companies hiring instead?`;
        merged.selected_actor_key = null;
        merged.tool_name = null;
        merged.source_type = null;
        merged.reason = actor.missing_message ?? merged.reason;
      } else {
        // Other disabled actor — fall back to jobs if hiring shape, else firecrawl if URL.
        if (/https?:\/\//.test(prompt)) {
          merged.selected_actor_key = "firecrawl_scrape_url";
          merged.tool_name = "scrape_url";
          merged.source_type = null;
        } else {
          merged.selected_actor_key = "apify_jobs";
          merged.tool_name = "source_with_apify";
          merged.source_type = "jobs";
        }
        merged.reason = `Requested actor "${actor.key}" is disabled — falling back to ${merged.selected_actor_key}.`;
      }
    } else {
      // Mirror tool/source_type from the actor to keep run-agent consistent.
      merged.tool_name = actor.tool_name;
      if (actor.source_type) merged.source_type = actor.source_type as SourceType;
    }
  }

  // People-intent guard (regardless of AI). Catches "individual profiles", explicit "people".
  const explicitPeople = PEOPLE_INTENT_RE.test(prompt)
    && !/\bhiring\b|\bcompan(?:y|ies)\b|\bjobs?\b/i.test(prompt);
  if (explicitPeople && !ACTOR_REGISTRY.people_profile_actor.enabled) {
    merged.ask_clarification = true;
    merged.clarification = merged.clarification
      ?? `${ACTOR_REGISTRY.people_profile_actor.missing_message} Want me to find companies hiring for that role instead?`;
    // Suppress silent jobs run.
    merged.selected_actor_key = null;
    merged.tool_name = null;
    merged.source_type = null;
    merged.reason = ACTOR_REGISTRY.people_profile_actor.missing_message;
  }

  // Ambiguous "find N <role>s in <location>" — ask, but pre-select apify_jobs.
  const ambiguousRoleLoc =
    !explicitPeople
    && /\b(engineers?|developers?|marketers?|designers?|founders?|recruiters?|people)\b/i.test(prompt)
    && /\bin\s+[A-Z]/.test(prompt)
    && !COMPANY_INTENT_RE.test(prompt)
    && !/\bindividual\b/i.test(prompt);
  if (ambiguousRoleLoc && !merged.ask_clarification) {
    const role = (merged.role_keywords[0] ?? "people");
    const loc = merged.location ?? "that location";
    merged.ask_clarification = true;
    merged.clarification =
      `Do you want individual ${role} profiles, or companies hiring ${role}s in ${loc}? I can currently source companies/jobs via Apify Jobs.`;
    merged.selected_actor_key = merged.selected_actor_key ?? "apify_jobs";
    merged.tool_name = "source_with_apify";
    merged.source_type = "jobs";
    merged.reason = merged.reason ?? "Ambiguous role+location prompt — defaulting to companies hiring if confirmed.";
  }

  // Low-confidence sourcing — generic clarification gate kept for compatibility.
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

  return merged;
}

// Hard caps used by run-agent.
export const COST_CAPS = {
  FIRECRAWL_ENRICH_MAX: 5,
  PENN_DRAFTS_MAX: 5,
  APIFY_MAX_RESULTS: 200,
} as const;
