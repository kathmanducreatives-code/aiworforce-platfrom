// Phase 7 — Signal Feed model for content-loop saved outputs (pure, import-free
// so it's unit-testable). Reads content_draft saved_outputs.raw metadata and
// builds the DRAFT-ONLY chat:send commands the action buttons dispatch.
// No network, no React, no secrets. Never instructs auto-posting.

export interface SavedOutputLike {
  id: string;
  type: string | null;
  title: string | null;
  body: string | null;
  created_at: string | null;
  raw: Record<string, unknown> | null;
}

export type ContentSubtype = "founder_post" | "post_ideas" | "comment_draft" | "content";

export interface ContentDraftMeta {
  isContentLoop: boolean;
  subtype: ContentSubtype;
  source: string | null;
  topic: string | null;
  audience: string | null;
  angle: string | null;
  competitor_related: boolean;
  engagement_queries: string[];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const SUBTYPE_LABELS: Record<ContentSubtype, string> = {
  founder_post: "Founder post",
  post_ideas: "Post ideas",
  comment_draft: "Comment drafts",
  content: "Content draft",
};

export function contentSubtypeLabel(s: ContentSubtype): string {
  return SUBTYPE_LABELS[s] ?? "Content draft";
}

/** Extract content-loop display metadata from a saved_outputs row. */
export function contentDraftMeta(row: SavedOutputLike): ContentDraftMeta {
  const raw = (row?.raw && typeof row.raw === "object") ? row.raw as Record<string, unknown> : {};
  const source = str(raw["source"]);
  const rawSubtype = str(raw["subtype"]);
  const subtype: ContentSubtype =
    rawSubtype === "founder_post" || rawSubtype === "post_ideas" || rawSubtype === "comment_draft"
      ? rawSubtype
      : "content";
  return {
    isContentLoop: source === "content_engagement_loop",
    subtype,
    source,
    topic: str(raw["topic"]),
    audience: str(raw["audience"]),
    angle: str(raw["angle"]),
    competitor_related: raw["competitor_related"] === true,
    engagement_queries: Array.isArray(raw["engagement_queries"])
      ? (raw["engagement_queries"] as unknown[]).map((q) => str(q)).filter(Boolean) as string[]
      : [],
  };
}

export type ContentDraftAction = "find_engagement" | "draft_comments";

/** A short, safe context string for a content draft (topic-first, no fabrication). */
export function contentDraftContext(row: SavedOutputLike): string {
  const meta = contentDraftMeta(row);
  const head = meta.topic ?? str(row.title) ?? "this content draft";
  const body = str(row.body);
  const snippet = body ? body.slice(0, 200) : "";
  return [head, snippet].filter(Boolean).join(" — ").slice(0, 280);
}

/**
 * Build the chat:send command a content-draft action dispatches. Both actions
 * ask Pilot to find/draft — never to post. "draft_comments" is explicitly
 * draft-only.
 */
export function buildContentDraftCommand(action: ContentDraftAction, row: SavedOutputLike): string {
  const ctx = contentDraftContext(row);
  switch (action) {
    case "find_engagement":
      return `Find LinkedIn engagement opportunities for this content draft: ${ctx}`;
    case "draft_comments":
      return `Draft thoughtful comments for related LinkedIn posts using this content angle (do not post them automatically): ${ctx}`;
  }
}

export type SavedFilter = "all" | "posts" | "comments";

export function matchesSavedFilter(row: SavedOutputLike, filter: SavedFilter): boolean {
  if (filter === "all") return true;
  const meta = contentDraftMeta(row);
  if (filter === "comments") return meta.subtype === "comment_draft";
  // posts: founder_post / post_ideas / generic content drafts (anything not a comment)
  return meta.subtype !== "comment_draft";
}
