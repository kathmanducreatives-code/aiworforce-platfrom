// Draft validation + repair (Research Quality v2).
//
// The model is a strategist, not an oracle. Before a draft ever reaches the
// review UI it passes through here, which:
//
//   * sanitizes shapes (arrays are arrays, no empty strings, no duplicate or
//     glued chips);
//   * ensures the draft is USEFUL — at least 3 buyer personas when we know what
//     the company sells, at least 5 disqualifiers when we know who it targets,
//     and always a full set of qualification rules;
//   * strips claims the model cannot possibly know (funding, named customers,
//     integrations, competitors-as-fact) unless a source actually said so;
//   * moves everything unsupported into `needs_confirmation`;
//   * downgrades confidence so a thin read can never present as certainty.
//
// Suggestions are DERIVED FROM THIS COMPANY's product and the user's input.
// Nothing here is hardcoded to any particular customer.
//
// Pure. No network, no providers.

import {
  type BuyerPersona, type CompanyUnderstanding, type ResearchConfidence,
  asString, cleanChip, cleanChips, uniq, capConfidence,
} from "./types.ts";

// ---------------------------------------------------------------- personas ---

// NOTE: these match word STEMS on purpose. `\brecruit\b` does not match
// "recruiting" (there is no word boundary mid-stem), which silently dropped the
// recruiting persona. Use a leading \b and let the suffix run free.
/** Role families we can defend from a product's primary users / category. */
const PERSONA_LIBRARY: Array<{
  match: RegExp;
  persona: Omit<BuyerPersona, "confidence" | "needs_confirmation">;
}> = [
  {
    match: /\b(founder|startup|small team|early[- ]stage|smb)/i,
    persona: {
      title: "Founder / CEO", role_keywords: ["Founder", "Co-Founder", "CEO", "Owner"],
      department: "Executive", seniority: "Founder / Executive",
      pains: ["No time to build pipeline", "Selling alongside running the company"],
      cares_about: ["Revenue predictability", "Time saved", "Cost vs hiring"],
      likely_objection: "I can do this myself, or my team already does it.",
      outreach_angle: "Pipeline without adding headcount.",
    },
  },
  {
    match: /\b(sales|outbound|prospect|pipeline|crm|account executive|sdr|gtm|go-to-market|revenue)/i,
    persona: {
      title: "Head of Sales / GTM", role_keywords: ["Head of Sales", "VP Sales", "CRO", "Head of GTM", "Head of Revenue"],
      department: "Sales", seniority: "Leadership",
      pains: ["Reps spend time on research, not selling", "Inconsistent pipeline coverage"],
      cares_about: ["Quota attainment", "Rep productivity", "Forecast accuracy"],
      likely_objection: "We already have a sales stack.",
      outreach_angle: "More qualified meetings from the same team.",
    },
  },
  {
    match: /\b(revops|revenue operations|sales ?ops|operations|workflow|automation)/i,
    persona: {
      title: "RevOps / Sales Ops", role_keywords: ["RevOps", "Revenue Operations", "Sales Operations", "GTM Ops"],
      department: "Revenue Operations", seniority: "Manager / Lead",
      pains: ["Manual data hygiene", "Tools that don't talk to each other"],
      cares_about: ["Data quality", "Process reliability", "Integration effort"],
      likely_objection: "Another tool to maintain and integrate.",
      outreach_angle: "Less manual work, cleaner data into the CRM.",
    },
  },
  {
    match: /\b(marketing|content|demand gen|campaign|brand)/i,
    persona: {
      title: "Head of Marketing / Growth", role_keywords: ["Head of Marketing", "Head of Growth", "Demand Gen", "CMO"],
      department: "Marketing", seniority: "Leadership",
      pains: ["Pipeline attribution is unclear", "Content doesn't convert"],
      cares_about: ["Cost per opportunity", "Channel efficiency"],
      likely_objection: "This looks like a sales tool, not a marketing one.",
      outreach_angle: "Turn market signals into campaigns that convert.",
    },
  },
  {
    match: /\b(recruit|talent|hiring|candidate|ats)/i,
    persona: {
      title: "Head of Talent / Recruiting", role_keywords: ["Head of Talent", "Talent Acquisition", "Recruiting Lead"],
      department: "People", seniority: "Leadership",
      pains: ["Sourcing takes too long", "Poor candidate quality"],
      cares_about: ["Time to hire", "Candidate experience"],
      likely_objection: "Our ATS already does this.",
      outreach_angle: "Better sourcing signal, less manual screening.",
    },
  },
  {
    match: /\b(developer|engineer|api|sdk|infrastructure|devops)/i,
    persona: {
      title: "Engineering Lead", role_keywords: ["Engineering Manager", "VP Engineering", "CTO", "Tech Lead"],
      department: "Engineering", seniority: "Leadership",
      pains: ["Build vs buy pressure", "Maintenance burden"],
      cares_about: ["Reliability", "Docs and API quality", "Security"],
      likely_objection: "We could build this internally.",
      outreach_angle: "Ship the capability without owning the maintenance.",
    },
  },
  {
    match: /\b(analytics|data|reporting|dashboard|bi)/i,
    persona: {
      title: "Data / Analytics Lead", role_keywords: ["Head of Data", "Analytics Lead", "BI Manager"],
      department: "Data", seniority: "Manager / Lead",
      pains: ["Reports assembled by hand", "Sources disagree"],
      cares_about: ["Single source of truth", "Trustworthy numbers"],
      likely_objection: "We already have a BI stack.",
      outreach_angle: "Decision-ready data without the manual assembly.",
    },
  },
];

/** A last-resort economic buyer when nothing else matches but a company exists. */
const GENERIC_ECONOMIC_BUYER: Omit<BuyerPersona, "confidence" | "needs_confirmation"> = {
  title: "Founder / CEO", role_keywords: ["Founder", "Co-Founder", "CEO"],
  department: "Executive", seniority: "Founder / Executive",
  pains: [], cares_about: ["Business outcome", "Cost"],
  likely_objection: "Unclear why this matters to us right now.",
  outreach_angle: "",
};

export interface PersonaContext {
  product_category: string;
  one_line_summary: string;
  primary_users: string[];
  key_features: string[];
  user_description?: string;
}

/**
 * Draft at least 3 buyer personas whenever we understand the product.
 * Every persona is a hypothesis: `needs_confirmation` is always true, and
 * confidence never exceeds what the evidence supports.
 */
export function suggestBuyerPersonas(ctx: PersonaContext, ceiling: ResearchConfidence = "medium"): BuyerPersona[] {
  const blob = [
    ctx.product_category, ctx.one_line_summary, ctx.user_description ?? "",
    ...ctx.primary_users, ...ctx.key_features,
  ].filter(Boolean).join(" ");
  if (!blob.trim()) return []; // no company context → invent nothing

  const matched = PERSONA_LIBRARY.filter((p) => p.match.test(blob));
  const chosen = matched.length ? matched.map((m) => m.persona) : [];

  // Always include the economic buyer if not already present.
  const hasExec = chosen.some((p) => /founder|ceo/i.test(p.title));
  if (!hasExec) chosen.unshift(GENERIC_ECONOMIC_BUYER);

  // Guarantee at least 3 when we know the product; pad from the library by
  // relevance order rather than inventing new titles.
  for (const { persona } of PERSONA_LIBRARY) {
    if (chosen.length >= 3) break;
    if (!chosen.some((c) => c.title === persona.title)) chosen.push(persona);
  }

  return chosen.slice(0, 5).map((p) => ({
    ...p,
    confidence: capConfidence("medium", ceiling),
    needs_confirmation: true,
  }));
}

// ----------------------------------------------------------- disqualifiers ---

export interface DisqualifierBucketsDraft {
  industries: string[];
  company_types: string[];
  keywords: string[];
  titles: string[];
  domains: string[];
}

export interface DisqualifierContext {
  product_category: string;
  business_model: string;
  target_industries: string[];
  primary_users: string[];
  user_description?: string;
}

/**
 * Suggest ≥5 disqualifiers derived from what this company actually sells.
 * Nothing here names a specific customer of ours — the rules are computed from
 * the product category, business model and stated target.
 */
export function suggestDisqualifiers(ctx: DisqualifierContext): DisqualifierBucketsDraft {
  const blob = [ctx.product_category, ctx.business_model, ctx.user_description ?? "", ...(ctx.primary_users ?? []), ...ctx.target_industries].join(" ").toLowerCase();

  const out: DisqualifierBucketsDraft = { industries: [], company_types: [], keywords: [], titles: [], domains: [] };

  const domain = detectProductDomain({
    product_category: ctx.product_category, one_line_summary: ctx.user_description ?? "",
    primary_users: ctx.primary_users ?? [], key_features: [], user_description: ctx.user_description,
  });
  const targetsSmb = /smb|startup|small team|founder|early[- ]stage|scale[- ]?up/.test(blob);

  if (domain === 'recruiting') {
    // A recruiter's structural non-buyers: companies that don't need to hire,
    // can't pay, or already staff internally. NEVER "non-software services".
    out.industries.push("companies not actively hiring", "non-tech / traditional industries outside our niche");
    out.company_types.push("other recruiting or staffing agencies", "companies with a fully-staffed in-house talent team", "solo founders with no hiring budget");
    out.keywords.push("hiring freeze", "no open roles");
  } else if (domain === 'agency_services') {
    out.company_types.push("companies that keep this function fully in-house", "no budget for outside help");
    out.industries.push("industries outside our specialism");
  } else {
    // Software / gtm / generic — a software seller's structural non-buyers.
    const sellsSoftware = /saas|software|platform|\bapi\b|developer|analytics|crm|\bai\b/.test(blob);
    if (sellsSoftware) {
      out.industries.push("non-software services", "local services", "manufacturing");
      out.company_types.push("agencies", "consultancies");
    }
    // Only exclude recruiting when recruiting is NOT what we sell/serve.
    if (sellsSoftware) out.industries.push("staffing and recruiting");
    if (/marketplace/.test(blob)) out.company_types.push("marketplaces");
    out.titles.push("Plant Manager", "Facilities Manager", "Warehouse Manager");
  }

  if (targetsSmb) out.company_types.push("enterprise-only organisations");

  // Generic non-buyer categories, appended so we always reach a useful floor.
  const FLOOR = ["government", "education", "non-profit", "franchises"];
  for (const f of FLOOR) {
    if (totalCount(out) >= 6) break;
    if (!out.industries.includes(f)) out.industries.push(f);
  }

  return {
    industries: cleanChips(out.industries),
    company_types: cleanChips(out.company_types),
    keywords: cleanChips(out.keywords),
    titles: cleanChips(out.titles),
    domains: cleanChips(out.domains),
  };
}

function totalCount(d: DisqualifierBucketsDraft): number {
  return d.industries.length + d.company_types.length + d.keywords.length + d.titles.length + d.domains.length;
}

export function countDisqualifiers(d: Partial<DisqualifierBucketsDraft> | undefined): number {
  if (!d) return 0;
  return (d.industries?.length ?? 0) + (d.company_types?.length ?? 0) + (d.keywords?.length ?? 0)
    + (d.titles?.length ?? 0) + (d.domains?.length ?? 0);
}

// ---------------------------------------------------------- product domain ---

/**
 * What kind of product/service this is. Drives domain-appropriate ICP
 * suggestions instead of assuming every company is a GTM/leads tool — the exact
 * failure that gave a recruitment AGENCY lead-gen pains and content angles.
 */
export type ProductDomain = 'recruiting' | 'gtm_sales' | 'marketing' | 'agency_services' | 'generic';

function ctxBlob(ctx: PersonaContext): string {
  return [ctx.product_category, ctx.one_line_summary, ctx.user_description ?? "", ...ctx.primary_users, ...ctx.key_features]
    .filter(Boolean).join(" ").toLowerCase();
}

/**
 * Classify the product domain. Trust the VETTED product_category first, then the
 * user's own description — NOT the noisy key_features blob (which can carry
 * example-customer mentions like "a recruiting agency used us" and wrongly flip
 * the domain). Recruiting/staffing wins over GTM only when the company itself is
 * a recruiter, not when it merely hires GTM talent or names a recruiting example.
 */
export function detectProductDomain(ctx: PersonaContext): ProductDomain {
  const cat = (ctx.product_category ?? "").toLowerCase();
  const desc = `${ctx.one_line_summary ?? ""} ${ctx.user_description ?? ""}`.toLowerCase();

  // 1) The category earned repeated support in the understanding pass — trust it.
  if (/agenc|staffing|recruit/.test(cat)) return 'recruiting';
  if (/market/.test(cat)) return 'marketing';
  if (/lead|sales|gtm|go[- ]to[- ]market|workforce|pipeline|outbound|prospect|revenue|crm/.test(cat)) return 'gtm_sales';

  // 2) Then the user's own description / one-liner (high-trust, not scraped chrome).
  const strongRecruit = /\b(recruit\w*|staffing|talent acquisition|headhunt\w*|placement (?:agency|firm)|time[- ]to[- ]hire|we (?:hire|place|source) (?:talent|candidates|people)|talent (?:partner|agency)|hiring (?:agency|partner))\b/;
  const strongLead = /\b(lead (?:intelligence|scoring|generation|gen)|pipeline (?:generation|intelligence)|ai workforce|sales (?:engagement|intelligence)|prospect\w*|outbound (?:platform|automation)|signal[- ]based|buying signal|gtm (?:engine|platform)|finds? leads?)\b/;
  if (strongRecruit.test(desc) && !strongLead.test(desc)) return 'recruiting';
  if (strongLead.test(desc)) return 'gtm_sales';
  if (/\b(marketing|demand gen\w*|campaign)\b/.test(desc)) return 'marketing';

  // 3) Generic services / agency fallback.
  if (/\b(agency|consultanc\w*|consulting|done[- ]for[- ]you|services firm|professional services)\b/.test(`${cat} ${desc}`)) return 'agency_services';
  return 'generic';
}

// ------------------------------------------------------- target customer -----

export interface TargetCustomerSuggestion {
  industries: string[];
  business_models: string[];
  company_size_label: string;
  must_have: string[];
}

/**
 * Suggest a target-customer hypothesis when the model returned nothing but we
 * DO understand the product. Domain-aware: a recruiting agency targets the
 * companies it hires FOR, not "B2B SaaS subscription software". Everything here
 * is confirmed by the user before it targets anyone.
 */
export function suggestTargetCustomer(ctx: PersonaContext): TargetCustomerSuggestion {
  const blob = ctxBlob(ctx);
  if (!blob.trim()) return { industries: [], business_models: [], company_size_label: "", must_have: [] };

  const domain = detectProductDomain(ctx);
  const foundersFocus = /founder|early[- ]stage|startup|scale[- ]?up|smb|small team/.test(blob);
  const industries: string[] = [];
  const business_models: string[] = [];
  const must_have: string[] = [];
  let company_size_label = "";

  if (domain === 'recruiting') {
    // Buyers are the companies that need to hire, not the recruiting market.
    const techFocus = /\b(tech|software|saas|engineering|product|startup|scale[- ]?up)\b/.test(blob);
    industries.push(...(techFocus ? ["high-growth tech startups", "venture-backed SaaS companies", "scale-ups"] : ["high-growth companies", "scale-ups"]));
    company_size_label = "11-500 employees";
    must_have.push("actively hiring or scaling headcount", "funded or revenue-generating");
    if (foundersFocus) must_have.push("founder-led or without a full in-house talent team");
  } else if (domain === 'agency_services') {
    industries.push("businesses that outsource this function", "growing companies");
    must_have.push("has budget for outside help", "an active website");
  } else {
    // gtm_sales / marketing / generic — software-style targeting.
    const b2b = /\bb2b\b|sales|leads?|pipeline|gtm|outbound|revops/.test(blob);
    const sellsSoftware = /saas|software|platform|\bapi\b|\bai\b|analytics|crm/.test(blob);
    if (b2b || sellsSoftware) {
      industries.push("B2B SaaS", "technology");
      business_models.push("B2B SaaS");
      must_have.push("sells to other businesses", "has an active website");
    }
    if (foundersFocus) { industries.push("early-stage startups"); company_size_label ||= "1-50 employees"; must_have.push("founder-led or small GTM team"); }
    if (!industries.length && sellsSoftware) { industries.push("software companies"); business_models.push("SaaS"); }
  }

  return {
    industries: cleanChips(industries),
    business_models: cleanChips(business_models),
    company_size_label,
    must_have: cleanChips(must_have),
  };
}

// -------------------------------------------------------------- triggers -----

export interface TriggerSuggestion {
  triggers: string[];
  jobs_to_watch: string[];
}

/** Suggest buying triggers + jobs to watch — domain-appropriate. */
export function suggestTriggers(ctx: PersonaContext): TriggerSuggestion {
  const blob = ctxBlob(ctx);
  if (!blob.trim()) return { triggers: [], jobs_to_watch: [] };

  const domain = detectProductDomain(ctx);
  const triggers: string[] = [];
  const jobs_to_watch: string[] = [];

  if (domain === 'recruiting') {
    // For a recruiter, the trigger is a company that suddenly needs to hire.
    triggers.push(
      "raised a new funding round",
      "opened multiple senior or hard-to-fill roles",
      "expanding into a new market or region",
      "new VP/Head hire signaling a team build-out",
      "announced plans to scale the team",
    );
    jobs_to_watch.push("VP Engineering", "Head of Sales / GTM", "Founding Account Executive", "Head of Talent");
  } else if (domain === 'gtm_sales') {
    triggers.push(
      "raised a funding round",
      "hiring first sales or growth roles",
      "launching an outbound motion",
      "new Head of Growth or Sales joined",
    );
    jobs_to_watch.push("Founding Account Executive", "SDR / BDR", "Head of Growth", "GTM Lead");
  } else if (domain === 'marketing') {
    triggers.push("launched a new product or rebrand", "raised a funding round");
    jobs_to_watch.push("Head of Marketing", "Demand Generation Manager");
  } else {
    triggers.push("raised a funding round", "leadership hire in the buying department", "expanding into a new market");
    jobs_to_watch.push("Head of Operations", "relevant department lead");
  }

  return { triggers: cleanChips(triggers).slice(0, 6), jobs_to_watch: cleanChips(jobs_to_watch).slice(0, 6) };
}

// -------------------------------------------------- content + brand voice ----

export interface VoiceSuggestion {
  content_angles: string[];
  pain_points: string[];
  brand_voice: { tone: string; tags: string[]; avoid: string[] };
}

/** Suggest content angles, pain points and a brand voice — domain-appropriate. */
export function suggestVoiceAndAngles(ctx: PersonaContext): VoiceSuggestion {
  const blob = ctxBlob(ctx);
  if (!blob.trim()) return { content_angles: [], pain_points: [], brand_voice: { tone: "", tags: [], avoid: [] } };

  const domain = detectProductDomain(ctx);
  const foundersFocus = /founder|early[- ]stage|startup|scale[- ]?up|smb/.test(blob);
  const aiProduct = /\bai\b|agent|workforce|automat/.test(blob);
  const content_angles: string[] = [];
  const pain_points: string[] = [];

  if (domain === 'recruiting') {
    content_angles.push(
      "how to hire your founding GTM or engineering team",
      "why time-to-hire kills startup momentum",
      "building high-impact teams before you scale",
      "hiring elite talent in a competitive market",
    );
    pain_points.push(
      "can't find elite talent fast enough",
      "time-to-hire is too slow while the team needs to ship",
      "in-house recruiting can't keep up with scaling",
      "hard-to-find senior or strategic hires",
    );
  } else if (domain === 'gtm_sales') {
    content_angles.push(
      "why static lead lists fail",
      "signal-based lead finding beats cold lists",
      "review before outreach: quality over volume",
    );
    pain_points.push("pipeline is inconsistent", "lead lists are stale and generic");
    if (foundersFocus) { content_angles.push("pipeline before payroll: sell before you hire SDRs"); pain_points.push("no time to prospect while building the product"); }
    if (aiProduct) { content_angles.push("AI-assisted GTM without spam"); pain_points.push("automation tools spray and pray"); }
  } else if (domain === 'marketing') {
    content_angles.push("turn market signals into campaigns that convert", "what buyers get wrong about this category");
    pain_points.push("pipeline attribution is unclear", "content doesn't convert");
  } else {
    content_angles.push("what buyers get wrong about this category", "how to evaluate options like ours");
    pain_points.push("the current approach is manual and slow");
  }

  const tags = uniq([
    ...(foundersFocus ? ["founder-focused"] : []),
    ...(domain === 'recruiting' ? ["human", "outcome-driven"] : []),
    ...(domain === 'gtm_sales' ? ["outcome-driven", "anti-spam"] : []),
    ...(aiProduct ? ["strategic"] : []),
    "direct", "premium",
  ]);

  return {
    content_angles: cleanChips(content_angles).slice(0, 6),
    pain_points: cleanChips(pain_points).slice(0, 5),
    brand_voice: {
      tone: foundersFocus ? "direct, premium, founder-to-founder" : "direct, credible, specific",
      tags,
      avoid: ["hype without proof", "spammy claims", "generic buzzwords"],
    },
  };
}

// ------------------------------------------------------ qualification rules --

export interface QualificationRulesDraft {
  required_evidence: string[];
  reject_if: string[];
  manual_review_if: string[];
}

/** Always produce a full, defensible set of qualification rules. */
export function suggestQualificationRules(ctx: { hasIndustries: boolean; hasTriggers: boolean }): QualificationRulesDraft {
  return {
    required_evidence: uniq([
      "company matches target industry or business model",
      "a buyer role from the ICP exists at the company",
      ...(ctx.hasTriggers ? ["a current buying trigger is present"] : []),
      "website or company page confirms product fit",
      "source URL for the signal",
    ]),
    reject_if: uniq([
      "company matches a disqualifier",
      "evidence is only a buyer title with no company fit",
      "a staffing or recruiter proxy stands in for the real employer",
      "no company website or identity",
      "no proof of the claimed trigger",
    ]),
    manual_review_if: uniq([
      "company fit is unclear",
      "the signal is weak or stale",
      ...(ctx.hasIndustries ? ["ICP match is inferred but not proven"] : ["no ICP industries defined yet"]),
      "a funding or hiring claim lacks a source",
    ]),
  };
}

// -------------------------------------------------- unsupported-claim guard --

/** Claims a model must never assert without a page that says so. */
const FUNDING_RE = /\b(raised|seed round|series [a-e]|funding|valuation|\$\d+\s?(m|million|b|billion))\b/i;

/**
 * The measurable tokens in a claim ("3x", "40%", "12hours").
 * A proof claim counts as sourced only when a page carried the SAME measurement.
 * The model may paraphrase the wording; it may never paraphrase the number.
 */
export function numericTokens(s: string): string[] {
  const m = s.toLowerCase().match(
    /\d+(?:[.,]\d+)?\s?(?:x|%|hours?|days?|weeks?|customers?|users?|teams?|companies|leads?|meetings?)/g,
  );
  return (m ?? []).map((t) => t.replace(/\s+/g, ""));
}

function proofIsSourced(claim: string, sourceProof: string[]): boolean {
  const claimTokens = numericTokens(claim);
  if (!claimTokens.length) return false; // a "proof point" with no number is not proof
  const sourceTokens = new Set(sourceProof.flatMap(numericTokens));
  return claimTokens.some((t) => sourceTokens.has(t));
}

/**
 * Drop model-asserted claims that no source supports. Funding is never
 * inferable from a website scrape, so it is always stripped.
 */
export function stripUnsupportedClaims(args: {
  proof_points: string[];
  positive_examples: string[];
  integrations: string[];
  competitors: string[];
  sourceProof: string[];       // proof actually read from pages
  sourceIntegrations: string[];// integrations actually read from pages
  hasSourcePages: boolean;
}): {
  proof_points: string[]; positive_examples: string[]; integrations: string[];
  competitors: string[]; needs_confirmation: string[]; dropped: string[];
} {
  const needs_confirmation: string[] = [];
  const dropped: string[] = [];

  // Proof must have been READ. A model-authored proof point is not proof.
  const proof_points = args.proof_points.filter((p) => {
    if (FUNDING_RE.test(p)) { dropped.push(`funding claim: ${p}`); return false; }
    if (!proofIsSourced(p, args.sourceProof)) { dropped.push(`unsourced proof: ${p}`); return false; }
    return true;
  });

  // Integrations must be stated on a page.
  const integrations = args.integrations.filter((i) => {
    const supported = args.sourceIntegrations.some((s) => s.toLowerCase().includes(i.toLowerCase()));
    if (!supported) { dropped.push(`unsourced integration: ${i}`); return false; }
    return true;
  });

  // Named customers are a factual claim about the world — always confirm.
  const positive_examples = args.positive_examples;
  if (positive_examples.length) needs_confirmation.push("positive_examples");

  // Competitors are a hypothesis, never a fact.
  const competitors = args.competitors;
  if (competitors.length) needs_confirmation.push("competitors");

  return { proof_points, positive_examples, integrations, competitors, needs_confirmation, dropped };
}

// -------------------------------------------------------------- sanitizing ---

/** Force a value to a clean string array (arrays, glued chips, dupes, empties). */
export function toCleanArray(v: unknown): string[] {
  return cleanChips(v);
}

/** Clean a persona coming back from the model. */
export function cleanPersona(raw: unknown, ceiling: ResearchConfidence): BuyerPersona | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = cleanChip(o.title);
  if (!title) return null;
  return {
    title,
    role_keywords: cleanChips(o.role_keywords),
    department: cleanChip(o.department),
    seniority: cleanChip(o.seniority),
    pains: cleanChips(o.pains),
    cares_about: cleanChips(o.cares_about ?? o.what_they_care_about),
    likely_objection: cleanChip(o.likely_objection),
    outreach_angle: cleanChip(o.outreach_angle),
    confidence: capConfidence((asString(o.confidence) as ResearchConfidence) || "low", ceiling),
    needs_confirmation: true,
  };
}

/** The confidence ceiling a draft may claim, given what was actually read. */
export function draftConfidenceCeiling(u: CompanyUnderstanding | null | undefined): ResearchConfidence {
  if (!u) return "low";
  if (!u.evidence.length) return "low";
  if (u.ambiguous) return "medium";
  return u.confidence;
}
