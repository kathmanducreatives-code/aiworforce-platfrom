// intentRouter: deterministic-first intent classification for pilot-chat.
// Returns one of:
//   simple_chat | daily_brief | source_signals | analyze_url |
//   rank_existing_leads | enrich_existing_leads | draft_outreach |
//   send_requires_approval | content | unclear
//
// Used by pilot-chat to short-circuit work that doesn't need full orchestration.

import { generateJson } from "./aiProvider.ts";

export type Intent =
  | "simple_chat"
  | "daily_brief"
  | "source_signals"
  | "analyze_url"
  | "rank_existing_leads"
  | "enrich_existing_leads"
  | "draft_outreach"
  | "send_requires_approval"
  | "content"
  | "unclear";

export interface IntentResult {
  intent: Intent;
  confidence: number;
  reason: string;
  clarification?: string;
  source: "regex" | "ai" | "default";
}

const URL_RE = /https?:\/\/\S+/i;
const DAILY_BRIEF_RE =
  /\b(daily brief|brief me( on today)?|today'?s (command )?brief|what (happened|should i know) today|plan my day|what needs my attention)\b/i;
const SOURCE_RE =
  /\b(find|source|sourcing|discover|identify|leads?|prospects?|companies|founders?|engineers?|developers?|marketers?|recruiters?|hiring|candidates?)\b/i;
const RANK_RE =
  /\b(rank|score|shortlist|prioriti[sz]e|sort)\s+(my|the|existing|saved|current)?\s*(leads?|candidates?|companies)\b/i;
const ENRICH_RE = /\b(enrich|research|deep dive|analyze (website|company)|profile (the|these)?)\b/i;
const DRAFT_RE = /\b(draft|write)\s+(an?\s+)?(outreach|email|message|dm|note|sequence|cold)\b/i;
const SEND_RE = /\b(send|deliver|fire off)\b.*\b(email|message|dm|outreach)\b/i;
const CONTENT_RE =
  /\b(write|post|publish)\s+(a |an |the )?(linkedin|tweet|blog|article|post|memo|report|summary|brief)\b/i;
const GREETING_RE =
  /^\s*(hi|hello|hey|yo|sup|gm|good (morning|afternoon|evening)|thanks|thank you|ty|cool|nice|ok|okay|got it|cheers)[\s.!?]*$/i;
const CAPABILITY_RE =
  /\b(what can you do|who('?s| is) on the team|who are you|how do you work|what is (this|pilot)|help)\b/i;

function quickRegex(prompt: string): IntentResult | null {
  const t = prompt.trim();
  if (!t) return { intent: "unclear", confidence: 1, reason: "empty prompt", source: "default" };

  if (GREETING_RE.test(t) || CAPABILITY_RE.test(t)) {
    return { intent: "simple_chat", confidence: 0.95, reason: "greeting/capability question", source: "regex" };
  }
  if (DAILY_BRIEF_RE.test(t)) {
    return { intent: "daily_brief", confidence: 0.95, reason: "daily brief phrasing", source: "regex" };
  }
  if (URL_RE.test(t)) {
    return { intent: "analyze_url", confidence: 0.9, reason: "URL present", source: "regex" };
  }
  if (SEND_RE.test(t)) {
    return { intent: "send_requires_approval", confidence: 0.85, reason: "send phrasing", source: "regex" };
  }
  if (RANK_RE.test(t)) {
    return { intent: "rank_existing_leads", confidence: 0.8, reason: "rank existing items", source: "regex" };
  }
  if (ENRICH_RE.test(t) && !SOURCE_RE.test(t)) {
    return { intent: "enrich_existing_leads", confidence: 0.75, reason: "enrich existing items", source: "regex" };
  }
  if (DRAFT_RE.test(t) && !SOURCE_RE.test(t)) {
    return { intent: "draft_outreach", confidence: 0.8, reason: "draft outreach without sourcing", source: "regex" };
  }
  if (SOURCE_RE.test(t)) {
    return { intent: "source_signals", confidence: 0.85, reason: "sourcing verbs/nouns", source: "regex" };
  }
  if (CONTENT_RE.test(t)) {
    return { intent: "content", confidence: 0.8, reason: "content authoring", source: "regex" };
  }
  return null;
}

const INTENT_SET: Intent[] = [
  "simple_chat",
  "daily_brief",
  "source_signals",
  "analyze_url",
  "rank_existing_leads",
  "enrich_existing_leads",
  "draft_outreach",
  "send_requires_approval",
  "content",
  "unclear",
];

export async function classifyIntent(prompt: string): Promise<IntentResult> {
  const quick = quickRegex(prompt);
  if (quick && quick.confidence >= 0.75) return quick;

  // AI fallback for ambiguous prompts.
  const ai = await generateJson({
    taskType: "helper",
    systemPrompt:
      "You classify a user prompt for an AI GTM workforce. Return ONLY JSON: " +
      `{"intent":"<one of ${INTENT_SET.join("|")}>","confidence":0..1,"reason":"short"}. ` +
      "Use simple_chat for greetings/small talk/capability questions. " +
      "Use source_signals when the user wants to find new companies/people/leads. " +
      "Use analyze_url when a URL is present. " +
      "Use draft_outreach for writing emails/messages without sourcing. " +
      "Use send_requires_approval when the user explicitly says send. " +
      "Use content for posts/blogs/articles. " +
      "Use unclear when intent isn't determinable.",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    maxTokens: 200,
    jsonMode: true,
    functionName: "intentRouter",
  });

  if (ai.ok && ai.json) {
    const o = ai.json as { intent?: string; confidence?: number; reason?: string };
    const intent = INTENT_SET.includes(o.intent as Intent) ? (o.intent as Intent) : "unclear";
    const confidence = typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0.5;
    return {
      intent: confidence < 0.5 ? "unclear" : intent,
      confidence,
      reason: o.reason ?? "ai classification",
      source: "ai",
    };
  }

  if (quick) return quick;
  return { intent: "unclear", confidence: 0.3, reason: "no signal", source: "default" };
}
