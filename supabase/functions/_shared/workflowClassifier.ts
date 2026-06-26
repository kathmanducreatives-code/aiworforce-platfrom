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
  COMMENTER_EXTRACT_RE,
} from "./actorRegistry.ts";
import { matchCompetitors, buildCompetitorSearchQueries } from "./competitorRegistry.ts";
import { extractInlineBusinessContext, resolveDiscoveryMode } from "./competitorDiscovery.ts";

// Phase 4 — competitor-tracking intent phrases (alternatives/comparison/switch/complaints).
const COMPETITOR_INTENT_RE =
  /\b(competitors?|competing tools?|alternatives?|comparison|compare|comparing|switching from|switch from|moving (?:off|away from)|complaints? about|complaining about|vs\.?|versus)\b/i;

// Phase 4 (dynamic) — competitor DISCOVERY intent (find/map my competitors,
// competitor conversations, competitors for <site>). Distinct from tracking a
// named competitor (handled by the known-competitor block).
const COMPETITOR_DISCOVERY_RE =
  /\b(find (?:\d+ )?(?:my |our )?competitors(?:\s+(?:for|of))?|who are (?:my|our) competitors|competitor conversations|competitive landscape|discover (?:\d+ )?(?:my |our )?competitors|map (?:my|our|the) competitors)\b/i;

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
  | "content_engagement_loop"
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
  // Phase 4 — competitor engagement (matched competitor keys).
  competitors?: string[];
  // Phase 4 (dynamic) — competitor discovery.
  competitor_discovery?: boolean;
  discovery_mode?: "website" | "description" | "known" | "needs_context";
  business_website?: string | null;
  business_description?: string | null;
  // Phase 4.2 — deep commenter extraction for a specific post.
  extract_commenters?: boolean;
  post_urls?: string[];
  // Phase 7 — Founder Content + Engagement Loop.
  needs_content?: boolean;
  needs_engagement_search?: boolean;
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
  "fast", "deep", "outreach", "content", "research", "content_engagement_loop", "none",
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

// Phase 7 — Founder Content + Engagement Loop detection. The loop fires when a
// prompt combines CONTENT creation intent with ENGAGEMENT/distribution intent,
// or names a "content loop" outright.
const CONTENT_LOOP_RE = /\b(content (?:engagement )?loop|founder content loop)\b/i;
const CONTENT_INTENT_LOOSE_RE = /\b(post ideas?|content ideas?|founder (?:post|content|update))\b/i;
// Genuine content-AUTHORING verb + a content noun. Unlike CONTENT_CREATION_RE,
// this matches bare "write a post about …" and "turn these updates into a post",
// but NOT a passing mention like "extract commenters from this LinkedIn post".
const CONTENT_AUTHOR_RE =
  /\b(write|draft|create|compose|turn\s+[^.!?]*\binto)\b[^.!?]*\b(posts?|threads?|content|founder update|newsletter|article|blog|caption)\b/i;
const ENGAGEMENT_FIND_RE =
  /\b(find|finding|discover|surface|look for|get)\b[^.!?]*\b(people|posts?|conversations?|threads?|leads?|prospects?|accounts?|opportunit(?:y|ies))\b|\b(engage with|comment on|reply to|respond to|people (?:i|to)\s+(?:should\s+)?engage|engagement opportunit(?:y|ies)|relevant conversations|conversations to (?:engage|comment))\b/i;

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
  /\b(personal phone numbers?|home address|scrape private|private personal data|harvest emails for spam|send (?:emails?|messages?) automatically|automatic(?:ally)? send|without approval|start calling them automatically|cold call(?:ing)? (?:automated|automatic)|automatic(?:ally)?\s+(?:comment|post|publish|share|dm|message|email|reply|engage|connect|like)|auto[- ]?(?:comment|post|publish|share|dm|message|email|reply|like|engage|connect)|(?:post|publish|share)\s+(?:this|that|it|these|them)?[^.!?]*\bautomatic(?:ally)?|(?:email|message|dm|text|contact|reach out to)\b[^.!?]{0,30}\bautomatic(?:ally)?|send\s+(?:messages?|dms?|emails?|outreach)\s+to\s+(?:all|every|everyone|each))\b/i;

// Sourcing.
const COMPANIES_HIRING_RE =
  /\b(compan(?:y|ies) (?:that are )?hiring|hiring (?:for )?(?:gtm|sdr|bdr|engineers?|sales|marketing|developers?|react|backend|frontend|product|content))\b|\bfind compan(?:y|ies)\b.*\bhiring\b|\bhiring intent\b/i;

const PEOPLE_PROFILES_RE =
  /\b(individual (?:profiles?|people|engineers?|developers?|founders?|candidates?)|find (\d+ )?(?:individual )?(?:engineers?|developers?|react developers?|backend engineers?|frontend engineers?|founders?|candidates?|profiles?) (?:in|from|based in)|founder profiles?|senior (?:engineers?|developers?|backend|frontend|fullstack))\b/i;

// Subject detection for "find <X>" sourcing requests. The goal is to identify
// the PRIMARY SUBJECT (people vs company), not merely whether persona/company
// words appear — because persona words often appear as BUYERS ("companies
// selling to founders") rather than as the subject.
const PEOPLE_NOUN_RE =
  /\b(co-?founders?|founders?|ceos?|ctos?|coos?|cmos?|cros?|cfos?|operators?|executives?|leaders?|heads? of [a-z]+|vps?|vice presidents?|directors?|decision[- ]?makers?|people|individuals?|professionals?|candidates?|recruiters?|engineers?|developers?|reps?|managers?)\b/i;
const COMPANY_NOUN_RE =
  /\b(compan(?:y|ies)|startups?|scaleups?|agenc(?:y|ies)|businesses?|organi[sz]ations?|firms?|vendors?|brands?|accounts?|orgs?|studios?|labs?)\b/i;
// Buyer/persona clauses — text from here on describes who the company SELLS TO,
// not the subject being sourced. Stripped before subject detection.
const BUYER_CLAUSE_RE =
  /\b(?:selling to|sell to|that sell to|who sell to|whose (?:buyers?|customers?|clients?|users?|icp)\s+(?:are|is)|targeting|marketing to|serving|that target|catering to|for (?:founders?|ceos?|smbs?|enterprises?))\b.*$/i;
const SOURCING_VERB_RE =
  /\b(find|get|show|source|sourcing|list|look for|search for|pull|give me|identify)\b/i;

// "people" if a person head-noun is the subject, "company" if a company head-noun
// is, else null. When both appear, the one nearer the start wins (the object of
// "find"), after buyer clauses are removed.
function detectSourcingSubject(message: string): "people" | "company" | null {
  const m = message.replace(BUYER_CLAUSE_RE, " ");
  const pPeople = m.search(PEOPLE_NOUN_RE);
  const pCompany = m.search(COMPANY_NOUN_RE);
  if (pPeople >= 0 && pCompany >= 0) return pPeople <= pCompany ? "people" : "company";
  if (pPeople >= 0) return "people";
  if (pCompany >= 0) return "company";
  return null;
}

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

// Extract an explicit requested count, e.g. "find 5 posts", "10 LinkedIn posts",
// "top 5" → number. Falls back to the given default. Clamped to [1,50].
function extractRequestedCount(m: string, fallback: number): number {
  const mm = m.match(/\b(?:find|get|show|top|first)\s+(\d{1,3})\b/i)
    ?? m.match(/\b(\d{1,3})\s+(?:linkedin\s+)?(?:posts?|people|profiles?|results?)\b/i);
  if (mm) {
    const n = parseInt(mm[1], 10);
    if (Number.isFinite(n) && n > 0) return Math.max(1, Math.min(50, n));
  }
  return fallback;
}

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
    max_results: partial.max_results ?? 5,
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
    competitors: partial.competitors ?? [],
    competitor_discovery: partial.competitor_discovery ?? false,
    discovery_mode: partial.discovery_mode,
    business_website: partial.business_website ?? null,
    business_description: partial.business_description ?? null,
    extract_commenters: partial.extract_commenters ?? false,
    post_urls: partial.post_urls ?? [],
    needs_content: partial.needs_content ?? false,
    needs_engagement_search: partial.needs_engagement_search ?? false,
  };
}

function looksLikeURL(m: string) { return URL_PRESENT_RE.test(m); }

function regexClassify(message: string): WorkflowDecision | null {
  const m = message.trim();
  if (!m) return defaultDecision("unclear", { reason: "empty prompt", confidence: 1, source: "default" });

  // Order matters: most specific first.
  if (UNSAFE_RE.test(m) || (SEND_RE.test(m) && /\bautomatic|without approval|right now|right away|immediately|\bnow\b\.?$/i.test(m))) {
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

  // Phase 7 — Founder Content + Engagement Loop. Fires when CONTENT creation
  // intent combines with ENGAGEMENT/distribution intent (or the prompt names a
  // "content loop"). Must precede competitor-discovery / linkedin-engagement /
  // content-only branches. Unsafe auto-action is already handled above, so
  // "write a post and auto-comment on 50 posts" never reaches here.
  {
    // Content intent here means genuine AUTHORING (not a passing "this LinkedIn
    // post" mention). Engagement intent means finding/engaging with OTHERS'
    // posts — never the act of authoring one.
    const hasContentIntent =
      (CONTENT_AUTHOR_RE.test(m) || CONTENT_LOOP_RE.test(m) || CONTENT_INTENT_LOOSE_RE.test(m)) && !OUTREACH_RE.test(m);
    const hasEngagementIntent =
      ENGAGEMENT_FIND_RE.test(m) || COMMENT_DRAFT_INTENT_RE.test(m) || DM_DRAFT_INTENT_RE.test(m);
    const isContentLoop = CONTENT_LOOP_RE.test(m) || (hasContentIntent && hasEngagementIntent);
    if (isContentLoop) {
      const needsComments = COMMENT_DRAFT_INTENT_RE.test(m) || /\bcomment(?:s|ing)?\b|\brepl(?:y|ies)\b/i.test(m);
      const needsDms = DM_DRAFT_INTENT_RE.test(m) || /\b(dms?|direct messages?|follow[- ]?ups?)\b/i.test(m);
      const competitorRelated = matchCompetitors(m).length > 0 || COMPETITOR_INTENT_RE.test(m) || /\bcompetitors?\b/i.test(m);
      const signalType = competitorRelated ? "competitor_engagement" : "linkedin_engagement";
      const agents = ["scribe", "scout", "aria"];
      if (needsDms) agents.push("penn");
      return defaultDecision("content_creation", {
        reason: competitorRelated ? "content + competitor engagement loop" : "content + engagement loop",
        confidence: 0.85,
        execution_mode: "content_engagement_loop",
        needs_content: true,
        needs_engagement_search: true,
        signal_type: signalType,
        selected_tool: "source_with_apify",
        selected_actor_key: "apify_linkedin_posts",
        source_type: "linkedin_engagement",
        query: m,
        agents,
        needs_comment_drafts: needsComments,
        needs_dm_drafts: needsDms,
        needs_outreach: needsDms,
        requires_approval: needsDms,
        competitor_related: competitorRelated,
        max_results: extractRequestedCount(m, 5),
      });
    }
    // Content authoring without engagement (and no URL) → Scribe-only. Covers
    // "Write a LinkedIn post.", "Draft a tweet.", "Create content ideas.".
    if (hasContentIntent && !looksLikeURL(m)) {
      return defaultDecision("content_creation", {
        reason: "content authoring (Scribe-only)",
        confidence: 0.9,
        agents: ["scribe"],
        execution_mode: "content",
        needs_content: true,
      });
    }
  }

  // Phase 4.2 — deep commenter extraction for a specific post. Needs a post URL;
  // pilot-chat asks for one if absent. Uses the (opt-in) post-comments actor.
  if (COMMENTER_EXTRACT_RE.test(m)) {
    const postUrls = (m.match(new RegExp(URL_RE, "ig")) ?? []).filter((u) => /linkedin\.com/i.test(u));
    return defaultDecision("signal_sourcing", {
      reason: "extract commenters from a specific post",
      confidence: 0.85,
      signal_type: "competitor_engagement",
      extract_commenters: true,
      post_urls: postUrls,
      selected_tool: "source_with_apify",
      selected_actor_key: "apify_linkedin_post_comments",
      source_type: "linkedin_comments",
      query: m,
      agents: ["scout", "aria"],
      execution_mode: "fast",
      needs_clarification: postUrls.length === 0,
      clarification_question: postUrls.length === 0
        ? "Which LinkedIn post should I pull commenters from? Paste the post URL."
        : null,
      max_results: extractRequestedCount(m, 5),
    });
  }

  // Phase 4 (dynamic) — Competitor DISCOVERY. "Find my competitors", "find
  // competitors for <site>", "competitor conversations". Resolves business
  // context (inline here; company_brain/memory resolved in pilot-chat). Must
  // precede known-competitor + URL branches.
  if (COMPETITOR_DISCOVERY_RE.test(m)) {
    const ctx = extractInlineBusinessContext(m);
    const mode = resolveDiscoveryMode(ctx);
    // A category/topic ("around/about/on <X>") OR a named competitor means this is
    // keyword tracking, not discovery — let the known-competitor block handle it.
    const hasTopicOrCompetitor = /\b(?:around|about|on)\s+[A-Za-z0-9]/i.test(m) || matchCompetitors(m).length > 0;
    if (mode === "needs_context" && !hasTopicOrCompetitor) {
      return defaultDecision("signal_sourcing", {
        reason: "competitor discovery needs business context",
        confidence: 0.8,
        signal_type: "competitor_engagement",
        competitor_discovery: true,
        discovery_mode: "needs_context",
        needs_clarification: true,
        clarification_question:
          "To find your competitors, share your website, LinkedIn company page, or a one-line description of what you sell — or I can use your saved company profile if you have one.",
      });
    }
    if (mode === "needs_context") {
      // topic present but no business context → fall through to keyword tracking.
    } else {
    const needsComments = COMMENT_DRAFT_INTENT_RE.test(m);
    const needsDms = DM_DRAFT_INTENT_RE.test(m);
    return defaultDecision("signal_sourcing", {
      reason: `competitor discovery (${mode})`,
      confidence: 0.85,
      signal_type: "competitor_engagement",
      competitor_discovery: true,
      discovery_mode: mode,
      business_website: ctx.website_url,
      business_description: ctx.description,
      selected_tool: "source_with_apify",
      selected_actor_key: "apify_linkedin_posts",
      source_type: "linkedin_engagement",
      query: m,
      agents: ["hawk", "scout", "aria"],
      execution_mode: (needsComments || needsDms) ? "outreach" : "fast",
      needs_comment_drafts: needsComments,
      needs_dm_drafts: needsDms,
      needs_outreach: needsDms,
      requires_approval: needsDms,
      competitor_related: true,
      max_results: extractRequestedCount(m, 5),
    });
    }
  }

  // Phase 4 — Competitor Engagement Tracker. Fires when a known competitor is
  // mentioned, or on explicit competitor intent (alternatives/comparison/switch/
  // complaints) in a social/sourcing context. Reuses the Phase 3 LinkedIn actors
  // but tags the workflow as competitor_engagement. Must precede the generic
  // profile-URL and linkedin_engagement branches.
  {
    const compMatches = matchCompetitors(m);
    const socialCtx = /\b(linkedin|posts?|people|conversations?|engag|talking|comment|track|monitor|complain|switch|leads?|tools?)\b/i.test(m);
    if (compMatches.length > 0 || (COMPETITOR_INTENT_RE.test(m) && socialCtx)) {
      const isUrl = /linkedin\.com\/(?:in|company|school|showcase)\//i.test(m);
      const needsComments = COMMENT_DRAFT_INTENT_RE.test(m);
      const needsDms = DM_DRAFT_INTENT_RE.test(m);
      const topicMatch = m.match(/\b(?:about|around|discussing|comparing)\s+([A-Za-z0-9 ,&/+\-]{3,60})/i);
      const topic = topicMatch
        ? topicMatch[1].replace(/\b(?:and|then)?\s*(?:draft|write|generate|suggest|create)\b.*$/i, "").trim()
        : null;
      const queries = buildCompetitorSearchQueries({ competitors: compMatches, topic, query: m });
      return defaultDecision("signal_sourcing", {
        reason: "competitor engagement tracking",
        confidence: 0.85,
        signal_type: "competitor_engagement",
        selected_tool: "source_with_apify",
        selected_actor_key: isUrl ? "apify_linkedin_profile_posts" : "apify_linkedin_posts",
        source_type: "linkedin_engagement",
        query: isUrl ? m : (queries.join(", ") || m),
        keywords: queries,
        competitors: compMatches.map((c) => c.key),
        competitor_related: true,
        agents: ["scout", "aria"],
        execution_mode: (needsComments || needsDms) ? "outreach" : "fast",
        needs_comment_drafts: needsComments,
        needs_dm_drafts: needsDms,
        needs_outreach: needsDms,
        requires_approval: needsDms,
        max_results: extractRequestedCount(m, 5),
      });
    }
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
      max_results: extractRequestedCount(m, 5),
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
      max_results: extractRequestedCount(m, 5),
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

  // Subject-based people-vs-company resolution. The PRIMARY SUBJECT (people vs
  // company), not the mere presence of persona/company words, decides the route.
  // Buyer clauses ("selling to founders", "whose buyers are founders") are
  // stripped first so persona-as-buyer never flips a company request to people.
  const sourcingSubject = detectSourcingSubject(m);
  const hasSourcingVerb = SOURCING_VERB_RE.test(m);

  // People-first: subject is founders/CEOs/heads/operators/profiles.
  if (
    PEOPLE_PROFILES_RE.test(m) ||
    (hasSourcingVerb && sourcingSubject === "people") ||
    (PEOPLE_INTENT_RE.test(m) && !COMPANY_INTENT_RE.test(m) && sourcingSubject !== "company")
  ) {
    return defaultDecision("people_sourcing", {
      reason: "individual people / profile subject",
      confidence: 0.9,
      agents: ["scout", "aria"],
      execution_mode: "fast",
      selected_tool: "source_with_apify",
      selected_actor_key: "apify_people_search",
      source_type: "people_profiles",
      query: m,
      max_results: extractRequestedCount(m, 5),
      needs_outreach: OUTREACH_RE.test(m),
      requires_approval: OUTREACH_RE.test(m),
    });
  }

  // Company/account-first: subject is companies/startups/agencies/businesses
  // (incl. "companies selling to founders" after buyer-clause stripping). Routes
  // to the company/category search (apify_jobs is the company source in this build).
  if (hasSourcingVerb && sourcingSubject === "company") {
    return defaultDecision("company_hiring_sourcing", {
      reason: "company / account subject — company/category search",
      confidence: 0.85,
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

  // Clear COMPANY/account/category intent (e.g. "companies", "accounts",
  // "startups", "orgs") with no more-specific bucket above → companies-hiring
  // (Jobs actor). This is the legitimate "company / category search" source.
  if (COMPANY_INTENT_RE.test(m)) {
    return defaultDecision("company_hiring_sourcing", {
      reason: "company/account intent — companies-hiring (apify_jobs)",
      confidence: 0.7,
      agents: ["scout", "aria"],
      execution_mode: "fast",
      selected_tool: "source_with_apify",
      selected_actor_key: "apify_jobs",
      source_type: "jobs",
      query: m,
    });
  }

  // Generic sourcing words (find/source/leads/prospects/candidates) with NO
  // company, hiring, people, LinkedIn, or competitor signal → do NOT silently
  // default to Jobs. Surface the Lead Source Selector via a clarification so the
  // user picks the actual source. (pilot-chat shows the 7-option selector when
  // isLeadIntakeRequest matches; otherwise this menu keeps it off the Jobs path.)
  if (/\b(find|source|sourcing|leads?|prospects?|candidates?|buyers?|customers?)\b/i.test(m)) {
    return defaultDecision("signal_sourcing", {
      reason: "generic sourcing — needs source selection (no silent jobs default)",
      confidence: 0.6,
      needs_clarification: true,
      clarification_question:
        "Which kind of leads should I find? Options: ICP/normal leads, companies hiring, LinkedIn intent posts, LinkedIn comments/engagement, competitor engagement, founder/profile search, or company/category search.",
      possible_actions: [
        "icp_search",
        "companies_hiring",
        "linkedin_intent_posts",
        "linkedin_comments",
        "competitor_engagement",
        "founder_profiles",
        "company_category_search",
      ],
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
  let max_results = typeof raw.max_results === "number" ? Math.max(1, Math.min(200, Math.floor(raw.max_results))) : 5;

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
    competitors: Array.isArray(raw.competitors)
      ? (raw.competitors as unknown[]).filter((k) => typeof k === "string") as string[]
      : [],
    competitor_discovery: !!raw.competitor_discovery,
    discovery_mode: (["website", "description", "known", "needs_context"].includes(raw.discovery_mode))
      ? raw.discovery_mode : undefined,
    business_website: typeof raw.business_website === "string" ? raw.business_website : null,
    business_description: typeof raw.business_description === "string" ? raw.business_description : null,
    extract_commenters: !!raw.extract_commenters,
    post_urls: Array.isArray(raw.post_urls)
      ? (raw.post_urls as unknown[]).filter((u) => typeof u === "string") as string[]
      : [],
    needs_content: !!raw.needs_content,
    needs_engagement_search: !!raw.needs_engagement_search,
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
