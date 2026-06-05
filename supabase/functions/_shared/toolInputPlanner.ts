// toolInputPlanner: turn a user prompt + intent into a concrete tool input plan.
// AI-first with a deterministic fallback parser that fills missing fields.
//
// Used by pilot-chat before delegating to orchestrate. The result is persisted on
// the plan/task so run-agent doesn't have to re-parse the prompt.

import { generateJson } from "./aiProvider.ts";
import type { Intent } from "./intentRouter.ts";

export type ExecutionMode = "fast" | "deep" | "outreach";
export type ToolName = "source_with_apify" | "scrape_url" | "search_web" | null;
export type SourceType = "jobs" | "companies" | "people" | "posts" | null;

export interface ToolInput {
  intent: Intent | string;
  tool_name: ToolName;
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

  // numbers
  const numMatch = t.match(/\b(\d{1,4})\b/);
  let max_results = numMatch ? Math.max(1, Math.min(200, parseInt(numMatch[1], 10))) : 25;

  // locations
  let location: string | null = null;
  for (const loc of LOCATIONS) {
    const re = new RegExp(`\\b${loc.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (re.test(t)) {
      location = loc.replace(/\b\w/g, (c) => c.toUpperCase());
      break;
    }
  }

  // roles
  const role_keywords: string[] = [];
  for (const r of ROLES) {
    if (new RegExp(`\\b${r}\\b`, "i").test(t)) role_keywords.push(r);
  }

  const needs_outreach = OUTREACH_WORDS.test(t) || SEND_WORDS.test(t);
  const needs_enrichment = ENRICH_WORDS.test(t);

  // source_type heuristic
  let source_type: SourceType = null;
  let tool_name: ToolName = null;
  if (intent === "source_signals" || /\b(find|source|hiring|companies|leads|prospects|candidates)\b/i.test(prompt)) {
    tool_name = "source_with_apify";
    source_type = "jobs"; // jobs is the only configured actor today
    if (/\bcompanies\b/i.test(prompt) && !/\bhiring\b/i.test(prompt)) source_type = "companies";
    if (/\b(post|linkedin posts?)\b/i.test(prompt)) source_type = "posts";
    if (/\bpeople\b/i.test(prompt)) source_type = "people";
  } else if (intent === "analyze_url" || /https?:\/\//.test(prompt)) {
    tool_name = "scrape_url";
  } else if (intent === "daily_brief" || intent === "content") {
    tool_name = "search_web";
  }

  // execution mode
  let execution_mode: ExecutionMode = "fast";
  if (needs_outreach) execution_mode = "outreach";
  else if (needs_enrichment) execution_mode = "deep";

  // missing fields
  const missing_fields: string[] = [];
  if (intent === "source_signals") {
    if (role_keywords.length === 0 && !/\b(hiring|company|companies|jobs?|founders?|leads?)\b/i.test(prompt)) {
      missing_fields.push("role_keywords");
    }
    if (!location && /\b(remote|anywhere|global)\b/i.test(prompt) === false && prompt.split(/\s+/).length < 5) {
      missing_fields.push("location");
    }
  }

  // confidence: high if we have role/location or explicit intent; low if "find leads" type
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
  };
}

// ---------- AI planner ----------

const PLANNER_PROMPT = `You are the tool input planner for ScreeningPilot.
Convert the user prompt into a JSON plan describing which tool to run and with what arguments.

Return ONLY this JSON shape (no prose, no markdown):
{
  "intent": "source_signals|analyze_url|rank_existing_leads|enrich_existing_leads|draft_outreach|send_requires_approval|content|daily_brief|simple_chat|unclear",
  "tool_name": "source_with_apify|scrape_url|search_web|null",
  "source_type": "jobs|companies|people|posts|null",
  "query": "the user's literal search intent",
  "role_keywords": ["lowercase role words"],
  "location": "primary location string or null",
  "max_results": 1-200,
  "needs_enrichment": boolean,
  "needs_outreach": boolean,
  "execution_mode": "fast|deep|outreach",
  "confidence": 0.0-1.0,
  "missing_fields": ["names of fields you couldn't infer"]
}

Rules:
- Default max_results = 25 unless user states a quantity.
- needs_outreach true if user asks to draft/email/message.
- needs_enrichment true if user asks to enrich/analyze/research a company.
- execution_mode: outreach > deep > fast (outreach implies deep).
- If user just says "Find leads" with no role/location, set confidence < 0.65 and put role_keywords/location in missing_fields.
- If a URL is present, tool_name = "scrape_url".
- For sourcing prompts, prefer tool_name = "source_with_apify" and source_type = "jobs".`;

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
    maxTokens: 600,
    jsonMode: true,
    functionName: "toolInputPlanner",
  });

  let merged: ToolInput = fb;

  if (ai.ok && ai.json && typeof ai.json === "object") {
    const o = ai.json as Partial<ToolInput>;
    merged = {
      intent: typeof o.intent === "string" ? o.intent : fb.intent,
      tool_name: (o.tool_name as ToolName) ?? fb.tool_name,
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
    };
  }

  // Hard rule: outreach implies deep enrichment pipeline.
  if (merged.needs_outreach) merged.execution_mode = "outreach";
  else if (merged.needs_enrichment && merged.execution_mode === "fast") merged.execution_mode = "deep";

  // Cost caps.
  merged.max_results = Math.max(1, Math.min(200, merged.max_results || 25));

  // Clarification gate.
  if (
    merged.intent === "source_signals" &&
    merged.confidence < 0.65 &&
    merged.missing_fields.length > 0
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
