import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildLinkedinEngagementInput } from "./linkedinEngagementInput.ts";
import { normalizeLinkedinEngagementItem, normalizeLinkedinEngagementItems } from "./linkedinEngagementOutput.ts";

// ---------- input adapter ----------

Deno.test("input: builds searchQueries from keywords and clamps max_results", () => {
  const p = buildLinkedinEngagementInput({
    query: "outbound problems",
    keywords: ["AI SDR", "AI SDR", "cold outreach"],
    max_results: 50, // over the cap
  });
  assertEquals(p.maxItems, 20, "clamped to actor max 20");
  assertEquals(p.maxPosts, 20);
  assertEquals(p.searchQueries, ["AI SDR", "cold outreach", "outbound problems"]);
  assertEquals(p.keywords, "AI SDR cold outreach outbound problems");
});

Deno.test("input: defaults max_results to 10 and uses topics/query when no keywords", () => {
  const p = buildLinkedinEngagementInput({ query: "manual GTM work", topics: ["GTM"] });
  assertEquals(p.maxItems, 10);
  assertEquals(p.searchQueries, ["GTM", "manual GTM work"]);
});

Deno.test("input: does NOT forward unknown user_input keys", () => {
  const p = buildLinkedinEngagementInput({
    query: "AI agents",
    max_results: 5,
    user_input: { language: "en", cookies: "SECRET", proxy: { url: "x" }, evilSelector: "*" },
  });
  assertEquals(p.maxItems, 5);
  assertEquals(p.language, "en", "whitelisted key forwarded");
  assert(!("cookies" in p), "cookies dropped");
  assert(!("proxy" in p), "proxy dropped");
  assert(!("evilSelector" in p), "arbitrary field dropped");
});

// ---------- output normalizer ----------

Deno.test("output: normalizes post author fields", () => {
  const item = normalizeLinkedinEngagementItem({
    postUrl: "https://linkedin.com/posts/abc",
    text: "Outbound is so broken right now.",
    author: { name: "Jane Founder", headline: "CEO at Acme", company: "Acme", profileUrl: "https://linkedin.com/in/jane" },
  }, "outbound problems");
  assertEquals(item.type, "linkedin_engagement");
  assertEquals(item.post_url, "https://linkedin.com/posts/abc");
  assertEquals(item.post_author_name, "Jane Founder");
  assertEquals(item.post_author_title, "CEO at Acme");
  assertEquals(item.post_author_company, "Acme");
  assertEquals(item.post_author_profile_url, "https://linkedin.com/in/jane");
  assertEquals(item.topic, "outbound problems");
  assertEquals(item.source, "apify_linkedin_posts");
  assert(item.signal_reason && item.signal_reason.includes("outbound problems"));
});

Deno.test("output: handles missing fields without inventing", () => {
  const item = normalizeLinkedinEngagementItem({ text: "Just a post." }, null);
  assertEquals(item.post_url, null);
  assertEquals(item.post_author_name, null);
  assertEquals(item.post_author_company, null);
  assertEquals(item.post_author_profile_url, null);
  assertEquals(item.commenter_profile_url, null);
  // never fabricates contact data
  assert(!("email" in item));
  assert(!("phone" in item));
});

Deno.test("output: maps commenter and empty array", () => {
  const item = normalizeLinkedinEngagementItem({
    postUrl: "https://linkedin.com/posts/x",
    commenter: { name: "Bob Op", profileUrl: "https://linkedin.com/in/bob" },
  });
  assertEquals(item.commenter_name, "Bob Op");
  assertEquals(item.commenter_profile_url, "https://linkedin.com/in/bob");
  assertEquals(item.engagement_type, "comment");
  assertEquals(normalizeLinkedinEngagementItems(null), []);
});
