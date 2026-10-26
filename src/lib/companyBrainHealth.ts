// Per-section health for the saved Company Brain. Pure — no icons, no React —
// so it can be read by plain helpers and Deno tests. Re-exported from
// companyBrainSections, where it used to live, so existing imports keep working.

import type { CompanyBrainV2 } from './normalizeCompanyBrain';

export type SectionHealth = 'configured' | 'needs-confirmation' | 'needs-detail';

export type SectionKey = 'company' | 'targeting' | 'buyers' | 'signals' | 'disqualifiers' | 'messaging';

/** Derive a per-section health state from the normalized brain. */
export function deriveHealth(b: CompanyBrainV2): Record<SectionKey, SectionHealth> {
  const t = b.target_customer;

  const companyFilled = !!(b.company.name && b.company.description && b.company.category);
  const company: SectionHealth = companyFilled
    ? 'configured'
    : b.company.name
      ? 'needs-confirmation'
      : 'needs-detail';

  const tgtCore = !!(t.industries.length && t.business_models.length && t.geography.length);
  const tgtExtras = !!(t.must_have.length || t.company_size.label || t.company_size.min || t.company_size.max);
  const targeting: SectionHealth = !t.industries.length
    ? 'needs-detail'
    : (tgtCore && tgtExtras) || tgtCore
      ? 'configured'
      : 'needs-confirmation';

  const buyers: SectionHealth = !b.buyer_personas.length
    ? 'needs-detail'
    : b.pain_points.length
      ? 'configured'
      : 'needs-confirmation';

  const sigBoth = !!(b.triggers.length && b.jobs_to_watch.length);
  const sigOne = !!(b.triggers.length || b.jobs_to_watch.length);
  const signals: SectionHealth = sigBoth ? 'configured' : sigOne ? 'needs-confirmation' : 'needs-detail';

  const hasGuardrail = !!(
    t.disqualifiers.industries.length ||
    t.disqualifiers.company_types.length ||
    t.disqualifiers.keywords.length ||
    t.disqualifiers.titles.length ||
    b.qualification_rules.required_evidence.length ||
    b.qualification_rules.reject_if.length
  );
  // Safety lists may be intentionally empty, so empty = "needs confirmation"
  // rather than alarming "needs detail".
  const disqualifiers: SectionHealth = hasGuardrail ? 'configured' : 'needs-confirmation';

  const msgFull = !!(b.positioning.promise && b.content_angles.length && b.brand_voice.tone);
  const msgSome = !!(b.positioning.promise || b.content_angles.length || b.brand_voice.tone);
  const messaging: SectionHealth = msgFull ? 'configured' : msgSome ? 'needs-confirmation' : 'needs-detail';

  return { company, targeting, buyers, signals, disqualifiers, messaging };
}

