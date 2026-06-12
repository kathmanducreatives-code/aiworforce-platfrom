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
    return { hypotheses: normalizeCompetitorHypotheses(known.map((k) => k.name)), category, source: "known" };
  }
  return { hypotheses: [], category: null, source: "none" };
}

export function normalizeCompetitorHypotheses(list: string[]): string[] {
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
  const names = normalizeCompetitorHypotheses(hypotheses);
  const groups: SearchQueryGroups = {
    direct_mentions: [],
    comparisons: [],
    complaints: [],
    alternative_seeking: [],
    category_discussions: [],
  };
  for (const n of names) {
    groups.direct_mentions.push(n);
    groups.comparisons.push(`${n} vs`);
    groups.complaints.push(`${n} problems`);
    groups.alternative_seeking.push(`alternative to ${n}`);
  }
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

// re-export for convenience
export { getCompetitors };
