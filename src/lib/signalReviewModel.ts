// Phase 6 — Signal review workflow model (pure, import-free so it's unit-testable).
// Holds review-status types, the merge of signal + persisted review state, the
// upsert payload shape, review filters, and the structured bulk chat commands.
// No network, no React, no secrets. Every drafting command is DRAFT-ONLY.

import type { FeedSignal } from "./signalFeedModel";
import { signalTypeLabel } from "./signalFeedModel";

export type ReviewStatus = "new" | "reviewed" | "ignored" | "saved" | "actioned";

export const REVIEW_STATUSES: ReviewStatus[] = ["new", "reviewed", "ignored", "saved", "actioned"];

export function isReviewStatus(v: unknown): v is ReviewStatus {
  return typeof v === "string" && (REVIEW_STATUSES as string[]).includes(v);
}

/** A persisted review row (subset we read from `signal_reviews`). */
export interface SignalReviewRow {
  id?: string;
  signal_id?: string | null;
  lead_candidate_id?: string | null;
  status?: string | null;
  note?: string | null;
  reviewed_at?: string | null;
  ignored_at?: string | null;
  saved_at?: string | null;
  updated_at?: string | null;
}

/** A FeedSignal joined with its (optional) review state. */
export interface ReviewedSignal extends FeedSignal {
  review_status: ReviewStatus;
  review_note: string | null;
  review_id: string | null;
}

/** Index review rows by their signal_id for an O(1) merge. */
export function indexReviewsBySignal(rows: SignalReviewRow[]): Record<string, SignalReviewRow> {
  const out: Record<string, SignalReviewRow> = {};
  for (const r of rows ?? []) {
    if (r?.signal_id) out[r.signal_id] = r;
  }
  return out;
}

/** Merge a signal with its persisted review row. No review → status `new`. */
export function mergeReviewState(
  signal: FeedSignal,
  review?: SignalReviewRow | null,
): ReviewedSignal {
  const status = isReviewStatus(review?.status) ? review!.status as ReviewStatus : "new";
  return {
    ...signal,
    review_status: status,
    review_note: typeof review?.note === "string" && review.note.trim() ? review.note.trim() : null,
    review_id: review?.id ?? null,
  };
}

/** The payload sent to `signal_reviews` for an upsert. Stamps the matching *_at. */
export interface ReviewUpsert {
  workspace_id: string;
  user_id: string;
  signal_id: string;
  status: ReviewStatus;
  note: string | null;
  reviewed_at: string | null;
  ignored_at: string | null;
  saved_at: string | null;
}

export function buildReviewUpsert(args: {
  workspaceId: string;
  userId: string;
  signalId: string;
  status: ReviewStatus;
  note?: string | null;
  now?: string;
}): ReviewUpsert {
  const now = args.now ?? new Date().toISOString();
  return {
    workspace_id: args.workspaceId,
    user_id: args.userId,
    signal_id: args.signalId,
    status: args.status,
    note: typeof args.note === "string" && args.note.trim() ? args.note.trim() : null,
    reviewed_at: args.status === "reviewed" ? now : null,
    ignored_at: args.status === "ignored" ? now : null,
    saved_at: args.status === "saved" ? now : null,
  };
}

// ---------- review filters ----------

export type ReviewFilter = "all" | "new" | "saved" | "reviewed" | "ignored" | "actioned";

export const REVIEW_FILTERS: { key: ReviewFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "saved", label: "Saved" },
  { key: "reviewed", label: "Reviewed" },
  { key: "ignored", label: "Ignored" },
  { key: "actioned", label: "Actioned" },
];

/**
 * Default feed view: New + Saved + Actioned (active, not-yet-dismissed work).
 * Ignored is hidden by default; the "All" and "Ignored" filters reveal it.
 */
export function matchesReviewFilter(status: ReviewStatus, filter: ReviewFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "new": return status === "new";
    case "saved": return status === "saved";
    case "reviewed": return status === "reviewed";
    case "ignored": return status === "ignored";
    case "actioned": return status === "actioned";
  }
}

/** The default landing filter shows active work and hides ignored. */
export function isDefaultVisible(status: ReviewStatus): boolean {
  return status === "new" || status === "saved" || status === "actioned";
}

/**
 * When a user drafts from a signal we mark it `actioned`, but never override an
 * explicit `saved` / `ignored` categorization — user intent wins.
 */
export function nextStatusAfterDraft(current: ReviewStatus): ReviewStatus {
  if (current === "saved" || current === "ignored") return current;
  return "actioned";
}

// ---------- bulk chat commands (DRAFT-ONLY) ----------

export type BulkDraftAction = "rank" | "draft_comment" | "draft_dm" | "create_outreach";

/** A one-line, safe summary of a signal for inclusion in a bulk command. */
export function signalSummaryLine(s: FeedSignal, index?: number): string {
  const bits = [
    signalTypeLabel(s.signal_type),
    s.competitor_name ? `competitor: ${s.competitor_name}` : null,
    s.account_name ? `company: ${s.account_name}` : null,
    s.contact_name ? `person: ${s.contact_name}` : null,
    s.title,
    s.source_url,
  ].filter(Boolean);
  const line = bits.join(" — ").slice(0, 300);
  return typeof index === "number" ? `${index + 1}. ${line}` : line;
}

const BULK_HEADERS: Record<BulkDraftAction, string> = {
  rank: "Rank these saved signals by fit, urgency, and next-best action:",
  draft_comment: "Draft thoughtful LinkedIn comments for these selected signals. Do not post them automatically:",
  draft_dm: "Draft soft LinkedIn DMs for these selected leads. Do not send them:",
  create_outreach: "Draft outreach for these selected leads using their saved signal context. Do not send anything:",
};

/**
 * Build the structured chat command a bulk action dispatches via `chat:send`.
 * Every drafting action is explicitly DRAFT-ONLY — never auto-post/DM/send.
 */
export function buildBulkCommand(action: BulkDraftAction, signals: FeedSignal[]): string {
  const lines = (signals ?? []).map((s, i) => signalSummaryLine(s, i));
  const body = lines.length ? lines.join("\n") : "(no signals selected)";
  return `${BULK_HEADERS[action]}\n${body}`;
}
