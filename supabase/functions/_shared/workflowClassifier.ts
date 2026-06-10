// workflowClassifier: deterministic-first workflow classification.
//
// Architecture:
//   Gemini = understands user meaning (fallback for low-confidence only)
//   classifyWorkflow() = deterministic category decision (source of truth)
//   pilot-chat = routes each category deterministically
//
// Pure / import-free so it is unit-testable in Node + Deno. The AI fallback
// is exposed as a prompt + coercer; pilot-chat performs the Gemini call and
// feeds the result back through coerceAiWorkflow().

export type Workflow =
  | "unsafe"
  | "simple_chat"
  | "capabilities"
  | "daily_brief"
  | "market_research"
  | "content_creation"
  | "url_analysis"
  | "people_sourcing"
  | "company_hiring_sourcing"
  | "outreach"
  | "vague_lead_sourcing";

export interface WorkflowClassification {
  workflow: Workflow;
  confidence: number; // 0..1
  reason: string;
  source: "rule" | "ai" | "default";
  unsafe_reason?: string;
}

// ---------------------------------------------------------------------------
// Regexes (ordered by precedence in classifyWorkflow)
// ---------------------------------------------------------------------------

// 1. UNSAFE — automated calling, or scraping personal/private phone numbers.
const AUTO_CALL_RE =
  /\b(auto(?:matically)?|start|begin|bulk|mass)\s+(call|calls|calling|dial|dialing|ring)\b|\bcall(?:ing)?\s+them\s+(?:automatic|all)|\bauto[-\s]?dial|\bcold[-\s]?call\s+\d+/i;
const PRIVATE_CONTACT_RE =
  /\b(personal|private|cell|mobile|home)\s+(phone|cell|mobile|number|numbers|contact)|\bphone numbers?\b/i;

// 2. DAILY BRIEF
const DAILY_BRIEF_RE =
  /^\s*(brief me( on today)?|daily brief|today'?s (command )?brief|give me today'?s (command )?brief|what should i know today\??|what happened today\??|plan my day|what needs my attention\??)\s*[.!?]*\s*$/i;

// 3. CAPABILITIES
const CAPABILITIES_RE =
  /\b(what can you do|what can agentory do|who(?:'?s| is) on (the|your) team|who are you|what are you|your (features|capabilities)|how (can|do) (you|agentory)( help| work)?|what is (this|pilot|agentory))\b/i;

// 4. SIMPLE CHAT (pure greeting / acknowledgement only)
const GREETING_RE =
  /^\s*(hi|hello|hey|yo|sup|gm|good (morning|afternoon|evening)|thanks|thank you|ty|cool|nice|ok(ay)?|got it|cheers|great|perfect)[\s.!?]*$/i;

// 5. URL present
const URL_RE = /\bhttps?:\/\/[^\s)]+/i;

// 6. MARKET RESEARCH — current/market/competitor news (no specific URL).
const MARKET_RESEARCH_RE =
  /\b(market|industry|competitor|competitors|landscape|sector|space)\b/i;
const CURRENT_NEWS_RE =
  /\b(what(?:'?s| is| has)?\s+(changed|new|happening|going on)|latest|today|this week|recent(?:ly)?|current|trend|trends|news|updates?)\b/i;

// 7. CONTENT CREATION — write/produce a content artifact.
const CONTENT_VERB_RE = /\b(write|draft|compose|create|generate|produce|summari[sz]e|rewrite)\b|\b(turn|make|rework)\b[^.?!]*\binto\b/i;
const CONTENT_ARTIFACT_RE =
  /\b(linkedin post|li post|post|blog|article|tweet|thread|newsletter|update|memo|report|summary|caption|content|copy|announcement|launch post|case study|press release|job description|jd)\b/i;

// 8. OUTREACH — drafting/sending messages to people/leads.
const OUTREACH_RE =
  /\b(draft|write|create|generate|send|fire off|prepare)\b[^.?!]*\b(outreach|cold (email|dm|message)|follow[-\s]?ups?|sequences?|messages? to|emails? to|dms? to|reach[-\s]?outs?)\b|\bdraft outreach\b|\boutreach (email|message|sequence|to)\b/i;
const SEND_RE = /\b(send|deliver|fire off|blast)\b[^.?!]*\b(email|message|dm|outreach)\b/i;

// 9. PEOPLE markers (individual humans, not companies)
// Note: bare "people who …" is intentionally NOT a people-marker — it's vague
// ICP language ("people who probably need this"), not a concrete profile search.
const PEOPLE_MARKER_RE =
  /\b(individual|specific)\s+(people|profiles?|candidates?|persons?|engineers?|developers?|founders?|marketers?|designers?|leaders?)\b|\b(profiles?|candidates?|persons?|linkedin profiles?)\b|\b(recently changed jobs?|recently posted|open to work|just (joined|left|started))\b/i;

// 10. COMPANY-HIRING markers
const COMPANY_HIRING_RE =
  /\b(compan(?:y|ies)|startups?|orgs?|organi[sz]ations?)\b[^.?!]*\bhir(?:e|es|ing|ed)\b|\bwho(?:'?s| is) hiring\b|\bhir(?:e|es|ing)\b[^.?!]*\b(roles?|engineers?|sdrs?|aes?|gtm|marketers?|sales|developers?|reps?)\b|\bhiring signals?\b|\bcompanies hiring\b/i;

// 11. SOURCING intent (broad)
const SOURCING_VERB_RE =
  /\b(find|source|sourcing|discover|identify|get me|pull|build a list|prospect)\b/i;
const LEAD_TARGET_RE =
  /\b(leads?|prospects?|pipeline|customers?|clients?|companies|people|founders?|candidates?|engineers?|developers?|marketers?|designers?|recruiters?|sdrs?|aes?)\b/i;

// Role words (used to detect "ambiguous talent" → vague).
const ROLE_RE =
  /\b(engineers?|developers?|marketers?|designers?|founders?|recruiters?|sales|sdrs?|aes?|gtm|product managers?|pms?|data scientists?|analysts?)\b/i;

// ---------------------------------------------------------------------------

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Deterministic workflow classification. First match wins, in precedence order.
 * Safety (unsafe) is always checked first.
 */
export function classifyWorkflow(messageRaw: string): WorkflowClassification {
  const message = (messageRaw ?? "").trim();
  if (!message) {
    return { workflow: "simple_chat", confidence: 0.4, reason: "empty message", source: "default" };
  }

  // 1) UNSAFE — highest precedence (safety). Auto-calling, or private-phone scraping.
  if (AUTO_CALL_RE.test(message)) {
    return {
      workflow: "unsafe",
      confidence: 0.97,
      reason: "automated calling/dialing requested",
      source: "rule",
      unsafe_reason: "auto_calling",
    };
  }
  if (PRIVATE_CONTACT_RE.test(message)) {
    return {
      workflow: "unsafe",
      confidence: 0.9,
      reason: "personal/private phone-number scraping requested",
      source: "rule",
      unsafe_reason: "private_contact_scraping",
    };
  }

  // 2) DAILY BRIEF
  if (DAILY_BRIEF_RE.test(message)) {
    return { workflow: "daily_brief", confidence: 0.95, reason: "daily brief phrasing", source: "rule" };
  }

  // 3) CAPABILITIES
  if (CAPABILITIES_RE.test(message)) {
    return { workflow: "capabilities", confidence: 0.95, reason: "capability question", source: "rule" };
  }

  // 4) SIMPLE CHAT (pure greeting)
  if (GREETING_RE.test(message)) {
    return { workflow: "simple_chat", confidence: 0.95, reason: "greeting/acknowledgement", source: "rule" };
  }

  const hasUrl = URL_RE.test(message);
  const hasOutreach = OUTREACH_RE.test(message) || SEND_RE.test(message);
  const hasContent = CONTENT_VERB_RE.test(message) && CONTENT_ARTIFACT_RE.test(message);
  const hasSourcingVerb = SOURCING_VERB_RE.test(message);
  const hasPeople = PEOPLE_MARKER_RE.test(message);
  const hasCompanyHiring = COMPANY_HIRING_RE.test(message);
  const hasRole = ROLE_RE.test(message);
  const hasLeadTarget = LEAD_TARGET_RE.test(message);

  // 5) URL ANALYSIS — a concrete URL to analyze. Beats sourcing/content so we
  //    never double-fire Apify on a URL request. (Outreach *angle* mentions
  //    don't change this; actual outreach drafting is a separate later step.)
  if (hasUrl) {
    return { workflow: "url_analysis", confidence: 0.9, reason: "message contains a URL to analyze", source: "rule" };
  }

  // 6) OUTREACH — explicit drafting/sending of messages. Wins over plain
  //    sourcing because "find X and draft outreach" is the full outreach chain.
  if (hasOutreach) {
    return { workflow: "outreach", confidence: 0.88, reason: "explicit outreach drafting/sending", source: "rule" };
  }

  // 7) CONTENT CREATION — produce a content artifact, with NO outreach/lead target.
  if (hasContent && !hasOutreach && !(hasSourcingVerb && hasLeadTarget)) {
    return { workflow: "content_creation", confidence: 0.9, reason: "content artifact request (no sourcing/outreach)", source: "rule" };
  }

  // 8) MARKET RESEARCH — current/market/competitor info, no URL, no sourcing.
  if (MARKET_RESEARCH_RE.test(message) && CURRENT_NEWS_RE.test(message) && !hasSourcingVerb) {
    return { workflow: "market_research", confidence: 0.85, reason: "current market/competitor research", source: "rule" };
  }

  // 9) PEOPLE SOURCING — explicit individual-people markers.
  if (hasPeople && !hasCompanyHiring) {
    return { workflow: "people_sourcing", confidence: 0.85, reason: "explicit individual-people markers", source: "rule" };
  }

  // 10) COMPANY HIRING SOURCING — explicit companies-hiring language.
  if (hasCompanyHiring) {
    return { workflow: "company_hiring_sourcing", confidence: 0.85, reason: "companies-hiring language", source: "rule" };
  }

  // 11) VAGUE LEAD SOURCING — sourcing intent but underspecified target, OR
  //     ambiguous talent (role present, but neither people nor companies made
  //     explicit). Route to clarification rather than guessing.
  const vagueLeads = (hasSourcingVerb && hasLeadTarget) || /\b(who should we (reach out to|target|contact)|need (pipeline|leads|customers))\b/i.test(message);
  const ambiguousTalent = hasRole && hasSourcingVerb && !hasPeople && !hasCompanyHiring;
  if (vagueLeads || ambiguousTalent) {
    return {
      workflow: "vague_lead_sourcing",
      confidence: 0.7,
      reason: ambiguousTalent ? "ambiguous talent request (people vs companies vs agency)" : "underspecified lead-sourcing target",
      source: "rule",
    };
  }

  // Default — low confidence; pilot-chat may escalate to the Gemini fallback.
  return { workflow: "vague_lead_sourcing", confidence: 0.3, reason: "no confident rule match", source: "default" };
}

// ---------------------------------------------------------------------------
// Gemini fallback (used by pilot-chat when deterministic confidence is low)
// ---------------------------------------------------------------------------

export const WORKFLOW_AI_PROMPT = `You are Agentory's workflow classifier. Read the user message and choose EXACTLY
ONE workflow category. Do not answer the user. Do not run tools.

Categories:
- unsafe: requests for automated calling, mass dialing, or scraping personal/private phone numbers.
- simple_chat: greetings, thanks, small talk.
- capabilities: questions about what Agentory/Pilot can do or who is on the team.
- daily_brief: "brief me on today", "what needs my attention".
- market_research: current/market/competitor news or trends (NOT a specific URL).
- content_creation: write/produce a content artifact (LinkedIn post, blog, report, summary) with no lead sourcing or outreach.
- url_analysis: a specific URL to analyze/scrape.
- people_sourcing: find individual people/candidate profiles.
- company_hiring_sourcing: find companies that are hiring specific roles.
- outreach: draft or send outreach messages/emails (often after sourcing).
- vague_lead_sourcing: a sourcing/lead request whose target is unclear, OR an ambiguous talent request (could be individuals, companies, or agencies). Use this when clarification is needed.

Respond with ONLY this JSON: {"workflow":"<category>","reason":"<short>"}`;

const VALID_WORKFLOWS = new Set<Workflow>([
  "unsafe", "simple_chat", "capabilities", "daily_brief", "market_research",
  "content_creation", "url_analysis", "people_sourcing", "company_hiring_sourcing",
  "outreach", "vague_lead_sourcing",
]);

export function coerceAiWorkflow(raw: unknown): Workflow | null {
  const w = (raw as { workflow?: unknown } | null)?.workflow;
  if (typeof w === "string" && VALID_WORKFLOWS.has(w as Workflow)) return w as Workflow;
  return null;
}
