// Deno-friendly mirror of src/lib/companyBrainSchema.ts for edge functions.
export interface StructuredBrainPatch {
  founder?: Record<string, unknown>;
  company?: Record<string, unknown>;
  icp?: Record<string, unknown>;
  goals?: Record<string, unknown>;
  gtm?: Record<string, unknown>;
  positioning?: Record<string, unknown>;
  brand_voice?: Record<string, unknown>;
  competitors?: Record<string, unknown>;
  approval_rules?: Record<string, unknown>;
  workflow_preferences?: Record<string, unknown>;
  integration_status?: Record<string, unknown>;
  onboarding_meta?: Record<string, unknown>;
}

export function getBrainDefaults() {
  return {
    founder: { name: '', role: '', linkedin_url: '', timezone: '', first_help_goal: '' },
    company: { name: '', website_url: '', linkedin_url: '', description: '', category: '', industry: '', stage: '', team_size: '', location: '' },
    icp: { buyer_roles: [] as string[], company_size: '', industries: [] as string[], geography: '', pain_points: [] as string[], disqualifiers: [] as string[] },
    goals: { gtm: '', content: '', competitor_tracking: '', outreach: '', hiring: '' },
    gtm: { motion: '', primary_channel: '', preferred_channels: [] as string[], biggest_bottleneck: '', current_tools: [] as string[], thirty_day_goal: '' },
    positioning: { promise: '', differentiators: [] as string[], use_cases: [] as string[], proof_points: [] as string[], offer: '', pricing: '', avoid_positioning: [] as string[] },
    brand_voice: { tone: '', tags: [] as string[], style_rules: [] as string[], avoid: [] as string[], example_message: '' },
    competitors: { known: [] as string[], adjacent: [] as string[], unknown: false },
    approval_rules: { draft_only: true, email_requires_approval: true, linkedin_manual_only: true, daily_credit_limit: 100 },
    workflow_preferences: { priority_workflows: [] as string[] },
    integration_status: {} as Record<string, unknown>,
    onboarding_meta: { current_step: '', completed_steps: [] as string[], updated_at: '' },
  };
}

export function mergeProfile(
  existing: Record<string, unknown> | null | undefined,
  patch: StructuredBrainPatch & Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = existing && typeof existing === 'object' ? { ...existing } : {};
  const defaults = getBrainDefaults() as Record<string, Record<string, unknown>>;
  for (const key of Object.keys(defaults)) {
    const current = base[key] && typeof base[key] === 'object' ? base[key] as Record<string, unknown> : defaults[key];
    const incoming = (patch as Record<string, Record<string, unknown> | undefined>)[key];
    base[key] = incoming ? { ...current, ...incoming } : current;
  }
  for (const k of Object.keys(patch)) {
    if (!(k in defaults)) base[k] = (patch as Record<string, unknown>)[k];
  }
  return base;
}
