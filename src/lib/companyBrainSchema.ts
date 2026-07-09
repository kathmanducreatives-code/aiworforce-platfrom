// Shared Company Brain schema helpers used by the onboarding wizard and tests.
// Keep additive: never overwrite user-entered values with defaults.

export interface FounderProfile {
  name: string;
  role: string;
  linkedin_url: string;
  timezone: string;
  first_help_goal: string;
}

export interface CompanyProfile {
  name: string;
  website_url: string;
  linkedin_url: string;
  description: string;
  category: string;
  industry: string;
  stage: string;
  team_size: string;
  location: string;
}

export interface IcpProfile {
  buyer_roles: string[];
  company_size: string;
  industries: string[];
  geography: string;
  pain_points: string[];
  disqualifiers: string[];
}

export interface GoalsProfile {
  gtm: string;
  content: string;
  competitor_tracking: string;
  outreach: string;
  hiring: string;
}

export interface GtmProfile {
  motion: string;
  primary_channel: string;
  preferred_channels: string[];
  biggest_bottleneck: string;
  current_tools: string[];
  thirty_day_goal: string;
}

export interface PositioningProfile {
  promise: string;
  differentiators: string[];
  use_cases: string[];
  proof_points: string[];
  offer: string;
  pricing: string;
  avoid_positioning: string[];
}

export interface BrandVoiceProfile {
  tone: string;
  tags: string[];
  style_rules: string[];
  avoid: string[];
  example_message: string;
}

export interface CompetitorsProfile {
  known: string[];
  adjacent: string[];
  unknown: boolean;
}

export interface ApprovalRules {
  draft_only: boolean;
  email_requires_approval: boolean;
  linkedin_manual_only: boolean;
  daily_credit_limit: number;
}

export interface WorkflowPreferences {
  priority_workflows: string[];
}

export type IntegrationStatusValue = 'connected' | 'setup_needed' | 'optional' | 'unavailable';

export interface IntegrationStatusEntry {
  status: IntegrationStatusValue;
  label: string;
  reason?: string;
}

export type IntegrationStatusMap = Record<string, IntegrationStatusEntry>;

export interface OnboardingMeta {
  current_step: string;
  completed_steps: string[];
  updated_at: string;
}

export interface StructuredBrain {
  founder: FounderProfile;
  company: CompanyProfile;
  icp: IcpProfile;
  goals: GoalsProfile;
  gtm: GtmProfile;
  positioning: PositioningProfile;
  brand_voice: BrandVoiceProfile;
  competitors: CompetitorsProfile;
  approval_rules: ApprovalRules;
  workflow_preferences: WorkflowPreferences;
  integration_status: IntegrationStatusMap;
  onboarding_meta: OnboardingMeta;
}

export const BRAND_VOICE_TAGS = [
  'founder-led',
  'technical',
  'casual',
  'premium',
  'direct',
  'educational',
  'no-hype',
] as const;

export const GTM_MOTIONS = [
  'founder-led sales',
  'outbound',
  'inbound/content',
  'PLG',
  'agency/referral',
  'not started',
] as const;

export const PRIMARY_CHANNELS = [
  'cold call',
  'LinkedIn',
  'email',
  'content',
  'partnerships',
  'paid content',
  'not sure',
] as const;

export const COMPANY_STAGES = ['idea', 'pre-seed', 'seed', 'Series A', 'bootstrapped', 'agency/service', 'other'] as const;
export const TEAM_SIZES = ['solo', '2-5', '6-10', '11-50', '51-100', '100+'] as const;

export const FIRST_HELP_GOALS = [
  'find_leads',
  'research_companies',
  'draft_outreach',
  'create_content',
  'audit_website',
  'track_competitors',
  'organize_founder_ops',
  'not_sure',
] as const;

export function getBrainDefaults(): StructuredBrain {
  return {
    founder: { name: '', role: '', linkedin_url: '', timezone: '', first_help_goal: '' },
    company: { name: '', website_url: '', linkedin_url: '', description: '', category: '', industry: '', stage: '', team_size: '', location: '' },
    icp: { buyer_roles: [], company_size: '', industries: [], geography: '', pain_points: [], disqualifiers: [] },
    goals: { gtm: '', content: '', competitor_tracking: '', outreach: '', hiring: '' },
    gtm: { motion: '', primary_channel: '', preferred_channels: [], biggest_bottleneck: '', current_tools: [], thirty_day_goal: '' },
    positioning: { promise: '', differentiators: [], use_cases: [], proof_points: [], offer: '', pricing: '', avoid_positioning: [] },
    brand_voice: { tone: '', tags: [], style_rules: [], avoid: [], example_message: '' },
    competitors: { known: [], adjacent: [], unknown: false },
    approval_rules: { draft_only: true, email_requires_approval: true, linkedin_manual_only: true, daily_credit_limit: 100 },
    workflow_preferences: { priority_workflows: [] },
    integration_status: {},
    onboarding_meta: { current_step: '', completed_steps: [], updated_at: '' },
  };
}

// Shallow-merge nested groups; user values win; missing groups get empty defaults.
export function mergeProfile(
  existing: Record<string, any> | null | undefined,
  patch: Partial<StructuredBrain> & Record<string, any>,
): Record<string, any> {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  const defaults = getBrainDefaults() as Record<string, any>;
  for (const key of Object.keys(defaults)) {
    const current = (base[key] && typeof base[key] === 'object') ? base[key] : (defaults[key] as any);
    const incoming = (patch as Record<string, any>)[key];
    base[key] = incoming ? { ...current, ...incoming } : current;
  }
  // Pass-through any extra top-level keys in patch (forwards-compat).
  for (const k of Object.keys(patch)) {
    if (!(k in defaults)) base[k] = (patch as any)[k];
  }
  return base;
}

export function isOnboardingComplete(brain: { onboarding_completed?: boolean } | null | undefined): boolean {
  return !!brain?.onboarding_completed;
}

// ---- v2 save helpers ---------------------------------------------------
// Merge a partial v2 patch into an existing profile without clobbering
// legacy top-level keys. Callers should re-normalize with
// normalizeCompanyBrain(...) before rendering.
import { normalizeCompanyBrain, type CompanyBrainV2 } from './normalizeCompanyBrain';

export type CompanyBrainV2Patch = Partial<Omit<CompanyBrainV2, 'schema_version' | 'legacy' | 'setup_required' | 'brain_confidence'>>;

export function mergeV2Patch(
  existing: Record<string, any> | null | undefined,
  patch: CompanyBrainV2Patch,
): Record<string, any> {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  base.schema_version = 2;
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) continue;
    if (Array.isArray(v)) { base[k] = v; continue; }
    if (typeof v === 'object') {
      const cur = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? base[k] : {};
      base[k] = { ...cur, ...v };
      continue;
    }
    base[k] = v;
  }
  // Recompute derived flags via the normalizer so writers can't set stale ones.
  const norm = normalizeCompanyBrain(base);
  base.setup_status = norm.setup_status;
  return base;
}

