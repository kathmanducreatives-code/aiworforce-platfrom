// Deno-friendly mirror of src/lib/companyBrainSchema.ts for edge functions.
export interface StructuredBrainPatch {
  icp?: Record<string, unknown>;
  goals?: Record<string, unknown>;
  positioning?: Record<string, unknown>;
  brand_voice?: Record<string, unknown>;
  competitors?: Record<string, unknown>;
  approval_rules?: Record<string, unknown>;
}

export function getBrainDefaults() {
  return {
    icp: { buyer_roles: [] as string[], company_size: '', industries: [] as string[], geography: '', pain_points: [] as string[] },
    goals: { gtm: '', content: '', competitor_tracking: '', outreach: '', hiring: '' },
    positioning: { promise: '', differentiators: [] as string[], use_cases: [] as string[], proof_points: [] as string[] },
    brand_voice: { tone: '', tags: [] as string[], style_rules: [] as string[], avoid: [] as string[] },
    competitors: { known: [] as string[], adjacent: [] as string[], unknown: false },
    approval_rules: { draft_only: true, email_requires_approval: true, linkedin_manual_only: true },
  };
}

export function mergeProfile(
  existing: Record<string, unknown> | null | undefined,
  patch: StructuredBrainPatch,
): Record<string, unknown> {
  const base: Record<string, unknown> = existing && typeof existing === 'object' ? { ...existing } : {};
  const defaults = getBrainDefaults() as Record<string, Record<string, unknown>>;
  for (const key of Object.keys(defaults)) {
    const current = base[key] && typeof base[key] === 'object' ? base[key] as Record<string, unknown> : defaults[key];
    const incoming = (patch as Record<string, Record<string, unknown> | undefined>)[key];
    base[key] = incoming ? { ...current, ...incoming } : current;
  }
  return base;
}
