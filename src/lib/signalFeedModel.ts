// Phase 5 — Signal Feed model (pure, import-free so it's unit-testable).
// Normalizes raw `signals` rows for the feed UI and builds the chat commands
// the action buttons dispatch. No network, no React, no secrets.

export interface RawSignalRow {
  id?: string;
  workspace_id?: string;
  signal_type?: string | null;
  signal_label?: string | null;
  title?: string | null;
  description?: string | null;
  source_url?: string | null;
  source?: string | null;
  created_at?: string | null;
  conversation_id?: string | null;
  plan_id?: string | null;
  raw?: Record<string, unknown> | null;
}

export interface FeedSignal {
  id: string;
  signal_type: string;
  signal_label: string | null;
  title: string;
  description: string | null;
  source_url: string | null;
  source: string | null;
  created_at: string | null;
  // Phase 4 competitor metadata (from raw), surfaced for cards/filters.
  competitor_name: string | null;
  competitor_source: string | null;
  conversation_type: string | null;
  priority: string | null;     // hot|warm|maybe|ignore if present in raw
  raw: Record<string, unknown>;
}

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  hiring_signal: "Hiring signal",
  linkedin_engagement: "LinkedIn engagement",
  competitor_engagement: "Competitor engagement",
  people_profile: "Person / profile",
  company_research: "Company research",
};

export function signalTypeLabel(t: string | null | undefined): string {
  if (!t) return "Signal";
  return SIGNAL_TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Normalize a raw `signals` row into a feed-ready shape. Never invents data. */
export function normalizeSignalRow(row: RawSignalRow): FeedSignal {
  const raw = (row?.raw && typeof row.raw === "object") ? row.raw as Record<string, unknown> : {};
  const signalType = str(row?.signal_type) ?? "signal";
  return {
    id: row?.id ?? "",
    signal_type: signalType,
    signal_label: str(row?.signal_label),
    title: str(row?.title) ?? signalTypeLabel(signalType),
    description: str(row?.description),
    source_url: str(row?.source_url),
    source: str(row?.source),
    created_at: row?.created_at ?? null,
    competitor_name: str(raw["competitor_name"]),
    competitor_source: str(raw["competitor_source"]),
    conversation_type: str(raw["conversation_type"]),
    priority: str(raw["priority"]) ?? str(raw["competitor_confidence_label"]),
    raw,
  };
}

export type SignalAction = "draft_comment" | "draft_dm" | "enrich" | "rank" | "create_outreach";

/** A short, safe context string for a signal (no secrets, no fabricated contacts). */
export function signalContext(s: FeedSignal): string {
  const parts = [
    signalTypeLabel(s.signal_type),
    s.competitor_name ? `competitor: ${s.competitor_name}` : null,
    s.title,
    s.source_url,
  ].filter(Boolean);
  return parts.join(" — ").slice(0, 300);
}

/**
 * Build the chat command an action button dispatches via `chat:send`.
 * All actions DRAFT or ASK Pilot — never auto-comment/DM/send.
 */
export function buildActionCommand(action: SignalAction, s?: FeedSignal): string {
  const ctx = s ? signalContext(s) : "";
  switch (action) {
    case "draft_comment":
      return `Draft a thoughtful LinkedIn comment for this signal: ${ctx}`;
    case "draft_dm":
      return `Draft a soft LinkedIn DM for this lead: ${ctx}`;
    case "enrich":
      return `Enrich this lead/account: ${ctx}`;
    case "rank":
      return `Rank these saved signals by fit and urgency.`;
    case "create_outreach":
      return `Draft outreach for this lead using the saved signal context: ${ctx}`;
  }
}

export const PRIORITY_RANK: Record<string, number> = { hot: 0, warm: 1, maybe: 2, ignore: 3 };
