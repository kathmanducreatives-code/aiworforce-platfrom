// Single source of truth for Agentory pricing plans.
// Used by: landing page, billing settings, credit drawer, upgrade prompts.

export interface PricingPlan {
  id: string;
  name: string;
  priceMonthly: number;
  credits: number;
  seats: number;
  /** USD per credit when buying overage on this plan. */
  overagePerCredit: number;
  description: string;
  features: string[];
  highlighted?: boolean;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free_trial',
    name: 'Free Trial',
    priceMonthly: 0,
    credits: 30,
    seats: 1,
    overagePerCredit: 0,
    description: 'Try onboarding, Signal Feed, and 1–2 workflows.',
    features: [
      '30 one-time credits',
      'Company Brain setup',
      'Signal Feed preview',
      'Draft-only outputs',
      'No bulk export',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    priceMonthly: 29,
    credits: 250,
    seats: 1,
    overagePerCredit: 0.15,
    description: 'For solo founders testing AI workflows.',
    features: [
      '250 workflow credits / month',
      'Signal Feed',
      'Workflow Center',
      'Lead Workbench',
      'Limited CSV export',
      'Draft-only outreach',
    ],
  },
  {
    id: 'founder_pro',
    name: 'Founder Pro',
    priceMonthly: 79,
    credits: 900,
    seats: 3,
    overagePerCredit: 0.12,
    highlighted: true,
    description: 'For founders using Agentory every week.',
    features: [
      '900 workflow credits / month',
      'Full Signal Feed',
      'Full Workbench',
      'CSV export',
      'Company enrichment',
      'Outreach draft queue',
      'Workflow recommendations',
      'Priority workflow runs',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    priceMonthly: 199,
    credits: 2800,
    seats: 5,
    overagePerCredit: 0.10,
    description: 'For small GTM / content teams.',
    features: [
      '2,800 workflow credits / month',
      'Higher workflow limits',
      'More radar scans',
      'Team workflows',
      'Priority provider budget',
      'Advanced exports',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    priceMonthly: 499,
    credits: 8000,
    seats: 10,
    overagePerCredit: 0.08,
    description: 'For agencies and heavy GTM usage.',
    features: [
      '8,000 workflow credits / month',
      'Higher concurrency',
      'Agency workflows',
      'Priority support',
      'Custom workflow setup',
      'Higher provider budget caps',
    ],
  },
];

export function getPlan(planId: string): PricingPlan {
  return PRICING_PLANS.find((p) => p.id === planId) ?? PRICING_PLANS[0];
}
