// Section metadata + health derivation for the saved Company Brain page.
//
// Pure helper. Reads the normalized CompanyBrainV2 view model and derives a
// per-section health state used by the premium section cards. No data mutation,
// no backend calls — presentational only. SectionKey mirrors the drawer's edit
// contract so health and edit stay in sync.

import { Brain, Crosshair, Users, Radar, ShieldAlert, Megaphone } from 'lucide-react';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';

export type SectionHealth = 'configured' | 'needs-confirmation' | 'needs-detail';

export type SectionKey = 'company' | 'targeting' | 'buyers' | 'signals' | 'disqualifiers' | 'messaging';

export interface SectionMeta {
  key: SectionKey;
  /** Short eyebrow shown above the title. */
  eyebrow: string;
  title: string;
  /** One-line explanation of what this section powers. */
  explanation: string;
  icon: typeof Brain;
}

export const SECTION_ORDER: SectionKey[] = [
  'targeting', 'buyers', 'signals', 'company', 'disqualifiers', 'messaging',
];

export const SECTION_META: Record<SectionKey, SectionMeta> = {
  targeting: {
    key: 'targeting',
    eyebrow: 'ICP & targeting',
    title: 'ICP / targeting',
    explanation: 'Defines who counts as a fit worth researching.',
    icon: Crosshair,
  },
  buyers: {
    key: 'buyers',
    eyebrow: 'Buyer personas',
    title: 'Buyer personas',
    explanation: 'The roles you sell to and the pains you solve.',
    icon: Users,
  },
  signals: {
    key: 'signals',
    eyebrow: 'Buying signals',
    title: 'Buying signals',
    explanation: 'What Scout Radar should watch for.',
    icon: Radar,
  },
  company: {
    key: 'company',
    eyebrow: 'Company understanding',
    title: 'Company understanding',
    explanation: 'Who you are and what you do.',
    icon: Brain,
  },
  disqualifiers: {
    key: 'disqualifiers',
    eyebrow: 'Disqualifiers & safety',
    title: 'Disqualifiers & safety',
    explanation: 'Who and what to never target.',
    icon: ShieldAlert,
  },
  messaging: {
    key: 'messaging',
    eyebrow: 'Messaging & positioning',
    title: 'Messaging & positioning',
    explanation: 'How Agentory should sound on your behalf.',
    icon: Megaphone,
  },
};

export const HEALTH_LABEL: Record<SectionHealth, string> = {
  configured: 'Configured',
  'needs-confirmation': 'Needs confirmation',
  'needs-detail': 'Add more detail',
};

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

export const HEALTH_TONE: Record<SectionHealth, 'emerald' | 'amber' | 'neutral'> = {
  configured: 'emerald',
  'needs-confirmation': 'amber',
  'needs-detail': 'neutral',
};
