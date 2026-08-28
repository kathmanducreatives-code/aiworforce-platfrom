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

/**
 * Objectives that need company context to produce anything specific.
 *
 * ── WHY THIS EXISTS BESIDE `GATED_INTENTS` ──────────────────────────────────
 *
 * The set above is keyed on `classifyIntent`'s vocabulary — `content_draft`,
 * `source_signals`, `analyze_url` — which is a second classifier's reading of
 * the sentence. The gate's actual rule was never about those words: work that
 * GOES AND DOES SOMETHING for this business is generic without knowing the
 * business, and work that reports what is already held is not.
 *
 * That maps onto the objective directly. `read`, `converse` and `monitor` are
 * ungated — answering "what leads do I have?" or "am I watching anyone?" needs
 * no ICP, and refusing them until onboarding is done would hide the workspace
 * from its owner.
 */
const GATED_OBJECTIVES: ReadonlySet<string> = new Set([
  "source", "research", "compose",
]);

/** The same gate, asked of a `RequestObjective` instead of a classifier intent. */
export function shouldGateObjective(
  objective: string | null | undefined, brain: BrainGateInput | null | undefined,
): boolean {
  if (!objective) return false;
  if (!GATED_OBJECTIVES.has(objective)) return false;
  return brain?.onboarding_completed !== true;
}

export const ONBOARDING_GATE_REPLY =
  "I can do that — but I need your Company Brain first so the output is specific to your business, not generic. " +
  "Share your website URL, or open onboarding to set up your company, ICP, and brand voice (2 minutes).";
