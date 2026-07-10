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
    match: /\b(sales|outbound|prospect|pipeline|crm|account executive|sdr)/i,
    persona: {
      title: "Head of Sales / Revenue", role_keywords: ["Head of Sales", "VP Sales", "CRO", "Head of Revenue"],
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
  const blob = [ctx.product_category, ctx.business_model, ctx.user_description ?? "", ...ctx.target_industries].join(" ").toLowerCase();

  const out: DisqualifierBucketsDraft = { industries: [], company_types: [], keywords: [], titles: [], domains: [] };

  const sellsSoftware = /saas|software|platform|api|developer|analytics|crm|ai\b/.test(blob);
  const sellsToInHouseTeams = /in-house|internal team|your team|revops|sales team/.test(blob);
  const targetsSmb = /smb|startup|small team|founder|early[- ]stage/.test(blob);
  const sellsRecruiting = /recruit|talent|ats|hiring/.test(blob);

  if (sellsSoftware) {
    // A software seller's structural non-buyers.
    out.industries.push("non-software services", "local services", "manufacturing");
    out.company_types.push("agencies", "consultancies");
    out.keywords.push("staffing agency", "recruiting agency");
  }
  if (sellsSoftware && !sellsRecruiting) {
    // Only exclude recruiting when recruiting is NOT what we sell.
    out.industries.push("staffing and recruiting");
  }
  if (sellsToInHouseTeams) out.company_types.push("outsourced service providers");
  if (targetsSmb) out.company_types.push("enterprise-only organisations");
  if (/marketplace/.test(blob)) out.company_types.push("marketplaces");

  // Titles that never buy software regardless of category.
  out.titles.push("Plant Manager", "Facilities Manager", "Warehouse Manager");

  // Generic non-buyer categories, appended so we always reach a useful floor.
  const FLOOR = ["government", "education", "non-profit", "generic consultants", "franchises"];
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
