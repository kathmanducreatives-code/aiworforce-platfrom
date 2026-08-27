// FINDING THE SET THE USER IS POINTING BACK AT.
//
// ── WHY THE MOST RECENT SET WINS ───────────────────────────────────────────
//
// "Check the second company" refers to the last list the user was shown, not to
// a list from four turns ago that happened to be longer. So the search walks
// backwards from the newest message and stops at the FIRST message carrying a
// persisted set — the one still on screen.
//
// ── AND WHY IT STOPS RATHER THAN MERGING ───────────────────────────────────
//
// Merging two sets would renumber both: the second company of the merge is not
// the second company of either list, so an ordinal would resolve to something
// the user never counted. One set, one ordering, or nothing.
//
// ── WHY THE WINDOW IS SMALL ────────────────────────────────────────────────
//
// A referent that scrolled far out of the conversation is not what "them" means
// any more, and binding it would investigate a company the user stopped talking
// about several topics ago. Past the window there is no set, which produces a
// clarification — the honest answer to a reference nobody can locate.
//
// Reads. Writes nothing, decides nothing: which entity a reference resolves to
// is `resolveReferents`' judgement, made from what this returns.

import {
  readPresentedReferents, toReferentSource,
  type PresentedKind, type PresentedReferentSet,
} from "./referentPersistence.ts";
import type { ReferentSource } from "./referentBinding.ts";

/** How many recent messages are searched for a presented set. */
export const REFERENT_LOOKBACK = 12;

/** The narrow client surface this module is allowed to use. */
export interface ReferentDb {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
}

export interface ReferentLookup {
  /** Ready for `resolveReferents`. Null when nothing was found. */
  source: ReferentSource | null;
  /** Which message displayed the set, for provenance on the binding. */
  message_id: string | null;
  kind: PresentedKind | null;
  set: PresentedReferentSet | null;
}

const EMPTY: ReferentLookup =
  { source: null, message_id: null, kind: null, set: null };

/**
 * The newest presented set in this conversation, or nothing.
 *
 * FAILS TOWARD CLARIFICATION. A query error yields no set, and no set makes
 * `resolveReferents` report `no_prior_results` — so a database problem asks the
 * user which company they meant instead of guessing one. That is the correct
 * direction for a lookup whose answer decides what gets paid for.
 */
export async function loadLatestReferents(
  db: ReferentDb, conversationId: string, lookback = REFERENT_LOOKBACK,
): Promise<ReferentLookup> {
  try {
    const { data } = await db.from("messages")
      .select("id, metadata, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(lookback);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const set = readPresentedReferents(row.metadata);
      if (!set || set.entities.length === 0) continue;
      const messageId = typeof row.id === "string" ? row.id : null;
      return {
        source: toReferentSource(set, messageId),
        message_id: messageId,
        kind: set.kind,
        set,
      };
    }
    return EMPTY;
  } catch (e) {
    console.warn("[referent-lookup] query failed", String(e));
    return EMPTY;
  }
}
