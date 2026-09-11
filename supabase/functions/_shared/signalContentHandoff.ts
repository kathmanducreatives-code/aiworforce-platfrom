// A SIGNAL, HANDED TO PILOT — WHICH ONE, VERIFIED, AND WHAT IT MEANS.
//
// ── THE PATH THIS COMPLETES ────────────────────────────────────────────────
//
// The Signals page and the Content page's signal cards send "Turn into post" to
// Pilot. They used to send an English sentence and nothing else, so Pilot could
// only make an `idea` draft whose title happened to mention a signal: no
// `source_signal_id`, no attribution, and nothing tying the draft back to the
// card it came from.
//
// The card KNOWS the signal's id. It now travels in the action metadata — the
// same channel lead cards already use — and this module is the only place that
// decides what that id is allowed to mean.
//
// ── THREE RULES ────────────────────────────────────────────────────────────
//
//   1. THE ID COMES FROM THE CLIENT, NEVER FROM THE MODEL. Chat Brain may say a
//      message refers to "this signal"; it cannot say which one, and nothing
//      here reads a `resolved_key` it produced.
//   2. IT IS VERIFIED AGAINST THE WORKSPACE BEFORE IT IS TRUSTED. It arrives
//      from a browser and Pilot holds the service role, so an unscoped lookup
//      would let a forged id attach another tenant's signal to a draft.
//   3. AN ID THAT DOES NOT VERIFY IS REFUSED, NOT QUIETLY DOWNGRADED. A draft
//      that silently lost its source reads, on the Content page, exactly like
//      one that never had a signal — the user cannot tell anything went wrong.
//
// ── WHY A LEGACY SIGNAL IS NOT A FAILURE ───────────────────────────────────
//
// The feed is a union: canonical `signal_events` rows, plus `signals` rows from
// before the dual-write that no canonical row covers. A legacy-only card is a
// real signal in this workspace, but `content_item.source_signal_id` references
// `signal_events`, so there is no id it can honestly carry. That draft is made
// as an idea about the signal, and says so — rather than refused, which would
// make older signals un-draftable, or linked, which would violate the FK.
//
// PURE except `resolveSignalHandoff`, whose database is injected.

import type { RequestV1 } from "./requestV1.ts";
import type { ContentFormat } from "./contentOperations.ts";
import type { ContentObjective as PlanObjective } from "./composeSurface.ts";

export const SIGNAL_CONTENT_HANDOFF_VERSION = "signal-content-handoff-v1" as const;

/** The card's own intent marker. Its sentence is ours, not the user's angle. */
export const SIGNAL_TO_CONTENT_INTENT = "signal_to_content" as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SignalHandoff =
  /** No signal was named. Everything behaves exactly as before. */
  | { kind: "none" }
  /** A canonical signal in this workspace. The only case with a real FK. */
  | { kind: "signal"; signal_id: string; title: string | null }
  /** A pre-dual-write signal in this workspace. Real, but it has no FK target. */
  | { kind: "legacy_unlinked"; legacy_signal_id: string; title: string | null }
  /** Named, but not a signal of this workspace — or not an id at all. */
  | { kind: "refused"; reason: "invalid_signal_id" | "signal_not_in_workspace" | "signal_lookup_failed" };

/** True when the handoff names a real signal the draft should be about. */
export function namesSignal(h: SignalHandoff): h is Extract<SignalHandoff, { kind: "signal" | "legacy_unlinked" }> {
  return h.kind === "signal" || h.kind === "legacy_unlinked";
}

export interface SignalLookupDb {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The title the feed showed for a canonical row. `signal_events` has no `title`
 * column — the feed projection reads `normalized_value.title` — so this reads
 * the same field, and never invents one.
 */
export function canonicalSignalTitle(row: { normalized_value?: unknown }): string | null {
  const nv = (row.normalized_value ?? {}) as Record<string, unknown>;
  return str(nv.title);
}

/**
 * Which signal the client named, checked against THIS workspace.
 *
 * No query at all when nothing was named. Otherwise, in order:
 *   1. a canonical row with this id                → `signal`
 *   2. a canonical row that maps this legacy id    → `signal` (its canonical id)
 *   3. a legacy row with this id                   → `legacy_unlinked`
 *   4. none of those                               → `refused`
 * Every lookup is scoped by `workspace_id`.
 */
export async function resolveSignalHandoff(
  db: SignalLookupDb, workspaceId: string, claimed: unknown,
): Promise<SignalHandoff> {
  if (claimed === undefined || claimed === null || claimed === "") return { kind: "none" };
  if (typeof claimed !== "string" || !UUID.test(claimed)) {
    return { kind: "refused", reason: "invalid_signal_id" };
  }
  try {
    const canonical = await db.from("signal_events")
      .select("id, normalized_value")
      .eq("id", claimed).eq("workspace_id", workspaceId).maybeSingle();
    if (canonical.error) return { kind: "refused", reason: "signal_lookup_failed" };
    if (canonical.data) {
      const row = canonical.data as { id: string; normalized_value?: unknown };
      return { kind: "signal", signal_id: row.id, title: canonicalSignalTitle(row) };
    }

    // A legacy card whose row HAS since been mapped. The canonical id is the one
    // the FK accepts, so that is the one the draft carries.
    const mapped = await db.from("signal_events")
      .select("id, normalized_value")
      .eq("legacy_signal_id", claimed).eq("workspace_id", workspaceId).maybeSingle();
    if (!mapped.error && mapped.data) {
      const row = mapped.data as { id: string; normalized_value?: unknown };
      return { kind: "signal", signal_id: row.id, title: canonicalSignalTitle(row) };
    }

    const legacy = await db.from("signals")
      .select("id, title")
      .eq("id", claimed).eq("workspace_id", workspaceId).maybeSingle();
    if (legacy.error) return { kind: "refused", reason: "signal_lookup_failed" };
    if (legacy.data) {
      const row = legacy.data as { id: string; title?: unknown };
      return { kind: "legacy_unlinked", legacy_signal_id: row.id, title: str(row.title) };
    }
    return { kind: "refused", reason: "signal_not_in_workspace" };
  } catch {
    return { kind: "refused", reason: "signal_lookup_failed" };
  }
}

/**
 * THE REQUEST, WITH ITS REFERENCE RESOLVED TO THE SIGNAL THE USER IS LOOKING AT.
 *
 * "Turn this signal into a post" reaches Chat Brain as a compose request whose
 * subject may be `signal`, `content` or even `company`, with a `prior_result`
 * back-reference for "this". Left alone, that back-reference is resolved against
 * LEAD referents — "which company do you mean?" — and, on a `content` subject,
 * read as "regenerate the newest draft", which rewrites something unrelated.
 *
 * The client has already answered "which one", so the answer is written into
 * the request itself, BEFORE the router reads it: the subject is the signal and
 * the back-reference becomes a named reference to it. The router and
 * `planCompose` stay pure and unchanged — they simply see a request whose
 * reference is no longer open.
 *
 * AN EXPLICIT RECIPIENT IS LEFT ALONE. A `person` subject, or a saved set of
 * leads, is someone to write to; anchoring would silently turn gated outreach
 * into an ungated post. Those parts are untouched and stay outreach.
 */
export function anchorComposeToSignal(request: RequestV1, h: SignalHandoff): RequestV1 {
  if (!namesSignal(h)) return request;
  const key = h.kind === "signal" ? h.signal_id : h.legacy_signal_id;
  const label = h.title ?? "the selected signal";
  const anchored = new Set<string>();

  const parts = request.parts.map((p) => {
    if (p.objective !== "compose") return p;
    const refs = p.subject.references ?? [];
    if (p.subject.entity === "person" || refs.some((r) => r.kind === "saved_set")) return p;
    anchored.add(p.id);
    return {
      ...p,
      subject: {
        ...p.subject,
        entity: "signal" as const,
        references: [
          ...refs.filter((r) => r.kind !== "prior_result"),
          { kind: "named" as const, value: label, resolved_key: key },
        ],
      },
    };
  });
  if (anchored.size === 0) return request;

  return {
    ...request,
    parts,
    // The reference question is answered, so it no longer blocks. Every other
    // ambiguity — on this part or any other — is kept exactly as it was.
    ambiguity: request.ambiguity.filter((a) =>
      !(a.part_id !== null && anchored.has(a.part_id)
        && String(a.field ?? "").startsWith("subject.references"))),
  };
}

/**
 * A signal handoff always makes ITS draft.
 *
 * There is no existing draft of this signal to regenerate or illustrate, and the
 * newest draft in the workspace is some other piece of work. So whatever the
 * plan's objective, a named signal creates.
 */
export function contentObjectiveForHandoff(
  planned: PlanObjective | null, h: SignalHandoff,
): PlanObjective {
  if (namesSignal(h)) return "create";
  return planned ?? "create";
}

/**
 * Post or comment — only from a signal card, which is the one surface that
 * offers both. Anything else, or anything unrecognised, is a post.
 */
export function contentFormatForHandoff(metadata: Record<string, unknown> | null, h: SignalHandoff): ContentFormat {
  if (!namesSignal(h)) return "linkedin_post";
  return metadata?.content_format === "linkedin_comment" ? "linkedin_comment" : "linkedin_post";
}

/**
 * The user's angle, if they gave one. A card's own generated sentence is not
 * one — the Content page passes no angle for the same action, and the brief
 * should not differ by which button was pressed.
 */
export function contentAngleForHandoff(
  message: string, metadata: Record<string, unknown> | null, h: SignalHandoff,
): string {
  if (namesSignal(h) && metadata?.intent === SIGNAL_TO_CONTENT_INTENT) return "";
  return message;
}

/** What the user is told when a named signal does not verify. Nothing was made. */
export function signalHandoffRefusalMessage(reason: Extract<SignalHandoff, { kind: "refused" }>["reason"]): string {
  return reason === "signal_lookup_failed"
    ? "I couldn't check that signal just now, so I didn't start a draft. Nothing was generated and nothing was charged — try again in a moment."
    : "I couldn't find that signal in this workspace, so I didn't start a draft. It may have been removed. Nothing was generated and nothing was charged — refresh the feed and try again.";
}
