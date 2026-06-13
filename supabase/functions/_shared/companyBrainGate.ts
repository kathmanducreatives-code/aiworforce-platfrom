// Gate logic: should we block content/GTM workflow execution until the user
// has completed Company Brain onboarding?
// Pure function, no side effects, safe to import in tests.

export type GateIntent = string;

// Intents that require company context to produce specific, non-generic output.
export const GATED_INTENTS: ReadonlySet<GateIntent> = new Set([
  'content_draft',
  'source_signals',
  'draft_outreach',
  'send_requires_approval',
  'enrich_existing_leads',
  'rank_existing_leads',
  'competitor_tracking',
  'analyze_url', // URL analysis without brain context yields generic summaries
]);

export interface BrainGateInput {
  onboarding_completed?: boolean | null;
  profile?: Record<string, unknown> | null;
}

export function shouldGateForOnboarding(intent: GateIntent | null | undefined, brain: BrainGateInput | null | undefined): boolean {
  if (!intent) return false;
  if (!GATED_INTENTS.has(intent)) return false;
  if (brain?.onboarding_completed === true) return false;
  return true;
}

export const ONBOARDING_GATE_REPLY =
  "I can do that — but I need your Company Brain first so the output is specific to your business, not generic. " +
  "Share your website URL, or open onboarding to set up your company, ICP, and brand voice (2 minutes).";
