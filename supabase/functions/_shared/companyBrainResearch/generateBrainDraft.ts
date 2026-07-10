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
  type BrainDraft, type CompanyLinkedInResearch, type CompanyWebsiteResearch,
  type CompanyInput, type FounderInput, type FounderResearch, type ResearchDeps,
  asString, asStringArray, uniq,
} from "./types.ts";

export interface DraftInput {
  founder_input: Partial<FounderInput>;
  founder_research?: FounderResearch | null;
  company_input: Partial<CompanyInput>;
  company_research?: CompanyWebsiteResearch | null;
  company_linkedin?: CompanyLinkedInResearch | null;
  existing_company_brain?: Record<string, unknown> | null;
}

const SYSTEM_PROMPT = [
  "You draft a B2B Company Brain from RESEARCH EVIDENCE.",
  "",
  "Rules you must follow:",
  "1. NEVER invent proof. If a fact is not present in the provided research, leave the field empty.",
  "2. You MAY infer ICP, buyer personas, triggers, disqualifiers and content angles — but only",
  "   as reasonable inferences from the evidence, and list every inference in `needs_confirmation`.",
  "3. Do NOT produce broad, generic targeting (e.g. 'all SaaS companies', 'any business').",
  "   If the evidence is too thin to name an ICP, return empty arrays and say so in `missing_fields`.",
  "4. Disqualifiers and bad-fit examples are first-class: think about who should NEVER be targeted.",
  "5. Never output contact details, emails or phone numbers.",
  "6. Return ONLY valid JSON matching the requested shape.",
].join("\n");

/** Build the (system, user) prompt from research. Pure — no network. */
export function buildDraftPrompt(input: DraftInput): { system: string; user: string } {
  const payload = {
    founder_input: redact(input.founder_input),
    founder_research: input.founder_research ?? null,
    company_input: input.company_input,
    company_research: input.company_research ?? null,
    company_linkedin: input.company_linkedin ?? null,
    existing_company_brain: input.existing_company_brain ?? null,
  };

  const user = [
    "RESEARCH EVIDENCE:",
    JSON.stringify(payload, null, 2),
    "",
    "Draft the Company Brain. Return ONLY this JSON shape:",
    JSON.stringify({
      company: { name: "", website_url: "", description: "", category: "", business_model: "", stage: "", team_size: "", location: "" },
      founder: { name: "", role: "", background: "", gtm_relevance: [] },
      target_customer: {
        industries: [], business_models: [], company_size: { min: null, max: null, label: "" },
        funding_stage: [], geography: [], must_have: [], nice_to_have: [],
        disqualifiers: { industries: [], company_types: [], domains: [], keywords: [], titles: [] },
      },
      buyer_personas: [], triggers: [], jobs_to_watch: [], competitors: [], tools: [],
      pain_points: [], positive_examples: [], negative_examples: [], content_angles: [],
      qualification_rules: { required_evidence: [], reject_if: [], manual_review_if: [] },
      brand_voice: { tone: "", tags: [], style_rules: [], avoid: [], example_message: "" },
      positioning: { promise: "", differentiators: [], use_cases: [], proof_points: [], offer: "", pricing: "", avoid_positioning: [] },
      needs_confirmation: ["list every field you INFERRED rather than read"],
      missing_fields: ["list every field the evidence could not support"],
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

  const buyer_personas = asStringArray(ai.buyer_personas);
  const triggers = asStringArray(ai.triggers);
  const jobs_to_watch = asStringArray(ai.jobs_to_watch);
  const competitors = asStringArray(ai.competitors);
  const tools = asStringArray(ai.tools);
  const pain_points = asStringArray(ai.pain_points);
  const positive_examples = asStringArray(ai.positive_examples);
  const negative_examples = asStringArray(ai.negative_examples);
  const content_angles = asStringArray(ai.content_angles);

  // ---- inferred-without-evidence must be confirmed by a human ----
  const needs_confirmation = uniq([
    ...asStringArray(ai.needs_confirmation),
    ...(!hasEvidence && target_customer.industries.length ? ["target_customer.industries"] : []),
    ...(!hasEvidence && buyer_personas.length ? ["buyer_personas"] : []),
    ...(!hasEvidence && competitors.length ? ["competitors"] : []),
    // Proof points are a claim about the world — never trust them without a page.
    ...(source_pages.length === 0 && asStringArray(obj(ai.positioning).proof_points).length ? ["positioning.proof_points"] : []),
  ]);

  const missing_fields = uniq([
    ...asStringArray(ai.missing_fields),
    ...(web?.missing_evidence ?? []),
    ...(li?.missing_evidence ?? []),
    ...(founder?.missing_evidence ?? []),
  ]);

  // Draft confidence is bounded by the evidence we actually have.
  const brain_confidence: BrainDraft["brain_confidence"] = !hasEvidence
    ? "weak"
    : (web?.confidence === "high" && buyer_personas.length && target_customer.industries.length) ? "strong" : "partial";

  return {
    schema_version: 2,
    setup_status: "in_progress",
    is_draft: true,
    brain_confidence,
    company,
    founder: founderOut,
    target_customer,
    buyer_personas, triggers, jobs_to_watch, competitors, tools,
    pain_points, positive_examples, negative_examples, content_angles,
    qualification_rules: {
      required_evidence: asStringArray(obj(ai.qualification_rules).required_evidence),
      reject_if: asStringArray(obj(ai.qualification_rules).reject_if),
      manual_review_if: asStringArray(obj(ai.qualification_rules).manual_review_if),
    },
    brand_voice: obj(ai.brand_voice),
    positioning: obj(ai.positioning),
    evidence: { source_pages, linkedin_sources, confidence_notes },
    missing_fields,
    needs_confirmation,
  };
}

function firstStr(...vs: unknown[]): string {
  for (const v of vs) { const s = asString(v); if (s) return s; }
  return "";
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
