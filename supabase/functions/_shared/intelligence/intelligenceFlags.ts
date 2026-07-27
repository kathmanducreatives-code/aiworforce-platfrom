// AGENTORY INTELLIGENCE FEATURE FLAGS — Phase 1.
//
// These follow the repository's ONE existing flag convention, `_shared/signalsV2Flag.ts`:
//
//   * OFF by default, everywhere. There is no environment-specific default and no
//     production carve-out.
//   * Server-side only: read from the Edge Function environment, never exposed to,
//     nor parsed from, any frontend / user / provider / tool input. A planner may
//     never turn itself on.
//   * STRICT allowlist parsing — only "true" / "1" / "enabled" (after trim +
//     lowercase) enable a flag. "yes", "on", "TRUE!", "2" all resolve to FALSE, so
//     a typo cannot silently enable Claude-first planning.
//   * Injectable reader, so tests never depend on real env state.
//
// PHASE 1 CONTRACT: with every flag OFF — which is the default and the only state
// this branch ships — no planner call, no capability selection, no new persistence
// and no provider-input change may occur. `assertAllIntelligenceFlagsOff()` exists
// so that contract is asserted by tests rather than asserted in prose.

import { type EnvReader } from "../signalsV2Flag.ts";

export type { EnvReader };

/**
 * Every intelligence flag. The array is the single source of truth: tests iterate
 * it, so a flag added here without a default of OFF fails the suite.
 */
export const INTELLIGENCE_FLAGS = [
  /** Phase 2. Claude produces the lead sourcing strategy instead of the deterministic compiler. */
  "CLAUDE_FIRST_LEAD_PLANNING",
  /** Phase 2. Claude re-plans between sourcing rounds. */
  "CLAUDE_LEAD_REPLANNING",
  /** Phase 3. Semantic (rather than registry-literal) title validation. */
  "SEMANTIC_TITLE_VALIDATION",
  /** Phase 4. Worldwide role/geography planning. Gated on the geography fix. */
  "GLOBAL_ROLE_PLANNING",
  /** Phase 3. Persist and reuse strategies that worked. */
  "LEAD_STRATEGY_MEMORY",
  /** Phase 5. Signals department planner. */
  "SIGNAL_INTELLIGENCE_KERNEL",
  /** Phase 5. Content department planner. */
  "CONTENT_INTELLIGENCE_KERNEL",
  /** Phase 6. Cross-department mission handoffs. */
  "CROSS_DEPARTMENT_INTELLIGENCE",
  /** PR #106. Mission-aware selection of approved hiring-source channels. */
  "DYNAMIC_HIRING_SOURCE_PLANNING",
] as const;

export type IntelligenceFlag = typeof INTELLIGENCE_FLAGS[number];

/** The ONLY values that enable a flag (after trim + lowercase). Mirrors SIGNALS_V2. */
export const INTELLIGENCE_FLAG_ENABLED_VALUES: ReadonlySet<string> = new Set(["true", "1", "enabled"]);

/** Strict, allowlist-only parse. Everything not explicitly enabled is OFF. */
export function parseIntelligenceFlag(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  return INTELLIGENCE_FLAG_ENABLED_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Resolve one flag from the server environment (or an injected reader in tests).
 * A missing env permission, a throwing reader, or an unknown value all resolve
 * FALSE — this never throws, because a planner that fails open is a planner that
 * runs when nobody authorized it.
 */
export function isIntelligenceFlagEnabled(flag: IntelligenceFlag, read?: EnvReader): boolean {
  try {
    const get: EnvReader = read ?? ((k) => Deno.env.get(k));
    return parseIntelligenceFlag(get(flag));
  } catch {
    return false;
  }
}

export interface IntelligenceFlagState {
  claude_first_lead_planning: boolean;
  claude_lead_replanning: boolean;
  semantic_title_validation: boolean;
  global_role_planning: boolean;
  lead_strategy_memory: boolean;
  signal_intelligence_kernel: boolean;
  content_intelligence_kernel: boolean;
  cross_department_intelligence: boolean;
  dynamic_hiring_source_planning: boolean;
}

/** Snapshot every flag at once, for diagnostics and for the all-off assertion. */
export function readIntelligenceFlags(read?: EnvReader): IntelligenceFlagState {
  return {
    claude_first_lead_planning: isIntelligenceFlagEnabled("CLAUDE_FIRST_LEAD_PLANNING", read),
    claude_lead_replanning: isIntelligenceFlagEnabled("CLAUDE_LEAD_REPLANNING", read),
    semantic_title_validation: isIntelligenceFlagEnabled("SEMANTIC_TITLE_VALIDATION", read),
    global_role_planning: isIntelligenceFlagEnabled("GLOBAL_ROLE_PLANNING", read),
    lead_strategy_memory: isIntelligenceFlagEnabled("LEAD_STRATEGY_MEMORY", read),
    signal_intelligence_kernel: isIntelligenceFlagEnabled("SIGNAL_INTELLIGENCE_KERNEL", read),
    content_intelligence_kernel: isIntelligenceFlagEnabled("CONTENT_INTELLIGENCE_KERNEL", read),
    cross_department_intelligence: isIntelligenceFlagEnabled("CROSS_DEPARTMENT_INTELLIGENCE", read),
    dynamic_hiring_source_planning: isIntelligenceFlagEnabled("DYNAMIC_HIRING_SOURCE_PLANNING", read),
  };
}

/** True when no intelligence feature is active — the Phase 1 shipping state. */
export function allIntelligenceFlagsOff(read?: EnvReader): boolean {
  return Object.values(readIntelligenceFlags(read)).every((v) => v === false);
}

// ---------------------------------------------------------------- the gate ----
//
// GEOGRAPHY GATE — CLEARED IN PHASE 2.
//
// The blocker was `inferGeography` in _shared/jobIntentTaxonomy.ts, whose United
// States alternation was `/\b(united states|usa|u\.s\.|\bus\b)\b/i`. Under `/i`,
// `\bus\b` matched the PRONOUN, so "Show us founders in Germany" compiled to
// geography ["United States"] — a country the user never named, contradicting a
// request that explicitly named another one.
//
// Under the deterministic runtime that silently narrowed a search. Under
// Claude-first planning it would have handed the planner a confident false premise
// to plan against, which is why enabling was gated on it.
//
// FIXED: lowercase `us` is no longer a United-States signal at all. Only
// unambiguous forms are accepted — "United States", "United States of America",
// "USA", "U.S.", "U.S.A.", and standalone uppercase `US` read from the
// original-case query (and not from SHOUTED text, where case carries no meaning).
// See `mentionsUnitedStates` and _shared/geographyAmbiguity.test.ts.
//
// STILL TRUE, and NOT what this gate covered: the parser remains US-only, so a
// non-US location resolves to []. That is now honest rather than wrong — it reports
// "nothing I understand" instead of asserting the wrong country. Full worldwide
// normalization is Phase 4 and is gated separately by GLOBAL_ROLE_PLANNING.
//
// Clearing the gate does NOT enable anything. Every flag still defaults OFF.

export const GEOGRAPHY_GATE_NOTE =
  "CLEARED (Phase 2): the lowercase `us` false positive has been removed, so " +
  "claude_first_lead_planning is no longer blocked by it. Enabling remains opt-in " +
  "and per-workspace; the flag still defaults OFF.";

/** True once the ambiguous-`us` defect is fixed. Phase 2 cleared it. */
export const GEOGRAPHY_GATE_CLEARED = true;

/**
 * Flags that were blocked on the geography defect.
 *
 * Kept as a record of WHY these three were gated, and still consulted by
 * `isGeographyGated`. With the gate cleared this is history rather than a live
 * restriction — but the list stays, because GLOBAL_ROLE_PLANNING has its own,
 * separate Phase 4 dependency on worldwide normalization.
 */
export const GEOGRAPHY_GATED_FLAGS: readonly IntelligenceFlag[] = [
  "CLAUDE_FIRST_LEAD_PLANNING",
  "CLAUDE_LEAD_REPLANNING",
  "GLOBAL_ROLE_PLANNING",
];

export function isGeographyGated(flag: IntelligenceFlag): boolean {
  return GEOGRAPHY_GATED_FLAGS.includes(flag);
}

/** May this flag be enabled, as far as the geography prerequisite is concerned? */
export function geographyGateSatisfied(flag: IntelligenceFlag): boolean {
  return !isGeographyGated(flag) || GEOGRAPHY_GATE_CLEARED;
}
