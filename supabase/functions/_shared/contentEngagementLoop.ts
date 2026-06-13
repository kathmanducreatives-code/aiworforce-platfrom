// Phase 7 — Founder Content + Engagement Loop (pure, unit-testable helper).
//
// Turns a content+engagement prompt into:
//   1) a post brief (topic / audience / tone / angle) for Scribe, and
//   2) a capped set of LinkedIn engagement search queries for Scout.
//
// No network, no AI, no secrets. Never invents a product update — if the user
// references "these updates" without providing them, productUpdate stays empty
// and the caller (Pilot/Scribe) asks or uses company context.
//
// Safety: this helper only plans DISCOVERY of posts/topics. It never plans
// scraping of commenter/reactor lists (scrape_comments / scrape_reactions are
// off) — consistent with the no-people-harvesting rule.

import { buildCompetitorSearchQueries, matchCompetitors } from "./competitorRegistry.ts";

export type ContentFormat = "linkedin_post" | "post_ideas" | "thread" | "comment";

export interface ContentLoopInput {
  topic?: string;
  productUpdate?: string;
  targetAudience?: string;
  tone?: string;
  contentFormat?: ContentFormat;
  maxPosts?: number;
  needsEngagementSearch?: boolean;
  needsCommentDrafts?: boolean;
  needsDmDrafts?: boolean;
  competitorRelated?: boolean;
}

export interface ContentLoopPlan {
  post_brief: {
    topic: string;
    audience?: string;
    tone: string;
    angle: string;
  };
  engagement_queries: string[];
  search_budget: {
    max_queries: number;
    max_results_per_query: number;
    scrape_comments: boolean;
    scrape_reactions: boolean;
  };
}

export interface ContentLoopDrafts {
  post: string | null;
  post_ideas: string[];
  comments: string[];
}

export const DEFAULT_TONE = "founder-led, clear, human, non-hype";
export const MAX_ENGAGEMENT_QUERIES = 5;
export const MAX_RESULTS_PER_QUERY = 5;

const COMPETITOR_HINT_RE =
  /\b(competitors?|competing|alternatives?|vs\.?|versus|switching from|switch from|why .* (?:fail|fails|suck|don'?t work))\b/i;
const COMMENT_HINT_RE = /\b(comments?|commenting|repl(?:y|ies)|respond(?:ing)? to)\b/i;
const DM_HINT_RE = /\b(dms?|direct messages?|follow[- ]?ups?|reach out|message them)\b/i;
const ENGAGE_HINT_RE =
  /\b(find|discover|surface|look for)\b[^.!?]*\b(people|posts?|conversations?|threads?|leads?|prospects?|opportunit(?:y|ies))\b|\b(engage with|comment on|reply to|engagement opportunit(?:y|ies)|relevant conversations|conversations to (?:engage|comment))\b/i;

function clean(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/\s+/g, " ");
  return t.length ? t : null;
}

/** Strip trailing "and find/then …" engagement clause from a topic phrase. */
function trimTopic(t: string): string {
  return t
    .replace(/\b(?:,?\s*(?:and|then|&)\s+(?:find|draft|write|create|search|look|get|comment|reply|engage|distribute)\b).*$/i, "")
    .replace(/\b(?:to (?:engage|comment|reply)\b).*$/i, "")
    .replace(/[.,;:\s]+$/, "")
    .trim();
}

/** Pull a topic phrase out of a content prompt. Never returns engagement verbs. */
function extractTopic(prompt: string): string | null {
  const m = prompt.match(/\b(?:about|on|re:|regarding|covering)\s+([A-Za-z0-9 ,&/+\-'"]{3,80})/i);
  if (m) {
    const t = trimTopic(m[1]);
    if (t) return t;
  }
  // "what we shipped this week" style → keep as the topic verbatim (trimmed).
  const shipped = prompt.match(/\b(what we (?:shipped|built|launched|released)[A-Za-z0-9 ,&/+\-]*)/i);
  if (shipped) return trimTopic(shipped[1]);
  return null;
}

function extractFormat(prompt: string): ContentFormat {
  if (/\bpost ideas?\b|\bcontent ideas?\b|\b\d+\s+(?:linkedin\s+)?posts?\b/i.test(prompt)) return "post_ideas";
  if (/\bthread\b/i.test(prompt)) return "thread";
  if (/\b(draft|write)\s+(?:a\s+)?comment\b/i.test(prompt)) return "comment";
  return "linkedin_post";
}

function extractMaxPosts(prompt: string): number | undefined {
  const m = prompt.match(/\b(\d{1,2})\s+(?:linkedin\s+)?(?:post|content)\s*(?:ideas?|s)?\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return Math.min(10, n);
  }
  return undefined;
}

/** Parse a raw user prompt into a ContentLoopInput. Never fabricates updates. */
export function extractContentLoopInput(prompt: string): ContentLoopInput {
  const p = (prompt ?? "").trim();
  const competitorRelated = COMPETITOR_HINT_RE.test(p) || matchCompetitors(p).length > 0;

  // Only capture a product update if the user actually supplied text after a
  // "turn this/these update(s) into" phrase. A bare reference ("these product
  // updates") with no inline content yields no productUpdate (don't invent).
  let productUpdate: string | undefined;
  const turn = p.match(/\bturn\s+(?:these|this|the following)\s+(?:product\s+)?updates?\s+(?:into[^:]*)?[:\-—]\s*(.+)$/i);
  if (turn && clean(turn[1])) productUpdate = clean(turn[1])!;

  return {
    topic: extractTopic(p) ?? undefined,
    productUpdate,
    contentFormat: extractFormat(p),
    maxPosts: extractMaxPosts(p),
    needsEngagementSearch: ENGAGE_HINT_RE.test(p) || /\bcontent (?:engagement )?loop\b/i.test(p),
    needsCommentDrafts: COMMENT_HINT_RE.test(p),
    needsDmDrafts: DM_HINT_RE.test(p),
    competitorRelated,
  };
}

/** Resolve the audience: explicit input → company_brain ICP → undefined. */
function resolveAudience(input: ContentLoopInput, companyBrain?: Record<string, unknown> | null): string | undefined {
  const explicit = clean(input.targetAudience);
  if (explicit) return explicit;
  const b = companyBrain ?? {};
  for (const key of ["icp", "who_we_sell_to", "target_audience", "audience", "ideal_customer"]) {
    const v = clean((b as Record<string, unknown>)[key] as string);
    if (v) return v;
  }
  return undefined;
}

/** Best-effort topic when none was parsed: derive from productUpdate or brain. */
function resolveTopic(input: ContentLoopInput, companyBrain?: Record<string, unknown> | null): string {
  const t = clean(input.topic);
  if (t) return t;
  const pu = clean(input.productUpdate);
  if (pu) return pu.split(/[.!?\n]/)[0].split(/\s+/).slice(0, 8).join(" ");
  const what = clean((companyBrain ?? {})["what_we_do"] as string);
  if (what) return what.split(/\s+/).slice(0, 8).join(" ");
  return "";
}

/**
 * Build capped engagement search queries from the input. Competitor-related
 * topics produce competitor-style queries (alternatives / switching / vs).
 * Never returns an empty query when a topic exists.
 */
export function buildContentLoopQueries(
  input: ContentLoopInput,
  companyBrain?: Record<string, unknown> | null,
): string[] {
  const topic = resolveTopic(input, companyBrain);
  const audience = resolveAudience(input, companyBrain);
  if (!topic) return [];

  let queries: string[];
  if (input.competitorRelated) {
    const matched = matchCompetitors(topic);
    const comp = matched.length ? buildCompetitorSearchQueries({ competitors: matched, topic, query: topic }) : [];
    queries = comp.length
      ? comp
      : [topic, `${topic} alternatives`, `switching from ${topic}`, `problems with ${topic}`, `${topic} vs`];
  } else {
    queries = [
      topic,
      audience ? `${topic} for ${audience}` : `${topic} for founders`,
      `${topic} lessons`,
      `${topic} mistakes`,
      `${topic} examples`,
    ];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const c = clean(q);
    if (!c) continue;
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= MAX_ENGAGEMENT_QUERIES) break;
  }
  return out;
}

/** Build the full content-loop plan (post brief + engagement queries + budget). */
export function buildContentLoopPlan(
  input: ContentLoopInput,
  companyBrain?: Record<string, unknown> | null,
): ContentLoopPlan {
  const topic = resolveTopic(input, companyBrain);
  const audience = resolveAudience(input, companyBrain);
  const tone = clean(input.tone) ?? DEFAULT_TONE;
  const angle = input.competitorRelated
    ? "Honest founder take on where incumbent tools fall short — augment, never trash-talk."
    : "Founder lesson: what we learned / what we shipped and why it matters to the reader.";

  const engagement_queries = (input.needsEngagementSearch ?? true)
    ? buildContentLoopQueries(input, companyBrain)
    : [];

  const maxPerQuery = Math.max(1, Math.min(MAX_RESULTS_PER_QUERY, MAX_RESULTS_PER_QUERY));

  return {
    post_brief: { topic, audience, tone, angle },
    engagement_queries,
    search_budget: {
      max_queries: Math.min(MAX_ENGAGEMENT_QUERIES, Math.max(engagement_queries.length, 1)),
      max_results_per_query: maxPerQuery,
      // Discovery only: never harvest commenter/reactor lists.
      scrape_comments: false,
      scrape_reactions: false,
    },
  };
}

/** Normalize a Scribe content-loop output into structured drafts (best-effort). */
export function normalizeContentLoopDrafts(raw: unknown): ContentLoopDrafts {
  if (typeof raw === "string") {
    const t = raw.trim();
    return { post: t.length ? t : null, post_ideas: [], comments: [] };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const post = clean(o.post as string) ?? clean(o.body as string);
    const ideas = Array.isArray(o.post_ideas) ? (o.post_ideas as unknown[]).map((x) => clean(String(x))).filter(Boolean) as string[] : [];
    const comments = Array.isArray(o.comments) ? (o.comments as unknown[]).map((x) => clean(String(x))).filter(Boolean) as string[] : [];
    return { post: post ?? null, post_ideas: ideas, comments };
  }
  return { post: null, post_ideas: [], comments: [] };
}
