// Activation suggestions (Research System v3, Phase 6).
//
// When activation is blocked, the backend should not just say "missing buyer
// persona" — it should hand back editable, confidence-tagged suggestions the
// user can accept in one click. Every suggestion is an `ai_inference` with
// `needs_confirmation: true`; nothing here writes to the Brain by itself.
//
// Pure. No network, no providers, no DB.

import type { CompanyBrainV2 } from "../normalizeCompanyBrain.ts";
import type { CompletenessResult } from "../companyBrainCompleteness.ts";
import type { ResearchConfidence } from "./types.ts";
import {
  type PersonaContext,
  suggestBuyerPersonas, suggestDisqualifiers, suggestTargetCustomer,
  suggestTriggers, suggestVoiceAndAngles, suggestQualificationRules,
} from "./draftQuality.ts";

/** One accept-able suggestion. `origin` is always ai_inference here. */
export interface ActivationSuggestion<T> {
  value: T;
  confidence: ResearchConfidence;
  origin: "ai_inference";
  needs_confirmation: true;
}

export interface ActivationSuggestedFixes {
  suggested_buyer_personas?: Array<ActivationSuggestion<string>>;
  suggested_disqualifiers?: Array<ActivationSuggestion<string>>;
  suggested_target_customer?: ActivationSuggestion<{ industries: string[]; business_models: string[]; company_size_label: string; must_have: string[] }>;
  suggested_triggers?: Array<ActivationSuggestion<string>>;
  suggested_jobs_to_watch?: Array<ActivationSuggestion<string>>;
  suggested_content_angles?: Array<ActivationSuggestion<string>>;
  suggested_pain_points?: Array<ActivationSuggestion<string>>;
  suggested_business_model?: ActivationSuggestion<string>;
}

function wrap<T>(value: T, confidence: ResearchConfidence = "medium"): ActivationSuggestion<T> {
  return { value, confidence, origin: "ai_inference", needs_confirmation: true };
}

/** Context for the suggesters, read from what the Brain already knows. */
function ctxFromBrain(brain: CompanyBrainV2): PersonaContext {
  return {
    product_category: brain.company.category ?? "",
    one_line_summary: brain.company.description ?? "",
    primary_users: brain.buyer_personas,
    key_features: brain.positioning.use_cases,
    user_description: brain.company.description ?? "",
  };
}

/**
 * Build suggested fixes for a blocked activation. Only the missing slots get
 * suggestions; a Brain with enough context but empty slots is never left with
 * "figure it out yourself". Thin context → low confidence, still useful.
 */
export function buildActivationSuggestions(
  brain: CompanyBrainV2,
  completeness: CompletenessResult,
): ActivationSuggestedFixes {
  const missing = new Set(completeness.missing_keys);
  if (missing.size === 0) return {};

  const ctx = ctxFromBrain(brain);
  const hasContext = !!(ctx.product_category || ctx.one_line_summary);
  const confidence: ResearchConfidence = hasContext ? "medium" : "low";
  const fixes: ActivationSuggestedFixes = {};

  if (missing.has("buyer_personas")) {
    const personas = suggestBuyerPersonas(ctx, confidence);
    if (personas.length) {
      fixes.suggested_buyer_personas = personas.map((p) => wrap(p.title, p.confidence));
    }
  }

  if (missing.has("disqualifiers")) {
    const d = suggestDisqualifiers({
      product_category: ctx.product_category,
      business_model: brain.company.business_model ?? "",
      target_industries: brain.target_customer.industries,
      primary_users: ctx.primary_users,
      user_description: ctx.user_description,
    });
    const flat = [
      ...d.industries.map((v) => `industry: ${v}`),
      ...d.company_types.map((v) => `company type: ${v}`),
      ...d.keywords.map((v) => `keyword: ${v}`),
      ...d.titles.map((v) => `title: ${v}`),
    ];
    if (flat.length) fixes.suggested_disqualifiers = flat.slice(0, 8).map((v) => wrap(v, confidence));
  }

  if (missing.has("target_customer.market")) {
    const t = suggestTargetCustomer(ctx);
    if (t.industries.length || t.business_models.length) {
      fixes.suggested_target_customer = wrap(t, confidence);
    }
  }

  if (missing.has("triggers")) {
    const t = suggestTriggers(ctx);
    if (t.triggers.length) fixes.suggested_triggers = t.triggers.map((v) => wrap(v, confidence));
    if (t.jobs_to_watch.length) fixes.suggested_jobs_to_watch = t.jobs_to_watch.map((v) => wrap(v, confidence));
  }

  if (missing.has("voice")) {
    const v = suggestVoiceAndAngles(ctx);
    if (v.content_angles.length) fixes.suggested_content_angles = v.content_angles.map((a) => wrap(a, confidence));
    if (v.pain_points.length) fixes.suggested_pain_points = v.pain_points.map((p) => wrap(p, confidence));
  }

  if (missing.has("company.business_model") && hasContext) {
    const t = suggestTargetCustomer(ctx);
    const bm = t.business_models[0] ?? (/(saas|software|platform|ai)/i.test(`${ctx.product_category} ${ctx.one_line_summary}`) ? "B2B SaaS" : "");
    if (bm) fixes.suggested_business_model = wrap(bm, "low");
  }

  return fixes;
}

/** True when at least one suggestion was produced. */
export function hasSuggestions(f: ActivationSuggestedFixes): boolean {
  return Object.keys(f).length > 0;
}

// Re-exported so the edge function can offer rules alongside the fixes without
// importing draftQuality directly.
export { suggestQualificationRules };
