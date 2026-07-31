// BALANCED QUERY PACKS — bounded, tiered slices of the role taxonomy.
//
// A taxonomy is not a query. Handing an Actor every title at once produces one
// giant Boolean whose recall is dominated by whichever title is noisiest, and
// whose failure tells you nothing: when 25 rows come back with 4 usable titles,
// an undivided query cannot say WHICH title earned the noise. Packs make each
// provider call a separate, attributable experiment.
//
// AUTHORITY SPLIT. Claude proposes the grouping and the priority. Agentory owns
// pack count, pack size, eligibility ordering and the allocation against the
// existing batch budget — it reuses `decideDiscoveryBatchSize` (PR #121/#124)
// rather than inventing a second sizing rule.
//
// Pure. No provider, model, network or database access.

import { decideDiscoveryBatchSize, type DiscoveryBatchDecision } from "../../discoveryBatchSize.ts";
import {
  ROLE_CONFIDENCE_TIERS, TAXONOMY_BOUNDS, isRejectedOperationsTitle, isSecondaryExecutiveTitle,
  type RoleConfidenceTier, type RoleTaxonomy,
} from "./leadRoleTaxonomy.ts";

export const QUERY_PACK_VERSION = "lead-query-packs-1.0.0";

export type PackExpectation = "low" | "medium" | "high";

export interface QueryPack {
  pack_id: string;
  label: string;
  functional_family_ids: string[];
  confidence_tier: RoleConfidenceTier;
  titles: string[];
  aliases: string[];
  negative_patterns: string[];
  description_evidence: string[];
  recommended_capabilities: string[];
  /** 1 = run first. */
  priority: number;
  broadening_level: number;
  initially_eligible: boolean;
  maximum_attempts: number;
  expected_precision: PackExpectation;
  expected_coverage: PackExpectation;
}

export const PACK_BOUNDS = {
  maxPacks: 8,
  minPacks: 2,
  maxTitlesPerPack: 10,
  maxAliasesPerPack: 8,
  maxEvidencePerPack: 12,
  maxNegativePerPack: 12,
  maxCapabilitiesPerPack: 4,
  maxPriority: 9,
  maxAttempts: 3,
  maxLabelChars: 80,
  maxTitleChars: 60,
  /** A single query may never carry more titles than this, however grouped. */
  hardTitleCeilingPerCall: 10,
} as const;

const norm = (v: unknown): string => String(v ?? "").trim();
const lower = (v: unknown): string => norm(v).toLowerCase();

function str(v: unknown, max: number): string {
  const s = norm(v);
  return s.length > max ? s.slice(0, max) : s;
}

function strList(v: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const s = str(raw, maxChars);
    if (!s) continue;
    if (out.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function expectation(v: unknown, fallback: PackExpectation): PackExpectation {
  const s = lower(v);
  return s === "low" || s === "medium" || s === "high" ? s : fallback;
}

function idOf(v: unknown, max = 48): string {
  return lower(v).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);
}

// ------------------------------------------------------------------- parse ----

export function parseQueryPacks(raw: unknown): QueryPack[] | null {
  if (!Array.isArray(raw)) return null;
  const packs: QueryPack[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const pack_id = idOf(o.pack_id);
    if (!pack_id) continue;
    const tier = lower(o.confidence_tier);
    if (!(ROLE_CONFIDENCE_TIERS as readonly string[]).includes(tier)) continue;

    packs.push({
      pack_id,
      label: str(o.label, PACK_BOUNDS.maxLabelChars) || pack_id,
      functional_family_ids: strList(o.functional_family_ids, TAXONOMY_BOUNDS.maxFamilies, 48).map(idOf).filter(Boolean),
      confidence_tier: tier as RoleConfidenceTier,
      titles: strList(o.titles, PACK_BOUNDS.maxTitlesPerPack, PACK_BOUNDS.maxTitleChars),
      aliases: strList(o.aliases, PACK_BOUNDS.maxAliasesPerPack, PACK_BOUNDS.maxTitleChars),
      negative_patterns: strList(o.negative_patterns, PACK_BOUNDS.maxNegativePerPack, PACK_BOUNDS.maxTitleChars),
      description_evidence: strList(o.description_evidence, PACK_BOUNDS.maxEvidencePerPack, 120),
      recommended_capabilities: strList(o.recommended_capabilities, PACK_BOUNDS.maxCapabilitiesPerPack, 60),
      priority: intIn(o.priority, 1, PACK_BOUNDS.maxPriority, 1),
      broadening_level: intIn(o.broadening_level, 1, TAXONOMY_BOUNDS.maxBroadeningLevel, 1),
      initially_eligible: o.initially_eligible === true,
      maximum_attempts: intIn(o.maximum_attempts, 1, PACK_BOUNDS.maxAttempts, 1),
      expected_precision: expectation(o.expected_precision, "medium"),
      expected_coverage: expectation(o.expected_coverage, "medium"),
    });
    if (packs.length >= PACK_BOUNDS.maxPacks) break;
  }
  return packs.length > 0 ? packs : null;
}

// ---------------------------------------------------------------- validate ----

export type PackRepairCode =
  | "duplicate_pack_removed"
  | "unknown_family_reference_removed"
  | "generic_title_removed"
  | "pack_titles_capped"
  | "evidence_gated_pack_deferred"
  | "secondary_pack_deferred"
  | "evidence_requirement_added"
  | "unsupported_capability_removed"
  | "empty_pack_removed"
  | "priority_normalised";

export interface PackRepair { code: PackRepairCode; pack_id: string; detail: string }

export interface PackValidation {
  outcome: "valid" | "repaired" | "rejected";
  packs: QueryPack[];
  repairs: PackRepair[];
  rejection_reason: string | null;
}

export interface PackValidationInput {
  packs: QueryPack[];
  taxonomy: RoleTaxonomy;
  approvedCapabilities: readonly string[];
}

/**
 * Hold proposed packs to the contract.
 *
 * Like taxonomy repair, every repair narrows or delays — never widens. The one
 * rejection that cannot be repaired is "a single unbounded pack", because
 * splitting it would require inventing a grouping Claude did not propose.
 */
export function validateQueryPacks(input: PackValidationInput): PackValidation {
  const repairs: PackRepair[] = [];
  const approved = new Set(input.approvedCapabilities.map(lower));
  const knownFamilies = new Set(input.taxonomy.families.map((f) => f.family_id));
  const familyTier = new Map(input.taxonomy.families.map((f) => [f.family_id, f.confidence_tier]));
  const seenPackIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const kept: QueryPack[] = [];

  for (const p of input.packs) {
    if (p.confidence_tier === "excluded") continue;

    if (seenPackIds.has(p.pack_id)) {
      repairs.push({ code: "duplicate_pack_removed", pack_id: p.pack_id, detail: "pack_id repeated" });
      continue;
    }

    const pack: QueryPack = { ...p, titles: [], functional_family_ids: [], recommended_capabilities: [] };

    for (const fid of p.functional_family_ids) {
      if (!knownFamilies.has(fid)) {
        repairs.push({ code: "unknown_family_reference_removed", pack_id: p.pack_id, detail: fid });
        continue;
      }
      pack.functional_family_ids.push(fid);
    }

    for (const t of p.titles) {
      if (isRejectedOperationsTitle(t)) {
        repairs.push({ code: "generic_title_removed", pack_id: p.pack_id, detail: t });
        continue;
      }
      pack.titles.push(t);
      if (pack.titles.length >= PACK_BOUNDS.maxTitlesPerPack) {
        if (p.titles.length > PACK_BOUNDS.maxTitlesPerPack) {
          repairs.push({ code: "pack_titles_capped", pack_id: p.pack_id, detail: `capped at ${PACK_BOUNDS.maxTitlesPerPack}` });
        }
        break;
      }
    }

    for (const c of p.recommended_capabilities) {
      if (!approved.has(lower(c))) {
        repairs.push({ code: "unsupported_capability_removed", pack_id: p.pack_id, detail: c });
        continue;
      }
      pack.recommended_capabilities.push(c);
    }

    if (pack.titles.length === 0) {
      repairs.push({ code: "empty_pack_removed", pack_id: p.pack_id, detail: "no usable titles after repair" });
      continue;
    }

    // A pack repeating another pack's exact title set is a duplicate provider call.
    const signature = pack.titles.map(lower).sort().join("|");
    if (seenSignatures.has(signature)) {
      repairs.push({ code: "duplicate_pack_removed", pack_id: p.pack_id, detail: "identical title set to an earlier pack" });
      continue;
    }
    seenSignatures.add(signature);

    // ---- tier policy: gated packs never open the mission ----
    const effectiveTier = pack.functional_family_ids
      .map((f) => familyTier.get(f))
      .find((t) => t === "evidence_gated_adjacent" || t === "secondary_signal") ?? pack.confidence_tier;

    if (effectiveTier === "evidence_gated_adjacent") {
      pack.confidence_tier = "evidence_gated_adjacent";
      if (pack.initially_eligible) {
        pack.initially_eligible = false;
        repairs.push({ code: "evidence_gated_pack_deferred", pack_id: p.pack_id, detail: "evidence-gated packs are not initially eligible" });
      }
      if (pack.description_evidence.length === 0) {
        const inherited = input.taxonomy.families
          .filter((f) => pack.functional_family_ids.includes(f.family_id))
          .flatMap((f) => f.positive_description_evidence);
        pack.description_evidence = strList(inherited, PACK_BOUNDS.maxEvidencePerPack, 120);
        repairs.push({ code: "evidence_requirement_added", pack_id: p.pack_id, detail: "inherited family evidence" });
      }
      if (pack.broadening_level < 2) {
        pack.broadening_level = 2;
        repairs.push({ code: "evidence_gated_pack_deferred", pack_id: p.pack_id, detail: "moved to a later broadening level" });
      }
    }

    if (effectiveTier === "secondary_signal" || pack.titles.every(isSecondaryExecutiveTitle)) {
      pack.confidence_tier = "secondary_signal";
      if (pack.initially_eligible) {
        pack.initially_eligible = false;
        repairs.push({ code: "secondary_pack_deferred", pack_id: p.pack_id, detail: "secondary signals are not initially eligible" });
      }
      if (pack.broadening_level < 3) {
        pack.broadening_level = 3;
        repairs.push({ code: "secondary_pack_deferred", pack_id: p.pack_id, detail: "secondary signals run last" });
      }
    }

    seenPackIds.add(pack.pack_id);
    kept.push(pack);
  }

  if (kept.length === 0) {
    return { outcome: "rejected", packs: [], repairs, rejection_reason: "no usable query pack survived validation" };
  }
  // ONE GIANT QUERY. A single pack carrying the whole taxonomy is the exact
  // failure packs exist to prevent, and it cannot be repaired by narrowing.
  if (kept.length < PACK_BOUNDS.minPacks) {
    const only = kept[0];
    if (only.titles.length >= PACK_BOUNDS.hardTitleCeilingPerCall) {
      return {
        outcome: "rejected", packs: [], repairs,
        rejection_reason: "a single unbounded query pack — the taxonomy was not divided",
      };
    }
    return {
      outcome: "rejected", packs: [], repairs,
      rejection_reason: `fewer than ${PACK_BOUNDS.minPacks} query packs — sourcing would not be attributable`,
    };
  }
  if (!kept.some((p) => p.initially_eligible)) {
    return {
      outcome: "rejected", packs: [], repairs,
      rejection_reason: "no initially-eligible query pack — nothing could run in round one",
    };
  }

  // Stable execution order: eligibility, then broadening level, then priority.
  kept.sort((a, b) =>
    Number(b.initially_eligible) - Number(a.initially_eligible) ||
    a.broadening_level - b.broadening_level ||
    a.priority - b.priority ||
    a.pack_id.localeCompare(b.pack_id));

  return {
    outcome: repairs.length > 0 ? "repaired" : "valid",
    packs: kept, repairs, rejection_reason: null,
  };
}

// --------------------------------------------------------------- selection ----

export interface PackSelectionInput {
  packs: QueryPack[];
  /** Pack ids already run. Re-running one is a wasted provider call. */
  completedPackIds: readonly string[];
  /** Capability about to run. Packs that recommend a different source rank lower. */
  capability: string;
  /** Passed straight to the existing batch sizer — never re-derived here. */
  batch: Parameters<typeof decideDiscoveryBatchSize>[0];
}

export interface PackSelection {
  selected: QueryPack[];
  /** The existing sizing decision, echoed so one record explains the round. */
  batchDecision: DiscoveryBatchDecision;
  /** Titles actually sent, after the per-call ceiling. */
  titles: string[];
  skippedReason: string | null;
}

/**
 * Choose the packs for ONE provider call.
 *
 * Selection is deliberately conservative: the highest-priority eligible pack that
 * has not run, plus further packs only while the per-call title ceiling allows.
 * That ceiling is what stops pack multiplication from silently exceeding the batch
 * and budget bounds the existing sizer already computed.
 */
export function selectPacksForCall(input: PackSelectionInput): PackSelection {
  const batchDecision = decideDiscoveryBatchSize(input.batch);
  const done = new Set(input.completedPackIds.map(lower));
  const cap = lower(input.capability);

  if (batchDecision.count === 0) {
    return { selected: [], batchDecision, titles: [], skippedReason: batchDecision.reason };
  }

  const available = input.packs
    .filter((p) => p.initially_eligible && !done.has(lower(p.pack_id)))
    .sort((a, b) => {
      // A pack that names this capability goes first — Claude's own routing hint.
      const aRec = a.recommended_capabilities.map(lower).includes(cap) ? 0 : 1;
      const bRec = b.recommended_capabilities.map(lower).includes(cap) ? 0 : 1;
      return aRec - bRec || a.broadening_level - b.broadening_level || a.priority - b.priority;
    });

  if (available.length === 0) {
    return { selected: [], batchDecision, titles: [], skippedReason: "no eligible unused query pack" };
  }

  const selected: QueryPack[] = [];
  const titles: string[] = [];
  for (const p of available) {
    const merged = [...titles];
    for (const t of p.titles) {
      if (!merged.some((x) => lower(x) === lower(t))) merged.push(t);
    }
    if (selected.length > 0 && merged.length > PACK_BOUNDS.hardTitleCeilingPerCall) break;
    selected.push(p);
    titles.length = 0;
    titles.push(...merged.slice(0, PACK_BOUNDS.hardTitleCeilingPerCall));
    if (titles.length >= PACK_BOUNDS.hardTitleCeilingPerCall) break;
  }

  return { selected, batchDecision, titles, skippedReason: null };
}

/** Deferred packs in activation order — what a broadening action may switch on. */
export function deferredPacks(packs: readonly QueryPack[]): QueryPack[] {
  return packs
    .filter((p) => !p.initially_eligible)
    .sort((a, b) => a.broadening_level - b.broadening_level || a.priority - b.priority);
}

export const QUERY_PACK_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "array", maxItems: PACK_BOUNDS.maxPacks, minItems: PACK_BOUNDS.minPacks,
  items: {
    type: "object",
    required: ["pack_id", "label", "confidence_tier", "titles", "priority", "broadening_level", "initially_eligible"],
    properties: {
      pack_id: { type: "string" },
      label: { type: "string" },
      functional_family_ids: { type: "array", items: { type: "string" } },
      confidence_tier: { type: "string", enum: [...ROLE_CONFIDENCE_TIERS] },
      titles: { type: "array", maxItems: PACK_BOUNDS.maxTitlesPerPack, items: { type: "string" } },
      aliases: { type: "array", maxItems: PACK_BOUNDS.maxAliasesPerPack, items: { type: "string" } },
      negative_patterns: { type: "array", maxItems: PACK_BOUNDS.maxNegativePerPack, items: { type: "string" } },
      description_evidence: { type: "array", maxItems: PACK_BOUNDS.maxEvidencePerPack, items: { type: "string" } },
      recommended_capabilities: { type: "array", maxItems: PACK_BOUNDS.maxCapabilitiesPerPack, items: { type: "string" } },
      priority: { type: "integer", minimum: 1, maximum: PACK_BOUNDS.maxPriority },
      broadening_level: { type: "integer", minimum: 1, maximum: TAXONOMY_BOUNDS.maxBroadeningLevel },
      initially_eligible: { type: "boolean" },
      maximum_attempts: { type: "integer", minimum: 1, maximum: PACK_BOUNDS.maxAttempts },
      expected_precision: { type: "string", enum: ["low", "medium", "high"] },
      expected_coverage: { type: "string", enum: ["low", "medium", "high"] },
    },
  },
};
