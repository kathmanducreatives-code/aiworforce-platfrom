// Phase 4 (dynamic) — Competitor Discovery.
// Turns a user's business context (website / LinkedIn / description / company
// brain / memory) into competitor hypotheses and LinkedIn search-query groups,
// then a deterministic discovery plan shape. Pure / import-free except the
// seed registry (also pure) so it stays unit-testable.
//
// IMPORTANT: this helper NEVER invents competitor names. It only surfaces
// competitors that are (a) known seeds mentioned in the context, or (b) supplied
// explicitly. Inferring competitors from a website/description is an LLM step
// performed at runtime by Hawk/Scribe in orchestration — not here.

import { matchCompetitors, getCompetitors, type CompetitorCategory } from "./competitorRegistry.ts";

export type DiscoveryMode = "website" | "description" | "known" | "needs_context";

export interface BusinessContext {
  website_url: string | null;
  linkedin_url: string | null;
  description: string | null;
  brain_summary: string | null;
}

const EMPTY_CONTEXT: BusinessContext = {
  website_url: null, linkedin_url: null, description: null, brain_summary: null,
};

const LINKEDIN_URL_RE = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s)]+/i;
const HTTP_URL_RE = /https?:\/\/[^\s)]+/i;
const DESCRIPTION_RE =
  /\b(?:we|our (?:company|product|startup|tool|platform))\s+(?:sell|sells|are|is|build|builds|make|makes|offer|offers|provide|provides|help|helps|do|does|create|creates)\b\s+(.+?)(?:[.!?]|$)/i;

/** Pull any business context embedded directly in the user's message. */
export function extractInlineBusinessContext(message: string): BusinessContext {
  if (!message || typeof message !== "string") return { ...EMPTY_CONTEXT };
  const linkedin = message.match(LINKEDIN_URL_RE)?.[0] ?? null;
  // First non-LinkedIn http URL = the user's website.
  let website: string | null = null;
  for (const u of message.match(new RegExp(HTTP_URL_RE, "ig")) ?? []) {
    if (!/linkedin\.com/i.test(u)) { website = u.replace(/[.,;:]+$/, ""); break; }
  }
  const descMatch = message.match(DESCRIPTION_RE);
  const description = descMatch ? descMatch[1].trim().replace(/\b(?:and )?(?:find|track|discover|monitor)\b.*$/i, "").trim() : null;
  return { website_url: website, linkedin_url: linkedin, description: description || null, brain_summary: null };
}

/** Merge inline context with stored context (company_brain / memory). */
export function mergeContext(inline: BusinessContext, stored: Partial<BusinessContext>): BusinessContext {
  return {
    website_url: inline.website_url ?? stored.website_url ?? null,
    linkedin_url: inline.linkedin_url ?? stored.linkedin_url ?? null,
    description: inline.description ?? stored.description ?? null,
    brain_summary: inline.brain_summary ?? stored.brain_summary ?? null,
  };
}

export function hasEnoughContext(ctx: BusinessContext): boolean {
  return !!(ctx.website_url || ctx.linkedin_url || (ctx.description && ctx.description.length >= 8) || (ctx.brain_summary && ctx.brain_summary.length >= 8));
}

export function resolveDiscoveryMode(ctx: BusinessContext): DiscoveryMode {
  if (ctx.website_url || ctx.linkedin_url) return "website";
  if ((ctx.description && ctx.description.length >= 8) || (ctx.brain_summary && ctx.brain_summary.length >= 8)) return "description";
  return "needs_context";
}

export interface CompetitorHypotheses {
  hypotheses: string[];           // known/explicit competitor names only (never invented)
  category: CompetitorCategory | null;
  source: "known" | "none";       // "none" → orchestration must infer via Hawk/Scribe
}

/**
 * Surface competitor hypotheses from available context. Only returns known
 * seed competitors actually mentioned in the context; otherwise returns an empty
 * list with source="none" (caller's LLM step must infer — we never invent).
 */
export function buildCompetitorHypotheses(ctx: BusinessContext, extraText = ""): CompetitorHypotheses {
  const blob = [ctx.description, ctx.brain_summary, extraText].filter(Boolean).join("  ");
  const known = matchCompetitors(blob);
  if (known.length > 0) {
    // Most common category among matches.
    const counts: Record<string, number> = {};
    for (const k of known) counts[k.category] = (counts[k.category] ?? 0) + 1;
    const category = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) as CompetitorCategory | null;
    return { hypotheses: dedupeNames(known.map((k) => k.name)), category, source: "known" };
  }
  return { hypotheses: [], category: null, source: "none" };
}

function dedupeNames(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, 12);
}

export interface SearchQueryGroups {
  direct_mentions: string[];
  comparisons: string[];
  complaints: string[];
  alternative_seeking: string[];
  category_discussions: string[];
  audience_engagement: string[];
}

const CATEGORY_TERMS: Record<CompetitorCategory, string> = {
  ai_sdr: "AI SDR tools",
  gtm_data: "GTM data enrichment tools",
  sales_engagement: "sales engagement platforms",
  community_intel: "community intelligence tools",
  outbound_infra: "cold email / outbound tools",
  other: "sales automation tools",
};

/** Build LinkedIn search-query groups from competitor hypotheses + category. */
export function buildLinkedInSearchQueryGroups(
  hypotheses: string[],
  opts: { category?: CompetitorCategory | null; topic?: string | null } = {},
): SearchQueryGroups {
  const names = dedupeNames(hypotheses);
  const groups: SearchQueryGroups = {
    direct_mentions: [],
    comparisons: [],
    complaints: [],
    alternative_seeking: [],
    category_discussions: [],
    audience_engagement: [],
  };
  for (const n of names) {
    groups.direct_mentions.push(n);
    groups.comparisons.push(`${n} vs`);
    groups.complaints.push(`${n} problems`);
    groups.alternative_seeking.push(`alternative to ${n}`);
    groups.audience_engagement.push(`people commenting on ${n} posts`);
  }
  if (opts.category) groups.audience_engagement.push(`founders talking about ${CATEGORY_TERMS[opts.category]}`);
  const catTerm = opts.category ? CATEGORY_TERMS[opts.category] : null;
  if (catTerm) {
    groups.category_discussions.push(catTerm);
    groups.comparisons.push(`${catTerm} comparison`);
  }
  if (opts.topic && opts.topic.trim()) groups.category_discussions.push(opts.topic.trim());
  if (groups.category_discussions.length === 0 && names.length === 0) {
    groups.category_discussions.push("AI SDR tools comparison");
  }
  // dedupe each group
  (Object.keys(groups) as (keyof SearchQueryGroups)[]).forEach((k) => {
    groups[k] = Array.from(new Set(groups[k]));
  });
  return groups;
}

/** Flatten query groups into a capped, deduped list for the actor. */
export function flattenQueryGroups(groups: SearchQueryGroups, max = 8): string[] {
  const ordered = [
    ...groups.direct_mentions,
    ...groups.alternative_seeking,
    ...groups.complaints,
    ...groups.comparisons,
    ...groups.category_discussions,
    ...groups.audience_engagement,
  ];
  return Array.from(new Set(ordered)).slice(0, Math.max(1, max));
}

export interface DiscoveryPlanStep {
  agent_slug: "hawk" | "scout" | "aria" | "scribe" | "penn";
  tool_needed: string | null;
  task_title: string;
  task_description: string;
  requires_approval?: boolean;
}

export interface DiscoveryPlan {
  plan_summary: string;
  steps: DiscoveryPlanStep[];
}

/**
 * Build the deterministic competitor-discovery plan shape.
 * - website: Hawk(Firecrawl the site → infer competitors) → Scout → Aria → [Scribe]/[Penn]
 * - description: Hawk/Scribe(infer competitors from description) → Scout → Aria → [..]
 * - known: Scout → Aria → [..]
 */
export function buildCompetitorDiscoveryPlan(mode: DiscoveryMode, opts: {
  website_url?: string | null;
  description?: string | null;
  topic?: string | null;
  needs_comment_drafts?: boolean;
  needs_dm_drafts?: boolean;
  max?: number | null;
} = {}): DiscoveryPlan {
  const cap = Math.max(1, Math.min(20, opts.max ?? 10));
  const topic = (opts.topic ?? opts.description ?? opts.website_url ?? "your competitors").toString();
  const steps: DiscoveryPlanStep[] = [];

  if (mode === "website") {
    steps.push({
      agent_slug: "hawk",
      tool_needed: "scrape_url",
      task_title: "Analyze site → identify competitors",
      task_description: `Analyze ${opts.website_url ?? "the user's website"} to understand what they sell, then list 5-8 likely competitors and the product category. Ground it in the page; do not invent vague names.`,
    });
  } else if (mode === "description") {
    steps.push({
      agent_slug: "hawk",
      tool_needed: "extract_structured",
      task_title: "Infer competitors from description",
      task_description: `From this business description, infer 5-8 likely competitors and the product category: "${opts.description ?? topic}". Only name real, plausible competitors; if unsure, say so rather than inventing.`,
    });
  }

  steps.push({
    agent_slug: "scout",
    tool_needed: "source_with_apify",
    task_title: "Search LinkedIn for competitor conversations",
    task_description: `Find up to ${cap} LinkedIn posts/people discussing the competitors and category for: ${topic}. Use the LinkedIn posts actor only. Do not invent profiles or contact info.`,
  });
  steps.push({
    agent_slug: "aria",
    tool_needed: "extract_structured",
    task_title: "Rank competitor signals",
    task_description: `Rank the competitor-engagement signals by ICP fit, founder/GTM/operator role, complaint/switching/comparison intent, competitor relevance, and recency. Label hot | warm | maybe | ignore.`,
  });
  if (opts.needs_comment_drafts) {
    steps.push({
      agent_slug: "scribe",
      tool_needed: "summarize_text",
      task_title: "Draft LinkedIn comments",
      task_description: `Draft short, human, non-pitchy comments for the top posts. Add genuine value; no "great post!" filler; nothing auto-posted.`,
    });
  }
  if (opts.needs_dm_drafts) {
    steps.push({
      agent_slug: "penn",
      tool_needed: "draft_outreach",
      requires_approval: true,
      task_title: "Draft soft follow-up DMs",
      task_description: `Draft soft, no-pitch DMs referencing the competitor/post context, one light question, approval required, never auto-send.`,
    });
  }

  const label = mode === "website" ? "Analyze site → discover competitors → search → rank"
    : mode === "description" ? "Infer competitors → search → rank"
    : "Search → rank";
  return { plan_summary: `Competitor discovery (${label}): ${topic}`.slice(0, 140), steps };
}

// ===========================================================================
// Phase 4.2 — richer dynamic competitor query planner.
// ===========================================================================

export type ConversationType =
  | "direct_mention" | "comparison" | "complaint"
  | "alternative_seeking" | "category_discussion" | "audience_engagement";

export interface DynamicCompetitorInput {
  companyName?: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  businessDescription?: string;
  productCategory?: string;
  icp?: string;
  knownCompetitors?: string[];
}

export interface CompetitorHypothesis {
  name?: string;
  category: string;
  reason: string;
  confidence: number;            // 0..1
  source: "seed" | "website" | "linkedin" | "description" | "memory" | "ai_inferred" | "serp";
  keywords: string[];
}

export interface CompetitorQueryPlan {
  competitors: CompetitorHypothesis[];
  query_groups: {
    direct_mentions: string[];
    comparisons: string[];
    complaints: string[];
    alternative_seeking: string[];
    category_discussion: string[];
    audience_engagement: string[];
  };
  search_budget: {
    max_queries: number;
    max_results_per_query: number;
    scrape_comments: boolean;
    scrape_reactions: boolean;
  };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Classify a post/query's conversation angle (text-only heuristic). */
export function classifyConversationType(text: string): ConversationType {
  const t = (text || "").toLowerCase();
  if (/\b(looking for|recommend|suggestions? for|need (?:a|an)\b|best .*\b(?:tool|tools|platform|software))\b/.test(t)) return "alternative_seeking";
  if (/\b(vs\.?|versus|compare|comparison|comparing|alternatives?\b|alternative to)\b/.test(t)) return "comparison";
  if (/\b(problem|issue|broken|frustrat|hate|annoying|hard to|too expensive|overpriced|churn|disappoint|bug|sucks?)\b/.test(t)) return "complaint";
  if (/\b(comment|commenting|repl(?:y|ies|ying)|engag(?:e|ing|ement)|reacted|liked|discussion thread)\b/.test(t)) return "audience_engagement";
  return "category_discussion";
}

export function extractBusinessContext(input: DynamicCompetitorInput): BusinessContext {
  return {
    website_url: input.websiteUrl ?? null,
    linkedin_url: input.linkedinUrl ?? null,
    description: input.businessDescription ?? input.productCategory ?? null,
    brain_summary: null,
  };
}

export function hasEnoughCompetitorContext(input: DynamicCompetitorInput): boolean {
  if (Array.isArray(input.knownCompetitors) && input.knownCompetitors.length > 0) return true;
  return hasEnoughContext(extractBusinessContext(input));
}

/** Normalize raw hypotheses: dedupe, clamp confidence, cap to 10, drop noisy one-word non-brand terms. */
export function normalizeCompetitorHypotheses(raw: CompetitorHypothesis[] | string[]): CompetitorHypothesis[] {
  const list: CompetitorHypothesis[] = (raw as unknown[]).map((r) =>
    typeof r === "string"
      ? { name: r, category: "other", reason: "supplied", confidence: 0.5, source: "seed" as const, keywords: [] }
      : (r as CompetitorHypothesis)
  );
  const seen = new Set<string>();
  const out: CompetitorHypothesis[] = [];
  for (const h of list) {
    const name = (h.name ?? "").trim();
    if (!name) continue;
    // Drop noisy one-word lowercase terms unless they're a known seed.
    const isKnown = getCompetitors().some((c) => [c.name, ...c.aliases].some((a) => a.toLowerCase() === name.toLowerCase()));
    const oneWordLower = /^[a-z][a-z0-9]+$/.test(name) && !name.includes(" ");
    if (oneWordLower && !isKnown) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...h,
      name,
      confidence: clamp01(typeof h.confidence === "number" ? h.confidence : 0.5),
      keywords: Array.from(new Set((h.keywords ?? []).filter((k) => typeof k === "string" && k.trim()))),
    });
  }
  return out.slice(0, 10);
}

/** Build a full competitor query plan from structured input. */
export function buildCompetitorQueryPlan(input: DynamicCompetitorInput): CompetitorQueryPlan {
  const ctx = extractBusinessContext(input);
  const blob = [input.businessDescription, input.productCategory, input.icp, (input.knownCompetitors ?? []).join(" ")].filter(Boolean).join("  ");
  const seedMatches = matchCompetitors(blob);

  const hypotheses: CompetitorHypothesis[] = [];
  // Explicit known competitors (highest confidence).
  for (const kc of input.knownCompetitors ?? []) {
    const seed = getCompetitors().find((c) => [c.name, ...c.aliases].some((a) => a.toLowerCase() === kc.toLowerCase()));
    hypotheses.push({
      name: seed?.name ?? kc, category: seed?.category ?? "other",
      reason: "user-supplied competitor", confidence: 0.95, source: "seed",
      keywords: seed?.keywords ?? [],
    });
  }
  // Seeds detected in the description/category.
  for (const m of seedMatches) {
    hypotheses.push({
      name: m.name, category: m.category,
      reason: `mentioned in business context (${m.matched_terms.join(", ")})`,
      confidence: 0.7, source: "description", keywords: [],
    });
  }
  const competitors = normalizeCompetitorHypotheses(hypotheses);
  const category = (competitors[0]?.category ?? null) as CompetitorCategory | null;
  const groups = buildLinkedInSearchQueryGroups(competitors.map((c) => c.name!).filter(Boolean), {
    category,
    topic: input.productCategory ?? input.businessDescription ?? null,
  });

  return {
    competitors,
    query_groups: {
      direct_mentions: groups.direct_mentions,
      comparisons: groups.comparisons,
      complaints: groups.complaints,
      alternative_seeking: groups.alternative_seeking,
      category_discussion: groups.category_discussions,
      audience_engagement: groups.audience_engagement,
    },
    search_budget: {
      max_queries: 5,
      max_results_per_query: 5,
      scrape_comments: true,
      scrape_reactions: false,
    },
  };
}

export function buildCompetitorSearchQueries(hypotheses: CompetitorHypothesis[], originalGoal?: string | null): string[] {
  const groups = buildLinkedInSearchQueryGroups(hypotheses.map((h) => h.name!).filter(Boolean), {
    category: (hypotheses[0]?.category ?? null) as CompetitorCategory | null,
    topic: originalGoal ?? null,
  });
  return flattenQueryGroups(groups, 8);
}

// re-export for convenience
export { getCompetitors };
