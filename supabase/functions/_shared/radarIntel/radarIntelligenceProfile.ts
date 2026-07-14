// Radar Intelligence Profile — ONE canonical, workspace-specific intelligence
// profile compiled from the active Company Brain. Every radar source (hiring,
// posts, comments, competitors, workflow, funding) reads THIS, so a different
// Company Brain always produces a different plan. Pure / Deno-testable.
//
// Design rule (enforced by tests): NO production competitor names live in this
// module. Seeds like "Alta"/"Gojiberry AI" only ever arrive via a workspace's
// own Company Brain (competitors_and_tools). This file ships zero global seeds.

import type { CompanyBrainContext } from "../companyBrainCompiler.ts";

/** Generic, category-agnostic GTM signal families. These describe *shapes* of
 * buying behaviour, not any specific company — safe to keep global. */
export const GTM_LEADERSHIP_ROLE_FAMILY = [
  "revenue operations", "revops", "sales operations", "sales ops", "gtm operations", "go-to-market operations",
  "head of growth", "head of sales", "vp sales", "vp of sales", "vice president of sales",
  "chief revenue officer", "cro", "head of revenue", "head of gtm", "director of sales",
  "founding account executive", "founding ae", "founding sales", "first sales hire",
  "first sdr", "first bdr", "founding sdr", "founding bdr", "demand generation lead",
  "head of demand generation", "outbound lead", "head of outbound",
];
/** Individual-contributor sales roles — relevant but not a priority buyer. */
export const GTM_IC_ROLE_FAMILY = [
  "account executive", "sales development representative", "sdr", "bdr",
  "business development representative", "sales representative", "sales rep",
  "account manager", "growth marketer", "demand generation", "sales development",
];

export interface RadarIntelligenceProfile {
  workspace_id: string;
  usable: boolean; // false when the brain is setup_required — callers must not run providers
  brain_confidence: string;

  target_company: {
    industries: string[];
    categories: string[];
    business_models: string[];
    company_size: { min?: number; max?: number };
    geography: string[];
    must_have: string[];
    excluded_company_types: string[]; // agencies/nonprofits/etc. from the brain
    excluded_industries: string[];
    excluded_keywords: string[];
    excluded_domains: string[];
  };

  buyers: {
    /** Priority buyer titles the brain named. */
    titles: string[];
    /** Exact-match role terms = brain titles + GTM leadership/ops/founding family. */
    exact_role_terms: string[];
    /** Adjacent IC sales roles (relevant, lower priority). */
    adjacent_role_terms: string[];
    /** Titles that must never count (from the brain + non-GTM ops guard). */
    negative_role_terms: string[];
    seniority: string[];
  };

  buying_signals: {
    hiring: string[];
    funding: string[];
    launch_expansion: string[];
    workflow_pain: string[];
  };

  topics: string[]; // content + conversation topics for post/comment/workflow search

  competitors: {
    /** ONLY from this workspace's Company Brain — never global. */
    seeds: string[];
    adjacent_tools: string[];
    watchlist: string[];
  };
}

function uniqLower(xs: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const x of xs) { const t = (x ?? "").trim(); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); } }
  return out;
}

/** Detect whether the brain's own context is GTM/SaaS (drives which generic
 * signal families are appropriate — never assumed, read from the brain). */
function isGtmContext(brain: CompanyBrainContext): boolean {
  const blob = [
    brain.company_summary.category, brain.company_summary.description,
    ...brain.icp.industries, ...brain.icp.categories, ...brain.buyer_personas.titles,
  ].join(" ").toLowerCase();
  return /\b(b2b|saas|software|gtm|go-?to-?market|sales|revenue|revops|outbound|pipeline|growth)\b/.test(blob);
}

export function buildRadarIntelligenceProfile(brain: CompanyBrainContext): RadarIntelligenceProfile {
  const gtm = isGtmContext(brain);
  const brainTitles = uniqLower(brain.buyer_personas.titles);

  // Exact = brain's own titles + (only under GTM context) the generic leadership family.
  const exact_role_terms = uniqLower([...brainTitles, ...(gtm ? GTM_LEADERSHIP_ROLE_FAMILY : [])]);
  // Adjacent = IC sales roles under GTM context, minus anything already exact.
  const adjacent_role_terms = uniqLower((gtm ? GTM_IC_ROLE_FAMILY : []).filter((r) => !exact_role_terms.includes(r.toLowerCase())));

  return {
    workspace_id: brain.workspace_id,
    usable: !brain.meta.setup_required,
    brain_confidence: brain.meta.confidence,
    target_company: {
      industries: brain.icp.industries,
      categories: brain.icp.categories,
      business_models: brain.icp.business_models,
      company_size: { min: brain.icp.company_size_min, max: brain.icp.company_size_max },
      geography: brain.icp.locations,
      must_have: uniqLower([...brain.positive_examples, ...brain.icp.target_customer_segments]),
      excluded_company_types: uniqLower(brain.disqualifiers.company_types),
      excluded_industries: uniqLower(brain.disqualifiers.industries),
      excluded_keywords: uniqLower(brain.disqualifiers.keywords),
      excluded_domains: uniqLower(brain.disqualifiers.domains),
    },
    buyers: {
      titles: brainTitles,
      exact_role_terms,
      adjacent_role_terms,
      negative_role_terms: uniqLower(brain.buyer_personas.negative_title_keywords),
      seniority: uniqLower(brain.buyer_personas.seniority),
    },
    buying_signals: {
      hiring: uniqLower([...brain.buying_triggers.hiring, ...exact_role_terms.slice(0, 8)]),
      funding: uniqLower(brain.buying_triggers.funding),
      launch_expansion: uniqLower([...brain.buying_triggers.competitor, ...brain.buying_triggers.technology]),
      workflow_pain: uniqLower(brain.buying_triggers.workflow_pain),
    },
    topics: uniqLower([...brain.buying_triggers.content_topics, ...brain.query_strategy.workflow_terms, ...brain.query_strategy.linkedin_topic_terms]),
    competitors: {
      // Strictly workspace-sourced. No global fallback list.
      seeds: uniqLower(brain.competitors_and_tools.competitors),
      adjacent_tools: uniqLower(brain.competitors_and_tools.adjacent_tools),
      watchlist: uniqLower(brain.competitors_and_tools.watchlist),
    },
  };
}
