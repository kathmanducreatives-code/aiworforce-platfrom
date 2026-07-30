// CLAUDE NEXT-ACTION LOOP — contract, validation, source-quality adaptation and
// deterministic fallback.
//
// After each bounded observation Claude selects EXACTLY ONE action from the menu
// Agentory computed. It cannot invent an action, address a provider, alter the
// mission or repeat an input. Everything it returns is re-checked here against
// the same observation the menu was built from, so a stale or imagined state
// cannot authorise a call.
//
// FALLBACK IS NOT AN ERROR PATH — it is the default. Every rejection lands on
// `deterministicNextAction`, which preserves exact role intent and prefers the
// cheapest honest progress. A mission never stalls because a model misbehaved.
//
// Pure. No provider, model, network or database access.

import {
  ADAPTIVE_ACTIONS, type AdaptiveAction, type AdaptiveBottleneck, type SourceStepObservation,
} from "./leadAdaptiveObservation.ts";
import { isRejectedOperationsTitle, type RoleConfidenceTier } from "./leadRoleTaxonomy.ts";
import type { QueryPack } from "./leadQueryPacks.ts";

export const NEXT_ACTION_VERSION = "lead-adaptive-action-1.0.0";

export interface AdaptiveNextAction {
  action: AdaptiveAction;
  reason: string;
  target_capability_key?: string;
  query_pack_ids?: string[];
  broadening_level?: number;
  expected_improvement?: string;
}

export const ACTION_BOUNDS = {
  maxReasonChars: 400,
  maxPackIds: 4,
  maxBroadeningLevel: 5,
} as const;

const norm = (v: unknown): string => String(v ?? "").trim();
const lower = (v: unknown): string => norm(v).toLowerCase();

function str(v: unknown, max: number): string {
  const s = norm(v);
  return s.length > max ? s.slice(0, max) : s;
}

export function parseNextAction(raw: unknown): AdaptiveNextAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  // The action MUST arrive as a string. Coercing first would accept
  // `["advance_source"]`, since a one-element array stringifies to its element —
  // "exactly one action" has to be a shape guarantee, not a formatting accident.
  if (typeof o.action !== "string") return null;
  const action = lower(o.action);
  if (!(ADAPTIVE_ACTIONS as readonly string[]).includes(action)) return null;

  const packIds = Array.isArray(o.query_pack_ids)
    ? o.query_pack_ids.map((v) => lower(v)).filter(Boolean).slice(0, ACTION_BOUNDS.maxPackIds)
    : undefined;
  const lvl = Number(o.broadening_level);

  return {
    action: action as AdaptiveAction,
    reason: str(o.reason, ACTION_BOUNDS.maxReasonChars),
    target_capability_key: str(o.target_capability_key, 60) || undefined,
    query_pack_ids: packIds && packIds.length > 0 ? packIds : undefined,
    broadening_level: Number.isFinite(lvl) && lvl > 0
      ? Math.min(ACTION_BOUNDS.maxBroadeningLevel, Math.floor(lvl))
      : undefined,
    expected_improvement: str(o.expected_improvement, 200) || undefined,
  };
}

// ---------------------------------------------------------------- validate ----

export type ActionViolationCode =
  | "action_not_in_menu"
  | "unknown_action"
  | "unapproved_capability"
  | "raw_actor_id"
  | "unknown_query_pack"
  | "pack_not_eligible"
  | "generic_operations_pack"
  | "evidence_gated_without_evidence"
  | "duplicate_input"
  | "quota_already_met"
  | "execution_window_exhausted"
  | "people_search_prerequisite_missing"
  | "recency_exceeded"
  | "mission_mutation_attempted";

export interface ActionViolation { code: ActionViolationCode; detail: string }

export interface ActionValidationContext {
  observation: SourceStepObservation;
  /** Capability keys Agentory will run. */
  approvedCapabilities: readonly string[];
  /** Every pack in the validated strategy. */
  packs: readonly QueryPack[];
  /** Signatures of inputs already executed for this task. */
  executedSignatures: readonly string[];
  budgetRemainingUsd: number;
  providerCallsRemaining: number;
  /** Hard ceiling carried from mission truth. */
  maximumAgeDays: number;
}

export interface ActionValidation {
  valid: boolean;
  action: AdaptiveNextAction | null;
  violations: ActionViolation[];
}

/**
 * A stable signature for "this exact call has already run".
 *
 * Deliberately a sorted canonical string rather than a hash: it is synchronous,
 * pure and readable in a diagnostic, and collision resistance buys nothing when
 * the comparison set is one task's own history.
 */
export function actionSignature(a: AdaptiveNextAction): string {
  return [
    a.action,
    lower(a.target_capability_key ?? ""),
    [...(a.query_pack_ids ?? [])].map(lower).sort().join(","),
    String(a.broadening_level ?? ""),
  ].join("::");
}

function looksLikeRawActorId(v: string): boolean {
  const s = lower(v);
  if (!s) return false;
  if (s.includes("apify") || s.includes("~")) return true;
  return /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(s);
}

/** Actions that consume a provider call and therefore need budget + a fresh input. */
const PROVIDER_ACTIONS: ReadonlySet<AdaptiveAction> = new Set<AdaptiveAction>([
  "run_unused_query_pack", "broaden_direct_seniority", "broaden_recency", "advance_source",
  "activate_direct_adjacent_pack", "activate_evidence_gated_pack",
  "begin_people_search", "broaden_people_search", "run_contact_enrichment",
]);

export function validateNextAction(
  proposed: AdaptiveNextAction,
  ctx: ActionValidationContext,
): ActionValidation {
  const v: ActionViolation[] = [];
  const o = ctx.observation;

  // ---- 1. the menu is the boundary ----
  if (!(ADAPTIVE_ACTIONS as readonly string[]).includes(proposed.action)) {
    v.push({ code: "unknown_action", detail: proposed.action });
    return { valid: false, action: null, violations: v };
  }
  if (!o.valid_next_actions.includes(proposed.action)) {
    v.push({ code: "action_not_in_menu", detail: `${proposed.action} not in [${o.valid_next_actions.join(", ")}]` });
  }

  // ---- 2. quota and execution allowance ----
  if (o.remaining_leads <= 0 && proposed.action !== "stop_success") {
    v.push({ code: "quota_already_met", detail: "the CONTACT-ready quota is satisfied" });
  }
  if (PROVIDER_ACTIONS.has(proposed.action) &&
      (ctx.budgetRemainingUsd <= 0 || ctx.providerCallsRemaining <= 0)) {
    v.push({ code: "execution_window_exhausted", detail: "no budget or provider calls remain" });
  }

  // ---- 3. capability ----
  if (proposed.target_capability_key) {
    const key = proposed.target_capability_key;
    if (looksLikeRawActorId(key)) {
      v.push({ code: "raw_actor_id", detail: key });
    } else if (!ctx.approvedCapabilities.map(lower).includes(lower(key))) {
      v.push({ code: "unapproved_capability", detail: key });
    }
  }

  // ---- 4. query packs ----
  const byId = new Map(ctx.packs.map((p) => [p.pack_id.toLowerCase(), p]));
  for (const id of proposed.query_pack_ids ?? []) {
    const pack = byId.get(lower(id));
    if (!pack) {
      v.push({ code: "unknown_query_pack", detail: id });
      continue;
    }
    if (pack.titles.some(isRejectedOperationsTitle)) {
      v.push({ code: "generic_operations_pack", detail: `${id} contains unrelated Operations titles` });
    }
    const tier: RoleConfidenceTier = pack.confidence_tier;
    if (tier === "evidence_gated_adjacent") {
      if (proposed.action !== "activate_evidence_gated_pack") {
        v.push({ code: "pack_not_eligible", detail: `${id} is evidence-gated and needs an activation action` });
      }
      if (pack.description_evidence.length === 0) {
        v.push({ code: "evidence_gated_without_evidence", detail: id });
      }
    }
    if (tier === "secondary_signal") {
      v.push({ code: "pack_not_eligible", detail: `${id} is a secondary signal and is never exact hiring evidence` });
    }
  }

  // ---- 5. recency ----
  if (proposed.action === "broaden_recency") {
    // Broadening recency may approach the ceiling but never pass it. The concrete
    // day count lives in the compiled step, so what is checked here is that the
    // mission ceiling itself has not already been reached.
    if (ctx.maximumAgeDays >= 60) {
      v.push({ code: "recency_exceeded", detail: "already at the 60-day hiring-evidence ceiling" });
    }
  }

  // ---- 6. people-search prerequisites ----
  if (proposed.action === "begin_people_search" && o.companies_qualified <= 0) {
    v.push({ code: "people_search_prerequisite_missing", detail: "no qualified company to search people at" });
  }
  if (proposed.action === "run_contact_enrichment" && o.decision_makers_verified <= 0) {
    v.push({ code: "people_search_prerequisite_missing", detail: "no verified decision maker to enrich" });
  }

  // ---- 7. duplicate input ----
  if (PROVIDER_ACTIONS.has(proposed.action)) {
    const sig = actionSignature(proposed);
    if (ctx.executedSignatures.includes(sig)) {
      v.push({ code: "duplicate_input", detail: sig });
    }
  }

  return { valid: v.length === 0, action: v.length === 0 ? proposed : null, violations: v };
}

// ------------------------------------------------- source-quality adaptation ----

export interface SourceQualityVerdict {
  /** Is broadening role titles the wrong remedy for what was observed? */
  preserveExactTitleIntent: boolean;
  /** Has this source shown it does not serve this ICP? */
  sourceUnsuitedToIcp: boolean;
  recommended: AdaptiveAction | null;
  reason: string;
}

/**
 * Read the observation as a statement about SOURCE quality, not role quality.
 *
 * The distinction this encodes is the expensive one to get wrong: when titles
 * match well and companies are rejected anyway, the roles were right and the
 * CORPUS was wrong. Broadening titles there makes the output worse and costs a
 * round. The reverse — noisy titles against a fine corpus — wants a different
 * pack, not a different source.
 */
export function assessSourceQuality(o: SourceStepObservation): SourceQualityVerdict {
  const titleTotal = o.title_matches + o.title_rejections;
  const titleHitRate = titleTotal > 0 ? o.title_matches / titleTotal : 0;
  const rejectionRate = o.companies_resolved > 0
    ? (o.companies_resolved - o.companies_qualified) / o.companies_resolved
    : 0;

  // Titles are landing; the corpus is not this ICP.
  if (titleHitRate >= 0.5 && o.companies_resolved > 0 && rejectionRate >= 0.8) {
    return {
      preserveExactTitleIntent: true,
      sourceUnsuitedToIcp: true,
      recommended: o.remaining_sources.length > 0 ? "advance_source" : "stop_partial",
      reason: "role titles matched but nearly every resolved company failed the ICP — change corpus, not roles",
    };
  }
  // Relevant titles that resolved no company at all is an upstream problem; more
  // sourcing against the same corpus would repeat it.
  if (o.title_matches > 0 && o.companies_resolved === 0) {
    return {
      preserveExactTitleIntent: true,
      sourceUnsuitedToIcp: true,
      recommended: o.remaining_sources.length > 0 ? "advance_source" : "stop_partial",
      reason: "postings matched but no company identity was resolved — this source's rows are not qualifiable",
    };
  }
  // The corpus is fine; this pack is noisy.
  if (titleHitRate < 0.4 && titleTotal > 0) {
    return {
      preserveExactTitleIntent: false,
      sourceUnsuitedToIcp: false,
      recommended: o.unused_query_packs.length > 0 ? "run_unused_query_pack" : "advance_source",
      reason: "most returned postings were off-family — try a tighter pack before changing source",
    };
  }
  // Companies qualify but the people stage has not run.
  if (o.companies_qualified > 0 && o.decision_makers_verified === 0) {
    return {
      preserveExactTitleIntent: true, sourceUnsuitedToIcp: false,
      recommended: "begin_people_search",
      reason: "qualified companies exist — collecting more jobs cannot produce a lead",
    };
  }
  // People verified, contacts missing.
  if (o.decision_makers_verified > 0 && o.contact_ready_leads < o.requested_leads) {
    return {
      preserveExactTitleIntent: true, sourceUnsuitedToIcp: false,
      recommended: "run_contact_enrichment",
      reason: "verified decision makers lack a contact method",
    };
  }
  return { preserveExactTitleIntent: true, sourceUnsuitedToIcp: false, recommended: null, reason: "no distinctive quality signal" };
}

// -------------------------------------------------------------- fallback ----

export interface FallbackContext {
  observation: SourceStepObservation;
  packs: readonly QueryPack[];
  /** Deferred pack counts by tier, as computed by the strategy. */
  directAdjacentAvailable: number;
  evidenceGatedAvailable: number;
  /** Next approved capability in the plan, if any. */
  nextCapability: string | null;
}

/**
 * The deterministic next action.
 *
 * Preference order preserves exact role intent for as long as possible and only
 * then trades precision for reach:
 *   1 unused exact pack → 2 next source (same intent) → 3 direct adjacent
 *   → 4 evidence-gated → 5 people search → 6 contact enrichment → 7 honest partial
 *
 * `assessSourceQuality` is consulted first, because a source that has proven
 * unsuited to the ICP should not receive step 1's extra pack.
 */
export function deterministicNextAction(ctx: FallbackContext): AdaptiveNextAction {
  const o = ctx.observation;
  const menu = new Set(o.valid_next_actions);
  const allow = (a: AdaptiveAction) => menu.has(a);

  if (o.remaining_leads <= 0 && allow("stop_success")) {
    return { action: "stop_success", reason: "the requested CONTACT-ready quota is satisfied" };
  }

  const quality = assessSourceQuality(o);
  if (quality.sourceUnsuitedToIcp && quality.recommended && allow(quality.recommended)) {
    return {
      action: quality.recommended,
      reason: quality.reason,
      target_capability_key: quality.recommended === "advance_source" ? ctx.nextCapability ?? undefined : undefined,
      expected_improvement: "Improve company-side ICP fit while preserving exact role intent.",
    };
  }

  if (o.unused_query_packs.length > 0 && allow("run_unused_query_pack")) {
    return {
      action: "run_unused_query_pack",
      reason: "an exact query pack has not been attempted against this source",
      query_pack_ids: o.unused_query_packs.slice(0, 1),
    };
  }
  if (ctx.nextCapability && allow("advance_source")) {
    return {
      action: "advance_source",
      reason: "exact packs are spent on this source; the next approved source preserves the same role intent",
      target_capability_key: ctx.nextCapability,
    };
  }
  if (ctx.directAdjacentAvailable > 0 && allow("activate_direct_adjacent_pack")) {
    return { action: "activate_direct_adjacent_pack", reason: "exact coverage is exhausted; activating high-confidence adjacent roles" };
  }
  if (ctx.evidenceGatedAvailable > 0 && allow("activate_evidence_gated_pack")) {
    return { action: "activate_evidence_gated_pack", reason: "direct coverage is exhausted; activating evidence-gated roles" };
  }
  if (allow("begin_people_search")) {
    return { action: "begin_people_search", reason: "qualified companies exist and no decision maker has been searched" };
  }
  if (allow("run_contact_enrichment")) {
    return { action: "run_contact_enrichment", reason: "verified decision makers lack a contact method" };
  }
  return {
    action: "stop_partial",
    reason: "every approved source, query pack and enrichment step has been attempted without meeting the quota",
  };
}

/**
 * Resolve the action to execute: Claude's if it survives validation, otherwise the
 * deterministic one. This is the ONLY function a runtime should call.
 */
export function resolveNextAction(
  proposed: AdaptiveNextAction | null,
  ctx: ActionValidationContext & FallbackContext,
): { action: AdaptiveNextAction; source: "claude" | "deterministic_fallback"; violations: ActionViolation[] } {
  if (proposed) {
    const v = validateNextAction(proposed, ctx);
    if (v.valid && v.action) return { action: v.action, source: "claude", violations: [] };
    return { action: deterministicNextAction(ctx), source: "deterministic_fallback", violations: v.violations };
  }
  return { action: deterministicNextAction(ctx), source: "deterministic_fallback", violations: [] };
}

export const NEXT_ACTION_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["action", "reason"],
  properties: {
    action: { type: "string", enum: [...ADAPTIVE_ACTIONS] },
    reason: { type: "string", maxLength: ACTION_BOUNDS.maxReasonChars },
    target_capability_key: { type: "string", description: "A capability key. NEVER a provider or Actor identifier." },
    query_pack_ids: { type: "array", maxItems: ACTION_BOUNDS.maxPackIds, items: { type: "string" } },
    broadening_level: { type: "integer", minimum: 1, maximum: ACTION_BOUNDS.maxBroadeningLevel },
    expected_improvement: { type: "string" },
  },
};

/** Re-exported so a runtime importing the action module gets the label type too. */
export type { AdaptiveBottleneck };
