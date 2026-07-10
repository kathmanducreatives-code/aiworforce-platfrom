// Deno-friendly mirror of src/lib/normalizeCompanyBrain.ts.
// Keep in sync — this is imported by edge functions (radar, content, outreach).

export type BrainConfidence = "weak" | "partial" | "strong";
export type SetupStatus = "incomplete" | "in_progress" | "complete";

export interface CompanySizeRange { min: number | null; max: number | null; label: string; }
export interface DisqualifierBuckets {
  industries: string[]; company_types: string[]; domains: string[]; keywords: string[]; titles: string[];
}
export interface TargetCustomer {
  industries: string[]; business_models: string[]; company_size: CompanySizeRange;
  funding_stage: string[]; geography: string[]; must_have: string[]; nice_to_have: string[];
  disqualifiers: DisqualifierBuckets;
}
export interface QualificationRules { required_evidence: string[]; reject_if: string[]; manual_review_if: string[]; }
export interface PositioningV2 {
  promise: string; differentiators: string[]; use_cases: string[]; proof_points: string[];
  offer: string; pricing: string; avoid_positioning: string[];
}
export interface BrandVoiceV2 { tone: string; tags: string[]; style_rules: string[]; avoid: string[]; example_message: string; }

// ---- Onboarding v3 additions (additive; older consumers ignore these) ----
export interface FounderV2 {
  name: string; role: string; background: string;
  gtm_relevance: string[]; credibility_signals: string[]; linkedin_url: string;
}
export interface BrainEvidence {
  source_pages: string[]; linkedin_sources: string[]; confidence_notes: string[];
}

export interface CompanyBrainV2 {
  schema_version: 2;
  setup_status: SetupStatus;
  brain_confidence: BrainConfidence;
  setup_required: boolean;
  /** true while an AI draft is under review and has not been activated yet. */
  is_draft: boolean;
  founder: FounderV2;
  evidence: BrainEvidence;
  /** Required slots the Brain still cannot satisfy (recomputed on save). */
  missing_fields: string[];
  company: {
    name: string; website_url: string; description: string; category: string;
    business_model: string; stage: string; team_size: string; location: string;
  };
  target_customer: TargetCustomer;
  buyer_personas: string[];
  triggers: string[];
  jobs_to_watch: string[];
  competitors: string[];
  tools: string[];
  pain_points: string[];
  positive_examples: string[];
  negative_examples: string[];
  content_angles: string[];
  positioning: PositioningV2;
  brand_voice: BrandVoiceV2;
  qualification_rules: QualificationRules;
  legacy: Record<string, unknown>;
}

function asString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  try { return String(v).trim(); } catch { return ""; }
}
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim())).filter(Boolean);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    if (/[,;\n]/.test(s)) return s.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
    return [s];
  }
  return [];
}
function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function normalizePositioning(v: unknown): PositioningV2 {
  const empty: PositioningV2 = { promise: "", differentiators: [], use_cases: [], proof_points: [], offer: "", pricing: "", avoid_positioning: [] };
  if (typeof v === "string") return { ...empty, promise: v.trim() };
  const o = asObject(v);
  return {
    promise: asString(o.promise), differentiators: asStringArray(o.differentiators),
    use_cases: asStringArray(o.use_cases), proof_points: asStringArray(o.proof_points),
    offer: asString(o.offer), pricing: asString(o.pricing), avoid_positioning: asStringArray(o.avoid_positioning),
  };
}
function normalizeBrandVoice(v: unknown): BrandVoiceV2 {
  const empty: BrandVoiceV2 = { tone: "", tags: [], style_rules: [], avoid: [], example_message: "" };
  if (typeof v === "string") return { ...empty, tone: v.trim() };
  const o = asObject(v);
  return {
    tone: asString(o.tone), tags: asStringArray(o.tags), style_rules: asStringArray(o.style_rules),
    avoid: asStringArray(o.avoid), example_message: asString(o.example_message),
  };
}
// The legacy structured brain already stored `founder: { name, role, linkedin_url }`,
// so v2 reads the same slot and simply adds the research-derived fields.
function normalizeFounder(v: unknown): FounderV2 {
  const o = asObject(v);
  return {
    name: asString(o.name),
    role: asString(o.role),
    background: asString(o.background),
    gtm_relevance: asStringArray(o.gtm_relevance),
    credibility_signals: asStringArray(o.credibility_signals),
    linkedin_url: asString(o.linkedin_url),
  };
}

function normalizeEvidence(v: unknown): BrainEvidence {
  const o = asObject(v);
  return {
    source_pages: asStringArray(o.source_pages),
    linkedin_sources: asStringArray(o.linkedin_sources),
    confidence_notes: asStringArray(o.confidence_notes),
  };
}

function normalizeDisqualifiers(v: unknown, legacyIcpDisq: unknown): DisqualifierBuckets {
  const o = asObject(v);
  const industries = asStringArray(o.industries);
  const company_types = asStringArray(o.company_types);
  const domains = asStringArray(o.domains);
  const keywords = asStringArray(o.keywords);
  const titles = asStringArray(o.titles);
  if (industries.length === 0 && legacyIcpDisq != null) {
    const legacy = asStringArray(legacyIcpDisq);
    return { industries: legacy, company_types, domains, keywords, titles };
  }
  return { industries, company_types, domains, keywords, titles };
}
function parseSizeLabel(label: string): { min: number | null; max: number | null } {
  const s = label.trim();
  if (!s) return { min: null, max: null };
  const range = s.match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (range) return { min: parseInt(range[1], 10), max: parseInt(range[2], 10) };
  const plus = s.match(/(\d+)\s*\+/);
  if (plus) return { min: parseInt(plus[1], 10), max: null };
  const solo = s.match(/(\d+)/);
  if (solo) return { min: parseInt(solo[1], 10), max: parseInt(solo[1], 10) };
  return { min: null, max: null };
}
function normalizeTargetCustomer(v2: unknown, legacyIcp: unknown, legacyCompany: unknown): TargetCustomer {
  const t = asObject(v2);
  const icp = asObject(legacyIcp);
  const co = asObject(legacyCompany);
  const industries = asStringArray(t.industries).length ? asStringArray(t.industries) : asStringArray(icp.industries);
  const business_models = asStringArray(t.business_models);
  const funding_stage = asStringArray(t.funding_stage);
  const geography = asStringArray(t.geography).length ? asStringArray(t.geography) : [asString(icp.geography)].filter(Boolean);
  const must_have = asStringArray(t.must_have);
  const nice_to_have = asStringArray(t.nice_to_have);
  const sizeObj = asObject(t.company_size);
  const sizeLabel = asString(sizeObj.label) || asString(icp.company_size) || asString(co.team_size);
  const parsed = parseSizeLabel(sizeLabel);
  const min = typeof sizeObj.min === "number" ? sizeObj.min : parsed.min;
  const max = typeof sizeObj.max === "number" ? sizeObj.max : parsed.max;
  return {
    industries, business_models, company_size: { min, max, label: sizeLabel },
    funding_stage, geography, must_have, nice_to_have,
    disqualifiers: normalizeDisqualifiers(t.disqualifiers, icp.disqualifiers),
  };
}

const DEFAULT_THRESHOLDS = { partial: 3, strong: 6 };

function scoreConfidence(v2: CompanyBrainV2, thresholds = DEFAULT_THRESHOLDS) {
  const tc = v2.target_customer;
  let filled = 0;
  if (tc.industries.length) filled++;
  if (tc.business_models.length) filled++;
  if (tc.company_size.min || tc.company_size.max || tc.company_size.label) filled++;
  if (tc.geography.length) filled++;
  if (tc.must_have.length) filled++;
  if (v2.buyer_personas.length) filled++;
  if (v2.triggers.length || v2.jobs_to_watch.length) filled++;
  if (v2.pain_points.length) filled++;
  if (v2.positive_examples.length) filled++;
  const hasIndustries = tc.industries.length > 0;
  const hasBuyers = v2.buyer_personas.length > 0;
  const hasMustHave = tc.must_have.length > 0;
  const setup_required = !((hasIndustries && hasBuyers) || hasMustHave);
  let confidence: BrainConfidence = "weak";
  if (filled >= thresholds.strong) confidence = "strong";
  else if (filled >= thresholds.partial) confidence = "partial";
  return { confidence, setup_required };
}

export function normalizeCompanyBrain(profile: Record<string, unknown> | null | undefined): CompanyBrainV2 {
  const raw = profile && typeof profile === "object" ? { ...profile } : {};
  const isV2 = (raw.schema_version as unknown) === 2;

  const co = asObject(raw.company);
  const positioning = normalizePositioning(raw.positioning);
  const brand_voice = normalizeBrandVoice(raw.brand_voice);
  const target_customer = normalizeTargetCustomer(raw.target_customer, raw.icp, raw.company);
  const legacyIcpObj = asObject(raw.icp);
  const legacyGtm = asObject(raw.gtm);
  const legacyGoals = asObject(raw.goals);
  const legacyCompetitors = asObject(raw.competitors);

  const buyer_personas = asStringArray(raw.buyer_personas).length
    ? asStringArray(raw.buyer_personas)
    : asStringArray(legacyIcpObj.buyer_roles);

  const competitorsList = (() => {
    const v2Comps = raw.competitors_v2 ?? (isV2 ? raw.competitors : undefined);
    const v2list = asStringArray(v2Comps);
    if (v2list.length) return v2list;
    return asStringArray(legacyCompetitors.known);
  })();

  const tools = asStringArray(raw.tools).length ? asStringArray(raw.tools) : asStringArray(legacyGtm.current_tools);
  const pain_points = asStringArray(raw.pain_points).length ? asStringArray(raw.pain_points) : asStringArray(legacyIcpObj.pain_points);
  const triggers = asStringArray(raw.triggers);
  const jobs_to_watch = asStringArray(raw.jobs_to_watch).length
    ? asStringArray(raw.jobs_to_watch)
    : [asString(legacyGoals.hiring)].filter(Boolean);
  const positive_examples = asStringArray(raw.positive_examples);
  const negative_examples = asStringArray(raw.negative_examples);
  const content_angles = asStringArray(raw.content_angles).length
    ? asStringArray(raw.content_angles)
    : [asString(legacyGoals.content)].filter(Boolean);
  const qual = asObject(raw.qualification_rules);

  const partial: CompanyBrainV2 = {
    schema_version: 2,
    setup_status: "incomplete",
    brain_confidence: "weak",
    setup_required: true,
    is_draft: raw.is_draft === true,
    founder: normalizeFounder(raw.founder),
    evidence: normalizeEvidence(raw.evidence),
    missing_fields: asStringArray(raw.missing_fields),
    company: {
      name: asString(co.name), website_url: asString(co.website_url), description: asString(co.description),
      category: asString(co.category), business_model: asString(co.business_model) || asString(legacyGtm.motion),
      stage: asString(co.stage), team_size: asString(co.team_size), location: asString(co.location),
    },
    target_customer,
    buyer_personas, triggers, jobs_to_watch, competitors: competitorsList,
    tools, pain_points, positive_examples, negative_examples, content_angles,
    positioning, brand_voice,
    qualification_rules: {
      required_evidence: asStringArray(qual.required_evidence),
      reject_if: asStringArray(qual.reject_if),
      manual_review_if: asStringArray(qual.manual_review_if),
    },
    legacy: raw,
  };

  const { confidence, setup_required } = scoreConfidence(partial);
  partial.brain_confidence = confidence;
  partial.setup_required = setup_required;

  const explicitStatus = asString(raw.setup_status) as SetupStatus | "";
  if (explicitStatus === "incomplete" || explicitStatus === "in_progress" || explicitStatus === "complete") {
    partial.setup_status = explicitStatus;
  } else if (raw.onboarding_completed === true) {
    partial.setup_status = "complete";
  } else if (!setup_required) {
    partial.setup_status = "in_progress";
  }

  return partial;
}

export function emptyCompanyBrainV2(): CompanyBrainV2 { return normalizeCompanyBrain({}); }
