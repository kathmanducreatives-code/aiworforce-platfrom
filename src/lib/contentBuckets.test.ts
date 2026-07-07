import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  postDraftOutputs,
  workflowSummaryOutputs,
  commentDraftOutputs,
  commentDraftRows,
  isPostDraftOutput,
  type SavedOutputLike,
  type DraftLike,
} from "./contentBuckets.ts";

const out = (over: Partial<SavedOutputLike>): SavedOutputLike => ({
  id: "o1", type: null, title: null, body: null, created_at: null, raw: null, ...over,
});

Deno.test("content_draft output lands in post drafts (not lost)", () => {
  const rows = [
    out({ id: "a", type: "content_draft", raw: { subtype: "founder_post" } }),
    out({ id: "b", type: "content_draft", raw: { subtype: "post_ideas" } }),
  ];
  const posts = postDraftOutputs(rows);
  assertEquals(posts.map((r) => r.id), ["a", "b"]);
});

Deno.test("workflow_summary is its own bucket, never a post draft", () => {
  const row = out({ id: "w", type: "workflow_summary" });
  assert(!isPostDraftOutput(row));
  assertEquals(workflowSummaryOutputs([row]).length, 1);
});

Deno.test("comment_draft subtype routes to comments, not posts", () => {
  const row = out({ id: "c", type: "content_draft", raw: { subtype: "comment_draft" } });
  assertEquals(postDraftOutputs([row]).length, 0);
  assertEquals(commentDraftOutputs([row]).map((r) => r.id), ["c"]);
});

Deno.test("counts are not permanently zero for real saved output types", () => {
  const rows = [
    out({ id: "a", type: "content_draft", raw: { subtype: "founder_post" } }),
    out({ id: "w", type: "workflow_summary" }),
    out({ id: "c", type: "content_draft", raw: { subtype: "comment_draft" } }),
  ];
  assertEquals(postDraftOutputs(rows).length, 1);
  assertEquals(workflowSummaryOutputs(rows).length, 1);
  assertEquals(commentDraftOutputs(rows).length, 1);
});

Deno.test("Penn comment drafts filtered by channel", () => {
  const drafts: DraftLike[] = [
    { id: "d1", channel: "linkedin_comment", status: "draft", subject: null, body: "hi", created_at: null },
    { id: "d2", channel: "email", status: "draft", subject: null, body: "hi", created_at: null },
  ];
  assertEquals(commentDraftRows(drafts).map((d) => d.id), ["d1"]);
});
