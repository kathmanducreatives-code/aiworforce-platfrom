import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contentDraftMeta,
  contentDraftContext,
  buildContentDraftCommand,
  matchesSavedFilter,
  contentSubtypeLabel,
  type SavedOutputLike,
} from "./contentDraftModel.ts";

const mk = (raw: Record<string, unknown> | null, over: Partial<SavedOutputLike> = {}): SavedOutputLike => ({
  id: "o1",
  type: "content_draft",
  title: "Why we built Agentory",
  body: "Founder post body about AI GTM agents and what we shipped.",
  created_at: "2026-06-13T00:00:00Z",
  raw,
  ...over,
});

Deno.test("contentDraftMeta: reads content_loop metadata", () => {
  const m = contentDraftMeta(mk({
    source: "content_engagement_loop",
    subtype: "founder_post",
    topic: "AI GTM agents",
    audience: "seed-stage founders",
    angle: "founder lesson",
    competitor_related: false,
    engagement_queries: ["AI GTM agents", "AI GTM agents for founders"],
  }));
  assertEquals(m.isContentLoop, true);
  assertEquals(m.subtype, "founder_post");
  assertEquals(m.topic, "AI GTM agents");
  assertEquals(m.audience, "seed-stage founders");
  assertEquals(m.angle, "founder lesson");
  assertEquals(m.engagement_queries.length, 2);
});

Deno.test("contentDraftMeta: plain content draft (no raw) defaults safely", () => {
  const m = contentDraftMeta(mk({}));
  assertEquals(m.isContentLoop, false);
  assertEquals(m.subtype, "content");
  assertEquals(m.topic, null);
  const m2 = contentDraftMeta(mk(null));
  assertEquals(m2.subtype, "content");
});

Deno.test("contentDraftMeta: comment_draft subtype", () => {
  const m = contentDraftMeta(mk({ source: "content_engagement_loop", subtype: "comment_draft", topic: "AI SDRs" }));
  assertEquals(m.subtype, "comment_draft");
  assertEquals(contentSubtypeLabel(m.subtype), "Comment drafts");
});

Deno.test("buildContentDraftCommand: find engagement → chat:send (no posting)", () => {
  const cmd = buildContentDraftCommand("find_engagement", mk({ topic: "AI GTM agents" }));
  assert(cmd.startsWith("Find LinkedIn engagement opportunities for this content draft:"));
  assert(cmd.includes("AI GTM agents"));
  assert(!/auto[- ]?post|post (?:this|it) (?:to|on)|publish/i.test(cmd), "must not instruct posting");
});

Deno.test("buildContentDraftCommand: draft comments is explicitly draft-only", () => {
  const cmd = buildContentDraftCommand("draft_comments", mk({ topic: "AI SDRs" })).toLowerCase();
  assert(cmd.startsWith("draft thoughtful comments"));
  assert(cmd.includes("do not post"), "must say do not post");
  assert(!cmd.includes("automatically post") || cmd.includes("do not"), "no auto-post instruction");
});

Deno.test("contentDraftContext: topic-first, bounded, no fabrication", () => {
  const ctx = contentDraftContext(mk({ topic: "AI GTM agents" }));
  assert(ctx.startsWith("AI GTM agents"));
  assert(ctx.length <= 280);
});

Deno.test("matchesSavedFilter: posts vs comments", () => {
  const post = mk({ source: "content_engagement_loop", subtype: "founder_post" });
  const ideas = mk({ source: "content_engagement_loop", subtype: "post_ideas" });
  const comment = mk({ source: "content_engagement_loop", subtype: "comment_draft" });
  const generic = mk({});
  assert(matchesSavedFilter(post, "all"));
  assert(matchesSavedFilter(post, "posts"));
  assert(!matchesSavedFilter(post, "comments"));
  assert(matchesSavedFilter(ideas, "posts"));
  assert(matchesSavedFilter(comment, "comments"));
  assert(!matchesSavedFilter(comment, "posts"));
  assert(matchesSavedFilter(generic, "posts"));
});
