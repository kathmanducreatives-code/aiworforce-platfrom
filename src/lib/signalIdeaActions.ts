// Pure helpers for the Content page's per-signal idea actions. No React/network
// — Deno-testable. Save/Ignore map to persisted signal_review statuses (they must
// NOT depend on the chat), while turn-into-post/comment builds a draft-only Pilot
// command. Nothing here ever instructs auto-posting.

import {
  signalSubjectFrom, type SignalSubject,
} from "../../supabase/functions/_shared/contentInstruction.ts";

export type SignalIdeaAction = "save" | "ignore";
export type IdeaReviewStatus = "saved" | "ignored";

/** Map a Save/Ignore idea action to the review status it persists. */
export function ideaReviewStatus(action: SignalIdeaAction): IdeaReviewStatus {
  return action === "save" ? "saved" : "ignored";
}

/**
 * WHICH SIGNAL, AS DATA — sent alongside the command, never inside it.
 *
 * The sentence is for the conversation; this is what Pilot acts on. The
 * signal's real id travels in the action metadata so the draft is created with
 * `source_type='signal'` and a real `source_signal_id`, verified by the backend
 * against the workspace. A title in a sentence cannot do that: the model would
 * have to guess which signal it meant.
 */
export function buildTurnIntoMetadata(
  kind: "post" | "comment",
  signal: { id: string },
): Record<string, unknown> {
  return {
    intent: "signal_to_content",
    signal_id: signal.id,
    content_format: kind === "comment" ? "linkedin_comment" : "linkedin_post",
  };
}

/**
 * THE SIGNAL THE USER IS LOOKING AT, as context for a message they type.
 *
 * Unlike `buildTurnIntoMetadata` this carries no intent: the user's own words
 * decide what is wanted, and Pilot only acts on the id when the request is to
 * write something. The id is verified server-side against the workspace.
 */
export function buildSignalContextMetadata(signal: { id: string }): Record<string, unknown> {
  return { signal_id: signal.id };
}

/**
 * WHO A FEED SIGNAL HAPPENED TO, from the relationship fields the projection
 * carries (`raw.subject_type` / `raw.subject_key` for a canonical row, the
 * competitor and account names either kind may have). The shared rule decides —
 * the same `signalSubjectFrom` Pilot uses — so the page and chat can never
 * disagree about whose news it is.
 */
export function feedSignalSubject(signal: {
  signal_type?: string | null; competitor_name?: string | null; account_name?: string | null;
  raw?: Record<string, unknown> | null;
}): SignalSubject {
  const raw = signal.raw ?? {};
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return signalSubjectFrom({
    subject_type: s(raw.subject_type), subject_key: s(raw.subject_key),
    signal_type: signal.signal_type ?? null,
    company_name: s(raw.company_name), competitor_name: signal.competitor_name ?? null,
    account_name: signal.account_name ?? null,
  });
}

/** Where a draft made from a feed signal says it came from. */
export type SignalContentSource =
  | {
    source_type: "signal"; source_signal_id: string; idea: string; subject: SignalSubject;
    metadata: Record<string, never>;
  }
  | {
    source_type: "idea"; source_signal_id: null; idea: string; subject: SignalSubject;
    metadata: { legacy_signal: { id: string; title: string | null; store: "signals" } };
  };

/**
 * A FEED SIGNAL, AS A CONTENT SOURCE — truthfully.
 *
 * The feed is a union of canonical `signal_events` rows and legacy `signals`
 * rows no canonical row covers. `content_item.source_signal_id` references
 * `signal_events`, so only a canonical row may become a signal-sourced draft.
 * A legacy-only signal becomes an idea about it, with its origin recorded under
 * `metadata.legacy_signal` — the same key Pilot writes — rather than a legacy id
 * placed in a column whose FK it would violate, or no trace of it at all.
 */
export function signalContentSource(
  signal: {
    id: string; title: string | null; store?: "signal_events" | "signals";
    signal_type?: string | null; competitor_name?: string | null; account_name?: string | null;
    raw?: Record<string, unknown> | null;
  },
): SignalContentSource {
  const subject = feedSignalSubject(signal);
  if (signal.store === "signal_events") {
    return { source_type: "signal", source_signal_id: signal.id, idea: "", subject, metadata: {} };
  }
  const title = signal.title?.trim() || null;
  return {
    source_type: "idea",
    source_signal_id: null,
    idea: title ?? "An earlier signal",
    subject,
    metadata: { legacy_signal: { id: signal.id, title, store: "signals" } },
  };
}

/** Draft-only command for turning a signal into a post or comment. */
export function buildTurnIntoCommand(
  kind: "post" | "comment",
  opts: { title: string; sourceUrl?: string | null },
): string {
  const src = opts.sourceUrl ? ` Source: ${opts.sourceUrl}` : "";
  return `Scribe, turn signal "${opts.title}" into a ${kind} — draft only.${src}`;
}
