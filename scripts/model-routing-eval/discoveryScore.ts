// SCORING A DISCOVERY PROPOSAL AGAINST THE ACTOR CATALOG.
//
// ── THE STRONGEST OFFLINE SIGNAL IN THIS HARNESS ────────────────────────────
//
// Everything else here needs care about what "correct" means. This does not.
// A discovery proposal names actors and gives each an input object, and the
// catalog knows which actors exist, which filters each accepts and which enum
// values are legal. So "is this proposal valid" has an exact answer, computed
// by the SAME function the live path uses — `validateDiscoveryStrategy` — with
// no network, no model and no opinion.
//
// ── AND IT IS NOT HYPOTHETICAL ──────────────────────────────────────────────
//
// The incumbent fails it. Run 4fe98f5c, gpt-4.1, harvested verbatim:
//
//     "source": "model_repaired",  "repaired": 1,
//     violations: [{ code: "filter_dropped", actor_key: "apify_yc_companies_memo23",
//       message: "maxItems: ... has no such input" }]
//
// gpt-4.1 put `maxItems` on an actor whose schema has no such field. The
// validator caught it and repaired it — which is the architecture working — but
// a repair is a SECOND MODEL CALL on the reasoning tier, and the router's own
// policy says a repair "must never run on a cheaper model than the attempt that
// failed". So invalid proposals are not merely untidy: they are the mechanism by
// which a cheap planner stops being cheap.
//
// That makes this the one number in the harness that speaks directly to the
// user's total-economics rule. A model that proposes valid inputs more often
// costs less than its token price suggests, and one that proposes them less
// often costs more.
//
// PURE apart from the catalog it reads, which is a static table.

import {
  DEFAULT_MAX_ACTORS,
  DEFAULT_MAX_ITEMS_PER_ACTOR,
  validateDiscoveryStrategy,
} from "../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import type { LeadMissionV1 } from "../../supabase/functions/_shared/leadMission.ts";

export const DISCOVERY_SCORE_VERSION = "discovery-score-v1" as const;

export interface DiscoveryScore {
  version: typeof DISCOVERY_SCORE_VERSION;
  /** Actors that survived validation. Zero means the run has nothing to buy. */
  usable_actors: number;
  /** A repair is a second reasoning-tier model call. This is the cost number. */
  needed_repair: boolean;
  /** Nothing survived; the run is blocked and buys nothing at all. */
  blocked: boolean;
  /** Filters the model proposed that the actor's schema does not accept. */
  dropped_filters: number;
  violations: Array<{ code: string; severity: string; message: string }>;
  /**
   * The headline: did this proposal reach the wire without a second model call?
   *
   * `true` is the only outcome that costs exactly what the token price says.
   */
  clean: boolean;
}

/**
 * Score a raw discovery proposal exactly as the live path would.
 *
 * `proposals` is whatever the model returned — deliberately `unknown`, because
 * a model that returns the wrong SHAPE is a result this must be able to score
 * rather than crash on, and `validateDiscoveryStrategy` already handles that.
 */
export function scoreDiscoveryProposal(
  proposals: unknown, mission: LeadMissionV1,
): DiscoveryScore {
  const s = validateDiscoveryStrategy(proposals, mission, {
    maxActors: DEFAULT_MAX_ACTORS,
    maxItemsPerActor: DEFAULT_MAX_ITEMS_PER_ACTOR,
  });

  const dropped = s.selections.reduce(
    (n, sel) => n + (sel.dropped_filters?.length ?? 0), 0,
  );
  const blocked = s.source === "blocked" || s.selections.length === 0;
  const repaired = s.source === "model_repaired" || dropped > 0 ||
    s.violations.some((v) => v.severity === "repair");

  return {
    version: DISCOVERY_SCORE_VERSION,
    usable_actors: s.selections.length,
    needed_repair: repaired,
    blocked,
    dropped_filters: dropped,
    violations: s.violations.map((v) => ({
      code: v.code, severity: v.severity, message: v.message,
    })),
    clean: !blocked && !repaired,
  };
}

/**
 * Re-score an ALREADY-VALIDATED strategy read back from `tasks.result`.
 *
 * The harvested fixtures store the post-validation object, not the model's raw
 * proposal — the raw one is not persisted anywhere. So the anchor case is scored
 * from the validator's own recorded verdict rather than by re-running it, and
 * this function exists to make that difference explicit rather than quietly
 * feeding a validated object back through the validator, which would report a
 * clean proposal for a run that actually needed a repair.
 */
export function readPersistedDiscoveryScore(
  persisted: Record<string, unknown>,
): DiscoveryScore {
  const sels = Array.isArray(persisted.selections)
    ? persisted.selections
    : Array.isArray(persisted.actors)
    ? persisted.actors
    : [];
  const violations = Array.isArray(persisted.violations) ? persisted.violations : [];
  const dropped = sels.reduce((n: number, sel: unknown) => {
    const d = (sel as Record<string, unknown>)?.dropped_filters;
    return n + (Array.isArray(d) ? d.length : 0);
  }, 0);
  const repaired = persisted.source === "model_repaired" ||
    Number(persisted.repaired ?? 0) > 0 || dropped > 0;
  const blocked = persisted.source === "blocked" || sels.length === 0;

  return {
    version: DISCOVERY_SCORE_VERSION,
    usable_actors: sels.length,
    needed_repair: repaired,
    blocked,
    dropped_filters: dropped,
    violations: violations.map((v) => {
      const r = v as Record<string, unknown>;
      return {
        code: String(r.code ?? ""),
        severity: String(r.severity ?? ""),
        message: String(r.message ?? ""),
      };
    }),
    clean: !blocked && !repaired,
  };
}
