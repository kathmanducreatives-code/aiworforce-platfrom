// ENGAGEMENT COMMENT DRAFTS, AS CANONICAL CONTENT — one item per post.
//
// ── THE SHADOW PATH THIS CLOSES ─────────────────────────────────────────────
//
// The content-engagement loop's last Scribe step drafts a comment for each
// LinkedIn post Scout found. Its `content_loop` carries no `content_item_id` —
// it cannot: the posts do not exist when orchestrate plans the steps — so
// `writeScribeContent` wrote the whole batch to `saved_outputs`, the table with
// no status and no version child. Every engagement comment was read-only.
//
// ── WHY THE ITEM IS CREATED HERE, AT WRITE TIME ─────────────────────────────
//
// This is the first moment the specific opportunity exists: Scout has found the
// post and Scribe has answered it. Creating items earlier would mean inventing
// rows for posts nobody has seen; creating them here means one canonical
// `linkedin_comment` per post that actually got a comment, made with the same
// `createCanonicalContentItem` every other Content path uses and filled through
// the same update — so the version trigger writes exactly one version for each.
// No second engagement-specific Content system; no extra model call.
//
// ── WHERE EACH ONE CAME FROM, TRUTHFULLY ────────────────────────────────────
//
// Scout persists LinkedIn engagement posts to the legacy `signals` table only,
// so a comment usually has no `signal_events` row to reference. The same rule
// as every other Content path applies: a canonical signal is a real FK; a legacy
// one is recorded as `metadata.legacy_signal`; an unknown post keeps its URL.
//
// PURE except `resolveEngagementPostSource`, whose database is injected.

export const ENGAGEMENT_COMMENT_ITEMS_VERSION = "engagement-comment-items-v1" as const;

/** One post and the comment Scribe wrote for it. */
export interface CommentOpportunity {
  post_url: string | null;
  author: string | null;
  comment: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The per-post comments in Scribe's answer.
 *
 * The comment step asks for a JSON array of `{ post_url, author, comment }`;
 * `cleanScribeOutput` has already parsed it into `structured`. Alternate key
 * names a model plausibly uses are accepted, and an entry with no comment text
 * is dropped. An answer that is not per-post at all — prose — is ONE
 * opportunity with no post, so it is still kept as a canonical draft rather
 * than lost or split by guesswork.
 */
export function commentOpportunitiesFrom(
  structured: Record<string, unknown> | null, body: string,
): CommentOpportunity[] {
  const list = structured
    ? (Array.isArray(structured.items) ? structured.items
      : Array.isArray(structured.comments) ? structured.comments
      : Array.isArray(structured.drafts) ? structured.drafts
      : null)
    : null;
  if (list) {
    const out: CommentOpportunity[] = [];
    for (const e of list) {
      if (!e || typeof e !== "object") continue;
      const o = e as Record<string, unknown>;
      const comment = str(o.comment) ?? str(o.comment_draft) ?? str(o.draft) ?? str(o.text);
      if (!comment) continue;
      out.push({
        post_url: str(o.post_url) ?? str(o.url) ?? str(o.source_url),
        author: str(o.author) ?? str(o.post_author) ?? str(o.post_author_name),
        comment,
      });
    }
    if (out.length > 0) return out;
  }
  const text = body.trim();
  return text ? [{ post_url: null, author: null, comment: text }] : [];
}

/** A title a human can scan in a list: whose post, or the comment's opening. */
export function commentItemTitle(o: CommentOpportunity): string {
  if (o.author) return `Comment on ${o.author}'s post`.slice(0, 120);
  const first = o.comment.split("\n").find((l) => l.trim()) ?? "Comment draft";
  return first.trim().slice(0, 120);
}

export type EngagementPostSource =
  | { kind: "signal"; signal_id: string; title: string | null; snippet: string | null }
  | { kind: "legacy_unlinked"; legacy_signal_id: string; title: string | null; snippet: string | null }
  | { kind: "unmatched" };

export interface EngagementLookupDb {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          order(col: string, opts: { ascending: boolean }): {
            limit(n: number): PromiseLike<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
  };
}

/**
 * The signal a commented post was collected as, scoped to the workspace.
 * Canonical first; then the legacy row Scout actually writes; else unmatched.
 * A lookup that fails is `unmatched` — the comment is still worth keeping.
 */
export async function resolveEngagementPostSource(
  db: EngagementLookupDb, workspaceId: string, postUrl: string | null,
): Promise<EngagementPostSource> {
  if (!postUrl) return { kind: "unmatched" };
  try {
    const canonical = await db.from("signal_events")
      .select("id, normalized_value")
      .eq("workspace_id", workspaceId).eq("source_url", postUrl)
      .order("observed_at", { ascending: false }).limit(1);
    const c = Array.isArray(canonical.data) ? canonical.data[0] as Record<string, unknown> | undefined : undefined;
    if (!canonical.error && c?.id) {
      const nv = (c.normalized_value ?? {}) as Record<string, unknown>;
      return {
        kind: "signal", signal_id: String(c.id),
        title: str(nv.title), snippet: str(nv.description) ?? str(nv.post_text),
      };
    }
    const legacy = await db.from("signals")
      .select("id, title, description")
      .eq("workspace_id", workspaceId).eq("source_url", postUrl)
      .order("created_at", { ascending: false }).limit(1);
    const l = Array.isArray(legacy.data) ? legacy.data[0] as Record<string, unknown> | undefined : undefined;
    if (!legacy.error && l?.id) {
      return {
        kind: "legacy_unlinked", legacy_signal_id: String(l.id),
        title: str(l.title), snippet: str(l.description),
      };
    }
  } catch { /* fall through */ }
  return { kind: "unmatched" };
}

/**
 * What the canonical item is ABOUT, as the brief a regeneration reads back.
 * Built from the post, never from the comment Scribe already wrote.
 */
export function commentItemIdea(o: CommentOpportunity, src: EngagementPostSource, topic: string | null): string {
  const about = src.kind === "unmatched" ? null : (src.snippet ?? src.title);
  const whose = o.author ? `${o.author}'s LinkedIn post` : "a LinkedIn post";
  const parts = [
    `a thoughtful, non-pitchy comment on ${whose}`,
    o.post_url ? `(${o.post_url})` : null,
    about ? `— the post: "${about.slice(0, 280)}"` : null,
    topic ? `Related topic: ${topic}.` : null,
  ];
  return parts.filter(Boolean).join(" ");
}
