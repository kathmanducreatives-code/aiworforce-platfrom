// AI draft of Company Brain v2 (Onboarding v3, Step 3).
//
// Turns founder + company research into a DRAFT Brain the user then edits.
// The model may INFER (ICP, triggers, disqualifiers) but may never invent
// PROOF: `evidence` is assembled from the URLs we actually read, not from the
// model's output. Any inferred field without supporting evidence is added to
// `needs_confirmation` so the review UI must ask before it becomes truth.
//
// buildDraftPrompt + mapDraftToV2 are pure → fixture-tested, no LLM in tests.

import {
  type BrainDraft, type BuyerPersona, type CompanyLinkedInResearch, type CompanyWebsiteResearch,
  type CompanyInput, type FounderInput, type FounderResearch, type ResearchDeps,
  asString, asStringArray, uniq,
} from "./types.ts";
import {
  toCleanArray, cleanPersona, suggestBuyerPersonas, suggestDisqualifiers,
  suggestQualificationRules, stripUnsupportedClaims, countDisqualifiers, draftConfidenceCeiling,
} from "./draftQuality.ts";

export interface DraftInput {
  founder_input: Partial<FounderInput>;
  founder_research?: FounderResearch | null;
  company_input: Partial<CompanyInput>;
  company_research?: CompanyWebsiteResearch | null;
  company_linkedin?: CompanyLinkedInResearch | null;
  existing_company_brain?: Record<string, unknown> | null;
}

const SYSTEM_PROMPT = [
  "You are a senior B2B GTM strategist building a Company Brain. You are skeptical,",
  "specific, and you separate what you KNOW from what you BELIEVE.",
  "",
  "You are given a COMPANY UNDERSTANDING pass that was extracted from classified",
  "web pages, plus the founder's own words. Treat it as your evidence base.",
  "",
  "Hard rules:",
  "1. NEVER invent proof. Do not state traction, metrics, named customers, funding,",
  "   integrations, or competitors as facts. If a source did not say it, leave it out.",
  "2. Facts, inferences and user input are different things. Every field you INFERRED",
  "   must appear in `needs_confirmation`. Every field the evidence cannot support",
  "   must appear in `missing_fields`.",
  "3. Prefer the user's own description when the website is noisy, ambiguous, or when",
  "   a blog post / case study contradicts the homepage and product pages.",
  "4. Do not overfit to one page. A single article about a topic does NOT make that",
  "   topic the company's product category. Categories need repeated support.",
  "5. Do not produce broad, generic targeting ('all SaaS companies', 'any business').",
  "   A vague ICP is worse than an empty one. If evidence is thin, return empty arrays.",
  "6. Disqualifiers and bad-fit examples are first-class. Think hard about who should",
  "   NEVER be targeted, and why. Derive them from THIS company's product, not clichés.",
  "7. Buyer personas must be concrete: title, role keywords, department, seniority,",
  "   pains, what they care about, their likely objection, and an outreach angle.",
  "8. Qualification rules must state what evidence is REQUIRED before trusting a lead,",
  "   what causes an immediate REJECT, and what needs MANUAL REVIEW.",
  "9. Confidence discipline: 'high' requires multiple strong source pages agreeing.",
  "   One homepage, or mostly inference, is 'low'. Never claim high confidence on a",
  "   category or ICP you predicted rather than read.",
  "10. Never output contact details, emails or phone numbers.",
  "11. Return ONLY valid JSON matching the requested shape.",
].join("\n");

/** Build the (system, user) prompt from research. Pure — no network. */
export function buildDraftPrompt(input: DraftInput): { system: string; user: string } {
  const understanding = input.company_research?.understanding ?? null;

  const payload = {
    // The understanding pass leads: it is the cleanest statement of what the
    // company is, with each fact traced to a classified page.
    company_understanding: understanding,
    user_provided: {
      founder: redact(input.founder_input),
      company: input.company_input,
      // Called out explicitly so the model prefers it over a noisy scrape.
      company_description: asString(input.company_input?.description),
    },
    founder_research: input.founder_research ?? null,
    company_linkedin: input.company_linkedin ?? null,
    existing_company_brain: input.existing_company_brain ?? null,
  };

  const guidance = understanding?.ambiguous
    ? [
      "",
      "WARNING: the website read is AMBIGUOUS (conflicting or thin signals).",
      "Trust the user's company description over the scraped pages. Mark the",
      "product category and ICP as needing confirmation. Do not claim high confidence.",
    ].join("\n")
    : "";

  const user = [
    "RESEARCH EVIDENCE:",
    JSON.stringify(payload, null, 2),
    guidance,
    "",
    "Draft the Company Brain as a strategic hypothesis. Return ONLY this JSON shape:",
    JSON.stringify({
      company: { name: "", website_url: "", description: "", category: "", business_model: "", stage: "", team_size: "", location: "" },
      founder: { name: "", role: "", background: "", gtm_relevance: [] },
      target_customer: {
        industries: [], business_models: [], company_size: { min: null, max: null, label: "" },
        funding_stage: [], geography: [], must_have: [], nice_to_have: [],
        disqualifiers: { industries: [], company_types: [], domains: [], keywords: [], titles: [] },
      },
      buyer_personas: ["short titles, e.g. 'Founder / CEO'"],
      buyer_persona_profiles: [{
        title: "", role_keywords: [], department: "", seniority: "",
        pains: [], cares_about: [], likely_objection: "", outreach_angle: "", confidence: "low",
      }],
      triggers: [], jobs_to_watch: [], competitors: [], tools: [],
      pain_points: [], positive_examples: [], negative_examples: [], content_angles: [],
      qualification_rules: { required_evidence: [], reject_if: [], manual_review_if: [] },
      brand_voice: { tone: "", tags: [], style_rules: [], avoid: [], example_message: "" },
      positioning: { promise: "", differentiators: [], use_cases: [], proof_points: [], offer: "", pricing: "", avoid_positioning: [] },
      needs_confirmation: ["every field you INFERRED rather than read"],
      missing_fields: ["every field the evidence could not support"],
    }, null, 2),
  ].join("\n");

  return { system: SYSTEM_PROMPT, user };
}

/** Never send the founder's consent flag / contact-shaped values to the model. */
function redact(f: Partial<FounderInput>): Record<string, unknown> {
  return { name: f.name ?? "", role: f.role ?? "", first_help_goal: f.first_help_goal ?? "" };
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Map the model's JSON onto a BrainDraft. Evidence is rebuilt from the REAL
 * research sources (not the model), and any array the model filled without a
 * single evidence source is flagged for confirmation.
 */
export function mapDraftToV2(aiJson: unknown, input: DraftInput): BrainDraft {
  const ai = obj(aiJson);
  const web = input.company_research ?? null;
  const li = input.company_linkedin ?? null;
  const founder = input.founder_research ?? null;

  // ---- evidence comes ONLY from sources we actually fetched ----
  const source_pages = uniq(web?.source_pages ?? []);
  const linkedin_sources = uniq([founder?.source_url ?? "", li?.linkedin_url ?? ""].filter(Boolean));
  const hasEvidence = source_pages.length > 0 || linkedin_sources.length > 0;

  const confidence_notes: string[] = [];
  if (web) confidence_notes.push(`Website research confidence: ${web.confidence} (${source_pages.length} pages read).`);
  if (li) confidence_notes.push(`Company LinkedIn confidence: ${li.confidence}.`);
  if (founder) confidence_notes.push(`Founder LinkedIn confidence: ${founder.confidence}.`);
  if (!hasEvidence) confidence_notes.push("No research evidence — every field is user-supplied or inferred.");

  // ---- company: prefer user input, then read facts, then model ----
  const aiCompany = obj(ai.company);
  const company = {
    name: firstStr(input.company_input?.name, web?.company_name, aiCompany.name),
    website_url: firstStr(input.company_input?.website_url, web?.website, aiCompany.website_url),
    description: firstStr(input.company_input?.description, web?.description, li?.company_description, aiCompany.description),
    category: firstStr(aiCompany.category, li?.industry),
    business_model: firstStr(web?.business_model, aiCompany.business_model),
    stage: firstStr(input.company_input?.stage, aiCompany.stage),
    team_size: firstStr(input.company_input?.team_size, li?.employee_count, aiCompany.team_size),
    location: firstStr(li?.locations?.[0], aiCompany.location),
  };

  const aiFounder = obj(ai.founder);
  const founderOut = {
    name: firstStr(input.founder_input?.name, founder?.name, aiFounder.name),
    role: firstStr(input.founder_input?.role, founder?.current_role, aiFounder.role),
    background: firstStr(founder?.headline, founder?.summary, aiFounder.background),
    gtm_relevance: uniq([...(founder?.gtm_relevance ?? []), ...asStringArray(aiFounder.gtm_relevance)]),
    credibility_signals: founder?.credibility_signals ?? [],
    linkedin_url: founder?.source_url ?? "",
  };

  // ---- targeting: model inference, but never broad defaults ----
  const aiTc = obj(ai.target_customer);
  const aiDisq = obj(aiTc.disqualifiers);
  const target_customer = {
    industries: asStringArray(aiTc.industries),
    business_models: asStringArray(aiTc.business_models),
    company_size: obj(aiTc.company_size),
    funding_stage: asStringArray(aiTc.funding_stage),
    geography: asStringArray(aiTc.geography),
    must_have: asStringArray(aiTc.must_have),
    nice_to_have: asStringArray(aiTc.nice_to_have),
    disqualifiers: {
      industries: asStringArray(aiDisq.industries),
      company_types: asStringArray(aiDisq.company_types),
      domains: asStringArray(aiDisq.domains),
      keywords: asStringArray(aiDisq.keywords),
      titles: asStringArray(aiDisq.titles),
    },
  };

  // ---- sanitize every model array (glued chips, dupes, empties) ----
  const triggers = toCleanArray(ai.triggers);
  const jobs_to_watch = toCleanArray(ai.jobs_to_watch);
  const tools = toCleanArray(ai.tools);
  const pain_points = toCleanArray(ai.pain_points);
  const negative_examples = toCleanArray(ai.negative_examples);
  const content_angles = toCleanArray(ai.content_angles);

  // ---- confidence ceiling: what the evidence can actually support ----
  const understanding = web?.understanding ?? null;
  const ceiling = draftConfidenceCeiling(understanding);

  // ---- strip claims no source supports (funding is never scrapable) ----
  const aiPositioning = obj(ai.positioning);
  const guard = stripUnsupportedClaims({
    proof_points: toCleanArray(aiPositioning.proof_points),
    positive_examples: toCleanArray(ai.positive_examples),
    integrations: toCleanArray(ai.integrations ?? tools),
    competitors: toCleanArray(ai.competitors),
    sourceProof: understanding?.proof_points ?? [],
    sourceIntegrations: understanding?.integrations ?? [],
    hasSourcePages: source_pages.length > 0,
  });
  const positive_examples = guard.positive_examples;
  const competitors = guard.competitors;

  // ---- buyer personas: mandatory when we understand the product ----
  let persona_profiles = toArray(ai.buyer_persona_profiles)
    .map((p) => cleanPersona(p, ceiling))
    .filter((p): p is BuyerPersona => !!p);

  const personaCtx = {
    product_category: company.category || (understanding?.product_category ?? ""),
    one_line_summary: company.description,
    primary_users: understanding?.primary_users ?? [],
    key_features: understanding?.key_features ?? [],
    user_description: asString(input.company_input?.description),
  };
  const hasCompanyContext = !!(personaCtx.product_category || personaCtx.one_line_summary);
  if (persona_profiles.length < 3 && hasCompanyContext) {
    const suggested = suggestBuyerPersonas(personaCtx, ceiling);
    for (const s of suggested) {
      if (persona_profiles.length >= 3) break;
      if (!persona_profiles.some((p) => p.title.toLowerCase() === s.title.toLowerCase())) persona_profiles.push(s);
    }
  }
  persona_profiles = persona_profiles.slice(0, 5);

  const buyer_personas = uniq([
    ...toCleanArray(ai.buyer_personas),
    ...persona_profiles.map((p) => p.title),
  ]);

  // ---- disqualifiers: mandatory when we know who we target ----
  const disq = target_customer.disqualifiers;
  const hasTarget = target_customer.industries.length > 0 || target_customer.business_models.length > 0;
  if (countDisqualifiers(disq) < 5 && hasTarget) {
    const s = suggestDisqualifiers({
      product_category: personaCtx.product_category,
      business_model: company.business_model,
      target_industries: target_customer.industries,
      primary_users: personaCtx.primary_users,
      user_description: personaCtx.user_description,
    });
    disq.industries = uniq([...disq.industries, ...s.industries]);
    disq.company_types = uniq([...disq.company_types, ...s.company_types]);
    disq.keywords = uniq([...disq.keywords, ...s.keywords]);
    disq.titles = uniq([...disq.titles, ...s.titles]);
    disq.domains = uniq([...disq.domains, ...s.domains]);
  }

  // ---- qualification rules: always complete ----
  const aiRules = obj(ai.qualification_rules);
  const suggestedRules = suggestQualificationRules({
    hasIndustries: target_customer.industries.length > 0,
    hasTriggers: triggers.length > 0 || jobs_to_watch.length > 0,
  });
  const qualification_rules = {
    required_evidence: uniq([...toCleanArray(aiRules.required_evidence), ...suggestedRules.required_evidence]),
    reject_if: uniq([...toCleanArray(aiRules.reject_if), ...suggestedRules.reject_if]),
    manual_review_if: uniq([...toCleanArray(aiRules.manual_review_if), ...suggestedRules.manual_review_if]),
  };

  // ---- inferred-without-evidence must be confirmed by a human ----
  const needs_confirmation = uniq([
    ...toCleanArray(ai.needs_confirmation),
    ...guard.needs_confirmation,
    ...(persona_profiles.length ? ["buyer_personas"] : []),
    ...(countDisqualifiers(disq) ? ["target_customer.disqualifiers"] : []),
    ...(!hasEvidence && target_customer.industries.length ? ["target_customer.industries"] : []),
    ...(understanding?.ambiguous ? ["company.category:ambiguous_website"] : []),
    ...(understanding?.needs_confirmation ?? []),
    // Proof points are a claim about the world — never trust them without a page.
    ...(source_pages.length === 0 && guard.proof_points.length ? ["positioning.proof_points"] : []),
  ]);

  const missing_fields = uniq([
    ...toCleanArray(ai.missing_fields),
    ...(web?.missing_evidence ?? []),
    ...(li?.missing_evidence ?? []),
    ...(founder?.missing_evidence ?? []),
  ]);

  // ---- confidence: a thin read can never present as certainty ----
  // "strong" needs a HIGH-confidence, unambiguous website read AND a real ICP.
  let brain_confidence: BrainDraft["brain_confidence"] = "weak";
  if (hasEvidence) {
    const strongRead = ceiling === "high" && !understanding?.ambiguous;
    brain_confidence = (strongRead && buyer_personas.length > 0 && target_customer.industries.length > 0)
      ? "strong"
      : "partial";
  }

  // Positioning keeps only the proof the repair pass could actually source.
  const positioning = { ...obj(ai.positioning), proof_points: guard.proof_points };

  return {
    schema_version: 2,
    setup_status: "in_progress",
    is_draft: true,
    brain_confidence,
    company,
    founder: founderOut,
    target_customer,
    buyer_personas,
    buyer_persona_profiles: persona_profiles,
    triggers, jobs_to_watch, competitors, tools,
    pain_points, positive_examples, negative_examples, content_angles,
    qualification_rules,
    brand_voice: obj(ai.brand_voice),
    positioning,
    evidence: { source_pages, linkedin_sources, confidence_notes },
    missing_fields,
    needs_confirmation,
    source_evidence: understanding?.evidence ?? [],
    dropped_claims: guard.dropped,
  };
}

function firstStr(...vs: unknown[]): string {
  for (const v of vs) { const s = asString(v); if (s) return s; }
  return "";
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export interface DraftResult {
  ok: boolean;
  draft: BrainDraft | null;
  error?: string;
}

/** Generate the draft Brain. No LLM call happens without `deps.generateJson`. */
export async function generateBrainDraft(input: DraftInput, deps: ResearchDeps): Promise<DraftResult> {
  if (!deps.generateJson) return { ok: false, draft: null, error: "llm_not_configured" };
  const { system, user } = buildDraftPrompt(input);
  try {
    const res = await deps.generateJson({ system, user });
    if (!res.ok) return { ok: false, draft: null, error: res.error ?? "llm_failed" };
    return { ok: true, draft: mapDraftToV2(res.json, input) };
  } catch (e) {
    return { ok: false, draft: null, error: e instanceof Error ? e.message : String(e) };
  }
}
