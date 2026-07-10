// Company Brain completeness + missing-field accounting (Onboarding v3).
//
// One place that decides "is this Brain good enough to activate?". Used by the
// activate path (server) and the review UI (mirrored in src/lib). Pure.
//
// A Brain is only `complete` when every REQUIRED slot is filled. Anything less
// stays `incomplete` and onboarding_completed stays false — we never mark a
// half-built Brain as ready, because Radar/Leads/Content trust this flag.

import type { CompanyBrainV2 } from "./normalizeCompanyBrain.ts";

export interface BrainRequirement {
  key: string;
  label: string;
  /** Where the user fixes it — drives the "what needs your confirmation" panel. */
  step: "company" | "customers" | "buyers" | "triggers" | "disqualifiers" | "content";
  satisfied: (b: CompanyBrainV2) => boolean;
}

const nonEmpty = (xs: unknown[]): boolean => Array.isArray(xs) && xs.length > 0;
const str = (s: unknown): boolean => typeof s === "string" && s.trim().length > 0;

/** The minimum a Brain needs before it can power Leads / Radar / Content. */
export const BRAIN_REQUIREMENTS: BrainRequirement[] = [
  { key: "company.name", label: "Company name", step: "company", satisfied: (b) => str(b.company?.name) },
  {
    key: "company.identity", label: "Website or description", step: "company",
    satisfied: (b) => str(b.company?.website_url) || str(b.company?.description),
  },
  { key: "company.business_model", label: "Business model", step: "company", satisfied: (b) => str(b.company?.business_model) },
  {
    key: "target_customer.market", label: "Target industries or business models", step: "customers",
    satisfied: (b) => nonEmpty(b.target_customer?.industries) || nonEmpty(b.target_customer?.business_models),
  },
  { key: "buyer_personas", label: "At least one buyer persona", step: "buyers", satisfied: (b) => nonEmpty(b.buyer_personas) },
  {
    key: "triggers", label: "At least one trigger or job to watch", step: "triggers",
    satisfied: (b) => nonEmpty(b.triggers) || nonEmpty(b.jobs_to_watch),
  },
  {
    key: "disqualifiers", label: "At least one disqualifier", step: "disqualifiers",
    satisfied: (b) => {
      const d = b.target_customer?.disqualifiers;
      if (!d) return false;
      return nonEmpty(d.industries) || nonEmpty(d.company_types) || nonEmpty(d.keywords) || nonEmpty(d.titles) || nonEmpty(d.domains);
    },
  },
  {
    key: "voice", label: "At least one pain point or content angle", step: "content",
    satisfied: (b) => nonEmpty(b.pain_points) || nonEmpty(b.content_angles),
  },
];

/** Optional slots — they raise confidence but never gate activation. */
export const BRAIN_BONUS: BrainRequirement[] = [
  { key: "competitors", label: "Competitors", step: "company", satisfied: (b) => nonEmpty(b.competitors) },
  { key: "positive_examples", label: "Good-fit examples", step: "customers", satisfied: (b) => nonEmpty(b.positive_examples) },
  { key: "negative_examples", label: "Bad-fit examples", step: "disqualifiers", satisfied: (b) => nonEmpty(b.negative_examples) },
  { key: "positioning.promise", label: "Positioning promise", step: "content", satisfied: (b) => str(b.positioning?.promise) },
  { key: "qualification_rules", label: "Qualification rules", step: "triggers", satisfied: (b) => nonEmpty(b.qualification_rules?.required_evidence) },
];

export type BrainConfidence = "weak" | "partial" | "strong";

export interface CompletenessResult {
  /** 0..100 across required + bonus slots. */
  percent: number;
  /** true only when EVERY required slot is filled. */
  complete: boolean;
  /** Required slots still empty (labels). */
  missing: string[];
  /** Required slot keys still empty (stable ids for the UI). */
  missing_keys: string[];
  /** Missing keys grouped by the review card that fixes them. */
  missing_by_step: Record<string, string[]>;
  required_met: number;
  required_total: number;
  bonus_met: number;
  bonus_total: number;
  confidence: BrainConfidence;
}

/** Score a normalized Brain against the activation requirements. Pure. */
export function computeCompanyBrainCompleteness(brain: CompanyBrainV2): CompletenessResult {
  const requiredMet = BRAIN_REQUIREMENTS.filter((r) => safe(r, brain));
  const bonusMet = BRAIN_BONUS.filter((r) => safe(r, brain));
  const missingReqs = BRAIN_REQUIREMENTS.filter((r) => !safe(r, brain));

  const required_total = BRAIN_REQUIREMENTS.length;
  const bonus_total = BRAIN_BONUS.length;
  const complete = missingReqs.length === 0;

  // Required slots carry 80% of the score; bonus slots the remaining 20%.
  const percent = Math.round(
    (requiredMet.length / required_total) * 80 + (bonusMet.length / bonus_total) * 20,
  );

  const missing_by_step: Record<string, string[]> = {};
  for (const r of missingReqs) (missing_by_step[r.step] ??= []).push(r.key);

  let confidence: BrainConfidence = "weak";
  if (complete && bonusMet.length >= 3) confidence = "strong";
  else if (requiredMet.length >= Math.ceil(required_total * 0.6)) confidence = "partial";

  return {
    percent,
    complete,
    missing: missingReqs.map((r) => r.label),
    missing_keys: missingReqs.map((r) => r.key),
    missing_by_step,
    required_met: requiredMet.length,
    required_total,
    bonus_met: bonusMet.length,
    bonus_total,
    confidence,
  };
}

// A malformed profile must never throw during activation.
function safe(r: BrainRequirement, b: CompanyBrainV2): boolean {
  try { return r.satisfied(b); } catch { return false; }
}

/** Just the missing required-field labels. */
export function getMissingCompanyBrainFields(brain: CompanyBrainV2): string[] {
  return computeCompanyBrainCompleteness(brain).missing;
}

/** Can this Brain be activated (onboarding_completed = true)? */
export function canActivateBrain(brain: CompanyBrainV2): boolean {
  return computeCompanyBrainCompleteness(brain).complete;
}
