// Shared Company Brain schema helpers used by the onboarding wizard and tests.
// Keep additive: never overwrite user-entered values with defaults.

export interface IcpProfile {
  buyer_roles: string[];
  company_size: string;
  industries: string[];
  geography: string;
  pain_points: string[];
}

export interface GoalsProfile {
  gtm: string;
  content: string;
  competitor_tracking: string;
  outreach: string;
  hiring: string;
}

export interface PositioningProfile {
  promise: string;
  differentiators: string[];
  use_cases: string[];
  proof_points: string[];
}

export interface BrandVoiceProfile {
  tone: string;
  tags: string[];
  style_rules: string[];
  avoid: string[];
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
}

export interface StructuredBrain {
  icp: IcpProfile;
  goals: GoalsProfile;
  positioning: PositioningProfile;
  brand_voice: BrandVoiceProfile;
  competitors: CompetitorsProfile;
  approval_rules: ApprovalRules;
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

export function getBrainDefaults(): StructuredBrain {
  return {
    icp: { buyer_roles: [], company_size: '', industries: [], geography: '', pain_points: [] },
    goals: { gtm: '', content: '', competitor_tracking: '', outreach: '', hiring: '' },
    positioning: { promise: '', differentiators: [], use_cases: [], proof_points: [] },
    brand_voice: { tone: '', tags: [], style_rules: [], avoid: [] },
    competitors: { known: [], adjacent: [], unknown: false },
    approval_rules: { draft_only: true, email_requires_approval: true, linkedin_manual_only: true },
  };
}

// Shallow-merge nested groups; user values win; missing groups get empty defaults.
export function mergeProfile(
  existing: Record<string, any> | null | undefined,
  patch: Partial<StructuredBrain>,
): Record<string, any> {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  const defaults = getBrainDefaults();
  for (const key of Object.keys(defaults) as (keyof StructuredBrain)[]) {
    const current = (base[key] && typeof base[key] === 'object') ? base[key] : (defaults[key] as any);
    const incoming = patch[key];
    base[key] = incoming ? { ...current, ...incoming } : current;
  }
  return base;
}

export function isOnboardingComplete(brain: { onboarding_completed?: boolean } | null | undefined): boolean {
  return !!brain?.onboarding_completed;
}
