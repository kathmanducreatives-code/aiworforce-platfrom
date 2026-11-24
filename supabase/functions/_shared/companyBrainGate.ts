// Gate logic: should we block content/GTM workflow execution until the user
// has completed Company Brain onboarding?
// Pure function, no side effects, safe to import in tests.

import type { BrainCapability, BrainReadiness } from "./companyBrainReadiness.ts";

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

// ── ROADMAP PHASE 2: GATE ON WHAT THE BRAIN CAN POWER, NOT ON ONE FLAG ─────
//
// The gates above refuse everything that does work until onboarding is fully
// activated. With BRAIN_READINESS_V2 on, a request is refused only when the
// Brain lacks the context ITS capability needs (companyBrainReadiness), and the
// reply says exactly what to add. Owner decisions (2026-10-23): lead search
// runs before activation once industries plus buyers or must-haves exist;
// content DRAFTS run with a description plus a pain point or content angle —
// nothing is published without a person (content stays a draft until approved).
// Outreach still needs a fully activated Brain. Mission admission, credits and
// qualification are unchanged and still apply afterwards.


/** Off unless explicitly enabled — the switch is the rollback. */
export function brainReadinessV2Enabled(readEnv: (key: string) => string | undefined): boolean {
  const v = (readEnv("BRAIN_READINESS_V2") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/** The capability a gated objective needs; null for objectives that only read or talk. */
export function capabilityForObjective(
  objective: string | null | undefined, composeKind: "outreach" | "content" | null | undefined,
): BrainCapability | null {
  if (objective === "source") return "lead_search";
  if (objective === "research") return "signals";
  if (objective === "compose") return composeKind === "content" ? "content" : "outreach";
  return null;
}

const CAPABILITY_NAME: Record<BrainCapability, string> = {
  read_only: "that", signals: "Signals research", lead_search: "lead search",
  outreach: "outreach", content: "content drafts",
};

/** "To run lead search I need: your target industries; a buyer persona or a must-have trait. …" */
export function readinessGateReply(capability: BrainCapability, readiness: BrainReadiness): string {
  const needs = readiness.needs[capability].map((n) => n.label.charAt(0).toLowerCase() + n.label.slice(1));
  return `I can do that, but ${CAPABILITY_NAME[capability]} needs a little more from your Company Brain first: ` +
    `${needs.join("; ")}. Add ${needs.length > 1 ? "them" : "it"} on the Company Brain page and ask me again.`;
}

export type ReadinessGateDecision =
  | { gated: false; capability: BrainCapability | null }
  | { gated: true; capability: BrainCapability; reply: string };

export function readinessGate(
  objective: string | null | undefined,
  composeKind: "outreach" | "content" | null | undefined,
  readiness: BrainReadiness,
): ReadinessGateDecision {
  const capability = capabilityForObjective(objective, composeKind);
  if (!capability || readiness.can[capability]) return { gated: false, capability };
  return { gated: true, capability, reply: readinessGateReply(capability, readiness) };
}
