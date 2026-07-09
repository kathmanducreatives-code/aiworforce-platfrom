// Radar Scan Planner — turns the compiled Company Brain into a concrete, capped,
// Company-Brain-justified scan plan. It asks "what market changes matter to THIS
// workspace?", not "what can a provider find?". Pure / Deno-testable. It never
// generates queries that violate disqualifiers (those go in negative_terms), never
// exceeds caps, and attaches a Brain-derived reason to every source.

import type { CompanyBrainContext } from "./companyBrainCompiler.ts";

export type RadarSource =
  | "hiring" | "funding" | "linkedin_posts" | "linkedin_comments" | "competitor" | "workflow_trends";

export interface RadarSourcePlan {
  source: RadarSource;
  provider_preference: "apify" | "firecrawl" | "manual";
  enabled: boolean;
  reason: string;
  cap: number;
  queries: string[];
  negative_terms: string[];
  required_proof: string[];
}

export interface RadarScanPlan {
  workspace_id: string;
  brain_confidence: "strong" | "medium" | "weak";
  /** true when the Brain lacks a workable ICP — scan runs degraded, no verified Top Signals. */
  setup_required: boolean;
  source_plan: RadarSourcePlan[];
  warnings: string[];
}

export interface ScanPlanOptions {
  firecrawlReady?: boolean;
  apifyReady?: boolean;
  /** Per-source enable flags (Apify sources are opt-in; default off). */
  flags?: Partial<Record<RadarSource, boolean>>;
  mode?: "default" | "load_more";
}

const CAPS: Record<RadarSource, number> = {
  hiring: 10, funding: 10, linkedin_posts: 10, linkedin_comments: 30, competitor: 15, workflow_trends: 10,
};

function uniq(xs: string[]): string[] { return [...new Set(xs.filter((x) => x && x.trim()))]; }
function dedupeQueries(xs: string[], cap: number): string[] { return uniq(xs).slice(0, cap); }

/** Pick the strongest ICP category/industry terms to seed queries. */
function seedCategories(brain: CompanyBrainContext): string[] {
  const cats = uniq([...brain.icp.industries, ...brain.icp.categories]);
  // Prefer concise SaaS-style seeds; fall back to a conservative generic seed.
  const preferred = cats.filter((c) => /saas|software|b2b|ai|sales|revenue|crm|pipeline/i.test(c));
  const seeds = (preferred.length ? preferred : cats).slice(0, 3);
  return seeds.length ? seeds : ["B2B software startup"];
}

export function buildRadarScanPlan(brain: CompanyBrainContext, options: ScanPlanOptions = {}): RadarScanPlan {
  const firecrawlReady = options.firecrawlReady ?? true;
  const apifyReady = options.apifyReady ?? false;
  const flags = options.flags ?? {};
  const setupRequired = brain.meta.setup_required;
  // An incomplete Brain runs the same conservative, low-cap path as a weak Brain.
  const weak = brain.meta.confidence === "weak" || setupRequired;
  const capScale = weak ? 0.5 : options.mode === "load_more" ? 1.6 : 1;
  const capOf = (s: RadarSource) => Math.max(3, Math.round(CAPS[s] * capScale));

  const negatives = uniq([...brain.query_strategy.negative_terms, ...brain.disqualifiers.industries]);
  const seeds = seedCategories(brain);
  const roles = brain.query_strategy.hiring_role_terms.length ? brain.query_strategy.hiring_role_terms : ["Founding Account Executive", "RevOps"];
  const watchlist = brain.competitors_and_tools.watchlist;
  const workflowTerms = uniq([...brain.query_strategy.workflow_terms, ...brain.buying_triggers.content_topics]);
  const linkedinTerms = uniq([...brain.query_strategy.linkedin_topic_terms, ...brain.buying_triggers.content_topics]);

  const warnings = [...brain.meta.warnings];
  if (setupRequired) warnings.push("Company Brain incomplete — complete setup for a high-quality scan. Running conservative, low-cap queries and no verified Top Signals until then.");
  else if (weak) warnings.push("Company Brain is weak — running conservative, low-cap queries. Fill ICP for precise radar.");

  // ---- query builders (Brain-derived, never disqualifier-violating) ----
  const hiringQueries = dedupeQueries(
    roles.slice(0, 3).flatMap((role) => seeds.slice(0, 2).map((cat) => `${cat} hiring "${role}"`)),
    weak ? 3 : 5,
  );
  const fundingQueries = dedupeQueries(
    seeds.slice(0, 3).flatMap((cat) => ["raised seed funding", "raised Series A funding"].map((f) => `${cat} ${f} 2026`)),
    weak ? 3 : 5,
  );
  const competitorQueries = dedupeQueries(
    watchlist.slice(0, 5).flatMap((c) => [`${c} product launch`, `${c} pricing update`, `${c} changelog`]),
    weak ? 3 : 6,
  );
  const workflowQueries = dedupeQueries(workflowTerms.slice(0, 6).map((t) => `"${t}" 2026`), weak ? 3 : 6);
  const postQueries = dedupeQueries(linkedinTerms.slice(0, 6), weak ? 3 : 6);

  const source_plan: RadarSourcePlan[] = [
    {
      source: "hiring",
      provider_preference: (apifyReady && flags.hiring) ? "apify" : "firecrawl",
      enabled: (apifyReady && !!flags.hiring) || firecrawlReady, // Firecrawl fallback keeps hiring runnable
      reason: `Your ICP targets ${seeds[0]} companies hiring ${roles[0]} and similar buyer roles (Company Brain).`,
      cap: capOf("hiring"),
      queries: hiringQueries,
      negative_terms: negatives,
      required_proof: ["job_url", "company_domain_or_website"],
    },
    {
      source: "funding",
      provider_preference: "firecrawl",
      enabled: firecrawlReady && !!flags.funding,
      reason: `Recently funded ${seeds[0]} companies are building revenue — timely for outreach (Company Brain).`,
      cap: capOf("funding"),
      queries: fundingQueries,
      negative_terms: negatives,
      required_proof: ["funding_source_url"],
    },
    {
      source: "linkedin_posts",
      provider_preference: (apifyReady && flags.linkedin_posts) ? "apify" : "firecrawl",
      enabled: (apifyReady && !!flags.linkedin_posts) || firecrawlReady,
      reason: `Posts about ${linkedinTerms[0] ?? "your category"} reveal buyer pain and content angles (Company Brain).`,
      cap: capOf("linkedin_posts"),
      queries: postQueries,
      negative_terms: negatives,
      required_proof: ["post_url"],
    },
    {
      source: "linkedin_comments",
      provider_preference: "apify",
      enabled: apifyReady && !!flags.linkedin_comments, // no Firecrawl fallback
      reason: "Comments under relevant posts surface active buyer pain — runs only from known post URLs.",
      cap: capOf("linkedin_comments"),
      queries: [],
      negative_terms: negatives,
      required_proof: ["parent_post_url"],
    },
    {
      source: "competitor",
      provider_preference: "firecrawl",
      enabled: firecrawlReady && watchlist.length > 0,
      reason: watchlist.length ? `Track movement from your watchlist: ${watchlist.slice(0, 3).join(", ")} (Company Brain).` : "No competitors in Company Brain — add some to enable competitor tracking.",
      cap: capOf("competitor"),
      queries: competitorQueries,
      negative_terms: negatives,
      required_proof: ["source_url"],
    },
    {
      source: "workflow_trends",
      provider_preference: "firecrawl",
      enabled: firecrawlReady && workflowTerms.length > 0,
      reason: workflowTerms.length ? `Category trends around ${workflowTerms[0]} inform content and timing (Company Brain).` : "No workflow/content topics in Company Brain — add pain points to enable trend tracking.",
      cap: capOf("workflow_trends"),
      queries: workflowQueries,
      negative_terms: negatives,
      required_proof: ["source_url"],
    },
  ];

  return {
    workspace_id: brain.workspace_id,
    brain_confidence: brain.meta.confidence,
    setup_required: setupRequired,
    source_plan,
    warnings: uniq(warnings),
  };
}
