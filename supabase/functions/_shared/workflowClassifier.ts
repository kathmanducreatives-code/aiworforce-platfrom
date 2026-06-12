// workflowClassifier: single source of truth for Agentory workflow routing.
//
// Pipeline:
//   user message
//     → classifyWorkflow()        (regex-first, Gemini fallback)
//     → normalizeIntent()         (clamp/coerce raw output)
//     → validateAgainstCapabilities() (in ./capabilityValidator.ts)
//
// Categories (14):
//   simple_chat | capabilities | daily_brief | content_creation |
//   market_research | url_analysis | signal_sourcing | people_sourcing |
//   company_hiring_sourcing | outreach | agent_management |
//   approval_review | unsafe_or_unsupported | unclear
//
// Compat: intentRouter.ts and toolInputPlanner.ts still exist. This module
// is the *decision* layer. toolInputPlanner is still used to fill structured
// tool args for sourcing categories so the existing people-vs-companies
// pending-clarification flow keeps working unchanged.

import { generateJson } from "./aiProvider.ts";
import {
  URL_RE,
  PEOPLE_INTENT_RE,
  COMPANY_INTENT_RE,
  LINKEDIN_PROFILE_URL_RE,
  ENRICHMENT_INTENT_RE,
  LINKEDIN_ENGAGEMENT_RE,
  LINKEDIN_ENTITY_URL_RE,
  COMMENT_DRAFT_INTENT_RE,
  DM_DRAFT_INTENT_RE,
} from "./actorRegistry.ts";

export type WorkflowCategory =
  | "simple_chat"
  | "capabilities"
  | "daily_brief"
  | "content_creation"
  | "market_research"
  | "url_analysis"
  | "signal_sourcing"
  | "people_sourcing"
  | "company_hiring_sourcing"
  | "outreach"
  | "agent_management"
  | "approval_review"
  | "unsafe_or_unsupported"
  | "unclear";

export type WorkflowExecutionMode =
  | "fast"
  | "deep"
  | "outreach"
  | "content"
  | "research"
  | "none";

export interface WorkflowDecision {
  workflow_category: WorkflowCategory;
  business_goal: string;
  intent: string;
  confidence: number;
  needs_clarification: boolean;
  clarification_question: string | null;
  agents: string[];
  execution_mode: WorkflowExecutionMode;
  selected_tool: string | null;
  selected_actor_key: string | null;
  source_type: string | null;
  query: string | null;
  role_keywords: string[];
  location: string | null;
  remote_ok: boolean;
  seniority: string | null;
  max_results: number;
  needs_enrichment: boolean;
  needs_outreach: boolean;
  requires_approval: boolean;
  possible_actions: string[];
  reason: string;
  source: "regex" | "ai" | "default";
  // Phase 3 — LinkedIn engagement signal sourcing (optional fields).
  signal_type?: string | null;
  keywords?: string[];
  needs_comment_drafts?: boolean;
  needs_dm_drafts?: boolean;
  competitor_related?: boolean;
}

const ALL_CATEGORIES: WorkflowCategory[] = [
  "simple_chat",
  "capabilities",
  "daily_brief",
  "content_creation",
  "market_research",
  "url_analysis",
  "signal_sourcing",
  "people_sourcing",
  "company_hiring_sourcing",
  "outreach",
  "agent_management",
  "approval_review",
  "unsafe_or_unsupported",
  "unclear",
];

const ALL_EXECUTION_MODES: WorkflowExecutionMode[] = [
  "fast", "deep", "outreach", "content", "research", "none",
];

// ---------- Regex layer ----------

const GREETING_RE =
  /^\s*(hi|hello|hey|yo|sup|gm|good (morning|afternoon|evening)|thanks|thank you|ty|cool|nice|ok|okay|got it|cheers)[\s.!?]*$/i;

const CAPABILITY_RE =
  /\b(what can you do|what are your (features|capabilities)|what can agentory do|what do you do|how do you work|how can you help|what is (this|agentory|pilot)|who are you|help me understand)\b/i;

const DAILY_BRIEF_RE =
  /\b(daily brief|brief me( on today)?|today'?s (command )?brief|what (happened|should i know) today|plan my day|what needs my attention)\b/i;

// Content authoring (post, write, draft, summarize into report/brief).
// Must NOT match outreach (email/dm/message) — outreach handled separately.
const CONTENT_CREATION_RE =
  /\b(write|draft|create|compose|post|publish|turn (this|that|it) into|summari[sz]e (this|that|into))\b.*\b(linkedin post|tweet|thread|blog|article|launch post|founder update|newsletter|memo|report|brief|content for|social post|caption)\b|\b(linkedin post|launch post|founder update|founder post|content for linkedin)\b/i;

const MARKET_RESEARCH_RE =
  /\b(what changed in|what(?:'?s| is) (?:happening|new) in|current (?:state|status|news|trends?)|latest (?:news|updates?|trends?)|market (?:update|news|trends?|research)|competitor (?:updates?|news|moves?)|what'?s? trending|industry (?:news|trends?))\b/i;

const AGENT_MANAGEMENT_RE =
  /\b(what (is|are) (scout|aria|hawk|penn|scribe|pilot) (working on|doing)|what can (scout|aria|hawk|penn|scribe) do|which agents?|show me my agents?|list (my )?agents?|what agents do i have|my workforce)\b/i;

const APPROVAL_REVIEW_RE =
  /\b((what|which|any) approvals? (are )?(pending|waiting|to review)|pending approvals?|drafts? (?:waiting|pending|to (?:review|approve))|approve (penn'?s? )?drafts?|show me (?:my )?(?:pending )?approvals?)\b/i;

// Outreach (drafting). Note: separate from outreach AS PART OF sourcing.
const OUTREACH_RE =
  /\b(draft (?:an? )?(?:outreach|email|dm|message|sequence|cold (?:email|outreach))|write (?:(?:linkedin |cold )?(?:emails?|dms?|messages?|outreach))|create (?:linkedin )?dms?|outreach to (?:the )?(?:top )?(?:leads?|prospects?|companies))\b/i;

const SEND_RE = /\b(send|deliver|fire off|blast)\s+(?:emails?|messages?|outreach)\b/i;

// Unsafe / unsupported.
const UNSAFE_RE =
  /\b(personal phone numbers?|home address|scrape private|private personal data|harvest emails for spam|send (?:emails?|messages?) automatically|automatic(?:ally)? send|without approval|start calling them automatically|cold call(?:ing)? (?:automated|automatic))\b/i;

// Sourcing.
const COMPANIES_HIRING_RE =
  /\b(compan(?:y|ies) (?:that are )?hiring|hiring (?:for )?(?:gtm|sdr|bdr|engineers?|sales|marketing|developers?|react|backend|frontend|product|content))\b|\bfind compan(?:y|ies)\b.*\bhiring\b|\bhiring intent\b/i;

const PEOPLE_PROFILES_RE =
  /\b(individual (?:profiles?|people|engineers?|developers?|founders?|candidates?)|find (\d+ )?(?:individual )?(?:engineers?|developers?|react developers?|backend engineers?|frontend engineers?|founders?|candidates?|profiles?) (?:in|from|based in)|founder profiles?|senior (?:engineers?|developers?|backend|frontend|fullstack))\b/i;

const VAGUE_SOURCING_RE =
  /\b(find (?:me )?(?:more )?(?:leads?|customers?|prospects?)|i need (?:more )?customers|find compan(?:y|ies) (?:that )?(?:probably|might) need this|find people (?:likely|who might) (?:to )?buy)\b/i;

// Generic words.
const URL_PRESENT_RE = URL_RE;

// Trivial fallback for unclear.
const VERY_VAGUE_RE = /^(can you help.*|do the thing.*|help.*|um.*|idk.*)$/i;

// Phase 1 patch: short, contentless "please help" prompts that name no task.
// These must deterministically resolve to `unclear` with a targeted menu,
// rather than falling through to the AI fallback or a generic Pilot reply.
// e.g. "Can you help with this?", "Help me with this.", "Can you do this?",
// "I need help."
const SHORT_VAGUE_RE =
  /^\s*((can|could)\s+you\s+(help|do\s+(this|that|it))(\s+me)?(\s+with\s+(this|that|it))?|help(\s+me)?(\s+with\s+(this|that|it))?|i\s+(need|want)(\s+some)?\s+help|do\s+the\s+thing)[\s.!?]*$/i;

export const SHORT_VAGUE_CLARIFICATION =
  "Sure — what would you like me to help with: sourcing leads, researching a company, writing content, drafting outreach, or reviewing approvals?";

// ---------- Helpers ----------

function defaultDecision(category: WorkflowCategory, partial: Partial<WorkflowDecision>): WorkflowDecision {
  return {
    workflow_category: category,
    business_goal: partial.business_goal ?? "",
    intent: partial.intent ?? category,
    confidence: partial.confidence ?? 0.85,
    needs_clarification: partial.needs_clarification ?? false,
    clarification_question: partial.clarification_question ?? null,
    agents: partial.agents ?? [],
    execution_mode: partial.execution_mode ?? "none",
    selected_tool: partial.selected_tool ?? null,
    selected_actor_key: partial.selected_actor_key ?? null,
    source_type: partial.source_type ?? null,
    query: partial.query ?? null,
    role_keywords: partial.role_keywords ?? [],
    location: partial.location ?? null,
    remote_ok: partial.remote_ok ?? false,
    seniority: partial.seniority ?? null,
    max_results: partial.max_results ?? 10,
    needs_enrichment: partial.needs_enrichment ?? false,
    needs_outreach: partial.needs_outreach ?? false,
    requires_approval: partial.requires_approval ?? false,
    possible_actions: partial.possible_actions ?? [],
    reason: partial.reason ?? "",
    source: partial.source ?? "regex",
    signal_type: partial.signal_type ?? null,
    keywords: partial.keywords ?? [],
    needs_comment_drafts: partial.needs_comment_drafts ?? false,
    needs_dm_drafts: partial.needs_dm_drafts ?? false,
    competitor_related: partial.competitor_related ?? false,
  };
}

function looksLikeURL(m: string) { return URL_PRESENT_RE.test(m); }

function regexClassify(message: string): WorkflowDecision | null {
  const m = message.trim();
  if (!m) return defaultDecision("unclear", { reason: "empty prompt", confidence: 1, source: "default" });

  // Order matters: most specific first.
  if (UNSAFE_RE.test(m) || (SEND_RE.test(m) && /\bautomatic|without approval\b/i.test(m))) {
    return defaultDecision("unsafe_or_unsupported", {
      reason: "matches unsafe/unsupported pattern",
      possible_actions: ["public_business_research", "linkedin_outreach_draft", "approval_gated_email"],
    });
  }

  if (GREETING_RE.test(m)) {
    return defaultDecision("simple_chat", { reason: "greeting", confidence: 0.95 });
  }

  if (CAPABILITY_RE.test(m)) {
    return defaultDecision("capabilities", { reason: "capability question", confidence: 0.95 });
  }

  if (DAILY_BRIEF_RE.test(m)) {
    return defaultDecision("daily_brief", { reason: "daily brief phrasing", confidence: 0.95, agents: ["pilot"] });
  }

  if (APPROVAL_REVIEW_RE.test(m)) {
    return defaultDecision("approval_review", { reason: "approval review request", confidence: 0.9, agents: ["pilot"] });
  }

  if (AGENT_MANAGEMENT_RE.test(m)) {
    return defaultDecision("agent_management", { reason: "agent management question", confidence: 0.9, agents: ["pilot"] });
  }

  // Phase 1 patch: short "please help" prompts with no task → unclear (targeted menu).
  if (SHORT_VAGUE_RE.test(m)) {
    return defaultDecision("unclear", {
      reason: "short vague help request — no task specified",
      confidence: 0.9,
      needs_clarification: true,
      clarification_question: SHORT_VAGUE_CLARIFICATION,
    });
  }

  // Phase 3 — LinkedIn profile/company URL + posts/monitor intent → profile-posts
  // actor (NOT Firecrawl url_analysis). Must precede the generic URL branch.
  const liEntityUrls = m.match(LINKEDIN_ENTITY_URL_RE);
  if (liEntityUrls && liEntityUrls.length > 0 && /\b(posts?|recent|monitor|monitoring|activity|engagement|latest|what.*(?:posting|sharing))\b/i.test(m)) {
    return defaultDecision("signal_sourcing", {
      reason: "LinkedIn profile/company post monitoring",
      confidence: 0.85,
      signal_type: "linkedin_engagement",
      selected_tool: "source_with_apify",
      selected_actor_key: "apify_linkedin_profile_posts",
      source_type: "linkedin_engagement",
      query: m,
      keywords: liEntityUrls,
      agents: ["scout", "aria"],
      execution_mode: "fast",
      max_results: 10,
    });
  }

  // URL → url_analysis (unless it's a LinkedIn profile + enrichment intent, which the
  // existing toolInputPlanner handles as profile_enrichment — we still route through
  // the sourcing branch for that one).
  if (looksLikeURL(m) && !(LINKEDIN_PROFILE_URL_RE.test(m) && ENRICHMENT_INTENT_RE.test(m))) {
    return defaultDecision("url_analysis", {
      reason: "URL present — Firecrawl",
      confidence: 0.9,
      agents: ["hawk", "scribe"],
      execution_mode: "research",
      selected_tool: "scrape_url",
      selected_actor_key: "firecrawl_scrape_url",
      query: m,
    });
  }

  // Phase 3 — LinkedIn engagement signal sourcing. Detect BEFORE market/content/
  // outreach/jobs/people so "founders posting about X", "posts I should comment
  // on", "people discussing Clay" route to the LinkedIn posts actor (never jobs).
  // Guard: "write/draft a LinkedIn post" is CONTENT authoring, not engagement
  // sourcing — defer to content_creation in that case.
  if (LINKEDIN_ENGAGEMENT_RE.test(m) && !CONTENT_CREATION_RE.test(m)) {
    const needsComments = COMMENT_DRAFT_INTENT_RE.test(m);
    const needsDms = DM_DRAFT_INTENT_RE.test(m);
    const lower = m.toLowerCase();
    const GTM_TOOLS = ["clay", "gojiberry", "artisan", "apollo", "salesloft", "lemlist", "instantly", "smartlead", "outreach.io", "clearbit", "6sense"];
    const competitorHits = GTM_TOOLS.filter((k) => lower.includes(k));
    const topicMatch = m.match(/\b(?:about|around|discussing|on|re:)\s+([A-Za-z0-9 ,&/+\-]{3,60})/i);
    const topic = topicMatch
      ? topicMatch[1].replace(/\b(?:and|then)?\s*(?:draft|write|generate|suggest|create)\b.*$/i, "").trim()
      : null;
    const keywords = Array.from(new Set([...competitorHits, ...(topic ? [topic] : [])])).filter(Boolean);
    return defaultDecision("signal_sourcing", {
      reason: "LinkedIn engagement signal sourcing",
      confidence: 0.85,
      signal_type: "linkedin_engagement",
      selected_tool: "source_with_apify",
      selected_actor_key: "apify_linkedin_posts",
      source_type: "linkedin_engagement",
      query: keywords.length > 0 ? keywords.join(", ") : m,
      keywords,
      agents: ["scout", "aria"],
      execution_mode: (needsComments || needsDms) ? "outreach" : "fast",
      needs_comment_drafts: needsComments,
      needs_dm_drafts: needsDms,
      needs_outreach: needsDms,
      requires_approval: needsDms,
      competitor_related: competitorHits.length > 0,
      max_results: 10,
    });
  }

  if (MARKET_RESEARCH_RE.test(m)) {
    return defaultDecision("market_research", {
      reason: "market/competitor/news/current trends",
      confidence: 0.85,
      agents: ["hawk", "scribe"],
      execution_mode: "research",
      // Don't pin selected_actor_key here — validator decides based on
      // search_web availability and degrades to honest reply if missing.
    });
  }

  // Content authoring: must come BEFORE outreach so "write LinkedIn post" doesn't
  // get caught as outreach via "write".
  if (CONTENT_CREATION_RE.test(m) && !OUTREACH_RE.test(m)) {
    return defaultDecision("content_creation", {
      reason: "content authoring request",
      confidence: 0.9,
      agents: ["scribe"],
      execution_mode: "content",
    });
  }

  // Outreach without sourcing: draft emails/dms/sequences/outreach explicitly.
  // If the same message also says "find X", let sourcing branches handle it
  // (toolInputPlanner will set needs_outreach=true).
  const wantsSourcing = COMPANIES_HIRING_RE.test(m) || PEOPLE_PROFILES_RE.test(m) || VAGUE_SOURCING_RE.test(m);
  if (OUTREACH_RE.test(m) && !wantsSourcing) {
    return defaultDecision("outreach", {
      reason: "outreach drafting without sourcing",
      confidence: 0.85,
      agents: ["penn"],
      execution_mode: "outreach",
      needs_outreach: true,
      requires_approval: true,
    });
  }

  if (COMPANIES_HIRING_RE.test(m)) {
    return defaultDecision("company_hiring_sourcing", {
      reason: "companies hiring signal",
      confidence: 0.9,
      agents: ["scout", "aria"],
      execution_mode: "fast",
      selected_tool: "source_with_apify",
      selected_actor_key: "apify_jobs",
      source_type: "jobs",
      query: m,
      needs_outreach: OUTREACH_RE.test(m),
      requires_approval: OUTREACH_RE.test(m),
    });
  }

  // people-vs-company resolution: explicit people language and NOT company language.
  if (PEOPLE_PROFILES_RE.test(m) || (PEOPLE_INTENT_RE.test(m) && !COMPANY_INTENT_RE.test(m))) {
    return defaultDecision("people_sourcing", {
      reason: "individual people / profile language",
      confidence: 0.9,
      agents: ["scout", "aria"],
      execution_mode: "fast",
      selected_tool: "source_with_apify",
      selected_actor_key: "apify_people_search",
      source_type: "people_profiles",
      query: m,
      max_results: 10,
      needs_outreach: OUTREACH_RE.test(m),
      requires_approval: OUTREACH_RE.test(m),
    });
  }

  if (VAGUE_SOURCING_RE.test(m)) {
    return defaultDecision("signal_sourcing", {
      reason: "vague sourcing request — needs clarification",
      confidence: 0.7,
      needs_clarification: true,
      clarification_question:
        "Which buying signal should I target first: companies hiring GTM roles, companies hiring engineering roles, founder profiles, LinkedIn engagement, competitor engagement, or a specific niche?",
      possible_actions: [
        "companies_hiring_gtm",
        "companies_hiring_engineering",
        "founder_profiles",
        "linkedin_engagement",
        "competitor_engagement",
        "specific_niche",
      ],
    });
  }

  // Generic sourcing-ish words that don't match any specific bucket above.
  if (COMPANY_INTENT_RE.test(m) || /\b(find|source|leads?|prospects?|candidates?)\b/i.test(m)) {
    return defaultDecision("company_hiring_sourcing", {
      reason: "generic sourcing — defaulting to companies-hiring (apify_jobs)",
      confidence: 0.6,
      agents: ["scout", "aria"],
      execution_mode: "fast",
      selected_tool: "source_with_apify",
      selected_actor_key: "apify_jobs",
      source_type: "jobs",
      query: m,
    });
  }

  if (VERY_VAGUE_RE.test(m) || m.split(/\s+/).length < 3) {
    return defaultDecision("unclear", {
      reason: "too short / generic",
      confidence: 0.4,
      needs_clarification: true,
      clarification_question: "Could you add a bit more detail — what would you like me to help with?",
    });
  }

  return null; // fall through to AI
}

// ---------- normalizeIntent ----------

/**
 * Coerce raw classifier output (regex or AI) into a clean WorkflowDecision.
 * - Forces workflow_category into the enum.
 * - Clamps confidence and max_results.
 * - Enforces outreach → requires_approval=true.
 * - Strips tool/actor on unsafe.
 */
export function normalizeIntent(input: Partial<WorkflowDecision> | Record<string, unknown>): WorkflowDecision {
  // deno-lint-ignore no-explicit-any
  const raw = input as any;
  const cat = ALL_CATEGORIES.includes(raw.workflow_category as WorkflowCategory)
    ? (raw.workflow_category as WorkflowCategory)
    : "unclear";

  const mode = ALL_EXECUTION_MODES.includes(raw.execution_mode as WorkflowExecutionMode)
    ? (raw.execution_mode as WorkflowExecutionMode)
    : "none";

  const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0.5;
  let max_results = typeof raw.max_results === "number" ? Math.max(1, Math.min(200, Math.floor(raw.max_results))) : 10;

  const decision: WorkflowDecision = {
    workflow_category: cat,
    business_goal: typeof raw.business_goal === "string" ? raw.business_goal : "",
    intent: typeof raw.intent === "string" ? raw.intent : cat,
    confidence,
    needs_clarification: !!raw.needs_clarification,
    clarification_question: typeof raw.clarification_question === "string" ? raw.clarification_question : null,
    agents: Array.isArray(raw.agents) ? (raw.agents as unknown[]).filter((a: unknown) => typeof a === "string") as string[] : [],
    execution_mode: mode,
    selected_tool: typeof raw.selected_tool === "string" ? raw.selected_tool : null,
    selected_actor_key: typeof raw.selected_actor_key === "string" ? raw.selected_actor_key : null,
    source_type: typeof raw.source_type === "string" ? raw.source_type : null,
    query: typeof raw.query === "string" ? raw.query : null,
    role_keywords: Array.isArray(raw.role_keywords)
      ? (raw.role_keywords as unknown[]).filter((k) => typeof k === "string") as string[]
      : [],
    location: typeof raw.location === "string" ? raw.location : null,
    remote_ok: !!raw.remote_ok,
    seniority: typeof raw.seniority === "string" ? raw.seniority : null,
    max_results,
    needs_enrichment: !!raw.needs_enrichment,
    needs_outreach: !!raw.needs_outreach,
    requires_approval: !!raw.requires_approval,
    possible_actions: Array.isArray(raw.possible_actions)
      ? (raw.possible_actions as unknown[]).filter((a) => typeof a === "string") as string[]
      : [],
    reason: typeof raw.reason === "string" ? raw.reason : "",
    source: (raw.source === "regex" || raw.source === "ai" || raw.source === "default") ? raw.source : "default",
    signal_type: typeof raw.signal_type === "string" ? raw.signal_type : null,
    keywords: Array.isArray(raw.keywords)
      ? (raw.keywords as unknown[]).filter((k) => typeof k === "string") as string[]
      : [],
    needs_comment_drafts: !!raw.needs_comment_drafts,
    needs_dm_drafts: !!raw.needs_dm_drafts,
    competitor_related: !!raw.competitor_related,
  };

  // outreach (or sourcing+outreach) always requires approval before sending.
  if (decision.workflow_category === "outreach" || decision.needs_outreach) {
    decision.requires_approval = true;
  }

  // LinkedIn DM drafts are outreach → always approval-gated.
  if (decision.needs_dm_drafts) {
    decision.needs_outreach = true;
    decision.requires_approval = true;
  }

  // unsafe: strip any executable choices.
  if (decision.workflow_category === "unsafe_or_unsupported") {
    decision.selected_tool = null;
    decision.selected_actor_key = null;
    decision.source_type = null;
    decision.agents = [];
    decision.execution_mode = "none";
  }

  return decision;
}

// ---------- AI fallback ----------

const AI_SYSTEM_PROMPT = `You classify a single user message for an AI workforce platform.
Return ONLY a JSON object. Pick exactly one workflow_category from this list:
${ALL_CATEGORIES.join(" | ")}

Guidance:
- simple_chat: greetings, thanks, small talk.
- capabilities: "what can you do", "what are your features".
- daily_brief: "brief me on today", "plan my day".
- content_creation: write/draft a post, founder update, blog, report, summary.
- market_research: current news, market/competitor trends, what changed today.
- url_analysis: message contains an http(s) URL to analyze.
- signal_sourcing: vague "find leads/customers" (needs clarification), OR LinkedIn engagement sourcing — "find LinkedIn posts/people discussing <topic>", "posts I should comment on", "people talking about <pain>" (set signal_type="linkedin_engagement", selected_actor_key="apify_linkedin_posts", source_type="linkedin_engagement", needs_clarification=false; needs_comment_drafts/needs_dm_drafts when comments/DMs are requested).
- people_sourcing: explicit "individual profiles" or "find <role> profiles".
- company_hiring_sourcing: "find companies hiring <role>".
- outreach: "draft outreach/email/dm/sequence" (no sourcing in same message).
- agent_management: questions about agents (Scout, Aria, Penn, Hawk, Scribe, Pilot).
- approval_review: "pending approvals", "drafts waiting to approve".
- unsafe_or_unsupported: personal phone numbers, auto-send without approval, private data.
- unclear: genuinely vague.

JSON shape:
{
  "workflow_category": "...",
  "business_goal": "short phrase",
  "intent": "short phrase",
  "confidence": 0..1,
  "needs_clarification": boolean,
  "clarification_question": "string or null",
  "agents": ["scout"|"aria"|"hawk"|"penn"|"scribe"|"pilot"],
  "execution_mode": "fast|deep|outreach|content|research|none",
  "reason": "one sentence"
}`;

export async function classifyWorkflow(message: string): Promise<WorkflowDecision> {
  const quick = regexClassify(message);
  if (quick) return normalizeIntent(quick);

  // AI fallback only when regex is uncertain.
  const ai = await generateJson({
    taskType: "helper",
    systemPrompt: AI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: message }],
    temperature: 0.1,
    maxTokens: 400,
    jsonMode: true,
    functionName: "workflowClassifier",
  });

  if (ai.ok && ai.json && typeof ai.json === "object") {
    const decision = normalizeIntent({ ...(ai.json as Record<string, unknown>), source: "ai" });
    if (decision.confidence >= 0.5) return decision;
  }

  return normalizeIntent({
    workflow_category: "unclear",
    reason: "no regex match and AI low-confidence/unavailable",
    needs_clarification: true,
    clarification_question:
      "Could you add a bit more detail — for example a role + location, a URL, or what kind of content you want?",
    confidence: 0.3,
    source: "default",
  });
}
