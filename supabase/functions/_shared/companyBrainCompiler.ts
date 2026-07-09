// Company Brain Compiler — the source of truth for Signals + Content.
//
// Turns a messy `company_brain.profile` (+ `signal_preferences`) into ONE
// structured CompanyBrainContext that every radar/content module consumes.
// Structured fields win over free text; free text is fallback only. It never
// invents an ICP when the Brain is empty — it produces a conservative context
// with warnings and weak confidence. Every derived term records `matched_from`
// (which Brain field produced it). Pure / Deno-testable.
//
// Reuses parseSizeLabel + DEFAULT_DISQUALIFIERS from companyBrainIcp.ts.

import { parseSizeLabel, DEFAULT_DISQUALIFIERS } from "./companyBrainIcp.ts";
import { normalizeCompanyBrain } from "./normalizeCompanyBrain.ts";


export type BrainConfidence = "strong" | "medium" | "weak";

export interface CompanyBrainContext {
  workspace_id: string;

  company_summary: {
    product_name?: string;
    category?: string;
    description?: string;
    value_prop?: string;
    target_outcome?: string;
  };

  icp: {
    industries: string[];
    categories: string[];
    business_models: string[];
    company_size_min?: number;
    company_size_max?: number;
    locations: string[];
    maturity_stage: string[];
    target_customer_segments: string[];
  };

  buyer_personas: {
    titles: string[];
    seniority: string[];
    departments: string[];
    title_keywords: string[];
    negative_title_keywords: string[];
  };

  buying_triggers: {
    hiring: string[];
    funding: string[];
    technology: string[];
    competitor: string[];
    workflow_pain: string[];
    content_topics: string[];
  };

  competitors_and_tools: {
    competitors: string[];
    adjacent_tools: string[];
    integration_tools: string[];
    watchlist: string[];
  };

  disqualifiers: {
    industries: string[];
    company_types: string[];
    titles: string[];
    keywords: string[];
    domains: string[];
  };

  query_strategy: {
    positive_terms: string[];
    negative_terms: string[];
    hiring_role_terms: string[];
    funding_terms: string[];
    linkedin_topic_terms: string[];
    competitor_terms: string[];
    workflow_terms: string[];
  };

  content_strategy: {
    audience: string[];
    core_beliefs: string[];
    proof_themes: string[];
    ctas: string[];
    banned_claims: string[];
    voice_notes: string[];
  };

  // Meta — honesty layer (not fabricated ICP).
  meta: {
    confidence: BrainConfidence;
    warnings: string[];
    derivation_sources: string[];
    /** derived term -> which Brain field(s) produced it */
    matched_from: Record<string, string[]>;
    /** true when the Brain lacks a workable ICP; radar/leads/content must degrade. */
    setup_required: boolean;
    schema_version: 1 | 2;
  };
}


// ---- SaaS/sales default expansions (applied ONLY when Brain shows that context) ----
const SAAS_POSITIVE_CATEGORIES = [
  "B2B SaaS", "AI SaaS", "sales software", "revenue operations software",
  "workflow automation", "data enrichment", "outbound infrastructure", "CRM", "pipeline automation",
];
const SAAS_BUYER_TITLES = [
  "Founder", "Co-Founder", "CEO", "Head of Growth", "Revenue Leader", "GTM Operator",
  "RevOps", "Revenue Operations", "Sales Ops", "Sales Operations",
];
const SAAS_HIRING_TRIGGERS = [
  "first sales hire", "Founding Account Executive", "Founding AE", "SDR",
  "Sales Development", "RevOps", "Revenue Operations", "Sales Operations", "Growth Lead",
];
const SAAS_FUNDING_TRIGGERS = ["recently funded", "seed", "Series A", "founder-led sales"];
const SAAS_TOOL_WATCHLIST = [
  "Clay", "Apollo", "Instantly", "Smartlead", "HubSpot", "Salesforce", "Attio", "Common Room", "Unify",
];
// Non-revenue titles that must never count as RevOps/GTM.
const HARD_NEGATIVE_TITLES = [
  "General Manager", "Plant Manager", "Facilities Manager", "Warehouse Manager", "Field Operations Manager",
];

const SAAS_CONTEXT_RE = /\b(b2b saas|ai saas|saas|software|platform|api|dev tool|revops|revenue operations|sales|gtm|go-?to-?market|outbound|crm|pipeline|automation|enrichment)\b/i;
const REVENUE_CONTEXT_RE = /\b(revops|revenue operations|sales operations|sales ops|gtm|go-?to-?market|revenue|sales|growth|account executive|sdr|bdr)\b/i;

function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}
function uniq(xs: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const x of xs) { const k = x.toLowerCase(); if (x && !seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

export interface CompileInput {
  workspace_id: string;
  profile?: Record<string, unknown> | null;
  signal_preferences?: Record<string, unknown> | null;
}

/** Compile the Company Brain into a structured, honest ICP intelligence object. */
export function compileCompanyBrainContext(input: CompileInput): CompanyBrainContext {
  const profile = (input.profile && typeof input.profile === "object" ? input.profile : {}) as Record<string, unknown>;
  const prefs = (input.signal_preferences ?? profile["signal_preferences"] ?? {}) as Record<string, unknown>;

  const company = (profile["company"] ?? {}) as Record<string, unknown>;
  const icpRaw = (profile["icp"] ?? {}) as Record<string, unknown>;
  const positioning = (profile["positioning"] ?? {}) as Record<string, unknown>;
  const brandVoice = (profile["brand_voice"] ?? {}) as Record<string, unknown>;
  const gtm = (profile["gtm"] ?? {}) as Record<string, unknown>;
  const goals = (profile["goals"] ?? {}) as Record<string, unknown>;
  const competitors = (profile["competitors"] ?? {}) as Record<string, unknown>;

  const derivationSources: string[] = [];
  const warnings: string[] = [];
  const matched_from: Record<string, string[]> = {};
  const mark = (term: string, source: string) => {
    if (!term) return;
    (matched_from[term] ??= []);
    if (!matched_from[term].includes(source)) matched_from[term].push(source);
  };
  const markAll = (terms: string[], source: string) => terms.forEach((t) => mark(t, source));

  // ---- structured-first reads ----
  const structuredIndustries = uniq([
    ...arr(icpRaw["industries"]),
    ...arr(prefs["industries"]),
  ]);
  const structuredBuyers = uniq([
    ...arr(icpRaw["buyer_roles"]),
    ...arr(prefs["hiring_roles"]),
  ]);
  const structuredCompetitors = uniq([
    ...arr(competitors["known"]),
    ...arr(prefs["competitors"]),
  ]);
  const adjacentTools = uniq(arr(competitors["adjacent"]));
  const integrationTools = uniq(arr(gtm["current_tools"]));
  const painPoints = uniq([...arr(icpRaw["pain_points"]), ...arr(prefs["pain_points"]), ...(str(gtm["biggest_bottleneck"]) ? [str(gtm["biggest_bottleneck"])!] : [])]);
  const contentTopics = uniq([...arr(prefs["linkedin_topics"]), ...arr(prefs["workflow_topics"]), ...(str(goals["content"]) ? [str(goals["content"])!] : [])]);
  const brainDisqualifiers = uniq([...arr(icpRaw["disqualifiers"]), ...arr(prefs["disqualifiers"])]);
  const sizeLabel = str(icpRaw["company_size"]) ?? str(company["team_size"]);
  const size = parseSizeLabel(sizeLabel);
  const geographies = uniq([...(str(icpRaw["geography"]) ? [str(icpRaw["geography"])!] : []), ...arr(prefs["geographies"]), ...(str(company["location"]) ? [str(company["location"])!] : [])]);

  markAll(structuredIndustries, "icp.industries");
  markAll(structuredBuyers, "icp.buyer_roles");
  markAll(structuredCompetitors, "competitors.known");
  markAll(painPoints, "icp.pain_points");
  markAll(contentTopics, "signal_preferences");

  const hasStructuredIcp = structuredIndustries.length > 0 || structuredBuyers.length > 0 || !!sizeLabel;
  if (hasStructuredIcp) derivationSources.push("structured_icp");

  // ---- SaaS / revenue context detection (from real Brain text, not assumed) ----
  const contextBlob = [
    str(company["category"]), str(company["industry"]), str(company["description"]),
    str(gtm["motion"]), str(positioning["promise"]), ...structuredIndustries, ...arr(prefs["keywords"]),
  ].filter(Boolean).join(" · ");
  const hasSaasContext = SAAS_CONTEXT_RE.test(contextBlob) || structuredIndustries.some((i) => SAAS_CONTEXT_RE.test(i));
  const hasRevenueContext = REVENUE_CONTEXT_RE.test(contextBlob) || structuredBuyers.some((b) => REVENUE_CONTEXT_RE.test(b));

  // ---- categories (expand only under SaaS context; otherwise literal) ----
  const categories = uniq([
    ...(str(company["category"]) ? [str(company["category"])!] : []),
    ...structuredIndustries,
    ...(hasSaasContext ? SAAS_POSITIVE_CATEGORIES : []),
  ]);
  if (str(company["category"])) mark(str(company["category"])!, "company.category");
  if (hasSaasContext) { markAll(SAAS_POSITIVE_CATEGORIES, "derived:saas_context"); }

  // ---- buyer personas ----
  const buyerTitles = uniq([...structuredBuyers, ...(hasSaasContext ? SAAS_BUYER_TITLES : [])]);
  if (hasSaasContext) markAll(SAAS_BUYER_TITLES, "derived:saas_context");
  const titleKeywords = uniq([...buyerTitles, ...(hasSaasContext ? SAAS_HIRING_TRIGGERS : [])]);
  const seniority = uniq(buyerTitles.flatMap(seniorityFor));
  const departments = uniq(buyerTitles.flatMap(departmentFor));

  // Negative titles: hard non-revenue titles always; "Operations Manager" only
  // when there is no revenue/RevOps context that could make it legitimate.
  const negativeTitleKeywords = uniq([
    ...HARD_NEGATIVE_TITLES,
    ...(hasRevenueContext ? [] : ["Operations Manager"]),
  ]);

  // ---- buying triggers ----
  const hiringTriggers = uniq([
    ...(str(goals["hiring"]) ? [str(goals["hiring"])!] : []),
    ...arr(prefs["hiring_roles"]),
    ...(hasSaasContext ? SAAS_HIRING_TRIGGERS : []),
  ]);
  const fundingTriggers = uniq(hasSaasContext ? SAAS_FUNDING_TRIGGERS : []);
  const competitorTriggers = uniq([...structuredCompetitors, ...adjacentTools]);
  const technologyTriggers = uniq(integrationTools);

  // ---- competitor watchlist (default sales-tool set only under SaaS context) ----
  const watchlist = uniq([
    ...structuredCompetitors, ...adjacentTools,
    ...(hasSaasContext ? SAAS_TOOL_WATCHLIST : []),
  ]);
  if (hasSaasContext) markAll(SAAS_TOOL_WATCHLIST, "derived:saas_context");

  // ---- disqualifiers (Brain wins; safe defaults only when Brain has none) ----
  const usedDefaultDisq = brainDisqualifiers.length === 0;
  const disqIndustries = usedDefaultDisq ? [...DEFAULT_DISQUALIFIERS] : brainDisqualifiers;
  markAll(brainDisqualifiers, "icp.disqualifiers");
  if (usedDefaultDisq) markAll(DEFAULT_DISQUALIFIERS, "default:high_risk");

  // ---- content strategy ----
  const bannedClaims = uniq([...arr(positioning["avoid_positioning"]), ...arr(brandVoice["avoid"])]);
  const proofThemes = uniq([...arr(positioning["proof_points"]), ...arr(positioning["use_cases"])]);
  const coreBeliefs = uniq([...arr(positioning["differentiators"]), ...painPoints]);
  const ctas = uniq([...(str(positioning["offer"]) ? [str(positioning["offer"])!] : []), ...(str(positioning["promise"]) ? [str(positioning["promise"])!] : [])]);
  const voiceNotes = uniq([...(str(brandVoice["tone"]) ? [str(brandVoice["tone"])!] : []), ...arr(brandVoice["tags"]), ...arr(brandVoice["style_rules"])]);
  const audience = uniq([...buyerTitles, ...arr(icpRaw["target_customer_segments"])]);

  // ---- query strategy ----
  const positiveTerms = uniq([...structuredIndustries, ...categories, ...buyerTitles]);
  const negativeTerms = uniq([...disqIndustries, ...negativeTitleKeywords]);
  const hiringRoleTerms = uniq([...buyerTitles, ...hiringTriggers]);
  const fundingTerms = uniq([...(hasSaasContext ? ["raised funding", "seed round", "Series A"] : []), ...categories.slice(0, 3)]);
  const linkedinTopicTerms = uniq([...contentTopics, ...painPoints]);
  const competitorTerms = uniq(watchlist);
  const workflowTerms = uniq([...painPoints, ...contentTopics]);

  // ---- confidence + warnings (honesty, not fake ICP) ----
  let confidence: BrainConfidence = "strong";
  if (!hasStructuredIcp) {
    confidence = "weak";
    warnings.push("Company Brain has no structured ICP — using conservative context. Fill ICP for precise radar.");
  } else if (structuredIndustries.length === 0 || buyerTitles.length === 0 || !sizeLabel) {
    confidence = "medium";
    if (structuredIndustries.length === 0) warnings.push("No target industries in Company Brain.");
    if (buyerTitles.length === 0) warnings.push("No buyer roles in Company Brain.");
    if (!sizeLabel) warnings.push("No target company size in Company Brain.");
  }
  if (usedDefaultDisq) warnings.push("Using default high-risk disqualifiers (Brain supplied none).");

  return {
    workspace_id: input.workspace_id,
    company_summary: {
      product_name: str(company["name"]) ?? undefined,
      category: str(company["category"]) ?? undefined,
      description: str(company["description"]) ?? undefined,
      value_prop: str(positioning["promise"]) ?? undefined,
      target_outcome: str(gtm["thirty_day_goal"]) ?? str(goals["gtm"]) ?? undefined,
    },
    icp: {
      industries: structuredIndustries,
      categories,
      business_models: uniq([...(str(gtm["motion"]) ? [str(gtm["motion"])!] : []), ...(hasSaasContext ? ["B2B SaaS"] : [])]),
      company_size_min: size.min ?? undefined,
      company_size_max: size.max ?? undefined,
      locations: geographies,
      maturity_stage: uniq([...(str(company["stage"]) ? [str(company["stage"])!] : [])]),
      target_customer_segments: uniq(arr(icpRaw["target_customer_segments"])),
    },
    buyer_personas: {
      titles: buyerTitles,
      seniority,
      departments,
      title_keywords: titleKeywords,
      negative_title_keywords: negativeTitleKeywords,
    },
    buying_triggers: {
      hiring: hiringTriggers,
      funding: fundingTriggers,
      technology: technologyTriggers,
      competitor: competitorTriggers,
      workflow_pain: painPoints,
      content_topics: contentTopics,
    },
    competitors_and_tools: {
      competitors: structuredCompetitors,
      adjacent_tools: adjacentTools,
      integration_tools: integrationTools,
      watchlist,
    },
    disqualifiers: {
      industries: disqIndustries,
      company_types: uniq(arr(icpRaw["disqualified_company_types"])),
      titles: negativeTitleKeywords,
      keywords: uniq(arr(prefs["negative_keywords"])),
      domains: uniq(arr(icpRaw["disqualified_domains"])),
    },
    query_strategy: {
      positive_terms: positiveTerms,
      negative_terms: negativeTerms,
      hiring_role_terms: hiringRoleTerms,
      funding_terms: fundingTerms,
      linkedin_topic_terms: linkedinTopicTerms,
      competitor_terms: competitorTerms,
      workflow_terms: workflowTerms,
    },
    content_strategy: {
      audience,
      core_beliefs: coreBeliefs,
      proof_themes: proofThemes,
      ctas,
      banned_claims: bannedClaims,
      voice_notes: voiceNotes,
    },
    meta: {
      confidence,
      warnings,
      derivation_sources: uniq(derivationSources),
      matched_from,
    },
  };
}

function seniorityFor(title: string): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  if (/founder|co-?founder|ceo|owner|president/.test(t)) out.push("founder/exec");
  if (/\b(vp|vice president|head of|chief|director)\b/.test(t)) out.push("leadership");
  if (/\b(manager|lead|ops|operations|sdr|bdr|account executive|ae)\b/.test(t)) out.push("ic/manager");
  return out.length ? out : ["unspecified"];
}

function departmentFor(title: string): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  if (/sales|account executive|ae|sdr|bdr/.test(t)) out.push("sales");
  if (/revenue|revops|revenue operations/.test(t)) out.push("revenue");
  if (/growth|gtm|marketing/.test(t)) out.push("growth");
  if (/founder|ceo|co-?founder/.test(t)) out.push("executive");
  if (/ops|operations/.test(t)) out.push("operations");
  return out.length ? out : ["unspecified"];
}
