// Pure bucketing for the Content Command Center. No React/network — Deno-testable.
//
// The page used to filter saved_outputs by `type` containing "brief", but Scribe
// never writes a "brief" type — it writes `content_draft` (subtype
// founder_post/post_ideas/comment_draft) and pilot-chat writes `workflow_summary`.
// So the "Content briefs" count was structurally always 0. These helpers bucket
// by what actually exists, and route comment drafts out of the post-drafts list.

export interface SavedOutputLike {
  id: string;
  type: string | null;
  title: string | null;
  body: string | null;
  created_at: string | null;
  raw: Record<string, unknown> | null;
}

export interface DraftLike {
  id: string;
  channel: string | null;
  status: string | null;
  subject: string | null;
  body: string | null;
  created_at: string | null;
}

function typeOf(o: SavedOutputLike): string {
  return (o.type ?? "").toLowerCase();
}

function subtypeOf(o: SavedOutputLike): string {
  const raw = o.raw && typeof o.raw === "object" ? (o.raw as Record<string, unknown>) : {};
  const s = raw["subtype"];
  return typeof s === "string" ? s.toLowerCase() : "";
}

/** Workflow recaps written by pilot-chat (type "workflow_summary"). */
export function isWorkflowSummary(o: SavedOutputLike): boolean {
  const t = typeOf(o);
  return t.includes("workflow") || t.includes("summary");
}

/** A comment draft saved by Scribe (content_draft with subtype comment_draft). */
export function isCommentDraftOutput(o: SavedOutputLike): boolean {
  if (isWorkflowSummary(o)) return false;
  return subtypeOf(o) === "comment_draft";
}

/** A post/idea draft: content_draft-style output that is not a comment draft. */
export function isPostDraftOutput(o: SavedOutputLike): boolean {
  if (isWorkflowSummary(o)) return false;
  const t = typeOf(o);
  const looksContent = t.includes("content") || t.includes("post") || t.includes("draft") || t.includes("brief");
  if (!looksContent) return false;
  return subtypeOf(o) !== "comment_draft";
}

export function postDraftOutputs<T extends SavedOutputLike>(outputs: T[]): T[] {
  return outputs.filter(isPostDraftOutput);
}

export function workflowSummaryOutputs<T extends SavedOutputLike>(outputs: T[]): T[] {
  return outputs.filter(isWorkflowSummary);
}

export function commentDraftOutputs<T extends SavedOutputLike>(outputs: T[]): T[] {
  return outputs.filter(isCommentDraftOutput);
}

/** Penn-authored comment drafts in outreach_drafts (channel contains "comment"). */
export function commentDraftRows<T extends DraftLike>(drafts: T[]): T[] {
  return drafts.filter((d) => (d.channel ?? "").toLowerCase().includes("comment"));
}
