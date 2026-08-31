// WHO OWNS EACH FIELD OF A DISCOVERY PAYLOAD.
//
// ── WHAT SPREAD ORDER MEANT ────────────────────────────────────────────────
//
// The discovery input was assembled like this:
//
//   { maxItems: maxCandidates,
//     ...structured,                       // mission-derived ICP constraints
//     ...sel.input,                        // the strategy model's proposal
//     ...(query ? { searchQuery: query } : {}),
//     scraperMode: "full" }
//
// Spread REPLACES. So a strategy that named `industryIds` discarded the
// mission's industries entirely rather than refining them — the comment beside
// it said "the strategy refines the ICP's filters; it never removes them all",
// which is what the code intended and not what it did. `maxItems` was likewise
// set twice, and the second one silently won.
//
// Nothing here reverses the order. Order is not a policy; this file is the
// policy, one rule per field, each stating who may change what and why.
//
// ── OWNERSHIP ──────────────────────────────────────────────────────────────
//
//   MISSION       industryIds, locations, companySize — hard ICP constraints
//                 compiled from LeadMissionV1 by `icpDiscoveryConstraints`
//   STRATEGY      may ADD supported semantic filters, and may NARROW a mission
//                 constraint; may never broaden or erase one
//   EXECUTION     maxItems, scraperMode — spend and provider execution. Always
//                 overwrites, from either of the others.
//
// Pure. No I/O.

export type MergeRule =
  /** Mission value stands; strategy may only intersect it. */
  | "mission_owns_strategy_may_narrow"
  /** Mission value stands unless the mission has none. */
  | "mission_owns"
  /** Strategy's semantic choice, which execution does not contest. */
  | "strategy_owns"
  /** Execution's value, always, whatever the others said. */
  | "execution_overwrites"
  /** Not a contested field: whoever supplied it, keeps it. */
  | "additive";

export const DISCOVERY_MERGE_POLICY: Readonly<Record<string, MergeRule>> =
  Object.freeze({
    industryIds: "mission_owns_strategy_may_narrow",
    companySize: "mission_owns_strategy_may_narrow",
    locations: "mission_owns",
    searchQuery: "strategy_owns",
    maxItems: "execution_overwrites",
    scraperMode: "execution_overwrites",
    startPage: "execution_overwrites",
    takePages: "execution_overwrites",
  });

export interface MergeProvenance {
  field: string;
  rule: MergeRule;
  mission: unknown;
  strategy: unknown;
  execution: unknown;
  final: unknown;
  /** Why the final value is the final value. Internal diagnostics only. */
  reason: string;
}

export interface DiscoveryMergeResult {
  input: Record<string, unknown>;
  provenance: MergeProvenance[];
  /** Fields where the strategy's value was refused or reduced. */
  strategy_overruled: string[];
}

const arr = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.map(String) : null;

/**
 * Assemble a discovery actor input from its three sources.
 *
 * Deterministic: the same three inputs always produce the same object, and the
 * object does not depend on the order the callers happened to write them in.
 */
export function mergeDiscoveryActorInput(i: {
  /** Hard ICP constraints compiled from the mission. */
  missionConstraints: Record<string, unknown>;
  /** The strategy model's proposal, already allowlisted by `compileActorInput`. */
  strategyInput: Record<string, unknown>;
  /** Spend and provider execution fields. Always wins. */
  executionConstraints: Record<string, unknown>;
}): DiscoveryMergeResult {
  const provenance: MergeProvenance[] = [];
  const overruled: string[] = [];
  const out: Record<string, unknown> = {};

  const fields = new Set([
    ...Object.keys(i.missionConstraints),
    ...Object.keys(i.strategyInput),
    ...Object.keys(i.executionConstraints),
  ]);

  for (const field of fields) {
    const m = i.missionConstraints[field];
    const s = i.strategyInput[field];
    const x = i.executionConstraints[field];
    const rule: MergeRule = DISCOVERY_MERGE_POLICY[field] ?? "additive";
    let final: unknown;
    let reason: string;

    switch (rule) {
      case "execution_overwrites": {
        // SPEND AND PAGINATION ARE NEVER THE MODEL'S. Even a value the strategy
        // allowlist already clamped is discarded here: one owner, one number.
        if (x !== undefined) {
          final = x;
          reason = "execution owns this field";
          if (s !== undefined && s !== x) overruled.push(field);
        } else {
          final = m !== undefined ? m : s;
          reason = "execution supplied none; fell back to mission then strategy";
        }
        break;
      }
      case "mission_owns_strategy_may_narrow": {
        const ma = arr(m), sa = arr(s);
        if (ma && ma.length && sa && sa.length) {
          const kept = ma.filter((v) => sa.includes(v));
          if (kept.length > 0) {
            final = kept;
            reason = kept.length < ma.length
              ? "strategy narrowed the mission constraint"
              : "strategy agreed with the mission constraint";
            if (kept.length < ma.length) overruled.push(field);
          } else {
            // AN EMPTY INTERSECTION IS NOT A NARROWING, IT IS A REPLACEMENT.
            // The mission stands; a strategy that shares no value with the ICP
            // has proposed a different search, not a refinement of this one.
            final = ma;
            reason = "strategy shared no value with the mission constraint; mission kept";
            overruled.push(field);
          }
        } else if (ma && ma.length) {
          final = ma;
          reason = "mission constraint, strategy proposed none";
        } else if (sa && sa.length) {
          final = sa;
          reason = "mission expressed none; strategy value used";
        } else {
          final = undefined;
          reason = "neither supplied a value";
        }
        break;
      }
      case "mission_owns": {
        const ma = arr(m);
        if (ma && ma.length) {
          final = ma;
          reason = "mission constraint is authoritative";
          if (arr(s)?.length) overruled.push(field);
        } else if (m !== undefined) {
          final = m;
          reason = "mission constraint is authoritative";
        } else {
          final = s;
          reason = "mission expressed none; strategy value used";
        }
        break;
      }
      case "strategy_owns": {
        final = s !== undefined ? s : m;
        reason = s !== undefined
          ? "strategy owns this semantic field"
          : "strategy proposed none; mission value used";
        break;
      }
      case "additive": {
        // A supported filter only one source asked for. Execution first because
        // an execution-only field is never a preference.
        final = x !== undefined ? x : s !== undefined ? s : m;
        reason = x !== undefined
          ? "execution-only field"
          : s !== undefined
          ? "strategy addition"
          : "mission-only field";
        break;
      }
    }

    provenance.push({ field, rule, mission: m, strategy: s, execution: x, final, reason });
    if (final !== undefined) out[field] = final;
  }

  return { input: out, provenance, strategy_overruled: [...new Set(overruled)] };
}
