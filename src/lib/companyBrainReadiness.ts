// Company Brain readiness: ONE rule for "what can this Brain power yet?".
//
// Today every gate asks the same yes/no question — `onboarding_completed` —
// so a half-built Brain can do nothing at all, and the radar alone degrades
// instead of refusing. Roadmap Phase 2 replaces that with per-capability
// minimums. Activation (computeCompanyBrainCompleteness: all 8 required slots)
// still means `ready`; below it a Brain is `usable` for exactly the
// capabilities its fields support, or a `draft`.
//
// This decides only whether the Brain holds enough CONTEXT for a capability.
// Mission admission, evidence requirements, qualification and spending gates
// are unchanged and still run afterwards.
//
// Frontend mirror of supabase/functions/_shared/companyBrainReadiness.ts; a
// parity test keeps the two identical. The server decides; this copy lets the
// UI show the same answer before it asks. Pure.
import type { CompanyBrainV2 } from './normalizeCompanyBrain';

export type BrainCapability = "read_only" | "signals" | "lead_search" | "outreach" | "content";
export type BrainReadinessState = "draft" | "usable" | "ready";

export const BRAIN_CAPABILITIES: readonly BrainCapability[] = ["read_only", "signals", "lead_search", "outreach", "content"];

export interface ReadinessNeed {
  /** Stable id, for tests and analytics. */
  key: string;
  /** What to add, in words for a person: "Add your target industries". */
  label: string;
}

export interface BrainReadiness {
  state: BrainReadinessState;
  activated: boolean;
  can: Record<BrainCapability, boolean>;
  /** What each blocked capability still needs. Empty for an allowed one. */
  needs: Record<BrainCapability, ReadinessNeed[]>;
}

const has = (xs: unknown): boolean => Array.isArray(xs) && xs.length > 0;
const text = (s: unknown): boolean => typeof s === "string" && s.trim().length > 0;

const NEED = {
  activation: { key: "activation", label: "Finish setting up your Company Brain" },
  market: { key: "target_customer.market", label: "Add your target industries or must-have traits" },
  industries: { key: "target_customer.industries", label: "Add your target industries" },
  buyers: { key: "buyer_personas", label: "Add a buyer persona or a must-have trait" },
  promise: { key: "positioning.promise", label: "Add your positioning promise" },
  description: { key: "company.description", label: "Describe what your company does" },
  voice: { key: "content.voice", label: "Add a pain point or a content angle" },
} satisfies Record<string, ReadinessNeed>;

/**
 * Per-capability minimums (roadmap Phase 2, "Proposed"):
 *   read_only    nothing — the dashboard, results and settings always open
 *   signals      industries OR must-have
 *   lead_search  industries AND (buyers OR must-have)
 *   outreach     activated AND a positioning promise
 *   content      a company description AND (a pain point OR a content angle)
 */
function needsFor(b: CompanyBrainV2, activated: boolean): Record<BrainCapability, ReadinessNeed[]> {
  const tc = b.target_customer;
  const industries = has(tc.industries);
  const mustHave = has(tc.must_have);
  return {
    read_only: [],
    signals: industries || mustHave ? [] : [NEED.market],
    lead_search: [
      ...(industries ? [] : [NEED.industries]),
      ...(has(b.buyer_personas) || mustHave ? [] : [NEED.buyers]),
    ],
    outreach: [
      ...(activated ? [] : [NEED.activation]),
      ...(text(b.positioning.promise) ? [] : [NEED.promise]),
    ],
    content: [
      ...(text(b.company.description) ? [] : [NEED.description]),
      ...(has(b.pain_points) || has(b.content_angles) ? [] : [NEED.voice]),
    ],
  };
}

/** Readiness of a normalized Brain. `activated` is the row's `onboarding_completed`. */
export function companyBrainReadiness(brain: CompanyBrainV2, activated: boolean | null | undefined): BrainReadiness {
  const isActive = activated === true;
  const needs = needsFor(brain, isActive);
  const can = Object.fromEntries(BRAIN_CAPABILITIES.map((c) => [c, needs[c].length === 0])) as Record<BrainCapability, boolean>;
  const state: BrainReadinessState = isActive
    ? "ready"
    : (can.signals || can.lead_search || can.content) ? "usable" : "draft";
  return { state, activated: isActive, can, needs };
}
