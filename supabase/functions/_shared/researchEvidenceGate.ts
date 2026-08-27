// BUY FRESH EVIDENCE ONLY WHEN WE DO NOT ALREADY HAVE IT.
//
// ── WHAT THIS DECIDES ──────────────────────────────────────────────────────
//
// `research` asks a fresh question about a company the user named. Sometimes
// the answer is already in `signal_events` and is still current, and paying a
// provider to re-establish it would be spending to learn something we know.
//
// This gate answers one question: for THIS company and THIS required evidence,
// is there a signal recent enough to stand? It does not decide what to do about
// the answer — the caller either replies from held evidence or runs the mission.
//
// ── IT OWNS NO FRESHNESS POLICY ────────────────────────────────────────────
//
// `signalFreshness.ts` already defines how long each signal type stays current,
// per type, with an explicit window table. This calls `isSignalFresh` and adds
// nothing: a second staleness rule would drift from the first, and the two would
// disagree about the same event.
//
// ── AND IT FAILS TOWARD SPENDING ───────────────────────────────────────────
//
// A query error yields "no fresh evidence", so the mission runs and the user
// gets a real answer. The opposite default — treating an unreadable table as
// proof we already know — would answer a paid question with silence.

import { isSignalFresh } from "./signalFreshness.ts";
import { CANONICAL_TYPE_FOR } from "./canonicalSignalEvent.ts";
// NOTE THE COLLISION. `missionSignalDescriptor.SignalEvent` is the union of
// event NAMES ("hiring", "funding"); `signalEvent.SignalEvent` is the persisted
// RECORD. `isSignalFresh` reads the record, so that is the one imported here.
import type { SignalEvent as SignalEventRecord } from "./signalEvent.ts";

export const RESEARCH_EVIDENCE_GATE_VERSION = "research-evidence-gate-v1" as const;

export interface HeldEvidence {
  /** The events that are both relevant and still current. */
  fresh: Array<{ signal_type: string; occurred_at: string; source_url: string | null }>;
  /** Relevant events we hold that have gone stale. Reported, not used. */
  stale: number;
  /** True when every required event has fresh evidence. */
  sufficient: boolean;
  /** Which required events have nothing current. These are what a run buys. */
  missing: string[];
}

export interface EvidenceDb {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
}

/**
 * What do we already know about this company, that is still true?
 *
 * `subjectKeys` are the resolved identities — a LinkedIn URL or a domain. Names
 * are deliberately NOT matched: two companies share a name far more often than
 * they share a URL, and answering about the wrong one from held evidence is the
 * same wrong-entity failure as buying about the wrong one.
 */
export async function heldEvidenceFor(
  db: EvidenceDb,
  workspaceId: string,
  subjectKeys: readonly string[],
  requiredEvents: readonly string[],
  now: string = new Date().toISOString(),
): Promise<HeldEvidence> {
  const empty: HeldEvidence = {
    fresh: [], stale: 0, sufficient: false, missing: [...requiredEvents],
  };
  const keys = subjectKeys.map((k) => String(k).trim()).filter(Boolean);
  if (keys.length === 0 || requiredEvents.length === 0) return empty;

  // ── TWO VOCABULARIES, ONE EXISTING BRIDGE ───────────────────────────────
  //
  // A request says `hiring`; `signal_events.signal_type` stores `sales_hiring`.
  // These are different type systems — `missionSignalDescriptor.SIGNAL_EVENTS`
  // is what a REQUEST may ask for, `signalEvent.SignalType` is what is
  // PERSISTED — and querying one with the other matches nothing, silently, for
  // ever. `CANONICAL_TYPE_FOR` already maps between them and is the same table
  // the writer uses, so the read and the write cannot drift apart.
  //
  // A required event with no canonical type is left in `missing` rather than
  // dropped: we genuinely cannot tell whether we hold it, and claiming
  // sufficiency would skip a run the user needs.
  const stored = new Map<string, string>();
  for (const e of requiredEvents) {
    const t = CANONICAL_TYPE_FOR[e]?.type;
    if (t) stored.set(t, e);
  }
  if (stored.size === 0) return empty;

  try {
    const { data } = await db.from("signal_events")
      .select("signal_type, occurred_at, expires_at, source_url, subject_key")
      .eq("workspace_id", workspaceId)
      .in("subject_key", keys)
      .in("signal_type", [...stored.keys()])
      .order("occurred_at", { ascending: false })
      .limit(100);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const fresh: HeldEvidence["fresh"] = [];
    let stale = 0;
    for (const r of rows) {
      const ev = {
        signal_type: String(r.signal_type ?? ""),
        occurred_at: String(r.occurred_at ?? ""),
        expires_at: (r.expires_at as string | null) ?? null,
      } as unknown as SignalEventRecord;
      if (isSignalFresh(ev, now)) {
        fresh.push({
          // REPORTED IN THE REQUEST'S OWN WORDS, so a caller comparing against
          // `requiredEvents` does not have to know the storage vocabulary.
          signal_type: stored.get(String(r.signal_type ?? "")) ?? String(r.signal_type ?? ""),
          occurred_at: String(r.occurred_at ?? ""),
          source_url: (r.source_url as string | null) ?? null,
        });
      } else {
        stale++;
      }
    }
    const covered = new Set(fresh.map((f) => f.signal_type));
    const missing = requiredEvents.filter((e) => !covered.has(e));
    return { fresh, stale, sufficient: missing.length === 0 && fresh.length > 0, missing };
  } catch (e) {
    // FAIL TOWARD SPENDING. An unreadable table is not proof that we know.
    console.warn("[research-evidence-gate] query failed", String(e));
    return empty;
  }
}

/** Say what we already knew, citing when and where. */
export function renderHeldEvidence(label: string, held: HeldEvidence): string {
  const lines = held.fresh.slice(0, 5).map((f) => {
    const when = f.occurred_at.slice(0, 10);
    return `• ${f.signal_type.replace(/_/g, " ")} — ${when}${f.source_url ? ` (${f.source_url})` : ""}`;
  }).join("\n");
  return `I already have current evidence for ${label}, so I haven't run anything:\n\n${lines}` +
    (held.stale ? `\n\n(${held.stale} older record${held.stale === 1 ? "" : "s"} have gone stale and weren't used.)` : "");
}
