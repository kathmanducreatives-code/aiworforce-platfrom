// What a capability page tells the user when the Company Brain can't power it
// yet (roadmap Phase 2). The page still opens and shows what the workspace
// already holds; the notice names exactly what to add. The server enforces the
// same rule (companyBrainReadiness) — this is guidance, not the boundary. Pure.

import type { BrainCapability, BrainReadiness } from './companyBrainReadiness';

export interface CapabilityNotice {
  title: string;
  needs: string[];
  /** Where the user fixes it. */
  href: string;
  cta: string;
}

const TITLE: Record<Exclude<BrainCapability, 'read_only'>, string> = {
  signals: 'Signals needs a little more from your Company Brain',
  lead_search: 'Lead search needs a little more from your Company Brain',
  content: 'Content drafts need a little more from your Company Brain',
  outreach: 'Outreach unlocks when your Company Brain is complete',
};

export function capabilityNotice(readiness: BrainReadiness | null, capability: Exclude<BrainCapability, 'read_only'>): CapabilityNotice | null {
  if (!readiness || readiness.can[capability]) return null;
  const needs = readiness.needs[capability].map((n) => n.label);
  const finish = !readiness.activated && needs.length === 1 && readiness.needs[capability][0].key === 'activation';
  return {
    title: TITLE[capability],
    needs,
    href: finish ? '/onboarding/company-brain' : '/company-brain',
    cta: finish ? 'Finish setup' : 'Open Company Brain',
  };
}
