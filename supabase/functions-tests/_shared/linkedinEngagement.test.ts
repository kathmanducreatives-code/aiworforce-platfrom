import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildLinkedinEngagementInput, buildLinkedinProfilePostsInput } from "../../functions/_shared/linkedinEngagementInput.ts";
import { normalizeLinkedinEngagementItem, normalizeLinkedinEngagementItems } from "../../functions/_shared/linkedinEngagementOutput.ts";
import { getActorByKey, isActorRuntimeEnabled } from "../../functions/_shared/actorRegistry.ts";

// ---------- actor registry / capability ----------

Deno.test("registry: both LinkedIn actors exist with caps + defaults", () => {
  const posts = getActorByKey("apify_linkedin_posts");
  const profile = getActorByKey("apify_linkedin_profile_posts");
  assert(posts, "apify_linkedin_posts registered");
  assert(profile, "apify_linkedin_profile_posts registered");
  assertEquals(posts!.actor_id, "harvestapi/linkedin-post-search");
  assertEquals(profile!.actor_id, "harvestapi/linkedin-profile-posts");
  assertEquals(posts!.source_type, "linkedin_engagement");
  assertEquals(profile!.source_type, "linkedin_engagement");
  assertEquals(posts!.max_safe_results, 20);
  assertEquals(profile!.max_safe_results, 20);
  // Disabled by default (env flags off in test) → honest unavailable path.
  if (!Deno.env.get("APIFY_ENABLE_LINKEDIN_POSTS")) assertEquals(isActorRuntimeEnabled(posts!), false);
  if (!Deno.env.get("APIFY_ENABLE_LINKEDIN_PROFILE_POSTS")) assertEquals(isActorRuntimeEnabled(profile!), false);
  assert(posts!.missing_message && posts!.missing_message.includes("not configured"));
});

// ---------- input adapter: post search ----------

Deno.test("post-search input: query/topics → searchQueries, comments limited, reactions off, clamp 20", () => {
  const p = buildLinkedinEngagementInput({
    query: "outbound problems",
    keywords: ["AI SDR", "AI SDR"],
    topics: ["cold outreach"],
    max_results: 50,
  });
  assertEquals(p.searchQueries, ["AI SDR", "cold outreach", "outbound problems"]);
  assertEquals(p.maxPosts, 20, "clamped to 20");
  assertEquals(p.scrapeComments, true);
  assertEquals(p.maxComments, 5, "comments limited by default");
  assertEquals(p.scrapeReactions, false, "reactions off by default");
  assertEquals(p.maxReactions, 0);
  assertEquals(p.postedLimit, "week");
  assertEquals(p.sortBy, "date");
  assertEquals(p.startPage, 1);
});

Deno.test("post-search input: default max 10 and no unknown user_input forwarded", () => {
  const p = buildLinkedinEngagementInput({
    query: "AI agents",
    user_input: { sortBy: "relevance", cookies: "SECRET", proxy: { url: "x" }, evil: 1 },
  });
  assertEquals(p.maxPosts, 10);
  assertEquals(p.sortBy, "relevance", "whitelisted override honored");
  assert(!("cookies" in p));
  assert(!("proxy" in p));
  assert(!("evil" in p));
});

// ---------- input adapter: profile posts ----------

Deno.test("profile-posts input: URLs → targetUrls, clamp 20, reactions off", () => {
  const res = buildLinkedinProfilePostsInput({
    profile_urls: ["https://linkedin.com/in/jane"],
    company_urls: ["https://linkedin.com/company/acme"],
    max_results: 99,
  });
  assert(res.ok);
  assertEquals((res.payload!.targetUrls as string[]).length, 2);
  assertEquals(res.payload!.maxPosts, 20);
  assertEquals(res.payload!.scrapeReactions, false);
  assertEquals(res.payload!.postedLimit, "month");
});

Deno.test("profile-posts input: missing URLs → validation/clarification (does not run)", () => {
  const res = buildLinkedinProfilePostsInput({ max_results: 5 });
  assertEquals(res.ok, false);
  assertEquals(res.error, "missing_target_urls");
  assert(res.clarification && res.clarification.length > 0);
});

// ---------- output normalizer ----------

Deno.test("normalize: post author + missing fields, preserves raw, no contact invention", () => {
  const raw = {
    postUrl: "https://linkedin.com/posts/abc",
    text: "Outbound is broken.",
    author: { name: "Jane Founder", headline: "CEO at Acme", company: "Acme", profileUrl: "https://linkedin.com/in/jane" },
  };
  const item = normalizeLinkedinEngagementItem(raw, "outbound problems");
  assertEquals(item.type, "linkedin_engagement");
  assertEquals(item.post_url, "https://linkedin.com/posts/abc");
  assertEquals(item.post_author_name, "Jane Founder");
  assertEquals(item.post_author_company, "Acme");
  assertEquals(item.post_author_profile_url, "https://linkedin.com/in/jane");
  assertEquals(item.raw, raw, "preserves raw");

  // Real HarvestAPI linkedin-post-search output shape: post URL is `linkedinUrl`,
  // body is `content`, author headline is `author.info`, profile is
  // `author.linkedinUrl`, date is `postedAt.date`.
  const harvest = normalizeLinkedinEngagementItem({
    linkedinUrl: "https://www.linkedin.com/posts/janedoe_activity-123",
    content: "My Claude Code workflow for shipping features faster.",
    author: { name: "Jane Doe", info: "Founder & CEO at Acme", linkedinUrl: "https://www.linkedin.com/in/janedoe" },
    postedAt: { date: "2026-06-20 10:00:00" },
  }, "Claude Code");
  assertEquals(harvest.post_url, "https://www.linkedin.com/posts/janedoe_activity-123");
  assertEquals(harvest.post_author_name, "Jane Doe");
  assertEquals(harvest.post_author_title, "Founder & CEO at Acme");
  assertEquals(harvest.post_author_profile_url, "https://www.linkedin.com/in/janedoe");
  assertEquals(harvest.post_date, "2026-06-20 10:00:00");
  assert((harvest.post_text ?? "").includes("Claude Code"));

  // Real api-empire post-comments shape: comment `text`, `author.name`,
  // `author.profile_url`, source `postUrl` — commenter falls back to author.*.
  const comment = normalizeLinkedinEngagementItem({
    text: "We switched off Clay to a cheaper alternative last month.",
    author: { name: "Sam Buyer", profile_url: "https://www.linkedin.com/in/sambuyer" },
    postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:7289521182721093633/",
  }, "Clay alternatives");
  assertEquals(comment.commenter_name, "Sam Buyer");
  assertEquals(comment.commenter_profile_url, "https://www.linkedin.com/in/sambuyer");
  assertEquals(comment.post_url, "https://www.linkedin.com/feed/update/urn:li:activity:7289521182721093633/");
  assert((comment.post_text ?? "").toLowerCase().includes("clay"));

  const sparse = normalizeLinkedinEngagementItem({ text: "Just a post." }, null);
  assertEquals(sparse.post_url, null);
  assertEquals(sparse.post_author_name, null);
  assert(!("email" in sparse));
  assert(!("phone" in sparse));
  assertEquals(normalizeLinkedinEngagementItems(null), []);
});
