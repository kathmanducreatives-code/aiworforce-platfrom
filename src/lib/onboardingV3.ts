// Company Brain Onboarding v3 — pure flow model.
//
// All step/state/patch logic lives here (no React, no network) so the 5-step
// flow is unit-testable and the page component stays presentational.
//
// Steps: Founder → Company → AI Research → Review Brain → Activate.

import { normalizeCompanyBrain, type CompanyBrainV2 } from './normalizeCompanyBrain';
import { computeCompanyBrainCompleteness, type CompletenessResult } from './companyBrainCompleteness';

export type StepId = 'founder' | 'company' | 'research' | 'review' | 'activate';

export interface StepDef {
  id: StepId;
  label: string;
  /** One line explaining what this step powers — shown under the title. */
  powers: string;
}

export const STEPS: StepDef[] = [
  { id: 'founder',  label: 'Founder',     powers: 'Your background shapes outreach voice and credibility.' },
  { id: 'company',  label: 'Company',     powers: 'What you sell defines the ICP for Leads and Radar.' },
  { id: 'research', label: 'AI Research', powers: 'We read your site and draft a Brain from real evidence.' },
  { id: 'review',   label: 'Review Brain',powers: 'You confirm what is true before anything targets a company.' },
  { id: 'activate', label: 'Activate',    powers: 'Turns on Leads, Radar, Content, Agents and Outreach.' },
];

export const stepIndexOf = (id: StepId): number => STEPS.findIndex((s) => s.id === id);
export const stepAt = (i: number): StepDef => STEPS[Math.max(0, Math.min(STEPS.length - 1, i))];

// ------------------------------------------------------------ user input ----

export interface FounderForm {
  name: string;
  role: string;
  linkedin_url: string;
  timezone: string;
  first_help_goal: string;
  enrichment_consent: boolean;
}

export interface CompanyForm {
  name: string;
  website_url: string;
  linkedin_url: string;
  description: string;
  stage: string;
  team_size: string;
}

export const emptyFounderForm = (): FounderForm => ({
  name: '', role: '', linkedin_url: '', timezone: '', first_help_goal: '', enrichment_consent: false,
});

export const emptyCompanyForm = (): CompanyForm => ({
  name: '', website_url: '', linkedin_url: '', description: '', stage: '', team_size: '',
});

// -------------------------------------------------------------- validation --

export const isHttpUrl = (u: string): boolean => /^https?:\/\/\S+$/i.test((u ?? '').trim());

export function isLinkedInProfileUrl(url: string): boolean {
  if (!isHttpUrl(url)) return false;
  try {
    const u = new URL(url);
    return /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/in\/[^/]+/i.test(u.pathname);
  } catch { return false; }
}

export function isLinkedInCompanyUrl(url: string): boolean {
  if (!isHttpUrl(url)) return false;
  try {
    const u = new URL(url);
    return /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/company\/[^/]+/i.test(u.pathname);
  } catch { return false; }
}

/** Founder enrichment is allowed only with a valid /in/ URL AND explicit consent. */
export function canEnrichFounder(f: FounderForm): boolean {
  return f.enrichment_consent && isLinkedInProfileUrl(f.linkedin_url);
}

/** Company research needs only a website — LinkedIn is optional. */
export function canAnalyzeCompany(c: CompanyForm): boolean {
  return isHttpUrl(c.website_url);
}

/** Which steps the user may advance past. Research/review never block on providers. */
export function canContinue(step: StepId, s: { founder: FounderForm; company: CompanyForm }): boolean {
  switch (step) {
    case 'founder':  return s.founder.name.trim().length > 0;
    case 'company':  return s.company.name.trim().length > 0 && isHttpUrl(s.company.website_url);
    case 'research': return true;   // AI research may be skipped; the user can fill by hand
    case 'review':   return true;   // saving a draft is always allowed
    case 'activate': return true;
  }
}

// ------------------------------------------------------- draft-input builder -

/** Payload for `generate-company-brain-draft` action=draft. Never sends consent flags. */
export function buildDraftInput(args: {
  founder: FounderForm;
  company: CompanyForm;
  founderResearch?: unknown;
  companyResearch?: unknown;
  companyLinkedIn?: unknown;
}) {
  return {
    founder_input: {
      name: args.founder.name,
      role: args.founder.role,
      first_help_goal: args.founder.first_help_goal,
    },
    founder_research: args.founderResearch ?? null,
    company_input: {
      name: args.company.name,
      website_url: args.company.website_url,
      linkedin_url: args.company.linkedin_url,
      description: args.company.description,
      stage: args.company.stage,
      team_size: args.company.team_size,
    },
    company_research: args.companyResearch ?? null,
    company_linkedin: args.companyLinkedIn ?? null,
  };
}

// --------------------------------------------------------------- save patch --

/**
 * Build the v2 patch sent to save_draft / activate. User-typed values always
 * win over the AI draft; derived flags are never sent (the server recomputes).
 */
export function buildSavePatch(args: {
  founder: FounderForm;
  company: CompanyForm;
  brain: CompanyBrainV2;
}): Record<string, unknown> {
  const { founder, company, brain } = args;
  return {
    company: {
      ...brain.company,
      name: company.name || brain.company.name,
      website_url: company.website_url || brain.company.website_url,
      description: company.description || brain.company.description,
      stage: company.stage || brain.company.stage,
      team_size: company.team_size || brain.company.team_size,
    },
    founder: {
      ...brain.founder,
      name: founder.name || brain.founder.name,
      role: founder.role || brain.founder.role,
      linkedin_url: founder.linkedin_url || brain.founder.linkedin_url,
    },
    target_customer: brain.target_customer,
    buyer_personas: brain.buyer_personas,
    triggers: brain.triggers,
    jobs_to_watch: brain.jobs_to_watch,
    competitors: brain.competitors,
    tools: brain.tools,
    pain_points: brain.pain_points,
    positive_examples: brain.positive_examples,
    negative_examples: brain.negative_examples,
    content_angles: brain.content_angles,
    positioning: brain.positioning,
    brand_voice: brain.brand_voice,
    qualification_rules: brain.qualification_rules,
    evidence: brain.evidence,
    is_draft: brain.is_draft,
  };
}

// ------------------------------------------------------------- live preview --

export interface BrainPreview {
  brain: CompanyBrainV2;
  completeness: CompletenessResult;
}

/** Normalize whatever we have right now → the always-visible preview panel. */
export function previewBrain(rawProfile: unknown): BrainPreview {
  const brain = normalizeCompanyBrain((rawProfile ?? {}) as Record<string, unknown>);
  return { brain, completeness: computeCompanyBrainCompleteness(brain) };
}

// ------------------------------------------------------ review quick actions -

export type QuickAction = 'correct' | 'too_broad' | 'too_narrow' | 'add_bad_fit' | 'never_target' | 'require_proof';

export const QUICK_ACTIONS: Array<{ id: QuickAction; label: string }> = [
  { id: 'correct',       label: 'This is correct' },
  { id: 'too_broad',     label: 'Too broad' },
  { id: 'too_narrow',    label: 'Too narrow' },
  { id: 'add_bad_fit',   label: 'Add bad-fit example' },
  { id: 'never_target',  label: 'Never target companies like this' },
  { id: 'require_proof', label: 'Require proof before trusting this' },
];

/**
 * Apply a review quick action to the Brain. `never_target` and `add_bad_fit`
 * write into the disqualifier buckets / negative examples — bad fit is
 * first-class, not an afterthought.
 */
export function applyQuickAction(brain: CompanyBrainV2, action: QuickAction, value?: string): CompanyBrainV2 {
  const b: CompanyBrainV2 = structuredClone(brain);
  const v = (value ?? '').trim();
  switch (action) {
    case 'never_target':
      if (v && !b.target_customer.disqualifiers.industries.includes(v)) {
        b.target_customer.disqualifiers.industries.push(v);
      }
      break;
    case 'add_bad_fit':
      if (v && !b.negative_examples.includes(v)) b.negative_examples.push(v);
      break;
    case 'require_proof':
      if (v && !b.qualification_rules.required_evidence.includes(v)) {
        b.qualification_rules.required_evidence.push(v);
      }
      break;
    case 'too_broad':
      if (v && !b.qualification_rules.manual_review_if.includes(v)) {
        b.qualification_rules.manual_review_if.push(v);
      }
      break;
    case 'too_narrow':
    case 'correct':
      break; // no mutation — these are review signals, not targeting changes
  }
  return b;
}
