// Company Brain v2 normalizer.
//
// Pure, deterministic. Accepts any legacy or v2 `company_brain.profile` shape
// and returns a safe CompanyBrainV2 object. Never invents targeting: empty in
// → empty out. Coerces corrupted string positioning/brand_voice, keeps arrays
// as arrays, and projects legacy `icp.*` fields into v2 `target_customer.*`
// only when v2 slots are empty. Legacy top-level keys are preserved on the
// original profile object; consumers can still read them if needed.

export type BrainConfidence = "weak" | "partial" | "strong";
export type SetupStatus = "incomplete" | "in_progress" | "complete";

export interface CompanySizeRange {
  min: number | null;
  max: number | null;
  label: string;
}

export interface DisqualifierBuckets {
  industries: string[];
  company_types: string[];
  domains: string[];
  keywords: string[];
  titles: string[];
}

export interface TargetCustomer {
  industries: string[];
  business_models: string[];
  company_size: CompanySizeRange;
  funding_stage: string[];
  geography: string[];
  must_have: string[];
  nice_to_have: string[];
  disqualifiers: DisqualifierBuckets;
}

export interface QualificationRules {
  required_evidence: string[];
  reject_if: string[];
  manual_review_if: string[];
}

export interface PositioningV2 {
  promise: string;
  differentiators: string[];
  use_cases: string[];
  proof_points: string[];
  offer: string;
  pricing: string;
  avoid_positioning: string[];
}

export interface BrandVoiceV2 {
  tone: string;
  tags: string[];
  style_rules: string[];
  avoid: string[];
  example_message: string;
}

export interface CompanyBrainV2 {
  schema_version: 2;
  setup_status: SetupStatus;
  brain_confidence: BrainConfidence;
  setup_required: boolean;

  company: {
    name: string;
    website_url: string;
    description: string;
    category: string;
    business_model: string;
    stage: string;
    team_size: string;
    location: string;
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

  /** Original legacy top-level keys, preserved untouched for backward compat. */
  legacy: Record<string, unknown>;
}

function asString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  try { return String(v).trim(); } catch { return ""; }
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim())).filter(Boolean);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    // Only split obvious delimiter strings; single sentences stay one element.
    if (/[,;\n]/.test(s)) return s.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
    return [s];
  }
  return [];
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function normalizePositioning(v: unknown): PositioningV2 {
  const empty: PositioningV2 = {
    promise: "", differentiators: [], use_cases: [], proof_points: [],
    offer: "", pricing: "", avoid_positioning: [],
  };
  if (typeof v === "string") return { ...empty, promise: v.trim() };
  const o = asObject(v);
  return {
    promise: asString(o.promise),
    differentiators: asStringArray(o.differentiators),
    use_cases: asStringArray(o.use_cases),
    proof_points: asStringArray(o.proof_points),
    offer: asString(o.offer),
    pricing: asString(o.pricing),
    avoid_positioning: asStringArray(o.avoid_positioning),
  };
}

function normalizeBrandVoice(v: unknown): BrandVoiceV2 {
  const empty: BrandVoiceV2 = { tone: "", tags: [], style_rules: [], avoid: [], example_message: "" };
  if (typeof v === "string") return { ...empty, tone: v.trim() };
  const o = asObject(v);
  return {
    tone: asString(o.tone),
    tags: asStringArray(o.tags),
    style_rules: asStringArray(o.style_rules),
    avoid: asStringArray(o.avoid),
    example_message: asString(o.example_message),
  };
}

function normalizeDisqualifiers(v: unknown, legacyIcpDisq: unknown): DisqualifierBuckets {
  const o = asObject(v);
  const industries = asStringArray(o.industries);
  const company_types = asStringArray(o.company_types);
  const domains = asStringArray(o.domains);
  const keywords = asStringArray(o.keywords);
  const titles = asStringArray(o.titles);
  // Legacy: icp.disqualifiers used to be a flat string[] of industries.
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
  const geography = asStringArray(t.geography).length
    ? asStringArray(t.geography)
    : [asString(icp.geography)].filter(Boolean);
  const must_have = asStringArray(t.must_have);
  const nice_to_have = asStringArray(t.nice_to_have);

  const sizeObj = asObject(t.company_size);
  const sizeLabel = asString(sizeObj.label) || asString(icp.company_size) || asString(co.team_size);
  const parsed = parseSizeLabel(sizeLabel);
  const min = typeof sizeObj.min === "number" ? sizeObj.min : parsed.min;
  const max = typeof sizeObj.max === "number" ? sizeObj.max : parsed.max;

  return {
    industries,
    business_models,
    company_size: { min, max, label: sizeLabel },
    funding_stage,
    geography,
    must_have,
    nice_to_have,
    disqualifiers: normalizeDisqualifiers(t.disqualifiers, icp.disqualifiers),
  };
}

export interface NormalizeOptions {
  /** For tests / debugging — override the "how many slots filled" thresholds. */
  confidenceThresholds?: { partial: number; strong: number };
}

const DEFAULT_THRESHOLDS = { partial: 3, strong: 6 };

function scoreConfidence(v2: CompanyBrainV2, thresholds = DEFAULT_THRESHOLDS): { confidence: BrainConfidence; setup_required: boolean } {
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

/** Normalize any profile shape into CompanyBrainV2. Empty in → empty out. */
export function normalizeCompanyBrain(
  profile: Record<string, unknown> | null | undefined,
  opts: NormalizeOptions = {},
): CompanyBrainV2 {
  const raw = profile && typeof profile === "object" ? { ...profile } : {};
  const isV2 = (raw.schema_version as unknown) === 2;

  const legacyCompany = raw.company;
  const legacyIcp = raw.icp;
  const legacyGtm = raw.gtm;
  const legacyPositioning = raw.positioning;
  const legacyBrandVoice = raw.brand_voice;
  const legacyGoals = asObject(raw.goals);
  const legacyCompetitors = asObject(raw.competitors);

  const v2Target = raw.target_customer;
  const v2Buyers = raw.buyer_personas;
  const v2Triggers = raw.triggers;
  const v2Jobs = raw.jobs_to_watch;
  const v2Comps = raw.competitors_v2 ?? (isV2 ? raw.competitors : undefined);
  const v2Tools = raw.tools;
  const v2Pain = raw.pain_points;
  const v2Positive = raw.positive_examples;
  const v2Negative = raw.negative_examples;
  const v2Content = raw.content_angles;
  const v2Qualification = asObject(raw.qualification_rules);

  const co = asObject(legacyCompany);
  const positioning = normalizePositioning(legacyPositioning);
  const brand_voice = normalizeBrandVoice(legacyBrandVoice);
  const target_customer = normalizeTargetCustomer(v2Target, legacyIcp, legacyCompany);

  const legacyIcpObj = asObject(legacyIcp);

  // Buyer personas: v2 wins, fallback to legacy icp.buyer_roles.
  const buyer_personas = asStringArray(v2Buyers).length
    ? asStringArray(v2Buyers)
    : asStringArray(legacyIcpObj.buyer_roles);

  // Competitors: prefer v2, otherwise legacy competitors.known.
  const competitorsList = (() => {
    const v2list = asStringArray(v2Comps);
    if (v2list.length) return v2list;
    const known = asStringArray((legacyCompetitors as Record<string, unknown>).known);
    return known;
  })();

  const tools = asStringArray(v2Tools).length
    ? asStringArray(v2Tools)
    : asStringArray(asObject(legacyGtm).current_tools);

  const pain_points = asStringArray(v2Pain).length
    ? asStringArray(v2Pain)
    : asStringArray(legacyIcpObj.pain_points);

  const triggers = asStringArray(v2Triggers);
  const jobs_to_watch = asStringArray(v2Jobs).length
    ? asStringArray(v2Jobs)
    : [asString(legacyGoals.hiring)].filter(Boolean);
  const positive_examples = asStringArray(v2Positive);
  const negative_examples = asStringArray(v2Negative);
  const content_angles = asStringArray(v2Content).length
    ? asStringArray(v2Content)
    : [asString(legacyGoals.content)].filter(Boolean);

  const partial: CompanyBrainV2 = {
    schema_version: 2,
    setup_status: "incomplete",
    brain_confidence: "weak",
    setup_required: true,
    company: {
      name: asString(co.name),
      website_url: asString(co.website_url),
      description: asString(co.description),
      category: asString(co.category),
      business_model: asString(co.business_model) || asString(asObject(legacyGtm).motion),
      stage: asString(co.stage),
      team_size: asString(co.team_size),
      location: asString(co.location),
    },
    target_customer,
    buyer_personas,
    triggers,
    jobs_to_watch,
    competitors: competitorsList,
    tools,
    pain_points,
    positive_examples,
    negative_examples,
    content_angles,
    positioning,
    brand_voice,
    qualification_rules: {
      required_evidence: asStringArray(v2Qualification.required_evidence),
      reject_if: asStringArray(v2Qualification.reject_if),
      manual_review_if: asStringArray(v2Qualification.manual_review_if),
    },
    legacy: raw,
  };

  const { confidence, setup_required } = scoreConfidence(partial, opts.confidenceThresholds);
  partial.brain_confidence = confidence;
  partial.setup_required = setup_required;

  // setup_status: explicit v2 wins, otherwise derive.
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

/** Build a fresh empty v2 shell for provisioning new workspaces. */
export function emptyCompanyBrainV2(): CompanyBrainV2 {
  return normalizeCompanyBrain({});
}
